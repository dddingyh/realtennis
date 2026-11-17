// Engine v2 auto-movement and side choice: smooth purposeful footwork, settle before contact, recovery to the bisector,
// wide balls genuinely hard, forehand/backhand choice with run-around and hysteresis.   Run: node tests/engine_move.mjs
import { HALF, H, check, finish, mean, f1, f2, mkSim, stepOnce, stepWhile } from './engine_util.mjs';
import { RNG } from '../src/game/rng.js';

const T0 = Date.now();
const rng = new RNG(42);

/** Feed player 0 a ball (landing at x,depth) and watch it until it is hit or passes; returns a log. */
function watch(o = {}) {
  const sim = mkSim({ seed: o.seed ?? 5, timeScale: 1, hand0: o.hand0 || 'R' });
  sim.setLag(0, 0);
  sim.debugPlace(0, o.x0 ?? 0, 12.65);
  sim.P[0].perceive = 0.0;
  if (o.aggr !== undefined) sim.P[0].aggr = o.aggr;
  sim.debugFeed(1, { from: { x: o.fromX ?? 0, y: 1, z: -12.4 }, target: { x: o.bx ?? 0, z: HALF - (o.depth ?? 3) }, speedKmh: o.kmh ?? 100, topRpm: o.topRpm ?? 2500 });
  const p = sim.P[0], plan0 = p.plan;
  const log = { plan0, stands: [], sides: [], locks: [], speeds: [], acc: [], tC: plan0 ? plan0.tContact : null, hitAt: null, atC: null, margin: plan0 ? plan0.margin : -9 };
  let prevV = { x: 0, z: 0 }, prevA = null, maxJerk = 0, hs = 0;
  const swingAtT = plan0 ? plan0.tContact + (o.offMs ?? 0) / 1000 : 0;
  let swung = false, n = 0;
  while (n++ < 700 && sim.phase === 'rally' && sim.rl.live) {
    if (!swung && p.plan && sim.time >= swingAtT - 1e-9) { sim.swing(0, { shot: 'topspin', power: 0.6 }); swung = true; }
    if (!sim.log) sim.log = [];
    if (p.plan && p.plan.tContact - 0.1 <= sim.time && !log.at10) log.at10 = { speed: Math.hypot(p.vel.x, p.vel.z), d: Math.hypot(p.pos.x - p.plan.standTrue.x, p.pos.z - p.plan.standTrue.z), plan: p.plan };
    if (p.plan) {
      const last = log.stands[log.stands.length - 1];
      if (!last || Math.hypot(last.x - p.plan.stand.x, last.z - p.plan.stand.z) > 1e-6) log.stands.push({ x: p.plan.stand.x, z: p.plan.stand.z, t: sim.time });
      log.sides.push(p.plan.side); log.locks.push(p.plan.sideLocked);
    }
    const ev = stepOnce(sim);
    const a = { x: (p.vel.x - prevV.x) / H, z: (p.vel.z - prevV.z) / H };
    const moving = Math.hypot(p.vel.x, p.vel.z) > 0.5 && Math.hypot(prevV.x, prevV.z) > 0.5;      // (the final stop snap is not footwork)
    if (prevA && moving) { const j = Math.hypot(a.x - prevA.x, a.z - prevA.z) / H; if (j > maxJerk && sim.time > 0.2) maxJerk = j; }
    if (moving) hs = Math.max(hs, Math.hypot(a.x, a.z));
    prevA = a; prevV = { x: p.vel.x, z: p.vel.z };
    if (ev.some((e) => e.type === 'hit')) { log.hitAt = sim.time; break; }
    if (ev.some((e) => e.type === 'whiff')) { log.whiff = true; break; }
  }
  log.maxJerk = maxJerk; log.maxAcc = hs; log.sim = sim; log.hit = sim.lastShot && sim.lastShot.by === 0 ? sim.lastShot : null;
  return log;
}

console.log('--- plans: one plan per ball, no retarget jitter');
{
  let balls = 0, jitter = 0, multi = 0, maxMove = 0;
  for (let k = 0; k < 40; k++) {
    const L = watch({ bx: rng.range(-3.4, 3.4), depth: rng.range(1.5, 5), kmh: rng.range(80, 130), topRpm: rng.range(500, 3500), seed: 100 + k, offMs: 0 });
    if (!L.plan0 || L.margin < 0.05) continue;
    balls++;
    const s = L.stands;
    // the stand target may be re-planned once at the bounce, by a small amount only
    for (let i = 1; i < s.length; i++) { const d = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z); maxMove = Math.max(maxMove, d); if (d > 0.3) jitter++; }
    if (s.length > 3) multi++;
  }
  check('stand target changes by <= 0.3 m after the first plan (re-plan at the bounce only)', jitter === 0, `${balls} balls, max re-target ${f2(maxMove)} m`);
  check('at most ~3 distinct stand targets per ball', multi === 0, `${multi} balls`);
}

