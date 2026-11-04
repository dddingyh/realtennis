// AI-vs-AI full matches: completion, plausibility, determinism, style/level behaviour.
// Run: node tests/sim_ai.mjs
import { Simulation } from '../src/game/simulation.js';
import { COURT } from '../src/config.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 1) => x.toFixed(n);
const STYLES = ['grinder', 'aggressive', 'serveVolley', 'counter'];
const FAST = { pointOver: 0.1, changeover: 0.1, aiServeDelay: [0.1, 0.2], walkDelay: 0.02, faultHold: 0.05, matchOver: 0.1 };

function finite(sim) {
  const b = sim.state.ball;
  const vals = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin.x, b.spin.y, b.spin.z];
  for (const p of sim.state.players) vals.push(p.pos.x, p.pos.z, p.vel.x, p.vel.z, p.stamina, p.racketHead.x, p.racketHead.y, p.racketHead.z, p.anim.phase, p.anim.speed);
  return vals.every(Number.isFinite);
}

/** Run a match to completion; returns {sim, nan, maxPhase, hits:{...}, ev} */
function playMatch(opts, limit = 4000) {
  const sim = new Simulation({ aiPlayers: [true, true], timing: FAST, format: { sets: 1, gamesPerSet: 3, tiebreak: true }, ...opts });
  let nan = false, maxPhase = 0, lastPhase = sim.state.match.phase, lastChange = 0, maxPhaseName = '', n = 0;
  const kinds = [{}, {}], reasons = {};
  let ballOutOfBounds = false;
  while (sim.state.match.phase !== 'match-over' && sim.time < limit) {
    sim.step(1 / 120); n++;
    if (n % 10 === 0 && !finite(sim)) { nan = true; break; }
    const ph = sim.state.match.phase;
    if (ph !== lastPhase) { const d = sim.time - lastChange; if (d > maxPhase) { maxPhase = d; maxPhaseName = lastPhase; } lastPhase = ph; lastChange = sim.time; }
    if (Math.abs(sim.state.ball.pos.z) > 60 || Math.abs(sim.state.ball.pos.x) > 60) ballOutOfBounds = true;
    for (const e of sim.drainEvents()) {
      if (e.type === 'hit') kinds[e.by][e.shot] = (kinds[e.by][e.shot] || 0) + 1;
      if (e.type === 'point') reasons[e.reason] = (reasons[e.reason] || 0) + 1;
    }
  }
  return { sim, nan, maxPhase, maxPhaseName, kinds, reasons, ballOutOfBounds };
}

