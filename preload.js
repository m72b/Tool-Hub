const { contextBridge, ipcRenderer } = require('electron');

<<<<<<< Updated upstream
// Expose a safe, controlled API to the renderer (index.html)
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform identifier: 'win32' | 'darwin' | 'linux'
  platform: process.platform,

  // Window controls (custom titlebar)
  winMinimize: () => ipcRenderer.send('win-minimize'),
  winMaximize: () => ipcRenderer.send('win-maximize'),
  winClose:    () => ipcRenderer.send('win-close'),

  // Open a native folder picker dialog; resolves to the selected path or null
  pickFolder: () => ipcRenderer.invoke('pick-folder'),

  // Write renamed files to disk
  // files: Array<{ newName: string, data: string (base64) }>
  // folderPath: string
  saveFiles: (payload) => ipcRenderer.invoke('save-files', payload),
=======
contextBridge.exposeInMainWorld('hub', {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('shell:window', 'minimize'),
    maximize: () => ipcRenderer.send('shell:window', 'maximize'),
    close: () => ipcRenderer.send('shell:window', 'close'),
  },
  pickFolder: title => ipcRenderer.invoke('shell:pickFolder', title),
  pickFiles: () => ipcRenderer.invoke('shell:pickFiles'),
  pickImage: () => ipcRenderer.invoke('shell:pickImage'),
  reveal: target => ipcRenderer.invoke('shell:reveal', target),
  tools: {
    catalog: () => ipcRenderer.invoke('tools:catalog'),
    setInstalled: (ids, setupComplete) => ipcRenderer.invoke('tools:setInstalled', { ids, setupComplete }),
    install: id => ipcRenderer.invoke('tools:install', id),
    uninstall: id => ipcRenderer.invoke('tools:uninstall', id),
  },
  invoke: (toolId, action, params) => ipcRenderer.invoke('tool:invoke', { toolId, action, params }),
>>>>>>> Stashed changes
});
