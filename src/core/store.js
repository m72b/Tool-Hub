const fs = require('fs');
const path = require('path');
const registry = require('./registry');

// installed: tools shown in the app (a hidden tool stays on disk until its add-on is removed).
// known: add-on tools seen before, so a tool the user hid is not switched back on at the next launch.
// legacy: the tool list from before tools became add-ons, used to carry the user's choices over.
const FORMER_BUILT_INS = ['starter', 'files', 'cleanup', 'system', 'media'];

function createStore(userDataDir, platform) {
  const file = path.join(userDataDir, 'installed-tools.json');
  let state = null;

  function defaults() {
    return { installed: [], known: [], setupComplete: false, sectionsChosen: false, legacy: null, offline: false };
  }

  const strings = value => (Array.isArray(value) ? value.filter(id => typeof id === 'string') : []);

  function sanitize(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;
    const fromOldVersion = !Array.isArray(raw.known);
    return {
      // Add-ons are only registered at startup, so entries are kept even when a tool is not available right now.
      installed: strings(raw.installed),
      known: strings(raw.known),
      setupComplete: raw.setupComplete === true,
      sectionsChosen: raw.sectionsChosen === true,
      offline: raw.offline === true,
      legacy: fromOldVersion ? strings(raw.installed) : (Array.isArray(raw.legacy) ? strings(raw.legacy) : null),
    };
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

  const available = id => {
    const tool = registry.getTool(id);
    return !!tool && registry.isSupported(tool, platform);
  };

  function isInstalled(id) {
    return available(id) && load().installed.includes(id);
  }

  // Newly added add-on tools are switched on, unless this is an upgrade and the user had that tool off before.
  function syncAddonTools(ids) {
    const current = load();
    const fresh = ids.filter(id => !current.known.includes(id));
    const present = new Set(ids);
    const wasTurnedOff = id => current.legacy && FORMER_BUILT_INS.includes(registry.getTool(id)?.addon) && !current.legacy.includes(id);
    const turnedOn = fresh.filter(id => !wasTurnedOff(id));
    state = {
      ...current,
      known: [...current.known.filter(id => present.has(id)), ...fresh],
      installed: Array.from(new Set([...current.installed.filter(id => present.has(id)), ...turnedOn])),
    };
    persist();
    return state;
  }

  function setInstalled(ids, setupComplete) {
    const current = load();
    const requested = Array.isArray(ids) ? ids : [];
    state = {
      ...current,
      installed: Array.from(new Set(requested.filter(available))),
      setupComplete: setupComplete === undefined ? current.setupComplete : setupComplete === true,
    };
    persist();
    return state;
  }

  function install(id) {
    if (!available(id)) return load();
    const current = load();
    if (current.installed.includes(id)) return current;
    return setInstalled([...current.installed, id]);
  }

  function uninstall(id) {
    return setInstalled(load().installed.filter(x => x !== id));
  }

  function setOffline(offline) {
    state = { ...load(), offline: offline === true };
    persist();
    return state;
  }

  function markSectionsChosen() {
    state = { ...load(), sectionsChosen: true, setupComplete: true };
    persist();
    return state;
  }

  return { load, isInstalled, setInstalled, install, uninstall, syncAddonTools, markSectionsChosen, setOffline, file };
}

module.exports = { createStore };
