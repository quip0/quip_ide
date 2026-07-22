// :tree — standalone git history window.
//
// A real (SVG) commit graph for the repo passed in ?dir=: colored lanes, curved
// merge/fork edges, ref badges, and the working tree as a dashed node on top.
// The main process watches the repo (including .git) and pings us on every
// change, so the graph tracks commits/rebases/edits live.
import './treewin.css';
import { THEMES, DEFAULT_THEME, applyThemeVars } from './themes.js';

const dir = new URLSearchParams(location.search).get('dir');

const $ = (id) => document.getElementById(id);
const els = {
  title: $('tw-title'), scroll: $('tw-scroll'), svg: $('tw-svg'), rows: $('tw-rows'),
  side: $('tw-side'), sideHead: $('tw-side-head'), sideFiles: $('tw-side-files')
};

// theme follows the main window (shared localStorage; 'storage' fires cross-window)
const savedTheme = localStorage.getItem('quip-theme');
applyThemeVars(THEMES[savedTheme] ? savedTheme : DEFAULT_THEME);
window.addEventListener('storage', (e) => {
  if (e.key === 'quip-theme' && THEMES[e.newValue]) applyThemeVars(e.newValue);
});

// ---------- graph layout ----------
// Lanes work like the usual log graph: each lane waits for a hash; a commit
// lands on the lane waiting for it (or a free one), passes its first parent
// down the same lane and forks extra parents into new lanes.
const ROW = 26, LANE = 14, PADX = 14;
const X = (x) => PADX + x * LANE;
const Y = (y) => y * ROW + ROW / 2;
const LANE_COLORS = ['--blue', '--green', '--orange', '--purple', '--aqua', '--red', '--yellow'];
const laneColor = (i) => `var(${LANE_COLORS[i % LANE_COLORS.length]})`;

