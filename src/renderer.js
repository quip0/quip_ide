import './style.css';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { indentUnit, bracketMatching } from '@codemirror/language';
import { gruvboxHighlight, gruvboxEditorTheme } from './theme.js';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { rust } from '@codemirror/lang-rust';
import { FileTree } from './tree.js';
import { Term } from './term.js';
import { Notebook } from './notebook.js';
import { startCat } from './cat.js';
import { Calendar } from './cal.js';
import { startAgentMeter } from './agentmeter.js';
import { THEMES, DEFAULT_THEME, applyThemeVars, termThemeOf, activeThemeName } from './themes.js';

const $ = (id) => document.getElementById(id);
const els = {
  tree: $('tree'), welcome: $('welcome'), editor: $('editor'), tabs: $('tabs'),
  content: $('content'), termwrap: $('termwrap'), term: $('term'),
  split: $('split'), splitPh: $('split-placeholder'), splitEd: $('split-editor'), splitTermEl: $('split-term'),
  statusL: $('status-left'), statusR: $('status-right'), statusM: $('status-mode'), statusP: $('status-project'),
  cheat: $('cheat-overlay'), cheatPanel: $('cheat-panel')
};

const state = {
  folder: null,
  tabs: [],          // [{ path }]
  active: null,      // active path
  treeVisible: false,
  termVisible: false
};
let leader = false;           // '\' pressed, waiting for the chord key
const split = { open: false, pending: false, kind: null, path: null, nb: null };
const textStates = new Map(); // path -> EditorState (preserves undo history)
const notebooks = new Map();  // path -> { nb: Notebook, el }
const dirtyMap = new Map();   // path -> bool

const isNb = (p) => p.endsWith('.ipynb');
const base = (p) => p.split('/').pop();

// ---------- projects ----------
// Each opened folder is a project with its own tabs, tree root and terminals.
// Terminals (ptys) and notebook kernels belong to the project and KEEP RUNNING
// while another project is in the foreground — only their DOM is hidden.
const projects = []; // [{ name, folder, tabs, active, treeVisible, termVisible, term, termEl, splitTerm, splitTermEl }]
let curProj = -1;
const curP = () => projects[curProj] || null;

function makeProject(folder) {
  const termEl = document.createElement('div');
  termEl.className = 'term-inst hidden';
  els.term.appendChild(termEl);
  const splitTermEl = document.createElement('div');
  splitTermEl.className = 'term-inst hidden';
  els.splitTermEl.appendChild(splitTermEl);
  return {
    folder, name: folder ? base(folder) : '~',
    tabs: [], active: null, treeVisible: !!folder, termVisible: false,
    term: null, termEl, splitTerm: null, splitTermEl
  };
}

function mainTerm() {
  const p = curP();
  if (!p) return null;
  if (!p.term) p.term = new Term(p.termEl);
  return p.term;
}

function updateStatusProject() {
  const p = curP();
  els.statusP.textContent = p ? (projects.length > 1 ? `${curProj + 1}·${p.name}` : p.name) : '';
}

function snapshotCurrent() {
  const p = curP();
  if (!p) return;
  stashActive();
  p.tabs = state.tabs;
  p.active = state.active;
  p.treeVisible = state.treeVisible;
  p.termVisible = state.termVisible;
}

async function switchProject(i) {
  const p = projects[i];
  if (!p || i === curProj) return;
  snapshotCurrent();
  if (split.open) closeSplit(); // pane content is stashed; project terms survive
  curProj = i;
  state.folder = p.folder;
  state.tabs = p.tabs;
  state.active = null;
  state.treeVisible = p.treeVisible;
  state.termVisible = p.termVisible;
  if (p.folder) await tree.setRoot(p.folder);
  els.tree.classList.toggle('hidden', !p.treeVisible);
  for (const q of projects) q.termEl.classList.toggle('hidden', q !== p);
  els.termwrap.classList.toggle('hidden', !p.termVisible);
  if (p.termVisible && p.term) p.term.resize();
  if (p.active) await activate(p.active);
  else { showOnly('welcome'); renderTabs(); updateStatusRight(); }
  updateStatusProject();
  setStatus(p.folder || '');
}

