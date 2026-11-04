// Phone-controller link: dynamic imports (src/net/host.js, src/input/remote.js), degrade gracefully when missing.
export class PhoneLink {
  constructor() {
    this.host = null; this.remote = null; this.status = 'idle'; this.error = null;
    this.listeners = new Set(); this.drawQR = null; this.RemoteInput = null; this.starting = null;
    this.timingOffsetMs = 0; this.connected = false;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const f of this.listeners) { try { f(this); } catch (e) { /* ignore */ } } }
  get roomCode() { return this.host?.roomCode || ''; }
  get url() { return this.host?.controllerUrl || ''; }

  static normalize(s) {
    if (s == null) return 'waiting';
    if (typeof s === 'object') s = s.state || s.status || s.type || (s.connected ? 'connected' : 'waiting');
    s = String(s).toLowerCase();
    if (/disconnect|closed|lost|error|fail/.test(s)) return 'lost';
    if (/connecting|waiting|reconnect|signal|listen|open-wait/.test(s)) return 'connecting';
    if (/connected|open|ready|online|paired|hello|welcome/.test(s)) return 'connected';
    return 'waiting';
  }

  async start() {
    if (this.host || this.starting) return this.starting;
    this.starting = (async () => {
      try {
        const mod = await import('../net/host.js');
        this.drawQR = mod.drawQR || null;
        const local = new URLSearchParams(location.search).has('local');
        this.status = 'connecting'; this._emit();
        this.host = await mod.createRemoteHost({
          local,
          onMessage: (msg) => { try { this.remote?.handle?.(msg); } catch (e) { console.warn('remote.handle', e); } },
          onStatus: (st) => {
            const n = PhoneLink.normalize(st);
            this.status = n; this.connected = n === 'connected'; this._emit();
          },
        });
        if (!this.host) throw new Error('no host');
        this.status = this.connected ? 'connected' : 'waiting';
      } catch (e) {
        console.warn('Phone link unavailable:', e);
        this.error = e; this.status = 'unavailable';
      }
      this._emit();
    })();
    return this.starting;
  }

  async attach(sim) {
    this.remote = null;
    if (!this.host) return;
    try {
      const mod = await import('../input/remote.js');
      const RI = mod.RemoteInput || mod.default;
      this.RemoteInput = RI;
      this.remote = new RI(sim, 0, this.host);
      this.applyOffset();
    } catch (e) { console.warn('RemoteInput unavailable:', e); this.error = e; }
  }
  setOffset(ms) {
    this.timingOffsetMs = ms; this.applyOffset();
  }
  applyOffset() {
    const r = this.remote; if (!r) return;
    try {
      if (typeof r.setTimingOffset === 'function') r.setTimingOffset(this.timingOffsetMs);
      r.timingOffsetMs = this.timingOffsetMs; r.timingOffset = this.timingOffsetMs;
    } catch (e) { /* ignore */ }
  }
  notify(events, state) { try { this.remote?.notify?.(events, state); } catch (e) { /* ignore */ } }
  close() { try { this.host?.close?.(); } catch (e) { /* ignore */ } this.host = null; }
}
