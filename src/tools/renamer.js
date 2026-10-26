const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');
const { parseFile } = require('music-metadata');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus']);

async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      result[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

async function fileInfoWithTags(filePath) {
  const info = await fileInfo(filePath);
  if (!AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return info;
  try {
    const { common } = await parseFile(filePath, { duration: false });
    info.tags = {
      TrackNumber: common.track?.no == null ? '' : String(common.track.no).padStart(2, '0'),
      TrackName: common.title || '',
      Artist: common.artist || common.artists?.join(', ') || '',
      Album: common.album || '',
      Year: common.year == null ? '' : String(common.year),
    };
  } catch {
    info.tags = {};
  }
  return info;
}

async function fileInfo(filePath) {
  const stat = await fs.promises.stat(filePath);
  return {
    name: path.basename(filePath),
    ext: path.extname(filePath).slice(1).toLowerCase(),
    size: stat.size,
    mtime: stat.mtimeMs,
    dir: path.dirname(filePath),
    path: filePath,
  };
}

async function readFolder(params) {
  const folder = safe.existingDir(params.folder);
  if (params.recursive === true) {
    const res = await walkFilesAsync(folder, { recursive: true, limit: 5000 });
    return { folder, truncated: res.truncated, files: await mapLimit(res.files, 8, async file => ({ ...await fileInfoWithTags(file.path), relativePath: path.relative(folder, file.path) })) };
  }
  const files = (await fs.promises.readdir(folder, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => path.join(folder, entry.name));
  return {
    folder,
    files: await mapLimit(files, 8, async file => ({ ...await fileInfoWithTags(file), relativePath: path.basename(file) })),
  };
}

function resolveRename(folder, item) {
  const { oldName, newName } = item;
  if (!safe.safeEntryName(newName)) safe.fail('Invalid filename');
  const relativePath = typeof item.relativePath === 'string' ? item.relativePath : oldName;
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) safe.fail('Invalid file path');
  const source = safe.assertInside(folder, path.resolve(folder, relativePath));
  const target = safe.assertInside(folder, path.join(path.dirname(source), newName));
  if (!fs.existsSync(source)) safe.fail('Source file not found');
  if (!fs.statSync(source).isFile()) safe.fail('Source path is not a file');
  return { item, source, target };
}

async function rename(params) {
  const folder = safe.existingDir(params.folder);
  const { item, source, target } = resolveRename(folder, params);
  const samePath = source.toLowerCase() === target.toLowerCase();
  if (!samePath && fs.existsSync(target)) safe.fail('A file with that name already exists');
  if (source !== target && samePath) {
    const temp = path.join(path.dirname(source), `.toolhub-rename-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.renameSync(source, temp);
    try { fs.renameSync(temp, target); } catch (err) { fs.renameSync(temp, source); throw err; }
  } else {
    fs.renameSync(source, target);
  }
  return { ok: true, from: item.oldName, to: item.newName };
}

async function renameBatch(params) {
  const folder = safe.existingDir(params.folder);
  if (!Array.isArray(params.items) || params.items.length > 5000) safe.fail('Invalid rename batch');
  const plan = params.items.map(item => resolveRename(folder, item));
  const sources = new Set(plan.map(p => p.source.toLowerCase()));
  const targets = new Set();
  for (const entry of plan) {
    const key = entry.target.toLowerCase();
    if (targets.has(key)) safe.fail('Multiple files cannot be renamed to the same name');
    targets.add(key);
    if (fs.existsSync(entry.target) && !sources.has(key)) safe.fail(`A file with the name "${path.basename(entry.target)}" already exists`);
  }
  const changed = plan.filter(p => p.source !== p.target);
  const staged = [];
  try {
    for (const entry of changed) {
      const temp = path.join(path.dirname(entry.source), `.toolhub-rename-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.renameSync(entry.source, temp);
      staged.push({ ...entry, temp });
    }
    for (const entry of staged) fs.renameSync(entry.temp, entry.target);
  } catch (err) {
    for (const entry of [...staged].reverse()) {
      const current = fs.existsSync(entry.temp) ? entry.temp : (fs.existsSync(entry.target) ? entry.target : null);
      if (current) {
        try { fs.renameSync(current, entry.source); } catch {}
      }
    }
    safe.fail(`Batch rename failed and was rolled back: ${err.message}`);
  }
  const changedSources = new Set(changed.map(p => p.source));
  return { results: plan.map(p => ({ ok: true, from: p.item.oldName, to: p.item.newName })), renamed: changedSources.size };
}

async function musicbrainz(params) {
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (query.length === 0) safe.fail('Search query is required');
  if (query.length > 300) safe.fail('Search query is too long');
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=8`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'm72b-toolhub/3.0 (https://github.com/m72b/m72b-File-Formatter)' },
    });
    if (!response.ok) safe.fail(`MusicBrainz returned ${response.status}`);
    return { ok: true, data: await response.json() };
  } catch (err) {
    if (err.name === 'AbortError') safe.fail('MusicBrainz request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { id: 'renamer', actions: { readFolder, rename, renameBatch, musicbrainz }, fileInfo, fileInfoWithTags };
