const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const { walkFiles } = require('../core/walk');

const READ_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
const WRITE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
};
const MAX_READ = 64 * 1024 * 1024;

async function listImages(params) {
  const folder = safe.existingDir(params.folder);
  const recursive = params.recursive === true;
  const res = walkFiles(folder, {
    recursive,
    limit: 5000,
    filter: f => READ_EXT.includes(f.ext),
  });
  return {
    folder,
    files: res.files.map(f => ({ path: f.path, name: f.name, ext: f.ext, size: f.size })),
    truncated: res.truncated,
  };
}

async function read(params) {
  const file = safe.existingFile(params.path);
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!READ_EXT.includes(ext)) safe.fail('Unsupported image type');
  const stat = fs.statSync(file);
  if (stat.size > MAX_READ) safe.fail('Image is too large to process');
  const data = fs.readFileSync(file);
  return {
    path: file,
    name: path.basename(file),
    ext,
    size: stat.size,
    dataUrl: `data:${MIME_BY_EXT[ext] || 'application/octet-stream'};base64,${data.toString('base64')}`,
  };
}

async function write(params) {
  const dir = safe.existingDir(params.dir);
  const name = params.name;
  if (!safe.safeEntryName(name)) safe.fail('Invalid output file name');
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!WRITE_MIME[ext]) safe.fail('Unsupported output format');
  const target = safe.assertInside(dir, path.join(dir, name));
  if (!params.overwrite && fs.existsSync(target)) safe.fail('A file with that name already exists');

  const dataUrl = typeof params.dataUrl === 'string' ? params.dataUrl : '';
  const match = dataUrl.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) safe.fail('Invalid image data');
  if (match[1].toLowerCase() !== WRITE_MIME[ext]) safe.fail('Image data does not match the output format');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) safe.fail('Image data is empty');
  if (buffer.length > MAX_READ) safe.fail('Encoded image is too large');
  fs.writeFileSync(target, buffer);
  return { path: target, name, size: buffer.length };
}

module.exports = { listImages, read, write, READ_EXT, WRITE_MIME, MIME_BY_EXT };
