const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('quip', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readdir: (dir) => ipcRenderer.invoke('fs:readdir', dir),
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p, data) => ipcRenderer.invoke('fs:writeFile', p, data),

  ptyCreate: (opts) => ipcRenderer.invoke('pty:create', opts),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.send('pty:kill', { id }),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, m) => cb(m)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_e, m) => cb(m)),

  jupyterStart: (cwd) => ipcRenderer.invoke('jupyter:start', cwd),
  agentStats: () => ipcRenderer.invoke('agent:stats'),

  zoomBy: (delta) => webFrame.setZoomLevel(webFrame.getZoomLevel() + delta),
  zoomReset: () => webFrame.setZoomLevel(0)
});