function layout(commits, yOff) {
  const lanes = [];       // lane -> hash it waits for
  let born = new Map();   // lane -> x it forked from on the row just placed
  const nodes = [], segs = [];
  let maxLanes = 1;
  const put = (h) => {
    let i = lanes.indexOf(null);
    if (i === -1) { i = lanes.length; lanes.push(null); }
    lanes[i] = h;
    return i;
  };
  commits.forEach((c, i) => {
    const y = i + yOff;
    const prev = lanes.slice(), prevBorn = born;
    let idx = prev.indexOf(c.h);
    if (idx === -1) idx = put(c.h);
    if (i > 0) {
      for (let j = 0; j < prev.length; j++) {
        if (!prev[j]) continue;
        segs.push({ x1: prevBorn.get(j) ?? j, y1: y - 1, x2: prev[j] === c.h ? idx : j, y2: y, lane: j });
      }
    }
    nodes.push({ x: idx, y, c, merge: c.parents.length > 1 });
    for (let j = 0; j < lanes.length; j++) if (j !== idx && lanes[j] === c.h) lanes[j] = null;
    lanes[idx] = c.parents[0] || null;
    born = new Map();
    for (const p of c.parents.slice(1)) {
      const L = lanes.indexOf(p);
      if (L === -1) born.set(put(p), idx);
      else segs.push({ x1: idx, y1: y, x2: L, y2: y + 1, lane: L }); // merge into a live lane
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    maxLanes = Math.max(maxLanes, lanes.length, idx + 1);
  });
  // history is truncated at the log limit — fade the still-open lanes out
  const lastY = commits.length - 1 + yOff;
  for (let j = 0; j < lanes.length; j++) {
    if (lanes[j]) segs.push({ x1: born.get(j) ?? j, y1: lastY, x2: j, y2: lastY + 0.7, lane: j, stub: true });
  }
  return { nodes, segs, maxLanes };
}

function edgePath(s) {
  const x1 = X(s.x1), y1 = Y(s.y1), x2 = X(s.x2), y2 = Y(s.y2);
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
  const m = (y2 - y1) * 0.55;
  return `M${x1},${y1} C${x1},${y1 + m} ${x2},${y2 - m} ${x2},${y2}`;
}

// ---------- state / render ----------
let data = null;      // last git:log result
let rows = [];        // [{ kind:'wt'|'commit', key, node }]
let sel = 0;
let selKey = null;    // survives reloads
const filesCache = new Map(); // hash -> [{ st, path }]

const svgEl = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function render() {
  const d = data;
  els.svg.innerHTML = '';
  els.rows.innerHTML = '';
  if (!d?.repo) { renderEmpty('not a git repository'); return; }

  const repo = d.root.split('/').pop();
  const t = `${repo} · ${d.branch || 'detached'}${d.changed.length ? ` · ${d.changed.length} uncommitted` : ''}`;
  els.title.textContent = t;
  document.title = `tree — ${repo}`;

  if (!d.commits.length && !d.changed.length) { renderEmpty('no commits yet'); return; }

  const hasWT = d.changed.length > 0;
  const { nodes, segs, maxLanes } = layout(d.commits, hasWT ? 1 : 0);
  const headLane = nodes[0]?.x ?? 0;
  const graphW = PADX * 2 + Math.max(maxLanes - 1, 0) * LANE + 8;
  const total = d.commits.length + (hasWT ? 1 : 0);

  els.svg.setAttribute('width', graphW);
  els.svg.setAttribute('height', total * ROW + ROW);
  els.rows.style.marginLeft = graphW + 'px';

  // edges under nodes
  for (const s of segs) {
    const p = svgEl('path', { d: edgePath(s), fill: 'none', 'stroke-width': 2 });
    p.style.stroke = laneColor(s.lane);
    if (s.stub) p.style.opacity = 0.3;
    els.svg.appendChild(p);
  }
  rows = [];
  if (hasWT) {
    const l = svgEl('path', { d: `M${X(headLane)},${Y(0)} L${X(headLane)},${Y(1)}`, fill: 'none', 'stroke-width': 2, 'stroke-dasharray': '3 3' });
    l.style.stroke = 'var(--yellow)';
    els.svg.appendChild(l);
    const n = svgEl('circle', { cx: X(headLane), cy: Y(0), r: 4.5, fill: 'var(--bg)', 'stroke-width': 2, 'stroke-dasharray': '2.5 2' });
    n.style.stroke = 'var(--yellow)';
    els.svg.appendChild(n);
    rows.push({ kind: 'wt', key: 'WT' });
  }
  nodes.forEach((n, i) => {
    const head = i === 0;
    const c = svgEl('circle', { cx: X(n.x), cy: Y(n.y), r: n.merge ? 3.5 : 4.5 });
    c.style.fill = laneColor(n.x);
    els.svg.appendChild(c);
    if (head) {
      const ring = svgEl('circle', { cx: X(n.x), cy: Y(n.y), r: 7.5, fill: 'none', 'stroke-width': 1.5 });
      ring.style.stroke = 'var(--accent)';
      els.svg.appendChild(ring);
    }
    rows.push({ kind: 'commit', key: n.c.h, node: n });
  });

  // pick selection back up by key after a live reload
  const keep = rows.findIndex(r => r.key === selKey);
  sel = keep >= 0 ? keep : Math.min(sel, rows.length - 1);

  for (const [i, r] of rows.entries()) {
    const row = document.createElement('div');
    row.className = 'tw-row' + (i === sel ? ' sel' : '');
    row.style.height = ROW + 'px';
    const cell = (cls, text) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      row.appendChild(s);
      return s;
    };
    if (r.kind === 'wt') {
      cell('tw-hash wt', 'working');
      cell('tw-subj wt', `uncommitted changes (${d.changed.length})`);
    } else {
      const c = r.node.c;
      cell('tw-hash', c.short);
      cell('tw-subj', c.subj);
      for (const ref of (c.refs || '').split(', ').filter(Boolean)) {
        const chip = cell('tw-ref', ref.replace('HEAD -> ', ''));
        if (ref.startsWith('tag: ')) { chip.textContent = ref.slice(5); chip.classList.add('tag'); }
        if (ref.includes('HEAD')) chip.classList.add('head');
      }
      cell('tw-meta', `${c.an} · ${c.ar}`);
    }
    row.addEventListener('mousedown', () => select(i));
    els.rows.appendChild(row);
  }
  renderSide();
}

function renderEmpty(msg) {
  els.title.textContent = 'tree';
  els.rows.style.marginLeft = '0';
  const e = document.createElement('div');
  e.className = 'tw-empty';
  e.textContent = msg;
  els.rows.appendChild(e);
  els.side.classList.add('hidden');
}

function select(i, scroll = true) {
  sel = Math.max(0, Math.min(rows.length - 1, i));
  selKey = rows[sel]?.key ?? null;
  for (const [j, el] of [...els.rows.children].entries()) el.classList.toggle('sel', j === sel);
  if (scroll) els.rows.children[sel]?.scrollIntoView({ block: 'nearest' });
  renderSide();
}

