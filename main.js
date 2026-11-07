const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { createStore } = require('./src/core/store');
const { createHost } = require('./src/core/host');
const { createAddonManager } = require('./src/core/addons');
const { fetchCatalog, downloadAddon } = require('./src/core/catalog');
const registry = require('./src/core/registry');

const RENDERER = path.join(__dirname, 'src', 'renderer', 'index.html');
const ADDON_SCHEME = 'toolhub-addon';
const approvedDirectories = new Set();
const approvedFiles = new Set();
// Files the user named in a Save dialog; they may not exist yet.
const approvedSaveTargets = new Set();
const pendingAddonInstalls = new Map();
// Downloads only come from entries of the verified catalog, never from links the window supplies.
let catalogEntries = new Map();
const activeJobs = new Map();
let addonManager = null;

// Add-on UI files are served from <userData>/addons through this scheme; it must be registered before "ready".
protocol.registerSchemesAsPrivileged([{ scheme: ADDON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const headlessLaunch = process.argv.includes('--cli') || process.argv.includes('--scheduled-cleanup');
const singleInstanceLock = headlessLaunch || app.requestSingleInstanceLock();

function appendScheduledLog(message) {
  const logPath = path.join(app.getPath('userData'), 'scheduled-cleanup.log');
  let prior = '';
  try { prior = fs.readFileSync(logPath, 'utf8'); } catch {}
  const content = `${prior}${new Date().toISOString()} ${message}\n`;
  fs.writeFileSync(logPath, content.slice(-512 * 1024));
}

let mainWindow = null;
let store = null;
let host = null;
const portableMarker = path.join(path.dirname(process.execPath), 'toolhub.portable');
let portableActive = app.isPackaged && (process.argv.includes('--portable') || fs.existsSync(portableMarker));
let pendingOpenFolder = null;

if (!singleInstanceLock) app.quit();
else if (!headlessLaunch) app.on('second-instance', (_event, commandLine) => {
  const folderIndex = commandLine.indexOf('--open-folder');
  if (folderIndex >= 0) {
    try {
      const folder = approveFolder(commandLine[folderIndex + 1]);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.webContents.isLoading()) pendingOpenFolder = folder;
        else mainWindow.webContents.send('shell:openFolder', folder);
      } else pendingOpenFolder = folder;
    } catch (err) { console.error(`Could not open requested folder: ${err.message}`); }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

if (portableActive) {
  try {
    const portableData = path.join(path.dirname(process.execPath), 'data');
    fs.mkdirSync(portableData, { recursive: true });
    app.setPath('userData', portableData);
    if (!fs.existsSync(portableMarker)) fs.writeFileSync(portableMarker, 'portable\n', { flag: 'wx' });
  } catch (err) { portableActive = false; console.error(`Could not enable portable storage: ${err.message}`); }
}

function createWindow() {
  const appIcon = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0d12',
    ...(fs.existsSync(appIcon) ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Long jobs (PDF rendering, scans) must keep running at full speed when the window is in the background.
      backgroundThrottling: false,
    },
    show: false, // show after ready-to-show for a clean launch
  });

  mainWindow.loadFile(RENDERER);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

}

function requireWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Window is not available');
  return mainWindow;
}

function approveFolder(folder) {
  const resolved = fs.realpathSync.native(folder);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Selected path is not a folder');
  approvedDirectories.add(resolved);
  return resolved;
}

function approveFile(file) {
  const resolved = fs.realpathSync.native(file);
  if (!fs.statSync(resolved).isFile()) throw new Error('Selected path is not a file');
  approvedFiles.add(resolved);
  return resolved;
}

function isWithin(ancestor, candidate) {
  const root = process.platform === 'win32' ? ancestor.toLowerCase() : ancestor;
  const target = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function saveKey(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isApprovedPath(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return false;
  if (approvedSaveTargets.has(saveKey(target))) return true;
  let resolved;
  try { resolved = fs.realpathSync.native(target); }
  catch {
    // A file that does not exist yet (an output) is approved when its folder is inside an approved folder.
    try { resolved = path.join(fs.realpathSync.native(path.dirname(target)), path.basename(target)); } catch { return false; }
    return Array.from(approvedDirectories).some(root => isWithin(root, resolved));
  }
  if (approvedFiles.has(resolved)) return true;
  return Array.from(approvedDirectories).some(root => isWithin(root, resolved));
}

function validateRendererPaths(params) {
  const pathFields = ['folder', 'root', 'left', 'right', 'roots', 'path', 'paths', 'dir', 'source', 'destination', 'outputDir', 'archive', 'output', 'compare'];
  for (const field of pathFields) {
    const value = params[field];
    if (typeof value === 'string' && value.length > 0) {
      if (!isApprovedPath(value)) throw new Error('Choose this folder or file using the app picker first');
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string' || !isApprovedPath(item)) throw new Error('Choose each folder or file using the app picker first');
      }
    }
  }
}

async function trashItem(target) {
  await shell.trashItem(target);
}

if (singleInstanceLock) app.whenReady().then(async () => {
  addonManager = createAddonManager({ userData: app.getPath('userData'), appVersion: app.getVersion() });
  addonManager.installBundled(app.isPackaged ? path.join(process.resourcesPath, 'addons') : path.join(__dirname, 'dist', 'bundled'));
  try { registry.setAddonTools(addonManager.tools()); } catch (err) { console.error(`Could not load add-ons: ${err.message}`); }
  protocol.handle(ADDON_SCHEME, request => {
    const url = new URL(request.url);
    const file = addonManager.resolveFile(url.hostname, decodeURIComponent(url.pathname.replace(/^\/+/, '')));
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  store = createStore(app.getPath('userData'), process.platform);
  store.syncAddonTools(addonManager.tools().map(tool => tool.id));
  host = createHost({
    addons: addonManager,
    store,
    platform: process.platform,
    userData: app.getPath('userData'),
    trash: trashItem,
    executable: process.execPath,
    packaged: app.isPackaged,
  });
  const openFolderIndex = process.argv.indexOf('--open-folder');
  if (openFolderIndex >= 0) { try { pendingOpenFolder = approveFolder(process.argv[openFolderIndex + 1]); } catch {} }
  const cliIndex = process.argv.indexOf('--cli');
  if (cliIndex >= 0) {
    try { await require('./cli').main(process.argv.slice(cliIndex + 1)); app.exit(process.exitCode || 0); }
    catch (err) { console.error(`Tool Hub CLI: ${err.message}`); app.exit(1); }
    return;
  }
  const scheduledIndex = process.argv.indexOf('--scheduled-cleanup');
  if (scheduledIndex >= 0) {
    const ids = String(process.argv[scheduledIndex + 1] || '').split(',').filter(Boolean);
    try {
      const modulePath = registry.getTool('temp-cleaner')?.modulePath;
      if (!modulePath) throw new Error('The Cleanup Tools add-on is not installed');
      require('./src/core/addon-lib');
      const cleaner = require(modulePath);
      const result = await cleaner.actions.clean({ ids, permanent: false }, { platform: process.platform, trash: trashItem });
      appendScheduledLog(`moved ${result.removed} to Recycle Bin; skipped ${result.skippedCount}`);
      app.exit(0);
    } catch (err) {
      try { appendScheduledLog(`failed: ${err.message}`); } catch {}
      app.exit(1);
    }
    return;
  }
  host.syncBackground();
  createWindow();
  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('shell:window', (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  } else if (action === 'close') mainWindow.close();
});

ipcMain.handle('shell:pickFolder', async (_event, title) => {
  const result = await dialog.showOpenDialog(requireWindow(), {
    properties: ['openDirectory'],
    title: typeof title === 'string' && title ? title.slice(0, 120) : 'Choose a folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return approveFolder(result.filePaths[0]);
});

function dialogFilters(raw) {
  if (!Array.isArray(raw)) return undefined;
  const filters = raw.slice(0, 8).map(item => ({
    name: String(item?.name || 'Files').slice(0, 60),
    extensions: (Array.isArray(item?.extensions) ? item.extensions : []).map(ext => String(ext).replace(/[^a-z0-9*]/gi, '').slice(0, 10)).filter(Boolean).slice(0, 20),
  })).filter(item => item.extensions.length);
  return filters.length ? filters : undefined;
}

ipcMain.handle('shell:pickFiles', async (_event, options) => {
  const opts = options && typeof options === 'object' ? options : {};
  const result = await dialog.showOpenDialog(requireWindow(), {
    properties: opts.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'],
    title: typeof opts.title === 'string' && opts.title ? opts.title.slice(0, 120) : 'Choose files',
    filters: dialogFilters(opts.filters),
  });
  if (result.canceled) return [];
  return result.filePaths.map(filePath => {
    filePath = approveFile(filePath);
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      ext: path.extname(filePath).slice(1).toLowerCase(),
      size: stat.size,
      mtime: stat.mtimeMs,
      dir: path.dirname(filePath),
    };
  });
});

ipcMain.handle('shell:saveFile', async (_event, options) => {
  const opts = options && typeof options === 'object' ? options : {};
  const defaultName = typeof opts.defaultName === 'string' ? opts.defaultName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) : undefined;
  const result = await dialog.showSaveDialog(requireWindow(), {
    title: typeof opts.title === 'string' && opts.title ? opts.title.slice(0, 120) : 'Save file',
    defaultPath: defaultName ? path.join(app.getPath('documents'), defaultName) : undefined,
    filters: dialogFilters(opts.filters),
  });
  if (result.canceled || !result.filePath) return null;
  approvedSaveTargets.add(saveKey(result.filePath));
  return path.resolve(result.filePath);
});

ipcMain.handle('addons:list', () => ({ addons: addonManager.list(), keys: addonManager.trustedKeys(), offline: store.load().offline }));

ipcMain.handle('addons:catalog', async () => {
  if (store.load().offline) return { ok: true, offline: true, entries: [] };
  try {
    const entries = await fetchCatalog({ fetchImpl: net.fetch.bind(net), builtInKeys: addonManager.trustedKeys().filter(key => key.builtIn) });
    catalogEntries = new Map(entries.map(entry => [entry.id, entry]));
    return { ok: true, entries };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('addons:download', async (event, ids) => {
  const wanted = (Array.isArray(ids) ? ids : []).map(id => catalogEntries.get(id)).filter(Boolean);
  if (!wanted.length) return { ok: false, error: 'Choose at least one add-on' };
  const failed = [];
  let installed = 0;
  for (const entry of wanted) {
    try {
      const buffer = await downloadAddon({
        fetchImpl: net.fetch.bind(net),
        entry,
        onProgress: progress => { if (!event.sender.isDestroyed()) event.sender.send('addons:progress', progress); },
      });
      addonManager.install(buffer);
      installed++;
    } catch (err) { failed.push({ id: entry.id, name: entry.name, error: err.message }); }
  }
  if (installed) relaunchSoon();
  return { ok: failed.length === 0, installed, failed, restarting: installed > 0 };
});

ipcMain.handle('addons:setOffline', (_event, offline) => store.setOffline(offline === true).offline);
ipcMain.handle('addons:finishSetup', () => { store.markSectionsChosen(); return host.catalog(); });

ipcMain.handle('addons:pick', async () => {
  const result = await dialog.showOpenDialog(requireWindow(), {
    properties: ['openFile'],
    title: 'Choose a Tool Hub add-on',
    filters: [{ name: 'Tool Hub add-on', extensions: ['thaddon'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const buffer = fs.readFileSync(result.filePaths[0]);
    const info = addonManager.inspect(buffer);
    const token = crypto.randomBytes(16).toString('hex');
    pendingAddonInstalls.clear();
    pendingAddonInstalls.set(token, buffer);
    return { ok: true, token, info, file: path.basename(result.filePaths[0]) };
  } catch (err) { return { ok: false, error: err.message }; }
});

function relaunchSoon() {
  setTimeout(() => { app.relaunch(); app.exit(0); }, 400);
}

ipcMain.handle('addons:install', (_event, token) => {
  const buffer = pendingAddonInstalls.get(token);
  pendingAddonInstalls.delete(token);
  if (!buffer) return { ok: false, error: 'Choose the add-on file again' };
  try { const addon = addonManager.install(buffer); relaunchSoon(); return { ok: true, addon }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('addons:remove', async (_event, id) => {
  try { await host.beforeRemove(String(id || '')); addonManager.remove(String(id || '')); relaunchSoon(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('addons:trustKey', (_event, payload) => {
  try { return { ok: true, keys: addonManager.trustKey(payload?.name, payload?.publicKey) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('addons:untrustKey', (_event, id) => {
  try { return { ok: true, keys: addonManager.untrustKey(String(id || '')) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('shell:approveDrop', async (_event, target) => {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return null;
  try { return approveFolder(target); } catch { return null; }
});
ipcMain.handle('shell:takeOpenFolder', () => { const folder = pendingOpenFolder; pendingOpenFolder = null; return folder; });

ipcMain.handle('shell:reveal', async (_event, target) => {
  if (!isApprovedPath(target)) return false;
  shell.showItemInFolder(target);
  return true;
});

ipcMain.handle('tools:catalog', () => host.catalog());

ipcMain.handle('tools:setInstalled', (_event, payload) => {
  const ids = payload && Array.isArray(payload.ids) ? payload.ids : [];
  const complete = payload ? payload.setupComplete : undefined;
  store.setInstalled(ids, complete);
  host.syncBackground();
  return host.catalog();
});

ipcMain.handle('tools:install', (_event, id) => {
  store.install(typeof id === 'string' ? id : '');
  host.syncBackground();
  return host.catalog();
});

ipcMain.handle('tools:uninstall', (_event, id) => {
  store.uninstall(typeof id === 'string' ? id : '');
  host.syncBackground();
  return host.catalog();
});

ipcMain.handle('tool:invoke', async (_event, payload) => {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid request' };
  const { toolId, action, params } = payload;
  if (typeof toolId !== 'string' || typeof action !== 'string') return { ok: false, error: 'Invalid request' };
  try { validateRendererPaths(params || {}); }
  catch (err) { return { ok: false, error: err.message }; }
  const jobId = typeof payload.jobId === 'string' ? payload.jobId.slice(0, 120) : '';
  const controller = jobId ? new AbortController() : null;
  if (controller) activeJobs.set(jobId, { controller, sender: _event.sender.id });
  try {
    return await host.invoke(toolId, action, params, {
      signal: controller?.signal,
      progress: progress => { if (!controller?.signal.aborted && !_event.sender.isDestroyed()) _event.sender.send('tool:progress', { jobId, progress }); },
    });
  } finally { if (controller) activeJobs.delete(jobId); }
});

ipcMain.handle('tool:cancel', (event, rawId) => {
  const jobId = typeof rawId === 'string' ? rawId.slice(0, 120) : '';
  const job = activeJobs.get(jobId);
  if (!job || job.sender !== event.sender.id) return false;
  job.controller.abort();
  return true;
});

ipcMain.handle('shell:platform', () => process.platform);
ipcMain.handle('app:portableMode', () => ({ supported: app.isPackaged, enabled: portableActive }));
ipcMain.handle('app:togglePortable', () => {
  if (!app.isPackaged) return { ok: false, error: 'Portable mode is available in the installed app only' };
  try {
    if (portableActive) {
      const standardData = path.join(app.getPath('appData'), app.getName());
      fs.mkdirSync(standardData, { recursive: true });
      fs.cpSync(app.getPath('userData'), standardData, { recursive: true, force: true });
      fs.rmSync(portableMarker, { force: true });
    } else {
      const portableData = path.join(path.dirname(app.getPath('exe')), 'data');
      fs.mkdirSync(portableData, { recursive: true });
      fs.cpSync(app.getPath('userData'), portableData, { recursive: true, force: true });
      fs.writeFileSync(portableMarker, 'portable\n', { flag: 'wx' });
    }
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
