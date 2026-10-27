const fs = require('fs');
const path = require('path');

const DEFAULT_LIMIT = 300000;

function shouldSkipDir(name) {
  return name === '$RECYCLE.BIN'
    || name === 'System Volume Information'
    || name === '.git'
    || name === 'node_modules';
}

function skipDir(name, options) {
  if (options.skipDirs && options.skipDirs.includes(name)) return true;
  if (name === '$RECYCLE.BIN' || name === 'System Volume Information') return true;
  return options.skipCommonDirs !== false && (name === '.git' || name === 'node_modules');
}

function walkFiles(root, options = {}) {
  const {
    recursive = true,
    maxDepth = Infinity,
    limit = DEFAULT_LIMIT,
    followSymlinks = false,
    skipHidden = false,
    includeDirs = false,
    onError = null,
    filter = null,
    skipCommonDirs = true,
    skipDirs = null,
  } = options;

  const results = [];
  const seenDirs = new Set();
  let truncated = false;
  let scanned = 0;

  const stack = [{ dir: path.resolve(root), depth: 0 }];

  while (stack.length > 0) {
    if (results.length >= limit) {
      truncated = true;
      break;
    }
    const { dir, depth } = stack.pop();
    let key;
    try {
      key = followSymlinks ? fs.realpathSync.native(dir) : dir;
    } catch {
      key = dir;
    }
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (onError) onError({ path: dir, message: err.message });
      continue;
    }

    for (const entry of entries) {
      if (results.length >= limit) {
        truncated = true;
        break;
      }
      const full = path.join(dir, entry.name);
      if (skipHidden && entry.name.startsWith('.')) continue;

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        if (!followSymlinks) continue;
        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }

      if (isDir) {
        if (skipDir(entry.name, { skipCommonDirs, skipDirs })) continue;
        if (includeDirs) results.push({ path: full, name: entry.name, isDir: true, size: 0, mtime: 0 });
        if (recursive && depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }

      if (!isFile) continue;
      scanned++;

      let stat;
      try {
        stat = fs.statSync(full);
      } catch (err) {
        if (onError) onError({ path: full, message: err.message });
        continue;
      }

      const record = {
        path: full,
        name: entry.name,
        dir,
        ext: path.extname(entry.name).slice(1).toLowerCase(),
        size: stat.size,
        mtime: stat.mtimeMs,
        birthtime: stat.birthtimeMs,
        isDir: false,
      };
      if (filter && !filter(record)) continue;
      results.push(record);
    }
  }

  return { files: results, truncated, scanned };
}

function dirSize(root, options = {}) {
  const { limit = DEFAULT_LIMIT, skipCommonDirs = true, skipDirs = null } = options;
  let total = 0;
  let count = 0;
  const seen = new Set();
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= limit) return { size: total, count, truncated: true };
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDir(entry.name, { skipCommonDirs, skipDirs })) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += fs.statSync(full).size;
        count++;
      } catch {
        continue;
      }
    }
  }
  return { size: total, count, truncated: false };
}

async function walkFilesAsync(root, options = {}) {
  const {
    recursive = true, maxDepth = Infinity, limit = DEFAULT_LIMIT,
    followSymlinks = false, skipHidden = false, includeDirs = false,
    onError = null, filter = null, skipCommonDirs = true, skipDirs = null, excludeDirs = null, signal = null, onProgress = null,
  } = options;
  const results = [];
  const seenDirs = new Set();
  const stack = [{ dir: path.resolve(root), depth: 0 }];
  let truncated = false;
  let scanned = 0;
  let visitedDirs = 0;
  while (stack.length > 0) {
    if (signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
    if (results.length >= limit) { truncated = true; break; }
    const { dir, depth } = stack.pop();
    let key = dir;
    if (followSymlinks) { try { key = await fs.promises.realpath(dir); } catch {} }
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);
    visitedDirs++;
    if (onProgress && (visitedDirs === 1 || visitedDirs % 8 === 0)) onProgress({ scanned, directories: visitedDirs, found: results.length });
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (err) { if (onError) onError({ path: dir, message: err.message }); continue; }
    for (const entry of entries) {
      if (results.length >= limit) { truncated = true; break; }
      if (skipHidden && entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        if (!followSymlinks) continue;
        try { const st = await fs.promises.stat(full); isDir = st.isDirectory(); isFile = st.isFile(); }
        catch { continue; }
      }
      if (isDir) {
        if (skipDir(entry.name, { skipCommonDirs, skipDirs })) continue;
        if (excludeDirs?.some(excluded => path.resolve(excluded) === path.resolve(full))) continue;
        if (includeDirs) results.push({ path: full, name: entry.name, isDir: true, size: 0, mtime: 0 });
        if (recursive && depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!isFile) continue;
      scanned++;
      if (signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
      if (onProgress && scanned % 250 === 0) onProgress({ scanned, directories: visitedDirs, found: results.length });
      let stat;
      try { stat = await fs.promises.stat(full); }
      catch (err) { if (onError) onError({ path: full, message: err.message }); continue; }
      const record = { path: full, name: entry.name, dir, ext: path.extname(entry.name).slice(1).toLowerCase(), size: stat.size, mtime: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, atimeMs: stat.atimeMs, isDir: false };
      if (!filter || filter(record)) results.push(record);
    }
  }
  if (onProgress) onProgress({ scanned, directories: visitedDirs, found: results.length, done: true });
  return { files: results, truncated, scanned };
}

async function dirSizeAsync(root, options = {}) {
  const { limit = DEFAULT_LIMIT, skipCommonDirs = true, skipDirs = null, signal = null, onProgress = null } = options;
  let total = 0, count = 0;
  const stack = [path.resolve(root)];
  const seen = new Set();
  while (stack.length) {
    if (signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (count >= limit) return { size: total, count, truncated: true };
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!skipDir(entry.name, { skipCommonDirs, skipDirs })) stack.push(full); continue; }
      if (!entry.isFile()) continue;
      try { total += (await fs.promises.stat(full)).size; count++; if (onProgress && count % 250 === 0) onProgress({ scanned: count, directories: seen.size }); } catch {}
    }
  }
  if (onProgress) onProgress({ scanned: count, directories: seen.size, done: true });
  return { size: total, count, truncated: false };
}

module.exports = { walkFiles, walkFilesAsync, dirSize, dirSizeAsync, shouldSkipDir };
