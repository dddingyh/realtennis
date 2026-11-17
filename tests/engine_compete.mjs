// Calibration: a scripted "human-like" bot versus the AI at several levels, and proof that tactics matter.
// Bot: reaction 250 ms (real), timing error sigma 45 ms around its intended timing, noisy power, simple tactics.
// Run: node tests/engine_compete.mjs        (env ARCADE_FAST=1 halves the sample sizes)
import { ArcadeSim } from '../cartoon/src/engine/sim.js';
import { STYLE_NAMES } from '../cartoon/src/engine/ai.js';
import { RNG } from '../src/game/rng.js';
import { check, finish, f1, f2 } from './engine_util.mjs';

const T0 = Date.now();
const FAST = !!process.env.ARCADE_FAST;
const TS = 0.8;                       // real game default
const DT = 1 / 60;

/** Human-like bot controlling player `i` through the public API only (plus the planned contact geometry a human sees). */
export class Bot {
  /** kind: 'tactical' (baseline, stays back) | 'selective' (rushes the net only behind good opportunities) | 'random' | 'netAlways' */
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
    const ownHint = hint.i === i;
    const plan0 = sim.P[i].plan;
    const contactIn = ownHint ? hint.contactIn : (plan0 && !plan0.swing && !plan0.expired && sim.time <= plan0.tContact + 0.3 ? (plan0.tContact - sim.time) / sim.timeScale : null);
    this.hitAt = null;
    if (st.match.phase !== 'rally') { this.sched = null; return; }
    if (this.kind === 'netAlways' && me.zone === 'base' && !sim.P[i].wantNet) sim.setNet(i, true);
    const key = st.rally.shots + ':' + st.rally.lastHitTime;
    if (key !== this.key) { this.key = key; this.sched = null; this.seenAt = this.real; this.decided = false; }
    if (contactIn === null || contactIn === undefined) { return; }
    if (!this.decided) {
      if (this.real < this.seenAt + this.reaction) return;
      this.decided = true;
      const plan = sim.P[i].plan;
      let shot = 'topspin', power = Math.min(1, Math.max(0.1, 0.58 + rng.gauss(0, 0.12))), aimX;
      const oppX = opp.pos.x, oppAtNet = opp.zone === 'net' || (opp.zone === 'toNet' && Math.abs(opp.pos.z) < 7);
      if (this.kind === 'random') {
        const off = rng.range(-200, 200);
        this.sched = { at: this.real + contactIn + off / 1000 / TS, shot: rng.pick(['topspin', 'topspin', 'flat', 'slice']), power };
        return;
      }
      const Pc = plan ? plan.P : { x: 0, z: 11, y: 1 };
      const landing = sim.predict(i).landing, landZ = landing ? Math.abs(landing.z) : 12;       // where the incoming ball bounces (m from the net)
      const short = landZ < 9.0 && Pc.y > 0.45;
      if (this.kind === 'xcourtChange') {
        // strategy bots: rally cross-court (back along the incoming line); change direction only on short balls
        if (short) { aimX = -Math.sign(oppX || (rng.chance(0.5) ? 1 : -1)) * 2.4; power = 0.84 + rng.gauss(0, 0.05); }
        else { aimX = -Math.sign(Pc.x || 1) * 2.1; power = 0.58 + rng.gauss(0, 0.1); }
        shot = 'topspin';
      } else if (this.kind === 'changeAll') {
        aimX = Math.sign(Pc.x || (rng.chance(0.5) ? 1 : -1)) * 2.4; power = 0.62 + rng.gauss(0, 0.1); shot = 'topspin';     // changes direction (down the line) off every ball
      } else if (this.kind === 'wideOpen') {
        if (Math.abs(oppX) > 1.5) { aimX = -Math.sign(oppX) * 2.0; power = 0.72 + rng.gauss(0, 0.06); }                       // open court
        else { aimX = -Math.sign(Pc.x || 1) * 2.3; power = 0.62 + rng.gauss(0, 0.08); }                                         // pull him wide
        shot = 'topspin';
      } else if (this.kind === 'middle') { aimX = rng.range(-0.6, 0.6); power = 0.6 + rng.gauss(0, 0.08); shot = 'topspin'; }
      else if (oppAtNet && Math.abs(opp.pos.z) < 5 && rng.chance(0.55)) { shot = 'lob'; power = 0.78 + rng.gauss(0, 0.05); aimX = Math.abs(oppX) > 0.8 ? -Math.sign(oppX) * 1.6 : rng.pick([-1.6, 1.6]); }
      else if (oppAtNet) { shot = rng.chance(0.5) ? 'flat' : 'topspin'; power = 0.72 + rng.gauss(0, 0.08); aimX = Math.abs(oppX) > 0.5 ? -Math.sign(oppX) * 2.0 : rng.pick([-2.0, 2.0]); }
      else {
        aimX = Math.abs(oppX) > 0.9 ? -Math.sign(oppX) * 1.8 : rng.pick([-1.5, 1.5]);
        if (Math.abs(oppX) > 1.3) power = 0.82 + rng.gauss(0, 0.07);
        const u = rng.next();
        if (u < 0.15) shot = 'slice'; else if (u < 0.28) shot = 'flat';
      }
      if (this.kind === 'selective' && me.zone === 'base' && plan && plan.margin > 0.25 && !oppAtNet) {
        // approach only behind a good opportunity: a short ball from the opponent, or a shot that has pulled him wide
        const pulled = Math.abs(oppX) > 1.2;                                         // approach only behind a short ball that finds him out of position
        if (short && pulled) { this.apKind = 'SP'; sim.setNet(i, true); shot = 'topspin'; power = 0.86 + rng.gauss(0, 0.04); aimX = -Math.sign(oppX || (rng.chance(0.5) ? 1 : -1)) * (short ? 2.5 : 2.3); }
      }
      const intended = sim.timingForAim(i, aimX);                      // ms (sim time)
      const err = rng.gauss(0, this.sigma * 1000);
      this.sched = { at: this.real + contactIn + (intended + err) / 1000 / TS, shot, power: Math.min(1, Math.max(0.05, power)) };
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
    const sv = sim.sv, tossUp = hint.i === i ? hint.tossUp : (sv.stage === 'raise' || sv.stage === 'flight');
    const cIn = hint.i === i ? hint.contactIn : Math.max(0, (sv.tIdeal - sim.time) / sim.timeScale);
    if (!tossUp) {
      if (this.tossAt === null) this.tossAt = this.real + 0.4 + rng.next() * 0.4;      // (re-)arm, e.g. after a caught toss
      if (this.real >= this.tossAt) { this.tossAt = null; sim.swing(i, {}); }
      return;
    }
    if (this.hitAt === null) {
      const g = sim._serveGeom(sim.P[i]);
      const first = st.match.faultCount === 0;
      const x = this.kind === 'random' ? g.cx + rng.range(-1.6, 1.6) : g.boxSign * rng.pick([0.8, 3.1, 2.0, 3.2]);
      const off = this.kind === 'random' ? rng.range(-120, 120) : sim.serveTimingForAim(i, x);
      this.hitAt = this.real + cIn + (off + rng.gauss(0, this.sigma * 1000)) / 1000 / TS;
      this.power = first ? Math.min(1, 0.85 + rng.gauss(0, 0.06)) : 0.55;
      if (this.kind === 'netAlways') sim.setNet(i, true);
    }
    if (this.real >= this.hitAt) { sim.swing(i, { power: this.power, source: 'keyboard' }); this.hitAt = null; }
  }
}

