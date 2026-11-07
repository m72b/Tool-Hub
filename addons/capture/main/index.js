// Screenshot & Capture: takes screenshots with Electron and keeps them in a history under the app's data folder.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stitch } = require('./stitch');

const FRAME_MS = 200;
const MAX_FRAMES = 400;
const OCR_SLICE = 8000;
const TOOLBAR_HTML = `<!doctype html><meta charset="utf-8"><title>Scrolling capture</title><style>
html,body{margin:0;height:100%;background:#14171f;color:#fff;font:13px system-ui,sans-serif;-webkit-app-region:drag;overflow:hidden}
body{display:flex;align-items:center;gap:10px;padding:0 12px;box-sizing:border-box}span{flex:1}
button{-webkit-app-region:no-drag;background:#4f8cff;border:0;border-radius:6px;color:#fff;font:inherit;padding:6px 12px;cursor:pointer}
</style><span id="t">Scroll slowly, then press Done</span><button id="d">Done</button>`;

const OCR_WINDOWS = `[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
function Await($op,$type){$t=$asTask.MakeGenericMethod($type).Invoke($null,@($op));$t.Wait(-1)|Out-Null;$t.Result}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if(-not $engine){throw 'NOENGINE'}
foreach($img in ($env:TH_FILES -split "\`n")){
  $file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($img)) ([Windows.Storage.StorageFile])
  $stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  foreach($line in $result.Lines){$line.Text}
  $stream.Dispose()
}`;

const WINDOW_SIZE = `$ErrorActionPreference='Stop';
Add-Type -Namespace ToolHub -Name Win -MemberDefinition '[StructLayout(LayoutKind.Sequential)] public struct R{public int L,T,E,B;} [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(System.IntPtr h,int a,out R r,int s);';
[void][ToolHub.Win]::SetProcessDPIAware();$r=New-Object ToolHub.Win+R;
[void][ToolHub.Win]::DwmGetWindowAttribute([System.IntPtr][long]$env:TH_WINDOW,9,[ref]$r,16);
"$($r.E-$r.L) $($r.B-$r.T)"`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;

// ---------- history ----------

