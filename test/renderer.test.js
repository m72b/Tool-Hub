const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    _listeners: {},
    _attrs: {},
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
  };
  node.classList = {
    add(...c) { node.className = `${node.className} ${c.join(' ')}`.trim(); },
    remove(c) { node.className = node.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
    toggle(c, on) { if (on) node.classList.add(c); else node.classList.remove(c); },
    contains(c) { return node.className.split(/\s+/).includes(c); },
  };
  node.appendChild = child => {
    if (!child) throw new Error('appendChild called with ' + child);
    node.children.push(child);
    node.firstChild = node.children[0];
    return child;
  };
  node.removeChild = child => {
    node.children = node.children.filter(c => c !== child);
    node.firstChild = node.children[0] || null;
    return child;
  };
  node.remove = () => {};
  node.setAttribute = (k, v) => { node._attrs[k] = v; };
  node.getAttribute = k => node._attrs[k];
  node.addEventListener = (type, fn) => {
    node._listeners[type] = node._listeners[type] || [];
    node._listeners[type].push(fn);
  };
  node.querySelectorAll = () => [];
  node.querySelector = () => null;
  node.closest = () => null;
  node.contains = () => false;
  node.focus = () => {};
  return node;
}

function createEnv() {
  const elements = new Map();
  const document = {
    documentElement: makeNode('html'),
    body: makeNode('body'),
    createElement: tag => makeNode(tag),
    createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, makeNode('div'));
      return elements.get(id);
    },
    addEventListener: () => {},
    querySelectorAll: () => [],
  };
  const store = new Map();
  const win = {
    document,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    navigator: { clipboard: { writeText: async () => {} } },
    Image: class { set src(v) { this._src = v; } },
    setTimeout,
    clearTimeout,
    console,
  };
  win.window = win;
  return win;
}

function loadScript(ctx, relPath) {
  const code = fs.readFileSync(path.join(RENDERER, relPath), 'utf8');
  vm.runInContext(code, ctx, { filename: relPath });
}

