const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');

async function scan(params) {
  const root = safe.existingDir(params.root);
  const minSize = safe.toNumber(params.minSize, 100 * 1024 * 1024, 0);
  const limit = safe.toInt(params.limit, 200, 1, 2000);
  const recursive = params.recursive !== false;
  const res = await walkFilesAsync(root, { recursive, skipCommonDirs: false, filter: f => f.size >= minSize });
  const files = res.files
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .map(f => ({ path: f.path, name: f.name, dir: f.dir, ext: f.ext, size: f.size, mtime: f.mtime }));
  return {
    files,
    total: res.files.length,
    totalSize: res.files.reduce((s, f) => s + f.size, 0),
    scanned: res.scanned,
    truncated: res.truncated,
  };
}

async function remove(params, ctx) {
  const root = safe.existingDir(params.root);
  const list = Array.isArray(params.paths) ? params.paths : [];
  if (list.length === 0) safe.fail('No files selected');
  const results = [];
  for (const raw of list) {
    try {
      const file = safe.existingFile(raw);
      safe.assertInside(root, file);
      await ctx.trash(file);
      results.push({ path: file, ok: true });
    } catch (err) {
      results.push({ path: String(raw), ok: false, error: err.message });
    }
  }
  return { removed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) };
}

module.exports = { id: 'large-files', actions: { scan, remove } };
