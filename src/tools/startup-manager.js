const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');

const cache = new Map();

const RUN_KEYS = [
  { hive: 'HKCU', reg: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', cli: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', scope: 'Current user' },
  { hive: 'HKLM', reg: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', cli: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', scope: 'All users' },
];

const VALUE_NAME = /^[A-Za-z0-9 ._\-()+&']{1,255}$/;

function startupFolders() {
  const appData = process.env.APPDATA;
  const programData = process.env.ProgramData;
  const out = [];
  if (appData) out.push({ dir: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), scope: 'Current user' });
  if (programData) out.push({ dir: path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), scope: 'All users' });
  return out;
}

function disabledDir(dir) {
  return path.join(dir, 'Disabled by Toolhub');
}

async function list(params, ctx) {
  if (ctx.platform !== 'win32') {
    return { supported: false, entries: [], message: 'Startup Manager is only available on Windows.' };
  }
  cache.clear();
  const entries = [];

  for (const key of RUN_KEYS) {
    const res = await safe.powershellJson(
      `$p='${key.reg}';if(Test-Path $p){$i=Get-Item $p;$i.GetValueNames()|Where-Object{$_}|ForEach-Object{[PSCustomObject]@{N=$_;V=$i.GetValue($_)}}|ConvertTo-Json -Compress}`,
      { timeout: 20000 }
    );
    if (!res.ok || !res.data) continue;
    for (const item of res.data) {
      const name = String(item.N || '');
      if (!name) continue;
      const id = `reg:${key.hive}:${name}`;
      cache.set(id, { type: 'registry', key, name, command: String(item.V || '') });
      entries.push({ id, name, command: String(item.V || ''), scope: key.scope, source: `Registry (${key.hive})`, enabled: true, canToggle: true });
    }
  }

  const backup = readBackup(ctx);
  for (const key of RUN_KEYS) {
    for (const [id, command] of Object.entries(backup)) {
      const prefix = `reg:${key.hive}:`;
      if (!id.startsWith(prefix) || cache.has(id)) continue;
      const name = id.slice(prefix.length);
      if (!name) continue;
      cache.set(id, { type: 'registry', key, name, command: String(command || '') });
      entries.push({ id, name, command: String(command || ''), scope: key.scope, source: `Registry (${key.hive})`, enabled: false, canToggle: true });
    }
  }

  for (const folder of startupFolders()) {
    for (const enabled of [true, false]) {
      const dir = enabled ? folder.dir : disabledDir(folder.dir);
      let files;
      try {
        files = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of files) {
        if (!entry.isFile()) continue;
        const full = path.join(dir, entry.name);
        const id = `file:${folder.scope}:${entry.name}`;
        cache.set(id, { type: 'file', folder, name: entry.name, enabled });
        entries.push({ id, name: entry.name, command: full, scope: folder.scope, source: 'Startup folder', enabled, canToggle: true });
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { supported: true, entries, total: entries.length };
}

function backupFile(ctx) {
  return path.join(ctx.userData, 'startup-backup.json');
}

function readBackup(ctx) {
  try {
    return JSON.parse(fs.readFileSync(backupFile(ctx), 'utf8'));
  } catch {
    return {};
  }
}

function writeBackup(ctx, data) {
  try {
    fs.mkdirSync(ctx.userData, { recursive: true });
    fs.writeFileSync(backupFile(ctx), JSON.stringify(data, null, 2), 'utf8');
  } catch {
    return false;
  }
  return true;
}

async function setEnabled(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('Only available on Windows');
  const id = typeof params.id === 'string' ? params.id : '';
  const enable = params.enabled === true;
  const item = cache.get(id);
  if (!item) safe.fail('Refresh the startup list first');

  if (item.type === 'registry') {
    if (!VALUE_NAME.test(item.name)) safe.fail('Unsupported registry value name');
    const backup = readBackup(ctx);
    if (enable) {
      const saved = backup[id];
      if (!saved) safe.fail('No saved entry to restore');
      const res = await safe.run('reg.exe', ['add', item.key.cli, '/v', item.name, '/t', 'REG_SZ', '/d', saved, '/f']);
      if (!res.ok) safe.fail(res.stderr.trim() || 'Could not restore this entry (administrator rights may be required)');
      delete backup[id];
      writeBackup(ctx, backup);
    } else {
      backup[id] = item.command;
      writeBackup(ctx, backup);
      const res = await safe.run('reg.exe', ['delete', item.key.cli, '/v', item.name, '/f']);
      if (!res.ok) safe.fail(res.stderr.trim() || 'Could not disable this entry (administrator rights may be required)');
    }
    return { id, enabled: enable };
  }

  if (!safe.safeEntryName(item.name)) safe.fail('Unsupported startup file name');
  const active = path.join(item.folder.dir, item.name);
  const parked = path.join(disabledDir(item.folder.dir), item.name);
  try {
    if (enable) {
      safe.assertInside(item.folder.dir, parked);
      fs.mkdirSync(item.folder.dir, { recursive: true });
      fs.renameSync(parked, active);
    } else {
      safe.assertInside(item.folder.dir, active);
      fs.mkdirSync(disabledDir(item.folder.dir), { recursive: true });
      fs.renameSync(active, parked);
    }
  } catch (err) {
    safe.fail(`Could not update this entry: ${err.message}`);
  }
  return { id, enabled: enable };
}

module.exports = { id: 'startup-manager', actions: { list, setEnabled }, cache, startupFolders, disabledDir };
