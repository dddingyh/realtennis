// AI-vs-AI full matches for all style pairs at several levels: no stuck states, rally statistics.
// Run: node tests/arcade_match.mjs
import { ArcadeSim } from '../cartoon/src/sim/arcade.js';
import { STYLE_NAMES } from '../cartoon/src/sim/ai.js';
import { check, finish, mean, f1, f2 } from './arcade_util.mjs';

const T0 = Date.now();
const LEVELS = [0.25, 0.6, 0.9];
const FORMAT = { sets: 1, gamesPerSet: 4, tiebreak: true };

export function playMatch({ seed, styles, levels, hands = ['R', 'R'], format = FORMAT, surface = 'hard', maxSim = 5000 }) {
  const sim = new ArcadeSim({
    seed, timeScale: 1, surface, format, firstServer: seed % 2,
    players: [0, 1].map((i) => ({ human: false, hand: hands[i], name: 'AI' + i, ai: { level: levels[i], style: styles[i] } })),
  });
  let lastPoint = 0, stuck = null, pts = 0;
  const evs = { call: {} };
  while (sim.phase !== 'match-over' && sim.time < maxSim) {
    sim.step(1 / 60);
    for (const e of sim.drainEvents()) {
      if (e.type === 'point') { lastPoint = sim.time; pts++; }
      else if (e.type === 'call') evs.call[e.text] = (evs.call[e.text] || 0) + 1;
    }
    if (sim.time - lastPoint > 150) { stuck = `no point for 150 s (phase ${sim.phase}, rally ${sim.rl.shots}, ball ${sim.b.pos.x.toFixed(1)},${sim.b.pos.y.toFixed(1)},${sim.b.pos.z.toFixed(1)})`; break; }
  }
  return { sim, done: sim.phase === 'match-over', stuck, pts, time: sim.time, evs };
}

const agg = { points: 0, rally: 0, winners: 0, forced: 0, unforced: 0, aces: 0, df: 0, serves: 0, firstIn: 0, matches: 0, stuck: 0, incomplete: 0, srvPts: 0, srvWon: 0 };
const perStyle = {};
for (const s of STYLE_NAMES) perStyle[s] = { pts: 0, won: 0, approaches: 0, netPts: 0, netWon: 0, winners: 0, unforced: 0, rally: 0, aces: 0 };
const perLevel = {};
const dist = [];
let seed = 1;
const problems = [];

for (const lv of LEVELS) {
  perLevel[lv] = { points: 0, rally: 0, winners: 0, forced: 0, unforced: 0, aces: 0, df: 0, srvPts: 0, srvWon: 0 };
  for (const a of STYLE_NAMES) for (const b of STYLE_NAMES) {
    const r = playMatch({ seed: seed++, styles: [a, b], levels: [lv, lv], hands: [seed % 3 === 0 ? 'L' : 'R', 'R'] });
    agg.matches++;
    if (r.stuck) { agg.stuck++; problems.push(`${a} v ${b} @${lv}: ${r.stuck}`); }
    if (!r.done) { agg.incomplete++; if (!r.stuck) problems.push(`${a} v ${b} @${lv}: not finished at ${r.time.toFixed(0)} s`); }
    const S = r.sim.stats;
    const pts = S.points[0] + S.points[1];
    const L = perLevel[lv];
    for (const A of [agg, L]) {
      A.points += pts; A.rally += S.rallies.reduce((x, y) => x + y, 0);
      A.winners += S.winners[0] + S.winners[1] + S.aces[0] + S.aces[1];
      A.forced += S.forced[0] + S.forced[1]; A.unforced += S.unforced[0] + S.unforced[1];
      A.aces += S.aces[0] + S.aces[1]; A.df += S.doubleFaults[0] + S.doubleFaults[1];
    }
    for (const x of S.rallies) dist.push(x);
    [a, b].forEach((st, i) => {
      const P = perStyle[st];
      P.pts += S.points[0] + S.points[1]; P.won += S.points[i];
      P.approaches += S.netApproaches[i]; P.netPts += S.netPoints[i]; P.netWon += S.netPointsWon[i];
      P.winners += S.winners[i] + S.aces[i]; P.unforced += S.unforced[i]; P.aces += S.aces[i];
    });
  }
}

console.log(`${agg.matches} matches (${STYLE_NAMES.length * STYLE_NAMES.length} style pairs x levels ${LEVELS.join('/')}), ${agg.points} points, ${((Date.now() - T0) / 1000).toFixed(1)} s`);
check('every match completes without a stuck state', agg.stuck === 0 && agg.incomplete === 0, problems.slice(0, 3).join('; '));

