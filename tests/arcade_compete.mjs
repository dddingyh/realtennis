// Calibration: a scripted "human-like" bot versus the AI at several levels, and proof that tactics matter.
// Bot: reaction 250 ms (real), timing error sigma 45 ms around its intended timing, noisy power, simple tactics.
// Run: node tests/arcade_compete.mjs        (env ARCADE_FAST=1 halves the sample sizes)
import { ArcadeSim } from '../cartoon/src/sim/arcade.js';
import { STYLE_NAMES } from '../cartoon/src/sim/ai.js';
import { RNG } from '../src/game/rng.js';
import { check, finish, f1, f2 } from './arcade_util.mjs';

const T0 = Date.now();
const FAST = !!process.env.ARCADE_FAST;
const TS = 0.8;                       // real game default
const DT = 1 / 60;

/** Human-like bot controlling player `i` through the public API only (plus the planned contact geometry a human sees). */
export class Bot {
  /** kind: 'tactical' | 'random' | 'netAlways' */
  constructor(sim, i, kind, seed, o = {}) {
    this.sim = sim; this.i = i; this.kind = kind; this.rng = new RNG(seed);
    this.reaction = o.reaction ?? 0.25; this.sigma = o.sigma ?? 0.045;
    this.real = 0; this.key = ''; this.sched = null; this.tossAt = null; this.serveKey = ''; this.hitAt = null;
  }
  tick(dt) {
    const { sim, i, rng } = this;
    this.real += dt;
    const st = sim.state, hint = st.hint, opp = st.players[1 - i], me = st.players[i];
    if (st.match.phase === 'serving' && st.match.server === i) return this.serve(st, hint);
    this.hitAt = null;
    if (st.match.phase !== 'rally') { this.sched = null; return; }
    if (this.kind === 'netAlways' && me.zone === 'base' && !sim.P[i].wantNet) sim.setNet(i, true);
    const key = st.rally.shots + ':' + st.rally.lastHitTime;
    if (key !== this.key) { this.key = key; this.sched = null; this.seenAt = this.real; this.decided = false; }
    if (hint.contactIn === null || hint.contactIn === undefined) { return; }
    if (!this.decided) {
      if (this.real < this.seenAt + this.reaction) return;
      this.decided = true;
      const plan = sim.P[i].plan;
      let shot = 'topspin', power = Math.min(1, Math.max(0.1, 0.58 + rng.gauss(0, 0.12))), aimX;
      const oppX = opp.pos.x, oppAtNet = opp.zone === 'net' || (opp.zone === 'toNet' && Math.abs(opp.pos.z) < 7);
      if (this.kind === 'random') {
        const off = rng.range(-140, 140);
        this.sched = { at: this.real + hint.contactIn + off / 1000 / TS, shot: rng.pick(['topspin', 'topspin', 'flat', 'slice']), power };
        return;
      }
      if (oppAtNet && Math.abs(opp.pos.z) < 5 && rng.chance(0.55)) { shot = 'lob'; power = 0.45 + rng.gauss(0, 0.08); aimX = Math.abs(oppX) > 0.8 ? -Math.sign(oppX) * 1.6 : rng.pick([-1.6, 1.6]); }
      else if (oppAtNet) { shot = rng.chance(0.5) ? 'flat' : 'topspin'; power = 0.72 + rng.gauss(0, 0.08); aimX = Math.abs(oppX) > 0.5 ? -Math.sign(oppX) * 2.0 : rng.pick([-2.0, 2.0]); }
      else {
        aimX = Math.abs(oppX) > 0.9 ? -Math.sign(oppX) * 1.9 : rng.pick([-1.7, 1.7]);
        const u = rng.next();
        if (u < 0.15) shot = 'slice'; else if (u < 0.28) shot = 'flat';
      }
      const short = plan && Math.abs(plan.P.z) < 9.6 && plan.P.y > 0.5 && !oppAtNet;
      if (this.kind === 'tactical' && short && me.zone === 'base' && rng.chance(0.45)) { sim.setNet(i, true); shot = 'flat'; power = 0.78 + rng.gauss(0, 0.06); aimX = -Math.sign(oppX || 1) * 2.0; }
      const intended = sim.timingForAim(i, aimX);                      // ms (sim time)
      const err = rng.gauss(0, this.sigma * 1000);
      this.sched = { at: this.real + hint.contactIn + (intended + err) / 1000 / TS, shot, power: Math.min(1, Math.max(0.05, power)) };
    }
    if (this.sched && this.real >= this.sched.at) {
      sim.swing(i, { shot: this.sched.shot, power: this.sched.power, source: 'keyboard' });
      this.sched = null;
    }
  }
  serve(st, hint) {
    const { sim, i, rng } = this;
    const key = st.match.points.join(',') + st.match.games.join(',') + st.match.faultCount + st.match.sets.length;
    if (key !== this.serveKey) { this.serveKey = key; this.tossAt = this.real + 0.5 + rng.next() * 0.4; this.hitAt = null; }
    if (!hint.tossUp) {
      if (this.tossAt !== null && this.real >= this.tossAt) { this.tossAt = null; sim.swing(i, {}); }
      return;
    }
    if (this.hitAt === null) {
      const g = sim._serveGeom(sim.P[i]);
      const first = st.match.faultCount === 0;
      const x = this.kind === 'random' ? g.cx + rng.range(-1.6, 1.6) : g.boxSign * rng.pick([0.8, 3.1, 2.0, 3.2]);
      const off = this.kind === 'random' ? rng.range(-120, 120) : sim.serveTimingForAim(i, x);
      this.hitAt = this.real + hint.contactIn + (off + rng.gauss(0, this.sigma * 1000)) / 1000 / TS;
      this.power = first ? Math.min(1, 0.85 + rng.gauss(0, 0.06)) : 0.55;
      if (this.kind === 'netAlways' || (this.kind === 'tactical' && rng.chance(0.08))) sim.setNet(i, true);
    }
    if (this.real >= this.hitAt) { sim.swing(i, { power: this.power, source: 'keyboard' }); this.hitAt = null; }
  }
}

