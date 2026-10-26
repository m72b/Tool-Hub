const { spawn } = require('child_process');
const fs = require('fs');
const safe = require('../core/safe');

const cache = new Map();

function parseUninstallCommand(command) {
  const raw = String(command || '').trim();
  const unquotedExe = /^(.+?\.(?:exe|com|bat|cmd))(?=\s|$)(?:\s+(.*))?$/i.exec(raw);
  if (unquotedExe && fs.existsSync(unquotedExe[1])) {
    const tail = safe.parseCommandLine(unquotedExe[2] || '');
    return { command: unquotedExe[1], args: tail ? [tail.command, ...tail.args] : [] };
  }
  return safe.parseCommandLine(raw);
}

const QUERY = [
  '$keys=@(',
  "'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
  ');',
  'Get-ItemProperty -Path $keys |',
  'Where-Object { $_.DisplayName -and -not $_.SystemComponent } |',
  'Select-Object @{n="Key";e={$_.PSChildName}},DisplayName,DisplayVersion,Publisher,EstimatedSize,InstallLocation,InstallDate,UninstallString,QuietUninstallString |',
  'ConvertTo-Json -Compress -Depth 2',
].join('');

async function list(params, ctx) {
  if (ctx.platform !== 'win32') {
    return { supported: false, apps: [], message: 'Installed Apps Manager is only available on Windows.' };
  }
  const res = await safe.powershellJson(QUERY, { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (!res.ok) return { supported: true, apps: [], error: res.error || 'Could not read the installed programs list.' };

  cache.clear();
  const apps = [];
  for (const raw of res.data || []) {
    const key = String(raw.Key || '');
    const name = String(raw.DisplayName || '').trim();
    if (!key || !name) continue;
    const uninstall = String(raw.QuietUninstallString || raw.UninstallString || '').trim();
    cache.set(key, uninstall);
    apps.push({
      key,
      name,
      version: raw.DisplayVersion ? String(raw.DisplayVersion) : '',
      publisher: raw.Publisher ? String(raw.Publisher) : '',
      size: Number(raw.EstimatedSize) > 0 ? Number(raw.EstimatedSize) * 1024 : 0,
      location: raw.InstallLocation ? String(raw.InstallLocation) : '',
      installDate: raw.InstallDate ? String(raw.InstallDate) : '',
      canUninstall: uninstall.length > 0,
    });
  }
  apps.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  return { supported: true, apps, total: apps.length };
}

async function uninstall(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('Only available on Windows');
  const key = typeof params.key === 'string' ? params.key : '';
  if (!cache.has(key)) safe.fail('Refresh the application list before uninstalling');
  const command = cache.get(key);
  if (!command) safe.fail('This application does not provide an uninstaller');
  const parsed = parseUninstallCommand(command);
  if (!parsed) safe.fail('Could not read the uninstall command');
  try {
    const child = spawn(parsed.command, parsed.args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    child.unref();
  } catch (err) {
    safe.fail(`Could not start the uninstaller: ${err.message}`);
  }
  return { started: true, name: key };
}

module.exports = { id: 'apps-manager', actions: { list, uninstall }, cache, parseUninstallCommand };
