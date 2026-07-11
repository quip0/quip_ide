const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
const pty = require('node-pty');

// file:// is an insecure context, so Chromium's Private Network Access rules
// would block fetch/ws to the local jupyter server without these:
app.commandLine.appendSwitch('disable-features',
  'PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks');

let win = null;
const ptys = new Map(); // id -> pty
let jupyter = null;     // { proc, url, token }

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#1d2021',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
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
function pythonCandidates() {
  const home = os.homedir();
  const fixed = [
    '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    `${home}/.local/bin/python`,
    `${home}/miniconda3/bin/python`,
    `${home}/anaconda3/bin/python`
  ].filter(p => fs.existsSync(p));
  return [...new Set([...fixed, 'python3', 'python'])];
}

function tryJupyter(py, args, cwd, token) {
  return new Promise((resolve) => {
    let proc;
    try { proc = spawn(py, args, { cwd, env: process.env }); }
    catch (err) { return resolve({ error: String(err) }); }
    let settled = false;
    let buf = '';
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const onOut = async (d) => {
      buf += d.toString();
      const m = buf.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\//);
      if (m && !settled) {
        settled = true; // claim before the async readiness wait
        const url = `http://127.0.0.1:${m[1]}`;
        // the URL is printed before the socket accepts connections — wait for it
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch(`${url}/api/status?token=${token}`);
            if (r.ok) break;
          } catch {}
          await new Promise(r => setTimeout(r, 250));
        }
        jupyter = { proc, url, token };
        proc.removeAllListeners('exit');
        proc.on('exit', () => { jupyter = null; });
        resolve({ url, token });
      }
      if (/No module named/.test(buf)) { try { proc.kill(); } catch {} done({ error: 'no-module' }); }
    };
    proc.stdout.on('data', onOut);
    proc.stderr.on('data', onOut);
    proc.on('error', (err) => done({ error: 'no-module', detail: String(err) }));
    proc.on('exit', () => done({ error: 'jupyter server exited: ' + buf.slice(-400) }));
    setTimeout(() => { try { proc.kill(); } catch {} done({ error: 'jupyter server timed out starting' }); }, 20000);
  });
}

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
    '--ServerApp.allow_origin=*',
    `--ServerApp.root_dir=${cwd || os.homedir()}`
  ];
  const tried = [];
  for (const py of pythonCandidates()) {
    const r = await tryJupyter(py, args, cwd || os.homedir(), token);
    if (r.url) return r;
    tried.push(py);
    if (r.error !== 'no-module') return r; // real failure, not a missing install
  }
  return { error: `jupyter_server not found in any python (tried: ${tried.join(', ')}) — pip install jupyter-server ipykernel` };
});
