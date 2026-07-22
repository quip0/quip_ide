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
import { THEMES, DEFAULT_THEME, applyThemeVars, termThemeOf, activeThemeName } from './themes.js';
import { gitGutter, loadGitBase } from './gitgutter.js';

const $ = (id) => document.getElementById(id);
const els = {
  tree: $('tree'), welcome: $('welcome'), editor: $('editor'), tabs: $('tabs'),
  content: $('content'), panes: $('panes'), termwrap: $('termwrap'), term: $('term'),
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
const textStates = new Map(); // path -> EditorState (preserves undo history)
const notebooks = new Map();  // path -> { nb: Notebook, el }
const dirtyMap = new Map();   // path -> bool

const isNb = (p) => p.endsWith('.ipynb');
const base = (p) => p.split('/').pop();

// ---------- projects ----------
// Each opened folder is a project with its own tabs, tree root, bottom terminal
// and pane tree (splits). Everything a project owns — pty terminals, notebook
// kernels, split layout — KEEPS RUNNING while another project is in the
// foreground: its pane tree is only hidden, never torn down.
const projects = []; // [{ name, folder, tabs, active, treeVisible, termVisible, term, termEl, rootEl, root, main, focused }]
let curProj = -1;
const curP = () => projects[curProj] || null;

// ---------- pane tree ----------
// A project's layout is a tree: leaves are panes, boxes are flex containers
// ({ dir: 'row' (vsplit, side by side) | 'col' (split, stacked), children }).
// The 'main' leaf hosts the shared #content element (tabs/editor/notebooks);
// every other leaf owns its content: an editor, a terminal or a notebook.

function makeLeaf() {
  const el = document.createElement('div');
  el.className = 'pane-leaf';
  el.tabIndex = 0;
  const phEl = document.createElement('div');
  phEl.className = 'pane-ph';
  phEl.innerHTML = '<span><kbd>:open &lt;file&gt;</kbd> or <kbd>:term</kbd></span>';
  el.appendChild(phEl);
  return { kind: 'placeholder', main: false, el, phEl, edEl: null, termEl: null, editor: null, term: null, nb: null, path: null, parent: null };
}

function collectLeaves(n, out = []) {
  if (!n.children) out.push(n);
  else n.children.forEach(c => collectLeaves(c, out));
  return out;
}

function leafOf(el) {
  const p = curP();
  if (!p || !el) return null;
  const paneEl = el.closest?.('.pane-leaf');
  if (!paneEl) return null;
  return collectLeaves(p.root).find(l => l.el === paneEl) || null;
}

function makeDivider(dir) {
  const d = document.createElement('div');
  d.className = 'pane-divider ' + (dir === 'row' ? 'v' : 'h');
  d.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const horiz = dir === 'row';
    const box = d.parentElement;
    // freeze every sibling's current size as its flex-grow ratio so only the
    // two neighbours of this divider move during the drag
    for (const k of box.children) {
      if (k.classList.contains('pane-divider')) continue;
      const r = k.getBoundingClientRect();
      k.style.flex = `${horiz ? r.width : r.height} 1 0px`;
    }
    const prev = d.previousElementSibling, next = d.nextElementSibling;
    const a0 = parseFloat(prev.style.flex), b0 = parseFloat(next.style.flex);
    const start = horiz ? e.clientX : e.clientY;
    d.classList.add('dragging');
    const onMove = (ev) => {
      const delta = (horiz ? ev.clientX : ev.clientY) - start;
      const a = Math.max(Math.min(a0 + delta, a0 + b0 - 110), 110);
      prev.style.flex = `${a} 1 0px`;
      next.style.flex = `${a0 + b0 - a} 1 0px`;
    };
    const onUp = () => {
      d.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizeProjectTerms(curP());
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  return d;
}

function splitLeaf(p, target, dir) {
  const nl = makeLeaf();
  const parent = target.parent;
  if (parent && parent.dir === dir) {
    parent.children.splice(parent.children.indexOf(target) + 1, 0, nl);
    nl.parent = parent;
    nl.el.style.flex = target.el.style.flex;
    target.el.after(makeDivider(dir), nl.el);
  } else {
    const box = { dir, el: document.createElement('div'), children: [target, nl], parent };
    box.el.className = 'pane-box ' + (dir === 'row' ? 'row' : 'col');
    box.el.style.flex = target.el.style.flex; // keep target's share of its old box
    target.el.replaceWith(box.el);
    box.el.append(target.el, makeDivider(dir), nl.el);
    target.el.style.flex = ''; nl.el.style.flex = '';
    if (parent) parent.children[parent.children.indexOf(target)] = box;
    else p.root = box;
    target.parent = box; nl.parent = box;
  }
  p.focused = nl;
  nl.el.focus();
  setStatus('new pane: :open <file> or :term');
  resizeProjectTerms(p);
  return nl;
}

function destroyLeafContent(l) {
  if (l.kind === 'file' && l.path && l.editor) textStates.set(l.path, l.editor.state);
  if (l.editor) {
    // :q may arrive from inside this editor's own dispatch — destroy async
    const v = l.editor; l.editor = null;
    setTimeout(() => v.destroy(), 0);
  }
  if (l.term) {
    if (l.term.id) window.quip.ptyKill(l.term.id);
    l.term = null;
  }
  if (l.nb) { l.nb.nb.restartKernel(); l.nb.el.remove(); l.nb = null; }
  l.path = null;
}

function closeLeaf(p, l) {
  if (l.main) return;
  destroyLeafContent(l);
  const parent = l.parent;
  const d = l.el.previousElementSibling?.classList?.contains('pane-divider')
    ? l.el.previousElementSibling : l.el.nextElementSibling;
  d?.remove();
  l.el.remove();
  parent.children.splice(parent.children.indexOf(l), 1);
  if (parent.children.length === 1) {
    const only = parent.children[0];
    only.el.style.flex = parent.el.style.flex;
    parent.el.before(only.el);
    parent.el.remove();
    only.parent = parent.parent;
    if (parent.parent) parent.parent.children[parent.parent.children.indexOf(parent)] = only;
    else p.root = only;
  }
  if (p.focused === l) p.focused = p.main;
  focusLeaf(p.main);
  resizeProjectTerms(p);
}

function closeAllSplits(p) {
  if (!p) return;
  for (const l of collectLeaves(p.root)) if (!l.main) closeLeaf(p, l);
}

function pendingLeaf(p) {
  return p ? collectLeaves(p.root).find(l => !l.main && l.kind === 'placeholder') : null;
}

function focusLeaf(l) {
  const p = curP();
  if (p) p.focused = l;
  if (l.main) { if (state.active) focusActive(); else l.el.focus(); return; }
  if (l.kind === 'file') l.editor?.focus();
  else if (l.kind === 'term') l.term?.focus();
  else if (l.kind === 'nb') l.nb?.el.focus();
  else l.el.focus();
}

function resizeProjectTerms(p) {
  if (!p) return;
  requestAnimationFrame(() => {
    p.term?.resize();
    for (const l of collectLeaves(p.root)) l.term?.resize();
  });
}

function makeProject(folder) {
  const termEl = document.createElement('div');
  termEl.className = 'term-inst hidden';
  els.term.appendChild(termEl);
  const rootEl = document.createElement('div');
  rootEl.className = 'pane-root hidden';
  els.panes.appendChild(rootEl);
  const main = makeLeaf();
  main.main = true;
  main.kind = 'main';
  main.phEl.remove(); // the main leaf hosts #content instead
  rootEl.appendChild(main.el);
  return {
    folder, name: folder ? base(folder) : '~',
    tabs: [], active: null, treeVisible: !!folder, termVisible: false,
    term: null, termEl,
    rootEl, root: main, main, focused: main
  };
}

// terminal or split with nothing open yet gets an implicit home project
function ensureProject() {
  if (curP()) return curP();
  const p = makeProject(null);
  projects.push(p);
  curProj = projects.length - 1;
  p.rootEl.classList.remove('hidden');
  p.main.el.appendChild(els.content);
  updateStatusProject();
  return p;
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
  const prev = curP();
  if (prev) prev.rootEl.classList.add('hidden');
  curProj = i;
  state.folder = p.folder;
  state.tabs = p.tabs;
  state.active = null;
  state.treeVisible = p.treeVisible;
  state.termVisible = p.termVisible;
  p.main.el.appendChild(els.content); // #content is shared; splits are per-project and stay put
  p.rootEl.classList.remove('hidden');
  if (p.folder) await tree.setRoot(p.folder);
  els.tree.classList.toggle('hidden', !p.treeVisible);
  for (const q of projects) q.termEl.classList.toggle('hidden', q !== p);
  els.termwrap.classList.toggle('hidden', !p.termVisible);
  resizeProjectTerms(p);
  if (p.active) await activate(p.active);
  else { showOnly('welcome'); renderTabs(); updateStatusRight(); }
  updateTermLayout();
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
  for (const t of p.tabs) {
    textStates.delete(t.path);
    dirtyMap.delete(t.path);
    const nb = notebooks.get(t.path);
    if (nb) { nb.nb.restartKernel(); nb.el.remove(); notebooks.delete(t.path); }
  }
  for (const l of collectLeaves(p.root)) {
    if (l.main) continue;
    const path = l.path;
    destroyLeafContent(l);
    if (path) { textStates.delete(path); dirtyMap.delete(path); }
  }
  if (p.term?.id) window.quip.ptyKill(p.term.id);
  p.termEl.remove();
  if (els.content.parentElement === p.main.el) els.panes.appendChild(els.content);
  p.rootEl.remove();
  projects.splice(i, 1);
  curProj = -1;
  if (projects.length) return switchProject(Math.min(i, projects.length - 1));
  state.folder = null; state.tabs = []; state.active = null;
  state.treeVisible = false; state.termVisible = false;
  els.tree.classList.add('hidden');
  els.termwrap.classList.add('hidden');
  showOnly('welcome'); renderTabs(); updateStatusRight(); updateStatusProject();
  updateTermLayout();
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

// ---------- external edits ----------
// A file changed on disk under us — an agent working in the terminal, a git
// checkout, another editor. Clean buffers follow the file so what you see is
// what is there; buffers with unsaved edits are left alone. Either way the git
// gutter is re-based, so HEAD moving (a commit) repaints the marks.
let externalSync = false; // set while replacing a doc, so it isn't marked dirty

// smallest replacement that turns the buffer into `text`, to keep the cursor put
function replaceDoc(view, text) {
  const cur = view.state.doc.toString();
  if (cur === text) return;
  let s = 0;
  const n = Math.min(cur.length, text.length);
  while (s < n && cur[s] === text[s]) s++;
  let e1 = cur.length, e2 = text.length;
  while (e1 > s && e2 > s && cur[e1 - 1] === text[e2 - 1]) { e1--; e2--; }
  externalSync = true;
  try { view.dispatch({ changes: { from: s, to: e1, insert: text.slice(s, e2) } }); }
  finally { externalSync = false; }
}

async function syncEditor(view, path) {
  if (!view || !path || isNb(path)) return;
  if (!dirtyMap.get(path)) {
    try { replaceDoc(view, await window.quip.readFile(path)); } catch { return; }
  }
  loadGitBase(view, path);
}

// background tabs have no live view — drop the cached state of any that went
// stale so re-activating them re-reads the file
async function dropStaleTabs() {
  for (const t of state.tabs) {
    if (t.path === state.active || isNb(t.path) || dirtyMap.get(t.path)) continue;
    const cached = textStates.get(t.path);
    if (!cached) continue;
    try {
      const text = await window.quip.readFile(t.path);
      if (text !== cached.doc.toString()) textStates.delete(t.path);
    } catch { textStates.delete(t.path); }
  }
}

let diskSyncTimer = null;
function scheduleDiskSync() {
  clearTimeout(diskSyncTimer);
  diskSyncTimer = setTimeout(() => {
    if (state.active) syncEditor(editorView, state.active);
    for (const p of projects) {
      for (const l of collectLeaves(p.root)) if (l.kind === 'file') syncEditor(l.editor, l.path);
    }
    dropStaleTabs();
  }, 150);
}

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
    gitGutter(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.updateListener.of(u => {
      if (u.docChanged && !externalSync && state.active && !isNb(state.active)) setDirty(state.active, true);
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
    loadGitBase(editorView, path);
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

// ---------- pane content ----------
function leafExtensions(path) {
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
    gitGutter(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.updateListener.of(u => {
      if (u.docChanged && !externalSync) { dirtyMap.set(path, true); renderTabs(); }
    })
  ];
}

function showLeafContent(l, kind) {
  l.kind = kind;
  l.phEl.classList.toggle('hidden', kind !== 'placeholder');
  if (l.edEl) l.edEl.classList.toggle('hidden', kind !== 'file');
  if (l.termEl) l.termEl.classList.toggle('hidden', kind !== 'term');
  if (l.nb) l.nb.el.classList.toggle('hidden', kind !== 'nb');
}

// stop/stash whatever the leaf currently shows before it gets new content
function stashLeaf(l) {
  if (l.kind === 'file' && l.path && l.editor) textStates.set(l.path, l.editor.state);
  if (l.nb) { l.nb.nb.restartKernel(); l.nb.el.remove(); l.nb = null; }
  if (l.term) {
    if (l.term.id) window.quip.ptyKill(l.term.id);
    l.term = null;
    l.termEl.remove(); l.termEl = null;
  }
}

async function openInLeaf(l, path) {
  if (isNb(path) && notebooks.has(path)) { setStatus(base(path) + ' is already open in the main pane'); return; }
  stashLeaf(l);
  l.path = path;
  if (isNb(path)) {
    const el = document.createElement('div');
    el.className = 'notebook-view';
    el.tabIndex = 0;
    l.el.appendChild(el);
    const nb = new Notebook(el, { onStatus: setStatus, onDirty: (d) => { dirtyMap.set(path, d); updateStatusRight(); } });
    l.nb = { nb, el };
    showLeafContent(l, 'nb');
    try { await nb.open(path, state.folder); }
    catch (err) { setStatus('failed to open notebook: ' + err.message); }
  } else {
    let cached = textStates.get(path);
    if (!cached) {
      let text;
      try { text = await window.quip.readFile(path); }
      catch (err) { setStatus('cannot open: ' + err.message); return; }
      cached = EditorState.create({ doc: text, extensions: leafExtensions(path) });
    }
    if (!l.edEl) { l.edEl = document.createElement('div'); l.edEl.className = 'pane-ed'; l.el.appendChild(l.edEl); }
    if (!l.editor) l.editor = new EditorView({ state: cached, parent: l.edEl });
    else l.editor.setState(cached);
    showLeafContent(l, 'file');
    loadGitBase(l.editor, path);
    l.editor.focus();
  }
}

async function termInLeaf(p, l) {
  if (l.kind !== 'term') {
    if (l.kind === 'file' && l.path && l.editor) textStates.set(l.path, l.editor.state);
    if (l.nb) { l.nb.nb.restartKernel(); l.nb.el.remove(); l.nb = null; }
    l.path = null;
  }
  if (!l.termEl) { l.termEl = document.createElement('div'); l.termEl.className = 'pane-term'; l.el.appendChild(l.termEl); }
  if (!l.term) l.term = new Term(l.termEl);
  showLeafContent(l, 'term');
  await l.term.ensure(p.folder || undefined);
  l.term.resize();
  l.term.focus();
}

async function saveLeaf(l) {
  if (l.kind === 'nb') return l.nb?.nb.save();
  if (l.kind === 'file' && l.path && l.editor) {
    await window.quip.writeFile(l.path, l.editor.state.doc.toString());
    dirtyMap.set(l.path, false);
    renderTabs(); updateStatusRight();
    setStatus('saved ' + base(l.path));
  }
}

function splitFocused(dir, origin) {
  const p = ensureProject();
  const leaves = collectLeaves(p.root);
  const target = (origin && leaves.includes(origin)) ? origin
    : (leafOf(document.activeElement) || (leaves.includes(p.focused) ? p.focused : p.main));
  return splitLeaf(p, target, dir);
}

function switchPane() {
  const p = curP();
  if (!p) { setStatus('no split — :vsplit or :split first'); return; }
  const leaves = collectLeaves(p.root);
  if (leaves.length === 1) {
    // No split: \ w toggles focus between the file tree and the editor content.
    if (!state.treeVisible) { setStatus('no split — :vsplit or :split first'); return; }
    if (document.activeElement?.closest('#tree')) focusActive();
    else tree.focus();
    return;
  }
  const cur = leafOf(document.activeElement);
  const i = cur ? leaves.indexOf(cur) : -1;
  focusLeaf(leaves[(i + 1) % leaves.length]);
}

function updatePaneFocus() {
  const p = curP();
  if (!p) return;
  const leaves = collectLeaves(p.root);
  const multi = leaves.length > 1;
  const cur = leafOf(document.activeElement);
  if (cur) p.focused = cur;
  for (const l of leaves) l.el.classList.toggle('pane-focused', multi && l === cur);
}

// ---------- cheatsheet ----------
const CHEAT = [
  ['GLOBAL', [
    ['⌘O', 'open folder'], ['\\ e', 'toggle file tree'], ['\\ w', 'cycle pane focus'], ['⌘J', 'terminal in selected pane'], ['⇧⌘J', 'exit terminal (kill shell)'], ['⌘Esc', 'leave terminal (keep it open)'],
    ['⌘S', 'save'], ['⌘+ / ⌘− / ⌘0', 'zoom in / out / reset'],
    ['⌘⇧] / ⌘⇧[', 'next / previous tab'], [':', 'command line (works anywhere)']
  ]],
  ['PROJECTS', [
    ['⌘O', 'open folder as a new project (existing folder → switch to it)'],
    ['⌘1–9', 'switch to project n'], ['\\ p', 'cycle projects'],
    [':proj', 'list projects'], [':proj <n|name>', 'switch project'], [':pq', 'close project (asks y/n)'],
    ['', 'splits, terminals & notebook kernels keep running in background projects']
  ]],
  ['COMMANDS', [
    [':w :q :wq :x', 'save / close pane or tab / both'], [':qa', 'quit app'],
    [':open <path>', 'open file (alias :e)'], [':open -t <path>', 'open file in a new split'],
    [':vsplit / :split', 'vertical / horizontal split — repeat as often as you like'],
    [':close', 'close whatever is focused (split, terminal, tree, calendar, or tab)'],
    [':only', 'close all splits'],
    [':term', 'terminal (fills an empty split, else bottom panel)'],
    [':Ex', 'toggle file tree'], [':cheat', 'this cheatsheet'], [':cal', 'toggle calendar'],
    [':tree', 'git history window, updates live (aliases :log, :git)'],
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
  ['HISTORY (:tree)', [
    ['', 'opens a separate window with the commit graph — updates live'],
    ['j / k', 'move'], ['g / G', 'first / last'], ['y', 'yank commit hash'],
    ['click file', 'open it in the editor'], ['r', 'reload'], ['q / Esc', 'close window'],
    ['', 'top node is the working tree: everything uncommitted right now']
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

// ---------- git history ----------
// :tree opens a separate live-updating visualization window (src/treewin.js);
// files clicked there come back here to open in the editor.
async function openGitTree() {
  if (!state.folder) return setStatus('no project open — ⌘O to open a folder');
  const r = await window.quip.openTree(state.folder);
  if (r?.error) setStatus(r.error);
}
window.quip.onTreeOpenFile((p) => openFile(p));

// ---------- ex commands ----------
// origin: the pane leaf the command was issued from (null → main behaviour)
async function runEx(line, origin = null) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return;
  const p = curP();
  const inSplit = !!(origin && !origin.main);
  const resolve = (f) => f.startsWith('/') ? f : (state.folder ? state.folder + '/' + f : f);
  switch (cmd) {
    case 'w': case 'write': return inSplit ? saveLeaf(origin) : saveCurrent();
    case 'q': case 'quit': return inSplit ? closeLeaf(p, origin) : closeFile();
    case 'wq': case 'x': case 'xit':
      if (inSplit) { await saveLeaf(origin); return closeLeaf(p, origin); }
      await saveCurrent(); return closeFile();
    case 'qa': case 'qall': return window.close();
    case 'e': case 'edit': case 'open': {
      const toSplit = args[0] === '-t';
      const f = toSplit ? args[1] : args[0];
      if (!f) return setStatus(`E32: no file name — usage :${cmd} [-t] <path>`);
      const path = resolve(f);
      if (inSplit) return openInLeaf(origin, path);
      const pend = pendingLeaf(p);
      if (pend) return openInLeaf(pend, path);
      if (toSplit) return openInLeaf(splitFocused('row', origin), path);
      return openFile(path);
    }
    case 'close': case 'clo': {
      if (inSplit) return closeLeaf(p, origin);
      // no split origin → close whichever panel held focus when the command bar opened
      const a = cmdlineReturnFocus;
      if (a?.closest?.('#termwrap')) return toggleTerm();
      if (a === els.tree || a?.closest?.('#tree')) return toggleTree();
      if (a?.closest?.('#cal-panel')) return calendar.hide();
      return closeFile();
    }
    case 'vsplit': case 'vs': return void splitFocused('row', origin);
    case 'split': case 'sp': return void splitFocused('col', origin);
    case 'only': case 'vclose': return closeAllSplits(p);
    case 'term': case 'terminal': {
      if (inSplit) return termInLeaf(p, origin);
      const pend = pendingLeaf(p);
      if (pend) return termInLeaf(p, pend);
      return toggleTerm();
    }
    case 'Ex': case 'Explore': return toggleTree();
    case 'cheat': return toggleCheat();
    case 'cal': case 'calendar': return calendar.toggle();
    case 'tree': case 'log': case 'gitl': case 'git': return openGitTree();
    case 'theme': {
      const name = args[0];
      if (!name) return setStatus(`theme: ${activeThemeName()} — available: ${Object.keys(THEMES).join(', ')}`);
      return applyTheme(name);
    }
    case 'runall': case 'restart': case 'restartall': {
      const nb = (inSplit && origin.kind === 'nb') ? origin.nb?.nb : notebooks.get(state.active)?.nb;
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
      const idx = Number.isNaN(n) ? projects.findIndex(q => q.name === a) : n - 1;
      if (!projects[idx]) return setStatus(`no such project: ${a} — :proj to list`);
      return switchProject(idx);
    }
    case 'pq': case 'pquit': return closeProject();
    default: setStatus(`E492: not an editor command: ${cmd}`);
  }
}
for (const [name, alias] of [
  ['write', 'w'], ['quit', 'q'], ['wq', 'wq'], ['xit', 'x'], ['qall', 'qa'],
  ['edit', 'e'], ['open', 'open'], ['close', 'clo'], ['vsplit', 'vs'], ['split', 'sp'], ['only', 'only'],
  ['terminal', 'term'], ['Explore', 'Ex'], ['cheat', 'cheat'], ['theme', 'theme'],
  ['calendar', 'cal'], ['project', 'proj'], ['pquit', 'pq'],
  ['tree', 'tree'], ['gitlog', 'gitl'], ['log', 'log'], ['git', 'git'],
  ['runall', 'runall'], ['restart', 'restart'], ['restartall', 'restartall'],
  ['tabnext', 'tabn'], ['tabprev', 'tabp']
]) {
  // defineEx throws if the short form isn't a prefix of the long one; one bad
  // pair must not take the rest of the renderer (keybinds included) down with it
  try {
    Vim.defineEx(name, alias, (cm, params) => {
      const el = cm?.cm6?.dom;
      runEx([alias, ...(params.args || [])].join(' '), el ? leafOf(el) : null);
    });
  } catch (err) {
    console.error(`ex command ${name}/${alias} not registered:`, err);
  }
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
    const origin = leafOf(cmdlineReturnFocus);
    closeCmdline();
    runEx(v, origin);
  }
  else if (e.key === 'Escape') closeCmdline();
});
cmdlineInput.addEventListener('blur', () => cmdlineEl.classList.add('hidden'));

// ':' always opens the single global command bar — never CodeMirror-vim's inline
// command line. Capture phase so the key is swallowed before the editor sees it.
window.addEventListener('keydown', (e) => {
  if (e.key !== ':' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
  if (t.closest?.('.xterm')) return;
  const editorEl = t.closest?.('.cm-editor');
  if (editorEl) {
    // let ':' stay a literal character while inserting; only hijack command modes
    const view = EditorView.findFromDOM(editorEl);
    const vs = view && getCM(view)?.state.vim;
    if (!vs || vs.insertMode) return;
  }
  e.preventDefault();
  e.stopPropagation();
  openCmdline();
}, true);

// ---------- themes ----------
function applyTheme(name) {
  const t = applyThemeVars(name);
  if (!t) { setStatus(`unknown theme: ${name} — :theme to list`); return; }
  const tt = termThemeOf(t);
  for (const p of projects) {
    p.term?.setTheme(tt);
    for (const l of collectLeaves(p.root)) l.term?.setTheme(tt);
  }
  localStorage.setItem('quip-theme', name);
  setStatus('theme: ' + name);
}
applyThemeVars(localStorage.getItem('quip-theme') && THEMES[localStorage.getItem('quip-theme')]
  ? localStorage.getItem('quip-theme') : DEFAULT_THEME);

// ---------- tree ----------
// While the tree is open, keep focus on it after opening a file so files can be
// opened one after another without the editor stealing focus. Bypass with \ w.
const tree = new FileTree(els.tree, {
  onOpenFile: async (p) => { await openFile(p); if (state.treeVisible) tree.focus(); },
  onStatus: setStatus
});
window.quip.onFsChange(() => { tree.refresh(); scheduleDiskSync(); });

async function openFolder() {
  const dir = await window.quip.openFolder();
  if (!dir) return;
  const existing = projects.findIndex(p => p.folder === dir);
  if (existing >= 0) return switchProject(existing);
  // the landing terminal runs in an implicit "~" home project — adopt the
  // folder into it rather than spawning a phantom second project
  const cur = curP();
  if (cur && !state.folder && state.tabs.length === 0) {
    cur.folder = dir; cur.name = base(dir); cur.treeVisible = true;
    state.folder = dir; state.treeVisible = true;
    await tree.setRoot(dir);
    els.tree.classList.remove('hidden');
    resizeProjectTerms(cur);
    updateTermLayout();
    updateStatusProject();
    setStatus(dir);
    tree.focus();
    return;
  }
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
// The terminal fills the whole workspace when it's the only thing going on —
// nothing else open (no folder, no tabs). This is the landing view. Once a
// folder or file is opened, it falls back to the bottom panel.
function updateTermLayout() {
  const full = state.termVisible && !state.folder && state.tabs.length === 0;
  document.getElementById('app').classList.toggle('term-full', full);
  const p = curP();
  if (p?.term) requestAnimationFrame(() => p.term.resize());
}

async function toggleTerm() {
  // terminal with nothing open yet gets an implicit home project
  const p = ensureProject();
  state.termVisible = !state.termVisible;
  p.termVisible = state.termVisible;
  els.termwrap.classList.toggle('hidden', !state.termVisible);
  updateTermLayout();
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

// ⌘J: open a terminal in the pane the user has selected. A non-main split
// leaf gets the terminal directly; from the main pane it fills an empty
// split if one exists, else opens a new split. The bottom-panel terminal
// (landing view / :term) still dismisses with ⌘J when focus is inside it.
async function termFocused() {
  if (state.termVisible && document.activeElement?.closest('#termwrap')) return toggleTerm();
  const p = ensureProject();
  const leaves = collectLeaves(p.root);
  let target = leafOf(document.activeElement) || (leaves.includes(p.focused) ? p.focused : p.main);
  if (target.main) target = pendingLeaf(p) || splitLeaf(p, target, 'row');
  return termInLeaf(p, target);
}

// Actually exit the terminal (⇧⌘J): close the
// focused terminal split, else kill the bottom terminal's shell and hide it.
function exitTerm() {
  const p = curP();
  if (!p) return;
  const l = leafOf(document.activeElement);
  if (l && !l.main && l.kind === 'term') { closeLeaf(p, l); return; }
  if (!p.term) { setStatus('no terminal to exit'); return; }
  if (p.term.id) window.quip.ptyKill(p.term.id);
  p.term.term.dispose();
  p.term = null;
  state.termVisible = false;
  p.termVisible = false;
  els.termwrap.classList.add('hidden');
  updateTermLayout();
  if (state.active) focusActive();
  else if (state.treeVisible) tree.focus();
  setStatus('terminal closed');
}

// ---------- global keybinds ----------
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFolder(); return; }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const l = leafOf(document.activeElement);
    if (l && !l.main) saveLeaf(l); else saveCurrent();
    return;
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'j') { e.preventDefault(); exitTerm(); return; }
  if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); termFocused(); return; }
  if (mod && e.key === 'Escape') {
    // leave the terminal without closing it
    if (document.activeElement?.closest?.('.xterm')) {
      e.preventDefault(); e.stopPropagation();
      if (state.active) focusActive();
      else if (state.treeVisible) tree.focus();
      else setStatus('nothing to focus — terminal is all there is');
    }
    return;
  }
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
// land on a terminal, not a welcome page
toggleTerm();
