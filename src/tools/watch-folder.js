const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const organizer = require('./organizer');

const watchers = new Map();
const TEMPORARY_SUFFIX = /\.(?:crdownload|part|download|partial|tmp)$/i;
const STABLE_FOR_MS = 3000;

function keyFor(folder) { return process.platform === 'win32' ? folder.toLowerCase() : folder; }

function matches(rule, file) {
  if (rule.type === 'date' || rule.type === 'exifDate') {
    const year = rule.type === 'exifDate' ? Number(file.tags?.DateTaken?.slice(0, 4)) : new Date(file.mtime).getFullYear();
    return Number.isFinite(year) && (!!rule.dateFrom || !!rule.dateTo) && (!rule.dateFrom || year >= Number(rule.dateFrom)) && (!rule.dateTo || year <= Number(rule.dateTo));
  }
  if (rule.type === 'size') return (!!rule.sizeMin || !!rule.sizeMax) && (!rule.sizeMin || file.size >= Number(rule.sizeMin) * ({ KB: 1024, MB: 1048576, GB: 1073741824 }[rule.sizeMinUnit] || 1048576)) && (!rule.sizeMax || file.size <= Number(rule.sizeMax) * ({ KB: 1024, MB: 1048576, GB: 1073741824 }[rule.sizeMaxUnit] || 1048576));
  const pattern = String(rule.match || '').trim();
  if (!pattern) return false;
  const glob = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(pattern.includes('*') || pattern.includes('?') ? `^${glob}$` : glob, 'i').test(file.name);
}

function destinationFor(rule, file) {
  const date = file.tags?.DateTaken || '';
  const destination = rule.dest.replace(/\{year\}/gi, date.slice(0, 4) || new Date(file.mtime).getFullYear()).replace(/\{month\}/gi, date.slice(5, 7) || String(new Date(file.mtime).getMonth() + 1).padStart(2, '0'));
  if (!destination || path.isAbsolute(destination) || destination.includes('\0') || destination.split(/[\\/]/).some(part => !safe.safeEntryName(part))) return null;
  return destination;
}

function addLog(state, message) {
  state.log.unshift({ at: new Date().toISOString(), message: String(message).slice(0, 300) });
  state.log.length = Math.min(state.log.length, 20);
}

function publicStatus(state) {
  return {
    watching: !!state?.running,
    folder: state?.folder || '',
    moved: state?.moved || 0,
    waiting: state?.stability.size || 0,
    lastError: state?.lastError || null,
    log: state?.log || [],
  };
}

function stopState(state) {
  state.running = false;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (state.watcher) state.watcher.close();
  state.watcher = null;
  state.busy = false;
}

async function start(params) {
  const folder = safe.existingDir(params.folder);
  const rules = Array.isArray(params.rules) ? params.rules.filter(rule => rule && typeof rule.dest === 'string' && destinationFor(rule, { mtime: Date.now() })) : [];
  if (!rules.length) safe.fail('Save at least one Organizer rule with a valid destination first');
  const key = keyFor(folder);
  if (watchers.get(key)?.running) return publicStatus(watchers.get(key));

  const state = { folder, rules, running: true, moved: 0, stability: new Map(), destinations: new Set(), log: [], lastError: null, timer: null, watcher: null, busy: false };
  for (const rule of rules) if (!/\{(?:year|month)\}/i.test(rule.dest)) state.destinations.add(path.resolve(folder, rule.dest));
  watchers.set(key, state);
  addLog(state, 'Watcher started; files must stay unchanged for 3 seconds before moving.');

  const schedule = delay => {
    if (!state.running) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(scanAndOrganize, delay);
  };

  const scanAndOrganize = async () => {
    state.timer = null;
    if (!state.running) return;
    if (state.busy) { schedule(300); return; }
    state.busy = true;
    let needsAnotherStabilityCheck = false;
    try {
      const scan = await organizer.actions.readFolder({ folder, recursive: true, excludeDirs: [...state.destinations] });
      state.lastError = null;
      const visible = new Set();
      for (const file of scan.files) {
        visible.add(file.path);
        if (TEMPORARY_SUFFIX.test(file.name)) continue;
        const rule = rules.find(candidate => matches(candidate, file));
        if (!rule) continue;
        const destination = destinationFor(rule, file);
        if (!destination) { addLog(state, `Skipped unsafe destination rule for ${file.name}`); continue; }
        const targetDir = path.resolve(folder, destination);
        if (state.destinations.has(targetDir) && safe.isInside(targetDir, file.path)) continue;
        if (safe.isInside(targetDir, file.path)) continue;

        const previous = state.stability.get(file.path);
        if (!previous || previous.size !== file.size || previous.mtime !== file.mtime) {
          state.stability.set(file.path, { size: file.size, mtime: file.mtime, unchangedSince: Date.now() });
          needsAnotherStabilityCheck = true;
          continue;
        }
        if (Date.now() - previous.unchangedSince < STABLE_FOR_MS) { needsAnotherStabilityCheck = true; continue; }

        try {
          await organizer.actions.move({ folder, relativePath: file.relativePath, fileName: file.name, destFolder: destination });
          state.moved++;
          state.stability.delete(file.path);
          state.destinations.add(targetDir);
          addLog(state, `Moved ${file.relativePath} → ${path.join(destination, file.name)}`);
        } catch (err) {
          state.stability.delete(file.path);
          state.lastError = err.message;
          addLog(state, `Could not move ${file.relativePath}: ${err.message}`);
        }
      }
      for (const filePath of state.stability.keys()) if (!visible.has(filePath)) state.stability.delete(filePath);
    } catch (err) {
      state.lastError = err.message;
      addLog(state, `Scan failed: ${err.message}`);
    } finally {
      state.busy = false;
      if (needsAnotherStabilityCheck) schedule(1000);
    }
  };

  try {
    state.watcher = fs.watch(folder, { recursive: true }, () => schedule(900));
    state.watcher.on('error', err => {
      state.lastError = err.message;
      addLog(state, `Filesystem watcher error: ${err.message}`);
      stopState(state);
    });
  } catch (err) {
    state.running = false;
    state.lastError = err.message;
    addLog(state, `Could not watch this folder: ${err.message}`);
    safe.fail(`Could not watch this folder: ${err.message}`);
  }
  await scanAndOrganize();
  return publicStatus(state);
}

function stop(params) {
  const folder = path.resolve(String(params.folder || ''));
  const state = watchers.get(keyFor(folder));
  if (state?.running) {
    stopState(state);
    addLog(state, 'Watcher stopped.');
  }
  return publicStatus(state);
}

function status(params) {
  const folder = path.resolve(String(params.folder || ''));
  return publicStatus(watchers.get(keyFor(folder)));
}

module.exports = { id: 'watch-folder', actions: { start, stop, status } };
