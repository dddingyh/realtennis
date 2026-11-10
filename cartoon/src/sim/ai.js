// AI opponent. It plays by the same rules as the human: it only calls sim.swing() (with a chosen timing offset =
// intended direction + Gaussian timing error that depends on the level) and sim.setNet(). Movement, reach, stamina,
// reaction delay are the shared sim rules (the AI only gets its own reaction time / anticipation noise).
import * as K from './tuning.js';
import { clamp, lerp } from './shot.js';

/** Style parameters. approach: chance to go to the net after a short ball; drop/lob: preferences; pow: base power. */
export const STYLES = {
  baseliner: { pow: 0.62, approach: 0.10, drop: 0.015, lobNet: 0.22, attack: 0.5, slice: 0.14, flat: 0.12, aimMax: 0.95, serveVolley: 0, wideServe: 0.35, serveP: 0.82, dtl: 0.28 },
  attacker:  { pow: 0.76, approach: 0.55, drop: 0.02, lobNet: 0.12, attack: 0.9, slice: 0.06, flat: 0.34, aimMax: 1.0, serveVolley: 0.06, wideServe: 0.4, serveP: 0.95, dtl: 0.38 },
  netrusher: { pow: 0.64, approach: 0.6, drop: 0.03, lobNet: 0.15, attack: 0.8, slice: 0.30, flat: 0.12, aimMax: 0.95, serveVolley: 0.4, wideServe: 0.45, serveP: 0.88, dtl: 0.30 },
  trickster: { pow: 0.55, approach: 0.30, drop: 0.13, lobNet: 0.42, attack: 0.6, slice: 0.34, flat: 0.08, aimMax: 1.0, serveVolley: 0.04, wideServe: 0.5, serveP: 0.78, dtl: 0.34 },
};
export const STYLE_NAMES = Object.keys(STYLES);

const sgn = (x) => (x < 0 ? -1 : 1);

export class AIBrain {
  constructor(sim, i, cfg = {}) {
    this.i = i;
    this.level = clamp(cfg.level ?? 0.5, 0, 1);
    this.styleName = STYLES[cfg.style] ? cfg.style : 'baseliner';
    this.S = STYLES[this.styleName];
    this.rng = sim.rng.fork();
    this.configure(sim);
    this.int = null; this.intKey = ''; this.tossAt = 0; this.hitAt = null; this.serveKey = '';
  }

  /** Map level 0..1 to concrete limits (also callable after changing this.level). */
  configure(sim) {
    const L = this.level, p = sim.P[this.i];
    this.sigmaT = AI_TUNE.sigmaMin + AI_TUNE.sigmaRange * Math.pow(1 - L, AI_TUNE.sigmaExp);
    this.tactic = lerp(AI_TUNE.tacticLo, AI_TUNE.tacticHi, L);
    this.aimMax = lerp(AI_TUNE.aimLo, AI_TUNE.aimHi, L) * this.S.aimMax;
    this.powNoise = lerp(0.15, 0.05, L);
    p.reaction = lerp(AI_TUNE.reactLo, AI_TUNE.reactHi, L);
    p.perceive = lerp(0.6, 0.12, L);
  }

  tick(sim) {
    const p = sim.P[this.i];
    if (sim.phase === 'serving') { if (sim.match.server === this.i) this._tickServe(sim, p); return; }
    if (sim.phase !== 'rally') { this.int = null; return; }
    const pl = p.plan;
    if (!pl || pl.swing || pl.expired) return;
    const key = sim.rl.shots + ':' + sim.rl.lastHitTime;
    if (key !== this.intKey) { this.intKey = key; this.int = null; }
    const now = sim.time;
    if (!this.int) {
      if (now < p.reactUntil || pl.tContact - now > 0.42) return;
      this.int = this._decide(sim, p, pl);
    }
    const at = pl.tContact + this.int.offset;
    if (now >= at - 1e-9) {
      this.int.fired = true;
      sim.swing(this.i, { source: 'ai', shot: this.int.shot, power: this.int.power });
    }
  }

