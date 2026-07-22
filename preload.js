const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('quip', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readdir: (dir) => ipcRenderer.invoke('fs:readdir', dir),
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p, data) => ipcRenderer.invoke('fs:writeFile', p, data),
  watchDir: (dir) => ipcRenderer.invoke('fs:watch', dir),
  onFsChange: (cb) => ipcRenderer.on('fs:changed', () => cb()),
  // the file as of HEAD, for the git gutter ({ repo:false } outside a repo)
  gitBase: (p) => ipcRenderer.invoke('git:base', p),
  gitLog: (dir) => ipcRenderer.invoke('git:log', dir),
  gitCommitFiles: (dir, hash) => ipcRenderer.invoke('git:commitFiles', dir, hash),

  // :tree visualization window
  openTree: (dir) => ipcRenderer.invoke('tree:open', dir),
  onTreeChanged: (cb) => ipcRenderer.on('tree:changed', () => cb()),
  treeOpenFile: (p) => ipcRenderer.send('tree:openFile', p),
  onTreeOpenFile: (cb) => ipcRenderer.on('tree:openFileInMain', (_e, p) => cb(p)),

  ptyCreate: (opts) => ipcRenderer.invoke('pty:create', opts),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.send('pty:kill', { id }),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, m) => cb(m)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_e, m) => cb(m)),

  jupyterStart: (cwd) => ipcRenderer.invoke('jupyter:start', cwd),

  zoomBy: (delta) => webFrame.setZoomLevel(webFrame.getZoomLevel() + delta),
  zoomReset: () => webFrame.setZoomLevel(0)
});
