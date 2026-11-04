// Physics + shot-solver tests. Run: node tests/sim_physics.mjs
import { COURT, SURFACES, BALL } from '../src/config.js';
import { simulateTrajectory, makeSpin, topspinOf, createBall, stepBall, bounceVelocity, netHeightAt } from '../src/physics/ball.js';
import { solveLaunch, computeHit, computeServe, serviceBox, inBox } from '../src/game/shot.js';
import { RNG } from '../src/game/rng.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const RPM = Math.PI / 30;
const f = (x, n = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(n));

// ------------------------------------------------------------------ spin sign convention
console.log('spin sign convention');
{
  const w = makeSpin(0, -1, 300);                                   // topspin for a ball travelling toward -z
  check('topspin for -z travel is omega.x < 0', w.x < 0 && w.y === 0 && Math.abs(w.z) < 1e-9, `omega=(${f(w.x, 0)},${f(w.y, 0)},${f(w.z, 0)})`);
  check('topspinOf round-trips', Math.abs(topspinOf(w, 0, -1) - 300) < 1e-9);
  const wz = makeSpin(0, 1, 300);                                   // ball travelling toward +z
  check('topspin for +z travel is omega.x > 0', wz.x > 0);
  const vy = (spin) => {
    const b = createBall({ pos: { x: 0, y: 10, z: 0 }, vel: { x: 0, y: 0, z: -30 }, spin });
    const env = { surf: SURFACES.hard, surfKey: 'hard', events: [] };
    for (let i = 0; i < 24; i++) stepBall(b, 1 / 240, env);
    return b.vel.y;
  };
  const v0 = vy({ x: 0, y: 0, z: 0 }), vt = vy(makeSpin(0, -1, 300)), vb = vy(makeSpin(0, -1, -300));
  check('Magnus: topspin pushes DOWN, backspin pushes UP', vt < v0 - 0.05 && vb > v0 + 0.05, `vy flat=${f(v0, 3)} top=${f(vt, 3)} back=${f(vb, 3)}`);
  const vx = (side) => {
    const b = createBall({ pos: { x: 0, y: 10, z: 0 }, vel: { x: 0, y: 0, z: -30 }, spin: { x: 0, y: side, z: 0 } });
    const env = { surf: SURFACES.hard, surfKey: 'hard', events: [] };
    for (let i = 0; i < 48; i++) stepBall(b, 1 / 240, env);
    return b.vel.x;
  };
  check('Magnus: +omega.y deflects a -z ball toward -x', vx(300) < -0.05 && vx(-300) > 0.05);
}

// ------------------------------------------------------------------ helper: solve + simulate a shot
function shot(surface, kmh, rpm, target = { x: 0, z: -10 }, pos = { x: 0, y: 1.0, z: 11.885 }) {
  const sol = solveLaunch({ pos, target, speed: kmh / 3.6, top: rpm * RPM, side: 0, surface });
  const r = simulateTrajectory({ pos, vel: sol.vel, spin: sol.spin }, { surface, dt: 1 / 240, stopAfterBounces: 2, path: true, pathDt: 1 / 240 });
  const b = r.bounces[0];
  let apex = 0, pre = null;
  for (const p of r.path) { if (p.t > b.t) apex = Math.max(apex, p.y); else if (p.t < b.t - 1e-9) pre = p; }
  const vhIn = Math.hypot(pre.vx, pre.vz), vhOut = Math.hypot(b.vx, b.vz);
  return { sol, r, landing: b, apex, vhIn, vhOut, ratio: vhOut / vhIn, inAngle: Math.atan2(-pre.vy, vhIn) * 180 / Math.PI,
    outAngle: Math.atan2(b.vy, vhOut) * 180 / Math.PI, net: r.netClear };
}

