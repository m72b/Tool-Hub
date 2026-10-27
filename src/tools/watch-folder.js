const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const organizer = require('./organizer');

const watchers = new Map();

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

async function start(params) {
  const folder = safe.existingDir(params.folder);
  const rules = Array.isArray(params.rules) ? params.rules.filter(rule => rule && typeof rule.dest === 'string' && rule.dest) : [];
  if (!rules.length) safe.fail('Save at least one Organizer rule with a destination first');
  const key = process.platform === 'win32' ? folder.toLowerCase() : folder;
  if (watchers.has(key)) return { watching: true, folder };
  let timer = null, busy = false, moved = 0, closed = false;
  const scanAndOrganize = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const scan = await organizer.actions.readFolder({ folder, recursive: true });
      for (const file of scan.files) {
        const rule = rules.find(candidate => matches(candidate, file));
        if (!rule) continue;
        const date = file.tags?.DateTaken || '';
        const destination = rule.dest.replace(/\{year\}/gi, date.slice(0, 4) || new Date(file.mtime).getFullYear()).replace(/\{month\}/gi, date.slice(5, 7) || String(new Date(file.mtime).getMonth() + 1).padStart(2, '0'));
        const result = await organizer.actions.move({ folder, relativePath: file.relativePath, fileName: file.name, destFolder: destination });
        if (result.ok) moved++;
      }
    } catch {}
    finally { busy = false; }
  };
  const watcher = fs.watch(folder, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(scanAndOrganize, 900);
  });
  watcher.on('error', () => stop({ folder }));
  watchers.set(key, { watcher, stop: () => { closed = true; if (timer) clearTimeout(timer); watcher.close(); watchers.delete(key); } });
  await scanAndOrganize();
  return { watching: true, folder, moved, mode: 'filesystem watch with debounce' };
}

function stop(params) {
  const folder = path.resolve(String(params.folder || ''));
  const key = process.platform === 'win32' ? folder.toLowerCase() : folder;
  const item = watchers.get(key);
  if (item) item.stop();
  return { watching: false, folder };
}

module.exports = { id: 'watch-folder', actions: { start, stop } };
