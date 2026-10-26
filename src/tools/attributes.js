const fs = require('fs');
const os = require('os');
const path = require('path');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');

const FLAGS = { readonly: 'R', hidden: 'H', system: 'S', archive: 'A' };

function fromMode(filePath, stat) {
  const writable = (stat.mode & 0o200) !== 0;
  return {
    readonly: !writable,
    hidden: path.basename(filePath).startsWith('.'),
    system: false,
    archive: false,
  };
}

function parseWindowsAttrs(value) {
  const text = String(value || '');
  return {
    readonly: /ReadOnly/i.test(text),
    hidden: /Hidden/i.test(text),
    system: /System/i.test(text),
    archive: /Archive/i.test(text),
  };
}

async function list(params, ctx) {
  const folder = safe.existingDir(params.folder);
  const recursive = params.recursive === true;
  const res = await walkFilesAsync(folder, { recursive, limit: 5000, signal: ctx.signal, onProgress: ctx.progress });

  if (ctx.platform === 'win32') {
    const listFile = path.join(os.tmpdir(), `mtb-attr-${process.pid}-${Date.now()}.txt`);
    try {
      fs.writeFileSync(listFile, res.files.map(f => f.path).join('\n'), 'utf8');
      const out = await safe.powershellJson(
        '$paths=Get-Content -LiteralPath $env:MTB_LIST -Encoding UTF8;' +
        '$paths | Where-Object { $_ } | ForEach-Object { $i=Get-Item -LiteralPath $_ -Force;' +
        '[PSCustomObject]@{P=$i.FullName;A=$i.Attributes.ToString()} } | ConvertTo-Json -Compress',
        { env: { MTB_LIST: listFile }, timeout: 40000 }
      );
      if (out.ok && out.data) {
        const map = new Map(out.data.map(d => [String(d.P), parseWindowsAttrs(d.A)]));
        return {
          folder,
          supported: { readonly: true, hidden: true, system: true, archive: true },
          files: res.files.map(f => ({
            path: f.path, name: f.name, size: f.size,
            attrs: map.get(f.path) || { readonly: false, hidden: false, system: false, archive: false },
          })),
          truncated: res.truncated,
        };
      }
    } finally {
      try { fs.unlinkSync(listFile); } catch { void 0; }
    }
  }

  return {
    folder,
    supported: { readonly: true, hidden: false, system: false, archive: false },
    files: await Promise.all(res.files.map(async f => {
      try {
        const stat = await fs.promises.stat(f.path);
        return { path: f.path, name: f.name, size: f.size, attrs: fromMode(f.path, stat) };
      } catch {
        return { path: f.path, name: f.name, size: f.size, attrs: { readonly: false, hidden: false, system: false, archive: false } };
      }
    })),
    truncated: res.truncated,
  };
}

async function apply(params, ctx) {
  const root = safe.existingDir(params.root);
  const list = Array.isArray(params.paths) ? params.paths : [];
  if (list.length === 0) safe.fail('No files selected');
  const changes = params.changes && typeof params.changes === 'object' ? params.changes : {};
  const active = Object.keys(FLAGS).filter(k => changes[k] === true || changes[k] === false);
  if (active.length === 0) safe.fail('No attribute changes requested');

  const files = [];
  for (const raw of list) {
    try {
      const file = safe.existingFile(raw);
      safe.assertInside(root, file);
      files.push(file);
    } catch (err) {
      files.push({ error: err.message, path: String(raw) });
    }
  }

  const failed = files.filter(f => typeof f !== 'string');
  const valid = files.filter(f => typeof f === 'string');
  let updated = 0;

  if (ctx.platform === 'win32') {
    const args = active.map(k => `${changes[k] ? '+' : '-'}${FLAGS[k]}`);
    for (const file of valid) {
      const res = await safe.run('attrib.exe', [...args, file], { timeout: 10000 });
      if (res.ok) updated++;
      else failed.push({ path: file, error: res.stderr.trim() || 'attrib failed' });
    }
  } else {
    if (changes.readonly === undefined) safe.fail('Only the read-only attribute is supported on this platform');
    for (const file of valid) {
      try {
        const mode = fs.statSync(file).mode;
        fs.chmodSync(file, changes.readonly ? (mode & ~0o222) : (mode | 0o200));
        updated++;
      } catch (err) {
        failed.push({ path: file, error: err.message });
      }
    }
  }
  return { updated, failed: failed.slice(0, 50), failedCount: failed.length };
}

module.exports = { id: 'attributes', actions: { list, apply } };