function cycleProject() {
  if (projects.length < 2) { setStatus('only one project open — ⌘O to add another'); return; }
  switchProject((curProj + 1) % projects.length);
}

function listProjects() {
  if (!projects.length) return setStatus('no projects — ⌘O to open a folder');
  setStatus(projects.map((p, i) => `${i === curProj ? '<b>' : ''}${i + 1}:${p.name}${i === curProj ? '</b>' : ''}`).join('&nbsp;&nbsp;'));
}

function closeProject() {
  const p = curP();
  if (!p) return setStatus('no project open');
  confirmStatus(`close project ${p.name}?`, () => doCloseProject(curProj));
}

async function doCloseProject(i) {
  const p = projects[i];
  snapshotCurrent();
  if (split.open) closeSplit();
  for (const t of p.tabs) {
    textStates.delete(t.path);
    dirtyMap.delete(t.path);
    const nb = notebooks.get(t.path);
    if (nb) { nb.nb.restartKernel(); nb.el.remove(); notebooks.delete(t.path); }
  }
  if (p.term?.id) window.quip.ptyKill(p.term.id);
  if (p.splitTerm?.id) window.quip.ptyKill(p.splitTerm.id);
  p.termEl.remove();
  p.splitTermEl.remove();
  projects.splice(i, 1);
  curProj = -1;
  if (projects.length) return switchProject(Math.min(i, projects.length - 1));
  state.folder = null; state.tabs = []; state.active = null;
  state.treeVisible = false; state.termVisible = false;
  els.tree.classList.add('hidden');
  els.termwrap.classList.add('hidden');
  showOnly('welcome'); renderTabs(); updateStatusRight(); updateStatusProject();
  setStatus(`closed ${p.name} — ⌘O to open a folder`);
}

function setStatus(left) { els.statusL.innerHTML = left || ''; }

// status-bar confirmation: swallows keys until y (confirm) or n/Esc (cancel)
function confirmStatus(msg, onYes) {
  setStatus(`${msg} &nbsp;<b>y</b> yes · <b>n</b> no`);
  const onKey = (e) => {
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
    e.preventDefault(); e.stopPropagation();
    if (e.key !== 'y' && e.key !== 'n' && e.key !== 'Escape') return;
    window.removeEventListener('keydown', onKey, true);
    if (e.key === 'y') onYes();
    else setStatus('cancelled');
  };
  window.addEventListener('keydown', onKey, true);
}
function updateStatusRight() {
  const p = state.active;
  const name = p ? (state.folder && p.startsWith(state.folder + '/') ? p.slice(state.folder.length + 1) : p) : '';
  els.statusR.innerHTML = name ? `${name}${dirtyMap.get(p) ? ' <span class="dirty">●</span>' : ''}` : '';
}
function setDirty(path, d) { dirtyMap.set(path, d); renderTabs(); updateStatusRight(); }

