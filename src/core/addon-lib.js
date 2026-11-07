// Helpers the app shares with add-on code, which is installed outside the app and cannot import src/ by path.
const safe = require('./safe');
const walk = require('./walk');
const imageio = require('./imageio');

const lib = {
  safe,
  walk,
  imageio,
  get musicMetadata() { return require('music-metadata'); },
};

globalThis.toolHubLib = lib;
module.exports = lib;
