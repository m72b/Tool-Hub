const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/core/store');
const { createHost } = require('./src/core/host');

const RENDERER = path.join(__dirname, 'src', 'renderer', 'index.html');
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const IMAGE_MAX = 8 * 1024 * 1024;

let mainWindow = null;
let store = null;
let host = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0d12',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
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

async function trashItem(target) {
  await shell.trashItem(target);
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'), process.platform);
  host = createHost({
    store,
    platform: process.platform,
    userData: app.getPath('userData'),
    trash: trashItem,
  });
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
    properties: ['openDirectory', 'createDirectory'],
    title: typeof title === 'string' && title ? title.slice(0, 120) : 'Choose a folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:pickFiles', async () => {
  const result = await dialog.showOpenDialog(requireWindow(), {
    properties: ['openFile', 'multiSelections'],
    title: 'Choose files',
  });
  if (result.canceled) return [];
  return result.filePaths.map(filePath => {
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

ipcMain.handle('shell:pickImage', async () => {
  const result = await dialog.showOpenDialog(requireWindow(), {
    title: 'Choose a background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: Object.keys(IMAGE_MIME) }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) return { ok: false, error: 'Unsupported image type' };
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return { ok: false, error: 'Not a file' };
  if (stat.size > IMAGE_MAX) return { ok: false, error: 'Image is larger than 8MB' };
  const data = fs.readFileSync(filePath);
  return { ok: true, dataUrl: `data:${mime};base64,${data.toString('base64')}`, name: path.basename(filePath) };
});

ipcMain.handle('shell:reveal', async (_event, target) => {
  if (typeof target !== 'string' || target.length === 0) return false;
  if (!fs.existsSync(target)) return false;
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
  return host.invoke(toolId, action, params);
});

ipcMain.handle('shell:platform', () => process.platform);
