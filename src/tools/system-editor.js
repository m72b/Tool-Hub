const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');

function hostsPath() {
  const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
  return process.platform === 'win32'
    ? path.join(windowsRoot, 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts';
}

function backupDir(ctx) {
  const dir = path.join(ctx.userData, 'system-editor-backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupName(prefix, ext = 'json') {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.${ext}`;
}

async function get(params, ctx) {
  if (ctx.platform !== 'win32') return { supported: false, message: 'Hosts and user environment editing is currently available on Windows.' };
  let hosts = '';
  try { hosts = await fs.promises.readFile(hostsPath(), 'utf8'); } catch (err) { return { supported: true, error: `Could not read the hosts file: ${err.message}` }; }
  const result = await safe.powershellJson(
    "$key='HKCU:\\Environment';if(Test-Path $key){$item=Get-Item $key;$item.GetValueNames()|ForEach-Object{$n=$_;[PSCustomObject]@{Name=$n;Value=$item.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);Type=$item.GetValueKind($n).ToString()}}|ConvertTo-Json -Compress}",
    { timeout: 15000 }
  );
  return { supported: true, hosts, hostsPath: hostsPath(), variables: result.ok ? result.data : [], environmentError: result.ok ? null : result.error };
}

async function saveHosts(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('Only available on Windows');
  if (typeof params.content !== 'string' || params.content.length > 1024 * 1024) safe.fail('Hosts content must be under 1 MB');
  const target = hostsPath();
  const backup = path.join(backupDir(ctx), backupName('hosts', 'bak'));
  await fs.promises.copyFile(target, backup);
  const temp = path.join(path.dirname(target), `.hosts-toolhub-${process.pid}-${Date.now()}.tmp`);
  try {
    await fs.promises.writeFile(temp, params.content, 'utf8');
    await fs.promises.rename(temp, target);
  } catch (err) {
    try { await fs.promises.unlink(temp); } catch {}
    safe.fail(`Could not save hosts file (run Tool Hub as administrator if needed): ${err.message}`);
  }
  return { saved: true, backup };
}

function variableName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) safe.fail('Invalid environment variable name');
  return value;
}

async function previousValue(name) {
  const result = await safe.powershellJson(
    "$key='HKCU:\\Environment';$n=$env:TOOLHUB_NAME;if(Test-Path $key){$item=Get-Item $key;if($item.GetValueNames() -contains $n){[PSCustomObject]@{Exists=$true;Value=$item.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);Type=$item.GetValueKind($n).ToString()} }else{[PSCustomObject]@{Exists=$false;Value=$null;Type='REG_SZ'}}}",
    { env: { TOOLHUB_NAME: name }, timeout: 15000 }
  );
  if (!result.ok) safe.fail(result.error || 'Could not read the existing environment value');
  return result.data?.[0] || { Exists: false, Value: null, Type: 'REG_SZ' };
}

async function backupVariable(ctx, name, old) {
  const file = path.join(backupDir(ctx), backupName(`env-${name}`));
  await fs.promises.writeFile(file, JSON.stringify({ name, ...old, backedUpAt: new Date().toISOString() }, null, 2), 'utf8');
  return file;
}

async function saveEnv(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('Only available on Windows');
  const name = variableName(params.name);
  if (typeof params.value !== 'string' || params.value.length > 32767) safe.fail('Environment value is too long or invalid');
  const old = await previousValue(name);
  const backup = await backupVariable(ctx, name, old);
  const type = String(old.Type || '').toUpperCase() === 'REG_EXPAND_SZ' || name.toLowerCase() === 'path' ? 'REG_EXPAND_SZ' : 'REG_SZ';
  const res = await safe.run('reg.exe', ['add', 'HKCU\\Environment', '/v', name, '/t', type, '/d', params.value, '/f']);
  if (!res.ok) safe.fail(res.stderr.trim() || 'Could not save the environment variable');
  return { saved: true, name, backup };
}

async function removeEnv(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('Only available on Windows');
  const name = variableName(params.name);
  const old = await previousValue(name);
  if (!old.Exists) safe.fail('Environment variable does not exist');
  const backup = await backupVariable(ctx, name, old);
  const res = await safe.run('reg.exe', ['delete', 'HKCU\\Environment', '/v', name, '/f']);
  if (!res.ok) safe.fail(res.stderr.trim() || 'Could not remove the environment variable');
  return { saved: true, name, backup };
}

module.exports = { id: 'system-editor', actions: { get, saveHosts, saveEnv, removeEnv }, hostsPath };