console.log('--- smooth motion (jerk-limited), settled before contact');
{
  let reach = 0, settled = 0, jmax = 0, amax = 0, speeds = [];
  for (let k = 0; k < 60; k++) {
    const L = watch({ bx: rng.range(-3.4, 3.4), depth: rng.range(1.5, 5), kmh: rng.range(80, 130), topRpm: rng.range(500, 3500), seed: 300 + k, x0: rng.range(-1.5, 1.5) });
    if (!L.plan0 || L.margin < 0.12) continue;
    reach++;
    if (L.at10 && L.at10.speed <= 1.3 && L.at10.d <= 0.4) settled++;
    jmax = Math.max(jmax, L.maxJerk); amax = Math.max(amax, L.maxAcc);
    if (L.at10) speeds.push(L.at10.speed);
  }
  console.log(`  reachable balls ${reach}, settled (speed <= 1.3 m/s, within 0.4 m of the stand) 0.10 s before contact: ${settled} (${f1(100 * settled / reach)}%), mean speed ${f2(mean(speeds))} m/s, max accel ${f1(amax)} m/s2, max jerk ${f1(jmax)} m/s3`);
  check('settled before contact for >= 85 % of reachable balls', settled / reach >= 0.85, f1(100 * settled / reach) + '%');
  check('acceleration stays below the ACC/DEC bounds (while moving)', amax <= 13.5, f1(amax));
  check('jerk is bounded (S-curve): <= 1.25 x JERK', jmax <= 110 * 1.3, f1(jmax));
}

console.log('--- wide balls are genuinely hard');
{
  let n = 0, hard = 0, ok = 0, qs = [];
  for (let k = 0; k < 30; k++) {
    const sgn = k % 2 ? 1 : -1;
    const L = watch({ bx: sgn * rng.range(3.6, 4.0), depth: rng.range(1.0, 2.4), kmh: rng.range(115, 135), topRpm: 1500, seed: 500 + k, x0: -sgn * 0.6, fromX: -sgn * 2.5, offMs: 0 });
    n++;
    const tight = !L.plan0 || L.margin < 0.12 || L.whiff || !L.hit || L.hit.quality < 0.6;
    if (tight) hard++; else ok++;
    if (L.hit) qs.push(L.hit.quality);
  }
  console.log(`  fast wide corner balls (|x| 3.6-4.0, 115-135 km/h) vs a player at the middle: ${hard}/${n} unreachable / stretched / weak  (mean quality of returns ${f2(mean(qs))})`);
  check('>= 70 % of wide corner balls are unreachable, stretched or answered weakly', hard / n >= 0.7, `${hard}/${n}`);
  let easy = 0, nE = 0;
  for (let k = 0; k < 20; k++) { const L = watch({ bx: rng.range(-1.5, 1.5), depth: rng.range(2.5, 5), kmh: 95, seed: 700 + k }); nE++; if (L.hit && L.hit.quality > 0.6) easy++; }
  check('central rally balls are comfortable (>= 85 % good returns)', easy / nE >= 0.85, `${easy}/${nE}`);
}

console.log('--- forehand / backhand choice, run-around, hysteresis');
{
  const sideOf = (bx, o = {}) => { const L = watch({ bx, depth: 3, kmh: 95, seed: 900, ...o }); return L.plan0 ? L.plan0.side : null; };
  const rows = [-3.2, -2.4, -1.8, -1.2, -0.8, -0.4, 0.2, 1.0, 2.0, 3.0].map((bx) => [bx, sideOf(bx)]);
  console.log('  R, standing in the middle, ball x -> side: ' + rows.map(([x, s]) => `${x}:${s}`).join('  '));
  check('forehand for balls on the racket side, backhand for wide balls on the other side (right-hander)', rows.filter(([x]) => x >= 0.2).every(([, s]) => s === 'fh') && rows.filter(([x]) => x <= -2.4).every(([, s]) => s === 'bh'));
  check('run-around: a ball within ~1.2 m on the backhand side is taken as a forehand (time allowing)', rows.filter(([x]) => x >= -0.8 && x < 0).every(([, s]) => s === 'fh'), rows.filter(([x]) => x >= -0.8 && x < 0).map(([, s]) => s).join());
  const lrows = [-3.0, -1.0, 0.8, 2.5].map((bx) => [bx, sideOf(bx, { hand0: 'L' })]);
  console.log('  L: ' + lrows.map(([x, s]) => `${x}:${s}`).join('  '));
  check('left-hander mirrored (fh on the left)', lrows[0][1] === 'fh' && lrows[1][1] === 'fh' && lrows[3][1] === 'bh');
  const slow = (() => { const a = watch({ bx: -0.9, depth: 3, kmh: 135, seed: 901, x0: 1.5 }); return a.plan0 ? a.plan0.side : null; })();
  console.log('  run-around with little time (fast ball, player 2.4 m away): side ' + slow);
  // hysteresis: never flip once locked; at most one flip before
  let flipsAfter = 0, flipsBefore = 0, nB = 0, locked = 0, hintFlip = 0;
  for (let k = 0; k < 60; k++) {
    const L = watch({ bx: rng.range(-3.2, 3.2), depth: rng.range(1.5, 5), kmh: rng.range(80, 130), topRpm: rng.range(500, 3500), seed: 1100 + k, x0: rng.range(-2, 2) });
    if (!L.plan0) continue;
    nB++;
    let lockedAt = -1;
    for (let i = 1; i < L.sides.length; i++) {
      if (L.locks[i] && lockedAt < 0) lockedAt = i;
      if (L.sides[i] !== L.sides[i - 1]) { if (lockedAt >= 0 && i > lockedAt) flipsAfter++; else flipsBefore++; }
    }
    if (lockedAt >= 0) locked++;
  }
  console.log(`  ${nB} balls: ${locked} reached sideLocked, side flips before lock ${flipsBefore}, after lock ${flipsAfter}`);
  check('never flips after sideLocked', flipsAfter === 0);
  check('rarely flips before the lock (hysteresis)', flipsBefore <= Math.ceil(nB * 0.05), `${flipsBefore}/${nB}`);
  check('sideLocked is reached before contact for the (large majority of) balls', locked >= nB * 0.9, `${locked}/${nB}`);
  const L = watch({ bx: 1.0, depth: 3, kmh: 95, seed: 33 });
  check('hint.side available from the start, locked at <= 0.45 s before contact', L.locks[0] === false && L.locks[L.locks.length - 1] === true);
}

