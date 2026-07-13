// Minimal vim-style month calendar. Events persist in localStorage.
const STORE_KEY = 'quip-cal-events';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class Calendar {
  constructor(root, { onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.events = this.load();          // { 'YYYY-MM-DD': [string, ...] }
    this.sel = new Date();              // selected day
    this.sel.setHours(0, 0, 0, 0);
    this.evIdx = 0;                     // selected event within the day
    this.pendingD = false;              // first 'd' of dd
    this.returnFocus = null;

    this.el = document.createElement('div');
    this.el.id = 'cal-overlay';
    this.el.className = 'hidden';
    this.el.innerHTML = `
      <div id="cal-panel" tabindex="0">
        <div id="cal-head"><span id="cal-title"></span><span id="cal-hint">a add · dd delete · :cheat keys</span></div>
        <div id="cal-dow">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>
        <div id="cal-grid"></div>
        <div id="cal-input-row" class="hidden"><span>+</span><input id="cal-input" type="text" spellcheck="false" placeholder="event…" /></div>
      </div>`;
    root.appendChild(this.el);
    this.panel = this.el.querySelector('#cal-panel');
    this.grid = this.el.querySelector('#cal-grid');
    this.title = this.el.querySelector('#cal-title');
    this.inputRow = this.el.querySelector('#cal-input-row');
    this.input = this.el.querySelector('#cal-input');

    this.panel.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.commitInput(); }
      else if (e.key === 'Escape') { this.cancelInput(); }
    });
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.hide(); });
  }

  load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch { return {}; }
  }
  save() { localStorage.setItem(STORE_KEY, JSON.stringify(this.events)); }

  isOpen() { return !this.el.classList.contains('hidden'); }

  show() {
    this.returnFocus = document.activeElement;
    this.el.classList.remove('hidden');
    this.render();
    this.panel.focus();
  }
  hide() {
    this.cancelInput(true);
    this.el.classList.add('hidden');
    if (this.returnFocus?.isConnected) this.returnFocus.focus(); else document.body.focus();
  }
  toggle() { this.isOpen() ? this.hide() : this.show(); }

  moveDays(n) {
    const d = new Date(this.sel);
    d.setDate(d.getDate() + n);
    this.sel = d;
    this.evIdx = 0;
    this.render();
  }
  moveMonths(n) {
    const d = new Date(this.sel);
    const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    this.sel = d;
    this.evIdx = 0;
    this.render();
  }

  dayEvents() { return this.events[key(this.sel)] || []; }

  onKey(e) {
    if (!this.inputRow.classList.contains('hidden')) return; // typing an event
    const k = e.key;
    if (this.pendingD && k !== 'd') this.pendingD = false;
    switch (k) {
      case 'Escape': case 'q': this.hide(); break;
      case 'h': case 'ArrowLeft': this.moveDays(-1); break;
      case 'l': case 'ArrowRight': this.moveDays(1); break;
      case 'j': case 'ArrowDown': this.moveDays(7); break;
      case 'k': case 'ArrowUp': this.moveDays(-7); break;
      case 'H': case '[': this.moveMonths(-1); break;
      case 'L': case ']': this.moveMonths(1); break;
      case 't': {
        this.sel = new Date(); this.sel.setHours(0, 0, 0, 0);
        this.evIdx = 0; this.render(); break;
      }
      case 'a': case 'i': case 'o': case 'Enter': this.openInput(); break;
      case 'Tab': {
        const n = this.dayEvents().length;
        if (n) { this.evIdx = (this.evIdx + (e.shiftKey ? n - 1 : 1)) % n; this.render(); }
        break;
      }
      case 'x': this.deleteSelected(); break;
      case 'd':
        if (this.pendingD) { this.pendingD = false; this.deleteSelected(); }
        else this.pendingD = true;
        break;
      default: return; // let unhandled keys through (e.g. ':')
    }
    e.preventDefault();
    e.stopPropagation();
  }

  openInput() {
    this.inputRow.classList.remove('hidden');
    this.input.value = '';
    this.input.focus();
  }
  commitInput() {
    const text = this.input.value.trim();
    if (text) {
      const k = key(this.sel);
      (this.events[k] = this.events[k] || []).push(text);
      this.evIdx = this.events[k].length - 1;
      this.save();
      this.onStatus(`event added: ${text} (${k})`);
    }
    this.cancelInput();
    this.render();
  }
  cancelInput(silent) {
    this.inputRow.classList.add('hidden');
    if (!silent) this.panel.focus();
  }
  deleteSelected() {
    const k = key(this.sel);
    const evs = this.events[k];
    if (!evs || !evs.length) { this.onStatus('no event to delete on ' + k); return; }
    const [gone] = evs.splice(Math.min(this.evIdx, evs.length - 1), 1);
    if (!evs.length) delete this.events[k];
    this.evIdx = Math.max(0, Math.min(this.evIdx, (evs?.length || 1) - 1));
    this.save();
    this.onStatus(`event deleted: ${gone}`);
    this.render();
  }

  render() {
    const y = this.sel.getFullYear(), m = this.sel.getMonth();
    this.title.textContent = `${MONTHS[m]} ${y}`;
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first offset
    const start = new Date(y, m, 1 - lead);
    const today = key(new Date());
    const selKey = key(this.sel);
    this.grid.innerHTML = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dk = key(d);
      const cell = document.createElement('div');
      cell.className = 'cal-day'
        + (d.getMonth() !== m ? ' other' : '')
        + (dk === today ? ' today' : '')
        + (dk === selKey ? ' sel' : '');
      const num = document.createElement('div');
      num.className = 'cal-num';
      num.textContent = d.getDate();
      cell.appendChild(num);
      for (const [j, ev] of (this.events[dk] || []).entries()) {
        const row = document.createElement('div');
        row.className = 'cal-ev' + (dk === selKey && j === this.evIdx ? ' evsel' : '');
        row.textContent = ev;
        cell.appendChild(row);
      }
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.sel = d; this.evIdx = 0; this.render(); this.panel.focus();
      });
      this.grid.appendChild(cell);
    }
  }
}
