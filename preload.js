const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('shell:window', 'minimize'),
    maximize: () => ipcRenderer.send('shell:window', 'maximize'),
    close: () => ipcRenderer.send('shell:window', 'close'),
  },
  pickFolder: title => ipcRenderer.invoke('shell:pickFolder', title),
  pickFiles: () => ipcRenderer.invoke('shell:pickFiles'),
  approveDrop: target => ipcRenderer.invoke('shell:approveDrop', target),
  takeOpenFolder: () => ipcRenderer.invoke('shell:takeOpenFolder'),
  onOpenFolder: callback => {
    const listener = (_event, folder) => callback(folder);
    ipcRenderer.on('shell:openFolder', listener);
    return () => ipcRenderer.removeListener('shell:openFolder', listener);
  },
  getPathForFile: file => webUtils.getPathForFile(file),
  portableMode: () => ipcRenderer.invoke('app:portableMode'),
  togglePortable: () => ipcRenderer.invoke('app:togglePortable'),
  reveal: target => ipcRenderer.invoke('shell:reveal', target),
  tools: {
    catalog: () => ipcRenderer.invoke('tools:catalog'),
    setInstalled: (ids, setupComplete) => ipcRenderer.invoke('tools:setInstalled', { ids, setupComplete }),
    install: id => ipcRenderer.invoke('tools:install', id),
    uninstall: id => ipcRenderer.invoke('tools:uninstall', id),
  },
  invoke: (toolId, action, params, options = {}) => ipcRenderer.invoke('tool:invoke', { toolId, action, params, jobId: options.jobId }),
  cancel: jobId => ipcRenderer.invoke('tool:cancel', jobId),
  onProgress: (jobId, callback) => {
    const listener = (_event, message) => { if (message?.jobId === jobId) callback(message.progress); };
    ipcRenderer.on('tool:progress', listener);
    return () => ipcRenderer.removeListener('tool:progress', listener);
  },
});