// ---------- mode indicator ----------
function setModeLabel(label, cls) {
  els.statusM.textContent = label;
  els.statusM.className = cls || '';
}
function refreshMode() {
  updatePaneFocus();
  if (leader) return setModeLabel('\\ …', 'm-passive');
  const a = document.activeElement;
  if (a?.closest('#cmdline') || a?.closest('.cm-vim-panel')) return setModeLabel('COMMAND', 'm-term');
  if (a?.closest('.xterm')) return setModeLabel('TERMINAL', 'm-term');
  if (a === els.tree || a?.closest('#tree')) return setModeLabel('FILES', 'm-passive');
  if (a?.closest('#cal-panel')) return setModeLabel('CALENDAR', 'm-passive');
  if (a?.classList?.contains('notebook-view')) return setModeLabel('CELL', 'm-passive');
  const editorEl = a?.closest('.cm-editor');
  if (editorEl) {
    // inside a notebook cell, mark the mode so it isn't mistaken for cell-command mode
    const inCell = editorEl.closest('.notebook-view') ? '·CELL' : '';
    const view = EditorView.findFromDOM(editorEl);
    const vs = view && getCM(view)?.state.vim;
    if (vs?.insertMode) return setModeLabel('INSERT' + inCell, 'm-insert');
    if (vs?.visualMode) {
      return setModeLabel((vs.visualBlock ? 'V-BLOCK' : vs.visualLine ? 'V-LINE' : 'VISUAL') + inCell, 'm-visual');
    }
    return setModeLabel('NORMAL' + inCell, '');
  }
  setModeLabel('');
}
document.addEventListener('focusin', () => refreshMode());
document.addEventListener('focusout', () => setTimeout(refreshMode, 0));
window.addEventListener('keyup', () => refreshMode(), true);
window.addEventListener('mouseup', () => refreshMode(), true);

// ---------- editor ----------
function langFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  return {
    py: python, js: javascript, jsx: javascript, ts: javascript, tsx: javascript, mjs: javascript,
    json: json, md: markdown, html: html, css: css, rs: rust
  }[ext]?.() ?? [];
}

function baseExtensions(path) {
  return [
    vim({ status: true }),
    lineNumbers(),
    drawSelection(),
    history(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    bracketMatching(),
    gruvboxHighlight,
    gruvboxEditorTheme,
    indentUnit.of('    '),
    langFor(path),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.updateListener.of(u => {
      if (u.docChanged && state.active && !isNb(state.active)) setDirty(state.active, true);
    })
  ];
}

const editorView = new EditorView({
  state: EditorState.create({ doc: '', extensions: baseExtensions('') }),
  parent: els.editor
});

// ---------- tabs ----------
function renderTabs() {
  els.tabs.classList.toggle('hidden', state.tabs.length === 0);
  els.tabs.innerHTML = '';
  for (const t of state.tabs) {
    const d = document.createElement('div');
    d.className = 'tab' + (t.path === state.active ? ' active' : '');
    d.textContent = base(t.path);
    if (dirtyMap.get(t.path)) {
      const dot = document.createElement('span');
      dot.className = 'tdirty';
      dot.textContent = '●';
      d.appendChild(dot);
    }
    d.onclick = () => activate(t.path);
    els.tabs.appendChild(d);
  }
}

function stashActive() {
  if (state.active && !isNb(state.active)) textStates.set(state.active, editorView.state);
}

function showOnly(what) { // 'welcome' | 'editor' | notebook path
  els.welcome.classList.toggle('hidden', what !== 'welcome');
  els.editor.classList.toggle('hidden', what !== 'editor');
  for (const [p, { el }] of notebooks) el.classList.toggle('hidden', what !== p);
}

async function activate(path) {
  stashActive();
  state.active = path;
  if (isNb(path)) {
    let entry = notebooks.get(path);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'notebook-view hidden';
      el.tabIndex = 0;
      els.content.appendChild(el);
      const nb = new Notebook(el, { onStatus: setStatus, onDirty: (d) => setDirty(path, d) });
      entry = { nb, el };
      notebooks.set(path, entry);
      showOnly(path);
      try { await nb.open(path, state.folder); }
      catch (err) { setStatus('failed to open notebook: ' + err.message); }
    } else {
      showOnly(path);
      entry.el.focus();
    }
  } else {
    showOnly('editor');
    const cached = textStates.get(path);
    if (cached) editorView.setState(cached);
    else {
      let text;
      try { text = await window.quip.readFile(path); }
      catch (err) { setStatus('cannot open: ' + err.message); return; }
      editorView.setState(EditorState.create({ doc: text, extensions: baseExtensions(path) }));
    }
    editorView.focus();
  }
  renderTabs();
  updateStatusRight();
}