const pc = (x, n) => (100 * x / n).toFixed(1).padStart(5) + '%';
console.log('\nby level          rally  winners  forced  unforced  aces   DF');
for (const lv of LEVELS) {
  const L = perLevel[lv];
  console.log(`  level ${lv.toFixed(2)}     ${f2(L.rally / L.points).padStart(6)}  ${pc(L.winners, L.points)}  ${pc(L.forced, L.points)}  ${pc(L.unforced, L.points)}  ${pc(L.aces, L.points)} ${pc(L.df, L.points)}`);
}
console.log(`  all             ${f2(agg.rally / agg.points).padStart(6)}  ${pc(agg.winners, agg.points)}  ${pc(agg.forced, agg.points)}  ${pc(agg.unforced, agg.points)}  ${pc(agg.aces, agg.points)} ${pc(agg.df, agg.points)}`);
dist.sort((x, y) => x - y);
console.log(`rally length (shots): median ${dist[dist.length >> 1]}, p10 ${dist[Math.floor(dist.length * 0.1)]}, p90 ${dist[Math.floor(dist.length * 0.9)]}, max ${dist[dist.length - 1]}`);

console.log('\nby style      points won%  approach/pt  net pts/pt  net-point win%  winners/pt  unforced/pt  aces/pt  rally');
for (const s of STYLE_NAMES) {
  const P = perStyle[s];
  console.log(`  ${s.padEnd(10)} ${pc(P.won, P.pts)}    ${f2(P.approaches / P.pts).padStart(8)}   ${f2(P.netPts / P.pts).padStart(8)}   ${pc(P.netWon, Math.max(1, P.netPts))}      ${f2(P.winners / P.pts).padStart(6)}   ${f2(P.unforced / P.pts).padStart(8)}   ${f2(P.aces / P.pts).padStart(6)}`);
}

const avgRally = agg.rally / agg.points;
check('average rally length is 5..9 shots', avgRally >= 5 && avgRally <= 9, f2(avgRally));
check('winners, forced and unforced errors are all substantial', agg.winners / agg.points > 0.12 && agg.forced / agg.points > 0.04 && agg.unforced / agg.points > 0.1, `${pc(agg.winners, agg.points)} / ${pc(agg.forced, agg.points)} / ${pc(agg.unforced, agg.points)}`);
check('aces occur but are not dominant', agg.aces / agg.points > 0.01 && agg.aces / agg.points < 0.12, pc(agg.aces, agg.points));
check('double faults occur but are not dominant', agg.df / agg.points > 0.005 && agg.df / agg.points < 0.10, pc(agg.df, agg.points));
const apr = (s) => perStyle[s].approaches / perStyle[s].pts;
check('net-rusher approaches far more often than the baseliner; attacker and trickster in between', apr('netrusher') > 2.2 * apr('baseliner') && apr('netrusher') > apr('attacker') && apr('attacker') > apr('baseliner') * 0.9, STYLE_NAMES.map((s) => `${s} ${f2(apr(s))}`).join(', '));
const nwin = (s) => perStyle[s].netWon / Math.max(1, perStyle[s].netPts);
check('net play is rewarded but not overpowered (net-point win rate 40..75% for net players)', nwin('netrusher') > 0.4 && nwin('netrusher') < 0.75, pc(perStyle.netrusher.netWon, perStyle.netrusher.netPts));
const wr = STYLE_NAMES.map((s) => perStyle[s].won / perStyle[s].pts);
check('no style dominates (points won 40..60%)', wr.every((x) => x > 0.4 && x < 0.6), wr.map((x) => (100 * x).toFixed(0)).join('/'));

// a longer format incl. sets, tiebreak and changeovers, left-handers, other surfaces
for (const [surface, fmt] of [['clay', { sets: 3, gamesPerSet: 2, tiebreak: true }], ['grass', { sets: 1, gamesPerSet: 0, tiebreak: true }], ['hard', { sets: 1, gamesPerSet: 3, tiebreak: true, shortGames: true }]]) {
  const r = playMatch({ seed: 900, styles: ['attacker', 'trickster'], levels: [0.7, 0.5], hands: ['L', 'R'], format: fmt, surface });
  check(`${surface} ${JSON.stringify(fmt)} completes`, r.done && r.sim.match.winner !== null, `${r.pts} points, ${r.time.toFixed(0)} s, ${r.sim.match.sets.map((s) => s.join('-')).join(' ')}`);
}

console.log(`\n(match tests took ${((Date.now() - T0) / 1000).toFixed(1)} s)`);
finish();