/** Play `n` short matches (bot = player 0 or 1 alternately) against the AI; returns aggregate stats. */
export function compete({ kind, level, n, seedBase = 1, styles = STYLE_NAMES, format = { sets: 1, gamesPerSet: 3, tiebreak: true }, botOpts = {} }) {
  const R = { pts: 0, won: 0, rally: 0, approaches: 0, netPts: 0, netWon: 0, aiWinners: 0, aiAces: 0, botAces: 0, botDF: 0, aiDF: 0, matches: n, stuck: 0 };
  for (let m = 0; m < n; m++) {
    const botIdx = m % 2, style = styles[m % styles.length];
    const players = [0, 1].map((k) => (k === botIdx ? { human: true, hand: 'R', name: 'bot' } : { human: false, hand: m % 3 === 0 ? 'L' : 'R', name: 'AI', ai: { level, style } }));
    const sim = new ArcadeSim({ seed: seedBase * 1000 + m, timeScale: TS, format, players, firstServer: (m >> 1) % 2 });
    const bot = new Bot(sim, botIdx, kind, seedBase * 77 + m, botOpts);
    let guard = 0;
    while (sim.phase !== 'match-over' && guard++ < 60 * 3000) {
      bot.tick(DT); sim.step(DT); sim.drainEvents();
    }
    if (sim.phase !== 'match-over') R.stuck++;
    const S = sim.stats;
    R.pts += S.points[0] + S.points[1]; R.won += S.points[botIdx];
    R.rally += S.rallies.reduce((a, b) => a + b, 0);
    R.approaches += S.netApproaches[botIdx]; R.netPts += S.netPoints[botIdx]; R.netWon += S.netPointsWon[botIdx];
    R.aiWinners += S.winners[1 - botIdx] + S.aces[1 - botIdx]; R.botAces += S.aces[botIdx]; R.aiAces += S.aces[1 - botIdx];
    R.botDF += S.doubleFaults[botIdx]; R.aiDF += S.doubleFaults[1 - botIdx];
  }
  return R;
}
const pct = (R) => (100 * R.won / R.pts);
const ci = (R) => 196 * Math.sqrt((R.won / R.pts) * (1 - R.won / R.pts) / R.pts);