async function openFile(path) {
  if (!state.tabs.find(t => t.path === path)) {
    state.tabs.push({ path });
    dirtyMap.set(path, dirtyMap.get(path) || false);
  }
  await activate(path);
}

function closeFile() {
  const p = state.active;
  if (!p) return;
  if (dirtyMap.get(p) && !confirm(`${base(p)} has unsaved changes — close anyway?`)) return;
  const i = state.tabs.findIndex(t => t.path === p);
  state.tabs.splice(i, 1);
  textStates.delete(p);
  dirtyMap.delete(p);
  const nb = notebooks.get(p);
  if (nb) { nb.el.remove(); notebooks.delete(p); }
  const next = state.tabs[Math.min(i, state.tabs.length - 1)];
  if (next) activate(next.path);
  else { state.active = null; showOnly('welcome'); renderTabs(); updateStatusRight(); }
}

function cycleTab(dir) {
  if (state.tabs.length < 2) return;
  const i = state.tabs.findIndex(t => t.path === state.active);
  activate(state.tabs[(i + dir + state.tabs.length) % state.tabs.length].path);
}

async function saveCurrent() {
  const p = state.active;
  if (!p) return;
  if (isNb(p)) { await notebooks.get(p)?.nb.save(); return; }
  await window.quip.writeFile(p, editorView.state.doc.toString());
  setDirty(p, false);
  setStatus('saved ' + base(p));
}

// ---------- split pane ----------
let splitEditor = null;

