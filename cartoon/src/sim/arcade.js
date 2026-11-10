// ArcadeSim: DOM-free arcade tennis simulation (see docs/ARCADE.md sections 2 and 3, and "SIM notes" at its end).
// Swing timing decides direction; players run automatically; the AI plays by the same rules.
import { COURT, PHYSICS, SURFACES } from '../../../src/config.js';
import { stepBall, simulateTrajectory, createBall } from '../../../src/physics/ball.js';
import { Match } from '../../../src/game/match.js';
import { RNG } from '../../../src/game/rng.js';
import * as K from './tuning.js';
import { STROKES, DROP_POWER, LOB_EL, strokeParams, solveLaunch, scatterLaunch, inCourt, inServiceBox, clamp, lerp } from './shot.js';
import { AIBrain } from './ai.js';

const G = PHYSICS.gravity;
const H = 1 / PHYSICS.simHz;           // logic step (s)
const HALF = COURT.halfLength;
const KMH = 3.6;
const sgn = (x) => (x < 0 ? -1 : 1);
const FOLLOW = 0.38;                   // follow-through duration (s)
const PLAN_DT = 1 / 240;

export const DEFAULT_LOOK = null;

function mkAnim() {
  return {
    name: 'ready', shot: null, side: null, phase: 0, gait: 0, strideLen: 0.5, dir: { x: 0, z: 0 }, face: { x: 0, z: -1 },
    speed: 0, accel: 0, contact: null, reachT: 0, emote: null, prep: 0,
  };
}

export class ArcadeSim {
  constructor(opts = {}) {
    this.surface = opts.surface || 'hard';
    this.surf = SURFACES[this.surface];
    this.timeScale = opts.timeScale ?? 0.8;
    this.seed = opts.seed ?? 1;
    this.rng = new RNG(this.seed);
    this.timing = { ...K.TIMING, ...(opts.timing || {}) };
    this.time = 0;
    this.paused = false;
    this._acc = 0;
    this.events = [];
    this.match = new Match(opts.format || {}, opts.firstServer ?? 0);
    this.b = createBall({ pos: { x: 0, y: 1, z: 0 } });
    this._hist = { n: 0, head: 0, t: new Float64Array(128), d: new Float64Array(128 * 6) };
    this._env = { surf: this.surf, surfKey: this.surface, rng: this.rng, events: [] };
    this.rl = { live: false, hitter: 0, serve: false, shots: 0, lastHitTime: 0, cord: false, valid: false, firstBounce: false, crossed: false };
    this.sv = { stage: 'wait' };
    this.faultCount = 0;
    this._planId = 0;
    this.ballAttach = null;
    this.phase = 'serve-prep';
    this.phaseEnd = 0;
    this.lastShot = null;
    this.stats = {};
    for (const k of ['points', 'winners', 'unforced', 'forced', 'aces', 'doubleFaults', 'firstServes', 'firstServesIn',
      'netApproaches', 'netPoints', 'netPointsWon', 'serviceWinners', 'returnErrors']) this.stats[k] = [0, 0];
    this.stats.rallies = [];
    this._pointInfo = null;

    const cfg = opts.players || [{ human: true, hand: 'R', name: '你' }, { human: false, hand: 'R', name: 'AI', ai: { level: 0.5, style: 'baseliner' } }];
    this.P = [0, 1].map((i) => this._mkPlayer(i, cfg[i] || {}));
    this.brains = this.P.map((p, i) => (p.human ? null : new AIBrain(this, i, cfg[i].ai || {})));
    this.humanIdx = this.P.findIndex((p) => p.human);

    this._buildState();
    this._beginPoint(true);
    this._sync();
  }

  // ------------------------------------------------------------------ construction helpers
  _mkPlayer(i, c) {
    const facing = i === 0 ? 1 : -1;
    const hand = c.hand === 'L' ? 'L' : 'R';
    return {
      i, facing, hand, handX: (hand === 'R' ? 1 : -1) * facing, human: !!c.human, name: c.name || (c.human ? '你' : 'AI'), look: c.look,
      pos: { x: 0, z: facing * BASE_Z() }, vel: { x: 0, z: 0 }, y: 0, vy: 0,
      zone: 'base', wantNet: false, deep: false, stamina: 1, set: 1,
      plan: null, recover: { x: 0, z: facing * BASE_Z() }, reactUntil: 0, splitUntil: 0,
      sw: null, cooldown: 0, walkTo: null, hold: null,
      reaction: K.HUMAN_REACTION, perceive: 0.25,
      faceAng: Math.atan2(0, -facing * 0 - facing) , gait: 0, dirv: { x: 0, z: -facing }, prevSpeed: 0, accel: 0,
      anim: mkAnim(), lastQ: 1, lastSet: 1, netThisPoint: false, approachThisPoint: false, serveAnim: null,
    };
  }

  _buildState() {
    const b = this.b;
    this.state = {
      time: 0, timeScale: this.timeScale, surface: this.surface,
      ball: { pos: b.pos, vel: b.vel, spin: b.spin, visible: true, inPlay: false, bounces: 0, lastHitBy: null, attach: null },
      players: this.P.map((p) => ({
        pos: p.pos, vel: p.vel, y: 0, hand: p.hand, isHuman: p.human, name: p.name, look: p.look,
        zone: p.zone, stamina: 1, set: 1, anim: p.anim, racketTip: null,
      })),
      match: {
        phase: this.phase, server: 0, serveCourt: 'deuce', faultCount: 0, points: [0, 0], games: [0, 0], sets: [], setsWon: [0, 0],
        isTiebreak: false, pointText: '0-0', winner: null, stats: this.stats,
      },
      rally: { shots: 0, lastHitTime: 0 },
      hint: { i: Math.max(0, this.humanIdx), contactIn: null, side: 'fh', canServe: false, tossUp: false, text: '' },
      lastShot: null,
    };
  }

