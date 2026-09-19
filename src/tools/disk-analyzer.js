const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const { dirSize, shouldSkipDir } = require('../core/walk');

async function scan(params) {
  const root = safe.existingDir(params.root);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    safe.fail(`Cannot read folder: ${err.message}`);
  }

  const children = [];
  let fileBytes = 0;
  let fileCount = 0;

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      const info = dirSize(full);
      children.push({
        path: full,
        name: entry.name,
        isDir: true,
        size: info.size,
        count: info.count,
        truncated: info.truncated,
      });
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const st = fs.statSync(full);
      fileBytes += st.size;
      fileCount++;
      children.push({ path: full, name: entry.name, isDir: false, size: st.size, count: 1, truncated: false });
    } catch {
      continue;
    }
  }

  const total = children.reduce((s, c) => s + c.size, 0);
  children.sort((a, b) => b.size - a.size);
  const parent = path.dirname(root);

  return {
    root,
    parent: parent === root ? null : parent,
    total,
    fileBytes,
    fileCount,
    children: children.slice(0, 500).map(c => ({
      ...c,
      percent: total > 0 ? Math.round((c.size / total) * 1000) / 10 : 0,
    })),
  };
}

module.exports = { id: 'disk-analyzer', actions: { scan } };