function splitExtensions(path) {
  return [
    vim({ status: true }),
    lineNumbers(),
    drawSelection(),
    history(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    bracketMatching(),
    gruvboxHighlight,
    gruvboxEditorTheme,
    indentUnit.of('    '),
    langFor(path),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.updateListener.of(u => { if (u.docChanged) { dirtyMap.set(path, true); renderTabs(); } })
  ];
}

function showSplitContent(kind) {
  els.splitPh.classList.toggle('hidden', kind !== 'placeholder');
  els.splitEd.classList.toggle('hidden', kind !== 'file');
  els.splitTermEl.classList.toggle('hidden', kind !== 'term');
  if (split.nb) split.nb.el.classList.toggle('hidden', kind !== 'nb');
}

function openSplit() {
  els.split.classList.remove('hidden');
  $('pane-divider').classList.remove('hidden');
  split.open = true;
  split.pending = true;
  showSplitContent('placeholder');
  setStatus('split: :open <file> or :term');
  curP()?.term?.resize();
}

function stashSplit() {
  if (split.kind === 'file' && split.path && splitEditor) textStates.set(split.path, splitEditor.state);
  if (split.nb) { split.nb.el.remove(); split.nb = null; }
}

async function openInSplit(path) {
  if (!split.open) openSplit();
  if (isNb(path) && notebooks.has(path)) { setStatus(base(path) + ' is already open in the main pane'); return; }
  stashSplit();
  split.pending = false;
  split.path = path;
  if (isNb(path)) {
    const el = document.createElement('div');
    el.className = 'notebook-view';
    el.tabIndex = 0;
    els.split.appendChild(el);
    const nb = new Notebook(el, { onStatus: setStatus, onDirty: (d) => { dirtyMap.set(path, d); updateStatusRight(); } });
    split.nb = { nb, el };
    split.kind = 'nb';
    showSplitContent('nb');
    try { await nb.open(path, state.folder); }
    catch (err) { setStatus('failed to open notebook: ' + err.message); }
  } else {
    let cached = textStates.get(path);
    if (!cached) {
      let text;
      try { text = await window.quip.readFile(path); }
      catch (err) { setStatus('cannot open: ' + err.message); return; }
      cached = EditorState.create({ doc: text, extensions: splitExtensions(path) });
    }
    if (!splitEditor) splitEditor = new EditorView({ state: cached, parent: els.splitEd });
    else splitEditor.setState(cached);
    split.kind = 'file';
    showSplitContent('file');
    splitEditor.focus();
  }
}

async function termInSplit() {
  const p = curP();
  if (!p) { setStatus('open a folder first (⌘O)'); return; }
  if (!split.open) openSplit();
  stashSplit();
  split.pending = false;
  split.kind = 'term';
  split.path = null;
  if (!p.splitTerm) p.splitTerm = new Term(p.splitTermEl);
  for (const q of projects) q.splitTermEl.classList.toggle('hidden', q !== p);
  showSplitContent('term');
  await p.splitTerm.ensure(state.folder || undefined);
  p.splitTerm.resize();
  p.splitTerm.focus();
}

function focusSplitContent() {
  if (split.kind === 'file') splitEditor?.focus();
  else if (split.kind === 'term') curP()?.splitTerm?.focus();
  else if (split.kind === 'nb') split.nb?.el.focus();
  else setStatus('split is empty — :open <file> or :term');
}

function switchPane() {
  if (!split.open) { setStatus('no split — :vsplit first'); return; }
  if (document.activeElement?.closest('#split')) focusActive();
  else focusSplitContent();
}

function closeSplit() {
  if (!split.open) return;
  stashSplit();
  els.split.classList.add('hidden');
  $('pane-divider').classList.add('hidden');
  els.split.style.width = ''; els.split.style.flex = '';
  updatePaneFocus();
  split.open = false; split.pending = false; split.kind = null; split.path = null;
  curP()?.term?.resize();
  focusActive();
}

// draggable divider — resizes the split by pinning its width
const divider = $('pane-divider');
divider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  divider.classList.add('dragging');
  const startX = e.clientX;
  const startW = els.split.getBoundingClientRect().width;
  const total = $('panes').getBoundingClientRect().width;
  const onMove = (ev) => {
    const w = Math.min(Math.max(startW + (startX - ev.clientX), 180), total - 180);
    els.split.style.flex = 'none';
    els.split.style.width = w + 'px';
  };
  const onUp = () => {
    divider.classList.remove('dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

function updatePaneFocus() {
  const inSplit = !!document.activeElement?.closest('#split');
  els.split.classList.toggle('pane-focused', split.open && inSplit);
  els.content.classList.toggle('pane-focused', split.open && !inSplit);
}

async function saveSplit() {
  if (split.kind === 'nb') return split.nb?.nb.save();
  if (split.kind === 'file' && split.path && splitEditor) {
    await window.quip.writeFile(split.path, splitEditor.state.doc.toString());
    dirtyMap.set(split.path, false);
    setStatus('saved ' + base(split.path));
  }
}

// ---------- cheatsheet ----------
const CHEAT = [
  ['GLOBAL', [
    ['⌘O', 'open folder'], ['\\ e', 'toggle file tree'], ['\\ w', 'switch pane focus (split)'], ['⌘J', 'toggle terminal'],
    ['⌘S', 'save'], ['⌘+ / ⌘− / ⌘0', 'zoom in / out / reset'],
    ['⌘⇧] / ⌘⇧[', 'next / previous tab'], [':', 'command line (works anywhere)']
  ]],
  ['PROJECTS', [
    ['⌘O', 'open folder as a new project (existing folder → switch to it)'],
    ['⌘1–9', 'switch to project n'], ['\\ p', 'cycle projects'],
    [':proj', 'list projects'], [':proj <n|name>', 'switch project'], [':pq', 'close project (asks y/n)'],
    ['', 'terminals & notebook kernels keep running in background projects']
  ]],
  ['COMMANDS', [
    [':w :q :wq :x', 'save / close pane or tab / both'], [':qa', 'quit app'],
    [':open <path>', 'open file (alias :e)'], [':open -t <path>', 'open file in split'],
    [':vsplit', 'open empty split, then :open / :term'], [':only', 'close split'],
    [':term', 'terminal (fills a pending split, else bottom panel)'],
    [':Ex', 'toggle file tree'], [':cheat', 'this cheatsheet'], [':cal', 'toggle calendar'],
    [':theme <name>', 'switch theme (bare :theme lists all)']
  ]],
  ['FILE TREE', [
    ['↑↓ / j k', 'move'], ['→ / l', 'expand / open'], ['← / h', 'collapse / parent'], ['Enter', 'open']
  ]],
  ['NOTEBOOK (cell mode)', [
    ['j / k', 'next / previous cell'], ['Enter / i', 'edit cell'],
    ['Esc', 'insert → normal → cell mode (press twice from insert)'],
    ['⇧Esc', 'exit cell from any mode'],
    ['⇧Enter', 'run + advance'], ['^Enter', 'run in place'], ['R', 'run all cells'],
    ['a / b', 'new cell above / below'], ['dd', 'delete cell'], ['m / y', 'markdown / code'],
    [':restart', 'restart kernel'], [':restartall', 'restart kernel + run all'],
    ['gg / G', 'first / last cell']
  ]],
  ['CALENDAR (:cal)', [
    ['h j k l / arrows', 'move day (j/k = week)'], ['H / L (or [ ])', 'previous / next month'],
    ['t', 'jump to today'], ['a / i / Enter', 'append event to selected day'],
    ['Tab / ⇧Tab', 'cycle events within the day'], ['dd / x', 'delete selected event'],
    ['Esc / q', 'close calendar']
  ]],
  ['EDITOR', [['(vim)', 'full vim keybindings via codemirror-vim']]]
];
function toggleCheat(force) {
  const show = force ?? els.cheat.classList.contains('hidden');
  if (show) {
    els.cheatPanel.innerHTML = CHEAT.map(([title, rows]) =>
      `<h3>${title}</h3>` + rows.map(([k, w]) => `<div class="row"><span class="keys">${k}</span><span class="what">${w}</span></div>`).join('')
    ).join('') + '<div class="close-hint">Esc or :cheat to close</div>';
    els.cheat.classList.remove('hidden');
  } else {
    els.cheat.classList.add('hidden');
  }
}
els.cheat.addEventListener('click', () => toggleCheat(false));

// ---------- calendar ----------
const calendar = new Calendar(document.body, { onStatus: setStatus });

// ---------- ex commands ----------
// origin: which pane the command was issued from ('main' | 'split')
async function runEx(line, origin = 'main') {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return;
  const inSplit = origin === 'split';
  const resolve = (f) => f.startsWith('/') ? f : (state.folder ? state.folder + '/' + f : f);
  switch (cmd) {
    case 'w': case 'write': return inSplit ? saveSplit() : saveCurrent();
    case 'q': case 'quit': return inSplit ? closeSplit() : closeFile();
    case 'wq': case 'x': case 'xit':
      if (inSplit) { await saveSplit(); return closeSplit(); }
      await saveCurrent(); return closeFile();
    case 'qa': case 'qall': return window.close();
    case 'e': case 'edit': case 'open': {
      const toSplit = args[0] === '-t';
      const f = toSplit ? args[1] : args[0];
      if (!f) return setStatus(`E32: no file name — usage :${cmd} [-t] <path>`);
      if (toSplit || split.pending || inSplit) return openInSplit(resolve(f));
      return openFile(resolve(f));
    }
    case 'vsplit': case 'vs': return openSplit();
    case 'only': case 'vclose': return closeSplit();
    case 'term': case 'terminal': return (split.pending || inSplit) ? termInSplit() : toggleTerm();
    case 'Ex': case 'Explore': return toggleTree();
    case 'cheat': return toggleCheat();
    case 'cal': case 'calendar': return calendar.toggle();
    case 'theme': {
      const name = args[0];
      if (!name) return setStatus(`theme: ${activeThemeName()} — available: ${Object.keys(THEMES).join(', ')}`);
      return applyTheme(name);
    }
    case 'runall': case 'restart': case 'restartall': {
      const nb = (inSplit && split.kind === 'nb') ? split.nb?.nb : notebooks.get(state.active)?.nb;
      if (!nb) return setStatus('no notebook active');
      if (cmd === 'runall') return nb.runAll();
      await nb.restartKernel();
      if (cmd === 'restartall') return nb.runAll();
      return;
    }
    case 'tabn': case 'bn': return cycleTab(1);
    case 'tabp': case 'bp': return cycleTab(-1);
    case 'proj': case 'project': case 'projects': {
      const a = args[0];
      if (!a) return listProjects();
      const n = parseInt(a, 10);
      const idx = Number.isNaN(n) ? projects.findIndex(p => p.name === a) : n - 1;
      if (!projects[idx]) return setStatus(`no such project: ${a} — :proj to list`);
      return switchProject(idx);
    }
    case 'pq': case 'pquit': return closeProject();
    default: setStatus(`E492: not an editor command: ${cmd}`);
  }
}
for (const [name, alias] of [
  ['write', 'w'], ['quit', 'q'], ['wq', 'wq'], ['xit', 'x'], ['qall', 'qa'],
  ['edit', 'e'], ['open', 'open'], ['vsplit', 'vs'], ['only', 'only'],
  ['terminal', 'term'], ['Explore', 'Ex'], ['cheat', 'cheat'], ['theme', 'theme'],
  ['calendar', 'cal'], ['project', 'proj'], ['pquit', 'pq'],
  ['runall', 'runall'], ['restart', 'restart'], ['restartall', 'restartall'],
  ['tabnext', 'tabn'], ['tabprev', 'tabp']
]) {
  Vim.defineEx(name, alias, (cm, params) => {
    const origin = cm?.cm6?.dom?.closest('#split') ? 'split' : 'main';
    runEx([alias, ...(params.args || [])].join(' '), origin);
  });
}

// ---------- global command bar ----------
const cmdlineEl = $('cmdline');
const cmdlineInput = $('cmdline-input');
let cmdlineReturnFocus = null;
function openCmdline() {
  cmdlineReturnFocus = document.activeElement;
  cmdlineEl.classList.remove('hidden');
  cmdlineInput.value = '';
  cmdlineInput.focus();
  setModeLabel('COMMAND', 'm-term');
}
function closeCmdline() {
  cmdlineEl.classList.add('hidden');
  if (cmdlineReturnFocus?.isConnected) cmdlineReturnFocus.focus(); else document.body.focus();
  refreshMode();
}
cmdlineInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const v = cmdlineInput.value;
    const origin = cmdlineReturnFocus?.closest?.('#split') ? 'split' : 'main';
    closeCmdline();
    runEx(v, origin);
  }
  else if (e.key === 'Escape') closeCmdline();
});
cmdlineInput.addEventListener('blur', () => cmdlineEl.classList.add('hidden'));

