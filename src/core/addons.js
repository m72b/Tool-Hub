// Installs, lists and removes signed add-ons, and keeps the list of trusted signing keys.
// Add-ons live in <userData>/addons/<id>/ with the package's files plus a manifest.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const format = require('./addon-format');

const BUILT_IN_KEYS = require('./addon-trust.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function normalizePublicKey(input) {
  const text = String(input || '').trim();
  if (!text) throw new format.AddonError('Paste a public key first');
  try {
    const key = text.includes('BEGIN PUBLIC KEY')
      ? crypto.createPublicKey(text)
      : crypto.createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519');
    return key.export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    throw new format.AddonError('That is not a valid Ed25519 public key');
  }
}

function createAddonManager({ userData, appVersion }) {
  const addonsDir = path.join(userData, 'addons');
  const keysFile = path.join(userData, 'addon-trusted-keys.json');
  const removedFile = path.join(userData, 'addons-removed.json');

  // Bundled add-ons the user removed on purpose; they must not reinstall themselves.
  function removedIds() {
    const list = readJson(removedFile, []);
    return Array.isArray(list) ? list.filter(id => typeof id === 'string') : [];
  }

  function writeRemoved(ids) {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(removedFile, JSON.stringify(ids));
  }

  function personalKeys() {
    const list = readJson(keysFile, []);
    return Array.isArray(list) ? list.filter(item => item && typeof item.publicKey === 'string' && typeof item.name === 'string') : [];
  }

  function trustedKeys() {
    return [
      ...BUILT_IN_KEYS.map(key => ({ ...key, builtIn: true, keyId: format.keyId(key.publicKey) })),
      ...personalKeys().map(key => ({ ...key, builtIn: false, keyId: format.keyId(key.publicKey) })),
    ];
  }

  function trustKey(name, publicKeyInput) {
    const label = String(name || '').trim().slice(0, 60);
    if (!label) throw new format.AddonError('Give the key a name so you can recognise it later');
    const publicKey = normalizePublicKey(publicKeyInput);
    const keys = personalKeys();
    if (trustedKeys().some(key => key.publicKey === publicKey)) throw new format.AddonError('That key is already trusted');
    keys.push({ name: label, publicKey, addedAt: new Date().toISOString() });
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2));
    return trustedKeys();
  }

  function untrustKey(id) {
    const keys = personalKeys().filter(key => format.keyId(key.publicKey) !== id);
    fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2));
    return trustedKeys();
  }

  function compatible(manifest) {
    if (manifest.minAppVersion && format.compareVersions(appVersion, manifest.minAppVersion) < 0) return `needs Tool Hub ${manifest.minAppVersion} or newer`;
    if (manifest.maxAppVersion && format.compareVersions(appVersion, manifest.maxAppVersion) > 0) return `only supports Tool Hub up to ${manifest.maxAppVersion}`;
    return null;
  }

  function list() {
    let dirs = [];
    try { dirs = fs.readdirSync(addonsDir, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')); } catch { return []; }
    const out = [];
    for (const dir of dirs) {
      const manifest = readJson(path.join(addonsDir, dir.name, 'manifest.json'), null);
      if (!manifest || manifest.id !== dir.name) continue;
      try { format.validateManifest(manifest); } catch { continue; }
      const info = readJson(path.join(addonsDir, dir.name, '.install.json'), {});
      out.push({ ...manifest, dir: path.join(addonsDir, dir.name), signer: info.signer || 'Unknown', authorizer: info.authorizer || '', installedAt: info.installedAt || null, problem: compatible(manifest) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Inspect a package without installing it (used to show the confirmation dialog).
  function inspect(buffer) {
    const pkg = format.open(buffer, trustedKeys());
    const problem = compatible(pkg.manifest);
    const existing = list().find(item => item.id === pkg.manifest.id);
    return { manifest: pkg.manifest, signer: pkg.signer.name, builtIn: !!pkg.signer.builtIn, authorizer: pkg.authorizer, problem, replaces: existing ? existing.version : null };
  }

  function install(buffer) {
    const pkg = format.open(buffer, trustedKeys());
    const problem = compatible(pkg.manifest);
    if (problem) throw new format.AddonError(`${pkg.manifest.name} ${problem}`);
    const id = pkg.manifest.id;
    fs.mkdirSync(addonsDir, { recursive: true });
    const staging = path.join(addonsDir, `.staging-${id}-${process.pid}`);
    const target = path.join(addonsDir, id);
    const backup = path.join(addonsDir, `.old-${id}-${process.pid}`);
    fs.rmSync(staging, { recursive: true, force: true });
    try {
      for (const rel of pkg.files) {
        const file = path.join(staging, ...rel.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, pkg.extract(rel));
      }
      fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(pkg.manifest, null, 2));
      fs.writeFileSync(path.join(staging, '.install.json'), JSON.stringify({ signer: pkg.signer.name, authorizer: pkg.authorizer, keyId: format.keyId(pkg.signer.publicKey), installedAt: new Date().toISOString() }, null, 2));
      if (fs.existsSync(target)) fs.renameSync(target, backup);
      fs.renameSync(staging, target);
      fs.rmSync(backup, { recursive: true, force: true });
      writeRemoved(removedIds().filter(item => item !== id));
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
      throw err;
    }
    return list().find(item => item.id === id);
  }

  function remove(id) {
    if (!format.ID_PATTERN.test(String(id || ''))) throw new format.AddonError('Unknown add-on');
    const target = path.join(addonsDir, id);
    if (!fs.existsSync(target)) throw new format.AddonError('That add-on is not installed');
    fs.rmSync(target, { recursive: true, force: true });
    writeRemoved(Array.from(new Set([...removedIds(), id])));
    return list();
  }

  // Installs or updates add-ons shipped with the app, skipping any the user removed.
  function installBundled(dir) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(name => name.endsWith('.thaddon')); } catch { return []; }
    const installed = [];
    for (const name of files) {
      try {
        const buffer = fs.readFileSync(path.join(dir, name));
        const { manifest } = format.open(buffer, trustedKeys());
        const existing = list().find(item => item.id === manifest.id);
        if (removedIds().includes(manifest.id)) continue;
        if (existing && format.compareVersions(existing.version, manifest.version) >= 0) continue;
        install(buffer);
        installed.push(manifest.id);
      } catch (err) {
        console.error(`Could not install bundled add-on ${name}: ${err.message}`);
      }
    }
    return installed;
  }

  // Tool definitions contributed by compatible add-ons, ready for the registry.
  function tools() {
    const out = [];
    for (const addon of list()) {
      if (addon.problem) continue;
      for (const tool of addon.tools) {
        out.push({
          id: tool.id,
          name: tool.name,
          category: tool.category || 'Add-ons',
          icon: String(tool.icon || tool.name.slice(0, 2)).slice(0, 3).toUpperCase(),
          description: tool.description || '',
          platforms: tool.platforms || 'win32,darwin,linux',
          core: false,
          addon: addon.id,
          addonName: addon.name,
          background: tool.background === true,
          modulePath: tool.module ? path.join(addon.dir, ...tool.module.split('/')) : null,
        });
      }
    }
    return out;
  }

  // Resolve a file requested through the toolhub-addon:// protocol, refusing anything outside the add-on folder.
  function resolveFile(id, rel) {
    if (!format.ID_PATTERN.test(id) || !format.safeRelativePath(rel)) return null;
    const root = path.join(addonsDir, id);
    const file = path.join(root, ...rel.split('/'));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return fs.existsSync(file) ? file : null;
  }

  return { list, inspect, install, remove, installBundled, tools, trustedKeys, trustKey, untrustKey, resolveFile, addonsDir };
}

module.exports = { createAddonManager, normalizePublicKey };
