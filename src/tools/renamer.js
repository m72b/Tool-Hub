const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const { walkFiles } = require('../core/walk');

function fileInfo(filePath) {
  const stat = fs.statSync(filePath);
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
    const res = walkFiles(folder, { recursive: true, limit: 5000 });
    return { folder, files: res.files.map(file => ({ ...fileInfo(file.path), relativePath: path.relative(folder, file.path) })) };
  }
  return {
    folder,
    files: fs.readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => ({ ...fileInfo(path.join(folder, entry.name)), relativePath: entry.name })),
  };
}

async function rename(params) {
  const folder = safe.existingDir(params.folder);
  const { oldName, newName } = params;
  if (!safe.safeEntryName(newName)) safe.fail('Invalid filename');
  const relativePath = typeof params.relativePath === 'string' ? params.relativePath : oldName;
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) safe.fail('Invalid file path');
  const source = safe.assertInside(folder, path.resolve(folder, relativePath));
  const target = safe.assertInside(folder, path.join(path.dirname(source), newName));
  if (!fs.existsSync(source)) safe.fail('Source file not found');
  if (!fs.statSync(source).isFile()) safe.fail('Source path is not a file');
  if (source !== target && fs.existsSync(target)) safe.fail('A file with that name already exists');
  fs.renameSync(source, target);
  return { ok: true, from: oldName, to: newName };
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

module.exports = { id: 'renamer', actions: { readFolder, rename, musicbrainz }, fileInfo };
