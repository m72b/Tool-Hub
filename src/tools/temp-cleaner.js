const fs = require('fs');
const os = require('os');
const path = require('path');
const safe = require('../core/safe');
const { dirSize } = require('../core/walk');

function candidates(platform) {
  const home = os.homedir();
  const list = [];
  const add = (id, label, dir, description) => {
    if (!dir) return;
    list.push({ id, label, path: path.resolve(dir), description });
  };
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const winDir = process.env.SystemRoot || 'C:\\Windows';
    add('user-temp', 'User temp', process.env.TEMP || process.env.TMP, 'Per-user temporary files');
    add('local-temp', 'Local AppData temp', local ? path.join(local, 'Temp') : null, 'Application scratch files');
    add('windows-temp', 'Windows temp', path.join(winDir, 'Temp'), 'System-wide temporary files');
    add('prefetch', 'Prefetch', path.join(winDir, 'Prefetch'), 'Windows app launch cache, rebuilt automatically');
    add('inet-cache', 'Internet cache', local ? path.join(local, 'Microsoft', 'Windows', 'INetCache') : null, 'Cached web content');
    add('crash-dumps', 'Crash dumps', local ? path.join(local, 'CrashDumps') : null, 'Application crash dump files');
  } else if (platform === 'darwin') {
    add('user-cache', 'User caches', path.join(home, 'Library', 'Caches'), 'Per-user application caches');
    add('system-temp', 'System temp', os.tmpdir(), 'Temporary files');
  } else {
    add('user-cache', 'User cache', path.join(home, '.cache'), 'Per-user application caches');
    add('system-temp', 'System temp', os.tmpdir(), 'Temporary files');
  }
  return list;
}

async function scan(params, ctx) {
  const targets = candidates(ctx.platform);
  const out = [];
  for (const target of targets) {
    let exists = false;
    try {
      exists = fs.statSync(target.path).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      out.push({ ...target, available: false, size: 0, count: 0 });
      continue;
    }
    const info = dirSize(target.path, { limit: 60000 });
    out.push({ ...target, available: true, size: info.size, count: info.count, truncated: info.truncated });
  }
  return {
    targets: out,
    totalSize: out.reduce((s, t) => s + t.size, 0),
    totalCount: out.reduce((s, t) => s + t.count, 0),
  };
}

async function clean(params, ctx) {
  const requested = Array.isArray(params.ids) ? params.ids : [];
  if (requested.length === 0) safe.fail('No categories selected');
  const permanent = params.permanent === true;
  const targets = candidates(ctx.platform).filter(t => requested.includes(t.id));
  if (targets.length === 0) safe.fail('No valid categories selected');

  let removed = 0;
  let freed = 0;
  const skipped = [];

  for (const target of targets) {
    let entries;
    try {
      entries = fs.readdirSync(target.path, { withFileTypes: true });
    } catch (err) {
      skipped.push({ path: target.path, error: err.message });
      continue;
    }
    for (const entry of entries) {
      const full = path.join(target.path, entry.name);
      if (!safe.safeEntryName(entry.name)) continue;
      let inside;
      try {
        inside = safe.assertInside(target.path, full);
      } catch {
        continue;
      }
      let size = 0;
      try {
        const st = fs.lstatSync(inside);
        size = st.isDirectory() ? dirSize(inside, { limit: 20000 }).size : st.size;
      } catch {
        size = 0;
      }
      try {
        if (permanent) fs.rmSync(inside, { recursive: true, force: true });
        else await ctx.trash(inside);
        removed++;
        freed += size;
      } catch (err) {
        skipped.push({ path: inside, error: err.message });
      }
    }
  }
  return { removed, freed, skipped: skipped.slice(0, 50), skippedCount: skipped.length };
}

module.exports = { id: 'temp-cleaner', actions: { scan, clean }, candidates };