if (process.argv[1] && process.argv[1].endsWith('arcade_compete.mjs')) {
  const N = FAST ? 14 : 28;
  const target = { 0.2: 65, 0.5: 50, 0.8: 35, 1.0: 22 };
  const rows = [];
  const res = {};
  console.log('bot (reaction 250 ms, timing sigma 45 ms) vs AI, points won by the bot');
  console.log('bot         AI level   bot pts%   +-95%   (target)   rally   bot net pts/pt  net win%   matches  points   bot aces/DF  AI aces/DF');
  const line = (kind, lv, R, tgt) => {
    console.log(`${kind.padEnd(11)} ${lv.toFixed(2).padStart(7)}   ${f1(pct(R)).padStart(7)}  ${f1(ci(R)).padStart(6)}   ${(tgt ? String(tgt) : '-').padStart(6)}   ${f2(R.rally / R.pts).padStart(6)}   ${f2(R.netPts / R.pts).padStart(8)}      ${(100 * R.netWon / Math.max(1, R.netPts)).toFixed(0).padStart(5)}%   ${String(R.matches).padStart(6)}  ${String(R.pts).padStart(6)}   ${R.botAces}/${R.botDF}        ${R.aiAces}/${R.aiDF}`);
  };
  for (const lv of [0.2, 0.5, 0.8, 1.0]) {
    const R = compete({ kind: 'tactical', level: lv, n: N, seedBase: Math.round(lv * 10) + 1 });
    res['tactical' + lv] = R; line('tactical', lv, R, target[lv]);
  }
  for (const lv of [0.5, 0.8]) {
    const R = compete({ kind: 'random', level: lv, n: N, seedBase: 20 + Math.round(lv * 10) });
    res['random' + lv] = R; line('random', lv, R);
  }
  for (const lv of [0.5, 0.8]) {
    const R = compete({ kind: 'netAlways', level: lv, n: N, seedBase: 40 + Math.round(lv * 10) });
    res['netAlways' + lv] = R; line('netAlways', lv, R);
  }
  console.log('');
  for (const lv of [0.2, 0.5, 0.8, 1.0]) {
    const R = res['tactical' + lv];
    check(`level ${lv}: bot wins ~${target[lv]}% of points`, Math.abs(pct(R) - target[lv]) <= 6 + ci(R) * 0.5, `${f1(pct(R))}% +-${f1(ci(R))}`);
  }
  check('AI levels are monotone (higher level -> bot wins fewer points)', pct(res['tactical0.2']) > pct(res['tactical0.5']) && pct(res['tactical0.5']) > pct(res['tactical0.8']) && pct(res['tactical0.8']) > pct(res['tactical1']));
  for (const lv of [0.5, 0.8]) {
    const t = pct(res['tactical' + lv]), r = pct(res['random' + lv]);
    check(`tactics matter (level ${lv}): tactical bot beats the random-timing bot by >= 8 points`, t - r >= 8, `${f1(t)}% vs ${f1(r)}%`);
  }
  for (const lv of [0.5, 0.8]) {
    const t = pct(res['tactical' + lv]), r = pct(res['netAlways' + lv]);
    check(`always rushing the net is punished (level ${lv}): >= 8 points below the tactical bot`, t - r >= 8, `${f1(t)}% vs ${f1(r)}%`);
  }
  check('no stuck matches', Object.values(res).every((R) => R.stuck === 0));
  console.log(`\n(compete tests took ${((Date.now() - T0) / 1000).toFixed(1)} s)`);
  finish();
}
