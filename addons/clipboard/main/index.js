// Clipboard Manager: watches the system clipboard while Tool Hub runs and keeps a searchable, encrypted history.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createHistory, cleanAppName } = require('./history');

const POLL_MS = 1000;
const PRUNE_MS = 3600000;
// Formats password managers set to say "do not record this".
const PRIVATE_FORMATS = ['ExcludeClipboardContentFromMonitorProcessing', 'Clipboard Viewer Ignore', 'org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType', 'x-kde-passwordManagerHint'];

const FOREGROUND_WINDOWS = "$ErrorActionPreference='Stop';Add-Type -Namespace ToolHub -Name Win -MemberDefinition '[DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);';$id=[uint32]0;[void][ToolHub.Win]::GetWindowThreadProcessId([ToolHub.Win]::GetForegroundWindow(),[ref]$id);(Get-Process -Id $id).ProcessName";

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Name of the app in front, or '' if it cannot be told. Used to skip excluded apps.
async function foregroundApp(ctx) {
  const { safe } = ctx.lib;
  try {
    if (ctx.platform === 'win32') {
      const res = await safe.powershell(FOREGROUND_WINDOWS, { timeout: 5000 });
      return res.ok ? cleanAppName(res.stdout) : '';
    }
    if (ctx.platform === 'darwin') {
      const res = await safe.run('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'], { timeout: 5000 });
      return res.ok ? cleanAppName(res.stdout) : '';
    }
    const win = await safe.run('xdotool', ['getactivewindow', 'getwindowpid'], { timeout: 3000 });
    if (!win.ok) return '';
    const res = await safe.run('ps', ['-p', win.stdout.trim(), '-o', 'comm='], { timeout: 3000 });
    return res.ok ? cleanAppName(res.stdout) : '';
  } catch {
    return '';
  }
}

async function readFiles(ctx, electronClipboard) {
  if (ctx.platform === 'win32') {
    const res = await ctx.lib.safe.powershell('[Console]::OutputEncoding=[Text.Encoding]::UTF8;Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }', { timeout: 5000 });
    return res.ok ? res.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
  }
  const format = ctx.platform === 'darwin' ? 'public.file-url' : 'text/uri-list';
  const raw = electronClipboard.read(format) || '';
  return raw.split(/\r?\n/).filter(line => line.startsWith('file://')).map(line => { try { return require('url').fileURLToPath(line.trim()); } catch { return ''; } }).filter(Boolean);
}

function protector(safeStorage) {
  // Linux without a keyring reports encryption as available but uses a fixed key, which protects nothing.
  const weak = process.platform === 'linux' && safeStorage?.getSelectedStorageBackend?.() === 'basic_text';
  const secure = !weak && !!safeStorage?.isEncryptionAvailable?.();
  if (!secure) return undefined;
  return { secure, encrypt: text => safeStorage.encryptString(text), decrypt: buffer => safeStorage.decryptString(buffer) };
}

