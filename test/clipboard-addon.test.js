const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHistory, DEFAULTS } = require('../addons/clipboard/main/history');

const DAY = 86400000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-clipboard-'));
let time = 1000 * DAY;
const fresh = name => createHistory({ dir: path.join(dir, name), now: () => time });
const text = (value, extra = {}) => ({ type: 'text', text: value, size: value.length, hash: `h:${value}`, ...extra });

function run() {
  // Monitoring is off until the user turns it on, and password managers are excluded from the start.
  assert.strictEqual(DEFAULTS.enabled, false);
  assert.ok(DEFAULTS.excludedApps.includes('bitwarden') && DEFAULTS.excludedApps.includes('vlautr'));

  // Newest first, identical copies move to the top instead of repeating.
  let h = fresh('order');
  const first = h.add(text('one'));
  time += 1;
  h.add(text('two'));
  time += 1;
  assert.strictEqual(h.add(text('one')).id, first.id);
  assert.deepStrictEqual(h.list().items.map(i => i.text), ['one', 'two']);

  // Search covers text, app name and file paths, every word must match.
  h = fresh('search');
  h.add(text('Invoice for March', { app: 'excel' }));
  h.add({ type: 'files', files: ['C:\\Work\\report.pdf'], size: 1, hash: 'f' });
  assert.strictEqual(h.list({ query: 'march invoice' }).total, 1);
  assert.strictEqual(h.list({ query: 'EXCEL' }).total, 1);
  assert.strictEqual(h.list({ query: 'report.pdf' }).total, 1);
  assert.strictEqual(h.list({ query: 'march report' }).total, 0);
  assert.strictEqual(h.list({ type: 'files' }).total, 1);

  // Pins sort first and favorites filter.
  h = fresh('flags');
  const older = h.add(text('older'));
  time += 1;
  h.add(text('newer'));
  h.update(older.id, item => { item.pinned = true; item.favorite = true; });
  assert.strictEqual(h.list().items[0].id, older.id);
  assert.strictEqual(h.list({ type: 'pinned' }).total, 1);
  assert.strictEqual(h.list({ type: 'favorite' }).total, 1);

  // Retention by age and by count removes only entries nobody chose to keep.
  h = fresh('retention');
  const collection = h.addCollection('Work');
  assert.throws(() => h.addCollection('work'), /already exists/);
  const pinned = h.add(text('pinned'));
  h.update(pinned.id, item => { item.pinned = true; });
  const collected = h.add(text('collected'));
  h.setCollection(collected.id, collection.id, true);
  h.add(text('plain'));
  time += 31 * DAY;
  h.prune();
  assert.deepStrictEqual(h.list().items.map(i => i.text).sort(), ['collected', 'pinned']);
  h.setSettings({ maxItems: 10 });
  for (let i = 0; i < 15; i++) h.add(text(`item ${i}`));
  assert.strictEqual(h.list({ limit: 100 }).total, 12);
  const kept = h.list({ limit: 100 }).items.map(i => i.text);
  assert.ok(kept.includes('item 14') && !kept.includes('item 0'));
  h.setSettings({ retentionDays: 0 });
  time += 5000 * DAY;
  h.prune();
  assert.strictEqual(h.list({ limit: 100 }).total, 12, '"Keep forever" removes nothing by age');

  // Deleting a collection keeps its entries, which may then expire.
  h.setSettings({ maxItems: 100 });
  h.removeCollection(collection.id);
  assert.strictEqual(h.get(collected.id).collections.length, 0);
  assert.strictEqual(h.collections().length, 0);

  // Clearing keeps kept entries, unless everything is asked for.
  h = fresh('clear');
  const keep = h.add(text('keep'));
  h.update(keep.id, item => { item.favorite = true; });
  h.add(text('drop'));
  assert.strictEqual(h.clear(), 1);
  assert.strictEqual(h.clear({ everything: true }), 0);
  assert.strictEqual(h.list().total, 0);

  // Images are stored apart and removed with their entry; oversized ones are refused.
  h = fresh('images');
  const image = h.add({ type: 'image', width: 1, height: 1, size: 3, hash: 'i' }, Buffer.from([1, 2, 3]));
  assert.deepStrictEqual([...h.readImage(image)], [1, 2, 3]);
  const stored = path.join(dir, 'images', 'images', `${image.id}.bin`);
  assert.ok(fs.existsSync(stored));
  h.remove(image.id);
  assert.ok(!fs.existsSync(stored));
  h.setSettings({ maxImageMB: 1 });
  assert.strictEqual(h.add({ type: 'image', size: 1, hash: 'big' }, Buffer.alloc(2 * 1048576)), null);
  assert.strictEqual(h.add(text('x'.repeat(1000001))), null);

  // Settings are cleaned and limited, and history survives a restart.
  h = fresh('settings');
  const settings = h.setSettings({ maxItems: 1, retentionDays: 'soon', excludedApps: ['  KeePass.EXE ', 'keepass', ''] });
  assert.strictEqual(settings.maxItems, 10);
  assert.strictEqual(settings.retentionDays, DEFAULTS.retentionDays);
  assert.deepStrictEqual(settings.excludedApps, ['keepass']);
  h.add(text('kept'));
  assert.strictEqual(fresh('settings').list().items[0].text, 'kept');

  // What reaches the disk goes through the encryption layer.
  const shift = { secure: true, encrypt: value => Buffer.from(Buffer.from(value).map(b => b ^ 90)), decrypt: value => Buffer.from(value.map(b => b ^ 90)).toString() };
  const secureDir = path.join(dir, 'secure');
  const secure = createHistory({ dir: secureDir, protect: shift });
  secure.add(text('my secret text'));
  assert.ok(!fs.readFileSync(path.join(secureDir, 'history.bin')).toString().includes('my secret text'));
  assert.strictEqual(createHistory({ dir: secureDir, protect: shift }).list().items[0].text, 'my secret text');
  assert.strictEqual(createHistory({ dir: secureDir }).list().total, 0, 'unreadable data starts empty');

  return runMonitor();
}