// ------------------------------------------------------------------ (a) 150 km/h flat from the baseline
console.log('(a) 150 km/h flat shot from baseline at 1 m');
{
  const pos = { x: 0, y: 1.0, z: COURT.halfLength };
  const target = { x: 0, z: -(COURT.halfLength - 2) };
  const s = shot('hard', 150, 600, target, pos);
  check('lands in court (2 m inside baseline)', Math.abs(s.landing.z - target.z) < 0.3 && Math.abs(s.landing.x) < COURT.singlesHalfWidth, `z=${f(s.landing.z)} x=${f(s.landing.x)}`);
  check('clears the net', s.net > 0.05, `clearance ${f(s.net)} m, elevation ${f(s.sol.el * 180 / Math.PI, 1)} deg`);
  // an unaimed bisection by hand, independent of solveLaunch
  let lo = -10, hi = 30, res;
  for (let i = 0; i < 40; i++) {
    const m = 0.5 * (lo + hi), e = m * Math.PI / 180, sp = 150 / 3.6;
    res = simulateTrajectory({ pos, vel: { x: 0, y: sp * Math.sin(e), z: -sp * Math.cos(e) }, spin: makeSpin(0, -1, 600 * RPM) }, { surface: 'hard' });
    if ((res.landing ? -res.landing.z : 0) < COURT.halfLength - 2) lo = m; else hi = m;
  }
  check('independent bisection agrees with solver elevation', Math.abs(hi - s.sol.el * 180 / Math.PI) < 0.3, `${f(hi, 2)} vs ${f(s.sol.el * 180 / Math.PI, 2)}`);
}

// ------------------------------------------------------------------ (b)(c)(d) bounce behaviour
console.log('(b,c,d) spin and surface effects (same landing target, solved launches)');
const table = {};
for (const sf of ['hard', 'clay', 'grass']) {
  table[sf] = { flat: shot(sf, 130, 500), top: shot(sf, 110, 3200), slice: shot(sf, 90, -2600) };
}
console.log('  surface type   el    netClr  inAng  apex  outAng  hSpdIn hSpdOut ratio');
for (const sf of Object.keys(table)) for (const t of Object.keys(table[sf])) {
  const s = table[sf][t];
  console.log(`  ${sf.padEnd(6)} ${t.padEnd(6)} ${f(s.sol.el * 180 / Math.PI, 1).padStart(5)} ${f(s.net).padStart(6)} ${f(s.inAngle, 1).padStart(6)} ${f(s.apex).padStart(5)} ${f(s.outAngle, 1).padStart(6)} ${f(s.vhIn, 1).padStart(7)} ${f(s.vhOut, 1).padStart(7)} ${f(s.ratio).padStart(5)}`);
}
{
  // (b) heavy topspin dips: same speed & elevation lands shorter than flat
  const pos = { x: 0, y: 1.0, z: COURT.halfLength }, sp = 120 / 3.6, e = 8 * Math.PI / 180;
  const land = (rpm) => simulateTrajectory({ pos, vel: { x: 0, y: sp * Math.sin(e), z: -sp * Math.cos(e) }, spin: makeSpin(0, -1, rpm * RPM) }, { surface: 'hard' }).landing;
  const lf = land(500), lt = land(3200), ls = land(-2600);
  check('(b) topspin dips: lands shorter than flat at same speed/elevation', -lt.z < -lf.z - 2, `flat ${f(-lf.z)} m, topspin ${f(-lt.z)} m from net`);
  check('(b) backspin floats: lands longer than flat', -ls.z > -lf.z + 1, `slice ${f(-ls.z)} m`);
  for (const sf of Object.keys(table)) {
    const { flat, top, slice } = table[sf];
    check(`(b) ${sf}: topspin bounces higher than flat`, top.apex > flat.apex * 1.3, `${f(top.apex)} vs ${f(flat.apex)} m`);
    check(`(b) ${sf}: topspin exit angle steeper and keeps more of its horizontal speed than flat`, top.outAngle > flat.outAngle + 3 && top.ratio > flat.ratio, `angle ${f(top.outAngle, 1)} vs ${f(flat.outAngle, 1)}, keeps ${f(top.ratio)} vs ${f(flat.ratio)}`);
    check(`(c) ${sf}: slice bounce is the lowest and slower than topspin/flat`, slice.apex < top.apex * 0.75 && slice.apex <= flat.apex * 1.08 && slice.vhOut < flat.vhOut, `apex ${f(slice.apex)} (flat ${f(flat.apex)}, top ${f(top.apex)}), speed out ${f(slice.vhOut, 1)} vs flat ${f(flat.vhOut, 1)}`);
    check(`(c) ${sf}: backspin loses a larger share of horizontal speed than flat`, slice.ratio < flat.ratio, `${f(slice.ratio)} vs ${f(flat.ratio)}`);
  }
  // (d) surfaces
  for (const t of ['flat', 'top', 'slice']) {
    check(`(d) clay bounces higher than grass (${t})`, table.clay[t].apex > table.grass[t].apex * 1.1, `${f(table.clay[t].apex)} vs ${f(table.grass[t].apex)}`);
    check(`(d) clay is slower than grass after the bounce (${t})`, table.clay[t].vhOut < table.grass[t].vhOut, `${f(table.clay[t].vhOut, 1)} vs ${f(table.grass[t].vhOut, 1)} m/s`);
  }
  check('(d) hard court sits between clay and grass (flat apex)', table.hard.flat.apex > table.grass.flat.apex && table.hard.flat.apex < table.clay.flat.apex);
  // pure bounce model sanity
  const v = { x: 0, y: -8, z: -25 }, w = { x: 0, y: 0, z: 0 };
  const info = bounceVelocity(v, w, SURFACES.hard, 'hard');
  check('bounce: vertical COR applied', Math.abs(v.y - 8 * SURFACES.hard.cor) < 1e-9);
  check('bounce: flat ball sliding gains topspin (omega.x < 0 for -z travel)', !info.grip && w.x < 0, `omega.x=${f(w.x, 1)}`);
  const v2 = { x: 0, y: -8, z: -12 }, w2 = makeSpin(0, -1, 450);
  const info2 = bounceVelocity(v2, w2, SURFACES.clay, 'clay');
  check('bounce: heavy topspin on a slow ball grips (rolling)', info2.grip);
}