function store(ctx) {
  const dir = path.join(ctx.userData, 'capture-toolkit');
  const indexFile = path.join(dir, 'index.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { return []; } };
  const write = items => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${indexFile}.tmp`, JSON.stringify(items));
    fs.renameSync(`${indexFile}.tmp`, indexFile);
  };
  const file = id => path.join(dir, `${id}.png`);
  return { dir, read, write, file };
}

function addCapture(ctx, image, mode, name) {
  const history = store(ctx);
  const { width, height } = image.getSize();
  const png = image.toPNG();
  const id = crypto.randomBytes(8).toString('hex');
  fs.mkdirSync(history.dir, { recursive: true });
  fs.writeFileSync(history.file(id), png);
  const ratio = Math.min(1, 320 / width, 320 / height);
  const thumb = image.resize({ width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)), quality: 'good' }).toDataURL();
  const item = { id, mode, name: String(name || '').slice(0, 120), width, height, size: png.length, createdAt: Date.now(), thumb };
  history.write([item, ...history.read()]);
  return item;
}

function findItem(ctx, id) {
  const item = store(ctx).read().find(entry => entry.id === id);
  if (!item) ctx.lib.safe.fail('That capture is no longer in the history');
  return item;
}

function loadImage(ctx, id) {
  const { nativeImage } = require('electron');
  findItem(ctx, id);
  const image = nativeImage.createFromPath(store(ctx).file(id));
  if (image.isEmpty()) ctx.lib.safe.fail('That capture could not be read');
  return image;
}

// ---------- taking screenshots ----------

function physicalSize(display) {
  return { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
}

async function grabDisplay(display) {
  const { desktopCapturer, screen } = require('electron');
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: physicalSize(display), fetchWindowIcons: false });
  const index = screen.getAllDisplays().findIndex(item => item.id === display.id);
  const source = sources.find(item => item.display_id === String(display.id)) || sources[index] || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Tool Hub could not read the screen. Check that screen recording is allowed for it.');
  return source.thumbnail;
}

// Electron scales window captures to fill the size it is given, so it has to be asked for the window's true size.
async function windowSize(ctx, sourceId) {
  const handle = /^window:(\d+):/.exec(String(sourceId))?.[1];
  if (ctx.platform !== 'win32' || !handle) return null;
  const res = await ctx.lib.safe.powershell(WINDOW_SIZE, { timeout: 15000, env: { TH_WINDOW: handle } });
  const found = /^(\d+) (\d+)/.exec(res.stdout.trim());
  return res.ok && found ? { width: Number(found[1]), height: Number(found[2]) } : null;
}

async function grabWindow(ctx, sourceId) {
  const { desktopCapturer, screen } = require('electron');
  const largest = screen.getAllDisplays().map(physicalSize).reduce((a, b) => ({ width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) }));
  const size = await windowSize(ctx, sourceId) || largest;
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
  const source = sources.find(item => item.id === sourceId);
  if (!source || source.thumbnail.isEmpty()) throw new Error('That window is no longer open');
  return { image: source.thumbnail, name: source.name };
}

// Tool Hub steps out of the way while a capture happens, and always comes back.
async function withHidden(delaySeconds, work) {
  const { BrowserWindow } = require('electron');
  if (busy) throw new Error('A capture is already running');
  busy = true;
  const windows = BrowserWindow.getAllWindows().filter(win => win.isVisible());
  try {
    for (const win of windows) win.hide();
    await sleep(350 + Math.min(30, Math.max(0, Number(delaySeconds) || 0)) * 1000);
    return await work();
  } finally {
    busy = false;
    for (const win of windows) if (!win.isDestroyed()) { win.show(); win.focus(); }
  }
}

function currentDisplay() {
  const { screen } = require('electron');
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

async function pickRegion(display, image) {
  const { BrowserWindow } = require('electron');
  const picker = new BrowserWindow({
    ...display.bounds, frame: false, show: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true, hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    picker.setAlwaysOnTop(true, 'screen-saver');
    await picker.loadFile(path.join(__dirname, 'overlay.html'));
    picker.setBounds(display.bounds);
    picker.show();
    picker.focus();
    const closed = new Promise(resolve => picker.once('closed', () => resolve(null)));
    const chosen = picker.webContents.executeJavaScript(`window.pickRegion(${JSON.stringify(image.toDataURL())})`);
    const rect = await Promise.race([chosen, closed]);
    if (!rect) return null;
    const scale = display.scaleFactor;
    const size = image.getSize();
    const x = Math.round(rect.x * scale);
    const y = Math.round(rect.y * scale);
    return { x, y, width: Math.min(Math.round(rect.width * scale), size.width - x), height: Math.min(Math.round(rect.height * scale), size.height - y) };
  } finally {
    if (!picker.isDestroyed()) picker.destroy();
  }
}

// A small window the user presses when done. It is hidden from screen captures, so it cannot end up in them.
async function showDoneButton(display, area) {
  const { BrowserWindow } = require('electron');
  const width = 320;
  const height = 52;
  const scale = display.scaleFactor;
  const below = display.bounds.y + (area.y + area.height) / scale + 12;
  const bar = new BrowserWindow({
    width, height, x: Math.round(display.bounds.x + Math.max(8, area.x / scale)),
    y: Math.round(below + height < display.bounds.y + display.bounds.height ? below : display.bounds.y + 8),
    frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  bar.setContentProtection(true);
  bar.setAlwaysOnTop(true, 'screen-saver');
  await bar.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TOOLBAR_HTML)}`);
  bar.showInactive();
  const done = Promise.race([
    bar.webContents.executeJavaScript("new Promise(r=>document.getElementById('d').onclick=r)"),
    new Promise(resolve => bar.once('closed', resolve)),
  ]);
  return { bar, done };
}

async function scrollCapture(ctx) {
  const { nativeImage } = require('electron');
  const display = currentDisplay();
  const still = await grabDisplay(display);
  const area = await pickRegion(display, still);
  if (!area) return null;
  const { bar, done } = await showDoneButton(display, area);
  const frames = [];
  let finished = false;
  done.then(() => { finished = true; }, () => { finished = true; });
  try {
    while (!finished && frames.length < MAX_FRAMES) {
      const started = Date.now();
      const image = (await grabDisplay(display)).crop(area);
      const size = image.getSize();
      frames.push({ width: size.width, height: size.height, data: Buffer.from(image.toBitmap()) });
      if (!bar.isDestroyed()) bar.webContents.executeJavaScript(`document.getElementById('t').textContent=${JSON.stringify(`${frames.length} frames. Scroll slowly, then Done`)}`).catch(() => {});
      await sleep(Math.max(0, FRAME_MS - (Date.now() - started)));
    }
  } finally {
    if (!bar.isDestroyed()) bar.destroy();
  }
  const joined = stitch(frames);
  const image = nativeImage.createFromBitmap(joined.data, { width: joined.width, height: joined.height });
  return { item: addCapture(ctx, image, 'scroll', 'Scrolling capture'), frames: frames.length, skipped: joined.skipped };
}

// ---------- text extraction ----------