console.log('all 16 style pairings (1 set to 3 games, tiebreak)');
const agg = { pts: 0, aces: 0, df: 0, win: 0, ue: 0, fe: 0, shots: 0, fsIn: 0, fsTot: 0, longest: 0 };
const perStyle = Object.fromEntries(STYLES.map((s) => [s, { shots: 0, pts: 0, volley: 0, hits: 0, lob: 0, smash: 0, slice: 0, topspin: 0, flat: 0 }]));
let seed = 1000, allDone = true, anyNaN = false, worstPhase = 0, anyOOB = false;
const surfaces = ['hard', 'clay', 'grass'];
for (const a of STYLES) for (const b of STYLES) {
  const r = playMatch({ surface: surfaces[seed % 3], aiStyles: [a, b], aiLevels: [0.6, 0.6], seed: seed++ });
  const m = r.sim.state.match, s = m.stats, sum = (x) => x[0] + x[1];
  const done = m.phase === 'match-over' && (m.winner === 0 || m.winner === 1);
  allDone = allDone && done; anyNaN = anyNaN || r.nan; worstPhase = Math.max(worstPhase, r.maxPhase); anyOOB = anyOOB || r.ballOutOfBounds;
  agg.pts += s.totalPoints; agg.aces += sum(s.aces); agg.df += sum(s.doubleFaults); agg.win += sum(s.winners);
  agg.ue += sum(s.unforcedErrors); agg.fe += sum(s.forcedErrors); agg.shots += s.rallyShotsTotal; agg.fsIn += sum(s.firstServesIn); agg.fsTot += sum(s.firstServesTotal);
  agg.longest = Math.max(agg.longest, s.longestRally);
  for (const [i, st] of [[0, a], [1, b]]) {
    const ps = perStyle[st];
    for (const [k, v] of Object.entries(r.kinds[i])) { ps.hits += v; if (ps[k] !== undefined) ps[k] += v; }
    ps.pts += s.totalPoints / 2; ps.shots += s.rallyShotsTotal / 2;
  }
  console.log(`  ${a.padEnd(12)} vs ${b.padEnd(12)} ${r.sim.surfaceKey.padEnd(5)} ${done ? 'done' : 'NOT DONE'} sets ${JSON.stringify(m.sets)} pts ${String(s.totalPoints).padStart(3)} aces ${sum(s.aces)} df ${sum(s.doubleFaults)} avg rally ${f(s.rallyShotsTotal / s.totalPoints)} longest ${s.longestRally} t=${f(r.sim.time, 0)}s`);
}
const pc = (x) => (100 * x / agg.pts);
console.log(`  TOTAL ${agg.pts} points: avg rally ${f(agg.shots / agg.pts)} shots, aces ${f(pc(agg.aces))}%, double faults ${f(pc(agg.df))}%, winners ${f(pc(agg.win))}%, unforced ${f(pc(agg.ue))}%, forced ${f(pc(agg.fe))}%, 1st serve in ${f(100 * agg.fsIn / agg.fsTot, 0)}%, longest rally ${agg.longest}`);
check('every match ran to completion with a winner', allDone);
check('no NaN/Infinity in ball or player state', !anyNaN);
check('no stuck phase (longest single phase < 120 s of sim time)', worstPhase < 120, `${f(worstPhase)} s`);
check('ball never flies away to infinity', !anyOOB);
const avgRally = agg.shots / agg.pts;
check('rallies are several shots on average (3..14)', avgRally > 3 && avgRally < 14, f(avgRally));
check('no endless rallies', agg.longest < 150, `${agg.longest}`);
check('aces are rare but occur (0.5%..20%)', pc(agg.aces) > 0.5 && pc(agg.aces) < 20, f(pc(agg.aces)) + '%');
check('double faults are rare but occur (0.2%..12%)', pc(agg.df) > 0.2 && pc(agg.df) < 12, f(pc(agg.df)) + '%');
check('not all errors and not all winners', pc(agg.ue + agg.fe + agg.df) < 85 && pc(agg.ue + agg.fe) > 25 && pc(agg.win + agg.aces) > 8, `errors ${f(pc(agg.ue + agg.fe + agg.df))}% winners+aces ${f(pc(agg.win + agg.aces))}%`);
check('first-serve percentage plausible (45..90)', agg.fsIn / agg.fsTot > 0.45 && agg.fsIn / agg.fsTot < 0.9, f(100 * agg.fsIn / agg.fsTot, 0));

console.log('style signatures (per style, level 0.6)');
for (const s of STYLES) {
  const p = perStyle[s];
  console.log(`  ${s.padEnd(12)} avg rally ${f(p.shots / p.pts)}  shots: topspin ${p.topspin} flat ${p.flat} slice ${p.slice} volley ${p.volley} smash ${p.smash} lob ${p.lob}`);
}
const frac = (s, k) => perStyle[s][k] / perStyle[s].hits;
check('grinder is mostly topspin', frac('grinder', 'topspin') > 0.45);
check('aggressive hits the flattest ball', frac('aggressive', 'flat') > frac('grinder', 'flat') + 0.1 && frac('aggressive', 'flat') > frac('counter', 'flat'));
check('serve & volley volleys more than the baseliners', frac('serveVolley', 'volley') > frac('grinder', 'volley') + 0.01 && frac('serveVolley', 'volley') > frac('counter', 'volley'), `${f(100 * frac('serveVolley', 'volley'))}% vs ${f(100 * frac('grinder', 'volley'))}%`);
check('counter-puncher slices/defends more than the aggressive player', frac('counter', 'slice') > frac('aggressive', 'slice'));
check('aggressive rallies shorter than grinder/counter', perStyle.aggressive.shots / perStyle.aggressive.pts < perStyle.grinder.shots / perStyle.grinder.pts && perStyle.aggressive.shots / perStyle.aggressive.pts < perStyle.counter.shots / perStyle.counter.pts);

