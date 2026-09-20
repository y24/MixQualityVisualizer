const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mixApp', {
  engineStatus: () => ipcRenderer.invoke('engine-status'),
  installEngine: options => ipcRenderer.invoke('engine-install', options),
  selectEngine: () => ipcRenderer.invoke('engine-select'),
  onEngineProgress: callback => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('engine-progress', handler);
    return () => ipcRenderer.removeListener('engine-progress', handler);
  },
  chooseAudio: multiple => ipcRenderer.invoke('choose-audio', multiple),
  analyze: request => ipcRenderer.invoke('analyze', request),
  cancel: () => ipcRenderer.invoke('cancel'),
  health: () => ipcRenderer.invoke('health'),
  history: () => ipcRenderer.invoke('history'),
  loadHistory: id => ipcRenderer.invoke('load-history', id),
  removeHistory: ids => ipcRenderer.invoke('remove-history', ids),
  export: result => ipcRenderer.invoke('export', result),
  demo: () => ipcRenderer.invoke('demo'),
  onProgress: callback => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
});