// ---------- themes ----------
function applyTheme(name) {
  const t = applyThemeVars(name);
  if (!t) { setStatus(`unknown theme: ${name} — :theme to list`); return; }
  const tt = termThemeOf(t);
  for (const p of projects) { p.term?.setTheme(tt); p.splitTerm?.setTheme(tt); }
  localStorage.setItem('quip-theme', name);
  setStatus('theme: ' + name);
}
applyThemeVars(localStorage.getItem('quip-theme') && THEMES[localStorage.getItem('quip-theme')]
  ? localStorage.getItem('quip-theme') : DEFAULT_THEME);

// ---------- tree ----------
const tree = new FileTree(els.tree, { onOpenFile: (p) => openFile(p), onStatus: setStatus });

async function openFolder() {
  const dir = await window.quip.openFolder();
  if (!dir) return;
  const existing = projects.findIndex(p => p.folder === dir);
  if (existing >= 0) return switchProject(existing);
  projects.push(makeProject(dir));
  await switchProject(projects.length - 1);
  tree.focus();
}

function toggleTree() {
  if (!state.folder) return;
  state.treeVisible = !state.treeVisible;
  els.tree.classList.toggle('hidden', !state.treeVisible);
  if (state.treeVisible) tree.focus();
  else focusActive();
}

