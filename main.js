const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/core/store');
const { createHost } = require('./src/core/host');

const RENDERER = path.join(__dirname, 'src', 'renderer', 'index.html');
const approvedDirectories = new Set();
const approvedFiles = new Set();
const activeJobs = new Map();

let mainWindow = null;
let store = null;
let host = null;
const portableMarker = path.join(path.dirname(process.execPath), 'toolhub.portable');
let portableActive = app.isPackaged && (process.argv.includes('--portable') || fs.existsSync(portableMarker));
let pendingOpenFolder = null;

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

function isApprovedPath(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return false;
  let resolved;
  try { resolved = fs.realpathSync.native(target); } catch { return false; }
  if (approvedFiles.has(resolved)) return true;
  return Array.from(approvedDirectories).some(root => isWithin(root, resolved));
}

function validateRendererPaths(params) {
  const pathFields = ['folder', 'root', 'left', 'right', 'roots', 'path', 'paths', 'dir', 'destination', 'outputDir', 'archive'];
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

app.whenReady().then(async () => {
  store = createStore(app.getPath('userData'), process.platform);
  host = createHost({
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
      const cleaner = require('./src/tools/temp-cleaner');
      const result = await cleaner.actions.clean({ ids, permanent: false }, { platform: process.platform, trash: trashItem });
      fs.appendFileSync(path.join(app.getPath('userData'), 'scheduled-cleanup.log'), `${new Date().toISOString()} moved ${result.removed}; skipped ${result.skippedCount}\n`);
      app.exit(0);
    } catch (err) {
      try { fs.appendFileSync(path.join(app.getPath('userData'), 'scheduled-cleanup.log'), `${new Date().toISOString()} failed: ${err.message}\n`); } catch {}
      app.exit(1);
    }
    return;
  }
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

ipcMain.handle('shell:pickFiles', async () => {
  const result = await dialog.showOpenDialog(requireWindow(), {
    properties: ['openFile', 'multiSelections'],
    title: 'Choose files',
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
  return host.catalog();
});

ipcMain.handle('tools:install', (_event, id) => {
  store.install(typeof id === 'string' ? id : '');
  return host.catalog();
});

ipcMain.handle('tools:uninstall', (_event, id) => {
  store.uninstall(typeof id === 'string' ? id : '');
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
