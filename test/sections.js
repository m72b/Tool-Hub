// Registers the section add-ons from source, the way the app registers installed add-ons.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'src', 'core', 'addon-lib'));
const registry = require(path.join(ROOT, 'src', 'core', 'registry'));

const IDS = ['starter', 'files', 'cleanup', 'system', 'media'];
const manifest = id => JSON.parse(fs.readFileSync(path.join(ROOT, 'addons', id, 'addon.json'), 'utf8'));

function tools() {
  return IDS.flatMap(id => manifest(id).tools.map(tool => ({
    ...tool,
    addon: id,
    modulePath: tool.module ? path.join(ROOT, 'addons', id, ...tool.module.split('/')) : null,
  })));
}

function register() {
  registry.setAddonTools(tools());
  return registry;
}

const scripts = () => IDS.flatMap(id => manifest(id).scripts.map(file => path.join(ROOT, 'addons', id, ...file.split('/'))));

module.exports = { tools, register, scripts };