// The watcher takes Electron's clipboard as a parameter so tests can run it with a fake one.
function createMonitor({ ctx, history, clipboard, lookupApp = () => foregroundApp(ctx), lookupFiles = () => readFiles(ctx, clipboard) }) {
  let timer = null;
  let pruneTimer = null;
  let lastSignature = null;
  let busy = false;
  let appsDetected = true;

  const has = format => { try { return clipboard.has(format); } catch { return false; } };

  function signature() {
    const formats = clipboard.availableFormats();
    if (formats.includes('text/uri-list') || (ctx.platform === 'win32' && has('FileNameW'))) return { kind: 'files', value: `files:${sha(formats.join() + clipboard.readText())}:${clipboard.readBuffer('FileNameW').length}` };
    // Text comes first: spreadsheets put a picture of the cells on the clipboard next to the text.
    const text = clipboard.readText();
    if (text) return { kind: 'text', value: `text:${sha(text)}`, text };
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const size = image.getSize();
      const bitmap = image.toBitmap();
      // Hashing a sample keeps this cheap: it runs every second, and images can be tens of megabytes.
      const sample = Buffer.alloc(Math.ceil(bitmap.length / 509));
      for (let i = 0; i < sample.length; i++) sample[i] = bitmap[i * 509];
      return { kind: 'image', value: `image:${size.width}x${size.height}:${sha(sample)}` };
    }
    return null;
  }

  async function capture(found) {
    const settings = history.settings();
    const app = await lookupApp();
    appsDetected = !!app;
    if (app && settings.excludedApps.some(name => app.includes(name))) return;
    if (found.kind === 'text') {
      history.add({ type: 'text', text: found.text, size: Buffer.byteLength(found.text), hash: found.value, app });
    } else if (found.kind === 'image') {
      const image = clipboard.readImage();
      const png = image.toPNG();
      const { width, height } = image.getSize();
      const thumb = image.resize({ width: Math.min(160, width), quality: 'good' }).toDataURL();
      history.add({ type: 'image', width, height, size: png.length, thumb, hash: `image:${sha(png)}`, app }, png);
    } else {
      const files = await lookupFiles();
      if (files.length) history.add({ type: 'files', files, size: files.length, hash: `files:${sha(files.join('\n'))}`, app });
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const found = signature();
      const value = found ? found.value : 'empty';
      if (value === lastSignature) return;
      const first = lastSignature === null;
      lastSignature = value;
      // Whatever was on the clipboard before monitoring started is not recorded.
      if (!found || first || PRIVATE_FORMATS.some(has)) return;
      await capture(found);
    } catch (err) {
      console.error(`Clipboard Manager: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) return;
    lastSignature = null;
    tick();
    timer = setInterval(tick, POLL_MS);
    pruneTimer = setInterval(() => { if (history.prune()) history.save(); }, PRUNE_MS);
  }

  function stop() {
    clearInterval(timer);
    clearInterval(pruneTimer);
    timer = null;
    pruneTimer = null;
  }

  // Marks the current clipboard as already seen, after Tool Hub itself wrote to it.
  async function acknowledge() {
    const found = signature();
    lastSignature = found ? found.value : 'empty';
  }

  return { start, stop, tick, acknowledge, running: () => !!timer, appsDetected: () => appsDetected };
}

let instance = null;

function open(ctx) {
  if (instance) return instance;
  const { clipboard, nativeImage, safeStorage } = require('electron');
  const dir = path.join(ctx.userData, 'clipboard-manager');
  const history = createHistory({ dir, protect: protector(safeStorage) });
  instance = { dir, history, clipboard, nativeImage, monitor: createMonitor({ ctx, history, clipboard }) };
  return instance;
}

async function onStart(ctx) {
  const app = open(ctx);
  if (app.history.settings().enabled) app.monitor.start();
}

async function onStop(ctx) {
  open(ctx).monitor.stop();
}

// Removing the add-on removes the history with it, so nothing copied stays behind.
async function onRemove(ctx) {
  const { dir, monitor } = open(ctx);
  monitor.stop();
  instance = null;
  fs.rmSync(dir, { recursive: true, force: true });
}

function status(params, ctx) {
  const { history, monitor } = open(ctx);
  return { revision: history.revision(), monitoring: monitor.running(), settings: history.settings(), collections: history.collections(), encrypted: history.secure, appsDetected: monitor.appsDetected(), count: history.load().items.length };
}

const actions = {
  status: async (params, ctx) => status(params, ctx),

  async setMonitoring(params, ctx) {
    const { history, monitor } = open(ctx);
    const enabled = params.enabled === true;
    history.setSettings({ enabled });
    if (enabled) monitor.start(); else monitor.stop();
    return status(params, ctx);
  },

  async list(params, ctx) {
    return open(ctx).history.list({ query: params.query, type: params.type, collection: params.collection, limit: 200 });
  },

  // Puts an entry back on the clipboard.
  async copy(params, ctx) {
    const { history, clipboard, nativeImage, monitor } = open(ctx);
    const item = history.get(params.id);
    if (!item) ctx.lib.safe.fail('That entry is no longer in the history');
    if (item.type === 'text') clipboard.writeText(item.text);
    else if (item.type === 'image') clipboard.writeImage(nativeImage.createFromBuffer(history.readImage(item)));
    else if (ctx.platform === 'win32') {
      const res = await ctx.lib.safe.powershell("$ErrorActionPreference='Stop';Set-Clipboard -LiteralPath ($env:TH_FILES -split \"`n\")", { env: { TH_FILES: item.files.join('\n') }, timeout: 10000 });
      if (!res.ok) ctx.lib.safe.fail('Those files could not be copied. They may have been moved or deleted.');
    } else {
      const uris = item.files.map(file => require('url').pathToFileURL(file).toString()).join('\n');
      clipboard.writeBuffer(ctx.platform === 'darwin' ? 'public.file-url' : 'text/uri-list', Buffer.from(uris));
    }
    await monitor.acknowledge();
    return { copied: true };
  },

  async setFlags(params, ctx) {
    const { history } = open(ctx);
    const item = history.update(params.id, entry => {
      if (typeof params.pinned === 'boolean') entry.pinned = params.pinned;
      if (typeof params.favorite === 'boolean') entry.favorite = params.favorite;
    });
    if (!item) ctx.lib.safe.fail('That entry is no longer in the history');
    return item;
  },

  async remove(params, ctx) { return { removed: open(ctx).history.remove(params.id) }; },
  async clear(params, ctx) { return { kept: open(ctx).history.clear({ everything: params.everything === true }) }; },
  async addCollection(params, ctx) { return open(ctx).history.addCollection(params.name); },
  async removeCollection(params, ctx) { open(ctx).history.removeCollection(params.id); return { removed: true }; },
  async setCollection(params, ctx) { return open(ctx).history.setCollection(params.id, params.collection, params.member === true); },

  async setSettings(params, ctx) {
    const { enabled, ...change } = params || {};
    return open(ctx).history.setSettings(change);
  },
};

module.exports = { id: 'clipboard-manager', actions, onStart, onStop, onRemove, createMonitor };