  // ------------------------------------------------------------------ serve
  _tickServe(sim, p) {
    const sv = sim.sv, now = sim.time;
    const key = sim.match.points[0] + ',' + sim.match.points[1] + ',' + sim.match.games[0] + ',' + sim.match.games[1] + ',' + sim.faultCount + ',' + sim.match.sets.length;
    if (key !== this.serveKey) { this.serveKey = key; this.tossAt = 0; this.hitAt = null; }
    if (sv.stage === 'wait') {
      if (!this.tossAt) this.tossAt = now + 0.45 + this.rng.next() * 0.5;
      if (now >= this.tossAt) { this.tossAt = 0; this.hitAt = null; sim.swing(this.i, { source: 'ai' }); }
      return;
    }
    if (sv.stage === 'raise' || sv.stage === 'flight') {
      if (this.hitAt === null) {
        const g = sim._serveGeom(p);
        const first = sim.faultCount === 0;
        const S = this.S, r = this.rng;
        let x;
        const u = r.next();
        if (u < S.wideServe * (first ? 1 : 0.5)) x = g.boxSign * r.range(3.0, 3.55);       // wide
        else if (u < S.wideServe * (first ? 1 : 0.5) + 0.38) x = g.boxSign * r.range(0.55, 1.0);   // T
        else x = g.boxSign * r.range(1.8, 2.5);                                              // body
        const power = first ? clamp(S.serveP - 0.1 + r.gauss(0, 0.05), 0.4, 1) : clamp(0.5 + r.gauss(0, 0.05), 0.3, 0.7);
        const off = sim.serveTimingForAim(this.i, x) / 1000 + r.gauss(0, this.sigmaT * 0.9);
        this.hitAt = Math.max(sv.tRel + 0.06, sv.tIdeal + off);
        this.servePower = power;
      }
      if (sv.stage === 'flight' && now >= this.hitAt) {
        const ok = sim.swing(this.i, { source: 'ai', power: this.servePower });
        if (ok && this.rng.chance(this.S.serveVolley) && sim.faultCount === 0) sim.setNet(this.i, true);
      }
    }
  }

