// Shows a badge + context/usage meters in the status bar while an AI coding
// agent (claude code, codex, aider, ...) is running in one of the terminals.
const POLL_MS = 5000;

const fmt = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' :
  n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);

export function startAgentMeter() {
  const status = document.getElementById('status');
  const right = document.getElementById('status-right');
  const box = document.createElement('span');
  box.id = 'status-agent';
  box.className = 'hidden';
  box.innerHTML =
    '<span id="agent-name"></span>' +
    '<span class="am-group">ctx <span class="am-bar"><span id="agent-ctx-fill"></span></span> <span id="agent-ctx-txt"></span></span>' +
    '<span class="am-group">used <span class="am-bar"><span id="agent-use-fill"></span></span> <span id="agent-use-txt"></span></span>';
  status.insertBefore(box, right);

  const els = {
    name: box.querySelector('#agent-name'),
    ctxFill: box.querySelector('#agent-ctx-fill'),
    ctxTxt: box.querySelector('#agent-ctx-txt'),
    useFill: box.querySelector('#agent-use-fill'),
    useTxt: box.querySelector('#agent-use-txt'),
    groups: box.querySelectorAll('.am-group')
  };

  const setBar = (fill, frac) => {
    const pct = Math.min(100, Math.round(frac * 100));
    fill.style.width = pct + '%';
    fill.className = pct >= 85 ? 'hot' : pct >= 60 ? 'warn' : '';
  };

  const render = (s) => {
    box.classList.toggle('hidden', !s);
    if (!s) return;
    els.name.textContent = s.agent;
    const hasStats = !!s.context;
    for (const g of els.groups) g.classList.toggle('hidden', !hasStats);
    if (!hasStats) return;
    setBar(els.ctxFill, s.context.used / s.context.max);
    els.ctxTxt.textContent = Math.round((s.context.used / s.context.max) * 100) + '%';
    setBar(els.useFill, s.usage.tokens / s.usage.budget);
    els.useTxt.textContent = fmt(s.usage.tokens);
  };

  const poll = async () => {
    try { render(await window.quip.agentStats()); }
    catch { render(null); }
  };
  setInterval(poll, POLL_MS);
  poll();
}