console.log('determinism');
{
  const a = playMatch({ aiStyles: ['aggressive', 'counter'], seed: 777 }), b = playMatch({ aiStyles: ['aggressive', 'counter'], seed: 777 }), c = playMatch({ aiStyles: ['aggressive', 'counter'], seed: 778 });
  const key = (r) => JSON.stringify([r.sim.state.match.stats, r.sim.state.match.sets, r.sim.time]);
  check('same seed => identical match', key(a) === key(b));
  check('different seed => different match', key(a) !== key(c));
}

console.log('level');
{
  let hi = 0, lo = 0;
  for (let k = 0; k < 6; k++) {
    const swap = k % 2;
    const r = playMatch({ aiStyles: ['grinder', 'grinder'], aiLevels: swap ? [0.1, 0.95] : [0.95, 0.1], seed: 300 + k, format: { sets: 1, gamesPerSet: 4, tiebreak: true } });
    const pw = r.sim.state.match.stats.pointsWon;
    hi += swap ? pw[1] : pw[0]; lo += swap ? pw[0] : pw[1];
  }
  check('level 0.95 beats level 0.1 clearly', hi > lo * 1.5, `${hi} - ${lo} points`);
  // reaction delay / prediction quality scale with level
  const s = new Simulation({ aiPlayers: [true, true], aiLevels: [0, 1] });
  check('AI reaction speed improves with level (via speed multiplier)', s.players[1].speedMul > s.players[0].speedMul);
}

console.log('adaptation and variety');
{
  // AI exploits the opponent's weaker side with its serve placement
  const countBackhandServes = (weaker) => {
    let bh = 0, n = 0;
    for (let k = 0; k < 60; k++) {
      const sim = new Simulation({ aiPlayers: [false, true], aiStyle: 'aggressive', seed: 50 + k, timing: FAST });
      sim.match.server = 1; sim._beginServePrep(true);
      for (const side of ['fh', 'bh']) { sim.sideStats[0][side].n = 40; sim.sideStats[0][side].err = side === weaker ? 20 : 2; }
      const p = sim.ais[1]._planServe();
      const box = sim.serveBox, opp = sim.players[0];
      const x = box.boxSign * 2.1 + 1.7 * p.aimX;
      if ((x - opp.pos.x) * opp.handX < 0) bh++;
      n++;
    }
    return bh / n;
  };
  const vsBh = countBackhandServes('bh'), vsFh = countBackhandServes('fh');
  check('AI serves more to the backhand when the backhand is the weaker side', vsBh > vsFh + 0.1, `${f(100 * vsBh, 0)}% vs ${f(100 * vsFh, 0)}%`);
  const sim = new Simulation({ aiPlayers: [false, true], aiStyle: 'serveVolley', seed: 9, timing: FAST });
  sim.match.server = 1; sim._beginServePrep(true);
  const kinds = new Set(), places = new Set();
  for (let k = 0; k < 60; k++) { const p = sim.ais[1]._planServe(); kinds.add(p.shot); places.add(p.aimX > 0.6 ? 'wide' : p.aimX < -0.6 ? 'T' : 'body'); }
  check('first serves vary in type and placement', kinds.size >= 2 && places.size === 3, `${[...kinds].join('/')} ${[...places].join('/')}`);
  sim.faultCount = 1;
  const second = new Set(); let slow = true;
  for (let k = 0; k < 40; k++) { const p = sim.ais[1]._planServe(); second.add(p.shot); if (p.power > 0.75) slow = false; }
  check('second serves are safer (spin, less power)', slow && !second.has('flat'), [...second].join('/'));
}

