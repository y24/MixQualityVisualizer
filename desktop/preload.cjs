const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mixApp', {
  chooseAudio: multiple => ipcRenderer.invoke('choose-audio', multiple),
  analyze: request => ipcRenderer.invoke('analyze', request),
  cancel: () => ipcRenderer.invoke('cancel'),
  health: () => ipcRenderer.invoke('health'),
  history: () => ipcRenderer.invoke('history'),
  loadHistory: id => ipcRenderer.invoke('load-history', id),
  export: result => ipcRenderer.invoke('export', result),
  demo: () => ipcRenderer.invoke('demo'),
  onProgress: callback => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
});
