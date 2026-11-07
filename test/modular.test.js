// Sections as add-ons: tool state, bundled add-ons, the signed catalog and cross-section calls.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sections = require('./sections');
const core = name => require(path.join(__dirname, '..', 'src', 'core', name));
const format = core('addon-format');
const { createAddonManager } = core('addons');
const { createStore } = core('store');
const { createHost } = core('host');
const catalog = core('catalog');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-'));
const registry = sections.register();
const ids = sections.tools().map(tool => tool.id);

(async () => {
  // Every tool has a screen script and, when declared, a module that exists.
  assert.strictEqual(ids.length, 33, 'all former built-in tools are in sections');
  assert.strictEqual(new Set(ids).size, ids.length, 'tool ids are unique');
  for (const tool of sections.tools()) if (tool.modulePath) assert.ok(fs.existsSync(tool.modulePath), tool.modulePath);

  // New install: tools from sections are switched on, a hidden tool stays hidden.
  const dir = path.join(tmp, 'fresh');
  let store = createStore(dir, 'win32');
  assert.deepStrictEqual(store.load().installed, []);
  store.syncAddonTools(ids);
  assert.ok(store.isInstalled('duplicates'));
  store.uninstall('duplicates');
  store = createStore(dir, 'win32');
  store.syncAddonTools(ids);
  assert.ok(!store.isInstalled('duplicates'), 'hidden tool stays hidden after restart');
  store.syncAddonTools(ids.filter(id => id !== 'duplicates'));
  store.syncAddonTools(ids);
  assert.ok(store.isInstalled('duplicates'), 'reinstalling a section switches its tools back on');

  // Upgrade from 4.x: tools the user had off stay off, and new add-on tools are on.
  const old = path.join(tmp, 'old');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'installed-tools.json'), JSON.stringify({ installed: ['renamer', 'organizer', 'utilities', 'hash-tool'], setupComplete: true }));
  const upgraded = createStore(old, 'win32');
  assert.deepStrictEqual(upgraded.load().legacy, ['renamer', 'organizer', 'utilities', 'hash-tool']);
  assert.strictEqual(upgraded.load().sectionsChosen, false, 'upgrade shows the sections screen once');
  registry.setAddonTools([...sections.tools(), { id: 'pdf', name: 'PDF', category: 'PDF', platforms: 'win32', addon: 'pdf-tools' }]);
  upgraded.syncAddonTools([...ids, 'pdf']);
  assert.ok(upgraded.isInstalled('hash-tool'), 'kept');
  assert.ok(!upgraded.isInstalled('network'), 'was off, stays off');
  assert.ok(upgraded.isInstalled('pdf'), 'add-on tools are unaffected by the old list');
  sections.register();

  // Bundled add-ons install themselves, update, and stay away once removed.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const srcDir = path.join(tmp, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(path.join(srcDir, 'view.js'), 'window.x = 1;');
  const manifest = version => ({ id: 'bundled-one', name: 'Bundled', version, tools: [{ id: 'bundled-tool', name: 'Window only tool' }], scripts: ['view.js'] });
  const pack = version => format.pack({ root: srcDir, files: ['view.js'], manifest: manifest(version), privateKeyPem: pem }).buffer;
  const bundleDir = path.join(tmp, 'bundle');
  fs.mkdirSync(bundleDir);
  fs.writeFileSync(path.join(bundleDir, 'bundled.thaddon'), pack('1.0.0'));
  const manager = createAddonManager({ userData: path.join(tmp, 'user'), appVersion: '5.0.0' });
  manager.trustKey('Test', pub);
  assert.deepStrictEqual(manager.installBundled(bundleDir), ['bundled-one'], 'installed on first launch');
  assert.strictEqual(manager.tools()[0].modulePath, null, 'a tool may run in the window only');
  assert.deepStrictEqual(manager.installBundled(bundleDir), [], 'nothing to do on the next launch');
  fs.writeFileSync(path.join(bundleDir, 'bundled.thaddon'), pack('1.1.0'));
  manager.installBundled(bundleDir);
  assert.strictEqual(manager.list()[0].version, '1.1.0', 'app updates bring a newer bundled add-on');
  manager.remove('bundled-one');
  assert.deepStrictEqual(manager.installBundled(bundleDir), [], 'a removed add-on does not come back');
  manager.install(pack('1.1.0'));
  manager.remove('bundled-one');
  manager.install(pack('1.1.0'));
  assert.strictEqual(manager.list().length, 1, 'installing by hand clears the removal');
  assert.ok(manager.installBundled(path.join(tmp, 'missing')).length === 0, 'missing folder is fine');

  // Catalog: only the release key can publish, and links must stay on GitHub.
  const buffer = pack('2.0.0');
  const entry = { id: 'bundled-one', name: 'Bundled', version: '2.0.0', size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), url: 'https://github.com/m72b/Tool-Hub/releases/download/v5.0.0/b.thaddon', tools: [] };
  const signed = catalog.signCatalog([entry], pem);
  assert.strictEqual(catalog.verifyCatalog(signed, [{ publicKey: pub }])[0].id, 'bundled-one');
  const stranger = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  assert.throws(() => catalog.verifyCatalog(signed, [{ publicKey: stranger }]), /not signed/, 'other keys rejected');
  const edited = JSON.parse(signed);
  edited.body = edited.body.replace('2.0.0', '9.9.9');
  assert.throws(() => catalog.verifyCatalog(JSON.stringify(edited), [{ publicKey: pub }]), /not signed/, 'edits rejected');
  assert.throws(() => catalog.verifyCatalog('{{{', [{ publicKey: pub }]), /damaged/);

  const reply = (body, extra = {}) => ({ ok: true, status: 200, url: entry.url, text: async () => body, headers: { get: () => null }, body: (async function* () { yield Uint8Array.from(buffer.subarray(0, 10)); yield Uint8Array.from(buffer.subarray(10)); })(), ...extra });
  const list = await catalog.fetchCatalog({ fetchImpl: async () => reply(signed), builtInKeys: [{ publicKey: pub }] });
  assert.strictEqual(list.length, 1);
  await assert.rejects(() => catalog.fetchCatalog({ fetchImpl: async () => ({ status: 404, ok: false }), builtInKeys: [] }), /No add-on list/);
  await assert.rejects(() => catalog.fetchCatalog({ fetchImpl: async () => { throw new Error('offline'); }, builtInKeys: [] }), /Could not reach GitHub/);

  const progress = [];
  const got = await catalog.downloadAddon({ fetchImpl: async () => reply(''), entry, onProgress: p => progress.push(p.received) });
  assert.ok(got.equals(buffer), 'downloaded bytes intact');
  assert.deepStrictEqual(progress, [10, buffer.length]);
  await assert.rejects(() => catalog.downloadAddon({ fetchImpl: async () => reply(''), entry: { ...entry, sha256: 'a'.repeat(64) } }), /did not match/, 'wrong bytes rejected');
  await assert.rejects(() => catalog.downloadAddon({ fetchImpl: async () => reply(''), entry: { ...entry, url: 'https://evil.example/x.thaddon' } }), /not on GitHub/, 'links outside GitHub rejected');
  await assert.rejects(() => catalog.downloadAddon({ fetchImpl: async () => reply('', { url: 'https://evil.example/x' }), entry }), /not on GitHub/, 'redirects outside GitHub rejected');
  await assert.rejects(() => catalog.downloadAddon({ fetchImpl: async () => reply(''), entry: { ...entry, url: 'http://github.com/x' } }), /not on GitHub/, 'plain http rejected');

  // Watch Folder (File Tools) drives the Organizer (Starter Tools) through the host.
  const watchDir = path.join(tmp, 'watch');
  fs.mkdirSync(watchDir);
  fs.writeFileSync(path.join(watchDir, 'a.txt'), 'hello');
  const hostStore = createStore(path.join(tmp, 'watch-user'), process.platform);
  hostStore.syncAddonTools(ids);
  const host = createHost({ store: hostStore, platform: process.platform, userData: tmp, trash: async () => {} });
  const started = await host.invoke('watch-folder', 'start', { folder: watchDir, rules: [{ type: 'pattern', match: '*.txt', dest: 'sorted' }] });
  assert.ok(started.ok, started.error);
  for (let i = 0; i < 80 && !fs.existsSync(path.join(watchDir, 'sorted', 'a.txt')); i++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.utimesSync(watchDir, new Date(), new Date());
  }
  assert.ok(fs.existsSync(path.join(watchDir, 'sorted', 'a.txt')), 'file moved across sections');
  await host.invoke('watch-folder', 'stop', { folder: watchDir });

  // A section that is missing fails with a clear message instead of crashing.
  hostStore.uninstall('organizer');
  const missing = await host.invoke('organizer', 'move', {});
  assert.match(missing.error, /not installed/);

  await new Promise(resolve => setTimeout(resolve, 200));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  console.log('sections: all checks passed');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