function focusActive() {
  const p = state.active;
  if (!p) return;
  if (isNb(p)) notebooks.get(p)?.el.focus();
  else editorView.focus();
}

// ---------- terminal ----------
async function toggleTerm() {
  // terminal with nothing open yet gets an implicit home project
  if (!curP()) {
    projects.push(makeProject(null));
    curProj = projects.length - 1;
    updateStatusProject();
  }
  const p = curP();
  state.termVisible = !state.termVisible;
  p.termVisible = state.termVisible;
  els.termwrap.classList.toggle('hidden', !state.termVisible);
  if (state.termVisible) {
    for (const q of projects) q.termEl.classList.toggle('hidden', q !== p);
    const t = mainTerm();
    await t.ensure(state.folder || undefined);
    t.resize();
    t.focus();
  } else {
    if (state.active) focusActive();
    else if (state.treeVisible) tree.focus();
  }
}

// ---------- global keybinds ----------
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFolder(); return; }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (document.activeElement?.closest('#split')) saveSplit(); else saveCurrent();
    return;
  }
  if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleTerm(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); window.quip.zoomBy(0.5); return; }
  if (mod && e.key === '-') { e.preventDefault(); window.quip.zoomBy(-0.5); return; }
  if (mod && e.key === '0') { e.preventDefault(); window.quip.zoomReset(); return; }
  if (mod && e.shiftKey && (e.key === ']' || e.key === '}')) { e.preventDefault(); cycleTab(1); return; }
  if (mod && e.shiftKey && (e.key === '[' || e.key === '{')) { e.preventDefault(); cycleTab(-1); return; }
  if (mod && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
    if (projects[+e.key - 1]) { e.preventDefault(); switchProject(+e.key - 1); }
    return;
  }
  if (e.key === 'Escape' && !els.cheat.classList.contains('hidden')) { e.preventDefault(); toggleCheat(false); return; }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const inTerm = e.target.closest?.('.xterm');
  const editorEl = e.target.closest?.('.cm-editor');
  let vimTyping = false;
  if (editorEl) {
    const view = EditorView.findFromDOM(editorEl);
    const vs = view && getCM(view)?.state.vim;
    vimTyping = !vs || vs.insertMode || vs.visualMode;
  }
  // ':' outside any editor/terminal opens the global command bar
  if (!inTerm && !editorEl && !mod && e.key === ':') {
    e.preventDefault(); e.stopPropagation();
    openCmdline();
    return;
  }
  // \e chord for the file tree
  if (!inTerm && !vimTyping && !mod) {
    if (leader) {
      clearLeader();
      if (e.key === 'e') {
        e.preventDefault(); e.stopPropagation();
        toggleTree();
        return;
      }
      if (e.key === 'w') {
        e.preventDefault(); e.stopPropagation();
        switchPane();
        return;
      }
      if (e.key === 'p') {
        e.preventDefault(); e.stopPropagation();
        cycleProject();
        return;
      }
      // not part of the chord — fall through and let the key act normally
    }
    if (e.key === '\\') {
      e.preventDefault(); e.stopPropagation();
      leader = true;
      setModeLabel('\\ …', 'm-passive');
      leaderTimer = setTimeout(clearLeader, 1500);
      return;
    }
  }
}, true);

let leaderTimer = null;
function clearLeader() {
  leader = false;
  clearTimeout(leaderTimer);
  refreshMode();
}

setStatus('');
showOnly('welcome');
startCat();
startAgentMeter();