// ------------------------------------------------------------------ (e) net
console.log('(e) net collision');
{
  const env = () => ({ surf: SURFACES.hard, surfKey: 'hard', events: [], rng: new RNG(5) });
  const run = (y0, vy0, e) => {
    const b = createBall({ pos: { x: 0.5, y: y0, z: 3 }, vel: { x: 0, y: vy0, z: -25 }, spin: makeSpin(0, -1, 0) });
    let hit = false, cord = false, cross = null;
    for (let i = 0; i < 480 && !b.netHit; i++) {
      stepBall(b, 1 / 240, e);
      for (const ev of e.events) { if (ev.type === 'net') { hit = !ev.cord; cord = ev.cord; } if (ev.type === 'netcross') cross = ev; }
      e.events.length = 0;
      if (b.pos.z < -3) break;
    }
    return { b, hit, cord, cross };
  };
  const low = run(0.55, 0, env());
  check('ball well below the tape hits the net and drops on the hitter side', low.hit && low.b.pos.z > 0 && Math.abs(low.b.vel.z) < 5, `z=${f(low.b.pos.z, 3)} vz=${f(low.b.vel.z)}`);
  check('net height profile', Math.abs(netHeightAt(0) - COURT.netHeightCenter) < 1e-9 && Math.abs(netHeightAt(COURT.netPostX) - COURT.netHeightPost) < 1e-9);
  const high = run(1.6, 0, env());
  check('ball well above the net passes', !high.hit && !high.cord && high.b.pos.z < -2);
  // scan trajectories for a tape clip with RNG: should produce cord events that slow/deflect upward
  let cords = 0, slowed = 0, over = 0, hits = 0, clean = 0;
  for (let k = 0; k < 120; k++) {
    const y0 = 0.80 + k * 0.0045;                       // sweeps the area around the tape (0.914 + radius)
    const e = env(); const r = run(y0, 0, e);
    if (r.cord) { cords++; if (r.b.vel.z > -25 * 0.8) slowed++; if (r.b.pos.z < 0) over++; } else if (r.hit) hits++; else clean++;
  }
  check('sweep: net hits, cord clips and clean passes all occur', hits > 0 && cords > 0 && clean > 0, `hit ${hits}, cord ${cords}, clean ${clean}`);
  check('cord clips lose speed and dribble over', cords > 0 && slowed === cords && over >= cords * 0.5, `cords ${cords} slowed ${slowed} over ${over}`);
  // pure sim reports hit
  const pos = { x: 0, y: 0.7, z: 8 };
  const rr = simulateTrajectory({ pos, vel: { x: 0, y: 3, z: -25 }, spin: { x: 0, y: 0, z: 0 } }, { surface: 'hard' });
  check('simulateTrajectory reports net hit / clearance', rr.hitNet || (rr.netClear !== null && rr.netClear < 0.2), `netClear ${f(rr.netClear)}`);
}

