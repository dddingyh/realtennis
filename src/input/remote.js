// Phone -> simulation adapter (DESIGN.md 4.5).
//   const remote = new RemoteInput(sim, 0, host, { timingOffsetMs: 0 });
//   host = createRemoteHost({ onMessage: (m) => remote.handle(m) });
//   each frame: remote.notify(sim.drainEvents()-copy, sim.state)     // forwards haptics + state to the phone
// Robust against a partially implemented sim (missing methods are skipped).
const SERVE_PHASES = new Set(['serve-prep', 'serving']);

export class RemoteInput {
  constructor(sim, playerIndex = 0, host = null, { timingOffsetMs = 0, tiltTimeoutMs = 500, log = false } = {}) {
    this.sim = sim; this.i = playerIndex; this.host = host;
    this.timingOffsetMs = timingOffsetMs; this.tiltTimeoutMs = tiltTimeoutMs; this.log = log;
    this.override = null;            // forced shot type for the next swing (touch buttons)
    this.hand = 'R';
    this.lastState = null; this.lastHapticAt = 0;
    this.stats = { swings: 0, lastAgeMs: 0, lastSwing: null };
    this._tiltTimer = null;
    this.paused = false;
  }
  attachHost(host) { this.host = host; }
  setTimingOffset(ms) { this.timingOffsetMs = ms; }
  destroy() { clearTimeout(this._tiltTimer); this._move(0, 0); }

  _move(x, z) { if (this.sim && this.sim.setMove) this.sim.setMove(this.i, x, z); }
  _phase() { const s = this.sim && this.sim.state; return s && s.match ? s.match.phase : null; }

  handle(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'hello': this.hand = msg.hand === 'L' ? 'L' : 'R'; this.lastState = null; this._sendState(this.sim && this.sim.state, true); break;
      case 'tilt':
        this._move(msg.x || 0, msg.z || 0);
        clearTimeout(this._tiltTimer);
        this._tiltTimer = setTimeout(() => this._move(0, 0), this.tiltTimeoutMs);
        break;
      case 'swing': this._swing(msg); break;
      case 'btn': this._btn(msg); break;
      default: break;
    }
  }

  _ageMs(msg) {
    const a = (msg.ageMs || 0) + this.timingOffsetMs;
    return Math.max(0, Math.min(250, a));
  }

  _swing(msg) {
    if (this.paused) return;
    const shot = this.override || msg.shot;
    const ageMs = this._ageMs(msg);
    this.stats.swings++; this.stats.lastAgeMs = ageMs; this.stats.lastSwing = { ...msg, shot };
    if (!this.sim || !this.sim.swing) return;
    this.sim.swing(this.i, { shot, side: msg.side === 'fh' || msg.side === 'bh' ? msg.side : 'auto', power: msg.power, aimX: null, aimDepth: null, ageMs, source: 'remote' });
  }

  _btn(msg) {
    const sim = this.sim;
    switch (msg.id) {
      case 'serve':
        if (sim && sim.swing && (SERVE_PHASES.has(this._phase()) || this._phase() === null)) {
          sim.swing(this.i, { shot: this.override || 'flat', side: 'auto', power: 0.8, aimX: null, aimDepth: null, ageMs: 0, source: 'remote' });
        }
        break;
      case 'pause': this.paused = true; sim && sim.pause && sim.pause(true); break;
      case 'resume': this.paused = false; sim && sim.pause && sim.pause(false); break;
      case 'shotOverride': this.override = ['flat', 'topspin', 'slice', 'lob'].includes(msg.value) ? msg.value : null; break;
      default: break;
    }
  }

  _haptic(pattern) {
    const t = Date.now();
    if (t - this.lastHapticAt < 60 || !this.host || !this.host.send) return;
    this.lastHapticAt = t;
    this.host.send({ t: 'haptic', pattern });
  }

  _sendState(state, force = false) {
    if (!state || !state.match || !this.host || !this.host.send) return;
    const m = state.match;
    const key = [m.phase, m.pointText, m.server].join('|');
    if (!force && key === this.lastState) return;
    this.lastState = key;
    this.host.send({ t: 'state', phase: m.phase, pointText: m.pointText || '', server: m.server, youServe: m.server === this.i });
  }

  // events: array from sim.drainEvents(); state: sim.state
  notify(events = [], state = null) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.by === this.i) this._haptic(e.quality >= 0.8 ? [50, 30, 20] : e.quality >= 0.45 ? [30] : [12]);
          break;
        case 'serve': if (e.by === this.i) this._haptic([60]); break;
        case 'whiff': if (e.by === this.i) this._haptic([15, 40, 15]); break;
        case 'point': this._haptic(e.winner === this.i ? [30, 50, 30, 50, 60] : [220]); break;
        case 'call': if (/FAULT/.test(e.text)) this._haptic([70, 60, 70]); break;
        default: break;
      }
    }
    this._sendState(state || this.sim.state);
  }
}
