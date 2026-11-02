const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const src = p => require(path.join(__dirname, '..', 'src', 'core', p));
const format = src('addon-format');
const { createAddonManager } = src('addons');
const registry = src('registry');
const { createStore } = src('store');
const { createHost } = src('host');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-'));
const keyPair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};

// A tiny add-on with one tool.
const addonDir = path.join(tmp, 'src-addon');
fs.mkdirSync(path.join(addonDir, 'main'), { recursive: true });
fs.mkdirSync(path.join(addonDir, 'ui'), { recursive: true });
fs.writeFileSync(path.join(addonDir, 'main', 'index.js'), "module.exports = { actions: { hello: async (p, ctx) => ({ hi: p.name, hasSafe: typeof ctx.lib.safe.existingDir === 'function' }) } };\n");
fs.writeFileSync(path.join(addonDir, 'ui', 'view.js'), 'window.x = 1;\n');
const manifest = { id: 'demo-addon', name: 'Demo', version: '1.2.3', minAppVersion: '4.0.0', tools: [{ id: 'demo-tool', name: 'Demo Tool', category: 'Demo', module: 'main/index.js' }], scripts: ['ui/view.js'] };
const files = ['main/index.js', 'ui/view.js'];

const me = keyPair();
const stranger = keyPair();
const { buffer } = format.pack({ root: addonDir, files, manifest, privateKeyPem: me.pem });

// Signature checks
const opened = format.open(buffer, [{ name: 'me', publicKey: me.pub }]);
assert.strictEqual(opened.manifest.id, 'demo-addon');
assert.strictEqual(opened.extract('ui/view.js').toString(), 'window.x = 1;\n');
assert.throws(() => format.open(buffer, [{ name: 'other', publicKey: stranger.pub }]), /not from a trusted key/, 'untrusted signer rejected');
const tamperedHeader = Buffer.from(buffer); tamperedHeader[30] ^= 1;
assert.throws(() => format.open(tamperedHeader, [{ name: 'me', publicKey: me.pub }]), /trusted key|damaged/, 'header tampering detected');
const tamperedPayload = Buffer.from(buffer); tamperedPayload[tamperedPayload.length - 3] ^= 0xff;
const tp = format.open(tamperedPayload, [{ name: 'me', publicKey: me.pub }]);
assert.throws(() => files.forEach(f => tp.extract(f)), /integrity|invalid|incorrect|unexpected/i, 'payload tampering detected');
assert.throws(() => format.open(Buffer.from('not an addon at all'), []), /not a Tool Hub add-on/);
assert.throws(() => format.validateManifest({ ...manifest, tools: [{ ...manifest.tools[0], module: '../evil.js' }] }), /module path/);
assert.throws(() => format.validateManifest({ ...manifest, id: 'Bad Id' }), /id must/);
assert.strictEqual(format.compareVersions('4.0.0', '3.10.2'), 1);
assert.strictEqual(format.compareVersions('4.0.0', '4.0.0'), 0);

// Manager: trust, install, version gate, upgrade, remove
const userData = path.join(tmp, 'user');
const manager = createAddonManager({ userData, appVersion: '4.0.0' });
assert.throws(() => manager.install(buffer), /not from a trusted key/, 'cannot install before trusting key');
assert.throws(() => manager.trustKey('', me.pub), /name/);
assert.throws(() => manager.trustKey('x', 'garbage'), /not a valid Ed25519/);
manager.trustKey('My key', me.pub);
assert.ok(manager.trustedKeys().some(k => k.name === 'My key' && !k.builtIn));
assert.ok(manager.trustedKeys().some(k => k.builtIn), 'official key is built in');
assert.throws(() => manager.trustKey('again', me.pub), /already trusted/);
const info = manager.inspect(buffer);
assert.strictEqual(info.signer, 'My key');
assert.strictEqual(info.replaces, null);
manager.install(buffer);
assert.deepStrictEqual(manager.list().map(a => [a.id, a.version, a.signer]), [['demo-addon', '1.2.3', 'My key']]);
assert.ok(manager.resolveFile('demo-addon', 'ui/view.js'), 'serves files inside the add-on');
assert.strictEqual(manager.resolveFile('demo-addon', '../manifest.json'), null, 'refuses traversal');
assert.strictEqual(manager.resolveFile('demo-addon', 'nope.js'), null);

const tooNew = format.pack({ root: addonDir, files, manifest: { ...manifest, version: '2.0.0', minAppVersion: '9.0.0' }, privateKeyPem: me.pem }).buffer;
assert.throws(() => manager.install(tooNew), /needs Tool Hub 9.0.0/);
const upgrade = format.pack({ root: addonDir, files, manifest: { ...manifest, version: '1.3.0' }, privateKeyPem: me.pem }).buffer;
assert.strictEqual(manager.inspect(upgrade).replaces, '1.2.3');
manager.install(upgrade);
assert.strictEqual(manager.list()[0].version, '1.3.0', 'upgrade replaces in place');

// Registry + store + host integration
registry.setAddonTools(manager.tools());
const tool = registry.getTool('demo-tool');
assert.ok(tool && tool.addon === 'demo-addon', 'add-on tool registered');
assert.ok(registry.categories().includes('Demo'));
const store = createStore(userData, process.platform);
assert.ok(store.isInstalled('demo-tool'), 'add-on tools count as installed');
const host = createHost({ store, platform: process.platform, userData, addons: manager, trash: async () => {} });
const catalog = host.catalog();
assert.ok(catalog.tools.find(t => t.id === 'demo-tool').installed);
assert.ok(!('modulePath' in catalog.tools.find(t => t.id === 'demo-tool')), 'module path not exposed to renderer');
assert.deepStrictEqual(catalog.addons[0].scripts, ['ui/view.js']);

(async () => {
  const res = await host.invoke('demo-tool', 'hello', { name: 'x' });
  assert.deepStrictEqual(res, { ok: true, data: { hi: 'x', hasSafe: true } }, 'add-on module runs with ctx.lib');
  manager.remove('demo-addon');
  assert.strictEqual(manager.list().length, 0);
  registry.setAddonTools([]);
  manager.untrustKey(format.keyId(me.pub));
  assert.ok(!manager.trustedKeys().some(k => k.name === 'My key'));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('add-ons: all checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