// The watcher, run with a fake clipboard.
async function runMonitor() {
  require('../src/core/addon-lib');
  const { createMonitor } = require('../addons/clipboard/main/index');
  const history = fresh('monitor');
  const board = { formats: ['text/plain'], text: '', hidden: [] };
  const clipboard = {
    availableFormats: () => board.formats,
    has: format => board.hidden.includes(format),
    readText: () => board.text,
    readBuffer: () => Buffer.alloc(0),
    readImage: () => ({ isEmpty: () => true }),
  };
  let app = 'notepad';
  const monitor = createMonitor({ ctx: { platform: 'test' }, history, clipboard, lookupApp: async () => app, lookupFiles: async () => [] });
  const copy = async (value, hidden = []) => { board.text = value; board.hidden = hidden; await monitor.tick(); };
  const texts = () => history.list().items.map(i => i.text);

  await copy('already there');
  assert.deepStrictEqual(texts(), [], 'what was copied before monitoring is not recorded');
  await copy('hello');
  assert.deepStrictEqual(texts(), ['hello']);
  assert.strictEqual(history.list().items[0].app, 'notepad');
  await monitor.tick();
  assert.strictEqual(history.list().total, 1, 'an unchanged clipboard is not recorded again');

  app = 'keepassxc';
  await copy('in a password manager');
  app = 'notepad';
  await copy('marked private', ['ExcludeClipboardContentFromMonitorProcessing']);
  await copy('marked private on mac', ['org.nspasteboard.ConcealedType']);
  assert.deepStrictEqual(texts(), ['hello'], 'excluded apps and private copies are skipped');

  app = '';
  await copy('unknown app');
  assert.strictEqual(monitor.appsDetected(), false);
  app = 'notepad';
  await copy('known app');
  assert.strictEqual(monitor.appsDetected(), true);

  board.text = 'copied by the tool itself';
  await monitor.acknowledge();
  await monitor.tick();
  assert.strictEqual(history.list({ query: 'itself' }).total, 0, 'copying back does not add a new entry');
}

Promise.resolve().then(run).then(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('clipboard add-on tests passed');
}).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
