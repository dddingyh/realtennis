// Scoring + rules tests. Run: node tests/sim_match.mjs
import { Match } from '../src/game/match.js';
import { Simulation } from '../src/game/simulation.js';
import { COURT } from '../src/config.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const win = (m, i, n = 1) => { let r; for (let k = 0; k < n; k++) r = m.pointWon(i); return r; };

console.log('scoring');
{
  const m = new Match({ sets: 1, gamesPerSet: 6, tiebreak: true }, 0);
  check('starts 0-0 deuce court, server 0', m.pointText === '0-0' && m.serveCourt === 'deuce' && m.server === 0);
  win(m, 0); check('15-0 and ad court', m.pointText === '15-0' && m.serveCourt === 'ad');
  win(m, 1); win(m, 0); check('30-15', m.pointText === '30-15' && m.serveCourt === 'ad');
  win(m, 0); check('40-15', m.pointText === '40-15');
  const r = win(m, 0);
  check('game to 0 player: games 1-0, server rotates, text GAME', r.gameWon && m.games[0] === 1 && m.server === 1 && r.text === 'GAME' && m.pointText === '0-0');
  check('changeover after first game (odd)', r.changeover === true);

  const d = new Match({}, 0);
  win(d, 0, 3); win(d, 1, 3);
  check('deuce', d.pointText === 'DEUCE');
  win(d, 0); check('AD IN when server leads', d.pointText === 'AD IN');
  win(d, 1); check('back to deuce', d.pointText === 'DEUCE');
  win(d, 1); check('AD OUT when receiver leads', d.pointText === 'AD OUT');
  win(d, 1); check('receiver breaks (game)', d.games[1] === 1 && d.server === 1);

  // set to 6-4, no tiebreak needed
  const s = new Match({ sets: 1, gamesPerSet: 6, tiebreak: true }, 0);
  let res;
  for (const g of [0, 1, 0, 1, 0, 1, 0, 1, 0, 0]) res = win(s, g, 4);
  check('6-4 wins the set and the match', s.winner === 0 && res.matchWon && s.sets[0][0] === 6 && s.sets[0][1] === 4);

  // 7-5
  const s2 = new Match({ sets: 1, gamesPerSet: 6, tiebreak: true }, 0);
  for (const g of [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]) win(s2, g, 4);   // 5-5
  win(s2, 0, 4); check('6-5 not over', s2.winner === null && !s2.isTiebreak);
  win(s2, 0, 4); check('7-5 wins', s2.winner === 0 && s2.sets[0][0] === 7);

  // tiebreak
  const t = new Match({ sets: 1, gamesPerSet: 6, tiebreak: true }, 0);
  for (let g = 0; g < 6; g++) { win(t, 0, 4); win(t, 1, 4); }       // 6-6 with alternation
  check('6-6 starts a tiebreak', t.isTiebreak && t.games[0] === 6 && t.games[1] === 6);
  const firstServer = t.server;
  const servers = [], courts = [];
  for (let k = 0; k < 6; k++) { servers.push(t.server); courts.push(t.serveCourt); win(t, k % 2); }
  check('tiebreak server pattern 1,2,2,1,1,...', servers.join('') === [firstServer, 1 - firstServer, 1 - firstServer, firstServer, firstServer, 1 - firstServer].join(''), servers.join(''));
  check('tiebreak courts alternate deuce/ad', courts.join(',') === 'deuce,ad,deuce,ad,deuce,ad', courts.join(','));
  check('tiebreak score text', /^\d+-\d+$/.test(t.pointText), t.pointText);
  // currently 3-3
  win(t, 0, 3); // 6-3
  win(t, 1, 3); // 6-6
  check('tiebreak not over at 6-6', t.winner === null);
  win(t, 0); check('tiebreak 7-6 is not enough', t.winner === null);
  win(t, 1); win(t, 0); check('8-7 not enough', t.winner === null);
  const rr = win(t, 0);
  check('tiebreak ends 9-7 (win by two)', t.winner === 0 && rr.matchWon && t.sets[0][0] === 7 && t.sets[0][1] === 6);

  // best of three, server of next set after tiebreak
  const b3 = new Match({ sets: 3, gamesPerSet: 6, tiebreak: true }, 0);
  for (let g = 0; g < 6; g++) { win(b3, 0, 4); win(b3, 1, 4); }
  const tbFirst = b3.server;
  win(b3, 0, 7);
  check('set 1 to player 0 by tiebreak, match continues', b3.setsWon[0] === 1 && b3.winner === null && b3.games[0] === 0);
  check('next set is served by the player who received first in the tiebreak', b3.server === 1 - tbFirst, `tbFirst ${tbFirst}, next ${b3.server}`);
  for (let g = 0; g < 6; g++) win(b3, 1, 4);
  check('1-1 in sets after a 6-0 set', b3.setsWon[1] === 1 && b3.winner === null);
  for (let g = 0; g < 6; g++) win(b3, 0, 4);
  check('best of 3 decided 2-1', b3.winner === 0 && b3.setsWon[0] === 2);

  // single tiebreak format
  const only = new Match({ sets: 1, gamesPerSet: 0, tiebreak: true }, 1);
  check('gamesPerSet 0 => starts in tiebreak', only.isTiebreak && only.server === 1);
  win(only, 1, 7); check('tiebreak-only match ends 7-0', only.winner === 1);

  // short games (no-ad), short sets
  const sg = new Match({ sets: 1, gamesPerSet: 4, tiebreak: true, shortGames: true }, 0);
  win(sg, 0, 3); win(sg, 1, 3); check('no-ad 40-40 text', sg.pointText === '40-40');
  const x = win(sg, 1); check('no-ad: next point decides the game', x.gameWon && sg.games[1] === 1);

  // changeovers: after odd games
  const co = new Match({}, 0); const flags = [];
  for (let g = 0; g < 5; g++) flags.push(win(co, g % 2, 4).changeover);
  check('changeover after games 1,3,5 only', flags.join() === 'true,false,true,false,true', flags.join());
}

