const fs = require('fs');
const os = require('os');
const path = require('path');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');

async function scan(params, ctx) {
  const root = safe.existingDir(params.root);
  const walked = await walkFilesAsync(root, { recursive: params.recursive !== false, skipCommonDirs: false, filter: file => file.size === 0 || file.ext === 'lnk', signal: ctx.signal, onProgress: ctx.progress });
  const shortcuts = walked.files.filter(file => file.ext === 'lnk');
  const states = new Map();
  if (ctx.platform === 'win32' && shortcuts.length) {
    const listFile = path.join(os.tmpdir(), `toolhub-shortcuts-${process.pid}-${Date.now()}.txt`);
    try {
      await fs.promises.writeFile(listFile, shortcuts.map(file => file.path).join('\n'), 'utf8');
      const result = await safe.powershellJson(
        '$ws=New-Object -ComObject WScript.Shell;$paths=Get-Content -LiteralPath $env:TOOLHUB_LIST -Encoding UTF8;' +
        '$paths|Where-Object{$_}|ForEach-Object{$s=$ws.CreateShortcut($_);$t=$s.TargetPath;if($t -and -not [IO.Path]::IsPathRooted($t)){$t=Join-Path (Split-Path $_) $t};' +
        '[PSCustomObject]@{Path=$_;Target=$t;Broken=(-not $t -or -not (Test-Path -LiteralPath $t))}}|ConvertTo-Json -Compress',
        { env: { TOOLHUB_LIST: listFile }, timeout: 30000 }
      );
      if (result.ok) for (const item of result.data || []) states.set(String(item.Path), { broken: item.Broken === true || item.Broken === 'true', target: String(item.Target || '') });
    } finally { try { await fs.promises.unlink(listFile); } catch {} }
  }
  const findings = [];
  for (const file of walked.files) {
    if (file.size === 0) findings.push({ ...file, kind: 'Zero-byte file' });
    const shortcut = states.get(file.path);
    if (shortcut?.broken) findings.push({ ...file, kind: 'Broken shortcut', target: shortcut.target });
  }
  return { root, findings, count: findings.length, truncated: walked.truncated, shortcutsSupported: ctx.platform === 'win32' };
}

async function remove(params, ctx) {
  const root = safe.existingDir(params.root);
  const paths = Array.isArray(params.paths) ? params.paths : [];
  if (!paths.length) safe.fail('No files selected');
  const results = [];
  for (const raw of paths) {
    try {
      const file = safe.assertInside(root, raw);
      if (!(await fs.promises.stat(file)).isFile()) safe.fail('Not a file');
      await ctx.trash(file);
      results.push({ path: file, ok: true });
    } catch (err) { results.push({ path: String(raw), ok: false, error: err.message }); }
  }
  return { removed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok) };
}

module.exports = { id: 'small-files', actions: { scan, remove } };
