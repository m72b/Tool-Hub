const fs = require('fs');
const os = require('os');
const path = require('path');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) safe.fail('Invalid date value');
  const year = d.getFullYear();
  if (year < 1601 || year > 9999) safe.fail('Date is out of the supported range');
  return d;
}

async function list(params) {
  const folder = safe.existingDir(params.folder);
  const recursive = params.recursive === true;
  const res = await walkFilesAsync(folder, { recursive, limit: 5000 });
  return {
    folder,
    files: res.files.map(f => ({
      path: f.path,
      name: f.name,
      size: f.size,
      created: f.birthtimeMs,
      modified: f.mtime,
      accessed: f.atimeMs,
    })),
    truncated: res.truncated,
  };
}

async function apply(params, ctx) {
  const root = safe.existingDir(params.root);
  const raws = Array.isArray(params.paths) ? params.paths : [];
  if (raws.length === 0) safe.fail('No files selected');

  const created = parseDate(params.created);
  const modified = parseDate(params.modified);
  const accessed = parseDate(params.accessed);
  if (!created && !modified && !accessed) safe.fail('Set at least one date');
  if (created && ctx.platform !== 'win32') safe.fail('Created date can only be changed on Windows');

  const files = [];
  const failed = [];
  for (const raw of raws) {
    try {
      const file = safe.existingFile(raw);
      safe.assertInside(root, file);
      files.push(file);
    } catch (err) {
      failed.push({ path: String(raw), error: err.message });
    }
  }

  const successful = new Set();
  for (const file of files) {
    try {
      if (modified || accessed) {
        const stat = fs.statSync(file);
        fs.utimesSync(file, accessed || stat.atime, modified || stat.mtime);
        successful.add(file);
      }
    } catch (err) {
      failed.push({ path: file, error: err.message });
    }
  }

  if (created && files.length > 0) {
    const listFile = path.join(os.tmpdir(), `mtb-date-${process.pid}-${Date.now()}.txt`);
    try {
      fs.writeFileSync(listFile, files.join('\n'), 'utf8');
      const res = await safe.powershellJson(
        '$ErrorActionPreference="Stop";$d=[DateTime]::Parse($env:MTB_DATE,[Globalization.CultureInfo]::InvariantCulture);' +
        '$paths=Get-Content -LiteralPath $env:MTB_LIST -Encoding UTF8;' +
        '$paths | Where-Object { $_ } | ForEach-Object { try { (Get-Item -LiteralPath $_ -Force).CreationTime=$d; [PSCustomObject]@{Path=$_;Ok=$true;Error=""} } catch { [PSCustomObject]@{Path=$_;Ok=$false;Error=$_.Exception.Message} } } | ConvertTo-Json -Compress',
        { env: { MTB_LIST: listFile, MTB_DATE: created.toISOString() }, timeout: 60000 }
      );
      if (!res.ok) failed.push({ path: root, error: res.error || 'Could not set created date' });
      else for (const result of res.data || []) {
        if (result.Ok === true || result.Ok === 'true') successful.add(String(result.Path));
        else failed.push({ path: String(result.Path || root), error: String(result.Error || 'Could not set created date') });
      }
    } finally {
      try { fs.unlinkSync(listFile); } catch { void 0; }
    }
  }

  return { updated: successful.size, failed: failed.slice(0, 50), failedCount: failed.length };
}

module.exports = { id: 'file-dates', actions: { list, apply } };