/** Play `n` short matches (bot = player 0 or 1 alternately) against the AI; returns aggregate stats. */
export function compete({ kind, level, n, seedBase = 1, styles = STYLE_NAMES, format = { sets: 1, gamesPerSet: 3, tiebreak: true }, botOpts = {} }) {
  const R = { pts: 0, won: 0, rally: 0, approaches: 0, netPts: 0, netWon: 0, aiWinners: 0, aiAces: 0, botAces: 0, botDF: 0, aiDF: 0, matches: n, stuck: 0, swings: 0, whiffs: 0, whiffReach: 0, botErr: 0, botOut: 0, apN: 0, apW: 0 };
  for (let m = 0; m < n; m++) {
    const botIdx = m % 2, style = styles[m % styles.length];
    const players = [0, 1].map((k) => (k === botIdx ? { human: true, hand: 'R', name: 'bot' } : { human: false, hand: m % 3 === 0 ? 'L' : 'R', name: 'AI', ai: { level, style } }));
    const sim = new ArcadeSim({ seed: seedBase * 1000 + m, timeScale: TS, format, players, firstServer: (m >> 1) % 2 });
    const bot = new Bot(sim, botIdx, kind, seedBase * 77 + m, botOpts);
    let guard = 0;
    while (sim.phase !== 'match-over' && guard++ < 60 * 3000) {
      bot.tick(DT); sim.step(DT);
      for (const e of sim.drainEvents()) {
        if (e.type === 'hit' && e.by === botIdx && !e.serve) R.swings++;
        else if (e.type === 'whiff' && e.by === botIdx && e.reason !== 'toss' && e.reason !== 'serve') { R.swings++; if (e.reason === 'reach') R.whiffReach++; else R.whiffs++; }
        else if (e.type === 'point') {
          if (e.winner !== botIdx && (e.reason === 'out' || e.reason === 'net')) R.botErr++;
          if (bot.apKind && sim.P[botIdx].approachThisPoint) { const T = (R.ap = R.ap || {}); const t = (T[bot.apKind] = T[bot.apKind] || [0, 0]); t[0]++; R.apN++; if (e.winner === botIdx) { t[1]++; R.apW++; } }
          bot.apKind = null;
        }
      }
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
/** Head-to-head: bot A (player 0 / 1 alternately) against bot B, both human-like (same timing noise). Returns A's point share. */
export function duel(kindA, kindB, n, seedBase = 1, format = { sets: 1, gamesPerSet: 3, tiebreak: true }) {
  const R = { pts: 0, wonA: 0, rally: 0, stuck: 0 };
  for (let m = 0; m < n; m++) {
    const a = m % 2;
    const sim = new ArcadeSim({ seed: seedBase * 1000 + m, timeScale: TS, format, players: [{ human: true, hand: 'R', name: 'A' }, { human: true, hand: 'R', name: 'B' }], firstServer: (m >> 1) % 2 });
    const bots = [null, null];
    bots[a] = new Bot(sim, a, kindA, seedBase * 31 + m); bots[1 - a] = new Bot(sim, 1 - a, kindB, seedBase * 53 + m);
    let guard = 0;
    while (sim.phase !== 'match-over' && guard++ < 60 * 3000) { bots[0].tick(DT); bots[1].tick(DT); sim.step(DT); sim.drainEvents(); }
    if (sim.phase !== 'match-over') R.stuck++;
    const S = sim.stats;
    R.pts += S.points[0] + S.points[1]; R.wonA += S.points[a]; R.rally += S.rallies.reduce((x, y) => x + y, 0);
  }
  return R;
}
const pct = (R) => (100 * R.won / R.pts);
const ci = (R) => 196 * Math.sqrt((R.won / R.pts) * (1 - R.won / R.pts) / R.pts);

if (process.argv[1] && process.argv[1].endsWith('engine_compete.mjs')) {
  const N = FAST ? 10 : 16;
  const target = { 0.2: 65, 0.5: 50, 0.65: 0, 0.8: 35, 1.0: 22 };
  const res = {};
  console.log('bot (reaction 250 ms, timing sigma 45 ms) vs AI, points won by the bot');
  console.log('bot         AI level   bot pts%   +-95%   (target)   rally   whiff%   bot net pts/pt  net win%   matches  points   bot aces/DF  AI aces/DF');
  const line = (kind, lv, R, tgt) => {
    console.log(`${kind.padEnd(11)} ${lv.toFixed(2).padStart(7)}   ${f1(pct(R)).padStart(7)}  ${f1(ci(R)).padStart(6)}   ${(tgt ? String(tgt) : '-').padStart(6)}   ${f2(R.rally / R.pts).padStart(6)}   ${f1(100 * R.whiffs / Math.max(1, R.swings)).padStart(5)}   ${f2(R.netPts / R.pts).padStart(8)}      ${(100 * R.netWon / Math.max(1, R.netPts)).toFixed(0).padStart(5)}%   ${String(R.matches).padStart(6)}  ${String(R.pts).padStart(6)}   ${R.botAces}/${R.botDF}        ${R.aiAces}/${R.aiDF}`);
  };
  for (const lv of [0.2, 0.5, 0.65, 0.8, 1.0]) {
    const R = compete({ kind: 'tactical', level: lv, n: lv === 0.5 ? 2 * N : lv === 0.65 ? Math.round(N / 2) : N, seedBase: Math.round(lv * 10) + 1 });
    res['tactical' + lv] = R; line('tactical', lv, R, target[lv]);
  }
  for (const lv of [0.5, 0.8]) {
    const R = compete({ kind: 'random', level: lv, n: N, seedBase: 20 + Math.round(lv * 10) });
    res['random' + lv] = R; line('random', lv, R);
  }
  {
    const R = compete({ kind: 'selective', level: 0.5, n: FAST ? 30 : 48, seedBase: 61 });
    res.selective0_5 = R; line('selective', 0.5, R);
  }
  for (const lv of [0.5, 0.8]) {
    const R = compete({ kind: 'netAlways', level: lv, n: lv === 0.5 ? 2 * N : Math.round(N / 2), seedBase: 40 + Math.round(lv * 10) });
    res['netAlways' + lv] = R; line('netAlways', lv, R);
  }
  console.log('\nstrategy duels (both sides human-like, same timing noise; A\'s share of the points)');
  const M = FAST ? 32 : 44;
  const dA = duel('xcourtChange', 'changeAll', M, 3), dB = duel('wideOpen', 'middle', M, 5);
  const share = (d) => 100 * d.wonA / d.pts, dci = (d) => 196 * Math.sqrt(0.25 / d.pts);
  console.log(`  cross-court, change direction on short balls  vs  change direction on every ball : ${f1(share(dA))}% (+-${f1(dci(dA))}, ${dA.pts} pts, rally ${f2(dA.rally / dA.pts)})`);
  console.log(`  pull wide then open court                      vs  hit to the middle            : ${f1(share(dB))}% (+-${f1(dci(dB))}, ${dB.pts} pts, rally ${f2(dB.rally / dB.pts)})`);
  console.log('');
  for (const lv of [0.2, 0.5, 0.8, 1.0]) {
    const R = res['tactical' + lv];
    check(`level ${lv}: bot wins ~${target[lv]}% of points`, Math.abs(pct(R) - target[lv]) <= 7 + ci(R) * 0.5, `${f1(pct(R))}% +-${f1(ci(R))}`);
  }
  check('AI levels are monotone (higher level -> bot wins fewer points)', pct(res['tactical0.2']) > pct(res['tactical0.5']) && pct(res['tactical0.5']) > pct(res['tactical0.8']) && pct(res['tactical0.8']) > pct(res['tactical1']));
  {
    const R = res['tactical0.5'], rl = R.rally / R.pts;
    check('mean rally length at level 0.5 is 6-10 shots (incl. serve)', rl >= 6 && rl <= 10, f2(rl));
    const wp = 100 * R.whiffs / R.swings;
    check('timing whiffs (early / late) < 3 % of the bot swings (sigma 45 ms); balls out of reach are counted separately', wp < 3, `${f1(wp)}% (+ ${f1(100 * R.whiffReach / R.swings)}% unreachable)`);
    check('most of the bot\'s lost points are errors off power / edges / direction, not timing whiffs', R.whiffs < 0.15 * R.botErr, `${R.whiffs} timing whiffs vs ${R.botErr} out/net errors`);
  }
  for (const lv of [0.5, 0.8]) {
    const t = pct(res['tactical' + lv]), r = pct(res['random' + lv]);
    const need = lv >= 0.8 ? 3 : 8;
    check(`tactics matter (level ${lv}): tactical bot beats the random-timing bot by >= ${need} points`, t - r >= need, `${f1(t)}% vs ${f1(r)}%`);
  }
  check('(a) cross-court + change direction on short balls beats changing direction on every ball by >= 6 points', share(dA) - (100 - share(dA)) >= 6, `${f1(share(dA))}% vs ${f1(100 - share(dA))}%`);
  check('(b) pulling the opponent wide then hitting the open court beats hitting to the middle', share(dB) >= 50.5, `${f1(share(dB))}%`);
  {
    const S = res.selective0_5, T = res['tactical0.5'], A = res['netAlways0.5'];
    check('(c) always rushing the net is punished: below the non-net tactical bot', pct(T) - pct(A) >= 2, `${f1(pct(A))}% vs ${f1(pct(T))}%`);
    for (const lv of [0.5, 0.8]) { const X = res['netAlways' + lv]; check(`(c) blind net rush wins only 33..52% of its net points (level ${lv})`, 100 * X.netWon / X.netPts <= 52 && 100 * X.netWon / X.netPts >= 33, `${f1(100 * X.netWon / X.netPts)}%`); }
    const sNet = 100 * S.apW / Math.max(1, S.apN);
    console.log(`  selective bot: ${S.apN} approaches behind short balls that found the AI out of position, won ${f1(sNet)}% of those points (all points with any net presence: ${f1(100 * S.netWon / S.netPts)}% of ${S.netPts})`);
    check('(c) good-opportunity net rush (approach behind a short ball) wins >= 54% of its net points (level 0.5; spec 58%, n is small)', sNet >= 54, `${f1(sNet)}% of ${S.apN}`);
    check('(c) ...and its overall points are at least those of the non-net tactical bot', pct(S) >= pct(T) - ci(T) * 0.6, `${f1(pct(S))}% vs ${f1(pct(T))}%`);
    check('(c) good net rush beats blind net rush by >= 4 points of net-point win rate', sNet - 100 * A.netWon / A.netPts >= 4, `${f1(sNet)}% vs ${f1(100 * A.netWon / A.netPts)}%`);
  }
  // (d) AI vs AI: all style pairs complete
  {
    let stuck = 0, rallies = [], pairs = 0, ok = true;
    const rows = [];
    for (const sa of STYLE_NAMES) for (const sb of STYLE_NAMES) {
      const sim = new ArcadeSim({ seed: 900 + pairs, timeScale: TS, format: { sets: 1, gamesPerSet: 2, tiebreak: true }, players: [{ human: false, hand: 'R', ai: { level: 0.6, style: sa } }, { human: false, hand: pairs % 2 ? 'L' : 'R', ai: { level: 0.6, style: sb } }] });
      let g = 0;
      while (sim.phase !== 'match-over' && g++ < 60 * 3000) { sim.step(DT); sim.drainEvents(); }
      pairs++;
      if (sim.phase !== 'match-over') stuck++;
      const S = sim.stats, rl = S.rallies.reduce((a, b) => a + b, 0) / S.rallies.length;
      rallies.push(rl);
      rows.push(`${sa.slice(0, 4)}-${sb.slice(0, 4)} ${f1(rl)}`);
    }
    console.log('  AI vs AI (level 0.6) mean rally per style pair: ' + rows.join('  '));
    check('(d) AI vs AI: all 16 style pairs complete a match', stuck === 0 && pairs === 16, `${pairs} pairs, ${stuck} stuck`);
    const mr = rallies.reduce((a, b) => a + b, 0) / rallies.length;
    check('(d) AI vs AI rallies are healthy (mean 4-14 shots)', mr >= 4 && mr <= 14, f2(mr));
  }
  check('no stuck matches', Object.values(res).every((R) => R.stuck === 0));
  console.log(`\n(compete tests took ${((Date.now() - T0) / 1000).toFixed(1)} s)`);
  finish();
}
