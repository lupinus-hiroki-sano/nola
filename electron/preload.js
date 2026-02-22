const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  newDoc: () => ipcRenderer.invoke('new-doc'),
  openDoc: () => ipcRenderer.invoke('open-doc'),
  saveImage: (bytes, ext) => ipcRenderer.invoke('save-image', bytes, ext),
  saveDocJson: (json) => ipcRenderer.invoke('save-doc-json', json),
  saveNola: (json) => ipcRenderer.invoke('save-nola', json),
  saveNolaAs: (json) => ipcRenderer.invoke('save-nola-as', json),
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },
  onLoadDocument: (callback) => {
    ipcRenderer.on('load-document', (_event, data) => callback(data));
  },
});
