// Clipboard history storage: entries, collections and settings. It knows nothing about Electron, so it can be
// tested on its own. `protect` encrypts what is written to disk, because copied text can be sensitive.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DAY_MS = 86400000;
const MAX_TEXT_CHARS = 1000000;
const DEFAULTS = {
  enabled: false,
  retentionDays: 30,
  maxItems: 500,
  maxImageMB: 20,
  excludedApps: ['1password', 'bitwarden', 'dashlane', 'enpass', 'keepass', 'keepassxc', 'keeper', 'lastpass', 'nordpass', 'protonpass', 'roboform', 'vlautr'],
};

const plain = { encrypt: text => Buffer.from(text, 'utf8'), decrypt: buffer => buffer.toString('utf8'), secure: false };

function cleanAppName(value) {
  return String(value || '').trim().toLowerCase().replace(/\.(exe|app)$/, '').slice(0, 80);
}

function createHistory({ dir, protect = plain, now = Date.now }) {
  const dataFile = path.join(dir, 'history.bin');
  const imagesDir = path.join(dir, 'images');
  let state = null;
  let revision = 0;

  function load() {
    if (state) return state;
    state = { settings: { ...DEFAULTS }, items: [], collections: [] };
    try {
      const saved = JSON.parse(protect.decrypt(fs.readFileSync(dataFile)));
      state = { settings: { ...DEFAULTS, ...saved.settings }, items: saved.items || [], collections: saved.collections || [] };
    } catch { /* first run, or the data can no longer be read: start empty */ }
    return state;
  }

  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${dataFile}.tmp`;
    fs.writeFileSync(temp, protect.encrypt(JSON.stringify(state)));
    fs.renameSync(temp, dataFile);
    revision++;
  }

  const imagePath = id => path.join(imagesDir, `${id}.bin`);
  const removeImage = item => { if (item.type === 'image') fs.rmSync(imagePath(item.id), { force: true }); };
  const isKept = item => item.pinned || item.favorite || item.collections.length > 0;

  // Removes old entries; pinned, favorite and collected entries are always kept.
  function prune() {
    const { retentionDays, maxItems } = load().settings;
    const cutoff = retentionDays > 0 ? now() - retentionDays * DAY_MS : 0;
    let free = 0;
    const kept = [];
    for (const item of state.items) {
      const expired = !isKept(item) && (item.createdAt < cutoff || free >= maxItems);
      if (expired) { removeImage(item); continue; }
      if (!isKept(item)) free++;
      kept.push(item);
    }
    const changed = kept.length !== state.items.length;
    state.items = kept;
    return changed;
  }

  // Adds an entry, or moves an identical one back to the top. Returns the entry, or null if it was refused.
  function add(entry, imageBuffer) {
    load();
    if (entry.type === 'text' && entry.text.length > MAX_TEXT_CHARS) return null;
    if (imageBuffer && imageBuffer.length > state.settings.maxImageMB * 1048576) return null;
    const existing = state.items.find(item => item.hash === entry.hash);
    if (existing) {
      existing.createdAt = now();
      existing.app = entry.app || existing.app;
      state.items = [existing, ...state.items.filter(item => item !== existing)];
      save();
      return existing;
    }
    const item = { id: crypto.randomBytes(8).toString('hex'), pinned: false, favorite: false, collections: [], createdAt: now(), ...entry };
    if (imageBuffer) {
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.writeFileSync(imagePath(item.id), protect.encrypt(imageBuffer.toString('base64')));
    }
    state.items.unshift(item);
    prune();
    save();
    return item;
  }

  const get = id => load().items.find(item => item.id === id) || null;

  function readImage(item) {
    return Buffer.from(protect.decrypt(fs.readFileSync(imagePath(item.id))), 'base64');
  }

  function matches(item, query) {
    if (!query) return true;
    const text = [item.text, item.app, ...(item.files || [])].filter(Boolean).join('\n').toLowerCase();
    return query.split(/\s+/).every(word => text.includes(word));
  }

  function list({ query = '', type = 'all', collection = '', limit = 200 } = {}) {
    load();
    const words = String(query).trim().toLowerCase();
    const filtered = state.items.filter(item => {
      if (type === 'pinned' && !item.pinned) return false;
      if (type === 'favorite' && !item.favorite) return false;
      if (['text', 'image', 'files'].includes(type) && item.type !== type) return false;
      if (collection && !item.collections.includes(collection)) return false;
      return matches(item, words);
    });
    filtered.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
    return { items: filtered.slice(0, limit), total: filtered.length };
  }

  function update(id, change) {
    const item = get(id);
    if (!item) return null;
    change(item);
    save();
    return item;
  }

  function remove(id) {
    const item = get(id);
    if (!item) return false;
    removeImage(item);
    state.items = state.items.filter(entry => entry !== item);
    save();
    return true;
  }

  // Clears history; pinned, favorite and collected entries stay unless `everything` is set.
  function clear({ everything = false } = {}) {
    load();
    const keep = state.items.filter(item => !everything && isKept(item));
    for (const item of state.items) if (!keep.includes(item)) removeImage(item);
    state.items = keep;
    save();
    return keep.length;
  }

  function addCollection(name) {
    load();
    const label = String(name || '').trim().slice(0, 60);
    if (!label) throw new Error('Enter a collection name');
    if (state.collections.some(item => item.name.toLowerCase() === label.toLowerCase())) throw new Error('That collection already exists');
    const collection = { id: crypto.randomBytes(6).toString('hex'), name: label };
    state.collections.push(collection);
    save();
    return collection;
  }

  function removeCollection(id) {
    load();
    state.collections = state.collections.filter(item => item.id !== id);
    for (const item of state.items) item.collections = item.collections.filter(entry => entry !== id);
    prune();
    save();
  }

  function setCollection(itemId, collectionId, member) {
    if (!load().collections.some(item => item.id === collectionId)) throw new Error('That collection no longer exists');
    return update(itemId, item => {
      item.collections = item.collections.filter(entry => entry !== collectionId);
      if (member) item.collections.push(collectionId);
    });
  }

  function setSettings(change) {
    const current = load().settings;
    const number = (value, fallback, min, max) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };
    state.settings = {
      ...current,
      enabled: typeof change.enabled === 'boolean' ? change.enabled : current.enabled,
      retentionDays: change.retentionDays === undefined ? current.retentionDays : number(change.retentionDays, current.retentionDays, 0, 3650),
      maxItems: change.maxItems === undefined ? current.maxItems : number(change.maxItems, current.maxItems, 10, 10000),
      maxImageMB: change.maxImageMB === undefined ? current.maxImageMB : number(change.maxImageMB, current.maxImageMB, 1, 200),
      excludedApps: Array.isArray(change.excludedApps) ? [...new Set(change.excludedApps.map(cleanAppName).filter(Boolean))].slice(0, 200) : current.excludedApps,
    };
    prune();
    save();
    return state.settings;
  }

  return {
    load, add, get, readImage, list, update, remove, clear, prune, save, addCollection, removeCollection, setCollection, setSettings,
    revision: () => revision,
    settings: () => load().settings,
    collections: () => load().collections,
    secure: protect.secure === true,
  };
}

module.exports = { createHistory, cleanAppName, DEFAULTS };
