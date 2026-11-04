// Competitiveness calibration with simulated "human" bots (DESIGN §7, SIM v4).
// The bot plays like a person with a phone: 250 ms reaction, ±60 ms swing-timing noise, 'assist' auto-move with imperfect
// steering, noisy analog swing parameters, exec ~ N(0.8, 0.15). Run: node tests/sim_compete.mjs [pointsPerLevel]
import { Simulation } from '../src/game/simulation.js';
import { contactGeometry, isReachable } from '../src/game/shot.js';
import { RNG } from '../src/game/rng.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 1) => x.toFixed(n);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const REAL_DT = 1 / 120;
const POINTS = +process.argv[2] || 300;

/** A simulated human with a phone controller. */
export class HumanBot {
  constructor(sim, i, seed, o = {}) {
    this.sim = sim; this.i = i; this.rng = new RNG(seed);
    this.steer = o.steer !== false;
    this.reactMs = o.reactMs ?? 250; this.timingSd = o.timingSd ?? 60;
    this.realT = 0; this.seen = -1; this.reactAt = 0; this.steerDone = false; this.steerNoise = 0; this.stopDist = 0.6;
    this.swingAt = 0; this.swung = -1;
  }
  tick() {
    const sim = this.sim, i = this.i, pl = sim.players[i], b = sim.ball, rng = this.rng;
    this.realT += REAL_DT;
    // serve with the phone's serve button (auto toss+hit), varied
    if (sim.phase === 'serve-prep' && sim.match.server === i && sim.serverReady(i)) {
      const second = sim.state.match.faultCount > 0;
      sim.swing(i, { shot: second ? 'topspin' : rng.chance(0.7) ? 'flat' : 'slice', power: clamp(rng.gauss(second ? 0.6 : 0.75, 0.08), 0.3, 1), aimX: rng.range(-1, 1), source: 'remote' });
      return;
    }
    const incoming = b.inPlay && b.lastHitBy !== i && (sim.phase === 'rally' || sim.phase === 'serving');
    if (!incoming) { sim.setMove(i, 0, 0); return; }
    if (this.seen !== sim.hitCount) {
      this.seen = sim.hitCount;
      this.reactAt = this.realT + this.reactMs / 1000 * rng.range(0.85, 1.2);
      this.steerDone = false; this.steerNoise = rng.gauss(0, 0.22); this.stopDist = clamp(rng.gauss(0.6, 0.25), 0.2, 1.2);
      this.timingErr = rng.gauss(0, this.timingSd);
    }
    // steering: only when the ball is clearly out of the comfortable range
    if (this.steer && this.realT >= this.reactAt && !this.steerDone) {
      const c = sim._plan(i);
      const st = c && c.plan ? c.plan.stand : null;
      if (st) {
        const dx = st.x - pl.pos.x, dz = st.z - pl.pos.z, d = Math.hypot(dx, dz);
        if (d > this.stopDist + 0.6) {
          const a = Math.atan2(dz, dx) + this.steerNoise;
          sim.setMove(i, Math.cos(a), Math.sin(a));
        } else { sim.setMove(i, 0, 0); if (d <= this.stopDist) this.steerDone = true; }
      }
    } else sim.setMove(i, 0, 0);
    // swing: when the ball reaches the strike plane, with timing noise (real ms)
    if (sim.phase === 'rally' && this.swung !== sim.hitCount && pl.cooldown <= 0 && pl.swingT < 0) {
      const g = contactGeometry(pl, b);
      const plan = sim._plan(i);
      const wantBounce = plan && plan.plan ? plan.plan.bounces : 1;
      if (b.bounces >= wantBounce && isFinite(g.tEarly) && g.tEarly / sim.timeScale * 1000 <= this.timingErr && g.fwd > -1.2) {
        this.swung = sim.hitCount;
        const opp = sim.players[1 - i];
        const aimX = clamp(rng.chance(0.6) ? -Math.sign(opp.pos.x || 1) * rng.range(0.2, 0.9) : rng.range(-0.8, 0.8), -1, 1) * pl.facing;
        sim.swing(i, {
          power: clamp(rng.gauss(0.7, 0.15), 0.2, 1), spin: clamp(rng.gauss(0.35, 0.4), -1, 1), lift: clamp(rng.gauss(0.5, 0.15), 0, 1),
          exec: clamp(rng.gauss(0.8, 0.15), 0, 1), aimX, side: 'auto', source: 'remote', ageMs: 0,
        });
      }
    }
  }
}

