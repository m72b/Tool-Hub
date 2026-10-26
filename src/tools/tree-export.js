const path = require('path');
const fs = require('fs');
const safe = require('../core/safe');

async function exportTree(params, ctx = {}) {
  const root = safe.existingDir(params.root);
  const maxDepth = safe.toInt(params.maxDepth, 20, 1, 100);
  const includeFiles = params.includeFiles !== false;
  const format = params.format === 'text' ? 'text' : 'markdown';
  const lines = [format === 'markdown' ? `# ${path.basename(root) || root}` : path.basename(root) || root];
  const stack = [{ dir: root, depth: 0, prefix: '' }];
  let count = 0;
  let truncated = false;
  while (stack.length) {
    if (ctx.signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
    const current = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(current.dir, { withFileTypes: true }); } catch { continue; }
    ctx.progress?.({ scanned: count, directories: stack.length + 1 });
    entries = entries.filter(entry => !entry.isSymbolicLink() && (entry.isDirectory() || (includeFiles && entry.isFile()))).sort((a, b) => a.name.localeCompare(b.name));
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (++count > 20000) { truncated = true; break; }
      const isDirectory = entry.isDirectory();
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const name = isDirectory ? `${entry.name}/` : entry.name;
      lines.push(format === 'markdown'
        ? `${'  '.repeat(current.depth)}- ${name}`
        : `${current.prefix}${connector}${name}`);
      if (isDirectory && current.depth + 1 < maxDepth) stack.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1, prefix: `${current.prefix}${isLast ? '    ' : '│   '}` });
    }
    if (truncated) break;
  }
  return { root, text: lines.join('\n'), count, truncated, format };
}

module.exports = { id: 'tree-export', actions: { export: exportTree } };
