// Minimal Jupyter kernel client over the jupyter-server REST + websocket API.
export class Kernel {
  constructor() {
    this.ws = null;
    this.pending = new Map(); // msg_id -> handlers
    this.connectPromise = null;
  }

  // serialize connection attempts — concurrent cell runs must share ONE kernel,
  // otherwise each races to create its own and session state splits across them
  connect(cwd) {
    if (!this.connectPromise) {
      this.connectPromise = this._connect(cwd).catch(err => {
        this.connectPromise = null; // allow retry after a failure
        throw err;
      });
    }
    return this.connectPromise;
  }

  async _connect(cwd) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const info = await window.quip.jupyterStart(cwd);
    if (info.error) throw new Error(info.error);
    const { url, token } = info;
    const r = await fetch(`${url}/api/kernels?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'python3' })
    });
    if (!r.ok) throw new Error('kernel start failed: ' + await r.text());
    const k = await r.json();
    const wsUrl = url.replace('http', 'ws') + `/api/kernels/${k.id}/channels?token=${token}`;
    this.ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('kernel websocket failed'));
    });
    this.ws.onmessage = (ev) => this.route(JSON.parse(ev.data));
    this.ws.onclose = () => {
      this.ws = null;
      this.connectPromise = null;
      // fail any in-flight executions instead of hanging them
      for (const [mid, h] of this.pending) {
        h.onOutput('error', { ename: 'KernelDisconnected', evalue: 'kernel connection lost — rerun the cell', traceback: ['kernel connection lost — rerun the cell'] });
        h.onDone(null);
        this.pending.delete(mid);
      }
    };
  }

  route(msg) {
    const parent = msg.parent_header?.msg_id;
    const h = parent && this.pending.get(parent);
    if (!h) return;
    const t = msg.header.msg_type;
    if (t === 'stream' || t === 'display_data' || t === 'execute_result' || t === 'error') {
      h.onOutput(t, msg.content);
    } else if (t === 'execute_reply') {
      h.count = msg.content.execution_count;
      h.replied = true;
    } else if (t === 'status' && msg.content.execution_state === 'idle') {
      h.idle = true;
    }
    // reply (shell) and idle (iopub) arrive on separate channels in either order
    if (h.replied && h.idle) {
      this.pending.delete(parent);
      h.onDone(h.count);
    }
  }

  execute(code, onOutput) {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('no kernel'));
      const msg_id = crypto.randomUUID();
      this.pending.set(msg_id, { onOutput, onDone: resolve });
      this.ws.send(JSON.stringify({
        header: { msg_id, username: 'quip', session: 'quip', msg_type: 'execute_request', version: '5.3', date: new Date().toISOString() },
        parent_header: {}, metadata: {}, channel: 'shell',
        content: { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true },
        buffers: []
      }));
    });
  }
}