// ------------------------------------------------------------------ (f) solver hits targets for every shot type at q=1
console.log('(f) shot solver accuracy (quality = 1, no noise)');
{
  const rng = new RNG(99);
  let worst = 0, n = 0, bad = 0;
  const hitter = (z, x = 0, facing = z > 0 ? 1 : -1) => ({ pos: { x, z }, vel: { x: 0, z: 0 }, facing, hand: 'R', stamina: 1 });
  const cases = [];
  for (const surface of ['hard', 'clay', 'grass'])
    for (const shot of ['flat', 'topspin', 'slice', 'lob'])
      for (const power of [0.3, 0.7, 1.0])
        for (const [hz, bx, by, bounces] of [[12.5, 1.5, 0.9, 1], [11.0, -2.5, 0.7, 1], [14.5, 3.0, 1.1, 1], [8.5, 0.5, 0.85, 1], [4.0, 1.0, 1.1, 0], [3.5, -1.0, 0.6, 0], [4.5, 1.5, 2.3, 0], [8.0, -1.0, 2.2, 1]])
          for (const [aimX, aimDepth] of [[null, null], [-0.8, 0.5], [0.9, -0.2], [0.3, 0.9], [-0.5, -0.8]])
            cases.push({ surface, shot, power, hz, bx, by, bounces, aimX, aimDepth });
  const perKind = {};
  for (const c of cases) {
    const h = hitter(c.hz);
    const ball = { pos: { x: c.bx, y: c.by, z: c.hz - 0.5 }, vel: { x: 0, y: 0, z: 18 }, spin: { x: 0, y: 0, z: 0 }, bounces: c.bounces };
    const res = computeHit({ hitter: h, ball, swing: { shot: c.shot, power: c.power, aimX: c.aimX, aimDepth: c.aimDepth, source: 'keyboard' }, surface: c.surface, rng, timingEarlyMs: 0, opts: { forceQuality: 1, noError: true } });
    const r = simulateTrajectory({ pos: ball.pos, vel: res.vel, spin: res.spin }, { surface: c.surface, dt: 1 / 240 });
    n++;
    const k = res.kind;
    perKind[k] = perKind[k] || { n: 0, bad: 0, worst: 0 };
    perKind[k].n++;
    if (!r.landing || r.hitNet) { bad++; perKind[k].bad++; if (process.env.VERBOSE) console.log('   nolanding', JSON.stringify(c), res.kind); continue; }
    const err = Math.hypot(r.landing.x - res.target.x, r.landing.z - res.target.z);
    worst = Math.max(worst, err); perKind[k].worst = Math.max(perKind[k].worst, err);
    const inCourt = Math.abs(r.landing.x) <= COURT.singlesHalfWidth + 0.02 && r.landing.z < 0 && -r.landing.z <= COURT.halfLength + 0.02;
    if (err > 0.5 || !inCourt || (r.netClear !== null && r.netClear < 0)) { bad++; perKind[k].bad++; if (process.env.VERBOSE && bad < 25) console.log('   bad', JSON.stringify(c), 'err', f(err), 'inCourt', inCourt, 'net', f(r.netClear), 'tgt', f(res.target.x), f(res.target.z), 'land', f(r.landing.x), f(r.landing.z), 'solved', res.solved); }
  }
  for (const [k, v] of Object.entries(perKind)) console.log(`    ${k.padEnd(7)} cases ${String(v.n).padStart(4)}  bad ${v.bad}  worst error ${f(v.worst)} m`);
  check(`solver lands within 0.5 m of target, in court, over the net (${n} cases)`, bad === 0, `bad ${bad}, worst ${f(worst)} m`);
  check('ground strokes, lobs, volleys and smashes were all exercised', ['ground', 'lob', 'volley', 'smash'].every((k) => perKind[k]), Object.keys(perKind).join(','));

  // serves
  let sb = 0, sn = 0, sworst = 0;
  for (const facing of [1, -1]) for (const deuce of [true, false]) for (const shot of ['flat', 'topspin', 'slice']) for (const power of [0.4, 0.8, 1]) for (const [aimX, aimDepth] of [[0, 0.2], [1, 0.8], [-1, 0.8], [0, -0.5], [0.7, 1]]) {
    const box = serviceBox(facing, deuce);
    const sx = box.standSign * 1.1, sz = facing * (COURT.halfLength + 0.45);
    const server = { pos: { x: sx, z: sz }, vel: { x: 0, z: 0 }, facing, hand: 'R', stamina: 1 };
    const ball = { pos: { x: sx + 0.25 * facing, y: 2.85, z: sz - facing * 0.35 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, bounces: 0 };
    const res = computeServe({ server, ball, swing: { shot, power, aimX, aimDepth }, serveNumber: 1, deuce, surface: 'hard', rng, opts: { forceQuality: 1, noError: true } });
    const r = simulateTrajectory({ pos: ball.pos, vel: res.vel, spin: res.spin }, { surface: 'hard', dt: 1 / 240 });
    sn++;
    const err = r.landing ? Math.hypot(r.landing.x - res.target.x, r.landing.z - res.target.z) : 99;
    sworst = Math.max(sworst, err);
    if (!r.landing || r.hitNet || err > 0.5 || !inBox(box, r.landing.x, r.landing.z) || r.netClear < 0) sb++;
  }
  check(`serve solver lands in the correct service box within 0.5 m (${sn} cases)`, sb === 0, `bad ${sb}, worst ${f(sworst)} m`);
}

// ------------------------------------------------------------------ typical shot table
console.log('typical shots (hard court, hitter on the baseline, ball at 0.9 m):');
{
  console.log('  shot     kmh   rpm   netClr  land.z   bounce apex');
  const rng = new RNG(3);
  for (const [shot, power] of [['flat', 1], ['flat', 0.7], ['topspin', 0.8], ['topspin', 1], ['slice', 0.6], ['lob', 0.6]]) {
    const h = { pos: { x: 0, z: 12.3 }, vel: { x: 0, z: 0 }, facing: 1, hand: 'R', stamina: 1 };
    const ball = { pos: { x: 0.8, y: 0.9, z: 11.8 }, vel: { x: 0, y: 0, z: 18 }, spin: { x: 0, y: 0, z: 0 }, bounces: 1 };
    const res = computeHit({ hitter: h, ball, swing: { shot, power }, surface: 'hard', rng, timingEarlyMs: 0, opts: { forceQuality: 1, noError: true } });
    const r = simulateTrajectory({ pos: ball.pos, vel: res.vel, spin: res.spin }, { surface: 'hard', dt: 1 / 240, stopAfterBounces: 2, path: true, pathDt: 1 / 240 });
    let apex = 0; for (const p of r.path) if (p.t > r.bounces[0].t) apex = Math.max(apex, p.y);
    console.log(`  ${(shot + ' ' + power).padEnd(11)}${f(res.speedKmh, 0).padStart(4)} ${f(res.spinRpm, 0).padStart(6)} ${f(r.netClear).padStart(7)} ${f(-r.landing.z).padStart(8)} ${f(apex).padStart(8)}`);
  }
}

// ------------------------------------------------------------------ determinism
console.log('determinism');
{
  const a = shot('clay', 120, 2800), b = shot('clay', 120, 2800);
  check('same inputs -> identical trajectory', a.landing.z === b.landing.z && a.landing.x === b.landing.x);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
