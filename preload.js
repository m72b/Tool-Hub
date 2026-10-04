const { contextBridge, ipcRenderer } = require('electron');

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
});
