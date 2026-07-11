import './style.css';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, indentUnit } from '@codemirror/language';
import { vim, Vim } from '@replit/codemirror-vim';
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
  statusL: $('status-left'), statusR: $('status-right')
};

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

// :w / :wq / :q inside vim
Vim.defineEx('write', 'w', () => { saveCurrent(); });
Vim.defineEx('quit', 'q', () => { closeFile(); });
Vim.defineEx('wq', 'wq', async () => { await saveCurrent(); closeFile(); });

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
    history(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle),
    indentUnit.of('    '),
    langFor(path),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.updateListener.of(u => { if (u.docChanged) setDirty(true); }),
    EditorView.theme({}, { dark: true })
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

  // \e chord for the file tree — only when not typing in an editor/terminal input context
  const inEditor = e.target.closest?.('.cm-editor, .xterm');
  if (!inEditor && !mod) {
    if (leader) {
      leader = false;
      if (e.key === 'e') { e.preventDefault(); toggleTree(); return; }
    }
    if (e.key === '\\') { leader = true; e.preventDefault(); setTimeout(() => leader = false, 800); return; }
  }
}, true);

setStatus('');
show('welcome');