console.log('tactics');
{
  // recovery positioning: back toward the middle of the court before the opponent hits
  const sim = new Simulation({ aiPlayers: [true, true], aiStyles: ['grinder', 'counter'], aiLevels: [0.7, 0.7], seed: 12, timing: FAST, format: { sets: 1, gamesPerSet: 5, tiebreak: true } });
  let own = [], opp = [], last = -1;
  while (sim.state.match.phase !== 'match-over' && sim.time < 2500) {
    sim.step(1 / 120);
    for (const e of sim.drainEvents()) if (e.type === 'hit' && !e.serve) {
      const x = Math.abs(sim.players[0].pos.x);
      if (e.by === 0) own.push(x); else if (last === 0) opp.push(x);
      last = e.by;
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  check('AI recovers toward the centre after its own shot', mean(opp) < mean(own) * 0.6, `|x| at own hit ${f(mean(own), 2)} -> at opponent hit ${f(mean(opp), 2)} (${own.length} shots)`);

  // decision making: net rusher => lob or passing shot away from the net player; defend when stretched; attack short balls
  const mkDecide = (style, setup) => {
    const s2 = new Simulation({ aiPlayers: [false, true], aiStyle: style, aiLevel: 0.9, seed: 31, timing: FAST });
    const ai = s2.ais[1], me = s2.players[1], opp = s2.players[0];
    s2._setPhase('rally');
    setup(s2, me, opp);
    return { s2, ai, me, opp };
  };
  const sample = (style, setup, geoOver = {}, n = 120) => {
    const out = { lob: 0, topspin: 0, flat: 0, slice: 0, n, aimAway: 0, power: 0, depth: 0 };
    for (let k = 0; k < n; k++) {
      const { s2, ai, me, opp } = mkDecide(style, setup);
      s2.rngAI.s = 9000 + k * 7919;
      const geo = { latAbs: 0.8, lat: 0.8, ...geoOver };
      const d = ai._decide(geo);
      out[d.shot]++; out.power += d.power / n; out.depth += (d.aimDepth ?? 0) / n;
      if (opp.pos.x !== 0 && Math.sign(d.aimX) === -Math.sign(opp.pos.x)) out.aimAway++;
    }
    return out;
  };
  const atNet = (s2, me, opp) => { me.pos.x = 1; me.pos.z = -12.8; opp.pos.x = 1.5; opp.pos.z = 3.0; const b = s2.ball; b.pos.x = 1.8; b.pos.y = 1.0; b.pos.z = -12.0; b.vel.x = 0; b.vel.y = 0; b.vel.z = -18; b.bounces = 1; };
  const rushC = sample('counter', atNet), rushG = sample('grinder', atNet);
  check('counter-puncher lobs or passes when the opponent rushes the net', rushC.lob > 6 || (rushC.lob + rushC.flat + rushC.topspin) > 100, `lobs ${rushC.lob}/${rushC.n}`);
  check('counter lobs more than the grinder against a net rusher', rushC.lob > rushG.lob, `${rushC.lob} vs ${rushG.lob}`);
  check('passing shots go away from the net player', rushC.aimAway > rushC.n * 0.7, `${rushC.aimAway}/${rushC.n}`);
  const baseline = (s2, me, opp) => { me.pos.x = 0; me.pos.z = -12.6; opp.pos.x = -3; opp.pos.z = 13; const b = s2.ball; b.pos.x = 0.5; b.pos.y = 0.9; b.pos.z = -12.0; b.vel.x = 0; b.vel.y = 0; b.vel.z = -20; b.bounces = 1; };
  const neutral = sample('grinder', baseline);
  check('neutral rally ball: opponent out of position -> aim to open court (away from his side)', neutral.aimAway > neutral.n * 0.6, `${neutral.aimAway}/${neutral.n}`);
  const wide = sample('grinder', baseline, { latAbs: 1.7, lat: 1.7 });
  check('stretched wide: defensive reply (low power, slice/lob/high topspin)', wide.power < neutral.power - 0.1 && wide.depth > 0.3, `power ${f(wide.power, 2)} vs ${f(neutral.power, 2)}`);
  const shortBall = (s2, me, opp) => { me.pos.x = 0; me.pos.z = -8.0; opp.pos.x = -2.0; opp.pos.z = 14; const b = s2.ball; b.pos.x = 0.8; b.pos.y = 1.0; b.pos.z = -7.5; b.vel.x = 0; b.vel.y = 0; b.vel.z = -10; b.bounces = 1; };
  const atk = sample('aggressive', shortBall);
  check('aggressive takes a short ball with a flat shot to the open court', atk.flat > atk.n * 0.5 && atk.aimAway > atk.n * 0.7, `flat ${atk.flat}/${atk.n}, open court ${atk.aimAway}/${atk.n}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
