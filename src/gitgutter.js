// Git diff markers in the line-number gutter.
//
// The baseline is the file as of HEAD, so everything uncommitted shows: an
// agent's edits in the terminal, your own unsaved typing, staged hunks alike.
// The diff is recomputed against the live document (not the file on disk), so a
// buffer marks up as you type without waiting for a save.
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { gutterLineClass, GutterMarker } from '@codemirror/view';

const setBase = StateEffect.define(); // string (HEAD text) | null (not in a repo)

// LCS is O(n·m) in time and memory — past this many cells a changed region is
// reported as one block rather than being picked apart line by line.
const MAX_CELLS = 1_500_000;

// Line-level diff. Returns hunks {aStart, aEnd, bStart, bEnd} (end-exclusive)
// where a = base lines, b = current lines.
function diffLines(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  if (ea === s && eb === s) return [];
  const A = a.slice(s, ea), B = b.slice(s, eb);
  // pure insert, pure delete, or too big to align — one hunk covers it
  if (!A.length || !B.length || A.length * B.length > MAX_CELLS)
    return [{ aStart: s, aEnd: ea, bStart: s, bEnd: eb }];

  const w = B.length + 1;
  const lcs = new Uint32Array((A.length + 1) * w);
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      lcs[i * w + j] = A[i] === B[j]
        ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const hunks = [];
  let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { flush(); i++; j++; continue; }
    if (!cur) cur = { aStart: s + i, aEnd: s + i, bStart: s + j, bEnd: s + j };
    if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) { i++; cur.aEnd = s + i; }
    else { j++; cur.bEnd = s + j; }
  }
  if (i < A.length || j < B.length) {
    if (!cur) cur = { aStart: s + i, aEnd: s + i, bStart: s + j, bEnd: s + j };
    cur.aEnd = s + A.length; cur.bEnd = s + B.length;
  }
  flush();
  return hunks;
}

// hunk -> per-line marks: added / modified lines, plus a mark on the line that
// swallowed a deletion (deleted lines have nowhere of their own to live)
function marksFor(hunks, lineCount) {
  const marks = [];
  for (const h of hunks) {
    const added = h.bEnd - h.bStart, removed = h.aEnd - h.aStart;
    if (!added) {
      const line = Math.min(h.bStart + 1, lineCount); // the line the cut sits above
      marks.push({ line, kind: 'del' });
      continue;
    }
    const kind = removed ? 'mod' : 'add';
    for (let l = h.bStart + 1; l <= h.bEnd && l <= lineCount; l++) marks.push({ line: l, kind });
  }
  return marks.sort((x, y) => x.line - y.line);
}

const markers = {
  add: new class extends GutterMarker { elementClass = 'cm-git-add'; }(),
  mod: new class extends GutterMarker { elementClass = 'cm-git-mod'; }(),
  del: new class extends GutterMarker { elementClass = 'cm-git-del'; }()
};

const gitField = StateField.define({
  create: () => ({ base: null, marks: [] }),
  update(v, tr) {
    let base = v.base, rebase = false;
    for (const e of tr.effects) if (e.is(setBase)) { base = e.value; rebase = true; }
    if (!rebase && !tr.docChanged) return v;
    if (base == null) return v.base == null && !v.marks.length ? v : { base: null, marks: [] };
    const doc = tr.state.doc;
    // an empty baseline (untracked file) has no lines at all, so every line reads
    // as added rather than as a rewrite of one empty line
    const hunks = diffLines(base ? base.split('\n') : [], doc.toString().split('\n'));
    return { base, marks: marksFor(hunks, doc.lines) };
  },
  provide: (f) => gutterLineClass.compute([f], (state) => {
    const b = new RangeSetBuilder();
    const doc = state.doc;
    for (const m of state.field(f).marks) b.add(doc.line(m.line).from, doc.line(m.line).from, markers[m.kind]);
    return b.finish();
  })
});

export function gitGutter() { return [gitField]; }

// Fetch the HEAD version of `path` and hand it to the view. Untracked files
// come back as an empty baseline, so every line reads as newly added.
export async function loadGitBase(view, path) {
  if (!view || !path) return;
  let base = null;
  try {
    const r = await window.quip.gitBase(path);
    if (r?.repo) base = r.text;
  } catch {}
  try { view.dispatch({ effects: setBase.of(base) }); } catch {} // view may be gone
}