// ---------- side panel: the selected commit's files ----------
async function renderSide() {
  const r = rows[sel];
  if (!r) { els.side.classList.add('hidden'); return; }
  els.side.classList.remove('hidden');
  let files;
  if (r.kind === 'wt') {
    els.sideHead.innerHTML = `<div class="tw-sh-subj wt">working tree</div><div class="tw-sh-meta">${data.changed.length} uncommitted</div>`;
    files = data.changed;
  } else {
    const c = r.node.c;
    els.sideHead.innerHTML = `<div class="tw-sh-subj"></div><div class="tw-sh-hash"></div><div class="tw-sh-meta"></div>`;
    els.sideHead.querySelector('.tw-sh-subj').textContent = c.subj;
    els.sideHead.querySelector('.tw-sh-hash').textContent = c.h;
    els.sideHead.querySelector('.tw-sh-meta').textContent = `${c.an} · ${c.ar}`;
    if (!filesCache.has(c.h)) {
      els.sideFiles.innerHTML = '<div class="tw-empty">…</div>';
      try { filesCache.set(c.h, await window.quip.gitCommitFiles(dir, c.h)); }
      catch { filesCache.set(c.h, []); }
      if (rows[sel] !== r) return; // selection moved while loading
    }
    files = filesCache.get(c.h);
  }
  els.sideFiles.innerHTML = '';
  if (!files.length) {
    const e = document.createElement('div');
    e.className = 'tw-empty';
    e.textContent = 'no files';
    els.sideFiles.appendChild(e);
    return;
  }
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'tw-file';
    row.innerHTML = `<span class="tw-st st-${(f.st || '?')[0]}"></span><span class="tw-fp"></span>`;
    row.querySelector('.tw-st').textContent = (f.st || '?').padEnd(2, ' ');
    row.querySelector('.tw-fp').textContent = f.path;
    row.title = 'open in editor';
    row.addEventListener('mousedown', () => window.quip.treeOpenFile(data.root + '/' + f.path));
    els.sideFiles.appendChild(row);
  }
}

// ---------- data / realtime ----------
async function reload() {
  try { data = await window.quip.gitLog(dir); }
  catch { data = null; }
  filesCache.clear(); // amended/rebased hashes may be new; stale entries are harmless but cheap to drop
  const st = els.scroll.scrollTop;
  render();
  els.scroll.scrollTop = st;
}

let reloadTimer = null;
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 200); };
window.quip.onTreeChanged(scheduleReload);
window.addEventListener('focus', scheduleReload);

// ---------- command bar ----------
// same ex commands the main window answers to, so :close / :reload work here too
const cmdEl = document.createElement('div');
cmdEl.id = 'tw-cmdline';
cmdEl.className = 'hidden';
cmdEl.innerHTML = '<span>:</span>';
const cmdInput = document.createElement('input');
cmdInput.spellcheck = false;
cmdEl.appendChild(cmdInput);
document.body.appendChild(cmdEl);

function runEx(line) {
  const [cmd] = line.trim().split(/\s+/);
  if (!cmd) return;
  switch (cmd) {
    case 'q': case 'quit': case 'close': case 'clo': return window.close();
    case 'reload': case 'e': case 'edit': return void reload();
    default: {
      const hint = $('tw-hint');
      if (hint) hint.textContent = `E492: not an editor command: ${cmd}`;
    }
  }
}
function closeCmdline() { cmdEl.classList.add('hidden'); cmdInput.blur(); }
cmdInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { const v = cmdInput.value; closeCmdline(); runEx(v); }
  else if (e.key === 'Escape') closeCmdline();
});
cmdInput.addEventListener('blur', () => cmdEl.classList.add('hidden'));

// ---------- keys ----------
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); window.quip.zoomBy(0.5); return; }
  if (mod && e.key === '-') { e.preventDefault(); window.quip.zoomBy(-0.5); return; }
  if (mod && e.key === '0') { e.preventDefault(); window.quip.zoomReset(); return; }
  if (e.key === ':' && !mod && !e.altKey) {
    e.preventDefault();
    cmdEl.classList.remove('hidden');
    cmdInput.value = '';
    cmdInput.focus();
    return;
  }
  switch (e.key) {
    case 'j': case 'ArrowDown': select(sel + 1); break;
    case 'k': case 'ArrowUp': select(sel - 1); break;
    case 'g': select(0); break;
    case 'G': select(rows.length - 1); break;
    case 'r': reload(); break;
    case 'y': {
      const r = rows[sel];
      if (r?.kind === 'commit') navigator.clipboard?.writeText(r.node.c.h);
      break;
    }
    case 'q': case 'Escape': window.close(); break;
    default: return;
  }
  e.preventDefault();
});

reload();
