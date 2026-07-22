const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
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
  for (const { p } of ptys.values()) { try { p.kill(); } catch {} }
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

// Watch the open folder so the tree reflects files added/removed on disk
// (e.g. by an agent in the terminal). One active watcher; debounced.
let treeWatcher = null;
ipcMain.handle('fs:watch', (e, dir) => {
  if (treeWatcher) { try { treeWatcher.close(); } catch {} treeWatcher = null; }
  if (!dir) return;
  let timer = null;
  try {
    treeWatcher = fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!e.sender.isDestroyed()) e.sender.send('fs:changed');
      }, 120);
    });
  } catch { treeWatcher = null; }
});

// ---------- git ----------
// The renderer asks for a file as of HEAD and diffs it against the live buffer
// itself, so the gutter shows uncommitted work — an agent's edits included —
// without waiting for a save.
const GIT_MAX = 4 * 1024 * 1024; // don't ship huge/binary blobs to the renderer
const gitRoots = new Map();      // dir -> repo root | null

function gitRun(args, cwd, opts = {}) {
  return new Promise((res) => {
    execFile('git', args, { cwd, maxBuffer: GIT_MAX, ...opts },
      (err, out) => res(err ? null : out));
  });
}

async function gitRoot(dir) {
  if (gitRoots.has(dir)) return gitRoots.get(dir);
  const out = await gitRun(['rev-parse', '--show-toplevel'], dir);
  const root = out ? out.trim() : null;
  gitRoots.set(dir, root);
  return root;
}

ipcMain.handle('git:base', async (_e, file) => {
  const dir = path.dirname(file);
  let root;
  try { root = await gitRoot(dir); } catch { root = null; }
  if (!root) return { repo: false };
  const rel = path.relative(root, file).split(path.sep).join('/');
  const out = await gitRun(['show', `HEAD:${rel}`], root);
  // no blob at HEAD: the file is new (or newly tracked) — everything is added
  if (out == null) return { repo: true, text: '' };
  if (out.includes('\0')) return { repo: false }; // binary
  return { repo: true, text: out };
});

// Commit history for the :tree panel. The working tree comes back alongside the
// commits so the panel can show what is uncommitted as the newest "commit".
const LOG_LIMIT = 400;
const F = '\x1f'; // field separator inside a log record

ipcMain.handle('git:log', async (_e, dir) => {
  const root = await gitRoot(dir);
  if (!root) return { repo: false };
  const fmt = ['%H', '%h', '%P', '%an', '%ar', '%D', '%s'].join('%x1f');
  const [log, status, branch] = await Promise.all([
    gitRun(['log', `--pretty=format:${fmt}`, '-n', String(LOG_LIMIT), 'HEAD'], root),
    gitRun(['-c', 'core.quotepath=false', 'status', '--porcelain'], root),
    gitRun(['rev-parse', '--abbrev-ref', 'HEAD'], root)
  ]);
  const commits = (log || '').split('\n').filter(Boolean).map((line) => {
    const [h, short, parents, an, ar, refs, subj] = line.split(F);
    return { h, short, parents: parents ? parents.split(' ') : [], an, ar, refs, subj };
  });
  // a rename reads "R  old -> new"; the new name is the one worth opening
  const changed = (status || '').split('\n').filter(Boolean).map((l) => ({
    st: l.slice(0, 2).trim() || '?', path: l.slice(3).trim().split(' -> ').pop()
  }));
  return { repo: true, root, branch: (branch || '').trim(), commits, changed };
});

ipcMain.handle('git:commitFiles', async (_e, dir, hash) => {
  const root = await gitRoot(dir);
  if (!root) return [];
  const out = await gitRun(['-c', 'core.quotepath=false', 'show', '--name-status', '--pretty=format:', hash], root);
  return (out || '').split('\n').filter(Boolean).map((l) => {
    const [st, ...rest] = l.split('\t');
    return { st, path: rest[rest.length - 1] };
  });
});

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
  ptys.set(id, { p, cwd: cwd || os.homedir() });
  const wc = e.sender;
  p.onData(d => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data: d }); });
  p.onExit(() => { ptys.delete(id); if (!wc.isDestroyed()) wc.send('pty:exit', { id }); });
  return id;
});
ipcMain.on('pty:write', (_e, { id, data }) => ptys.get(id)?.p.write(data));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => { try { ptys.get(id)?.p.resize(cols, rows); } catch {} });
ipcMain.on('pty:kill', (_e, { id }) => { try { ptys.get(id)?.p.kill(); } catch {} ptys.delete(id); });

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

// True on Apple Silicon even when this process runs x86_64 under Rosetta
// (in which case process.arch lies and reports 'x64').
function isAppleSilicon() {
  if (process.platform !== 'darwin') return false;
  if (process.arch === 'arm64') return true;
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated']).toString().trim() === '1';
  } catch { return false; }
}

function tryJupyter(py, args, cwd, token) {
  return new Promise((resolve) => {
    let proc;
    // On Apple Silicon the server (and the kernels it spawns) can end up running
    // under Rosetta/x86_64, which then can't load arm64-compiled wheels
    // (numpy/scipy/rpds/…). Force the native arm64 slice so the arch of the
    // kernel matches the installed packages.
    let cmd = py, cmdArgs = args;
    if (isAppleSilicon()) {
      cmd = '/usr/bin/arch';
      cmdArgs = ['-arm64', py, ...args];
    }
    try { proc = spawn(cmd, cmdArgs, { cwd, env: process.env }); }
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
