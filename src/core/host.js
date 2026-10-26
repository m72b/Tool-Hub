const path = require('path');
const registry = require('./registry');
const safe = require('./safe');

const MODULE_FILES = {
  renamer: 'renamer',
  organizer: 'organizer',
  duplicates: 'duplicates',
  'disk-analyzer': 'disk-analyzer',
  'large-files': 'large-files',
  'temp-cleaner': 'temp-cleaner',
  'apps-manager': 'apps-manager',
  'startup-manager': 'startup-manager',
  'system-info': 'system-info',
  'drive-health': 'drive-health',
  'folder-compare': 'folder-compare',
  'hash-tool': 'hash-tool',
  'image-convert': 'image-convert',
  'image-resize': 'image-resize',
  network: 'network',
  attributes: 'attributes',
  'file-dates': 'file-dates',
  'empty-folders': 'empty-folders',
  'small-files': 'small-files',
  'tree-export': 'tree-export',
  'port-process': 'port-process',
  'system-editor': 'system-editor',
  utilities: 'utilities',
};

function createHost(options) {
  const { store, platform, userData, trash } = options;
  const loaded = new Map();
  const ctx = { platform, userData, trash };

  function loadTool(id) {
    if (loaded.has(id)) return loaded.get(id);
    const file = MODULE_FILES[id];
    if (!file) return null;
    const mod = require(path.join(__dirname, '..', 'tools', file));
    loaded.set(id, mod);
    return mod;
  }

  async function invoke(toolId, action, params) {
    const tool = registry.getTool(toolId);
    if (!tool) return { ok: false, error: 'Unknown tool' };
    if (!registry.isSupported(tool, platform)) return { ok: false, error: `${tool.name} is not available on this platform` };
    if (!store.isInstalled(toolId)) return { ok: false, error: `${tool.name} is not installed` };
    const mod = loadTool(toolId);
    if (!mod) return { ok: false, error: 'Tool module missing' };
    const handler = mod.actions ? mod.actions[action] : null;
    if (typeof handler !== 'function') return { ok: false, error: 'Unknown action' };
    const safeParams = params && typeof params === 'object' ? params : {};
    try {
      const data = await handler(safeParams, ctx);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof safe.SafeError) return { ok: false, error: err.message };
      return { ok: false, error: err && err.message ? err.message : 'Unexpected error' };
    }
  }

  function catalog() {
    const state = store.load();
    return {
      platform,
      setupComplete: state.setupComplete,
      categories: registry.categories(),
      tools: registry.listTools(platform).map(t => ({
        ...t,
        installed: state.installed.includes(t.id),
      })),
    };
  }

  return { invoke, catalog, loadTool };
}

module.exports = { createHost, MODULE_FILES };