const MOCK = {
  renamer: {
    readFolder: { folder: 'C:/x', files: [{ name: 'song.mp3', ext: 'mp3', size: 100, mtime: Date.now(), dir: 'C:/x', path: 'C:/x/song.mp3' }] },
    rename: { ok: true },
    musicbrainz: { data: { recordings: [{ title: 'T', 'artist-credit': [{ name: 'A' }], length: 1000 }] } },
  },
  organizer: {
    readFolder: { folder: 'C:/x', files: [{ name: 'a.mp3', ext: 'mp3', size: 100, mtime: Date.now(), dir: 'C:/x', path: 'C:/x/a.mp3' }] },
    move: { ok: true },
  },
  duplicates: {
    scan: {
      groups: [{ key: 'abc', size: 1024, count: 2, files: [
        { path: 'C:/a.txt', name: 'a.txt', dir: 'C:/', size: 1024, mtime: Date.now() },
        { path: 'C:/b.txt', name: 'b.txt', dir: 'C:/', size: 1024, mtime: Date.now() },
      ] }],
      totalGroups: 1, scanned: 10, wasted: 1024, truncated: true, matchBy: 'hash',
    },
    remove: { removed: 1, failed: [] },
  },
  'large-files': {
    scan: { files: [{ path: 'C:/big.bin', name: 'big.bin', dir: 'C:/', ext: 'bin', size: 999, mtime: Date.now() }], total: 1, totalSize: 999, scanned: 5, truncated: true },
  },
  'disk-analyzer': {
    scan: { root: 'C:/', parent: null, total: 2048, fileBytes: 1024, fileCount: 2, children: [{ path: 'C:/sub', name: 'sub', isDir: true, size: 1024, count: 3, percent: 50 }, { path: 'C:/f.txt', name: 'f.txt', isDir: false, size: 1024, count: 1, percent: 50 }] },
  },
  'temp-cleaner': {
    scan: { targets: [{ id: 'user-temp', label: 'User temp', path: 'C:/Temp', description: 'd', available: true, size: 500, count: 3 }, { id: 'x', label: 'Missing', path: 'C:/none', description: 'd', available: false, size: 0, count: 0 }], totalSize: 500, totalCount: 3 },
    clean: { removed: 3, freed: 500, skipped: [], skippedCount: 0 },
  },
  'apps-manager': {
    list: { supported: true, total: 1, apps: [{ key: 'k', name: 'App', version: '1.0', publisher: 'Pub', size: 1024, location: '', installDate: '', canUninstall: true }] },
    uninstall: { started: true },
  },
  'startup-manager': {
    list: { supported: true, total: 1, entries: [{ id: 'reg:HKCU:X', name: 'X', command: 'c:/x.exe', scope: 'Current user', source: 'Registry (HKCU)', enabled: true, canToggle: true }] },
    setEnabled: { id: 'reg:HKCU:X', enabled: false },
  },
  'system-info': {
    get: {
      platform: 'win32', hostname: 'PC', osType: 'Windows_NT', osRelease: '10', arch: 'x64', uptime: '1d 0h 0m',
      cpu: { model: 'CPU', cores: 8, speed: 3000 },
      memory: { total: 16e9, free: 8e9, used: 8e9, percent: 50 },
      storage: [{ root: 'C:\\', total: 1e12, free: 5e11, used: 5e11, percent: 50 }],
      extras: { gpu: [{ Name: 'GPU', DriverVersion: '1', AdapterRAM: 4e9 }], motherboard: { Manufacturer: 'M', Product: 'P', Version: 'V' }, bios: { Manufacturer: 'B', SMBIOSBIOSVersion: '1' }, os: { Caption: 'Windows 11', Version: '10.0', BuildNumber: '22631', OSArchitecture: '64-bit' }, memoryModules: [{ Capacity: 8e9, Speed: 3200 }] },
    },
  },
  'drive-health': {
    get: { supported: true, drives: [{ id: '0', name: 'SSD', mediaType: 'SSD', busType: 'NVMe', size: 1e12, health: 'healthy', healthRaw: 'Healthy', operational: 'OK', serial: 'S', firmware: 'F', temperature: 40, wear: 2, powerOnHours: 100, readErrors: 0, writeErrors: 0 }], note: 'n' },
  },
  'folder-compare': {
    compare: {
      left: 'C:/a', right: 'C:/b', mode: 'hash',
      onlyLeft: [{ rel: 'x.txt', size: 1, mtime: Date.now() }],
      onlyRight: [{ rel: 'y.txt', size: 1, mtime: Date.now() }],
      different: [{ rel: 'z.txt', reason: 'content', leftSize: 1, rightSize: 2, leftMtime: 1, rightMtime: 2 }],
      identicalCount: 1, counts: { onlyLeft: 1, onlyRight: 1, different: 1, identical: 1 }, truncated: true,
    },
  },
  'hash-tool': {
    hashFiles: { algo: 'sha256', results: [{ path: 'C:/a', name: 'a', size: 1, hash: 'ff', ok: true }, { path: 'C:/b', name: 'b', size: 0, hash: null, ok: false, error: 'gone' }] },
    verify: { algo: 'sha256', path: 'C:/a', expected: 'ff', actual: 'ff', match: true },
  },
  'image-convert': {
    listImages: { folder: 'C:/i', files: [{ path: 'C:/i/a.png', name: 'a.png', ext: 'png', size: 10 }], truncated: false },
    read: { path: 'C:/i/a.png', name: 'a.png', ext: 'png', size: 10, dataUrl: 'data:image/png;base64,AA' },
    write: { path: 'C:/i/a.webp', name: 'a.webp', size: 5 },
  },
  network: {
    ping: { host: 'h', ok: true, output: 'out', times: [1, 2], summary: { sent: 2, min: 1, max: 2, avg: 1.5 }, loss: 0 },
    lookup: { host: 'h', records: { A: ['1.2.3.4'], MX: [{ exchange: 'm', priority: 1 }], AAAA: [] }, errors: {}, reverse: ['r.com'] },
    traceroute: { host: 'h', ok: true, hops: ['1 x'], output: 'trace', available: true },
    ipinfo: { interfaces: [{ name: 'eth0', address: '1.2.3.4', family: 'IPv4', mac: 'aa', internal: false, cidr: null }], dnsServers: ['8.8.8.8'], hostname: 'PC' },
  },
  attributes: {
    list: { folder: 'C:/x', supported: { readonly: true, hidden: true, system: true, archive: true }, files: [{ path: 'C:/x/a', name: 'a', size: 1, attrs: { readonly: true, hidden: false, system: false, archive: true } }], truncated: true },
    apply: { updated: 1, failed: [], failedCount: 0 },
  },
  'file-dates': {
    list: { folder: 'C:/x', files: [{ path: 'C:/x/a', name: 'a', size: 1, created: Date.now(), modified: Date.now(), accessed: Date.now() }], truncated: true },
    apply: { updated: 1, failed: [], failedCount: 0 },
  },
};
MOCK['image-resize'] = MOCK['image-convert'];

const ctxObj = createEnv();
const context = vm.createContext(ctxObj);
loadScript(context, 'ui.js');
for (const f of ['renamer', 'cleanup', 'files', 'system', 'media', 'extra']) loadScript(context, `views/${f}.js`);

const registry = require(path.join(ROOT, 'src', 'core', 'registry'));
const Hub = ctxObj.Hub;

let failures = 0;
const missing = [];
for (const tool of registry.TOOLS) {
  if (!Hub.views.has(tool.id)) missing.push(tool.id);
}
assert.strictEqual(missing.length, 0, `Views missing for: ${missing.join(', ')}`);
console.log(`All ${registry.TOOLS.length} tools have a registered view`);

const calls = [];
(async () => {
  for (const tool of registry.TOOLS) {
    const def = Hub.getView(tool.id);
    const api = {
      invoke: async (action, params) => {
        calls.push(`${tool.id}.${action}`);
        const data = (MOCK[tool.id] || {})[action];
        if (data === undefined) return { ok: false, error: `no mock for ${tool.id}.${action}` };
        return { ok: true, data };
      },
      toast: () => {},
      pickFolder: async () => 'C:/chosen',
      pickFiles: async () => [{ path: 'C:/a', name: 'a', ext: 'txt', size: 1, mtime: 1, dir: 'C:/' }],
      reveal: async () => true,
      platform: 'win32',
    };
    try {
      const node = def.render(api, { tool, toast: () => {}, openLibrary: () => {} });
      assert.ok(node && node.tagName, `${tool.id} render returned no node`);
    } catch (err) {
      failures++;
      console.error(`RENDER FAIL ${tool.id}: ${err.message}`);
    }
  }

  await new Promise(r => setTimeout(r, 200));

  if (failures === 0) console.log('All views rendered without throwing');
  console.log(`Auto-run invocations: ${calls.join(', ') || 'none'}`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