  // ------------------------------------------------------------------ public API
  pause(v = true) { this.paused = !!v; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  emit(e) { this.events.push(e); }
  setNet(i, v) { this._setNet(this.P[i], !!v); }
  toggleNet(i) { this._setNet(this.P[i], !this.P[i].wantNet); }

  step(realDt) {
    if (this.paused) return;
    const dt = Math.min(Math.max(realDt, 0), 0.25);
    this._acc += dt * this.timeScale;
    let n = 0;
    while (this._acc >= H - 1e-12 && n < 60) { this._acc -= H; this._update(H); n++; }
    if (n === 60) this._acc = 0;
    this._sync();
  }

  /** Timing offset (ms, sim time; negative = early) that sends the next ball of player i toward world x = aimX. */
  timingForAim(i, aimX) {
    const p = this.P[i];
    const plan = p.plan;
    const side = plan ? plan.side : 'fh';
    const s = (side === 'fh' ? 1 : -1) * p.handX;
    return clamp(aimX * s / K.AIM_X, -1, 1) * K.T_FULL * 1000;
  }
  /** Serve: timing offset (ms from the apex) for a target x in the receiving box. */
  serveTimingForAim(i, x) {
    const box = this._serveGeom(this.P[i]);
    const aim = clamp((x - box.cx) / box.half, -1, 1);
    return aim * p_handX(this.P[i]) * K.T_FULL * 1000;
  }


  // ------------------------------------------------------------------ test / tooling hooks (not used by the game)
  /** Put player i at (x,z) in a zone, standing still. */
  debugPlace(i, x, z, zone = 'base') {
    const p = this.P[i];
    p.pos.x = x; p.pos.z = z; p.vel.x = 0; p.vel.z = 0; p.zone = zone; p.wantNet = zone === 'net' || zone === 'toNet';
    p.plan = null; p.sw = null; p.cooldown = 0; p.walkTo = null; p.hold = null;
    p.recover = { x, z };
  }
  /** Start a rally ball as if `hitter` had just hit it: o = {from?, target?, speedKmh?, topRpm?, clear?, el?}. */
  debugFeed(hitter, o = {}) {
    const p = this.P[hitter], f = p.facing;
    const from = o.from || { x: p.pos.x, y: o.y ?? 1.0, z: f * 12.4 };
    const target = o.target || { x: 0, z: -f * (HALF - 2) };
    const spec = { pos: from, target, speed: (o.speedKmh ?? 100) / KMH, top: (o.topRpm ?? 2500) * Math.PI / 30, surface: this.surface, clear: o.clear ?? 0.4 };
    if (o.el !== undefined) spec.elevation = o.el;
    const sol = solveLaunch(spec);
    for (const q of this.P) { q.plan = null; q.sw = null; q.cooldown = 0; q.walkTo = null; q.hold = null; }
    this.phase = 'rally'; this.sv = { stage: 'hit' }; this.ballAttach = null;
    const b = this.b;
    b.pos.x = from.x; b.pos.y = from.y; b.pos.z = from.z;
    b.vel.x = sol.vel.x; b.vel.y = sol.vel.y; b.vel.z = sol.vel.z;
    b.spin.x = sol.spin.x; b.spin.y = sol.spin.y; b.spin.z = sol.spin.z;
    b.bounces = 0; b.rolling = false; b.netHit = false;
    this.rl = { live: true, hitter, serve: false, shots: o.shots ?? 2, lastHitTime: this.time, cord: false, valid: false, firstBounce: false, crossed: false, returned: true, boxSign: 0, recvInfeasible: false };
    this._pushHist();
    this._afterHit(p, target);
    return sol;
  }

  // ------------------------------------------------------------------ swing entry
  swing(i, o = {}) {
    if (this.paused) return false;
    const p = this.P[i];
    const src = o.source || 'keyboard';
    const age = clamp((o.ageMs || 0) / 1000, 0, 0.6) * this.timeScale;
    const ts = this.time - age;
    if (this.phase === 'serving') return this._serveSwing(p, o, ts, src);
    if (this.phase !== 'rally') return false;
    if (p.cooldown > 0 || (p.sw && !p.sw.done)) return false;
    const plan = p.plan;
    const power = clamp(o.power ?? 0.6, 0, 1);
    const req = (o.shot === 'topspin' || o.shot === 'flat' || o.shot === 'slice' || o.shot === 'lob') ? o.shot : 'topspin';
    const win = src === 'remote' ? K.REMOTE : { T_MISS: K.T_MISS, T_PERFECT: K.T_PERFECT };
    if (!plan || plan.swing || plan.expired) { this._airSwing(p, req, 'noball'); return true; }
    const t = ts - plan.tContact;
    if (t < -win.T_MISS || t > win.T_MISS) { this._airSwing(p, req, t < 0 ? 'early' : 'late'); return true; }
    plan.swing = { ts, t, shot: req, power, src, win };
    const kind = this._kindFor(plan, req);
    const tr = Math.max(this.time, plan.tContact);
    p.sw = { tr, kind, shot: kind === 'volley' || kind === 'smash' ? kind : req, side: plan.side, dpre: clamp(tr - ts + 0.07, 0.07, 0.3), done: false, whiff: false };
    p.lastSwingAt = this.time;
    if (tr <= this.time + 1e-9) this._resolve(p);
    return true;
  }

  _airSwing(p, req, reason) {
    const plan = p.plan;
    p.sw = { tr: this.time + 0.12, kind: req, shot: req, side: plan ? plan.side : 'fh', dpre: 0.12, done: false, whiff: true };
    p.cooldown = 0.42;
    this.emit({ type: 'whiff', by: p.i, reason });
  }

  _kindFor(plan, req) {
    const y = plan.P.y, z = Math.abs(plan.P.z);
    if (req === 'lob') return 'lob';
    if (plan.bounces === 0 && y >= 2.05 && z <= 9.8) return 'smash';
    if (plan.bounces === 0 && z <= 7.6) return 'volley';
    return req;
  }

  // ------------------------------------------------------------------ net rush
  _setNet(p, v) {
    p.wantNet = v;
    const z = Math.abs(p.pos.z);
    if (v) {
      if (p.zone === 'base' || p.zone === 'toBase') { this._zone(p, 'toNet'); if (this.phase === 'rally' || this.phase === 'serving') this._noteApproach(p); }
    } else if (p.zone === 'net' || p.zone === 'toNet') this._zone(p, 'toBase');
    p.recover = this._home(p);
    if (z > 99) p.recover = this._home(p);
  }
  _zone(p, z) {
    if (p.zone === z) return;
    p.zone = z;
    this.emit({ type: 'zone', by: p.i, zone: z });
  }
  _noteApproach(p) {
    if (!p.approachThisPoint) { p.approachThisPoint = true; this.stats.netApproaches[p.i]++; }
  }

  /** Home position for the current zone. */
  _home(p, landing = null) {
    const opp = this.P[1 - p.i];
    const f = p.facing;
    if (p.zone === 'net' || p.zone === 'toNet') {
      return { x: clamp((landing ? landing.x : opp.pos.x) * 0.4, -1.7, 1.7), z: f * K.NET_Z };
    }
    const deep = p.deep ? K.BACK_Z : K.BASE_Z;
    const lx = landing ? landing.x : opp.pos.x;
    return { x: clamp(lx * 0.22, -1.3, 1.3), z: f * deep };
  }

  // ------------------------------------------------------------------ ball history
  _pushHist() {
    const h = this._hist, b = this.b;
    const k = h.head;
    h.t[k] = this.time;
    const o = k * 6;
    h.d[o] = b.pos.x; h.d[o + 1] = b.pos.y; h.d[o + 2] = b.pos.z; h.d[o + 3] = b.vel.x; h.d[o + 4] = b.vel.y; h.d[o + 5] = b.vel.z;
    h.head = (k + 1) & 127;
    if (h.n < 128) h.n++;
  }
  /** Ball state at sim time tb (interpolated from the short history). */
  _ballAt(tb) {
    const h = this._hist, b = this.b;
    const cur = () => ({ pos: { ...b.pos }, vel: { ...b.vel }, spin: b.spin, t: this.time });
    if (tb >= this.time - 1e-9 || h.n < 2) return cur();
    let c = 0;
    for (; c < h.n; c++) { const k = (h.head - 1 - c) & 127; if (h.t[k] <= tb) break; }
    if (c >= h.n) c = h.n - 1;                       // older than the history: oldest sample
    const kp = (h.head - 1 - c) & 127, o = kp * 6;
    const t0 = h.t[kp];
    let o2, t1, nx, ny, nz, nvx, nvy, nvz;
    if (c === 0) { t1 = this.time; nx = b.pos.x; ny = b.pos.y; nz = b.pos.z; nvx = b.vel.x; nvy = b.vel.y; nvz = b.vel.z; }
    else { const kn = (h.head - c) & 127; o2 = kn * 6; t1 = h.t[kn]; nx = h.d[o2]; ny = h.d[o2 + 1]; nz = h.d[o2 + 2]; nvx = h.d[o2 + 3]; nvy = h.d[o2 + 4]; nvz = h.d[o2 + 5]; }
    const u = t1 > t0 ? clamp((tb - t0) / (t1 - t0), 0, 1) : 0;
    return {
      pos: { x: lerp(h.d[o], nx, u), y: lerp(h.d[o + 1], ny, u), z: lerp(h.d[o + 2], nz, u) },
      vel: { x: lerp(h.d[o + 3], nvx, u), y: lerp(h.d[o + 4], nvy, u), z: lerp(h.d[o + 5], nvz, u) },
      spin: b.spin, t: tb,
    };
  }

  // ------------------------------------------------------------------ main update
  _update(h) {
    this.time += h;
    const ph = this.phase;
    if (ph === 'serve-prep') {
      if (this.time >= this.phaseEnd) this._enterServing();
    } else if (ph === 'serving') {
      this._serveUpdate();
    } else if (ph === 'rally') {
      this._ballPhysics(h);
      this._rallyChecks();
    } else if (ph === 'point-over' || ph === 'changeover') {
      if (this.rl.live || this.b.pos.y > 0.05) this._ballPhysics(h);
      if (this.time >= this.phaseEnd) {
        if (ph === 'point-over' && this._pendingChangeover) { this._pendingChangeover = false; this.phase = 'changeover'; this.phaseEnd = this.time + this.timing.changeover; this.emit({ type: 'phase', phase: 'changeover' }); }
        else this._beginPoint(false);
      }
    }
    this._pushHist();
    for (const p of this.P) this._updatePlayer(p, h);
    for (const br of this.brains) if (br) br.tick(this);
    for (const p of this.P) {
      const pl = p.plan;
      if (pl) {
        if (!pl.snap && this.time >= pl.tContact) this._snapPlan(p);
        if (pl.swing && !pl.resolved && this.time >= pl.tContact - 1e-9) this._resolve(p);
        else if (!pl.swing && this.time > pl.tContact + 0.32) { pl.expired = true; p.plan = null; p.recover = this._home(p); }
      }
    }
  }

  _snapPlan(p) {
    const pl = p.plan;
    pl.snap = { pos: { x: p.pos.x, z: p.pos.z }, vel: { x: p.vel.x, z: p.vel.z }, stamina: p.stamina, set: p.set };
  }

  // ------------------------------------------------------------------ ball physics
  _ballPhysics(h) {
    const b = this.b, ev = this._env.events;
    const n = 2, dt = h / n;
    for (let k = 0; k < n; k++) {
      stepBall(b, dt, this._env);
      if (ev.length) { for (const e of ev) this._ballEvent(e); ev.length = 0; }
    }
  }

  _ballEvent(e) {
    const rl = this.rl, b = this.b;
    if (e.type === 'netcross') { rl.crossed = true; return; }
    if (e.type === 'net') {
      this.emit({ type: 'net', pos: { x: e.x, y: e.y, z: e.z }, cord: !!e.cord });
      if (e.cord) { rl.cord = true; return; }
      if (this.phase === 'rally' && rl.live) {
        if (rl.serve && !rl.returned) this._serveFault('net');
        else this._pointFromError(rl.hitter, 'net');
      }
      return;
    }
    if (e.type === 'bounce') {
      const inn = inCourt(e.x, e.z);
      this.emit({ type: 'bounce', pos: { x: e.x, y: 0, z: e.z }, in: inn });
      if (this.phase !== 'rally' || !rl.live) return;
      const landSide = e.z > 0 ? 0 : 1;
      const opp = 1 - rl.hitter;
      if (b.bounces === 1) {
        if (rl.serve && !rl.returned) {
          const ok = landSide === opp && inServiceBox(e.x, e.z, rl.boxSign, e.z > 0 ? 1 : -1);
          if (!ok) { this._serveFault(landSide === rl.hitter ? 'net' : 'out'); return; }
          if (rl.cord) { this._serveLet(); return; }
          rl.valid = true;
          if (rl.first) this.stats.firstServesIn[rl.hitter]++;
          this._replanAtBounce();
          return;
        }
        if (landSide === rl.hitter) { this._pointFromError(rl.hitter, 'net'); return; }
        if (!inn) { this.emit({ type: 'call', text: 'OUT' }); this._pointFromError(rl.hitter, 'out'); return; }
        rl.valid = true;
        this._replanAtBounce();
        return;
      }
      if (rl.valid) this._pointWonUnreturned(rl.hitter);
      else this._pointFromError(rl.hitter, 'net');
    }
  }

  _replanAtBounce() {
    const rec = this.P[1 - this.rl.hitter];
    if (rec.plan && !rec.plan.swing) this._planFor(rec, rec.plan);
  }

  _rallyChecks() {
    const rl = this.rl, b = this.b;
    if (!rl.live) return;
    if (b.rolling && rl.valid) { this._pointWonUnreturned(rl.hitter); return; }
    if (this.time - rl.lastHitTime > 9) {
      if (rl.valid) this._pointWonUnreturned(rl.hitter); else this._pointFromError(rl.hitter, 'out');
      return;
    }
    // ball left the world without a bounce (cannot normally happen) -> out
    if (Math.abs(b.pos.z) > 40 || Math.abs(b.pos.x) > 40) this._pointFromError(rl.hitter, 'out');
  }

  // ------------------------------------------------------------------ point flow
  _enterServing() {
    this.phase = 'serving';
    this.sv = { stage: 'wait' };
    for (const p of this.P) { if (p.walkTo) { p.pos.x = p.walkTo.x; p.pos.z = p.walkTo.z; p.vel.x = p.vel.z = 0; p.walkTo = null; } }
    this.emit({ type: 'phase', phase: 'serving' });
  }

  _serveGeom(srv) {
    const m = this.match;
    const deuce = m.serveCourt === 'deuce';
    const sx = (deuce ? 1 : -1) * srv.facing;          // server's x side
    const boxSign = -sx;
    return { sx, boxSign, cx: boxSign * 2.06, half: 1.62, side: -srv.facing };
  }

  _servePositions() {
    const m = this.match, srv = this.P[m.server], rec = this.P[1 - m.server];
    const g = this._serveGeom(srv);
    return {
      srv: { x: g.sx * 0.95, z: srv.facing * (HALF + 0.55) },
      rec: { x: g.boxSign * 1.7, z: rec.facing * (HALF + 0.9) },
    };
  }

  _beginPoint(first) {
    const m = this.match;
    this.faultCount = 0;
    this.rl = { live: false, hitter: m.server, serve: false, shots: 0, lastHitTime: this.time, cord: false, valid: false, firstBounce: false, crossed: false };
    for (const p of this.P) {
      p.plan = null; p.sw = null; p.cooldown = 0; p.wantNet = false; p.deep = false; p.hold = null; p.netThisPoint = false; p.approachThisPoint = false;
      p.zone = 'base'; p.anim.emote = null; p.splitUntil = 0;
    }
    const pos = this._servePositions();
    this.P[m.server].walkTo = pos.srv; this.P[1 - m.server].walkTo = pos.rec;
    if (first) for (const p of this.P) { const w = p.walkTo; p.pos.x = w.x; p.pos.z = w.z; p.walkTo = null; }
    this._pendingChangeover = false;
    this.phase = 'serve-prep';
    this.phaseEnd = this.time + this.timing.prep;
    this.sv = { stage: 'wait' };
    this._holdBall();
    this._pointInfo = { netPlayers: [false, false] };
    this.emit({ type: 'phase', phase: 'serve-prep' });
  }

  _retryServe() {
    this.phase = 'serve-prep';
    this.phaseEnd = this.time + this.timing.serveRetry;
    this.sv = { stage: 'wait' };
    this.rl = { live: false, hitter: this.match.server, serve: false, shots: 0, lastHitTime: this.time, cord: false, valid: false, firstBounce: false, crossed: false };
    for (const p of this.P) { p.plan = null; p.sw = null; p.cooldown = 0; p.reactUntil = 0; }
    this._holdBall();
    this.emit({ type: 'phase', phase: 'serve-prep' });
  }

  _holdBall() {
    const srv = this.P[this.match.server];
    const b = this.b;
    b.vel.x = b.vel.y = b.vel.z = 0; b.spin.x = b.spin.y = b.spin.z = 0; b.bounces = 0; b.rolling = false; b.netHit = false;
    this._tossPoint(srv, 0);
    this.ballAttach = { player: srv.i, hand: 'toss' };
    this.ballLive = false;
  }

  /** Tossing-hand position (world) for raise progress u in 0..1 (u=1 is the release point). */
  _tossPoint(srv, u) {
    const e = 1 - (1 - u) * (1 - u);
    const x = srv.pos.x - srv.handX * 0.22;
    const z = srv.pos.z - srv.facing * 0.62;
    this.b.pos.x = x; this.b.pos.z = z; this.b.pos.y = lerp(0.95, K.SERVE.releaseY, e);
  }

  _pointFromError(loser, reason) {
    if (this.phase !== 'rally') return;
    const rl = this.rl;
    const q = this.lastShot && this.lastShot.by === loser ? this.lastShot : null;
    const forced = q ? (q.pressure < 0.78) : false;
    this._endPoint(1 - loser, reason, forced ? 'forced' : 'unforced');
  }

  _pointWonUnreturned(hitter) {
    if (this.phase !== 'rally') return;
    const rl = this.rl, rec = this.P[1 - hitter];
    const m = rec.lastPlanMargin;
    const unreachable = m === undefined || m < 0.04;
    if (rl.serve && !rl.returned) {
      if (unreachable) {
        this.stats.aces[hitter]++;
        this.emit({ type: 'big', kind: 'ace' });
        this._endPoint(hitter, 'ace', 'winner');
      } else this._endPoint(hitter, 'service-winner', 'unforced');
      return;
    }
    if (unreachable) this._endPoint(hitter, 'winner', 'winner');
    else this._endPoint(hitter, 'error', 'unforced');          // the other player had time but did not (or could not) hit it
  }

  _endPoint(winner, reason, cls) {
    if (this.phase !== 'rally' && this.phase !== 'serving') return;
    const m = this.match, rl = this.rl, S = this.stats;
    const loserIdx = 1 - winner;
    S.points[winner]++;
    if (cls === 'winner' && reason !== 'ace') S.winners[winner]++;
    else if (cls === 'forced') S.forced[loserIdx]++;
    else if (cls === 'unforced') S.unforced[loserIdx]++;
    if (reason === 'double-fault') S.doubleFaults[loserIdx]++;
    for (const p of this.P) if (p.netThisPoint) { S.netPoints[p.i]++; if (winner === p.i) S.netPointsWon[p.i]++; }
    if (reason === 'service-winner') S.returnErrors[loserIdx]++;
    S.rallies.push(rl.shots);
    const serverBefore = m.server;
    const res = m.pointWon(winner);
    this.rl.live = false;
    this.phase = res.matchWon ? 'match-over' : 'point-over';
    this.phaseEnd = this.time + (res.matchWon ? this.timing.matchOver : this.timing.pointOver);
    this._pendingChangeover = !!res.changeover && !res.matchWon;
    this.emit({ type: 'point', winner, reason, shots: rl.shots, cls });
    const text = res.gameWon ? (res.setWon ? res.text : 'GAME') : m.pointText;
    this.emit({ type: 'score', text: res.gameWon ? res.text : m.pointText, games: m.games.slice(), points: m.points.slice(), pointText: m.pointText, gameWon: res.gameWon, setWon: res.setWon });
    if (reason === 'ace') { /* big emitted earlier */ }
    else if (rl.shots >= 12) this.emit({ type: 'big', kind: 'longrally' });
    else if (cls === 'winner' && !rl.serve) this.emit({ type: 'big', kind: 'winner' });
    if (res.gameWon && winner !== serverBefore) this.emit({ type: 'big', kind: 'break' });
    if (res.setWon) this.emit({ type: 'big', kind: 'set' });
    if (res.matchWon) this.emit({ type: 'big', kind: 'match' });
    this.emit({ type: 'phase', phase: this.phase });
    // reactions
    const w = this.P[winner], l = this.P[loserIdx];
    w.hold = { name: 'celebrate', until: this.time + 1.3 }; l.hold = { name: 'dejected', until: this.time + 1.3 };
    w.anim.emote = 'happy'; l.anim.emote = 'frustrated';
    w.plan = null; l.plan = null;
    w.walkTo = null; l.walkTo = null;
    if (!res.matchWon) {
      const pos = this._servePositions();
      this.P[m.server].walkTo = pos.srv; this.P[1 - m.server].walkTo = pos.rec;
      this.P[m.server].walkAt = this.time + 1.0; this.P[1 - m.server].walkAt = this.time + 1.0;
    }
  }

  // ------------------------------------------------------------------ serve
  _serveFault(why) {
    if (this.phase !== 'rally') return;
    const m = this.match, srvIdx = m.server;
    this.faultCount++;
    m.faultCount = this.faultCount;
    this.rl.live = false;
    if (this.faultCount >= 2) {
      this.emit({ type: 'call', text: 'DOUBLE FAULT' });
      this._endPoint(1 - srvIdx, 'double-fault', 'unforced');
    } else {
      this.emit({ type: 'call', text: why === 'out' ? 'FAULT' : 'FAULT' });
      this._retryServe();
    }
  }
  _serveLet() {
    this.emit({ type: 'call', text: 'LET' });
    this.rl.live = false;
    this._retryServe();
  }

  _serveUpdate() {
    const sv = this.sv, srv = this.P[this.match.server], b = this.b;
    if (sv.stage === 'wait') { this._tossPoint(srv, 0); return; }
    if (sv.stage === 'raise') {
      const u = clamp((this.time - sv.t0) / K.SERVE.raise, 0, 1);
      this._tossPoint(srv, u);
      if (u >= 1) {
        sv.stage = 'flight';
        this.ballAttach = null;
        b.vel.x = b.vel.z = 0; b.vel.y = sv.vy0;
      }
      return;
    }
    if (sv.stage === 'flight') {
      const tau = this.time - sv.tRel;
      b.pos.x = sv.x; b.pos.z = sv.z;
      b.pos.y = K.SERVE.releaseY + sv.vy0 * tau - 0.5 * G * tau * tau;
      b.vel.y = sv.vy0 - G * tau; b.vel.x = b.vel.z = 0;
      if (this.time > sv.tApex + K.SERVE.catchAfter) {
        // toss wasted: catch it, re-toss without penalty
        this.sv = { stage: 'wait' };
        this.srvAnimReset(srv);
        this._holdBall();
        this.emit({ type: 'whiff', by: srv.i, reason: 'toss' });
      }
    }
  }
  srvAnimReset(p) { p.serveAnim = null; }

  _serveSwing(p, o, ts, src) {
    const m = this.match;
    if (p.i !== m.server) return false;
    const sv = this.sv;
    if (sv.stage === 'wait') {
      sv.stage = 'raise'; sv.t0 = this.time;
      sv.tRel = this.time + K.SERVE.raise;
      sv.vy0 = Math.sqrt(2 * G * (K.SERVE.apexY - K.SERVE.releaseY));
      sv.tApex = sv.tRel + sv.vy0 / G;
      sv.x = p.pos.x - p.handX * 0.22 + p.handX * 0.0;
      sv.z = p.pos.z - p.facing * 0.62;
      p.serveAnim = { t0: this.time, hit: null };
      this.emit({ type: 'toss', by: p.i });
      return true;
    }
    if (sv.stage !== 'flight' && sv.stage !== 'raise') return false;
    if (sv.stage === 'raise' || ts < sv.tRel + 0.04) return false;
    return this._serveHit(p, o, ts, src);
  }

  _serveHit(p, o, ts, src) {
    const sv = this.sv, m = this.match;
    const first = this.faultCount === 0;
    const win = src === 'remote' ? K.REMOTE : { T_MISS: K.T_MISS, T_PERFECT: K.T_PERFECT };
    const t = ts - sv.tApex;
    const power = clamp(o.power ?? 0.75, 0, 1);
    const g = this._serveGeom(p);
    const stats = this.stats;
    if (first) { stats.firstServes[p.i]++; }
    const tau = ts - sv.tRel;
    const pos = { x: sv.x, y: K.SERVE.releaseY + sv.vy0 * tau - 0.5 * G * tau * tau, z: sv.z };
    const now = this.time;
    p.serveAnim.hit = ts;
    // air ball
    if (Math.abs(t) > win.T_MISS) {
      this.emit({ type: 'whiff', by: p.i, reason: 'serve' });
      this.phase = 'rally';
      this.rl = { live: false, hitter: p.i, serve: true, shots: 0, lastHitTime: now, cord: false, valid: false, firstBounce: false, crossed: false, boxSign: g.boxSign };
      this.ballAttach = null;
      this.sv.stage = 'hit';
      this.ballLive = true;
      this.rl.live = true;
      this._serveFault('air');
      return true;
    }
    const at = Math.abs(t);
    const label = at <= win.T_PERFECT ? 'perfect' : at > K.T_FULL ? 'wide' : t < 0 ? 'early' : 'late';
    const fT = at <= win.T_PERFECT ? 1 : Math.max(0.3, 1 - 0.62 * Math.pow((at - win.T_PERFECT) / (K.T_MISS - win.T_PERFECT), 1.1));
    const stamF = 0.92 + 0.08 * p.stamina;
    const dirT = clamp(t / K.T_FULL, -1.7, 1.7);
    const aim = dirT * p.handX;
    const aimC = clamp(aim, -1, 1);
    let tx = g.cx + aimC * g.half;
    if (Math.abs(aim) > 1) tx = g.cx + sgn(aim) * (g.half + (Math.abs(aim) - 1) * 3);
    const power1 = first ? power : Math.min(power, 0.62);
    const dm = first ? lerp(1.35, 0.55, power) : lerp(1.7, 1.15, power);
    const tz = g.side * (COURT.serviceLineDist - dm);
    let speed = (first ? lerp(104, 160, power) : lerp(84, 114, power1)) * (0.8 + 0.2 * fT) * stamF / KMH;
    const top = (first ? 650 : 3000) * Math.PI / 30;
    const q = clamp(fT * stamF, 0, 1);
    const risk = first ? (0.7 + 0.6 * power) : 0.55;
    const sd = (0.2 + 1.7 * Math.pow(1 - q, 1.3)) * risk;
    const sl = (0.12 + 1.3 * Math.pow(1 - q, 1.3)) * risk;
    const sol = solveLaunch({ pos, target: { x: tx, z: tz }, speed, top, surface: this.surface, clear: first ? 0.14 : 0.32 });
    const sc = scatterLaunch(sol, sd, sl, this.rng);
    // apply
    const b = this.b;
    b.pos.x = pos.x; b.pos.y = pos.y; b.pos.z = pos.z;
    b.vel.x = sc.vel.x; b.vel.y = sc.vel.y; b.vel.z = sc.vel.z;
    b.spin.x = sc.spin.x; b.spin.y = sc.spin.y; b.spin.z = sc.spin.z;
    b.bounces = 0; b.rolling = false; b.netHit = false;
    this.phase = 'rally';
    this.sv.stage = 'hit';
    this.ballAttach = null;
    this.rl = {
      live: true, hitter: p.i, serve: true, shots: 1, lastHitTime: ts, cord: false, valid: false, firstBounce: false, crossed: false,
      boxSign: g.boxSign, returned: false, recvInfeasible: false, first,
    };
    const spd = Math.hypot(sc.vel.x, sc.vel.y, sc.vel.z) * KMH;
    const shot = { by: p.i, shot: first ? 'flat' : 'topspin', side: 'fh', timing: label, timingMs: Math.round(t * 1000), dir: clamp(t / K.T_FULL, -1, 1),
      aim: clamp(aim, -1, 1), power, quality: q, setv: 1, speedKmh: spd, spinRpm: Math.abs(top) * 30 / Math.PI, target: { x: tx, z: tz }, mishit: label === 'wide' ? 'wide' : null, serve: true, first };
    this.lastShot = shot;
    p.lastQ = q;
    p.serveAnim.contactPos = pos;
    this.emit({ type: 'hit', by: p.i, shot: shot.shot, side: 'fh', timing: label, timingMs: shot.timingMs, dir: shot.dir, aim: shot.aim, power, quality: q, speedKmh: spd,
      pos: { x: pos.x, y: pos.y, z: pos.z }, serve: true, mishit: shot.mishit, first });
    if (now - ts > 1e-6) this._catchUp(now - ts);
    this._afterHit(p, null);
    p.vy = 2.6; p.y = 0.0;
    if (p.wantNet) { this._zone(p, 'toNet'); this._noteApproach(p); }
    return true;
  }

  // ------------------------------------------------------------------ after a hit: plan the opponent, recovery
  _afterHit(p, landing) {
    const opp = this.P[1 - p.i];
    const rl = this.rl;
    p.plan = null;
    opp.splitUntil = this.time + 0.16;
    opp.reactUntil = this.time + opp.reaction;
    p.recover = this._home(p, landing);
    this._planFor(opp, null);
    if (rl.serve && opp.plan === null) rl.recvInfeasible = false;
    if (rl.serve) rl.recvInfeasible = !opp.plan || opp.plan.margin < 0;
  }

  _catchUp(dt) {
    const n = Math.round(dt / (H / 2));
    const ev = this._env.events;
    for (let k = 0; k < n; k++) {
      stepBall(this.b, H / 2, this._env);
      if (ev.length) { for (const e of ev) this._ballEvent(e); ev.length = 0; }
      if (this.phase !== 'rally') break;
    }
  }

  // ------------------------------------------------------------------ intercept planning
  _vmaxOf(p) { return K.VMAX * (0.72 + 0.28 * p.stamina); }
  _moveTime(p, d, tx, tz) {
    const vm = this._vmaxOf(p), a = K.ACC, bdec = K.DEC;
    let t;
    const dEq = vm * vm * 0.5 * (1 / a + 1 / bdec);
    if (d < dEq) { const v = Math.sqrt(2 * d / (1 / a + 1 / bdec)); t = v / a + v / bdec; }
    else t = vm / a + vm / bdec + (d - dEq) / vm;
    // moving the wrong way costs braking time
    if (d > 0.01) {
      const dot = (p.vel.x * tx + p.vel.z * tz) / d;
      if (dot < 0) t += -dot / a * 1.2;
    }
    return t;
  }

  _standFor(p, side, P, kind) {
    const f = p.facing;
    let x, z;
    if (kind === 'smash') { x = P.x - p.handX * 0.15; z = P.z + f * 0.3; }
    else {
      const s = side === 'fh' ? 1 : -1;
      x = P.x - s * p.handX * K.IDEAL_LAT[side];
      z = P.z + f * K.IDEAL_FWD;
    }
    x = clamp(x, -7, 7);
    const az = Math.max(0.9, Math.abs(z));
    return { x, z: f * Math.min(az, 17.5) };
  }

  _planFor(p, old) {
    const b = this.b, rl = this.rl;
    if (!rl.live || rl.hitter === p.i) { p.plan = null; return; }
    const pred = simulateTrajectory(b, { surface: this.surface, dt: PLAN_DT, path: true, pathDt: 1 / 60, stopAfterBounces: 2, maxTime: 3.6 });
    p.plan = null;
    p.lastPlanMargin = undefined;
    if (pred.hitNet) return;
    const f = p.facing;
    const b0 = b.bounces;
    if (b0 === 0 && pred.landing) {
      const L = pred.landing;
      if (Math.sign(L.z) !== f) return;                                   // lands on the other side -> net error, leave it
      if (rl.serve && !rl.returned) { if (!inServiceBox(L.x, L.z, rl.boxSign, f)) return; }
      else if (!inCourt(L.x, L.z)) return;                               // going out -> let it go
    } else if (b0 === 0 && !pred.landing) return;
    const netMode = p.zone === 'net' || p.zone === 'toNet';
    const cands = [];
    const path = pred.path;
    const tNow = this.time;
    for (let k = 1; k < path.length; k++) {
      const s = path[k];
      if (Math.sign(s.z) !== f) continue;
      const az = Math.abs(s.z);
      if (az < 0.7 || az > HALF + 4.3 || Math.abs(s.x) > 7.5) continue;
      const nb = s.b - b0;                                              // bounces on my side so far at this sample
      if (nb >= 2) break;
      if (b0 >= 1 && nb >= 1) break;
      const y = s.y;
      let kind = null, comfort = 0;
      if (nb === 0 && b0 === 0) {
        if (y >= 2.0 && y <= K.SMASH_Y && az <= 9.6) { kind = 'smash'; comfort = 1; }
        else if (netMode && az <= 7.4 && y >= 0.45 && y <= 2.0) { kind = 'volley'; comfort = y >= 0.65 && y <= 1.7 ? 1 : 0.5; }
      } else if (b0 === 0 ? nb === 1 : true) {
        if (y >= 0.6 && y <= 1.6) { kind = 'ground'; comfort = 1; }
        else if (y >= 0.32 && y <= 2.15) { kind = 'ground'; comfort = 0.4; }
        else if (y >= 0.2 && y <= 2.3) { kind = 'ground'; comfort = 0.2; }
      }
      if (!kind) continue;
      cands.push({ k, s, kind, comfort, t: tNow + s.t });
    }
    if (!cands.length) return;
    const rtRemain = Math.max(0, p.reactUntil - tNow);
    const evalCand = (c) => {
      const P = { x: c.s.x, y: c.s.y, z: c.s.z };
      let best = null;
      const sides = c.kind === 'smash' ? ['fh'] : ['fh', 'bh'];
      for (const side of sides) {
        const stand = this._standFor(p, side, P, c.kind);
        const dx = stand.x - p.pos.x, dz = stand.z - p.pos.z, d = Math.hypot(dx, dz);
        const need = rtRemain + this._moveTime(p, d, dx, dz) + K.SETUP_TIME;
        const margin = (c.t - tNow) - need;
        const sc = d + (side === 'fh' ? 0 : 0.25);
        if (!best || sc < best.sc) best = { side, stand, d, margin, sc, P };
      }
      return best;
    };
    let chosen = null;
    // sticky: keep the old contact time if still feasible
    if (old) {
      let bestd = 1e9;
      for (const c of cands) {
        const e = evalCand(c);
        const dd = Math.abs(c.t - old.tContact);
        if (dd < 0.09 && e.margin >= -K.SETUP_TIME - 0.03 && dd < bestd) { bestd = dd; chosen = { c, e }; }
      }
    }
    if (!chosen) {
      for (const pass of [0.12, 0.0]) {
        for (const c of cands) {
          if (c.comfort < 1 && pass > 0) continue;
          const e = evalCand(c);
          if (e.margin >= pass) { chosen = { c, e }; break; }
        }
        if (chosen) break;
      }
    }
    if (!chosen) {
      // nothing reachable: choose the candidate with the best margin (smallest lateness)
      let bm = -1e9;
      for (const c of cands) {
        const e = evalCand(c);
        const sc = e.margin - (1 - c.comfort) * 0.05;
        if (sc > bm) { bm = sc; chosen = { c, e }; }
      }
      if (!chosen) return;
    }
    const { c, e } = chosen;
    const noisy = !old && b0 === 0;
    const sig = p.perceive;
    const stand = noisy
      ? { x: e.stand.x + this.rng.gauss(0, sig * 0.5), z: e.stand.z + this.rng.gauss(0, sig * 0.7) }
      : e.stand;
    if (noisy) { stand.z = f * Math.max(0.9, Math.abs(stand.z)); }
    p.plan = {
      tContact: c.t, P: e.P, vel: { x: c.s.vx, y: c.s.vy, z: c.s.vz }, side: e.side, kind: c.kind, bounces: c.s.b - b0 + 0, pre: c.s.b === b0,
      stand, standTrue: e.stand, margin: e.margin, inSpeed: Math.hypot(c.s.vx, c.s.vy, c.s.vz),
      swing: null, resolved: false, snap: null, expired: false, id: ++this._planId,
    };
    p.plan.bounces = c.s.b === b0 && b0 === 0 ? 0 : 1;
    p.lastPlanMargin = e.margin;
    if (rl.serve && !rl.returned) rl.recvInfeasible = e.margin < 0;
  }

  // ------------------------------------------------------------------ hit resolution
  _local(p, side, snapPos, bp) {
    const s = side === 'fh' ? 1 : -1;
    return { lat: s * (bp.x - snapPos.x) * p.handX, fwd: (bp.z - snapPos.z) * -p.facing, h: bp.y };
  }

  _resolve(p) {
    const plan = p.plan, sw = plan.swing;
    plan.resolved = true;
    if (!plan.snap) this._snapPlan(p);
    const snap = plan.snap;
    const tb = clamp(sw.ts, plan.tContact, plan.tContact + 0.045);
    const B = this._ballAt(tb);
    const kind = this._kindFor(plan, sw.shot);
    const loc = this._local(p, plan.side, snap.pos, B.pos);
    const spd = Math.hypot(snap.vel.x, snap.vel.z);
    const maxR = K.REACH[plan.side] + K.LUNGE * clamp(spd / 6, 0, 1);
    const reachY = kind === 'smash' ? K.SMASH_Y : K.REACH_Y;
    p.sw.done = false;
    if (loc.lat > maxR + 0.12 || loc.lat < -0.45 || B.pos.y > reachY + 0.25 || loc.fwd < -1.5 || loc.fwd > 2.4) {
      p.sw.whiff = true; p.cooldown = 0.35;
      this.emit({ type: 'whiff', by: p.i, reason: 'reach' });
      p.plan = null;
      return;
    }
    const t = sw.t;
    const at = Math.abs(t);
    const win = sw.win;
    const label = at <= win.T_PERFECT ? 'perfect' : at > K.T_FULL ? 'wide' : t < 0 ? 'early' : 'late';
    const rd = Math.hypot(snap.pos.x - plan.standTrue.x, snap.pos.z - plan.standTrue.z);
    const reachT = clamp((loc.lat - 1.0) / Math.max(0.1, maxR - 1.0), 0, 1);
    const vf = (snap.vel.z * -p.facing);
    const back = vf < -1.5 ? clamp((-vf - 1.5) / 3, 0, 1) * 0.18 : 0;
    const setv = clamp(1 - 0.38 * clamp(spd / 6, 0, 1) - 0.28 * clamp(rd / 1.6, 0, 1) - 0.34 * reachT - back, 0, 1);
    const vIn = Math.hypot(B.vel.x, B.vel.y, B.vel.z);
    const fPace = clamp(1 - 0.014 * Math.max(0, vIn - 22), 0.55, 1);
    const y = B.pos.y;
    let fH = 1;
    const lo = kind === 'volley' ? 0.7 : 0.6, hi = kind === 'volley' ? 1.9 : kind === 'smash' ? 3.0 : 1.45;
    if (y < lo) fH = 1 - 0.4 * clamp((lo - y) / 0.4, 0, 1);
    else if (y > hi) fH = 1 - 0.3 * clamp((y - hi) / 1.0, 0, 1);
    const fS = 0.92 + 0.08 * snap.stamina;
    let fT;
    if (at <= win.T_PERFECT) fT = 1;
    else if (at <= K.T_FULL) fT = lerp(1, 0.88, (at - win.T_PERFECT) / (K.T_FULL - win.T_PERFECT));
    else fT = 0.62 - 0.22 * clamp((at - K.T_FULL) / (K.T_MISS - K.T_FULL), 0, 1);
    let q = clamp((0.32 + 0.68 * setv) * fPace * fH * fS * fT, 0, 1);
    const mishit = label === 'wide' ? 'wide' : (reachT > 0.8 ? 'stretch' : null);
    // ---- target
    const dirT = clamp(t / K.T_FULL, -1.7, 1.7);
    const sgnS = (plan.side === 'fh' ? 1 : -1) * p.handX;
    const aim = dirT * sgnS;
    let tx = Math.abs(aim) <= 1 ? aim * K.AIM_X : sgn(aim) * (K.AIM_X + (Math.abs(aim) - 1) * K.AIM_WIDE / 0.7);
    const power = sw.power;
    const opp = 1 - p.i;
    const fOpp = -p.facing;                                   // sign of the opponent's half (z)
    let shotName = kind, params, tz, sol, top;
    const isDrop = (kind === 'slice' || kind === 'volley') && power <= DROP_POWER;
    if (kind === 'lob') {
      params = strokeParams('topspin', 0.4);
      tz = fOpp * (HALF - lerp(2.6, 1.3, power));
      top = 1100 * Math.PI / 30;
      const el = lerp(LOB_EL[0], LOB_EL[1], power);
      sol = solveLaunch({ pos: B.pos, target: { x: tx * 0.85, z: tz }, speed: 20, top, surface: this.surface, elevation: el });
      tx *= 0.85;
    } else {
      const key = kind === 'smash' ? 'smash' : kind === 'volley' ? 'volley' : STROKES[kind] ? kind : 'topspin';
      params = strokeParams(key, power);
      top = params.top;
      if (isDrop) {
        const dd = lerp(1.7, 3.4, power / DROP_POWER);
        tz = fOpp * dd; tx *= 0.7;
        params.speed = lerp(9, 15, power / DROP_POWER);
        params.clear = 0.2;
        top = -2500 * Math.PI / 30;
        shotName = kind === 'volley' ? 'volley' : 'slice';
      } else {
        tz = fOpp * (HALF - params.mIn);
        shotName = key;
      }
      let speed = params.speed * (0.8 + 0.2 * q);
      if (!isDrop) speed += (kind === 'volley' ? 0.26 : 0.1) * Math.max(0, vIn - 12);
      if (label === 'wide') speed *= 0.85;
      speed = Math.max(speed, 8);
      sol = solveLaunch({ pos: B.pos, target: { x: tx, z: tz }, speed, top, surface: this.surface, clear: params.clear });
    }
    // ---- scatter
    const edge = clamp(1 - Math.min(COURT.singlesHalfWidth - Math.abs(tx), isDrop ? 3 : Math.abs(tz) > 0 ? HALF - Math.abs(tz) : 3) / 1.6, 0, 1);
    const pw = 0.72 + 0.56 * power;
    const kScale = kind === 'smash' ? 1.15 : kind === 'volley' ? 0.9 : kind === 'lob' ? 0.9 : 1;
    const sd = (0.16 + 1.9 * Math.pow(1 - q, 1.3)) * pw * (1 + 0.45 * edge) * kScale + (label === 'wide' ? 0.5 : 0);
    const sl = (0.14 + 1.5 * Math.pow(1 - q, 1.3)) * pw * (1 + 0.3 * edge) * kScale + (label === 'wide' ? 0.4 : 0);
    const sCl = (0.06 + 0.6 * Math.pow(1 - q, 1.2)) * pw * kScale + (label === 'wide' ? 0.15 : 0);
    const sc = scatterLaunch(sol, sd, sl, this.rng, sCl);
    // ---- apply to the ball
    const b = this.b;
    b.pos.x = B.pos.x; b.pos.y = Math.max(0.06, B.pos.y); b.pos.z = B.pos.z;
    b.vel.x = sc.vel.x; b.vel.y = sc.vel.y; b.vel.z = sc.vel.z;
    b.spin.x = sc.spin.x; b.spin.y = sc.spin.y; b.spin.z = sc.spin.z;
    b.bounces = 0; b.rolling = false; b.netHit = false;
    const rl = this.rl;
    this.rl = {
      live: true, hitter: p.i, serve: false, shots: rl.shots + 1, lastHitTime: tb, cord: false, valid: false, firstBounce: false, crossed: false,
      returned: true, boxSign: 0, recvInfeasible: false,
    };
    const speedKmh = Math.hypot(sc.vel.x, sc.vel.y, sc.vel.z) * KMH;
    const shot = {
      by: p.i, shot: shotName, side: plan.side, timing: label, timingMs: Math.round(t * 1000), dir: clamp(t / K.T_FULL, -1, 1), aim: clamp(aim, -1, 1),
      power, quality: q, setv, pressure: setv * fPace, speedKmh, spinRpm: Math.abs(top) * 30 / Math.PI, target: { x: tx, z: tz }, mishit,
    };
    this.lastShot = shot;
    p.lastQ = q; p.lastSet = setv;
    p.sw.shot = shotName; p.sw.kind = kind;
    p.sw.contact = { lat: loc.lat, fwd: loc.fwd, h: B.pos.y };
    if (kind === 'smash') { p.vy = 3.4; }
    this.emit({
      type: 'hit', by: p.i, shot: shotName, side: plan.side, timing: label, timingMs: shot.timingMs, dir: shot.dir, aim: shot.aim, power, quality: q, setv,
      speedKmh, pos: { x: B.pos.x, y: B.pos.y, z: B.pos.z }, mishit,
    });
    const now = this.time;
    if (now - tb > 1e-6) this._catchUp(now - tb);
    if (Math.abs(snap.pos.z) <= K.NET_ARRIVE + 0.5) p.netThisPoint = true;
    if (Math.abs(snap.pos.z) > 9.2 && p.wantNet && !p.human) { /* AI manages its own net state */ }
    if (Math.abs(snap.pos.z) > 9.4 && p.wantNet) this._setNet(p, false);
    p.deep = Math.abs(snap.pos.z) > K.BASE_Z + 0.8 && q < 0.6;
    p.plan = null;
    p.cooldown = 0.25;
    this._afterHit(p, sol.landing || { x: tx, z: tz });
  }

  // ------------------------------------------------------------------ players
  _updatePlayer(p, h) {
    const time = this.time;
    const ph = this.phase;
    const a = p.anim;
    if (p.cooldown > 0) p.cooldown -= h;
    if (p.hold && time >= p.hold.until) { p.hold = null; a.emote = null; }
    if (p.walkAt && time >= p.walkAt) p.walkAt = 0;
    // ---- choose the movement target
    let target = null, vcap = this._vmaxOf(p), kind = 'idle', arriveBy = 0;
    const live = ph === 'rally';
    if (ph === 'serve-prep' || ph === 'serving') {
      if (p.walkTo) { target = p.walkTo; vcap = K.WALK_SPEED; kind = 'walk'; }
    } else if (ph === 'point-over' || ph === 'changeover') {
      if (p.walkTo && !p.walkAt) { target = p.walkTo; vcap = K.WALK_SPEED; kind = 'walk'; }
    } else if (live) {
      const pl = p.plan;
      if (pl && !pl.expired) {
        if (time >= p.reactUntil) { target = pl.stand; arriveBy = pl.tContact - K.SETUP_TIME; kind = 'chase'; }
      } else {
        target = p.recover; kind = 'recover';
        if (p.zone === 'toNet') vcap = K.RUSH_VMAX; else if (p.zone === 'toBase') vcap = this._vmaxOf(p) * 0.92; else vcap *= 0.7;
        if (p.zone === 'toNet' || p.zone === 'net') { p.recover = this._home(p); target = p.recover; }
      }
      if (p.zone === 'toNet' && kind === 'chase') vcap = Math.max(vcap, K.RUSH_VMAX * 0.95);
    }
    // ---- zone transitions
    const az = Math.abs(p.pos.z);
    if (p.zone === 'toNet' && az <= K.NET_ARRIVE) this._zone(p, 'net');
    else if (p.zone === 'toBase' && az >= HALF - 1.2) this._zone(p, 'base');
    // ---- integrate
    let dx = 0, dz = 0, dist = 0, dvx = 0, dvz = 0;
    if (target) {
      dx = target.x - p.pos.x; dz = target.z - p.pos.z; dist = Math.hypot(dx, dz);
      if (dist > 1e-4) {
        let vd = Math.min(vcap, Math.sqrt(2 * K.DEC * 0.85 * Math.max(dist - 0.02, 0)));
        if (arriveBy) {
          const tl = arriveBy - time;
          if (tl > 0.03) vd = Math.min(vd, Math.max(1.25 * dist / tl, 0.9));
        }
        let ux = dx / dist, uz = dz / dist;
        let vx = ux * vd, vz = uz * vd;
        if (p.zone === 'net') vx *= K.NET_LATERAL;
        dvx = vx; dvz = vz;
      }
    }
    const curS = Math.hypot(p.vel.x, p.vel.z);
    const desS = Math.hypot(dvx, dvz);
    const lim = (desS < curS ? K.DEC : K.ACC) * h;
    let ex = dvx - p.vel.x, ez = dvz - p.vel.z;
    const em = Math.hypot(ex, ez);
    if (em > lim) { ex *= lim / em; ez *= lim / em; }
    p.vel.x += ex; p.vel.z += ez;
    if (!target || (dist < 0.03 && Math.hypot(p.vel.x, p.vel.z) < 0.4)) {
      if (!target && curS < 0.05) { p.vel.x = 0; p.vel.z = 0; }
      if (target && dist < 0.03) { p.vel.x = 0; p.vel.z = 0; p.pos.x = target.x; p.pos.z = target.z; }
    }
    const sp = Math.hypot(p.vel.x, p.vel.z);
    p.pos.x += p.vel.x * h; p.pos.z += p.vel.z * h;
    if (sgn(p.pos.z) !== p.facing || Math.abs(p.pos.z) < 0.8) p.pos.z = p.facing * 0.8;
    p.pos.x = clamp(p.pos.x, -9, 9); p.pos.z = clamp(p.pos.z, -19, 19);
    // jump (smash / serve)
    if (p.vy !== 0 || p.y > 0) { p.vy -= G * h; p.y += p.vy * h; if (p.y <= 0) { p.y = 0; p.vy = 0; } }
    // ---- stamina
    const r = sp / K.VMAX;
    if (live && sp > 1) p.stamina = clamp(p.stamina - (K.STAMINA.drain * Math.max(0, r - 0.45) * 1.8 + K.STAMINA.jog * r) * h, 0, 1);
    else p.stamina = clamp(p.stamina + (live ? K.STAMINA.rest : K.STAMINA.between * 0.3) * h, 0, 1);
    // ---- set (settled-ness)
    if (live && p.plan && !p.plan.expired) {
      const rd = Math.hypot(p.pos.x - p.plan.standTrue.x, p.pos.z - p.plan.standTrue.z);
      p.set = clamp(1 - 0.38 * clamp(sp / 6, 0, 1) - 0.3 * clamp(rd / 1.6, 0, 1), 0, 1);
    } else p.set = clamp(1 - 0.35 * clamp(sp / 6, 0, 1), 0, 1);
    this._animate(p, h, sp, kind, time);
  }

  _animate(p, h, sp, kind, time) {
    const a = p.anim;
    const acc = (sp - p.prevSpeed) / h;
    p.prevSpeed = sp;
    p.accel = p.accel * 0.85 + clamp(acc / K.ACC, -1, 1) * 0.15;
    // direction / face
    if (sp > 0.3) { p.dirv.x = p.vel.x / sp; p.dirv.z = p.vel.z / sp; }
    const fwdZ = -p.facing;
    const along = p.dirv.z * fwdZ;
    let tx = 0, tz = fwdZ;
    if (sp > 3.4 && along > -0.2) { const wgt = clamp((sp - 3.0) / 3, 0, 0.75); tx = p.dirv.x * wgt; tz = fwdZ * (1 - wgt) + p.dirv.z * wgt; }
    if (this.phase === 'serve-prep' || this.phase === 'serving') { tz = fwdZ; tx = 0; }
    if (p.hold && p.hold.name === 'celebrate') { tx = 0; tz = fwdZ; }
    const targetAng = Math.atan2(tx, tz);
    let d = targetAng - p.faceAng;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const maxTurn = 14 * h;
    p.faceAng += clamp(d, -maxTurn, maxTurn);
    a.face.x = Math.sin(p.faceAng); a.face.z = Math.cos(p.faceAng);
    a.dir.x = p.dirv.x; a.dir.z = p.dirv.z;
    a.speed = clamp(sp / K.VMAX, 0, 1.2);
    a.accel = clamp(p.accel, -1, 1);
    // gait advances with distance
    const stride = sp < 0.2 ? 0.5 : lerp(0.45, 1.65, clamp((sp - 0.4) / 5.4, 0, 1));
    a.strideLen = stride;
    if (sp > 0.15) p.gait = (p.gait + sp * h / stride) % 1;
    a.gait = p.gait;
    // swing / serve animation
    const sw = p.sw;
    let name = null, phase = 0;
    if (this.sv && p.serveAnim && (this.phase === 'serving' || (this.phase === 'rally' && this.sv.stage === 'hit' && p.serveAnim.hit !== null))) {
      const sa = p.serveAnim;
      if (sa.hit === null && this.sv.stage !== 'wait') {
        name = 'toss';
        phase = clamp((time - this.sv.t0) / (this.sv.tApex - this.sv.t0), 0, 1);
      } else if (sa.hit !== null) {
        const u = (time - sa.hit) / 0.55;
        if (u < 1) { name = 'serve'; phase = 0.65 + 0.35 * clamp(u, 0, 1); }
        else p.serveAnim = null;
      }
    }
    if (!name && sw) {
      if (time <= sw.tr + FOLLOW) {
        if (time >= sw.tr - sw.dpre) {
          name = 'swing';
          if (time < sw.tr) {
            const u = clamp((time - (sw.tr - sw.dpre)) / sw.dpre, 0, 1);
            const p0 = 0.5 - 0.42 * clamp(sw.dpre / 0.3, 0.25, 1);
            phase = p0 + (0.5 - p0) * u;
          } else phase = 0.5 + 0.5 * clamp((time - sw.tr) / FOLLOW, 0, 1);
        }
      } else { sw.done = true; p.sw = null; }
    }
    if (!name) {
      if (time < p.splitUntil && this.phase === 'rally') { name = 'split'; phase = 1 - (p.splitUntil - time) / 0.16; if (p.y < 0.05) p.y = 0.05 * Math.sin(Math.PI * clamp(phase, 0, 1)); }
      else if (p.hold) name = p.hold.name;
      else if (this.phase === 'serve-prep' || this.phase === 'serving' || this.phase === 'point-over' || this.phase === 'changeover') name = sp > 0.35 ? 'walk' : 'ready';
      else if (sp > 2.2 && p.accel < -0.45 && kind !== 'recover') name = 'brake';
      else if (sp > 3.2) name = along < -0.45 ? 'backpedal' : 'run';
      else if (sp > 0.9) name = along < -0.5 ? 'backpedal' : 'shuffle';
      else name = 'ready';
    }
    a.name = name; a.phase = phase;
    if (name === 'swing' && sw) { a.shot = sw.shot === 'topspin' || sw.shot === 'flat' || sw.shot === 'slice' || sw.shot === 'lob' || sw.shot === 'volley' || sw.shot === 'smash' ? sw.shot : 'topspin'; a.side = sw.side; }
    else if (name === 'serve') { a.shot = 'flat'; a.side = 'fh'; }
    else if (name === 'toss') { a.shot = null; a.side = null; }
    else { a.shot = null; a.side = null; }
    // contact / prep
    const pl = p.plan;
    if (name === 'swing' && sw && sw.contact) a.contact = sw.contact;
    else if (pl && !pl.expired) {
      const loc = this._local(p, pl.side, p.pos, pl.P);
      a.contact = { lat: loc.lat, fwd: loc.fwd, h: loc.h };
    } else if (name !== 'swing') a.contact = null;
    a.reachT = pl && !pl.expired && a.contact ? clamp((a.contact.lat - 1.0) / 0.55, 0, 1) : (a.contact && name === 'swing' ? clamp((a.contact.lat - 1.0) / 0.55, 0, 1) : 0);
    if (pl && !pl.expired && !pl.swing && this.phase === 'rally') a.prep = clamp(1 - (pl.tContact - time) / 0.35, 0, 1); else a.prep = 0;
    if (a.side === null && pl && !pl.expired) a.nextSide = pl.side; else a.nextSide = a.side;
  }

  // ------------------------------------------------------------------ state sync
  _sync() {
    const s = this.state, m = this.match;
    s.time = this.time; s.timeScale = this.timeScale;
    const b = this.b, sb = s.ball;
    sb.visible = true; sb.inPlay = this.phase === 'rally' && this.rl.live; sb.bounces = b.bounces;
    sb.lastHitBy = this.rl.live || this.phase !== 'serve-prep' ? this.rl.hitter : null;
    sb.attach = this.ballAttach || null;
    sb.pos = b.pos; sb.vel = b.vel; sb.spin = b.spin;
    for (let i = 0; i < 2; i++) {
      const p = this.P[i], sp = s.players[i];
      sp.y = p.y; sp.zone = p.zone; sp.stamina = p.stamina; sp.set = p.set;
      sp.racketTip = this._racketTip(p);
    }
    const sm = s.match;
    sm.phase = this.phase; sm.server = m.server; sm.serveCourt = m.serveCourt; sm.faultCount = this.faultCount;
    sm.points = m.points; sm.games = m.games; sm.sets = m.sets; sm.setsWon = m.setsWon; sm.isTiebreak = m.isTiebreak;
    sm.pointText = m.pointText; sm.winner = m.winner;
    s.rally.shots = this.rl.shots; s.rally.lastHitTime = this.rl.lastHitTime;
    s.lastShot = this.lastShot;
    // hint
    const hi = this.humanIdx < 0 ? 0 : this.humanIdx, hp = this.P[hi], H_ = s.hint;
    H_.i = hi; H_.contactIn = null; H_.canServe = false; H_.tossUp = false; H_.text = '';
    H_.side = hp.plan ? hp.plan.side : (hp.anim.side || 'fh');
    if (this.phase === 'serving' && m.server === hi) {
      if (this.sv.stage === 'wait') { H_.canServe = true; H_.text = '挥拍抛球'; }
      else if (this.sv.stage === 'raise') { H_.tossUp = true; H_.canServe = true; H_.contactIn = Math.max(0, (this.sv.tApex - this.time) / this.timeScale); H_.text = '球到最高点时挥拍'; }
      else if (this.sv.stage === 'flight') { H_.tossUp = true; H_.canServe = true; H_.contactIn = Math.max(0, (this.sv.tApex - this.time) / this.timeScale); H_.text = '球到最高点时挥拍'; }
    } else if (this.phase === 'serve-prep' && m.server === hi) { H_.text = '准备发球'; }
    else if (this.phase === 'rally' && hp.plan && !hp.plan.swing && !hp.plan.expired && this.time <= hp.plan.tContact + 0.3) {
      H_.contactIn = (hp.plan.tContact - this.time) / this.timeScale;
      H_.text = hp.plan.kind === 'smash' ? '扣杀!' : hp.plan.kind === 'volley' ? '截击' : (hp.plan.side === 'fh' ? '正手' : '反手');
    }
  }

  _racketTip(p) {
    const a = p.anim;
    if (a.name !== 'swing' && a.name !== 'serve') return null;
    let c = null;
    if (a.name === 'serve') { const pc = p.serveAnim && p.serveAnim.contactPos; if (pc) c = pc; }
    else if (p.sw && p.sw.contact) c = { x: p.pos.x + (p.sw.side === 'fh' ? 1 : -1) * p.handX * p.sw.contact.lat, y: p.sw.contact.h, z: p.pos.z - p.facing * p.sw.contact.fwd };
    else if (p.plan) c = p.plan.P;
    if (!c) return null;
    const k = (a.phase - 0.5) * 1.6;
    return { x: c.x - p.handX * k * 0.6 * (a.name === 'swing' && p.sw && p.sw.side === 'bh' ? -1 : 1), y: c.y + Math.abs(k) * 0.2, z: c.z + p.facing * k * 0.3 };
  }
}

function BASE_Z() { return K.BASE_Z; }
function p_handX(p) { return p.handX; }
