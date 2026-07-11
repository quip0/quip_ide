import './style.css';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
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

const $ = (id) => document.getElementById(id);
const els = {
  tree: $('tree'), welcome: $('welcome'), editor: $('editor'), notebook: $('notebook'),
  termwrap: $('termwrap'), term: $('term'),
  statusL: $('status-left'), statusR: $('status-right'), statusM: $('status-mode')
};

// ---------- mode indicator ----------
function setModeLabel(label, cls) {
  els.statusM.textContent = label;
  els.statusM.className = cls || '';
}
function refreshMode() {
  const a = document.activeElement;
  if (a?.closest('.xterm')) return setModeLabel('TERMINAL', 'm-term');
  if (a === els.tree || a?.closest('#tree')) return setModeLabel('FILES', 'm-passive');
  if (a === els.notebook) return setModeLabel('CELL', 'm-passive');
  const editorEl = a?.closest('.cm-editor');
  if (editorEl) {
    const view = EditorView.findFromDOM(editorEl);
    const vs = view && getCM(view)?.state.vim;
    if (vs?.insertMode) return setModeLabel('INSERT', 'm-insert');
    if (vs?.visualMode) {
      return setModeLabel(vs.visualBlock ? 'V-BLOCK' : vs.visualLine ? 'V-LINE' : 'VISUAL', 'm-visual');
    }
    return setModeLabel('NORMAL', '');
  }
  setModeLabel('');
}
// vim mode changes don't move focus, so also poll cheaply on any key/mouse activity
document.addEventListener('focusin', () => refreshMode());
document.addEventListener('focusout', () => setTimeout(refreshMode, 0));
window.addEventListener('keyup', () => refreshMode(), true);
window.addEventListener('mouseup', () => refreshMode(), true);

const state = {
  folder: null,
  file: null,        // current file path
  mode: 'welcome',   // welcome | editor | notebook
  dirty: false,
  treeVisible: false,
  termVisible: false
};

function setStatus(left) { els.statusL.innerHTML = left || ''; }
function updateStatusRight() {
  const name = state.file ? state.file.replace(state.folder + '/', '') : '';
  els.statusR.innerHTML = name ? `${name}${state.dirty ? ' <span class="dirty">●</span>' : ''}` : '';
}
function setDirty(d) { state.dirty = d; updateStatusRight(); }

// ---------- editor ----------
function langFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  return {
    py: python, js: javascript, jsx: javascript, ts: javascript, tsx: javascript, mjs: javascript,
    json: json, md: markdown, html: html, css: css, rs: rust
  }[ext]?.() ?? [];
}

const editorView = new EditorView({
  state: EditorState.create({ doc: '', extensions: baseExtensions('') }),
  parent: els.editor
});

// nvim-style ex commands (apply to the file editor and notebook cells alike)
Vim.defineEx('write', 'w', () => { saveCurrent(); });
Vim.defineEx('quit', 'q', () => { closeFile(); });
Vim.defineEx('wq', 'wq', async () => { await saveCurrent(); closeFile(); });
Vim.defineEx('xit', 'x', async () => { await saveCurrent(); closeFile(); });
Vim.defineEx('qall', 'qa', () => { window.close(); });
Vim.defineEx('edit', 'e', (_cm, params) => {
  const f = params.args?.[0];
  if (!f) { setStatus('E32: no file name — usage :e <path>'); return; }
  openFile(f.startsWith('/') ? f : (state.folder ? state.folder + '/' + f : f));
});
Vim.defineEx('terminal', 'term', () => { toggleTerm(); });
Vim.defineEx('Explore', 'Ex', () => { toggleTree(); });

const notebook = new Notebook(els.notebook, { onStatus: setStatus, onDirty: setDirty });

function show(mode) {
  state.mode = mode;
  els.welcome.classList.toggle('hidden', mode !== 'welcome');
  els.editor.classList.toggle('hidden', mode !== 'editor');
  els.notebook.classList.toggle('hidden', mode !== 'notebook');
}

async function openFile(path) {
  if (state.dirty && state.file && !confirm('Discard unsaved changes?')) return;
  state.file = path;
  if (path.endsWith('.ipynb')) {
    show('notebook');
    setDirty(false);
    try { await notebook.open(path, state.folder); }
    catch (err) { setStatus('failed to open notebook: ' + err.message); }
  } else {
    let text;
    try { text = await window.quip.readFile(path); }
    catch (err) { setStatus('cannot open: ' + err.message); return; }
    show('editor');
    editorView.setState(EditorState.create({ doc: text, extensions: baseExtensions(path) }));
    setDirty(false);
    editorView.focus();
  }
  updateStatusRight();
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
    EditorView.updateListener.of(u => { if (u.docChanged) setDirty(true); })
  ];
}

async function saveCurrent() {
  if (!state.file) return;
  if (state.mode === 'notebook') { await notebook.save(); return; }
  await window.quip.writeFile(state.file, editorView.state.doc.toString());
  setDirty(false);
  setStatus('saved ' + state.file.split('/').pop());
}

function closeFile() {
  state.file = null;
  setDirty(false);
  show('welcome');
  updateStatusRight();
}

// ---------- tree ----------
const tree = new FileTree(els.tree, { onOpenFile: (p) => openFile(p), onStatus: setStatus });

async function openFolder() {
  const dir = await window.quip.openFolder();
  if (!dir) return;
  state.folder = dir;
  await tree.setRoot(dir);
  state.treeVisible = true;
  els.tree.classList.remove('hidden');
  tree.focus();
  setStatus(dir);
}

function toggleTree() {
  if (!state.folder) return;
  state.treeVisible = !state.treeVisible;
  els.tree.classList.toggle('hidden', !state.treeVisible);
  if (state.treeVisible) tree.focus();
  else if (state.mode === 'editor') editorView.focus();
  else if (state.mode === 'notebook') notebook.focus();
}

// ---------- terminal ----------
const term = new Term(els.term);
async function toggleTerm() {
  state.termVisible = !state.termVisible;
  els.termwrap.classList.toggle('hidden', !state.termVisible);
  if (state.termVisible) {
    await term.ensure(state.folder || undefined);
    term.resize();
    term.focus();
  } else {
    if (state.mode === 'editor') editorView.focus();
    else if (state.mode === 'notebook') notebook.focus();
    else if (state.treeVisible) tree.focus();
  }
}

// ---------- global keybinds ----------
let leader = false; // "\" pressed, waiting for chord
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFolder(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); return; }
  if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleTerm(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); window.quip.zoomBy(0.5); return; }
  if (mod && e.key === '-') { e.preventDefault(); window.quip.zoomBy(-0.5); return; }
  if (mod && e.key === '0') { e.preventDefault(); window.quip.zoomReset(); return; }

  // \e chord for the file tree — works everywhere except the terminal and vim insert mode
  const inTerm = e.target.closest?.('.xterm');
  const editorEl = e.target.closest?.('.cm-editor');
  let vimTyping = false;
  if (editorEl) {
    const view = EditorView.findFromDOM(editorEl);
    const vs = view && getCM(view)?.state.vim;
    vimTyping = !vs || vs.insertMode || vs.visualMode;
  }
  if (!inTerm && !vimTyping && !mod) {
    if (leader) {
      leader = false;
      if (e.key === 'e') { e.preventDefault(); toggleTree(); return; }
    }
    if (e.key === '\\') { leader = true; e.preventDefault(); setTimeout(() => leader = false, 800); return; }
  }
}, true);

setStatus('');
show('welcome');
