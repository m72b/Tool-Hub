const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const renamer = require('./renamer');

async function readFolder(params) {
  return renamer.actions.readFolder(params);
}

async function move(params) {
  const folder = safe.existingDir(params.folder);
  const { fileName, destFolder } = params;
  if (!safe.safeEntryName(fileName)) safe.fail('Invalid file name');
  if (!safe.safeEntryName(destFolder)) safe.fail('Invalid destination folder name');
  const relativePath = typeof params.relativePath === 'string' ? params.relativePath : fileName;
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) safe.fail('Invalid file path');
  const source = safe.assertInside(folder, path.resolve(folder, relativePath));
  const destinationDir = safe.assertInside(folder, path.join(folder, destFolder));
  if (!fs.existsSync(source)) safe.fail('Source file not found');
  if (!fs.statSync(source).isFile()) safe.fail('Source path is not a file');
  fs.mkdirSync(destinationDir, { recursive: true });
  const target = safe.assertInside(folder, path.join(destinationDir, fileName));
  if (fs.existsSync(target)) safe.fail('Destination file already exists');
  fs.renameSync(source, target);
  return { ok: true, from: relativePath, to: path.relative(folder, path.join(destinationDir, fileName)) };
}

async function reverseMove(params) {
  const folder = safe.existingDir(params.folder);
  const { fromPath, toPath } = params;
  for (const value of [fromPath, toPath]) {
    if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\0')) safe.fail('Invalid file path');
  }
  const source = safe.assertInside(folder, path.resolve(folder, fromPath));
  const target = safe.assertInside(folder, path.resolve(folder, toPath));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) safe.fail('Moved file was not found');
  if (fs.existsSync(target)) safe.fail('Original location already contains a file with that name');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
  return { ok: true, from: fromPath, to: toPath };
}

module.exports = { id: 'organizer', actions: { readFolder, move, reverseMove } };