  // ------------------------------------------------------------------ rally decisions
  _decide(sim, p, pl) {
    const S = this.S, r = this.rng, L = this.level;
    const opp = sim.P[1 - this.i];
    const P = pl.P;
    const oppNet = opp.zone === 'net' || (opp.zone === 'toNet' && Math.abs(opp.pos.z) < 9.5);
    const oppDeep = Math.abs(opp.pos.z) > 12.5;
    const oppX = opp.pos.x;
    const marginP = clamp(1 - pl.margin / 0.3, 0, 1);
    const pressure = clamp(marginP * 0.8 + clamp((pl.inSpeed - 24) / 18, 0, 1) * 0.35, 0, 1);
    const kind = pl.kind === 'smash' ? 'smash' : (pl.bounces === 0 ? 'volley' : 'ground');
    const shortBall = Math.abs(P.z) < 10.3 && P.y > 0.45;
    const smart = r.chance(this.tactic);
    const open = (strength = 1) => {
      let s = Math.abs(oppX) < 0.9 ? (r.chance(0.5) ? 1 : -1) : -sgn(oppX);
      if (Math.abs(oppX) < 0.9 && Math.abs(P.x) > 1.5) s = -sgn(P.x);
      return s * this.aimMax * K.AIM_X * strength;
    };
    let shot = 'topspin', power = S.pow, aimX = 0, net = null;

    if (!smart) {
      aimX = r.range(-1, 1) * 3.0; power = clamp(r.range(0.3, 0.9), 0, 1); shot = r.pick(['topspin', 'topspin', 'flat', 'slice']);
    } else if (kind === 'smash') {
      power = clamp(0.72 + 0.2 * L, 0, 1); aimX = open(0.9); shot = 'topspin';
    } else if (kind === 'volley') {
      if (pressure > 0.7) { power = 0.42; aimX = -sgn(P.x) * 1.2; }
      else if (oppDeep && r.chance(S.drop * 3 + 0.04)) { power = 0.14; shot = 'slice'; aimX = open(0.6); }
      else { power = clamp(0.5 + 0.35 * r.next(), 0, 1); aimX = open(r.range(0.7, 1)); }
    } else if (pressure > 0.64) {
      if (oppNet) { shot = 'lob'; power = 0.42; aimX = -sgn(oppX) * 1.5; }
      else { shot = r.chance(0.45) ? 'slice' : 'topspin'; power = 0.36; aimX = -sgn(P.x) * r.range(0.8, 1.8); }
    } else if (oppNet) {
      const lob = r.chance(opp.set > 0.6 ? 0.55 + S.lobNet : 0.25 + S.lobNet * 0.8) && Math.abs(opp.pos.z) < 5.5;
      if (lob) { shot = 'lob'; power = r.range(0.7, 0.9); aimX = (Math.abs(oppX) > 0.8 ? -sgn(oppX) : sgn(r.next() - 0.5)) * 1.8; }
      else { shot = r.chance(0.5) ? 'flat' : 'topspin'; power = clamp(0.62 + 0.12 * L + r.range(-0.05, 0.05), 0, 1); aimX = open(r.range(0.8, 1)); }
    } else if (shortBall && pressure < 0.5 && r.chance(S.attack)) {
      shot = r.chance(0.55 + S.flat) ? 'flat' : 'topspin'; power = clamp(0.8 + 0.1 * L + r.range(-0.05, 0.05), 0, 1);
      aimX = open(r.range(0.85, 1));
      if (r.chance(S.approach)) net = true;
    } else if (oppDeep && Math.abs(P.z) < 12.4 && pressure < 0.4 && r.chance(S.drop * (0.6 + 0.6 * L))) {
      shot = 'slice'; power = r.range(0.06, 0.22); aimX = open(0.5);
    } else {
      // construct the point: work the open court, stretch the opponent, finish when he is out of position
      const corner = clamp(this.aimMax * K.AIM_X, 0, 3.4);
      const stretched = Math.abs(oppX) > 1.9 || (opp.zone !== 'base' && !oppNet);
      let side, mag;
      if (Math.abs(oppX) > 1.1) {
        side = -sgn(oppX); mag = r.range(0.8, 1.0) * corner;
        if (r.chance(S.dtl * 0.5)) { side = sgn(oppX); mag = r.range(0.55, 0.8) * corner; }      // behind him
      } else if (r.chance(S.dtl)) { side = sgn(P.x); mag = r.range(0.7, 0.95) * corner; }          // down the line
      else { side = -sgn(P.x) || 1; mag = r.range(0.7, 1.0) * corner; }                          // cross-court
      aimX = side * mag;
      power = S.pow + 0.3 * (L - 0.5) + r.range(-0.08, 0.1);
      if (stretched && pressure < 0.42) power += 0.16;
      power += clamp((sim.rl.shots - 6) * 0.035, 0, 0.3);          // impatience: long rallies get hit harder
      power += 0.32 * clamp((L - 0.8) / 0.2, 0, 1);
      power = clamp(power, 0.2, 1);
      const u = r.next();
      if (u < S.slice) { shot = 'slice'; power = clamp(power - 0.08, 0.2, 1); }
      else if (u < S.slice + S.flat && power > 0.5) shot = 'flat';
      if (shortBall && pressure < 0.5 && r.chance(S.approach * 0.45)) net = true;
    }
    power = clamp(power + r.gauss(0, this.powNoise), 0, 1);
    if (shot === 'slice' && power <= 0.27 && power > 0.2) power = 0.3;          // avoid accidental drop shots
    if (net === true) sim.setNet(this.i, true);
    else if (p.wantNet && pressure > 0.8 && Math.abs(P.z) > 8) sim.setNet(this.i, false);
    const sig = this.sigmaT * (1 + 1.1 * pressure) * (1 + clamp((pl.inSpeed - 25) / 45, 0, 0.4));
    // do not aim so close to the edge of the timing window that ordinary timing error drags the ball wide
    const dirCap = clamp((K.T_FULL - 1.6 * sig) / K.T_FULL, 0.3, 1);
    aimX = clamp(aimX, -K.aimToX(dirCap), K.aimToX(dirCap));
    const offset = sim.timingForAim(this.i, aimX) / 1000 + r.gauss(0, sig);
    return { shot, power, offset, aimX };
  }
}

/** Level -> behaviour mapping (calibrated by tests/arcade_compete.mjs). */
export const AI_TUNE = {
  sigmaMin: 0.002, sigmaRange: 0.085, sigmaExp: 1.0,
  tacticLo: 0.55, tacticHi: 1.0,
  aimLo: 0.70, aimHi: 1.0,
  reactLo: 0.24, reactHi: 0.08,
};
