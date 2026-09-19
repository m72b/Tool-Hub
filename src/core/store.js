const fs = require('fs');
const path = require('path');
const registry = require('./registry');

function createStore(userDataDir, platform) {
  const file = path.join(userDataDir, 'installed-tools.json');
  let state = null;

  function defaults() {
    return { installed: registry.coreIds(), setupComplete: false };
  }

  function sanitize(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;
    const list = Array.isArray(raw.installed) ? raw.installed : [];
    const valid = list.filter(id => {
      const tool = registry.getTool(id);
      return tool && registry.isSupported(tool, platform);
    });
    const merged = Array.from(new Set([...registry.coreIds(), ...valid]));
    return { installed: merged, setupComplete: raw.setupComplete === true };
  }

  function load() {
    if (state) return state;
    try {
      state = sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      state = defaults();
    }
    return state;
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  function isInstalled(id) {
    return load().installed.includes(id);
  }

  function setInstalled(ids, setupComplete) {
    const current = load();
    const requested = Array.isArray(ids) ? ids : [];
    const valid = requested.filter(id => {
      const tool = registry.getTool(id);
      return tool && registry.isSupported(tool, platform);
    });
    state = {
      installed: Array.from(new Set([...registry.coreIds(), ...valid])),
      setupComplete: setupComplete === undefined ? current.setupComplete : setupComplete === true,
    };
    persist();
    return state;
  }

  function install(id) {
    const tool = registry.getTool(id);
    if (!tool || !registry.isSupported(tool, platform)) return load();
    const current = load();
    if (current.installed.includes(id)) return current;
    return setInstalled([...current.installed, id]);
  }

  function uninstall(id) {
    const tool = registry.getTool(id);
    if (!tool || tool.core) return load();
    const current = load();
    return setInstalled(current.installed.filter(x => x !== id));
  }

  return { load, isInstalled, setInstalled, install, uninstall, file };
}

module.exports = { createStore };
