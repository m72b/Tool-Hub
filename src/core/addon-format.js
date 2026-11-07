// Tool Hub add-on package format (.thaddon).
//
//   bytes 0-7    magic "THADDON" + format version byte (1)
//   u32 LE       header length (H)
//   H bytes      header JSON (UTF-8): { format, manifest, keyId, files: [{ path, offset, size, compressedSize, sha256 }] }
//   u16 LE       signature length (S)
//   S bytes      Ed25519 signature of the exact header bytes
//   rest         payload: each file deflated (raw), at `offset` from the start of the payload
//
// The signature covers the manifest and the SHA-256 of every file, so verifying the header and then
// each file's hash proves the whole package came unmodified from the holder of the signing key.
const crypto = require('crypto');
const zlib = require('zlib');
const path = require('path');

const MAGIC = Buffer.from('THADDON\x01', 'latin1');
const MAX_HEADER = 4 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_FILE_SIZE = 512 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

class AddonError extends Error {
  constructor(message) { super(message); this.name = 'AddonError'; }
}
const fail = message => { throw new AddonError(message); };

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Short, stable fingerprint shown to users so they can compare keys by eye.
function keyId(publicKeyBase64) {
  return sha256(Buffer.from(publicKeyBase64, 'base64')).slice(0, 16);
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return false;
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*]/.test(part));
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') fail('Add-on manifest is missing');
  if (!ID_PATTERN.test(manifest.id || '')) fail('Add-on id must be 2-64 lowercase letters, digits or dashes');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80) fail('Add-on name is missing or too long');
  if (!VERSION_PATTERN.test(manifest.version || '')) fail('Add-on version must look like 1.0.0');
  if (manifest.minAppVersion && !VERSION_PATTERN.test(manifest.minAppVersion)) fail('minAppVersion must look like 1.0.0');
  if (manifest.maxAppVersion && !VERSION_PATTERN.test(manifest.maxAppVersion)) fail('maxAppVersion must look like 1.0.0');
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0 || manifest.tools.length > 50) fail('Add-on must declare between 1 and 50 tools');
  const ids = new Set();
  for (const tool of manifest.tools) {
    if (!ID_PATTERN.test(tool?.id || '')) fail('Every add-on tool needs a valid id');
    if (ids.has(tool.id)) fail(`Duplicate tool id "${tool.id}"`);
    ids.add(tool.id);
    if (typeof tool.name !== 'string' || !tool.name.trim()) fail(`Tool "${tool.id}" needs a name`);
    if (tool.module !== undefined && !safeRelativePath(tool.module)) fail(`Tool "${tool.id}" has a module path outside the add-on`);
  }
  for (const list of [manifest.scripts || [], manifest.styles || []]) {
    if (!Array.isArray(list) || list.some(item => !safeRelativePath(item))) fail('Add-on scripts and styles must be paths inside the add-on');
  }
  return manifest;
}

function cleanAuthorizer(value) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (text.length > 80) fail('Authorizer name must be 80 characters or fewer');
  return text;
}

// Build a signed package from a folder. `files` is a list of paths relative to `root` (forward slashes).
// `authorizer` (optional) is the name of whoever approved the add-on; it is covered by the signature.
function pack({ root, files, manifest, privateKeyPem, authorizer, origin }) {
  validateManifest(manifest);
  const approvedBy = cleanAuthorizer(authorizer);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  const fs = require('fs');
  const entries = [];
  const blobs = [];
  let offset = 0;
  for (const rel of files) {
    if (!safeRelativePath(rel)) fail(`Unsafe file path in add-on: ${rel}`);
    const data = fs.readFileSync(path.join(root, ...rel.split('/')));
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    entries.push({ path: rel, offset, size: data.length, compressedSize: compressed.length, sha256: sha256(data) });
    blobs.push(compressed);
    offset += compressed.length;
  }
  const fields = { format: 1, manifest, keyId: keyId(publicKey), files: entries };
  if (approvedBy) Object.assign(fields, { authorizer: approvedBy, authorizedAt: new Date().toISOString() });
  if (origin) fields.origin = String(origin).slice(0, 64);
  const header = Buffer.from(JSON.stringify(fields), 'utf8');
  const signature = crypto.sign(null, header, privateKey);
  const lengths = Buffer.alloc(4);
  lengths.writeUInt32LE(header.length);
  const sigLength = Buffer.alloc(2);
  sigLength.writeUInt16LE(signature.length);
  return { buffer: Buffer.concat([MAGIC, lengths, header, sigLength, signature, ...blobs]), publicKey, keyId: keyId(publicKey) };
}

