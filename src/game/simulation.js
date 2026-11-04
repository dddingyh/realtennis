// Simulation: owns the ball, players, match flow (serve / rally / point-over / changeover), swing handling with
// latency compensation, events and the read-only `state` consumed by the renderer/HUD. DOM-free, deterministic.

import { COURT, PHYSICS, SURFACES, BALL } from '../config.js';
import { createBall, stepBall } from '../physics/ball.js';
import { RNG } from './rng.js';
import { Match } from './match.js';
import { Player, PLAYER, pickLook } from './player.js';
import { computeHit, computeServe, contactGeometry, isReachable, serviceBox, inBox, inSinglesCourt, IDEAL_F } from './shot.js';
import { predictPath, planInterception } from './predict.js';
import { AIController } from './ai.js';

// ---------------------------------------------------------------- tunables
export const DEFAULT_TIMING = {
  pointOver: 2.0,        // s between the point ending and the next serve-prep
  changeover: 4.0,       // s extra pause at changeovers
  matchOver: 2.5,        // s of celebration before 'match-over'
  prepMin: 0.5,          // earliest a serve toss is accepted after serve-prep starts
  faultHold: 1.0,        // s the faulted ball keeps flying before the server gets a new ball
  aiServeDelay: [0.9, 1.8], // AI server waits this long before tossing
  walkDelay: 0.7,        // s after a point ends before players start walking to serve positions
};
const TOSS = { y0: 1.05, apexY: 3.0, forward: 0.35, apexT: Math.sqrt(2 * (3.0 - 1.05) / PHYSICS.gravity) };
const HISTORY = 40;                 // ball history ring entries (~330 ms at 120 Hz)
const BUFFER_MS = { keyboard: 150, ai: 100, remote: 240 };
const RALLY_TIMEOUT = 20;           // s watchdog
const SERVING_TIMEOUT = 8;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class Simulation {
  /**
   * @param {object} opts see docs/DESIGN.md §2, plus: aiPlayers:[bool,bool], aiStyles:[style,style], aiLevels:[n,n],
   *   timing:{...DEFAULT_TIMING}, firstServer:0|1, shotOpts:{forceQuality,noError} (testing)
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.surfaceKey = SURFACES[opts.surface] ? opts.surface : 'hard';
    this.surf = SURFACES[this.surfaceKey];
    this.timing = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
    this.shotOpts = opts.shotOpts || {};
    const seed = opts.seed ?? 12345;
    this.rng = new RNG(seed);
    this.rngShot = this.rng.fork();
    this.rngPhys = this.rng.fork();
    this.rngAI = this.rng.fork();
    this.rngMisc = this.rng.fork();
    this.time = 0;
    this.phaseT = 0;
    this.paused = false;
    this.events = [];
    this.hitCount = 0;

    const aiPlayers = opts.aiPlayers || [false, true];
    const names = opts.playerNames || ['你', 'AI'];
    const autoMove = opts.autoMove || ['assist', 'off'];
    const look0 = pickLook(this.rng);
    const look1 = pickLook(this.rng, look0);
    this.players = [0, 1].map((i) => new Player(i, {
      name: names[i] || (i ? 'AI' : '你'),
      hand: i === 0 && !aiPlayers[0] ? (opts.humanHand || 'R') : (this.rng.chance(0.12) ? 'L' : 'R'),
      isHuman: !aiPlayers[i],
      autoMove: aiPlayers[i] ? 'off' : (autoMove[i] || 'off'),
      look: i === 0 ? look0 : look1,
    }));
    this.ais = [null, null];
    const styles = opts.aiStyles || [opts.aiStyle0 || 'grinder', opts.aiStyle || 'grinder'];
    const levels = opts.aiLevels || [opts.aiLevel0 ?? opts.aiLevel ?? 0.6, opts.aiLevel ?? 0.6];
    for (let i = 0; i < 2; i++) if (aiPlayers[i]) this.ais[i] = new AIController(this, i, styles[i], levels[i]);
    this.sideStats = [{ fh: { n: 0, err: 0 }, bh: { n: 0, err: 0 } }, { fh: { n: 0, err: 0 }, bh: { n: 0, err: 0 } }];

    this.match = new Match(opts.format || {}, opts.firstServer ?? 0);
    this.ball = createBall({ pos: { x: 0, y: 1, z: 0 } });
    Object.assign(this.ball, { visible: false, inPlay: false, lastHitBy: -1, marks: [] });
    this._env = { surf: this.surf, surfKey: this.surfaceKey, rng: this.rngPhys, events: [] };
    this._hist = Array.from({ length: HISTORY }, () => ({ t: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, b: 0, hc: 0 }));
    this._histN = 0; this._histI = 0;
    this.faultCount = 0;
    this.toss = null;
    this.serveBox = null;
    this.rally = this._newRally();
    this.prepHold = 0;
    this.pending = null;            // next phase after point-over
    this.nextWalkAt = null;
    this.lastShot = null;
    this._plans = [null, null];
    this.stats = this._newStats();
    this.state = {
      time: 0, surface: this.surfaceKey, ball: this.ball, players: this.players,
      match: {
        phase: 'serve-prep', server: 0, serveCourt: 'deuce', faultCount: 0, points: [0, 0], games: [0, 0], sets: [],
        setsWon: [0, 0], isTiebreak: false, pointText: '0-0', winner: null, stats: this.stats,
      },
      lastShot: null, hint: { i: this._humanIndex(), reachable: false, side: 'fh', contactIn: null },
      rally: this.rally,
    };
    this.phase = 'serve-prep';
    this._beginServePrep(true);
    this._syncState();
  }

  // ================================================================= public API
  /** Advance the simulation by dt seconds (pass 1/PHYSICS.simHz). */
  step(dt) {
    if (this.paused) return;
    this.time += dt; this.phaseT += dt;
    this._phaseUpdate(dt);
    for (const ai of this.ais) if (ai) ai.update(dt);
    this._applyIntents(dt);
    const inPoint = this.phase === 'serving' || this.phase === 'rally';
    for (const p of this.players) {
      p.update(dt, { inPoint, ready: this.phase === 'serve-prep' });
      if (p.buffered) this._updateBuffered(p);
    }
    this._updateServe(dt);
    this._ballStep(dt);
    this._pushHistory();
    for (const p of this.players) p.updateRacket(this.ball.pos);
    this._syncState();
  }

  /** Continuous move intent for player i, x,z in [-1,1] (x right, z toward camera). */
  setMove(i, x, z) {
    const m = this.players[i].manual;
    m.x = clamp(+x || 0, -1, 1); m.z = clamp(+z || 0, -1, 1);
  }

  /** Keyboard: start a backswing. */
  prepare(i, p = {}) {
    const pl = this.players[i];
    if (this.paused || pl.swingT >= 0) return;
    if (this.phase === 'serve-prep' || this.phase === 'serving') return;
    pl.prepared = { shot: p.shot || 'topspin', side: p.side || null, t: 0 };
  }

  /**
   * Swing / serve. Contact is evaluated immediately at the (latency-compensated) ball state.
   * @returns {boolean} true if the swing connected or was buffered/started a serve
   */
  swing(i, params = {}) {
    if (this.paused) return false;
    const pl = this.players[i];
    const p = this._normSwing(params, pl);
    if (this.phase === 'serve-prep' || this.phase === 'serving') {
      if (i === this.match.server) {
        if (this.phase === 'serve-prep') return this._beginServe(i, p, true);
        if (this.toss && !this.toss.hit) return this._hitServe(i, p);
        return false;
      }
    }
    if (this.phase === 'rally') return this._swingRally(i, p);
    // idle swing (practice swing)
    if (pl.cooldown <= 0 && !pl.serve) pl.startSwing(p.shot, p.side === 'auto' ? 'fh' : p.side);
    return false;
  }

  /** Toss the ball for the server (optional; swing() during serve-prep tosses and hits automatically). */
  serveToss(i) {
    if (this.paused) return false;
    if (this.phase !== 'serve-prep' || i !== this.match.server) return false;
    return this._beginServe(i, null, false);
  }

  pause(v) { this.paused = !!v; }

  /** Events since the last call. */
  drainEvents() { const e = this.events; this.events = []; return e; }

  /** Is player i (server) allowed to toss right now? */
  canServe(i) {
    return this.phase === 'serve-prep' && i === this.match.server && this.phaseT >= Math.max(this.timing.prepMin, this.prepHold)
      && (!this.players[i].walkTarget) && (!this.players[1 - i].walkTarget || this.phaseT > 3.5);
  }

  /** Error stats per racket side for player i (used by the AI to find the weaker side). */
  weakness(i) {
    const s = this.sideStats[i];
    const fh = (s.fh.err + 1) / (s.fh.n + 4), bh = (s.bh.err + 1) / (s.bh.n + 4);
    return { fh, bh, weaker: bh > fh * 1.15 ? 'bh' : fh > bh * 1.15 ? 'fh' : null };
  }

  // ================================================================= helpers
  _humanIndex() { return this.players.findIndex((p) => p.isHuman) >= 0 ? this.players.findIndex((p) => p.isHuman) : 0; }
  _emit(ev) { this.events.push(ev); }
  _newRally() { return { shots: 0, touched: [false, false], serveLet: false, lastHitTime: 0, lastQ: 1, errorBy: -1 }; }
  _newStats() {
    return {
      aces: [0, 0], doubleFaults: [0, 0], winners: [0, 0], unforcedErrors: [0, 0], forcedErrors: [0, 0],
      firstServePct: [0, 0], maxServeKmh: [0, 0], pointsWon: [0, 0], totalPoints: 0, rallyShotsTotal: 0, longestRally: 0,
      firstServesIn: [0, 0], firstServesTotal: [0, 0], serveFaults: [0, 0],
    };
  }

  _normSwing(p, pl) {
    const serving = this.phase === 'serve-prep' || this.phase === 'serving';
    return {
      shot: p.shot || pl.prepared?.shot || (serving ? 'flat' : 'topspin'),
      side: p.side || pl.prepared?.side || 'auto',
      power: clamp(p.power ?? 0.7, 0, 1),
      aimX: p.aimX ?? null, aimDepth: p.aimDepth ?? null,
      ageMs: clamp(p.ageMs || 0, 0, 150),
      source: p.source === 'remote' || p.source === 'ai' ? p.source : 'keyboard',
      risk: p.risk, edge: p.edge,
    };
  }

  _setPhase(name) {
    this.phase = name; this.phaseT = 0;
    this.state.match.phase = name;
    this._emit({ type: 'phase', phase: name });
  }

  // ================================================================= phases
  _phaseUpdate(dt) {
    const T = this.timing;
    switch (this.phase) {
      case 'serve-prep': this._servePrepUpdate(dt); break;
      case 'serving': if (this.phaseT > SERVING_TIMEOUT) this._fault('FAULT'); break;
      case 'rally':
        if (this.time - this.rally.lastHitTime > RALLY_TIMEOUT) this._endPoint(this.ball.lastHitBy, 'winner', {});
        break;
      case 'point-over':
        if (this.nextWalkAt !== null && this.phaseT >= this.nextWalkAt) { this.nextWalkAt = null; if (!this.pending?.matchOver) this._assignWalk(true); }
        if (this.phaseT >= (this.pending?.matchOver ? T.matchOver : T.pointOver)) {
          if (this.pending?.matchOver) { this._setPhase('match-over'); this.ball.visible = false; }
          else if (this.pending?.changeover) { this._setPhase('changeover'); this.ball.visible = false; this._assignWalk(true); for (const p of this.players) p.stamina = Math.min(1, p.stamina + 0.25); }
          else this._beginServePrep(false);
        }
        break;
      case 'changeover':
        if (this.phaseT >= T.changeover) this._beginServePrep(false);
        break;
      default: break;
    }
  }

  /** Spots where server and receiver should stand for the next serve. */
  _serveSpots() {
    const m = this.match, s = m.server, r = 1 - s;
    const sp = this.players[s], rp = this.players[r];
    const deuce = m.serveCourt === 'deuce';
    const box = serviceBox(sp.facing, deuce);
    const sx = box.standSign * (1.1 + 0.5 * (s === 0 ? 0 : 0));
    const server = { x: sp.isHuman && this._serveStandX !== undefined && this._serveStandSign === box.standSign ? this._serveStandX : sx, z: sp.facing * (COURT.halfLength + 0.45) };
    const second = this.faultCount > 0;
    const receiver = { x: box.boxSign * (second ? 1.4 : 1.8), z: rp.facing * (COURT.halfLength + (second ? 0.6 : 1.4)) };
    return { server, receiver, box };
  }

  _assignWalk(fast) {
    const sp = this._serveSpots();
    const s = this.match.server;
    this.players[s].walkTarget = { ...sp.server };
    this.players[1 - s].walkTarget = { ...sp.receiver };
    for (const p of this.players) p.walkFast = fast;
  }

  _beginServePrep(initial) {
    const m = this.match;
    this.faultCount = this.faultCount || 0;
    if (!initial && this.phase !== 'serve-prep') this._setPhase('serve-prep');
    else { this.phase = 'serve-prep'; this.phaseT = 0; }
    this.state.match.phase = 'serve-prep';
    this.toss = null;
    this.rally = this._newRally();
    this.state.rally = this.rally;
    const sp = this._serveSpots();
    this.serveBox = sp.box;
    if (initial) {
      const s = m.server;
      this.players[s].pos.x = sp.server.x; this.players[s].pos.z = sp.server.z;
      this.players[1 - s].pos.x = sp.receiver.x; this.players[1 - s].pos.z = sp.receiver.z;
    } else this._assignWalk(false);
    for (const p of this.players) { p.serve = null; p.prepared = null; p.buffered = null; p.celebrateT = 0; p.dejectedT = 0; p.moveScale = 1; }
    this.ball.inPlay = false; this.ball.visible = true; this.ball.lastHitBy = -1; this.ball.bounces = 0; this.ball.rolling = false; this.ball.netHit = false;
    this._aiServeAt = this.rngMisc.range(this.timing.aiServeDelay[0], this.timing.aiServeDelay[1]);
    this._syncMatch();
  }

  _servePrepUpdate() {
    const s = this.match.server;
    const sp = this.players[s];
    // human server may fine-tune x along the baseline once arrived
    if (sp.isHuman && !sp.walkTarget && !this.toss) {
      const box = this.serveBox;
      const lo = box.standSign > 0 ? 0.3 : -3.8, hi = box.standSign > 0 ? 3.8 : -0.3;
      sp.pos.x = clamp(sp.pos.x + sp.manual.x * 2.0 * (1 / PHYSICS.simHz), lo, hi);
      this._serveStandX = sp.pos.x; this._serveStandSign = box.standSign;
      sp.pos.z = sp.facing * (COURT.halfLength + 0.45);
    }
    // receiver free once arrived (handled by intents)
  }

  // ----------------------------------------------------------------- serving
  _beginServe(i, params, auto) {
    if (!this.canServe(i)) return false;
    const pl = this.players[i];
    const dirZ = -pl.facing;
    pl.vel.x = 0; pl.vel.z = 0; pl.moveScale = 0;
    this.players[1 - i].walkTarget = null;
    const jx = this.rngMisc.range(-0.12, 0.12);
    this.toss = { t: 0, hit: false, auto: auto ? { params, hitAt: TOSS.apexT + this.rngMisc.range(-0.025, 0.025) } : null, hitT: 0 };
    pl.serve = { phase: 0.02 };
    const b = this.ball;
    const hand = pl.handX;
    b.pos.x = pl.pos.x + hand * 0.25; b.pos.y = TOSS.y0; b.pos.z = pl.pos.z + dirZ * 0.3;
    b.vel.x = jx; b.vel.y = Math.sqrt(2 * PHYSICS.gravity * (TOSS.apexY - TOSS.y0)); b.vel.z = dirZ * 0.35;
    b.spin.x = b.spin.y = b.spin.z = 0;
    b.bounces = 0; b.rolling = false; b.netHit = false; b.visible = true; b.inPlay = false;
    this.rally.serveLet = false;
    this._setPhase('serving');
    return true;
  }

  _updateServe(dt) {
    if (!this.toss) return;
    const t = this.toss, pl = this.players[this.match.server];
    t.t += dt;
    if (!pl.serve) return;
    if (!t.hit) {
      pl.serve.phase = Math.min(0.62, 0.02 + 0.6 * (t.t / TOSS.apexT));
      if (t.auto && t.t >= t.auto.hitAt) this._hitServe(this.match.server, t.auto.params);
      else if (!t.hit && t.t > 1.6) this._tossFailed();
    } else {
      const k = (this.time - t.hitT) / 0.35;
      pl.serve.phase = Math.min(1, 0.65 + 0.35 * k);
      if (k >= 1) { pl.serve = null; pl.moveScale = 1; }
    }
  }

  _tossFailed() {
    const pl = this.players[this.match.server];
    pl.serve = null; pl.moveScale = 1;
    this.toss = null;
    this.prepHold = 0.6;
    this._setPhase('serve-prep');
    this.ball.inPlay = false;
  }

  _hitServe(i, p) {
    const pl = this.players[i], b = this.ball, t = this.toss;
    if (!t || t.hit) return false;
    if (b.pos.y < 0.6) return false;
    const res = computeServe({
      server: pl, ball: b, swing: p, serveNumber: this.faultCount + 1, deuce: this.match.serveCourt === 'deuce',
      surface: this.surfaceKey, rng: this.rngShot, opts: this.shotOpts,
    });
    t.hit = true; t.hitT = this.time;
    b.vel.x = res.vel.x; b.vel.y = res.vel.y; b.vel.z = res.vel.z;
    b.spin.x = res.spin.x; b.spin.y = res.spin.y; b.spin.z = res.spin.z;
    b.bounces = 0; b.rolling = false; b.netHit = false; b.inPlay = true; b.lastHitBy = i;
    this.hitCount++;
    this.rally.shots = 1; this.rally.touched[i] = true; this.rally.lastHitTime = this.time; this.rally.lastQ = res.quality;
    this.rally.serveLet = false;
    pl.serve.phase = 0.65;
    pl.walkTarget = null;
    pl.moveScale = 1;              // server may start moving (e.g. serve & volley) right after contact
    const kmh = res.speedKmh;
    this.stats.maxServeKmh[i] = Math.max(this.stats.maxServeKmh[i], Math.round(kmh));
    if (this.faultCount === 0) this.stats.firstServesTotal[i]++;
    this.lastShot = { by: i, shot: 'serve', side: null, speedKmh: kmh, spinRpm: res.spinRpm, quality: res.quality, timingMs: 0, serveType: res.shot };
    this.state.lastShot = this.lastShot;
    this._emit({ type: 'serve', by: i, speedKmh: kmh, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z } });
    this._emit({ type: 'hit', by: i, shot: res.shot, side: null, power: p.power, quality: res.quality, speedKmh: kmh, spinRpm: res.spinRpm, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, serve: true });
    // opponent split-steps
    this.players[1 - i].splitStep();
    for (const a of this.ais) if (a) a.onHit(i, true);
    return true;
  }

  // ----------------------------------------------------------------- rally hits
  _pushHistory() {
    const b = this.ball, h = this._hist[this._histI];
    h.t = this.time; h.px = b.pos.x; h.py = b.pos.y; h.pz = b.pos.z; h.vx = b.vel.x; h.vy = b.vel.y; h.vz = b.vel.z;
    h.wx = b.spin.x; h.wy = b.spin.y; h.wz = b.spin.z; h.b = b.bounces; h.hc = this.hitCount;
    this._histI = (this._histI + 1) % HISTORY; this._histN = Math.min(HISTORY, this._histN + 1);
  }

  /** Ball state `ageMs` ago (never rewinds across a hit or a bounce). */
  _ballAt(ageMs) {
    const b = this.ball;
    if (ageMs <= 1) return { pos: b.pos, vel: b.vel, spin: b.spin, bounces: b.bounces, hist: false, ageMs: 0 };
    const target = this.time - ageMs / 1000;
    let best = null;
    for (let k = 1; k <= this._histN; k++) {
      const h = this._hist[(this._histI - k + HISTORY) % HISTORY];
      if (h.hc !== this.hitCount || h.b !== b.bounces) break;
      best = h;
      if (h.t <= target) break;
    }
    if (!best) return { pos: b.pos, vel: b.vel, spin: b.spin, bounces: b.bounces, hist: false, ageMs: 0 };
    return {
      pos: { x: best.px, y: best.py, z: best.pz }, vel: { x: best.vx, y: best.vy, z: best.vz },
      spin: { x: best.wx, y: best.wy, z: best.wz }, bounces: best.b, hist: true, ageMs: (this.time - best.t) * 1000,
    };
  }

  _canHit(i, st) {
    const b = this.ball;
    if (!b.inPlay || b.lastHitBy === i || this.phase !== 'rally') return false;
    if (st.bounces >= 2) return false;
    const pl = this.players[i];
    if (st.pos.z * pl.facing < -0.4) return false;       // still on the other side of the net
    return true;
  }

  _swingRally(i, p) {
    const pl = this.players[i];
    if (pl.cooldown > 0 || pl.swingT >= 0) return false;
    const st = this._ballAt(p.ageMs);
    if (!this._canHit(i, st)) { this._whiff(i, p, false); return false; }
    const geo = contactGeometry(pl, st);
    if (isReachable(geo, p.source)) return this._performHit(i, p, st, geo, null);
    const ms = geo.tEarly * 1000;
    const buf = BUFFER_MS[p.source];
    if (geo.vf < -0.5 && ms > 0 && ms < buf && this._canHit(i, st)) {
      pl.buffered = { params: p, until: this.time + buf / 1000, earlyMs: ms };
      if (!pl.prepared) pl.prepared = { shot: p.shot, side: null, t: 0.2 };
      return true;
    }
    this._whiff(i, p, geo.vf < 0 && Math.abs(geo.tEarly) < 0.5);
    return false;
  }

  _updateBuffered(pl) {
    const bf = pl.buffered;
    const i = pl.index;
    if (this.phase !== 'rally' || !this._canHit(i, { pos: this.ball.pos, bounces: this.ball.bounces })) { pl.buffered = null; pl.prepared = null; return; }
    const geo = contactGeometry(pl, this.ball);
    if (isReachable(geo, bf.params.source)) {
      pl.buffered = null; pl.prepared = null;
      this._performHit(i, bf.params, { pos: this.ball.pos, vel: this.ball.vel, spin: this.ball.spin, bounces: this.ball.bounces, hist: false, ageMs: 0 }, geo, bf.earlyMs);
    } else if (this.time > bf.until) {
      pl.buffered = null; pl.prepared = null;
      this._whiff(i, bf.params, true);
    }
  }

  _whiff(i, p, emit) {
    const pl = this.players[i];
    if (pl.cooldown <= 0) pl.startSwing(p.shot, p.side === 'auto' ? 'fh' : p.side);
    if (emit) this._emit({ type: 'whiff', by: i });
  }

  _performHit(i, p, st, geo, earlyOverride) {
    const pl = this.players[i], b = this.ball, opp = this.players[1 - i];
    const res = computeHit({
      hitter: pl, ball: st, swing: p, surface: this.surfaceKey, rng: this.rngShot, geo,
      timingEarlyMs: earlyOverride ?? (p.source === 'ai' ? p.timingOverride : undefined), opts: this.shotOpts,
    });
    const inKmh = Math.hypot(st.vel.x, st.vel.y, st.vel.z) * 3.6;
    b.pos.x = st.pos.x; b.pos.y = st.pos.y; b.pos.z = st.pos.z;
    b.vel.x = res.vel.x; b.vel.y = res.vel.y; b.vel.z = res.vel.z;
    b.spin.x = res.spin.x; b.spin.y = res.spin.y; b.spin.z = res.spin.z;
    b.bounces = 0; b.rolling = false; b.netHit = false; b.lastHitBy = i; b.inPlay = true;
    this.hitCount++;
    pl.startSwing(res.shot, res.side);
    pl.prepared = null;
    this.rally.shots++; this.rally.touched[i] = true; this.rally.lastHitTime = this.time; this.rally.lastQ = res.quality;
    this.lastShot = { by: i, shot: res.shot, side: res.side, speedKmh: res.speedKmh, spinRpm: res.spinRpm, quality: res.quality, timingMs: res.timingMs, stretch: res.stretch, incomingKmh: inKmh, target: res.target };
    this.state.lastShot = this.lastShot;
    this.sideStats[i][res.side].n++;
    this._emit({ type: 'hit', by: i, shot: res.shot, side: res.side, power: p.power, quality: res.quality, speedKmh: res.speedKmh, spinRpm: res.spinRpm, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z } });
    // latency compensation: re-simulate forward to the present
    if (st.hist && st.ageMs > 0.5) {
      const n = Math.max(1, Math.ceil(st.ageMs / 1000 / PHYSICS.fixedDt));
      const h = st.ageMs / 1000 / n;
      for (let k = 0; k < n; k++) this._ballMicro(h);
    }
    opp.splitStep();
    for (const a of this.ais) if (a) a.onHit(i);
    return true;
  }

  // ================================================================= ball stepping & rules
  _ballStep(dt) {
    const b = this.ball;
    const ph = this.phase;
    if (ph === 'menu' || ph === 'changeover' || ph === 'match-over') return;
    // age marks
    const maxAge = this.surfaceKey === 'clay' ? 120 : 6;
    for (let k = b.marks.length - 1; k >= 0; k--) { b.marks[k].age += dt; if (b.marks[k].age > maxAge) b.marks.splice(k, 1); }
    if (ph === 'serve-prep' && !this.toss && this.phaseT >= this.prepHold) {
      this.prepHold = 0;
      this._heldBall();
      return;
    }
    const n = Math.max(1, Math.ceil(dt / PHYSICS.fixedDt - 1e-9));
    const h = dt / n;
    for (let k = 0; k < n; k++) this._ballMicro(h);
    if (b.rolling && b.inPlay && (this.phase === 'rally') && b.bounces < 2) {
      b.bounces = 2;
      this._onBounce({ x: b.pos.x, z: b.pos.z, synthetic: true });
    }
    if (b.rolling && (this.phase === 'point-over') && this.phaseT > 1.2) b.visible = b.visible && this.phaseT < this.timing.pointOver - 0.2;
  }

  _heldBall() {
    const s = this.players[this.match.server], b = this.ball;
    const dirZ = -s.facing;
    const ph = (this.time * 1.3) % 1;
    b.pos.x = s.pos.x + s.handX * 0.3; b.pos.z = s.pos.z + dirZ * 0.35;
    b.pos.y = BALL.radius + 0.75 * Math.abs(Math.sin(Math.PI * ph)) * (ph < 0.5 || true ? 1 : 1);
    b.vel.x = b.vel.y = b.vel.z = 0; b.spin.x = b.spin.y = b.spin.z = 0;
    b.visible = true; b.inPlay = false; b.rolling = false; b.bounces = 0;
  }

  _ballMicro(h) {
    const evs = this._env.events;
    evs.length = 0;
    stepBall(this.ball, h, this._env);
    for (let k = 0; k < evs.length; k++) {
      const e = evs[k];
      if (e.type === 'bounce') this._onBounce(e);
      else if (e.type === 'net') this._onNet(e);
    }
  }

  _onNet(e) {
    this._emit({ type: 'net', pos: { x: e.x, y: e.y, z: 0 }, cord: !!e.cord });
    if (!this.ball.inPlay) return;
    if (this.phase === 'serving') {
      if (e.cord) this.rally.serveLet = true;
      else this._fault('FAULT');
    } else if (this.phase === 'rally') {
      if (!e.cord) this._endPoint(1 - this.ball.lastHitBy, 'net', { errorBy: this.ball.lastHitBy });
    }
  }

  _addMark(x, z) {
    const m = this.ball.marks;
    m.push({ x, z, age: 0 });
    if (m.length > (this.surfaceKey === 'clay' ? 60 : 10)) m.shift();
  }

  _onBounce(e) {
    const b = this.ball;
    this._addMark(e.x, e.z);
    const pos = { x: e.x, y: 0, z: e.z };
    if (this.phase === 'serving') {
      if (!this.toss || !this.toss.hit) { this._emit({ type: 'bounce', pos, in: false, court: null }); this._tossFailed(); return; }
      const inb = inBox(this.serveBox, e.x, e.z) && b.bounces === 1;
      this._emit({ type: 'bounce', pos, in: inb, court: inb ? this.match.serveCourt : null });
      if (b.bounces !== 1) return;
      if (!inb) { this._fault('FAULT'); return; }
      if (this.rally.serveLet) { this._let(); return; }
      if (this.faultCount === 0) this.stats.firstServesIn[this.match.server]++;
      this._setPhase('rally');
      return;
    }
    if (this.phase === 'rally' && b.inPlay) {
      const hitter = b.lastHitBy;
      if (b.bounces === 1) {
        const oppSide = hitter === 0 ? e.z < 0 : e.z > 0;
        const ok = oppSide && inSinglesCourt(e.x, e.z);
        this._emit({ type: 'bounce', pos, in: ok, court: ok ? 'singles' : null });
        if (!ok) {
          if (oppSide) this._emit({ type: 'call', text: 'OUT' });
          this._endPoint(1 - hitter, oppSide ? 'out' : 'net', { errorBy: hitter });
        }
      } else {
        this._emit({ type: 'bounce', pos, in: inSinglesCourt(e.x, e.z), court: 'singles' });
        const ace = this.rally.shots === 1;
        this._endPoint(hitter, ace ? 'ace' : 'winner', {});
      }
      return;
    }
    this._emit({ type: 'bounce', pos, in: inSinglesCourt(e.x, e.z), court: null });
  }

  _let() {
    this._emit({ type: 'call', text: 'LET' });
    this.ball.inPlay = false;
    this.prepHold = this.timing.faultHold;
    this.toss = null;
    const pl = this.players[this.match.server]; pl.serve = null; pl.moveScale = 1;
    this._setPhase('serve-prep');
    this._aiServeAt = this.rngMisc.range(this.timing.aiServeDelay[0], this.timing.aiServeDelay[1]);
  }

  _fault(text) {
    const s = this.match.server;
    this.ball.inPlay = false;
    this.stats.serveFaults[s]++;
    this.faultCount++;
    if (this.faultCount >= 2) {
      this._emit({ type: 'call', text: 'DOUBLE FAULT' });
      this.stats.doubleFaults[s]++;
      this._endPoint(1 - s, 'double-fault', { errorBy: s });
      return;
    }
    this._emit({ type: 'call', text });
    this.toss = null;
    const pl = this.players[s]; pl.serve = null; pl.moveScale = 1;
    this.prepHold = this.timing.faultHold;
    this._setPhase('serve-prep');
    this.state.match.faultCount = this.faultCount;
    this._aiServeAt = this.rngMisc.range(this.timing.aiServeDelay[0], this.timing.aiServeDelay[1]);
    this._assignWalk(false);
  }

  _endPoint(winner, reason, info) {
    if (this.phase === 'point-over' || this.phase === 'match-over') return;
    const m = this.match, st = this.stats;
    const server = m.server;
    const loser = 1 - winner;
    const ls = this.lastShot;
    let errKind = null;
    if (reason === 'out' || reason === 'net') {
      const q = this.rally.lastQ;
      const forced = q < 0.5 || (ls && (ls.stretch > 0.6 || (ls.incomingKmh > 135 && q < 0.7)));
      errKind = forced ? 'forced' : 'unforced';
      if (forced) st.forcedErrors[loser]++; else st.unforcedErrors[loser]++;
      if (ls && ls.side && ls.by === loser) this.sideStats[loser][ls.side].err++;
    } else if (reason === 'winner') st.winners[winner]++;
    else if (reason === 'ace') st.aces[winner]++;
    st.pointsWon[winner]++; st.totalPoints++;
    st.rallyShotsTotal += this.rally.shots; st.longestRally = Math.max(st.longestRally, this.rally.shots);
    for (let i = 0; i < 2; i++) st.firstServePct[i] = st.firstServesTotal[i] ? Math.round(100 * st.firstServesIn[i] / st.firstServesTotal[i]) : 0;

    const res = m.pointWon(winner);
    this.ball.inPlay = false;
    this._emit({ type: 'point', winner, reason, error: errKind, shots: this.rally.shots, server });
    this._emit({ type: 'score', text: res.text });
    this.faultCount = 0;
    this.state.match.faultCount = 0;
    this.toss = null;
    for (const p of this.players) { p.serve = null; p.moveScale = 1; p.buffered = null; p.prepared = null; }
    const w = this.players[winner], l = this.players[loser];
    if (reason === 'winner' || reason === 'ace' || res.gameWon) w.celebrateT = 1.6;
    if (reason === 'out' || reason === 'net' || reason === 'double-fault' || res.gameWon) l.dejectedT = 1.5;
    this.pending = { changeover: res.changeover, matchOver: res.matchWon };
    this.nextWalkAt = this.timing.walkDelay;
    this.rally.errorBy = info.errorBy ?? -1;
    this.lastPoint = { winner, reason, error: errKind };
    this.state.lastPoint = this.lastPoint;
    this._setPhase('point-over');
    this._syncMatch();
    for (const a of this.ais) if (a) a.onPointEnd(winner, reason);
  }

  // ================================================================= movement intents / auto-move
  _applyIntents(dt) {
    for (let i = 0; i < 2; i++) {
      const pl = this.players[i];
      if (this.ais[i]) continue;                       // AI writes pl.intent itself
      const man = pl.manual;
      if ((pl.serve && !(this.toss && this.toss.hit)) || pl.walkTarget || this.phase === 'match-over') { pl.intent.x = 0; pl.intent.z = 0; continue; }
      if (this.phase === 'serve-prep' && i === this.match.server) { pl.intent.x = 0; pl.intent.z = 0; continue; }
      let ix = man.x, iz = man.z;
      if (pl.autoMove !== 'off' && (this.phase === 'rally' || this.phase === 'serving' || this.phase === 'serve-prep')) {
        const a = this._autoVector(i, pl.autoMove === 'full');
        if (a) {
          const mm = Math.hypot(man.x, man.z);
          if (pl.autoMove === 'full') { ix = a.x * a.w; iz = a.z * a.w; }
          else { const k = (mm < 0.2 ? 0.95 : 0.35) * a.w; ix = man.x + a.x * k; iz = man.z + a.z * k; }
        } else if (pl.autoMove === 'full') { ix = 0; iz = 0; }
      }
      pl.intent.x = ix; pl.intent.z = iz;
    }
  }

  /** Cached interception plan for player i (used by assist / hint). */
  _plan(i) {
    const pl = this.players[i], b = this.ball;
    const incoming = b.inPlay && b.lastHitBy !== i && (this.phase === 'rally' || this.phase === 'serving');
    if (!incoming) { this._plans[i] = null; return null; }
    const c = this._plans[i];
    const key = this.hitCount * 4 + b.bounces;
    if (c && c.key === key && this.time - c.time < 0.15) return c;
    const { path } = predictPath({ pos: b.pos, vel: b.vel, spin: b.spin, bounces: b.bounces }, this.surfaceKey);
    const plan = planInterception(path, pl, { vmax: PLAYER.maxSpeed * 0.95, accel: PLAYER.accel, reactDelay: 0.05, allowVolley: Math.abs(pl.pos.z) < 6.5, prefY: 0.95, prefDepth: 0.3, yMax: 1.7 });
    this._plans[i] = { key, time: this.time, plan };
    return this._plans[i];
  }

  _autoVector(i, full) {
    const pl = this.players[i];
    const c = this._plan(i);
    if (c && c.plan) {
      const s = c.plan.stand;
      const dx = s.x - pl.pos.x, dz = s.z - pl.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.08) return { x: 0, z: 0, w: 0 };
      return { x: dx / d, z: dz / d, w: clamp(d / 0.45, 0, 1) };
    }
    // recover toward the middle of the baseline when the ball is away
    const b = this.ball;
    const away = (this.phase === 'rally' && b.inPlay && b.lastHitBy === i);
    if (!away) return null;
    const hx = clamp(b.pos.x * 0.15, -1.2, 1.2), hz = pl.facing * (COURT.halfLength + 0.9);
    const dx = hx - pl.pos.x, dz = hz - pl.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.3) return { x: 0, z: 0, w: 0 };
    return { x: dx / d, z: dz / d, w: full ? clamp(d / 1.5, 0, 0.8) : clamp(d / 2, 0, 0.45) };
  }

  // ================================================================= state mirror
  _syncMatch() {
    const m = this.match, sm = this.state.match;
    sm.phase = this.phase; sm.server = m.server; sm.serveCourt = m.serveCourt; sm.faultCount = this.faultCount;
    sm.points = m.points.slice(); sm.games = m.games.slice(); sm.sets = m.sets.map((s) => s.slice());
    sm.setsWon = m.setsWon.slice(); sm.isTiebreak = m.isTiebreak; sm.pointText = m.pointText; sm.winner = m.winner;
    sm.stats = this.stats;
  }

  _syncState() {
    const s = this.state;
    s.time = this.time;
    this._syncMatch();
    // hint for the (first) human player
    const hi = this._humanIndex();
    const h = s.hint, pl = this.players[hi], b = this.ball;
    h.i = hi; h.reachable = false; h.contactIn = null; h.canServe = false; h.text = '';
    if ((this.phase === 'serve-prep' || this.phase === 'serving') && hi === this.match.server) {
      h.canServe = this.canServe(hi);
      h.text = this.toss ? (this.toss.hit ? '' : '在球最高点击球') : (h.canServe ? '按空格发球' : '准备发球');
      h.side = pl.hand === 'R' ? 'fh' : 'fh';
      if (this.toss && !this.toss.hit) h.contactIn = Math.max(0, TOSS.apexT - this.toss.t);
    } else if (b.inPlay && b.lastHitBy !== hi && (this.phase === 'rally' || this.phase === 'serving')) {
      const geo = contactGeometry(pl, b);
      h.side = geo.side;
      h.reachable = isReachable(geo, 'keyboard') && (b.bounces >= 1 || this.phase === 'rally');
      const c = this._plan(hi);
      if (c && c.plan) { h.contactIn = Math.max(0, c.plan.t - (this.time - c.time)); h.side = c.plan.side; }
      else if (isFinite(geo.tEarly) && geo.tEarly > -0.3) h.contactIn = Math.max(0, geo.tEarly);
    } else h.side = h.side || 'fh';
  }
}
