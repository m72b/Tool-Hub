const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');

function hashFile(file) {
  return new Promise(resolve => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', c => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

async function index(root, recursive, ctx = {}) {
  const res = await walkFilesAsync(root, { recursive, signal: ctx.signal, onProgress: ctx.progress });
  const map = new Map();
  for (const f of res.files) {
    map.set(path.relative(root, f.path).split(path.sep).join('/'), f);
  }
  return { map, truncated: res.truncated };
}

async function compare(params, ctx = {}) {
  const left = safe.existingDir(params.left);
  const right = safe.existingDir(params.right);
  if (left === right) safe.fail('Choose two different folders');
  const mode = ['name', 'size', 'hash'].includes(params.mode) ? params.mode : 'size';
  const recursive = params.recursive !== false;

  const [a, b] = await Promise.all([index(left, recursive, ctx), index(right, recursive, ctx)]);

  const onlyLeft = [];
  const onlyRight = [];
  const different = [];
  const identical = [];

  for (const [rel, file] of a.map) {
    if (ctx.signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
    const other = b.map.get(rel);
    if (!other) {
      onlyLeft.push({ rel, size: file.size, mtime: file.mtime });
      continue;
    }
    let same = true;
    let reason = '';
    if (mode === 'size' || mode === 'hash') {
      if (file.size !== other.size) {
        same = false;
        reason = 'size';
      }
    }
    if (same && mode === 'hash') {
      if (ctx.signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
      const [h1, h2] = [await hashFile(file.path), await hashFile(other.path)];
      if (h1 === null || h2 === null || h1 !== h2) {
        same = false;
        reason = 'content';
      }
    }
    if (same) identical.push({ rel, size: file.size });
    else different.push({ rel, reason, leftSize: file.size, rightSize: other.size, leftMtime: file.mtime, rightMtime: other.mtime });
  }
  for (const [rel, file] of b.map) {
    if (!a.map.has(rel)) onlyRight.push({ rel, size: file.size, mtime: file.mtime });
  }

  const cap = arr => arr.slice(0, 1000);
  return {
    left,
    right,
    mode,
    onlyLeft: cap(onlyLeft),
    onlyRight: cap(onlyRight),
    different: cap(different),
    identicalCount: identical.length,
    counts: {
      onlyLeft: onlyLeft.length,
      onlyRight: onlyRight.length,
      different: different.length,
      identical: identical.length,
    },
    truncated: a.truncated || b.truncated,
  };
}

module.exports = { id: 'folder-compare', actions: { compare } };
