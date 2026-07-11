import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { vim, getCM } from '@replit/codemirror-vim';
import { Kernel } from './kernel.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// tiny markdown renderer — headings, code, bold/italic, lists. minimal on purpose.
function renderMd(src) {
  let html = esc(src);
  html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return html.split(/\n{2,}/).map(b => /^<(h\d|pre|li)/.test(b.trim()) ? b : `<p>${b}</p>`).join('\n');
}

const anyStr = (s) => Array.isArray(s) ? s.join('') : (s || '');

export class Notebook {
  constructor(el, { onStatus, onDirty }) {
    this.el = el;
    this.onStatus = onStatus;
    this.onDirty = onDirty;
    this.path = null;
    this.raw = null;      // parsed ipynb json
    this.cells = [];      // { data, node, view, outEl, editing }
    this.sel = 0;
    this.kernel = new Kernel();
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  async open(path, cwd) {
    this.path = path;
    this.cwd = cwd;
    this.raw = JSON.parse(await window.quip.readFile(path));
    this.el.innerHTML = '';
    this.cells = [];
    for (const c of (this.raw.cells || [])) this.addCellNode(c, this.cells.length);
    if (!this.cells.length) this.insertCell(0, 'code');
    this.sel = 0;
    this.refresh();
    this.el.focus();
  }

  makeEditor(cell, parent) {
    const lang = cell.data.cell_type === 'markdown' ? markdown() : python();
    const view = new EditorView({
      state: EditorState.create({
        doc: anyStr(cell.data.source),
        extensions: [
          vim(),
          lineNumbers(),
          syntaxHighlighting(defaultHighlightStyle),
          lang,
          keymap.of([indentWithTab, ...defaultKeymap]),
          EditorView.updateListener.of(u => { if (u.docChanged) this.onDirty(true); }),
          EditorView.theme({}, { dark: true }),
          Prec.high(keymap.of([
            { key: 'Shift-Enter', run: () => { this.runCell(cell, true); return true; } },
            { key: 'Ctrl-Enter', run: () => { this.runCell(cell, false); return true; } },
            { key: 'Escape', run: () => {
                // vim consumes Escape in insert/visual mode; from normal mode, exit the cell
                const cm = getCM(view);
                if (cm && !cm.state.vim?.insertMode && !cm.state.vim?.visualMode) { this.exitEdit(); return true; }
                return false;
              } }
          ]))
        ]
      }),
      parent
    });
    return view;
  }

  addCellNode(data, idx) {
    const node = document.createElement('div');
    node.className = 'cell';
    const head = document.createElement('div');
    head.className = 'cell-head';
    const srcEl = document.createElement('div');
    srcEl.className = 'cell-src';
    const mdOut = document.createElement('div');
    mdOut.className = 'cell-mdout hidden';
    const outEl = document.createElement('div');
    outEl.className = 'cell-out';
    node.append(head, srcEl, mdOut, outEl);

    const cell = { data, node, head, srcEl, mdOut, outEl, view: null, editing: false };
    cell.view = this.makeEditor(cell, srcEl);
    node.addEventListener('mousedown', () => { this.sel = this.cells.indexOf(cell); this.refresh(); });
    this.renderOutputs(cell);
    if (data.cell_type === 'markdown' && anyStr(data.source).trim()) this.renderMdCell(cell, true);

    const ref = this.el.children[idx];
    if (ref) this.el.insertBefore(node, ref); else this.el.appendChild(node);
    this.cells.splice(idx, 0, cell);
    return cell;
  }

  renderMdCell(cell, rendered) {
    if (rendered) {
      cell.mdOut.innerHTML = renderMd(cell.view.state.doc.toString());
      cell.mdOut.classList.remove('hidden');
      cell.node.classList.add('md-rendered');
    } else {
      cell.mdOut.classList.add('hidden');
      cell.node.classList.remove('md-rendered');
    }
  }

  renderOutputs(cell) {
    const outs = cell.data.outputs || [];
    cell.outEl.innerHTML = '';
    for (const o of outs) {
      const d = document.createElement('div');
      if (o.output_type === 'stream') d.textContent = anyStr(o.text);
      else if (o.output_type === 'error') {
        d.className = 'err';
        d.textContent = (o.traceback || []).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
      } else if (o.data) {
        if (o.data['image/png']) d.innerHTML = `<img src="data:image/png;base64,${o.data['image/png']}">`;
        else if (o.data['text/plain']) d.textContent = anyStr(o.data['text/plain']);
      }
      cell.outEl.appendChild(d);
    }
  }

  refresh() {
    this.cells.forEach((c, i) => {
      c.node.classList.toggle('selected', i === this.sel);
      c.node.classList.toggle('editing', c.editing);
      const t = c.data.cell_type === 'markdown' ? 'md' : `[${c.data.execution_count ?? ' '}]`;
      c.head.textContent = t + (c.running ? ' *' : '');
    });
    this.cells[this.sel]?.node.scrollIntoView({ block: 'nearest' });
    const c = this.cells[this.sel];
    this.onStatus(c ? `cell ${this.sel + 1}/${this.cells.length}` : '');
  }

  enterEdit() {
    const c = this.cells[this.sel];
    if (!c) return;
    if (c.data.cell_type === 'markdown') this.renderMdCell(c, false);
    c.editing = true;
    this.refresh();
    c.view.focus();
  }

  exitEdit() {
    const c = this.cells[this.sel];
    if (c) {
      c.editing = false;
      if (c.data.cell_type === 'markdown') this.renderMdCell(c, true);
    }
    this.refresh();
    this.el.focus();
  }

  insertCell(idx, type) {
    const data = { cell_type: type, source: '', metadata: {}, ...(type === 'code' ? { outputs: [], execution_count: null } : {}) };
    this.addCellNode(data, idx);
    this.sel = idx;
    this.onDirty(true);
    this.refresh();
  }

  deleteCell() {
    if (this.cells.length <= 1) return;
    const [c] = this.cells.splice(this.sel, 1);
    c.view.destroy();
    c.node.remove();
    this.sel = Math.min(this.sel, this.cells.length - 1);
    this.onDirty(true);
    this.refresh();
  }

  async runCell(cell, advance) {
    if (cell.data.cell_type === 'markdown') {
      this.renderMdCell(cell, true);
      cell.editing = false;
      if (advance) this.sel = Math.min(this.sel + 1, this.cells.length - 1);
      this.refresh(); this.el.focus();
      return;
    }
    const code = cell.view.state.doc.toString();
    cell.data.outputs = [];
    cell.running = true;
    this.renderOutputs(cell);
    this.refresh();
    try {
      await this.kernel.connect(this.cwd);
      const count = await this.kernel.execute(code, (type, content) => {
        if (type === 'stream') cell.data.outputs.push({ output_type: 'stream', name: content.name, text: content.text });
        else if (type === 'error') cell.data.outputs.push({ output_type: 'error', ename: content.ename, evalue: content.evalue, traceback: content.traceback });
        else cell.data.outputs.push({ output_type: type, data: content.data, metadata: content.metadata || {} });
        this.renderOutputs(cell);
      });
      cell.data.execution_count = count;
    } catch (err) {
      cell.data.outputs = [{ output_type: 'error', ename: 'KernelError', evalue: String(err.message), traceback: [String(err.message)] }];
      this.renderOutputs(cell);
    }
    cell.running = false;
    this.onDirty(true);
    if (advance) {
      if (cell.editing) this.exitEdit();
      this.sel = Math.min(this.cells.indexOf(cell) + 1, this.cells.length - 1);
    }
    this.refresh();
  }

  serialize() {
    this.raw = this.raw || { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
    this.raw.cells = this.cells.map(c => {
      const src = c.view.state.doc.toString();
      return { ...c.data, source: src.length ? src.split(/(?<=\n)/) : [] };
    });
    if (!this.raw.metadata.kernelspec) {
      this.raw.metadata.kernelspec = { display_name: 'Python 3', language: 'python', name: 'python3' };
    }
    return JSON.stringify(this.raw, null, 1) + '\n';
  }

  async save() {
    await window.quip.writeFile(this.path, this.serialize());
    this.onDirty(false);
    this.onStatus('saved ' + this.path.split('/').pop());
  }

  // command-mode keys (jupyter-style, vim flavored)
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const c = this.cells[this.sel];
    if (c?.editing) return; // editor handles its own keys
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'j' || k === 'ArrowDown') { stop(); this.sel = Math.min(this.sel + 1, this.cells.length - 1); this.refresh(); }
    else if (k === 'k' || k === 'ArrowUp') { stop(); this.sel = Math.max(this.sel - 1, 0); this.refresh(); }
    else if (k === 'Enter' || k === 'i') { stop(); this.enterEdit(); }
    else if (k === 'a') { stop(); this.insertCell(this.sel, 'code'); }
    else if (k === 'b') { stop(); this.insertCell(this.sel + 1, 'code'); }
    else if (k === 'm') { stop(); if (c) { c.data.cell_type = 'markdown'; this.retype(c); } }
    else if (k === 'y') { stop(); if (c) { c.data.cell_type = 'code'; this.retype(c); } }
    else if (k === 'd') {
      stop();
      if (this._dPending) { this._dPending = false; this.deleteCell(); }
      else { this._dPending = true; setTimeout(() => this._dPending = false, 500); }
    }
    else if (k === 'G') { stop(); this.sel = this.cells.length - 1; this.refresh(); }
    else if (k === 'g') {
      stop();
      if (this._gPending) { this._gPending = false; this.sel = 0; this.refresh(); }
      else { this._gPending = true; setTimeout(() => this._gPending = false, 500); }
    }
  }

  retype(cell) {
    const doc = cell.view.state.doc.toString();
    cell.view.destroy();
    cell.view = this.makeEditor(cell, cell.srcEl);
    cell.view.dispatch({ changes: { from: 0, to: cell.view.state.doc.length, insert: doc } });
    if (cell.data.cell_type === 'markdown') { delete cell.data.outputs; delete cell.data.execution_count; cell.outEl.innerHTML = ''; }
    else { cell.data.outputs = []; cell.data.execution_count = null; this.renderMdCell(cell, false); }
    this.onDirty(true);
    this.refresh();
  }

  handleShiftEnter() { const c = this.cells[this.sel]; if (c) this.runCell(c, true); }
  focus() { this.el.focus(); }
}
