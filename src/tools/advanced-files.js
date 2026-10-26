const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');

const SIGNATURES = [
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] }, { ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, { ext: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { ext: 'mp3', bytes: [0x49, 0x44, 0x33] },
];

async function fileTypeScan(params) {
  const root = safe.existingDir(params.root);
  const walked = await walkFilesAsync(root, { recursive: params.recursive !== false, skipCommonDirs: false, limit: 100000 });
  const findings = [];
  for (const file of walked.files) {
    let handle;
    try {
      handle = await fs.promises.open(file.path, 'r');
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const header = buffer.subarray(0, bytesRead);
      const found = SIGNATURES.find(sig => header.length >= sig.bytes.length && sig.bytes.every((byte, i) => header[i] === byte));
      const extension = path.extname(file.name).slice(1).toLowerCase();
      if (found && found.ext !== extension) findings.push({ path: file.path, name: file.name, extension: extension || '(none)', detected: found.ext, size: file.size });
    } catch {} finally { if (handle) await handle.close().catch(() => {}); }
  }
  return { root, findings, count: findings.length, truncated: walked.truncated };
}

async function fixExtensions(params) {
  const root = safe.existingDir(params.root);
  const results = [];
  for (const item of (Array.isArray(params.items) ? params.items.slice(0, 5000) : [])) {
    try {
      if (!SIGNATURES.some(sig => sig.ext === item.detected)) safe.fail('Unsupported detected file type');
      const source = safe.assertInside(root, item.path);
      const oldName = path.basename(source);
      const handle = await fs.promises.open(source, 'r');
      let actual;
      try {
        const header = Buffer.alloc(16), { bytesRead } = await handle.read(header, 0, header.length, 0);
        actual = SIGNATURES.find(sig => bytesRead >= sig.bytes.length && sig.bytes.every((byte, i) => header[i] === byte))?.ext;
      } finally { await handle.close(); }
      if (actual !== item.detected) safe.fail('File signature changed since the scan');
      const target = safe.assertInside(root, path.join(path.dirname(source), `${path.basename(oldName, path.extname(oldName))}.${item.detected}`));
      if (source.toLowerCase() === target.toLowerCase()) {
        const temp = `${source}.toolhub-${process.pid}.tmp`;
        await fs.promises.rename(source, temp);
        try { await fs.promises.rename(temp, target); } catch (err) { await fs.promises.rename(temp, source); throw err; }
      } else {
        if (fs.existsSync(target)) safe.fail('A file with the corrected name already exists');
        await fs.promises.rename(source, target);
      }
      results.push({ path: source, target, ok: true });
    } catch (err) { results.push({ path: item.path, ok: false, error: err.message }); }
  }
  return { renamed: results.filter(row => row.ok).length, failed: results.filter(row => !row.ok) };
}

async function syncPlan(params) {
  const source = safe.existingDir(params.source), destination = safe.existingDir(params.destination);
  if (source.toLowerCase() === destination.toLowerCase() || safe.isInside(source, destination) || safe.isInside(destination, source)) safe.fail('Choose separate folders that do not contain one another');
  const [left, right] = await Promise.all([walkFilesAsync(source, { skipCommonDirs: false }), walkFilesAsync(destination, { skipCommonDirs: false })]);
  const destMap = new Map(right.files.map(file => [path.relative(destination, file.path).toLowerCase(), file]));
  const copies = [];
  for (const file of left.files) {
    const relative = path.relative(source, file.path), existing = destMap.get(relative.toLowerCase());
    if (!existing || file.mtime > existing.mtime + 1000) copies.push({ relative, source: file.path, target: path.join(destination, relative), size: file.size, reason: existing ? 'newer' : 'missing' });
  }
  const totalCandidates = copies.length;
  const visible = copies.slice(0, 1000);
  return { source, destination, copies: visible, count: visible.length, totalCandidates, omitted: Math.max(0, totalCandidates - visible.length), totalBytes: visible.reduce((sum, item) => sum + item.size, 0), truncated: left.truncated || right.truncated };
}

async function syncApply(params) {
  const source = safe.existingDir(params.source), destination = safe.existingDir(params.destination);
  if (source.toLowerCase() === destination.toLowerCase() || safe.isInside(source, destination) || safe.isInside(destination, source)) safe.fail('Choose separate folders that do not contain one another');
  const items = Array.isArray(params.items) ? params.items.slice(0, 100000) : [];
  const results = [];
  for (const item of items) {
    try {
      if (typeof item.relative !== 'string' || !item.relative || path.isAbsolute(item.relative) || item.relative.split(/[\\/]/).some(part => part === '..')) safe.fail('Invalid relative file path');
      const input = safe.assertInside(source, path.resolve(source, item.relative));
      const target = safe.assertInside(destination, path.resolve(destination, item.relative));
      if (!(await fs.promises.stat(input)).isFile()) safe.fail('Source file is unavailable');
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const sourceStat = await fs.promises.stat(input);
      if (fs.existsSync(target) && (await fs.promises.stat(target)).mtimeMs >= sourceStat.mtimeMs) { results.push({ path: item.relative, skipped: true }); continue; }
      await fs.promises.copyFile(input, target);
      await fs.promises.utimes(target, sourceStat.atime, sourceStat.mtime);
      results.push({ path: item.relative, copied: true });
    } catch (err) { results.push({ path: item.relative, error: err.message }); }
  }
  return { copied: results.filter(row => row.copied).length, failed: results.filter(row => row.error), results };
}

async function shred(params) {
  const paths = Array.isArray(params.paths) ? params.paths.slice(0, 1000) : [];
  if (!paths.length) safe.fail('Choose files to shred');
  const results = [];
  for (const raw of paths) {
    try {
      const file = safe.existingFile(raw), st = await fs.promises.lstat(file);
      if (st.isSymbolicLink() || !st.isFile()) safe.fail('Only regular files can be shredded');
      const handle = await fs.promises.open(file, 'r+');
      try {
        const size = 1024 * 1024, buffer = Buffer.alloc(size);
        for (let pass = 0; pass < 2; pass++) {
          let offset = 0;
          while (offset < st.size) {
            const length = Math.min(size, st.size - offset);
            if (pass === 0) crypto.randomFillSync(buffer, 0, length); else buffer.fill(0, 0, length);
            await handle.write(buffer, 0, length, offset); offset += length;
          }
          await handle.sync();
        }
      } finally { await handle.close(); }
      await fs.promises.unlink(file);
      results.push({ path: file, ok: true });
    } catch (err) { results.push({ path: String(raw), ok: false, error: err.message }); }
  }
  return { deleted: results.filter(row => row.ok).length, failed: results.filter(row => !row.ok) };
}

async function archive(params, ctx) {
  if (params.operation === 'create') {
    const root = safe.existingDir(params.root), outputDir = safe.existingDir(params.outputDir);
    if (safe.isInside(root, outputDir)) safe.fail('Save the archive outside the source folder');
    const name = params.name;
    if (!safe.safeEntryName(name) || path.extname(name).toLowerCase() !== '.zip') safe.fail('Output name must end in .zip');
    const output = safe.assertInside(outputDir, path.join(outputDir, name));
    if (fs.existsSync(output)) safe.fail('Archive already exists; choose a different name');
    if (ctx.platform === 'win32') {
      const res = await safe.powershell("$ErrorActionPreference='Stop';Compress-Archive -Path (Join-Path $env:TOOLHUB_ROOT '*') -DestinationPath $env:TOOLHUB_OUTPUT -Force", { env: { TOOLHUB_ROOT: root, TOOLHUB_OUTPUT: output }, timeout: 300000 });
      if (!res.ok) safe.fail(res.stderr.trim() || 'Archive creation failed');
    } else {
      const res = await safe.run('zip', ['-q', '-r', output, root], { timeout: 300000 });
      if (!res.ok) safe.fail(res.stderr.trim() || 'Archive creation failed');
    }
    return { output };
  }
  const archivePath = safe.existingFile(params.archive), destination = safe.existingDir(params.destination);
  if (ctx.platform === 'win32') {
    const verify = await safe.powershell("Add-Type -AssemblyName System.IO.Compression.FileSystem;$zip=[IO.Compression.ZipFile]::OpenRead($env:TOOLHUB_ARCHIVE);try{$base=[IO.Path]::GetFullPath($env:TOOLHUB_DEST).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar;foreach($entry in $zip.Entries){if([IO.Path]::IsPathRooted($entry.FullName)){throw 'Archive contains an absolute path'};$candidate=[IO.Path]::GetFullPath([IO.Path]::Combine($base,$entry.FullName));if(-not $candidate.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive contains a path outside the destination'}}}finally{$zip.Dispose()};$ErrorActionPreference='Stop';Expand-Archive -LiteralPath $env:TOOLHUB_ARCHIVE -DestinationPath $env:TOOLHUB_DEST -Force", { env: { TOOLHUB_ARCHIVE: archivePath, TOOLHUB_DEST: destination }, timeout: 300000 });
    if (!verify.ok) safe.fail(verify.stderr.trim() || 'Archive extraction failed or contains an unsafe path');
    return { destination };
  }
  const listing = await safe.run('unzip', ['-Z1', archivePath], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  if (!listing.ok) safe.fail(listing.stderr.trim() || 'Could not inspect archive contents');
  for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) safe.fail('Archive contains an unsafe path');
  }
  const res = await safe.run('unzip', ['-o', archivePath, '-d', destination], { timeout: 300000 });
  if (!res.ok) safe.fail(res.stderr.trim() || 'Archive extraction failed');
  return { destination };
}

