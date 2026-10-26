const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');

async function scan(params) {
  const root = safe.existingDir(params.root);
  const recursive = params.recursive !== false;
  const stack = [{ dir: root, depth: 0, visited: false }];
  const cleanable = new Map();
  const directories = [];
  let scanned = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current.visited) {
      let entries;
      try { entries = await fs.promises.readdir(current.dir, { withFileTypes: true }); }
      catch { cleanable.set(current.dir, false); continue; }
      stack.push({ ...current, visited: true, entries });
      if (recursive) {
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1, visited: false });
        }
      }
      continue;
    }
    scanned++;
    const emptyAfterCleanup = current.entries.every(entry => entry.isDirectory() && cleanable.get(path.join(current.dir, entry.name)) === true);
    cleanable.set(current.dir, emptyAfterCleanup);
    if (current.dir !== root && emptyAfterCleanup) directories.push({ path: current.dir, name: path.basename(current.dir), depth: current.depth });
  }
  directories.sort((a, b) => b.depth - a.depth || a.path.localeCompare(b.path));
  return { root, directories, scanned, count: directories.length };
}

async function remove(params, ctx) {
  const root = safe.existingDir(params.root);
  const paths = Array.isArray(params.paths) ? params.paths : [];
  if (!paths.length) safe.fail('No folders selected');
  const ordered = [...new Set(paths)].sort((a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length);
  const results = [];
  for (const raw of ordered) {
    try {
      const folder = safe.assertInside(root, raw);
      if (folder === root || !(await fs.promises.stat(folder)).isDirectory()) safe.fail('Not a removable folder');
      if ((await fs.promises.readdir(folder)).length > 0) safe.fail('Folder is no longer empty');
      await ctx.trash(folder);
      results.push({ path: folder, ok: true });
    } catch (err) { results.push({ path: String(raw), ok: false, error: err.message }); }
  }
  return { removed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok) };
}

module.exports = { id: 'empty-folders', actions: { scan, remove } };
