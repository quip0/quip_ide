// Arrow-key driven file tree. Flat render of an expandable dir tree.
export class FileTree {
  constructor(el, { onOpenFile, onStatus }) {
    this.el = el;
    this.onOpenFile = onOpenFile;
    this.onStatus = onStatus;
    this.root = null;
    this.rows = [];   // flattened visible nodes
    this.sel = 0;
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  async setRoot(dir) {
    this.root = { path: dir, name: dir.split('/').pop(), dir: true, open: true, children: null, depth: 0 };
    await this.loadChildren(this.root);
    this.sel = 0;
    this.render();
    window.quip.watchDir(dir);
  }

  // Re-read directories from disk without collapsing what's open or losing the
  // selection. Called when the watcher reports the folder changed.
  async refresh() {
    if (!this.root) return;
    const selPath = this.rows[this.sel]?.path;
    await this.reload(this.root);
    this.rows = [];
    this.flatten(this.root, this.rows);
    const idx = this.rows.findIndex(r => r.path === selPath);
    this.sel = idx >= 0 ? idx : Math.min(this.sel, Math.max(this.rows.length - 1, 0));
    this.render();
  }

  // Re-read one open dir, preserving the open state + loaded children of any
  // subdirectory that still exists, then recurse into those.
  async reload(node) {
    if (!node.dir || !node.open) return;
    const prev = new Map((node.children || []).map(c => [c.path, c]));
    await this.loadChildren(node);
    for (const c of node.children) {
      const old = prev.get(c.path);
      if (old && old.dir && old.open) {
        c.open = true;
        c.children = old.children;
        await this.reload(c);
      }
    }
  }

  async loadChildren(node) {
    const entries = await window.quip.readdir(node.path);
    node.children = entries.map(e => ({
      path: node.path + '/' + e.name,
      name: e.name, dir: e.dir, open: false, children: null, depth: node.depth + 1
    }));
  }

  flatten(node, out) {
    out.push(node);
    if (node.dir && node.open && node.children) for (const c of node.children) this.flatten(c, out);
  }

  render() {
    this.rows = [];
    if (this.root) this.flatten(this.root, this.rows);
    this.el.innerHTML = '';
    this.rows.forEach((n, i) => {
      const div = document.createElement('div');
      div.className = 't-row' + (n.dir ? '' : ' file') + (i === this.sel ? ' sel' : '');
      div.style.paddingLeft = (8 + n.depth * 12) + 'px';
      const caret = n.dir ? (n.open ? '▾' : '▸') : '';
      div.innerHTML = `<span class="caret">${caret}</span>${n.name}`;
      div.onclick = () => { this.sel = i; this.activate(); };
      this.el.appendChild(div);
    });
    this.el.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  async activate() {
    const n = this.rows[this.sel];
    if (!n) return;
    if (n.dir) {
      n.open = !n.open;
      if (n.open && !n.children) await this.loadChildren(n);
      this.render();
    } else {
      this.onOpenFile(n.path);
    }
  }

  async onKey(e) {
    const k = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'j', 'k', 'h', 'l'].includes(k)) return;
    e.preventDefault();
    const n = this.rows[this.sel];
    if (k === 'ArrowDown' || k === 'j') this.sel = Math.min(this.sel + 1, this.rows.length - 1);
    else if (k === 'ArrowUp' || k === 'k') this.sel = Math.max(this.sel - 1, 0);
    else if (k === 'ArrowRight' || k === 'l') {
      if (n?.dir && !n.open) { n.open = true; if (!n.children) await this.loadChildren(n); }
      else if (n?.dir) this.sel = Math.min(this.sel + 1, this.rows.length - 1);
      else { this.activate(); return; }
    } else if (k === 'ArrowLeft' || k === 'h') {
      if (n?.dir && n.open) n.open = false;
      else {
        // jump to parent
        const idx = this.rows.findIndex(r => r.dir && r.open && n && n.path.startsWith(r.path + '/') && r.depth === n.depth - 1);
        if (idx >= 0) this.sel = idx;
      }
    } else if (k === 'Enter') { this.activate(); return; }
    this.render();
  }

  focus() { this.el.focus(); }
}
