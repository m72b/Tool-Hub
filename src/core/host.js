const registry = require('./registry');
const safe = require('./safe');
const addonLib = require('./addon-lib');

function createHost(options) {
  const { store, platform, userData, trash, executable, packaged } = options;
  const loaded = new Map();
  // `lib` exposes the app's validated helpers to add-on modules, which cannot import src/ by path.
  const ctx = { platform, userData, trash, executable, packaged, lib: addonLib, invokeTool: (id, action, params) => invoke(id, action, params) };

  function loadTool(id) {
    if (loaded.has(id)) return loaded.get(id);
    const modulePath = registry.getTool(id)?.modulePath;
    if (!modulePath) return null;
    const mod = require(modulePath);
    loaded.set(id, mod);
    return mod;
  }

  async function invoke(toolId, action, params, options = {}) {
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
      const data = await handler(safeParams, { ...ctx, signal: options.signal, progress: options.progress });
      return { ok: true, data };
    } catch (err) {
      if (options.signal?.aborted || err?.name === 'AbortError') return { ok: false, error: 'Operation cancelled' };
      if (err instanceof safe.SafeError) return { ok: false, error: err.message };
      return { ok: false, error: err && err.message ? err.message : 'Unexpected error' };
    }
  }

  // Tools declared with "background": true may keep working while their screen is closed (for example, watching
  // the clipboard). onStart runs while the tool is switched on, onStop when it is switched off.
  async function syncBackground() {
    for (const tool of registry.listTools(platform)) {
      if (!tool.background || !tool.supported) continue;
      const on = store.isInstalled(tool.id);
      if (!on && !loaded.has(tool.id)) continue;
      try {
        const mod = loadTool(tool.id);
        const hook = on ? mod?.onStart : mod?.onStop;
        if (typeof hook === 'function') await hook({ ...ctx });
      } catch (err) {
        console.error(`${tool.name} background work failed: ${err.message}`);
      }
    }
  }

  // Lets a tool stop and delete what it stored before its add-on is removed.
  async function beforeRemove(addonId) {
    for (const tool of registry.listTools(platform)) {
      if (tool.addon !== addonId) continue;
      try {
        const mod = loadTool(tool.id);
        if (typeof mod?.onRemove === 'function') await mod.onRemove({ ...ctx });
      } catch (err) {
        console.error(`${tool.name} could not clean up: ${err.message}`);
      }
    }
  }

  function catalog() {
    const state = store.load();
    return {
      platform,
      setupComplete: state.setupComplete,
      sectionsChosen: state.sectionsChosen,
      legacyTools: state.legacy || [],
      offline: state.offline,
      addons: options.addons ? options.addons.list().map(addon => ({
        id: addon.id, name: addon.name, version: addon.version, description: addon.description || '',
        signer: addon.signer, problem: addon.problem, scripts: addon.scripts || [], styles: addon.styles || [],
        tools: addon.tools.map(tool => tool.id),
      })) : [],
      categories: registry.categories(),
      tools: registry.listTools(platform).map(t => ({
        ...t,
        installed: state.installed.includes(t.id),
      })),
    };
  }

  return { invoke, catalog, loadTool, syncBackground, beforeRemove };
}

module.exports = { createHost };