console.log('rules in the simulation (scripted)');
const fast = { pointOver: 0.2, changeover: 0.2, aiServeDelay: [0.1, 0.1], walkDelay: 0.02, faultHold: 0.1, matchOver: 0.2 };
function mk(over = {}) {
  return new Simulation({ aiPlayers: [false, false], autoMove: ['off', 'off'], seed: 3, timing: fast, shotOpts: { forceQuality: 1, noError: true }, ...over });
}
function runUntil(sim, pred, maxT = 20) {
  const ev = [];
  for (let t = 0; t < maxT * 120; t++) { sim.step(1 / 120); for (const e of sim.drainEvents()) ev.push(e); if (pred(sim, ev)) break; }
  return ev;
}
function startServe(sim, params = {}) {
  runUntil(sim, (s) => s.canServe(s.match.server), 8);
  const i = sim.match.server;
  sim.serveToss(i);
  runUntil(sim, (s) => s.toss && s.toss.t >= 0.63, 3);
  sim.swing(i, { shot: 'flat', power: 0.8, aimX: 0, aimDepth: 0.3, source: 'keyboard', ...params });
  return i;
}
{
  // good serve, receiver does nothing -> ace
  const sim = mk(); const i = startServe(sim);
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'point'), 6);
  const pt = ev.find((e) => e.type === 'point');
  check('untouched serve in the box is an ace', pt && pt.reason === 'ace' && pt.winner === i, JSON.stringify(pt));
  check('ace counted in stats and score 15-0', sim.state.match.stats.aces[i] === 1 && sim.state.match.points[i] === 1 && sim.state.match.pointText === '15-0');
  const serveEv = ev.find((e) => e.type === 'serve');
  check('serve event with speed', serveEv && serveEv.speedKmh > 100, serveEv && serveEv.speedKmh.toFixed(0));
  check('phase events: rally, point-over', ['rally', 'point-over'].every((p) => ev.some((e) => e.type === 'phase' && e.phase === p)));
  runUntil(sim, (s) => s.state.match.phase === 'serve-prep', 6);
  check('next point is served from the ad court', sim.state.match.serveCourt === 'ad' && sim.state.match.server === i);
  const srv = sim.state.players[i], rcv = sim.state.players[1 - i];
  runUntil(sim, (s) => s.canServe(i), 8);
  check('server stands at the baseline on the ad side, receiver diagonally opposite',
    Math.abs(Math.abs(srv.pos.z) - (COURT.halfLength + 0.45)) < 0.3 && Math.sign(srv.pos.x) === (i === 0 ? -1 : 1) && Math.sign(rcv.pos.x) === -Math.sign(srv.pos.x),
    `server (${srv.pos.x.toFixed(2)},${srv.pos.z.toFixed(2)}) receiver (${rcv.pos.x.toFixed(2)},${rcv.pos.z.toFixed(2)})`);
}
{
  // serve into the wrong place -> FAULT, then double fault
  const sim = mk(); const i = startServe(sim, { aimX: 0, aimDepth: 0.3 });
  // redirect the ball so it lands long (outside the box)
  runUntil(sim, (s) => s.ball.inPlay, 1);
  sim.ball.vel.z *= 1.0; sim.ball.vel.y += 6;                        // pop it up -> lands far too deep
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'call'), 6);
  check('serve landing outside the box is a FAULT', ev.some((e) => e.type === 'call' && e.text === 'FAULT') && sim.state.match.faultCount === 1);
  check('server gets a second serve (same court)', runUntil(sim, (s) => s.state.match.phase === 'serve-prep' && s.canServe(i), 6).length >= 0 && sim.state.match.serveCourt === 'deuce');
  startServe(sim);
  runUntil(sim, (s) => s.ball.inPlay, 1); sim.ball.vel.y += 6;
  const ev2 = runUntil(sim, (s, e) => e.some((x) => x.type === 'point'), 6);
  const pt = ev2.find((e) => e.type === 'point');
  check('second fault is a DOUBLE FAULT, point to the receiver', pt && pt.reason === 'double-fault' && pt.winner === 1 - i && ev2.some((e) => e.type === 'call' && e.text === 'DOUBLE FAULT'));
  check('double fault counted', sim.state.match.stats.doubleFaults[i] === 1);
}
{
  // serve into the net (no cord) -> fault
  const sim = mk(); const i = startServe(sim);
  runUntil(sim, (s) => s.ball.inPlay, 1);
  sim.ball.vel.y = -3;                                              // drive it into the net
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'call'), 6);
  check('serve into the net is a FAULT', ev.some((e) => e.type === 'call' && e.text === 'FAULT'));
}
{
  // net cord on serve that lands in -> LET (replayed, no fault)
  const sim = mk(); const i = startServe(sim);
  runUntil(sim, (s) => s.ball.inPlay, 1);
  sim.rally.serveLet = true;                                        // as if the tape had been clipped
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'call'), 6);
  check('serve cord that lands in the box is a LET and does not count as a fault',
    ev.some((e) => e.type === 'call' && e.text === 'LET') && sim.state.match.faultCount === 0 && sim.state.match.points[0] + sim.state.match.points[1] === 0);
  check('server serves again', runUntil(sim, (s) => s.state.match.phase === 'serve-prep' && s.canServe(i), 6) && sim.state.match.phase === 'serve-prep');
}
function rallySetup(sim, lastHitBy, pos, vel, bounces = 0) {
  sim.ball.pos.x = pos.x; sim.ball.pos.y = pos.y; sim.ball.pos.z = pos.z;
  sim.ball.vel.x = vel.x; sim.ball.vel.y = vel.y; sim.ball.vel.z = vel.z;
  sim.ball.spin.x = sim.ball.spin.y = sim.ball.spin.z = 0;
  sim.ball.inPlay = true; sim.ball.lastHitBy = lastHitBy; sim.ball.bounces = bounces; sim.ball.rolling = false; sim.ball.netHit = false; sim.ball.visible = true;
  sim._setPhase('rally'); sim.rally.shots = 5; sim.rally.lastHitTime = sim.time;
}
{
  const sim = mk(); runUntil(sim, (s) => s.canServe(s.match.server), 8);
  const srv = sim.match.server;
  // player 0 (near) hit it long: lands beyond the far baseline
  rallySetup(sim, 0, { x: 0, y: 1.2, z: 3 }, { x: 0, y: 2, z: -30 });
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'point'), 5);
  const pt = ev.find((e) => e.type === 'point');
  check('ball landing beyond the baseline is OUT (point to the opponent)', pt && pt.reason === 'out' && pt.winner === 1 && ev.some((e) => e.type === 'call' && e.text === 'OUT'), JSON.stringify(pt));
  const bo = ev.find((e) => e.type === 'bounce');
  check('bounce event reports in:false', bo && bo.in === false);
}
{
  const sim = mk(); runUntil(sim, (s) => s.canServe(s.match.server), 8);
  rallySetup(sim, 1, { x: 6, y: 1.0, z: -4 }, { x: 5, y: 0, z: 20 });       // wide of the sideline
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'point'), 5);
  const pt = ev.find((e) => e.type === 'point');
  check('wide ball is OUT', pt && pt.reason === 'out' && pt.winner === 0);
}
{
  const sim = mk(); runUntil(sim, (s) => s.canServe(s.match.server), 8);
  rallySetup(sim, 0, { x: 0, y: 0.7, z: 6 }, { x: 0, y: 1, z: -25 });
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'point'), 5);
  const pt = ev.find((e) => e.type === 'point');
  check('ball into the net loses the point for the hitter', pt && pt.reason === 'net' && pt.winner === 1 && ev.some((e) => e.type === 'net' && !e.cord), JSON.stringify(pt));
}
{
  const sim = mk(); runUntil(sim, (s) => s.canServe(s.match.server), 8);
  // good ball by player 1 into the near court that nobody returns -> second bounce -> winner for player 1
  rallySetup(sim, 1, { x: 1, y: 2.2, z: -3 }, { x: 0, y: 0, z: 14 });
  sim.players[0].pos.x = -4; sim.players[0].pos.z = 14;                  // far away from the ball
  const ev = runUntil(sim, (s, e) => e.some((x) => x.type === 'point'), 8);
  const pt = ev.find((e) => e.type === 'point');
  const bounces = ev.filter((e) => e.type === 'bounce');
  check('ball in court, not returned: double bounce gives the point to the last hitter (winner)', pt && pt.reason === 'winner' && pt.winner === 1 && bounces.length >= 2 && bounces[0].in === true, JSON.stringify(pt));
  check('winner counted in stats', sim.state.match.stats.winners[1] === 1);
}
{
  // unforced / forced classification & stats containers exist
  const sim = mk();
  const st = sim.state.match.stats;
  check('stats arrays present', ['aces', 'doubleFaults', 'winners', 'unforcedErrors', 'firstServePct', 'maxServeKmh'].every((k) => Array.isArray(st[k]) && st[k].length === 2));
}
{
  // full set between two AIs completes with consistent scoring
  const sim = new Simulation({ aiPlayers: [true, true], aiStyles: ['aggressive', 'counter'], seed: 8, timing: fast, format: { sets: 1, gamesPerSet: 4, tiebreak: true } });
  runUntil(sim, (s) => s.state.match.phase === 'match-over', 2500);
  const m = sim.state.match;
  check('AI match reaches match-over with a winner', m.phase === 'match-over' && (m.winner === 0 || m.winner === 1), `sets ${JSON.stringify(m.sets)}`);
  const total = m.stats.pointsWon[0] + m.stats.pointsWon[1];
  check('stats points add up', total === m.stats.totalPoints && total > 20, `${total} points`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
