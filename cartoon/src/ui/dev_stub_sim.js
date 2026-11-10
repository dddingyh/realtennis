// Development stand-in for ../sim/arcade.js: same public interface (docs/ARCADE.md §3) with fake but plausible rallies.
import { Match } from '../../../src/game/match.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sgn = (x) => (x < 0 ? -1 : 1);

export class StubSim {
  constructor(opts = {}) {
    this.isStub = true;
    this.surface = opts.surface || 'hard'; this.timeScale = opts.timeScale ?? 0.8; this.paused = false;
    this.match = new Match(opts.format || {}, 0);
    this.events = []; this.time = 0;
    const cfg = opts.players || [{ human: true, name: '你' }, { human: false, name: 'AI' }];
    const mkAnim = () => ({ name: 'ready', shot: null, side: null, phase: 0, gait: 0, strideLen: 0.5, dir: { x: 0, z: 0 }, face: { x: 0, z: -1 }, speed: 0, accel: 0, contact: null, reachT: 0, emote: null });
    this.P = [0, 1].map((i) => ({ i, pos: { x: 0, z: i === 0 ? 12.4 : -12.4 }, vel: { x: 0, z: 0 }, y: 0, hand: (cfg[i] && cfg[i].hand) || 'R', isHuman: !!(cfg[i] && cfg[i].human), name: (cfg[i] && cfg[i].name) || (i ? 'AI' : '你'), look: cfg[i] && cfg[i].look,
      zone: 'base', stamina: 1, set: 1, anim: mkAnim(), racketTip: null, target: { x: 0, z: i === 0 ? 12.4 : -12.4 }, wantNet: false, swingT: -1, zoneT: 0 }));
    this.ball = { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, visible: true, inPlay: false, bounces: 0, lastHitBy: null, attach: null };
    this.state = {
      time: 0, timeScale: this.timeScale, surface: this.surface, ball: this.ball, players: this.P,
      match: { phase: 'serve-prep', server: 0, serveCourt: 'deuce', faultCount: 0, points: this.match.points, games: this.match.games, sets: this.match.sets, setsWon: this.match.setsWon, isTiebreak: false, pointText: '0-0', winner: null,
        stats: { points: [0, 0], winners: [0, 0], unforced: [0, 0], forced: [0, 0], aces: [0, 0], doubleFaults: [0, 0], firstServes: [0, 0], firstServesIn: [0, 0], netPoints: [0, 0], netPointsWon: [0, 0], rallies: [] } },
      rally: { shots: 0, lastHitTime: 0 },
      hint: { i: 0, contactIn: null, side: 'fh', canServe: false, tossUp: false, text: '' },
      lastShot: null,
    };
    this.phase = 'serve-prep'; this.t0 = 0; this.shot = null; this.fault = 0; this.pending = null;
    this._enter('serve-prep', 1.8);
  }
  pause(v = true) { this.paused = !!v; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  emit(e) { this.events.push(e); }
  swing(i, o = {}) { this.lastSwing = { i, ...o }; return true; }
  setNet(i, v) { const p = this.P[i]; if (p.wantNet === !!v) return; p.wantNet = !!v; p.zone = v ? 'toNet' : 'toBase'; p.zoneT = 1.3; this.emit({ type: 'zone', by: i, zone: p.zone }); }
  toggleNet(i) { this.setNet(i, !this.P[i].wantNet); }

  _enter(ph, dur) { this.phase = ph; this.phaseT = 0; this.phaseDur = dur; this.state.match.phase = ph; this.emit({ type: 'phase', phase: ph }); }

  step(realDt) {
    if (this.paused) return;
    const dt = Math.min(realDt, 0.1) * this.timeScale;
    this.time += dt; this.phaseT += dt;
    const m = this.match, st = this.state, S = m.server;
    st.time = this.time; st.timeScale = this.timeScale;
    st.match.server = S; st.match.serveCourt = m.serveCourt; st.match.pointText = m.pointText; st.match.isTiebreak = m.isTiebreak; st.match.winner = m.winner;
    switch (this.phase) {
      case 'serve-prep': {
        const srv = this.P[S]; srv.target.x = (m.serveCourt === 'deuce' ? 1 : -1) * 1.2 * (S === 0 ? 1 : -1); srv.target.z = S === 0 ? 12.6 : -12.6;
        const o = this.P[1 - S]; o.target.x = (m.serveCourt === 'deuce' ? -1 : 1) * 2.0 * (S === 0 ? 1 : -1); o.target.z = S === 0 ? -12.6 : 12.6;
        this.ball.attach = { player: S, hand: 'toss' }; this._ballToHand(srv, 0.9);
        this.ball.inPlay = false; this.ball.bounces = 0;
        st.hint.contactIn = null; st.hint.canServe = srv.isHuman; st.hint.text = srv.isHuman ? '准备发球' : '';
        if (this.phaseT > this.phaseDur) { this._enter('serving', 2.2); this.sv = { stage: 'toss', t: 0 }; this.emit({ type: 'toss', by: S }); }
        break;
      }
      case 'serving': {
        const srv = this.P[S]; const a = srv.anim; const t = this.phaseT;
        a.name = t < 1.0 ? 'toss' : 'serve'; a.phase = t < 1.0 ? t : clamp(0.3 + (t - 1.0) * 0.35 / 0.3 * 0.35, 0.3, 1);
        this.ball.attach = { player: S, hand: 'toss' };
        const hp = srv.pos; const apex = 1.0;
        this.ball.pos.x = hp.x + 0.2; this.ball.pos.z = hp.z - sgn(hp.z) * 0.3; this.ball.pos.y = 1.2 + Math.sin(Math.min(1, t / apex) * Math.PI * 0.5) * 1.9;
        st.hint.tossUp = true; st.hint.contactIn = srv.isHuman ? Math.max(0, (apex - t) / this.timeScale) : null;
        if (t >= apex + 0.02) { this.ball.attach = null; this._plan(S, true); }
        break;
      }
      case 'rally': this._rally(dt); break;
      case 'point-over': case 'changeover':
        for (const p of this.P) { const w = st.match.winner != null ? st.match.winner : this.lastWinner; p.anim.name = (this.lastWinner === p.i) ? 'celebrate' : 'dejected'; p.anim.speed = 0; p.target.x *= 0.98; }
        this.ball.visible = this.phaseT < 1.0 || this.phase === 'point-over';
        if (this.phaseT > this.phaseDur && !m.winner) { for (const p of this.P) { p.anim.name = 'walk'; } this._enter('serve-prep', 1.8); this.ball.visible = true; }
        break;
      default: break;
    }
    if (this.phase !== 'point-over') for (const p of this.P) if (p.anim.name === 'celebrate' || p.anim.name === 'dejected') p.anim.name = 'ready';
    for (const p of this.P) this._movePlayer(p, dt);
    st.hint.i = 0;
  }

  _ballToHand(p, y) { this.ball.pos.x = p.pos.x + 0.25; this.ball.pos.y = y; this.ball.pos.z = p.pos.z; this.ball.vel.x = this.ball.vel.y = this.ball.vel.z = 0; }

  _plan(hitter, serve) {
    const S = this.P[hitter], R = this.P[1 - hitter], dirZ = hitter === 0 ? -1 : 1;
    const sh = this.rally = this.rally || { n: 0 };
    if (serve) sh.n = 0;
    sh.n++;
    const startShots = serve ? 1 : this.state.rally.shots + 1;
    this.state.rally.shots = startShots;
    const ending = serve ? (Math.random() < 0.12 ? 'ace' : Math.random() < 0.12 ? 'fault' : 'in') : (startShots >= 3 && Math.random() < 0.2 ? ['winner', 'out', 'net'][(Math.random() * 3) | 0] : 'in');
    const S0 = { x: S.pos.x + 0.3, y: serve ? 2.6 : 0.9, z: S.pos.z };
    const L = { x: rnd(-3.6, 3.6), z: dirZ * rnd(serve ? 3 : 5, serve ? 6.2 : 10.5) };
    if (ending === 'out') { L.x = sgn(L.x) * 5.9; }
    if (serve) { L.x = clamp(L.x, -3.9, 3.9); }
    const C = { x: clamp(L.x + (L.x - S0.x) * 0.22, -5, 5), y: 0.9, z: dirZ * rnd(10.9, 12.3) };
    const u1 = clamp(Math.abs(L.z - S0.z) / Math.abs(C.z - S0.z), 0.4, 0.9);
    const T = serve ? rnd(0.85, 1.05) : rnd(1.0, 1.45);
    this.shot = { hitter, S: S0, L, C, T, t: 0, u1, t1: u1 * T, a1: rnd(0.9, 2.2) + (serve ? -0.6 : 0), ending, serve, bounced: false, netDone: false, swingStarted: false, hitDone: false };
    const R_ = R; R_.target.x = C.x; R_.target.z = C.z;
    // hitter plays
    const timing = ['early', 'perfect', 'perfect', 'late'][(Math.random() * 4) | 0];
    const ms = timing === 'perfect' ? Math.round(rnd(-25, 25)) : timing === 'early' ? -Math.round(rnd(40, 130)) : Math.round(rnd(40, 130));
    const speed = serve ? rnd(150, 190) : rnd(75, 120);
    const shot = serve ? (this.fault ? 'topspin' : 'flat') : ['topspin', 'topspin', 'flat', 'slice', 'lob', 'smash', 'volley'][(Math.random() * 7) | 0];
    const power = clamp(speed / 190 + rnd(-0.1, 0.1), 0.2, 1);
    S.anim.name = serve ? 'serve' : 'swing'; S.anim.shot = serve ? null : shot; S.anim.side = Math.random() < 0.6 ? 'fh' : 'bh'; S.anim.phase = 0.5; S.swingT = 0;
    this.state.lastShot = { by: hitter, shot, side: S.anim.side, timing, timingMs: ms, dir: clamp(ms / 140, -1, 1), power, quality: rnd(0.4, 1), speedKmh: speed, spinRpm: 2000, target: { x: L.x, z: L.z }, mishit: null };
    this.emit({ type: 'hit', by: hitter, shot, side: S.anim.side, timing, timingMs: ms, dir: clamp(ms / 140, -1, 1), power, quality: this.state.lastShot.quality, speedKmh: speed, pos: { ...S0 }, serve: serve || undefined, mishit: null });
    if (serve) { this._enter('rally', 99); this.state.match.phase = 'rally'; }
    this.ball.inPlay = true; this.ball.bounces = 0; this.ball.lastHitBy = hitter; this.ball.visible = true;
  }

  _rally(dt) {
    const s = this.shot, st = this.state, b = this.ball;
    s.t += dt;
    const { S, L, C, T, t1, u1 } = s;
    const t = Math.min(s.t, T);
    const u = t / T;
    const x = S.x + (C.x - S.x) * u, z = S.z + (C.z - S.z) * u;
    let y;
    if (t < t1) { const k = t / t1; y = S.y * (1 - k) + 4 * s.a1 * k * (1 - k); }
    else { const k = (t - t1) / (T - t1); y = C.y * k + 4 * 0.45 * k * (1 - k); }
    // keep the bounce exactly at L (x,z) by blending the xz path through L
    const bx = t < t1 ? S.x + (L.x - S.x) * (t / t1) : L.x + (C.x - L.x) * ((t - t1) / (T - t1));
    const bz = t < t1 ? S.z + (L.z - S.z) * (t / t1) : L.z + (C.z - L.z) * ((t - t1) / (T - t1));
    const h = 0.016, pp = b.pos;
    const px = pp.x, py = pp.y, pz = pp.z;
    pp.x = bx; pp.y = Math.max(0.03, y); pp.z = bz;
    b.vel.x = (pp.x - px) / Math.max(dt, 1e-3); b.vel.y = (pp.y - py) / Math.max(dt, 1e-3); b.vel.z = (pp.z - pz) / Math.max(dt, 1e-3);
    b.spin.x = -b.vel.z * 3; b.spin.z = b.vel.x * 3;
    const hitter = s.hitter, R = this.P[1 - hitter], rcv = R;
    // bounce
    if (!s.bounced && t >= t1) {
      s.bounced = true; b.bounces = 1;
      const inn = s.ending !== 'out' && !(s.serve && s.ending === 'fault');
      this.emit({ type: 'bounce', pos: { x: L.x, y: 0, z: L.z }, in: inn });
      if (!inn) {
        this.emit({ type: 'call', text: s.serve ? 'FAULT' : 'OUT' });
        if (s.serve) { this.fault++; if (this.fault >= 2) { this.emit({ type: 'call', text: 'DOUBLE FAULT' }); this._end(1 - hitter, 'double-fault'); } else { this._enter('serve-prep', 1.2); } }
        else this._end(1 - hitter, 'out');
        return;
      }
    }
    if (s.ending === 'net' && !s.netDone && Math.sign(z) !== Math.sign(S.z)) { s.netDone = true; this.emit({ type: 'net', pos: { x: pp.x, y: 0.9, z: 0 }, cord: Math.random() < 0.3 }); this._end(1 - hitter, 'net'); return; }
    // receiver anticipates
    const tc = T;
    rcv.anim.contact = { lat: 0.8, fwd: 0.6, h: 0.9 };
    const toC = (tc - s.t) / 1;
    if (rcv.isHuman) { st.hint.contactIn = s.bounced || s.t > 0.3 ? Math.max(-0.05, toC / this.timeScale) : toC / this.timeScale; st.hint.side = C.x > rcv.pos.x ? 'fh' : 'bh'; st.hint.text = '正手'; }
    else st.hint.contactIn = null;
    if (!s.swingStarted && toC < 0.3 && s.ending !== 'winner' && s.ending !== 'ace') { s.swingStarted = true; rcv.anim.name = 'swing'; rcv.anim.shot = 'topspin'; rcv.anim.side = st.hint.side; rcv.swingT = 0; }
    if (rcv.swingT >= 0 && rcv.anim.name === 'swing') { rcv.swingT += dt; rcv.anim.phase = clamp(rcv.swingT / 0.3 * 0.5, 0, 0.5); }
    if (s.t >= T && !s.hitDone) {
      s.hitDone = true;
      if (s.ending === 'winner' || s.ending === 'ace') {
        this.emit({ type: 'whiff', by: R.i });
        if (s.ending === 'ace') this.emit({ type: 'big', kind: 'ace' });
        this._end(hitter, s.ending === 'ace' ? 'ace' : 'winner'); return;
      }
      this.fault = 0; this.state.rally.shots++;
      this._plan(1 - hitter, false);
      return;
    }
  }

  _end(winner, reason) {
    const m = this.match, st = this.state.match.stats;
    const shots = this.state.rally.shots;
    const res = m.pointWon(winner);
    this.lastWinner = winner; this.fault = 0;
    st.points[winner]++; if (reason === 'ace') st.aces[winner]++; else if (reason === 'winner') st.winners[winner]++; else if (reason === 'double-fault') st.doubleFaults[1 - winner]++; else st.unforced[1 - winner]++;
    this.state.match.pointText = m.pointText; this.state.match.winner = m.winner;
    this.state.rally.shots = 0;
    this.ball.inPlay = false; this.state.hint.contactIn = null;
    this.emit({ type: 'point', winner, reason, shots });
    this.emit({ type: 'score', text: res.gameWon ? (res.setWon ? res.text : 'GAME') : m.pointText, games: m.games.slice(), points: m.points.slice(), pointText: m.pointText, gameWon: res.gameWon, setWon: res.setWon });
    if (reason === 'winner') this.emit({ type: 'big', kind: 'winner' });
    if (shots >= 7) this.emit({ type: 'big', kind: 'longrally' });
    if (res.setWon) this.emit({ type: 'big', kind: 'set' });
    if (res.matchWon) this.emit({ type: 'big', kind: 'match' });
    this._enter(res.matchWon ? 'match-over' : (res.changeover ? 'changeover' : 'point-over'), res.matchWon ? 99 : 2.6);
    this.state.match.phase = this.phase;
  }

  _movePlayer(p, dt) {
    const a = p.anim, dirZ = p.i === 0 ? -1 : 1;
    // net/base target
    if (p.zoneT > 0) { p.zoneT -= dt; if (p.zoneT <= 0) { p.zone = p.wantNet ? 'net' : 'base'; this.emit({ type: 'zone', by: p.i, zone: p.zone }); } }
    let tz = p.target.z, tx = p.target.x;
    if (this.phase !== 'serve-prep' && this.phase !== 'serving' && this.phase !== 'rally') { tz = p.i === 0 ? 12.4 : -12.4; }
    if (p.wantNet && this.phase === 'rally') tz = (p.i === 0 ? 1 : -1) * 2.5;
    const dx = tx - p.pos.x, dz = tz - p.pos.z, d = Math.hypot(dx, dz);
    const vmax = this.phase === 'rally' ? 5.2 : 3, want = d > 0.15 ? Math.min(vmax, d * 4) : 0;
    const wx = d > 1e-3 ? dx / d * want : 0, wz = d > 1e-3 ? dz / d * want : 0;
    const ax = clamp(wx - p.vel.x, -16 * dt, 16 * dt), az = clamp(wz - p.vel.z, -16 * dt, 16 * dt);
    p.vel.x += ax; p.vel.z += az;
    p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    a.speed = clamp(sp / 5.5, 0, 1); a.gait = (a.gait + sp * dt / 1.6) % 1; a.dir.x = sp > 0.1 ? p.vel.x / sp : 0; a.dir.z = sp > 0.1 ? p.vel.z / sp : 0;
    a.face.x = 0; a.face.z = dirZ; a.accel = clamp((ax * ax + az * az > 0) ? 0.3 : 0, -1, 1);
    p.stamina = clamp(p.stamina - sp * dt * 0.004 + (sp < 0.5 ? dt * 0.03 : 0), 0.15, 1);
    const swinging = a.name === 'swing' || a.name === 'serve' || a.name === 'toss';
    if (a.name === 'swing' && p.swingT > 0.55) { a.name = 'ready'; p.swingT = -1; }
    else if (a.name === 'swing' && p.swingT > 0.3) a.phase = clamp(0.5 + (p.swingT - 0.3) / 0.25 * 0.5, 0.5, 1);
    if (a.name === 'swing' && !(p.swingT >= 0)) a.name = 'ready';
    if (a.name === 'serve' && this.phase === 'rally' && this.phaseT > 0.5) a.name = 'ready';
    if (!swinging && a.name !== 'celebrate' && a.name !== 'dejected' && a.name !== 'walk') a.name = sp > 3 ? 'run' : sp > 0.6 ? 'shuffle' : 'ready';
    if (p.swingT >= 0 && a.name === 'swing') p.swingT += 0;
    if (a.name === 'toss' && this.phase !== 'serving') a.name = 'ready';
    if (a.name === 'serve' && this.phase !== 'serving' && this.phase !== 'rally') a.name = 'ready';
    p.racketTip = null;
  }
}
