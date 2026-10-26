const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const { walkFilesAsync } = require('../core/walk');
const { parseFile } = require('music-metadata');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg']);

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
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) try {
    const { common, format } = await parseFile(filePath, { duration: true });
    info.tags = {
      TrackNumber: common.track?.no == null ? '' : String(common.track.no).padStart(2, '0'),
      TrackName: common.title || '',
      Artist: common.artist || common.artists?.join(', ') || '',
      Album: common.album || '',
      Year: common.year == null ? '' : String(common.year),
      Duration: Number.isFinite(format.duration) ? format.duration.toFixed(2) : '',
    };
  } catch {
    info.tags = {};
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const date = await readExifDate(filePath);
      if (date) {
        const pad = value => String(value).padStart(2, '0');
        info.tags = { ...(info.tags || {}), DateTaken: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, Year: String(date.getFullYear()) };
      }
    } catch {}
  }
  return info;
}

async function readExifDate(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const buffer = Buffer.alloc(Math.min(stat.size, 2 * 1024 * 1024));
    await handle.read(buffer, 0, buffer.length, 0);
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 4 < buffer.length && buffer[offset] === 0xff) {
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2 || offset + 2 + size > buffer.length) break;
      if (marker === 0xe1 && buffer.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') {
        const tiff = offset + 10;
        const little = buffer.toString('ascii', tiff, tiff + 2) === 'II';
        const u16 = pos => little ? buffer.readUInt16LE(pos) : buffer.readUInt16BE(pos);
        const u32 = pos => little ? buffer.readUInt32LE(pos) : buffer.readUInt32BE(pos);
        const firstIfd = tiff + u32(tiff + 4);
        const count = Math.min(u16(firstIfd), 512);
        let exifIfd = null, dateText = '';
        const readIfd = pos => {
          const entries = Math.min(u16(pos), 512);
          for (let i = 0; i < entries; i++) {
            const entry = pos + 2 + i * 12;
            const tag = u16(entry), type = u16(entry + 2), n = u32(entry + 4);
            if (tag === 0x8769) exifIfd = tiff + u32(entry + 8);
            if ((tag === 0x9003 || tag === 0x0132) && type === 2 && n > 0 && n < 64) {
              const data = n <= 4 ? entry + 8 : tiff + u32(entry + 8);
              dateText = buffer.toString('ascii', data, data + n).replace(/\0.*$/, '');
            }
          }
        };
        if (firstIfd + 2 + count * 12 < buffer.length) readIfd(firstIfd);
        if (exifIfd && exifIfd + 2 < buffer.length) readIfd(exifIfd);
        const m = dateText.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
        if (m) { const date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); if (!Number.isNaN(date.getTime())) return date; }
      }
      offset += 2 + size;
    }
  } finally { await handle.close(); }
  return null;
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

module.exports = { id: 'renamer', actions: { readFolder, rename, renameBatch, musicbrainz }, fileInfo, fileInfoWithTags, readExifDate };
