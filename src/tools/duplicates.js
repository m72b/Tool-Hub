const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');

function hashFile(file, bytes) {
  return new Promise(resolve => {
    const hash = crypto.createHash('sha256');
    const opts = bytes ? { start: 0, end: bytes - 1 } : {};
    const stream = fs.createReadStream(file, opts);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key === null || key === undefined) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function keepDuplicates(map) {
  const out = new Map();
  for (const [key, list] of map) if (list.length > 1) out.set(key, list);
  return out;
}

async function scan(params) {
  const roots = (Array.isArray(params.roots) ? params.roots : [params.root])
    .filter(Boolean)
    .map(r => safe.existingDir(r));
  if (roots.length === 0) safe.fail('Choose at least one folder');

  const matchBy = ['hash', 'size', 'name', 'name-size'].includes(params.matchBy) ? params.matchBy : 'hash';
  const minSize = safe.toNumber(params.minSize, 1, 0);
  const recursive = params.recursive !== false;

  const all = [];
  let truncated = false;
  for (const root of roots) {
    const res = await walkFilesAsync(root, { recursive, filter: f => f.size >= minSize });
    all.push(...res.files);
    if (res.truncated) truncated = true;
  }

  const seen = new Set();
  const files = all.filter(f => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  let groups;
  if (matchBy === 'name') {
    groups = keepDuplicates(groupBy(files, f => f.name.toLowerCase()));
  } else if (matchBy === 'name-size') {
    groups = keepDuplicates(groupBy(files, f => `${f.name.toLowerCase()}:${f.size}`));
  } else if (matchBy === 'size') {
    groups = keepDuplicates(groupBy(files, f => String(f.size)));
  } else {
    const bySize = keepDuplicates(groupBy(files, f => String(f.size)));
    const candidates = [];
    for (const list of bySize.values()) candidates.push(...list);
    const partial = new Map();
    for (const file of candidates) {
      const h = await hashFile(file.path, 65536);
      if (!h) continue;
      const key = `${file.size}:${h}`;
      if (!partial.has(key)) partial.set(key, []);
      partial.get(key).push(file);
    }
    const full = new Map();
    for (const [, list] of keepDuplicates(partial)) {
      for (const file of list) {
        const h = file.size <= 65536 ? await hashFile(file.path, 65536) : await hashFile(file.path);
        if (!h) continue;
        if (!full.has(h)) full.set(h, []);
        full.get(h).push(file);
      }
    }
    groups = keepDuplicates(full);
  }

  const result = [];
  let wasted = 0;
  for (const [key, list] of groups) {
    list.sort((a, b) => a.mtime - b.mtime);
    wasted += list.slice(1).reduce((sum, f) => sum + f.size, 0);
    result.push({
      key: String(key).slice(0, 80),
      size: list[0].size,
      count: list.length,
      files: list.map(f => ({ path: f.path, name: f.name, dir: f.dir, size: f.size, mtime: f.mtime })),
    });
  }
  result.sort((a, b) => (b.size * (b.count - 1)) - (a.size * (a.count - 1)));

  return {
    groups: result.slice(0, 500),
    totalGroups: result.length,
    scanned: files.length,
    wasted,
    truncated,
    matchBy,
  };
}

async function remove(params, ctx) {
  const roots = (Array.isArray(params.roots) ? params.roots : [params.root])
    .filter(Boolean)
    .map(r => safe.existingDir(r));
  if (roots.length === 0) safe.fail('Missing scan folder');
  const list = Array.isArray(params.paths) ? params.paths : [];
  if (list.length === 0) safe.fail('No files selected');

  const results = [];
  for (const raw of list) {
    try {
      const file = safe.existingFile(raw);
      safe.assertInside(roots, file);
      await ctx.trash(file);
      results.push({ path: file, ok: true });
    } catch (err) {
      results.push({ path: String(raw), ok: false, error: err.message });
    }
  }
  return {
    removed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok),
  };
}

module.exports = { id: 'duplicates', actions: { scan, remove } };
