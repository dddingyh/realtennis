// AI opponent: four tactical styles, level 0..1 (reaction delay, prediction noise, timing jitter, decision quality),
// recovery positioning, serve variation and exploitation of the opponent's weaker side. DOM-free.

import { COURT } from '../config.js';
import { contactGeometry, isReachable } from './shot.js';
import { predictPath, planInterception } from './predict.js';
import { PLAYER } from './player.js';
import { SERVE_T } from './serve_choreo.js';

// ---------------------------------------------------------------- style tables (tunables)
/**
 * attack: willingness to attack short balls; approach: chance to approach on a short ball; lobMul: lob tendency vs net players;
 * mix: groundstroke shot weights; power: [min,max] rally power; base: baseline offset (m behind baseline; <0 = inside);
 * prefDepth/prefY/timeBias: where/when to take the ball; netZ: volley position (m from net).
 */
export const STYLES = {
  grinder: {
    name: '底线型', attack: 0.25, shortBy: 2.4, approach: 0.04, lobMul: 0.8, dropP: 0.02, mix: { topspin: 0.78, slice: 0.17, flat: 0.05 },
    power: [0.55, 0.78], attackPower: [0.75, 0.9], base: 1.5, prefDepth: 1.0, prefY: 1.0, timeBias: 0.25, netZ: 3.6,
    serve: { flat: 0.2, slice: 0.45, topspin: 0.35 }, serveNet: [0.0, 0.0], cross: 0.7, edge: 0.3, volleyOK: false,
  },
  aggressive: {
    name: '进攻型', attack: 0.75, shortBy: 0.2, approach: 0.45, lobMul: 0.5, dropP: 0.08, mix: { topspin: 0.35, slice: 0.05, flat: 0.6 },
    power: [0.72, 0.95], attackPower: [0.88, 1.0], base: -0.3, prefDepth: -0.6, prefY: 0.85, timeBias: -0.8, netZ: 3.2,
    serve: { flat: 0.7, slice: 0.3, topspin: 0.0 }, serveNet: [0.0, 0.0], cross: 0.5, edge: 0.5, volleyOK: true,
  },
  serveVolley: {
    name: '发球上网', attack: 0.55, shortBy: 0.9, approach: 0.6, lobMul: 0.5, dropP: 0.1, mix: { topspin: 0.25, slice: 0.4, flat: 0.35 },
    power: [0.62, 0.85], attackPower: [0.8, 0.95], base: 0.6, prefDepth: 0.3, prefY: 0.9, timeBias: -0.4, netZ: 3.0,
    serve: { flat: 0.55, slice: 0.45, topspin: 0.0 }, serveNet: [0.88, 0.45], cross: 0.5, edge: 0.45, volleyOK: true,
  },
  counter: {
    name: '防守反击型', attack: 0.3, shortBy: 2.6, approach: 0.05, lobMul: 1.8, dropP: 0.03, mix: { topspin: 0.5, slice: 0.4, flat: 0.1 },
    power: [0.5, 0.75], attackPower: [0.75, 0.92], base: 2.4, prefDepth: 2.0, prefY: 1.0, timeBias: 0.5, netZ: 3.6,
    serve: { flat: 0.1, slice: 0.5, topspin: 0.4 }, serveNet: [0.0, 0.0], cross: 0.75, edge: 0.25, volleyOK: false,
  },
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sgn = (x) => (x < 0 ? -1 : 1);
const HALF_W = COURT.singlesHalfWidth;
const XSCALE = 3.4;     // approx. conversion world x -> normalized aimX (matches shot.js xLim)

export class AIController {
  /** @param {import('./simulation.js').Simulation} sim @param {0|1} index @param {string} style @param {number} level 0..1 */
  constructor(sim, index, style = 'grinder', level = 0.6) {
    this.sim = sim; this.i = index; this.o = 1 - index;
    this.styleName = STYLES[style] ? style : 'grinder';
    this.S = STYLES[this.styleName];
    this.level = clamp(level, 0, 1);
    this.me = sim.players[index];
    this.seenHit = -1;
    this.reactAt = 0;
    this.plan = null; this.planKey = -1;
    this.swingMs = 0;
    this.netMode = false; this.wantNet = false;
    this.recKey = -1; this.recTarget = null;
    this.serveParams = null;
    this.serveHist = { deuce: [], ad: [] };
    this.tossed = false;
    this.jitter = 0;
    this.me.speedMul = lerp(0.92, 1.0, this.level);
  }

  // ------------------------------------------------------------ hooks
  onHit(by, isServe = false) {
    if (by === this.i) {
      if (isServe) this.netMode = this.sim.rngAI.chance(this.S.serveNet[this.sim.faultCount > 0 ? 1 : 0]);
      else { this.netMode = this.wantNet; }
      this.wantNet = false;
    }
  }
  onPointEnd() { this.netMode = false; this.wantNet = false; this.plan = null; this.tossed = false; this.seenHit = -1; }

  // ------------------------------------------------------------ main loop
  update(dt) {
    const sim = this.sim, me = this.me, b = sim.ball;
    switch (sim.phase) {
      case 'serve-prep': this._servePrep(); break;
      case 'serving':
        if (sim.match.server === this.i) {
          if (sim.toss && !sim.toss.hit) this._serving();
          else this._recover();
        } else this._incoming();
        break;
      case 'rally':
        if (b.inPlay && b.lastHitBy !== this.i) this._incoming(); else this._recover();
        break;
      default: me.intent.x = 0; me.intent.z = 0;
    }
  }

  _stop() { this.me.hold(); }

  /** Move order (player.js handles footwork, braking steps and start/stop hysteresis). */
  _moveTo(x, z, timeLeft = null) { this.me.moveTo(x, z, timeLeft); }

  // ------------------------------------------------------------ serving
  _servePrep() {
    const sim = this.sim, me = this.me;
    this._stop();
    this.seenHit = -1;
    if (sim.match.server !== this.i) return;
    if (!sim.serverReady(this.i)) return;            // finish the ball-bounce routine first
    if (sim.phaseT < sim._aiServeAt) return;
    this.serveParams = this._planServe();
    if (sim.serveToss(this.i, { shot: this.serveParams.shot })) {
      this.tossed = true;
      this.jitter = sim.rngAI.gauss(0, (1 - this.level) * 0.05 + 0.008);
    }
  }

  _serving() {
    const sim = this.sim;
    this._stop();
    if (sim.toss.t >= SERVE_T.contact + this.jitter) {
      sim.swing(this.i, { ...this.serveParams, source: 'ai' });
    }
  }

  _planServe() {
    const sim = this.sim, S = this.S, rng = sim.rngAI, L = this.level;
    const first = sim.faultCount === 0;
    const court = sim.match.serveCourt;
    const box = sim.serveBox;
    const opp = sim.players[this.o];
    const hist = this.serveHist[court];
    const weak = sim.weakness(this.o);
    // placement options: wide / body / T  -> aimX (relative to box sign)
    const opts = [['wide', 0.9], ['body', 0.05], ['T', -0.85]];
    const items = opts.map(([name, a]) => {
      let w = name === 'body' ? 0.7 : name === 'wide' ? 0.8 : 1.0;
      const x = box.boxSign * 2.1 + 1.7 * a * box.boxSign;
      const lat = (x - opp.pos.x) * opp.handX;       // >0 forehand side of the receiver
      if (weak.weaker) w *= (weak.weaker === 'bh') === (lat < 0) ? 1.7 : 0.8;
      const recent = hist.slice(-2);
      if (recent.includes(name)) w *= recent.every((r) => r === name) ? 0.15 : 0.55;
      return [{ name, a }, w];
    });
    const pick = rng.weighted(items);
    hist.push(pick.name); if (hist.length > 6) hist.shift();
    const typeW = first ? S.serve : { topspin: 0.62, slice: 0.38, flat: 0 };
    const shot = rng.weighted(Object.entries(typeW).filter(([, w]) => w > 0));
    const power = first ? clamp(0.4 + 0.3 * L + rng.range(-0.07, 0.07), 0.35, 1) : rng.range(0.5, 0.68);
    const aimX = clamp(box.boxSign * pick.a + rng.range(-0.08, 0.08), -1, 1);
    const aimDepth = first ? rng.range(0.45, 0.95) : rng.range(-0.1, 0.25);
    return { shot, power, aimX, aimDepth, risk: first ? 1.0 : 0.85 };
  }

  // ------------------------------------------------------------ incoming ball
  _incoming() {
    const sim = this.sim, me = this.me, b = sim.ball;
    if (this.seenHit !== sim.hitCount) {
      this.seenHit = sim.hitCount;
      const react = lerp(0.36, 0.12, this.level) * (sim.rally.shots === 1 ? 0.7 : 1);
      this.reactAt = sim.time + react * sim.rngAI.range(0.85, 1.15);
      this.plan = null; this.planKey = -1;
      this.swingMs = sim.rngAI.gauss(0, 8 + 58 * (1 - this.level));
    }
    if (sim.time < this.reactAt) { if (this.netMode) this._recoverMove(1); else this._stop(); return; }   // split step, read the ball
    const key = sim.hitCount * 4 + b.bounces;
    if (this.planKey !== key) this._replan(key);
    const p = this.plan;
    if (!p) { this._stop(); return; }
    if (Math.abs(p.stand.z) > 10.2) this.netMode = false;
    this._moveTo(p.stand.x, p.stand.z, p.t - (sim.time - this.planTime));
    this._maybeSwing(p);
  }

  _replan(key) {
    const sim = this.sim, me = this.me, b = sim.ball, S = this.S, L = this.level;
    this.planKey = key;
    const { path, result } = predictPath({ pos: b.pos, vel: b.vel, spin: b.spin, bounces: b.bounces }, sim.surfaceKey);
    const land = result.landing;
    const netD = Math.abs(me.pos.z);
    const lands = land && b.bounces === 0;
    const out = lands && (Math.abs(land.x) > HALF_W + 0.1 || Math.abs(land.z) > COURT.halfLength + 0.1 || land.z * me.facing < 0 || result.hitNet);
    const wantVolley = b.bounces === 0 && !out && (this.netMode || (S.volleyOK && netD < 7.0) || netD < 5.0);
    const sd = (1 - L) * 0.8 * (b.bounces >= 1 ? 0.45 : 1);
    const prefs = {
      vmax: PLAYER.maxSpeed * me.speedMul, accel: PLAYER.accel0, reactDelay: Math.max(0, this.reactAt - sim.time),
      allowVolley: wantVolley, yMin: 0.35, yMax: 1.7, prefY: S.prefY, prefDepth: S.prefDepth, timeBias: S.timeBias,
      volleyYMin: 0.45, volleyYMax: 2.6, volleyZ: S.netZ + 0.6, volleyBias: this.netMode ? -0.8 : -0.1, volleyTol: this.netMode ? 0.35 : 0.1, noiseX: sd, noiseZ: sd * 0.7, rng: sim.rngAI,
    };
    prefs.vmax = PLAYER.maxSpeed * me.speedMul * 0.97;
    const c = planInterception(path, me, prefs);
    this.plan = c;
    this.planTime = sim.time;
  }

  _maybeSwing(p) {
    const sim = this.sim, me = this.me, b = sim.ball;
    if (me.cooldown > 0 || me.swingT >= 0 || sim.phase !== 'rally') return;
    if (b.bounces !== p.bounces) return;
    const geo = contactGeometry(me, b);
    if (geo.fwd < -0.75) return;                              // ball already past
    const ms = geo.tEarly * 1000;
    if (ms > this.swingMs) return;
    if (geo.latAbs > 1.75 || geo.y > 3.0) return;             // hopeless: do not swing
    const d = this._decide(geo);
    sim.swing(this.i, { ...d, source: 'ai', ageMs: 0 });
  }

  // ------------------------------------------------------------ shot selection
  _decide(geo) {
    const sim = this.sim, me = this.me, opp = sim.players[this.o], b = sim.ball, S = this.S, L = this.level, rng = sim.rngAI;
    const y = b.pos.y;
    const netD = Math.abs(me.pos.z), behind = netD - COURT.halfLength;
    const oppNetD = Math.abs(opp.pos.z);
    const oppAtNet = oppNetD < 6.2, oppDeep = oppNetD > COURT.halfLength + 1.2;
    const inKmh = Math.hypot(b.vel.x, b.vel.y, b.vel.z) * 3.6;
    const hSpeed = Math.hypot(me.vel.x, me.vel.z);
    const stretch = Math.max(clamp((geo.latAbs - 1.0) / 0.45, 0, 1), 0.8 * clamp((hSpeed - 4.6) / 1.4, 0, 1));
    const volleyZone = b.bounces === 0 && netD < 6.8;
    const smashBall = y > 1.9 && netD < 9.5 && b.vel.y < 2.5;
    const oppX = opp.pos.x;
    const weak = sim.weakness(this.o);
    const bhDir = -opp.handX;                                        // x direction of opponent's backhand side
    const weakDir = weak.weaker === 'bh' ? bhDir : weak.weaker === 'fh' ? -bhDir : 0;
    const mySgn = Math.abs(me.pos.x) > 0.8 ? sgn(me.pos.x) : sgn(b.pos.x || 1);
    const openSide = Math.abs(oppX) > 1.0 ? -sgn(oppX) : (weakDir || (rng.chance(0.5) ? 1 : -1));
    const sloppy = rng.chance((1 - L) * 0.3);                        // decision-quality lapse
    const risk = 1.3 - 0.35 * L;
    const pw = (r) => lerp(r[0], r[1], rng.next());
    let d;

    if (volleyZone || smashBall) {
      if (smashBall && y > 1.9) {
        d = { shot: 'flat', power: pw(S.attackPower), aimX: openSide * rng.range(0.55, 0.85), aimDepth: rng.range(0.1, 0.5), edge: 0.45 };
      } else if (y > 0.95 && oppDeep && rng.chance(S.dropP * (0.5 + L)) && !sloppy) {
        d = { shot: 'slice', power: 0.3, aimX: openSide * 0.5, aimDepth: -0.9, edge: 0.3 };            // drop volley
      } else if (y < 0.55 || stretch > 0.5) {
        d = { shot: 'slice', power: 0.5, aimX: clamp(-sgn(oppX) * 0.25, -1, 1), aimDepth: 0.55, edge: 0.15 };  // defensive deep volley
      } else {
        d = { shot: 'flat', power: lerp(0.5, 0.8, S.attack), aimX: openSide * rng.range(0.6, 0.95), aimDepth: oppDeep ? rng.range(-0.1, 0.25) : rng.range(0.2, 0.6), edge: 0.5 };
      }
    } else if (stretch > 0.55 || (y > 1.5 && behind > 0.3) || (inKmh > 128 && behind > 1.2 && stretch > 0.25)) {
      // defensive reply
      if (oppAtNet && rng.chance(0.55 * S.lobMul)) d = { shot: 'lob', power: 0.5, aimX: -sgn(oppX) * 0.35, aimDepth: 0.4, edge: 0.15 };
      else if (this.styleName === 'counter' || rng.chance(0.55)) d = { shot: 'slice', power: 0.42, aimX: -mySgn * 0.45, aimDepth: 0.55, edge: 0.12 };
      else d = { shot: 'topspin', power: 0.45, aimX: -mySgn * 0.4, aimDepth: 0.6, edge: 0.12 };
    } else if (oppAtNet) {
      const lobP = (stretch > 0.3 ? 0.45 : 0.18) * S.lobMul * (oppNetD < 3.2 ? 1.3 : 1) * (y < 1.5 ? 1 : 0.4);
      if (rng.chance(lobP)) {
        d = { shot: 'lob', power: rng.range(0.45, 0.75), aimX: -sgn(oppX || 1) * rng.range(0.1, 0.5), aimDepth: rng.range(0.3, 0.7), edge: 0.2 };
      } else {
        const dtl = this.styleName === 'counter' ? 0.9 : 0.8;
        d = { shot: rng.chance(0.55) ? 'topspin' : 'flat', power: lerp(0.65, 0.9, S.attack), aimX: (Math.abs(oppX) > 0.7 ? -sgn(oppX) : openSide) * dtl, aimDepth: rng.range(-0.1, 0.25), edge: 0.6 };
      }
    } else {
      const short = netD < COURT.halfLength - S.shortBy && y > 0.55 && y < 1.55 && stretch < 0.5 && inKmh < 125;
      const atk = short ? clamp(S.attack * (0.55 + 0.6 * L) * (netD < COURT.halfLength - 4 ? 1.3 : 1), 0, 0.95) : 0;
      if (short && rng.chance(S.approach * (0.5 + 0.7 * L) * (netD < COURT.halfLength - 2.2 ? 1.2 : 0.6))) {
        // approach shot: deep, usually down the line to the open side, then go to the net
        this.wantNet = true;
        d = { shot: this.styleName === 'aggressive' ? 'flat' : 'slice', power: rng.range(0.55, 0.75), aimX: openSide * rng.range(0.5, 0.8), aimDepth: rng.range(0.45, 0.8), edge: 0.35 };
      } else if (short && rng.chance(atk)) {
        d = { shot: this.styleName === 'aggressive' || this.styleName === 'serveVolley' ? 'flat' : 'topspin', power: pw(S.attackPower), aimX: openSide * rng.range(0.65, 0.95), aimDepth: rng.range(0.2, 0.55), edge: 0.6 };
      } else {
        // neutral rally ball
        const shot = rng.weighted(Object.entries(S.mix));
        let aimX;
        const exploit = weakDir !== 0 && rng.chance(0.3 + 0.35 * L);
        if (exploit) aimX = clamp((oppX + weakDir * 2.3) / XSCALE, -0.9, 0.9);
        else if (Math.abs(oppX) > 1.4 && rng.chance(0.65)) aimX = -sgn(oppX) * rng.range(0.65, 0.95);   // behind the opponent
        else if (rng.chance(S.cross)) aimX = -mySgn * rng.range(0.55, 0.9);                              // cross-court
        else aimX = mySgn * rng.range(0.5, 0.85);                                                        // change direction
        d = { shot, power: pw(S.power), aimX, aimDepth: shot === 'slice' ? rng.range(0.15, 0.5) : rng.range(0.1, 0.45), edge: S.edge };
        // rally-length driven pace variation for non-aggressive styles
        if (shot === 'topspin' && sim.rally.shots > 8 && rng.chance(0.12)) d.shot = 'slice';
      }
    }
    const tired = clamp((sim.rally.shots - 10) / 18, 0, 1);       // long rallies: someone has to take a risk
    if (tired > 0 && !volleyZone) { d.power = Math.min(1, d.power + 0.15 * tired); d.edge = Math.min(1, (d.edge ?? 0.4) + 0.3 * tired); }
    if (sloppy) { d.power = Math.min(1, d.power + 0.12); d.edge = Math.min(1, (d.edge ?? 0.4) + 0.3); }
    d.risk = risk;
    return d;
  }

  // ------------------------------------------------------------ recovery
  _recover() {
    const sim = this.sim;
    this._recoverMove(0.9);
  }

  _recoverMove(frac) {
    const sim = this.sim, me = this.me, S = this.S, opp = sim.players[this.o];
    // opponent's expected hitting point: where my shot is heading, blended with where he stands now
    const ls = sim.lastShot;
    const tgt = ls && ls.by === this.i && ls.target ? ls.target.x : opp.pos.x;
    const ox = 0.65 * tgt + 0.35 * opp.pos.x;
    const oz = opp.pos.z;
    const D = Math.abs(me.pos.z - oz) + 0.001;
    const aL = Math.atan((-HALF_W - ox) / D), aR = Math.atan((HALF_W - ox) / D);
    let x = ox + D * Math.tan(0.5 * (aL + aR));
    x = clamp(x, -2.2, 2.2);
    const z = this.netMode ? me.facing * S.netZ : me.facing * (COURT.halfLength + S.base);
    this._moveTo(x, z);
  }
}
