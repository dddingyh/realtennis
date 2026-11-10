// Phone -> ArcadeSim adapter (docs/ARCADE.md section 5). DOM-free; robust against a partially implemented sim.
//
//   const host = createRemoteHost({ local, controllerBase, onMessage: (m) => remote.handle(m), onStatus });
//   const remote = new RemoteAdapter(sim, 0, host, { timingOffsetMs: 0 });
//   every frame:   remote.notify(sim.drainEvents(), sim.state)        // forwards fb / state / haptic to the phone
//
// phone -> host   swing {shot, side, power, conf, ts, speedDps, lift, spin} (+ageMs added by the host)  -> sim.swing(i, {shot, power, ageMs, source:'remote'})
//                 btn {id:'net', value:true|false|'toggle'}  -> sim.setNet / sim.toggleNet
//                 btn {id:'pause'|'resume'}                   -> sim.pause(bool)
//                 btn {id:'shotOverride', value}              -> forced shot type for the next swings
//                 btn {id:'serve'}                            -> a swing (fallback when the phone cannot swing)
// host -> phone   fb    {timing:'early'|'perfect'|'late'|'wide'|'whiff', timingMs, shot, quality, dir, side, serve, mishit, speedKmh}
//                 state {phase, pointText, server, youServe, zone, tossUp, canServe, paused}
//                 haptic{pattern:[ms,...]}
// (fb for a whiff carries the sim's reason in `mishit`: early | late | noball | reach | toss | serve)
//
// fb.dir is the resulting direction in SCREEN terms (-1 = to the player's left, +1 = right), derived (first match):
//   event.dirX -> event.aim (ArcadeSim: world lateral target -1..1, x right as seen from the near baseline) -> event.target.x / 3.5
//   -> event.dir (timing based: negative = early) mirrored by stroke side and handedness
//   (a right-hander's forehand pulls LEFT when early; backhand and left-handers mirror it).
const SERVE_PHASES = new Set(['serve-prep', 'serving']);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const fin = Number.isFinite;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class RemoteAdapter {
  constructor(sim, playerIndex = 0, host = null, { timingOffsetMs = 0, maxAgeMs = 250, log = false } = {}) {
    this.sim = sim; this.i = playerIndex; this.host = host;
    this.timingOffsetMs = timingOffsetMs; this.maxAgeMs = maxAgeMs; this.log = log;
    this.override = null;            // forced shot type (hold-to-force chips on the phone)
    this.hand = 'R';                 // from the phone's hello; the sim's own player.hand wins when present
    this.paused = false;
    this.lastStateKey = null; this.lastHapticAt = 0;
    this.stats = { swings: 0, nets: 0, fb: 0, lastAgeMs: 0, lastSwing: null };
  }
  attachHost(host) { this.host = host; this.lastStateKey = null; }
  setTimingOffset(ms) { this.timingOffsetMs = Number.isFinite(ms) ? ms : 0; }
  destroy() { this.host = null; this.sim = null; }

  // ---------------------------------------------------------------- phone -> sim
  handle(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'hello': this.hand = msg.hand === 'L' ? 'L' : 'R'; this.lastStateKey = null; this._sendState(this.sim && this.sim.state, true); break;
      case 'swing': this._swing(msg); break;
      case 'btn': this._btn(msg); break;
      default: break;                // 'tilt' etc. are irrelevant: the character moves by itself
    }
  }

  _ageMs(msg) {
    const a = (fin(msg.ageMs) ? msg.ageMs : 0) + this.timingOffsetMs;
    return clamp(a, 0, this.maxAgeMs);
  }

  _swing(msg) {
    if (this.paused) return;
    const shot = this.override || msg.shot;
    const ageMs = this._ageMs(msg);
    const forced = !!this.override && this.override !== msg.shot;
    this.stats.swings++; this.stats.lastAgeMs = ageMs; this.stats.lastSwing = { ...msg, shot };
    if (this.log) console.log('[remote] swing', shot, msg.power, 'age', ageMs);
    const sim = this.sim;
    if (!sim || typeof sim.swing !== 'function') return;
    sim.swing(this.i, {
      shot, power: fin(msg.power) ? clamp(msg.power, 0, 1) : 0.6, ageMs, source: 'remote',
      side: msg.side === 'fh' || msg.side === 'bh' ? msg.side : 'auto', conf: msg.conf,
      lift: forced || !fin(msg.lift) ? null : msg.lift, spin: forced || !fin(msg.spin) ? null : msg.spin, speedDps: msg.speedDps,
    });
  }

  _zone() {
    const p = this.sim && this.sim.state && this.sim.state.players && this.sim.state.players[this.i];
    return p ? p.zone : null;
  }

  _net(value) {
    const sim = this.sim; if (!sim) return;
    this.stats.nets++;
    const z = this._zone();
    const atNet = z === 'net' || z === 'toNet';
    if (value === true || value === false) {
      if (typeof sim.setNet === 'function') sim.setNet(this.i, value);
      else if (typeof sim.toggleNet === 'function' && value !== atNet) sim.toggleNet(this.i);
    } else if (typeof sim.toggleNet === 'function') sim.toggleNet(this.i);
    else if (typeof sim.setNet === 'function') sim.setNet(this.i, !atNet);
  }

  _btn(msg) {
    const sim = this.sim;
    switch (msg.id) {
      case 'net': this._net(msg.value); break;
      case 'pause': this.paused = true; if (sim && sim.pause) sim.pause(true); this._sendState(sim && sim.state, true); break;
      case 'resume': this.paused = false; if (sim && sim.pause) sim.pause(false); this._sendState(sim && sim.state, true); break;
      case 'shotOverride': this.override = ['flat', 'topspin', 'slice', 'lob'].includes(msg.value) ? msg.value : null; break;
      case 'serve': {
        const ph = sim && sim.state && sim.state.match ? sim.state.match.phase : null;
        if (sim && sim.swing && (ph === null || SERVE_PHASES.has(ph))) sim.swing(this.i, { shot: this.override || 'topspin', power: 0.8, ageMs: 0, source: 'remote', side: 'auto' });
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- sim -> phone
  _send(m) { return !!(this.host && typeof this.host.send === 'function' && this.host.send(m)); }

  _haptic(pattern) {
    const total = pattern.reduce((a, b) => a + b, 0);
    const t = nowMs();
    if (total < 80 && t - this.lastHapticAt < 40) return;       // throttle ticks; long patterns (point lost...) always go out
    this.lastHapticAt = t;
    this._send({ t: 'haptic', pattern });
  }

  _hand() {
    const p = this.sim && this.sim.state && this.sim.state.players && this.sim.state.players[this.i];
    return p && (p.hand === 'L' || p.hand === 'R') ? p.hand : this.hand;
  }

  _screenDir(e) {
    if (fin(e.dirX)) return clamp(e.dirX, -1, 1);
    const far = this.i === 1 ? -1 : 1;                           // the far player looks down +z: world x is mirrored for them
    if (fin(e.aim)) return clamp(e.aim * far, -1, 1);
    if (e.target && fin(e.target.x)) return clamp(far * e.target.x / 3.5, -1, 1);
    if (!fin(e.dir)) return 0;
    const mirror = (this._hand() === 'R') === (e.side === 'bh');
    return clamp(mirror ? -e.dir : e.dir, -1, 1);
  }

  _state(state) {
    if (!state || !state.match) return null;
    const m = state.match, pl = state.players && state.players[this.i], h = state.hint;
    return {
      t: 'state', phase: m.phase, pointText: m.pointText || '', server: fin(m.server) ? m.server : 0, youServe: m.server === this.i,
      zone: pl && pl.zone ? pl.zone : 'base', tossUp: !!(h && h.tossUp && (h.i === undefined || h.i === this.i)),
      canServe: !!(h && h.canServe && (h.i === undefined || h.i === this.i)), paused: this.paused,
    };
  }
  _sendState(state, force = false) {
    const s = this._state(state);
    if (!s) return;
    const key = [s.phase, s.pointText, s.server, s.zone, s.tossUp, s.canServe, s.paused].join('|');
    if (!force && key === this.lastStateKey) return;
    this.lastStateKey = key;
    this._send(s);
  }

  // events: array from sim.drainEvents(); state: sim.state
  notify(events = [], state = null) {
    for (const e of events || []) {
      if (!e) continue;
      switch (e.type) {
        case 'hit':
          if (e.by !== this.i) break;
          this.stats.fb++;
          this._send({
            t: 'fb', timing: e.timing || '', timingMs: fin(e.timingMs) ? Math.round(e.timingMs) : 0, shot: e.shot || '',
            quality: fin(e.quality) ? clamp(e.quality, 0, 1) : 0.5, dir: this._screenDir(e), side: e.side || '', serve: !!e.serve,
            mishit: typeof e.mishit === 'string' ? e.mishit : '', speedKmh: fin(e.speedKmh) ? Math.round(e.speedKmh) : undefined,
          });
          if (e.timing === 'perfect') this._haptic([25, 35, 30]);                          // double buzz: perfect timing
          else if (e.mishit || e.timing === 'wide') this._haptic([14, 30, 14]);
          else this._haptic(e.quality >= 0.45 ? [20] : [10]);                            // crisp tick on contact
          break;
        case 'whiff':
          if (e.by !== this.i) break;
          this.stats.fb++;
          this._send({ t: 'fb', timing: 'whiff', timingMs: fin(e.timingMs) ? Math.round(e.timingMs) : 0, shot: e.shot || '', quality: 0, dir: 0, side: e.side || '', serve: !!e.serve, mishit: typeof e.reason === 'string' ? e.reason : '' });
          this._haptic([15, 40, 15]);
          break;
        case 'toss': if (e.by === this.i) this._haptic([14]); break;
        case 'point': this._haptic(e.winner === this.i ? [30, 50, 30, 50, 60] : [260]); break;
        case 'call': if (/FAULT/.test(e.text || '')) this._haptic([70, 60, 70]); break;
        case 'big': if (e.kind === 'ace' && e.by === this.i) this._haptic([40, 40, 40, 40, 80]); break;
        default: break;
      }
    }
    this._sendState(state || (this.sim && this.sim.state));
  }
}

// Alias kept so code written against the pixel game's name keeps working.
export { RemoteAdapter as RemoteInput };