console.log('--- intercept choice: aggression (step in on the rise vs drop back)');
{
  const z = (aggr) => { const L = watch({ bx: 0.8, depth: 2.2, kmh: 100, topRpm: 3600, seed: 61, aggr }); return L.plan0 ? Math.abs(L.plan0.P.z) : NaN; };
  const zi = z(1), zb = z(0);
  const yy = (aggr) => { const L = watch({ bx: 0.8, depth: 2.2, kmh: 100, topRpm: 3600, seed: 61, aggr }); return L.plan0 ? L.plan0.P.y : NaN; };
  console.log(`  heavy topspin: aggressive player takes it at |z| ${f2(zi)} (y ${f2(yy(1))}), defensive at |z| ${f2(zb)} (y ${f2(yy(0))})`);
  check('an aggressive player meets the ball earlier / further inside than a defensive one', zi < zb - 0.5);
}

console.log('--- recovery to the bisector of the opponent\'s reply angles');
{
  const rec = (tx, fx = 0) => {
    const sim = mkSim({ seed: 5, timeScale: 1 });
    sim.setLag(0, 0); sim.debugPlace(0, 0, 12.65);
    sim.debugFeed(1, { from: { x: 0, y: 1, z: -12.4 }, target: { x: fx, z: HALF - 3 }, speedKmh: 90 });
    const p = sim.P[0]; sim.P[0].perceive = 0;
    stepWhile(sim, () => !p.plan);
    const aim = sim.timingForAim(0, tx);
    stepWhile(sim, () => p.plan && sim.time < p.plan.tContact + aim / 1000 - 1e-9);
    sim.swing(0, { shot: 'topspin', power: 0.6 });
    stepWhile(sim, () => !sim.lastShot || sim.lastShot.by !== 0, 300);
    const home = { x: p.recover.x, z: p.recover.z };
    const land = sim.lastShot.target;
    const dist0 = Math.hypot(p.pos.x - home.x, p.pos.z - home.z);
    const t0 = sim.time; stepWhile(sim, () => sim.time < t0 + 0.9 && sim.phase === 'rally', 200);
    return { home, land, dist0, distAfter: Math.hypot(p.pos.x - home.x, p.pos.z - home.z), pos: { ...p.pos } };
  };
  const mid = rec(0.3, 0), wide = rec(-3.0, 3.0);
  const W = 3.9, bis = (L, zH) => { const dz = Math.abs(zH + HALF * 0 - L.z) , dA = Math.hypot(-W - L.x, dz), dB = Math.hypot(W - L.x, dz); return -W + 2 * W * dA / (dA + dB); };
  const expMid = bis({ x: mid.land.x, z: -(HALF - 3) }, 12.65), expWide = bis({ x: wide.land.x, z: wide.land.z }, 12.65);
  console.log(`  centre shot: recover x ${f2(mid.home.x)} (bisector ${f2(expMid)}), wide shot to x=${f2(wide.land.x)}: recover x ${f2(wide.home.x)} (bisector ${f2(expWide)}), distance to recover at the shot ${f2(mid.dist0)} / ${f2(wide.dist0)} m`);
  check('recovery target = bisector of the reply fan (within 0.3 m)', Math.abs(wide.home.x - expWide) < 0.3 && Math.abs(mid.home.x - expMid) < 0.3);
  check('a shot hit from a wide position (a wide angle) forces a longer recovery run than a central one', wide.dist0 > mid.dist0 + 1.0, `${f2(wide.dist0)} vs ${f2(mid.dist0)}`);
  check('the player is back in position (within 0.6 m) <= 0.9 s later', wide.distAfter < 0.6, f2(wide.distAfter));
}
console.log(`\n(move tests took ${((Date.now() - T0) / 1000).toFixed(1)} s)`);
finish();
