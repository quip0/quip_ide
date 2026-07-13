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

// ---------- AI agent detection + stats ----------
const { execFile } = require('child_process');
const AGENT_RE = /(?:^|[/\s])(claude|codex|aider|goose|opencode|gemini|copilot|cursor-agent|amp)(?:\s|$)/i;
// context-window size guesses by model substring; first match wins
const CTX_WINDOWS = [['[1m]', 1000000], ['fable', 500000], ['', 200000]];
const USAGE_BUDGET = 5000000; // tokens the usage meter is drawn against

function psList() {
  return new Promise((res) => {
    execFile('ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 16 * 1024 * 1024 },
      (_err, out) => res(out || ''));
  });
}

// find an AI agent process among the descendants of a pty's shell
function findAgent(psOut, rootPid) {
  const children = new Map(); // ppid -> [{pid, cmd}]
  for (const line of psOut.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, cmd] = m;
    if (!children.has(+ppid)) children.set(+ppid, []);
    children.get(+ppid).push({ pid: +pid, cmd });
  }
  const queue = [rootPid];
  while (queue.length) {
    for (const c of children.get(queue.shift()) || []) {
      const m = c.cmd.match(AGENT_RE);
      if (m) return m[1].toLowerCase();
      queue.push(c.pid);
    }
  }
  return null;
}

// stats from the newest Claude Code session transcript for this cwd
async function claudeStats(cwd) {
  const dir = path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  let newest = null;
  try {
    for (const name of await fs.promises.readdir(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(dir, name);
      const st = await fs.promises.stat(full);
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { full, mtimeMs: st.mtimeMs, size: st.size };
    }
  } catch { return null; }
  if (!newest) return null;

  // read at most the last 8MB — enough for the running totals to be honest on all but marathon sessions
  const MAX_READ = 8 * 1024 * 1024;
  const start = Math.max(0, newest.size - MAX_READ);
  const fh = await fs.promises.open(newest.full, 'r');
  let text;
  try {
    const buf = Buffer.alloc(newest.size - start);
    await fh.read(buf, 0, buf.length, start);
    text = buf.toString('utf8');
  } finally { await fh.close(); }

  let last = null, totalIn = 0, totalOut = 0;
  for (const line of text.split('\n')) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const u = o?.message?.usage;
    if (!u || u.input_tokens == null) continue;
    last = { u, model: o.message.model || '' };
    totalIn += u.input_tokens || 0;
    totalOut += u.output_tokens || 0;
  }
  if (!last) return null;
  const { u, model } = last;
  const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
             + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
  const max = CTX_WINDOWS.find(([k]) => model.toLowerCase().includes(k))[1];
  return { context: { used, max }, usage: { tokens: totalIn + totalOut, budget: USAGE_BUDGET }, model };
}

ipcMain.handle('agent:stats', async () => {
  if (ptys.size === 0) return null;
  const psOut = await psList();
  for (const { p, cwd } of ptys.values()) {
    const agent = findAgent(psOut, p.pid);
    if (!agent) continue;
    const stats = agent === 'claude' ? await claudeStats(cwd) : null;
    return { agent, ...(stats || {}) };
  }
  return null;
});

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
