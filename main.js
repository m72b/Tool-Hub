const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/core/store');
const { createHost } = require('./src/core/host');

<<<<<<< Updated upstream
// Keep a global reference to prevent garbage collection
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    frame: process.platform === 'darwin', // native frame on macOS, custom on Windows/Linux
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#000000',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
=======
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
>>>>>>> Stashed changes
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    show: false, // show after ready-to-show for a clean launch
  });

<<<<<<< Updated upstream
  mainWindow.loadFile('index.html');

  // Show once fully rendered
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
=======
  mainWindow.loadFile(RENDERER);
  mainWindow.once('ready-to-show', () => mainWindow.show());
>>>>>>> Stashed changes

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
<<<<<<< Updated upstream
=======

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  if (process.platform === 'win32') {
    mainWindow.on('maximize', () => {
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      mainWindow.setBounds(display.workArea);
    });
  }
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Window controls (for custom titlebar on Windows/Linux)
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
=======
ipcMain.on('shell:window', (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  } else if (action === 'close') mainWindow.close();
>>>>>>> Stashed changes
});

<<<<<<< Updated upstream
// Folder picker
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
=======
ipcMain.handle('shell:pickFolder', async (_event, title) => {
  const result = await dialog.showOpenDialog(requireWindow(), {
>>>>>>> Stashed changes
    properties: ['openDirectory', 'createDirectory'],
    title: typeof title === 'string' && title ? title.slice(0, 120) : 'Choose a folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

<<<<<<< Updated upstream
// Save renamed files to disk
ipcMain.handle('save-files', async (_event, { files, folderPath }) => {
  let success = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const destPath = path.join(folderPath, file.newName);
      // Decode base64 → buffer → write
      const buffer = Buffer.from(file.data, 'base64');
      fs.writeFileSync(destPath, buffer);
      success++;
    } catch (err) {
      console.error('Failed to save file:', file.newName, err);
      failed++;
    }
  }

  return { success, failed };
});

// Expose platform string to renderer
ipcMain.handle('get-platform', () => process.platform);
=======
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
>>>>>>> Stashed changes
