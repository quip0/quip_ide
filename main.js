const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
const pty = require('node-pty');

let win = null;
const ptys = new Map(); // id -> pty
let jupyter = null;     // { proc, url, token }

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  // Minimal menu so cmd+c/v/q etc still work; no visible chrome beyond that.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  for (const p of ptys.values()) { try { p.kill(); } catch {} }
  if (jupyter) { try { jupyter.proc.kill(); } catch {} }
});

// ---------- dialogs / fs ----------
ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('fs:readdir', async (_e, dir) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => e.name !== '.git' && e.name !== 'node_modules' && e.name !== '__pycache__')
    .map(e => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
});

ipcMain.handle('fs:readFile', (_e, p) => fs.promises.readFile(p, 'utf8'));
ipcMain.handle('fs:writeFile', (_e, p, data) => fs.promises.writeFile(p, data, 'utf8'));

// ---------- terminal ----------
ipcMain.handle('pty:create', (e, { cwd, cols, rows }) => {
  const id = crypto.randomUUID();
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const p = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cwd: cwd || os.homedir(),
    cols: cols || 80,
    rows: rows || 24,
    env: process.env
  });
  ptys.set(id, p);
  const wc = e.sender;
  p.onData(d => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data: d }); });
  p.onExit(() => { ptys.delete(id); if (!wc.isDestroyed()) wc.send('pty:exit', { id }); });
  return id;
});
ipcMain.on('pty:write', (_e, { id, data }) => ptys.get(id)?.write(data));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => { try { ptys.get(id)?.resize(cols, rows); } catch {} });
ipcMain.on('pty:kill', (_e, { id }) => { try { ptys.get(id)?.kill(); } catch {} ptys.delete(id); });

// ---------- jupyter server (for ipynb execution) ----------
ipcMain.handle('jupyter:start', async (_e, cwd) => {
  if (jupyter) return { url: jupyter.url, token: jupyter.token };
  const token = crypto.randomBytes(24).toString('hex');
  const port = 18888 + Math.floor(Math.random() * 1000);
  const args = [
    '-m', 'jupyter_server',
    '--no-browser',
    `--ServerApp.port=${port}`,
    '--ServerApp.port_retries=50',
    `--ServerApp.token=${token}`,
    '--ServerApp.password=',
    '--ServerApp.disable_check_xsrf=True',
    `--ServerApp.root_dir=${cwd || os.homedir()}`
  ];
  const candidates = ['python3', 'python'];
  let proc = null, lastErr = null;
  for (const py of candidates) {
    try {
      proc = spawn(py, args, { cwd: cwd || os.homedir(), env: process.env });
      break;
    } catch (err) { lastErr = err; }
  }
  if (!proc) return { error: String(lastErr) };

  return new Promise((resolve) => {
    let settled = false;
    let buf = '';
    const onOut = (d) => {
      buf += d.toString();
      const m = buf.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\//);
      if (m && !settled) {
        settled = true;
        jupyter = { proc, url: `http://127.0.0.1:${m[1]}`, token };
        resolve({ url: jupyter.url, token });
      }
      if (/No module named/.test(buf) && !settled) {
        settled = true;
        resolve({ error: 'jupyter_server not installed (pip install jupyter-server ipykernel)' });
      }
    };
    proc.stdout.on('data', onOut);
    proc.stderr.on('data', onOut);
    proc.on('exit', () => {
      jupyter = null;
      if (!settled) { settled = true; resolve({ error: 'jupyter server exited: ' + buf.slice(-400) }); }
    });
    setTimeout(() => { if (!settled) { settled = true; resolve({ error: 'jupyter server timed out starting' }); } }, 20000);
  });
});
