const fs = require('fs');
const crypto = require('crypto');
const safe = require('../core/safe');

const ALGOS = ['md5', 'sha1', 'sha256', 'sha512'];

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function hashFiles(params) {
  const algo = ALGOS.includes(params.algo) ? params.algo : 'sha256';
  const list = Array.isArray(params.paths) ? params.paths : [];
  if (list.length === 0) safe.fail('No files selected');
  if (list.length > 2000) safe.fail('Too many files at once');
  const results = [];
  for (const raw of list) {
    try {
      const file = safe.existingFile(raw);
      const stat = fs.statSync(file);
      const digest = await hashFile(file, algo);
      results.push({ path: file, name: require('path').basename(file), size: stat.size, hash: digest, ok: true });
    } catch (err) {
      results.push({ path: String(raw), name: String(raw), size: 0, hash: null, ok: false, error: err.message });
    }
  }
  return { algo, results };
}

async function verify(params) {
  const algo = ALGOS.includes(params.algo) ? params.algo : 'sha256';
  const file = safe.existingFile(params.path);
  const expected = typeof params.expected === 'string' ? params.expected.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{8,128}$/.test(expected)) safe.fail('Expected hash is not a valid hex digest');
  const actual = await hashFile(file, algo);
  return { algo, path: file, expected, actual, match: actual.toLowerCase() === expected };
}

module.exports = { id: 'hash-tool', actions: { hashFiles, verify }, ALGOS };