// Parse and verify a package against a list of trusted keys ({ name, publicKey }).
// Returns { manifest, signer, authorizer, authorizedAt, files, extract(rel) -> Buffer }.
function open(buffer, trustedKeys) {
  return parse(buffer, trustedKeys, true);
}

// Parse a package without requiring a trusted signature (for reviewing add-ons before they are approved). File integrity is still checked on extract; `signer` is null when no given key matches.
function readUnverified(buffer, knownKeys = []) {
  return parse(buffer, knownKeys, false);
}

function parse(buffer, trustedKeys, requireTrusted) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MAGIC.length + 6) fail('This is not a Tool Hub add-on file');
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) fail('This is not a Tool Hub add-on file');
  let pos = MAGIC.length;
  const headerLength = buffer.readUInt32LE(pos); pos += 4;
  if (headerLength <= 0 || headerLength > MAX_HEADER || pos + headerLength + 2 > buffer.length) fail('Add-on file is damaged');
  const headerBytes = buffer.subarray(pos, pos + headerLength); pos += headerLength;
  const sigLength = buffer.readUInt16LE(pos); pos += 2;
  if (sigLength === 0 || sigLength > 512 || pos + sigLength > buffer.length) fail('Add-on file is damaged');
  const signature = buffer.subarray(pos, pos + sigLength); pos += sigLength;
  const payload = buffer.subarray(pos);

  const signer = (trustedKeys || []).find(entry => {
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(entry.publicKey, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, headerBytes, key, signature);
    } catch { return false; }
  });
  if (!signer && requireTrusted) fail('The add-on signature is not from a trusted key. Only install add-ons from people you trust, and add their public key under Trusted keys first.');

  let header;
  try { header = JSON.parse(headerBytes.toString('utf8')); } catch { fail('Add-on header is damaged'); }
  if (header.format !== 1) fail('This add-on uses a newer package format; update Tool Hub');
  const manifest = validateManifest(header.manifest);
  if (!Array.isArray(header.files) || header.files.length > MAX_FILES) fail('Add-on file list is invalid');
  const files = new Map();
  for (const entry of header.files) {
    if (!safeRelativePath(entry.path) || files.has(entry.path)) fail('Add-on contains an unsafe or duplicate path');
    if (![entry.offset, entry.size, entry.compressedSize].every(n => Number.isSafeInteger(n) && n >= 0)) fail('Add-on file table is invalid');
    if (entry.size > MAX_FILE_SIZE || entry.offset + entry.compressedSize > payload.length) fail('Add-on file table is invalid');
    files.set(entry.path, entry);
  }
  for (const tool of manifest.tools) if (tool.module && !files.has(tool.module)) fail(`Add-on is missing ${tool.module}`);
  for (const rel of [...(manifest.scripts || []), ...(manifest.styles || [])]) if (!files.has(rel)) fail(`Add-on is missing ${rel}`);

  const extract = rel => {
    const entry = files.get(rel);
    if (!entry) fail(`Add-on has no file ${rel}`);
    const data = zlib.inflateRawSync(payload.subarray(entry.offset, entry.offset + entry.compressedSize), { maxOutputLength: entry.size + 1 });
    if (data.length !== entry.size || sha256(data) !== entry.sha256) fail(`Add-on file ${rel} failed its integrity check`);
    return data;
  };
  return {
    manifest, signer: signer || null, keyId: typeof header.keyId === 'string' ? header.keyId : null,
    authorizer: typeof header.authorizer === 'string' ? cleanAuthorizer(header.authorizer) : '',
    authorizedAt: typeof header.authorizedAt === 'string' ? header.authorizedAt : null,
    files: [...files.keys()], entries: [...files.values()], extract,
  };
}

module.exports = { pack, open, readUnverified, validateManifest, compareVersions, keyId, safeRelativePath, cleanAuthorizer, AddonError, ID_PATTERN };
