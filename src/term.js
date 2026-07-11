import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { termThemeOf } from './themes.js';

export class Term {
  constructor(el) {
    this.el = el;
    this.id = null;
    this.term = new Terminal({
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: 12,
      cursorBlink: false,
      theme: termThemeOf()
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(el);

    window.quip.onPtyData(({ id, data }) => { if (id === this.id) this.term.write(data); });
    window.quip.onPtyExit(({ id }) => { if (id === this.id) this.id = null; });
    this.term.onData(d => { if (this.id) window.quip.ptyWrite(this.id, d); });
    new ResizeObserver(() => this.resize()).observe(el);
  }

  async ensure(cwd) {
    if (!this.id) {
      this.fit.fit();
      this.id = await window.quip.ptyCreate({ cwd, cols: this.term.cols, rows: this.term.rows });
    }
  }

  resize() {
    if (!this.el.offsetParent) return;
    try {
      this.fit.fit();
      if (this.id) window.quip.ptyResize(this.id, this.term.cols, this.term.rows);
    } catch {}
  }

  setTheme(theme) { this.term.options.theme = theme; }
  focus() { this.term.focus(); }
}
