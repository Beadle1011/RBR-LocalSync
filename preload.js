const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, data) => callback(data)),
  onSwitchMode: (callback) => ipcRenderer.on('switch-mode', (event, mode) => callback(mode)),
  requestFolder: () => ipcRenderer.send('request-folder'),
  fileDropped: (filePath) => ipcRenderer.send('file-dropped', filePath),
  switchToNormal: () => ipcRenderer.send('switch-to-normal')
});
