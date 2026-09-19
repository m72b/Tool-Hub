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
  const source = safe.assertInside(folder, path.join(folder, fileName));
  const destinationDir = safe.assertInside(folder, path.join(folder, destFolder));
  if (!fs.existsSync(source)) safe.fail('Source file not found');
  fs.mkdirSync(destinationDir, { recursive: true });
  const target = safe.assertInside(folder, path.join(destinationDir, fileName));
  if (fs.existsSync(target)) safe.fail('Destination file already exists');
  fs.renameSync(source, target);
  return { ok: true, from: fileName, to: path.join(destFolder, fileName) };
}

module.exports = { id: 'organizer', actions: { readFolder, move } };