async function locking(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('File lock lookup is available on Windows only');
  const file = safe.existingFile(params.path);
  const script = `$source=@'
using System;using System.Runtime.InteropServices;using System.Text;
public static class ToolHubRestartManager {
 public enum AppType { Unknown, MainWindow, OtherWindow, Service, Explorer, Console, Critical }
 [StructLayout(LayoutKind.Sequential)] public struct FileTime { public uint Low; public uint High; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo { public uint Pid; public FileTime Start; public AppType Type; public uint Status; public uint Session; [MarshalAs(UnmanagedType.Bool)] public bool Restartable; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string AppName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string ServiceName; }
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmStartSession(out uint handle, int flags, StringBuilder key);
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmRegisterResources(uint handle, uint fileCount, string[] files, uint appCount, IntPtr apps, uint serviceCount, string[] services);
 [DllImport("rstrtmgr.dll")] public static extern int RmGetList(uint handle, out uint needed, ref uint count, [In,Out] ProcessInfo[] info, ref uint reasons);
 [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint handle);
}
'@;Add-Type -TypeDefinition $source;$key=New-Object Text.StringBuilder 64;[uint32]$h=0;$code=[ToolHubRestartManager]::RmStartSession([ref]$h,0,$key);if($code -ne 0){throw "Restart Manager error $code"};try{[void][ToolHubRestartManager]::RmRegisterResources($h,1,@($env:TOOLHUB_FILE),0,[IntPtr]::Zero,0,$null);[uint32]$need=0;[uint32]$count=0;[uint32]$reason=0;$code=[ToolHubRestartManager]::RmGetList($h,[ref]$need,[ref]$count,$null,[ref]$reason);if($code -eq 234 -and $need){$items=New-Object 'ToolHubRestartManager+ProcessInfo[]' $need;$count=$need;$code=[ToolHubRestartManager]::RmGetList($h,[ref]$need,[ref]$count,$items,[ref]$reason);if($code -ne 0){throw "Restart Manager error $code"};$items|Select-Object -First $count|ForEach-Object{$p=Get-Process -Id $_.Pid -ErrorAction SilentlyContinue;[PSCustomObject]@{Pid=$_.Pid;Process=if($p){$p.ProcessName}else{'Unknown'}}}|ConvertTo-Json -Compress}elseif($code -eq 0){'[]'}else{throw "Restart Manager error $code"}}finally{[void][ToolHubRestartManager]::RmEndSession($h)}`;
  const result = await safe.powershellJson(script, { env: { TOOLHUB_FILE: file }, timeout: 30000 });
  if (!result.ok) safe.fail(result.error);
  return { path: file, processes: result.data || [] };
}

module.exports = { id: 'advanced-files', actions: { fileTypeScan, fixExtensions, syncPlan, syncApply, shred, archive, locking } };