async function readText(ctx, image) {
  const { safe } = ctx.lib;
  const { width, height } = image.getSize();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-capture-'));
  try {
    const files = [];
    for (let y = 0; y < height; y += OCR_SLICE) {
      const file = path.join(dir, `${y}.png`);
      fs.writeFileSync(file, image.crop({ x: 0, y, width, height: Math.min(OCR_SLICE, height - y) }).toPNG());
      files.push(file);
    }
    if (ctx.platform === 'win32') {
      const res = await safe.powershell(OCR_WINDOWS, { timeout: 180000, maxBuffer: 16 * 1048576, env: { TH_FILES: files.join('\n') } });
      if (!res.ok) safe.fail(/NOENGINE/.test(res.stderr) ? 'Windows has no text recognition language installed. Add one in Settings under Language.' : 'Windows could not read text from this image');
      return res.stdout.trim();
    }
    const lines = [];
    for (const file of files) {
      const res = await safe.run('tesseract', [file, 'stdout'], { timeout: 180000, maxBuffer: 16 * 1048576 });
      if (res.code === 'ENOENT') safe.fail('Install Tesseract OCR to read text from images on this system');
      if (!res.ok) safe.fail('Tesseract could not read text from this image');
      lines.push(res.stdout.trim());
    }
    return lines.join('\n').trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- actions ----------

const actions = {
  async sources() {
    const { desktopCapturer, screen } = require('electron');
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 280, height: 170 }, fetchWindowIcons: false });
    const windows = list.filter(item => !item.thumbnail.isEmpty() && item.name !== 'Tool Hub').map(item => ({ id: item.id, name: item.name, thumb: item.thumbnail.toDataURL() }));
    const displays = screen.getAllDisplays().map((display, index) => ({ id: display.id, name: `Screen ${index + 1}`, ...physicalSize(display) }));
    return { windows, displays };
  },

  async capture(params, ctx) {
    const { screen } = require('electron');
    const mode = params.mode;
    if (mode === 'scroll') {
      return withHidden(params.delay, () => scrollCapture(ctx));
    }
    return withHidden(params.delay, async () => {
      if (mode === 'window') {
        const { image, name } = await grabWindow(ctx, params.source);
        return { item: addCapture(ctx, image, 'window', name) };
      }
      const display = mode === 'screen' ? (screen.getAllDisplays().find(item => item.id === params.display) || screen.getPrimaryDisplay()) : currentDisplay();
      const image = await grabDisplay(display);
      if (mode === 'screen') return { item: addCapture(ctx, image, 'screen', 'Full screen') };
      const area = await pickRegion(display, image);
      return area ? { item: addCapture(ctx, image.crop(area), 'region', 'Region') } : null;
    });
  },

  async history(params, ctx) {
    const items = store(ctx).read();
    return { items, totalSize: items.reduce((sum, item) => sum + item.size, 0) };
  },

  async open(params, ctx) {
    const item = findItem(ctx, params.id);
    const data = fs.readFileSync(store(ctx).file(params.id)).toString('base64');
    return { ...item, image: `data:image/png;base64,${data}` };
  },

  // Saves an edited copy as a new history entry, so the original stays as it was.
  async saveEdited(params, ctx) {
    const { nativeImage } = require('electron');
    const item = findItem(ctx, params.id);
    if (typeof params.image !== 'string' || !params.image.startsWith('data:image/png;base64,')) ctx.lib.safe.fail('The edited image could not be read');
    const image = nativeImage.createFromDataURL(params.image);
    if (image.isEmpty()) ctx.lib.safe.fail('The edited image could not be read');
    return addCapture(ctx, image, item.mode, `${item.name} (edited)`.replace(/( \(edited\))+$/, ' (edited)'));
  },

  async copy(params, ctx) {
    const { clipboard } = require('electron');
    clipboard.writeImage(loadImage(ctx, params.id));
    return { copied: true };
  },

  async exportImage(params, ctx) {
    if (!params.output) ctx.lib.safe.fail('Choose where to save the image');
    const image = loadImage(ctx, params.id);
    const ext = path.extname(params.output).toLowerCase();
    fs.writeFileSync(params.output, ext === '.jpg' || ext === '.jpeg' ? image.toJPEG(92) : image.toPNG());
    return { output: params.output };
  },

  async ocr(params, ctx) {
    return { text: await readText(ctx, loadImage(ctx, params.id)) };
  },

  async remove(params, ctx) {
    const history = store(ctx);
    fs.rmSync(history.file(findItem(ctx, params.id).id), { force: true });
    history.write(history.read().filter(item => item.id !== params.id));
    return { removed: true };
  },

  async clear(params, ctx) {
    fs.rmSync(store(ctx).dir, { recursive: true, force: true });
    return { cleared: true };
  },
};

// Removing the add-on removes the captures with it.
async function onRemove(ctx) {
  fs.rmSync(store(ctx).dir, { recursive: true, force: true });
}

module.exports = { id: 'capture-toolkit', actions, onRemove };