function playPoints(level, steer, nPoints, seed0) {
  const styles = ['grinder', 'aggressive', 'serveVolley', 'counter'];
  const st = { pts: 0, won: 0, shots: 0, winners: 0, forced: 0, ue: 0, aces: 0, df: 0, mishits: 0, botHits: 0 };
  let seed = seed0;
  while (st.pts < nPoints) {
    const sim = new Simulation({ aiStyle: styles[seed % 4], aiLevel: level, autoMove: ['assist', 'off'], seed, format: { sets: 1, gamesPerSet: 4, tiebreak: true },
      timing: { pointOver: 0.3, changeover: 0.3, aiServeDelay: [0.2, 0.4], walkDelay: 0.05, faultHold: 0.2, matchOver: 0.1 } });
    const bot = new HumanBot(sim, 0, seed * 7 + 1, { steer });
    seed++;
    for (let n = 0; n < 120 * 2400 && sim.state.match.phase !== 'match-over' && st.pts < nPoints; n++) {
      bot.tick();
      sim.step(REAL_DT);
      for (const e of sim.drainEvents()) {
        if (e.type === 'hit' && e.by === 0 && !e.serve) { st.botHits++; if (e.mishit) st.mishits++; }
        if (e.type === 'point') {
          st.pts++; if (e.winner === 0) st.won++;
          st.shots += e.shots;
          if (e.reason === 'winner') st.winners++;
          else if (e.reason === 'ace') st.aces++;
          else if (e.reason === 'double-fault') st.df++;
          else if (e.error === 'forced') st.forced++;
          else st.ue++;
        }
      }
    }
  }
  return st;
}

console.log(`human-like bot ('assist' + phone swings) vs AI, ${POINTS} points per cell`);
console.log('  level   bot(steers) wins   lazy bot wins   avg rally   winners  aces  forced  unforced  DF   bot mishits');
const rows = {};
for (const L of [0.2, 0.5, 0.8, 1.0]) {
  const a = playPoints(L, true, POINTS, 100 + L * 1000);
  const z = playPoints(L, false, POINTS, 500 + L * 1000);
  rows[L] = { a, z };
  const p = (x) => f(100 * x / a.pts, 0).padStart(4) + '%';
  console.log(`  ${f(L, 1)}     ${p(a.won)}              ${f(100 * z.won / z.pts, 0).padStart(3)}%          ${f(a.shots / a.pts).padStart(4)}       ${p(a.winners)}  ${p(a.aces)}  ${p(a.forced)}   ${p(a.ue)}  ${p(a.df)}   ${f(100 * a.mishits / Math.max(1, a.botHits), 0)}%`);
}
const w = (L) => rows[L].a.won / rows[L].a.pts;
check('easy (0.2): the bot wins ~60-70% of points', w(0.2) >= 0.55 && w(0.2) <= 0.75, f(100 * w(0.2), 0) + '%');
check('medium (0.5): ~45-50%', w(0.5) >= 0.40 && w(0.5) <= 0.56, f(100 * w(0.5), 0) + '%');
check('hard (0.8): ~30-35%', w(0.8) >= 0.25 && w(0.8) <= 0.41, f(100 * w(0.8), 0) + '%');
check('max (1.0): ~20%', w(1.0) >= 0.12 && w(1.0) <= 0.28, f(100 * w(1.0), 0) + '%');
check('difficulty is monotonic', w(0.2) > w(0.5) && w(0.5) > w(0.8) && w(0.8) > w(1.0));
const lazyGap = [0.2, 0.5, 0.8].map((L) => rows[L].a.won / rows[L].a.pts - rows[L].z.won / rows[L].z.pts);
check('a bot that never steers loses clearly more points (assist does not play the game for you)', lazyGap.every((g) => g > 0.05), lazyGap.map((g) => f(100 * g, 0) + ' pts%').join(', '));
const all = Object.values(rows).map((r) => r.a);
const tot = all.reduce((s, x) => { for (const k in x) s[k] = (s[k] || 0) + x[k]; return s; }, {});
check('average rally 5-9 shots', tot.shots / tot.pts >= 4.5 && tot.shots / tot.pts <= 9.5, f(tot.shots / tot.pts));
check('winners + forced errors are a meaningful share (> 30% of points)', (tot.winners + tot.forced + tot.aces) / tot.pts > 0.3, f(100 * (tot.winners + tot.forced + tot.aces) / tot.pts, 0) + '%');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
