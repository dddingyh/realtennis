// Analog phone swings (DESIGN §6.2): power / spin / lift / aimX / exec -> distinct, physically consistent shots.
// Run: node tests/sim_analog.mjs
import { COURT } from '../src/config.js';
import { computeHit } from '../src/game/shot.js';
import { simulateTrajectory } from '../src/physics/ball.js';
import { Simulation } from '../src/game/simulation.js';
import { contactGeometry } from '../src/game/shot.js';
import { RNG } from '../src/game/rng.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 2) => (x == null ? 'n/a' : x.toFixed(n));
const inc = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);

const H = (o = {}) => ({ pos: { x: 0, z: 12.4 }, vel: { x: 0, z: 0 }, facing: 1, hand: 'R', stamina: 1, ...o });
const B = (o = {}) => ({ pos: { x: 0.8, y: 0.95, z: 11.9 }, vel: { x: 0, y: -2, z: 20 }, spin: { x: 0, y: 0, z: 0 }, bounces: 1, ...o });
/** analog swing; q forced (1 = perfect) unless noise wanted */
function hit(sw, o = {}) {
  const h = o.h || H(), b = o.b || B();
  const res = computeHit({ hitter: h, ball: b, swing: { power: 0.7, spin: 0.3, lift: 0.5, exec: 1, aimX: 0, source: 'remote', ...sw }, surface: 'hard',
    rng: o.rng || new RNG(1), timingEarlyMs: 0, opts: o.noise ? {} : { forceQuality: o.q ?? 1, noError: true } });
  const t = simulateTrajectory({ pos: b.pos, vel: res.vel, spin: res.spin }, { surface: 'hard', stopAfterBounces: 1, path: true, pathDt: 1 / 60 });
  let apex = 0; for (const p of t.path) apex = Math.max(apex, p.y);
  return { res, t, land: t.landing, net: t.netClear, apex, depth: t.landing ? -t.landing.z : null };
}

console.log('power -> pace');
{
  const P = [0.3, 0.5, 0.7, 1.0].map((p) => hit({ power: p, spin: 0, lift: 0.4 }).res.speedKmh);
  check('pace rises with power', inc(P), P.map((v) => f(v, 0)).join(' < '));
  check('0.3 is a soft rally ball, 1.0 a full cut', P[0] < 100 && P[3] > 145, `${f(P[0], 0)} / ${f(P[3], 0)} km/h`);
  const slow = hit({ power: 0.7, spin: 0 }, { b: B({ vel: { x: 0, y: -2, z: 14 } }) }).res.speedKmh;
  const fast = hit({ power: 0.7, spin: 0 }, { b: B({ vel: { x: 0, y: -2, z: 36 } }) }).res.speedKmh;
  check('pace also scales with the incoming pace', fast > slow + 4, `${f(slow, 0)} -> ${f(fast, 0)} km/h`);
  const q1 = hit({ power: 0.8, spin: 0 }, { q: 1 }).res.speedKmh, q5 = hit({ power: 0.8, spin: 0 }, { q: 0.5 }).res.speedKmh;
  check('...and with contact quality', q1 > q5 + 8, `q1 ${f(q1, 0)} vs q0.5 ${f(q5, 0)} km/h`);
}

console.log('spin -> rpm, arc, bounce');
{
  const S = [-1, -0.5, 0, 0.5, 1];
  const R = S.map((s) => hit({ power: 1, spin: s, lift: 0.5 }).res.spinRpm);
  check('rpm rises with spin (signed: backspin < 0)', inc(R), R.map((v) => f(v, 0)).join(' < '));
  check('+1 is heavy topspin (~3500 rpm), -1 heavy slice, 0 nearly flat', R[4] > 3000 && R[4] < 3900 && R[0] < -2400 && Math.abs(R[2]) < 700, `${f(R[4], 0)} / ${f(R[0], 0)} / ${f(R[2], 0)}`);
  const N = [0, 0.5, 1].map((s) => hit({ power: 0.8, spin: s, lift: 0.5 }).net);
  check('more topspin => more net clearance (same power & lift)', inc(N), N.map((v) => f(v)).join(' < '));
  // bounce: topspin kicks, slice skids
  const bounce = (s) => {
    const r = hit({ power: 0.8, spin: s, lift: 0.5 });
    const t = simulateTrajectory({ pos: B().pos, vel: r.res.vel, spin: r.res.spin }, { surface: 'hard', stopAfterBounces: 2, path: true, pathDt: 1 / 120 });
    let a = 0; for (const p of t.path) if (p.t > t.bounces[0].t) a = Math.max(a, p.y);
    return a;
  };
  const bt = bounce(1), bf = bounce(0), bs = bounce(-1);
  check('topspin kicks higher, slice stays low after the bounce', bt > bf + 0.3 && bs < bt - 0.4 && bs <= bf * 1.1, `top ${f(bt)} flat ${f(bf)} slice ${f(bs)} m`);
}

console.log('lift -> clearance & depth, lob');
{
  const L = [0, 0.3, 0.6, 0.9].map((l) => hit({ power: 0.8, spin: 0.3, lift: l }));
  check('net clearance rises with lift', inc(L.map((r) => r.net)), L.map((r) => f(r.net)).join(' < '));
  check('depth rises with lift', inc(L.map((r) => r.depth)), L.map((r) => f(r.depth)).join(' < '));
  check('every lift level lands in the court at q=1', L.every((r) => r.depth > 4 && r.depth < COURT.halfLength));
  const lob = hit({ power: 0.3, spin: 0.3, lift: 0.95 });
  check('high lift + low power is a lob', lob.res.kind === 'lob' && lob.apex > 4.5 && lob.depth > 8, `${lob.res.kind}, apex ${f(lob.apex)} m, lands ${f(lob.depth)} m`);
  const drive = hit({ power: 0.9, spin: 0.3, lift: 0.95 });
  check('high lift with full power is a deep drive, not a lob', drive.res.kind === 'ground' && drive.depth > 10, `${drive.res.kind}, ${f(drive.depth)} m`);
}

console.log('aimX -> direction');
{
  const A = [-1, -0.5, 0, 0.5, 1].map((a) => hit({ power: 0.7, spin: 0.3, lift: 0.5, aimX: a }).land.x);
  check('near player: landing x rises with aimX (+1 = to the player\'s right)', inc(A), A.map((v) => f(v)).join(' < '));
  check('aim covers most of the court width', A[4] - A[0] > 5, f(A[4] - A[0]));
  const farH = H({ pos: { x: 0, z: -12.4 }, facing: -1 }), farB = B({ pos: { x: -0.8, y: 0.95, z: -11.9 }, vel: { x: 0, y: -2, z: -20 } });
  const F = [-1, 0, 1].map((a) => hit({ aimX: a }, { h: farH, b: farB }).land.x);
  check('far player: aimX is relative to his own left/right (mirrored in world x)', F[0] > F[1] && F[1] > F[2], F.map((v) => f(v)).join(' > '));
  const base = hit({ power: 0.8, spin: 0.5, aimX: 1, lift: 0.4 });
  const ins = hit({ power: 0.8, spin: 0.5, aimX: 1, lift: 0.4 }, { h: H({ pos: { x: 0, z: 8.0 } }), b: B({ pos: { x: 0.8, y: 0.95, z: 7.5 } }) });
  check('inside the court a wide aim gives a sharper (wider and shorter) angle', ins.land.x > base.land.x && ins.depth < base.depth - 1.5, `inside (${f(ins.land.x)}, ${f(ins.depth)}) vs baseline (${f(base.land.x)}, ${f(base.depth)})`);
  // timing still matters when aimX is given (blend)
  const e = computeHit({ hitter: H({ pos: { x: 2.5, z: 12.4 } }), ball: B({ pos: { x: 3.3, y: 0.95, z: 11.9 } }), swing: { power: 0.7, spin: 0.3, lift: 0.5, exec: 1, aimX: 0, source: 'remote' }, surface: 'hard', rng: new RNG(1), timingEarlyMs: 70, opts: { forceQuality: 1, noError: true } });
  const l = computeHit({ hitter: H({ pos: { x: 2.5, z: 12.4 } }), ball: B({ pos: { x: 3.3, y: 0.95, z: 11.9 } }), swing: { power: 0.7, spin: 0.3, lift: 0.5, exec: 1, aimX: 0, source: 'remote' }, surface: 'hard', rng: new RNG(1), timingEarlyMs: -70, opts: { forceQuality: 1, noError: true } });
  check('aimX is blended with timing (early -> more cross-court)', e.target.x < l.target.x - 0.5, `early ${f(e.target.x)} late ${f(l.target.x)}`);
}

console.log('exec -> quality -> mishits');
{
  const rate = (exec) => {
    const rng = new RNG(1234);
    let mis = 0, err = 0, n = 300, kinds = {}, framePace = [];
    for (let k = 0; k < n; k++) {
      const r = hit({ power: 0.75, spin: 0.4, lift: 0.5, exec, aimX: rng.range(-0.6, 0.6) }, { noise: true, rng });
      if (r.res.mishit) { mis++; kinds[r.res.mishit] = (kinds[r.res.mishit] || 0) + 1; if (r.res.mishit === 'frame') framePace.push(r.res.speedKmh); }
      const L = r.land;
      if (r.t.hitNet || (r.net !== null && r.net < 0) || !L || Math.abs(L.x) > COURT.singlesHalfWidth || L.z > 0 || -L.z > COURT.halfLength) err++;
    }
    return { mis: mis / n, err: err / n, kinds, q: hit({ power: 0.75, spin: 0.4, lift: 0.5, exec }, { noise: true, rng: new RNG(1) }).res.quality, framePace };
  };
  const R = [1, 0.75, 0.5, 0.25].map(rate);
  console.log('    exec   q     mishit  errors  kinds');
  [1, 0.75, 0.5, 0.25].forEach((e, i) => console.log(`    ${f(e)}  ${f(R[i].q)}  ${f(R[i].mis * 100, 1).padStart(5)}%  ${f(R[i].err * 100, 1).padStart(5)}%  ${JSON.stringify(R[i].kinds)}`));
  check('contact quality falls with exec', R[0].q > R[1].q && R[1].q > R[2].q && R[2].q > R[3].q);
  check('mishit rate rises as exec falls', R[0].mis <= R[1].mis && R[1].mis < R[2].mis && R[2].mis < R[3].mis && R[0].mis < 0.03);
  check('error rate (net/out) rises as exec falls', R[0].err < R[1].err && R[1].err < R[2].err && R[2].err < R[3].err);
  check('clean strokes are mostly in (exec 1: errors < 10%)', R[0].err < 0.1, f(R[0].err * 100, 1) + '%');
  const all = R[3].kinds;
  check('poor contact produces frame shots, floaters, net balls and long balls', ['frame', 'floater', 'net', 'long'].every((k) => all[k] > 0), JSON.stringify(all));
  const fp = R[3].framePace;
  check('frame shots have low pace', fp.length > 0 && fp.reduce((a, b) => a + b, 0) / fp.length < 75, fp.length ? f(fp.reduce((a, b) => a + b, 0) / fp.length, 0) + ' km/h' : '');
}

console.log('keyboard labels and the simulation');
{
  const k = (shot) => computeHit({ hitter: H(), ball: B(), swing: { shot, power: 0.7, source: 'keyboard' }, surface: 'hard', rng: new RNG(1), timingEarlyMs: 0, opts: { noError: true } });
  check('keyboard labels still work (no analog fields)', k('slice').shot === 'slice' && k('slice').spinRpm < -1500 && k('topspin').spinRpm > 1800 && k('flat').shot === 'flat' && k('lob').kind === 'lob', `slice ${f(k('slice').spinRpm, 0)} top ${f(k('topspin').spinRpm, 0)} rpm`);
  const a = computeHit({ hitter: H(), ball: B(), swing: { shot: 'flat', power: 0.7, spin: -0.8, lift: 0.3, exec: 1, source: 'remote' }, surface: 'hard', rng: new RNG(1), timingEarlyMs: 0, opts: { noError: true } });
  check('analog spin overrides the label (label derived from spin)', a.shot === 'slice' && a.spinRpm < -1500);
  // through the simulation: hit event carries quality + mishit
  const sim = new Simulation({ aiPlayers: [false, false], autoMove: ['off', 'off'], seed: 5, timing: { aiServeDelay: [0.1, 0.1], walkDelay: 0.02 } });
  for (let i = 0; i < 1200 && !sim.canServe(sim.match.server); i++) sim.step(1 / 120);
  sim._setPhase('rally'); sim.rally.shots = 5; sim.rally.lastHitTime = sim.time;
  for (const p of sim.players) p.walkTarget = null;
  const p0 = sim.players[0]; p0.pos.x = 0; p0.pos.z = 12.4;
  const b = sim.ball; Object.assign(b.pos, { x: 0.8, y: 1.55, z: 6 }); Object.assign(b.vel, { x: 0, y: 0, z: 20 }); Object.assign(b.spin, { x: 0, y: 0, z: 0 });
  b.inPlay = true; b.lastHitBy = 1; b.bounces = 1; b.rolling = false;
  while (contactGeometry(p0, b).tEarly > 0.004) sim.step(1 / 120);
  sim.swing(0, { shot: 'topspin', power: 0.9, spin: 0.9, lift: 0.6, exec: 0.05, aimX: 0.5, source: 'remote' });
  const ev = sim.drainEvents().find((e) => e.type === 'hit');
  check('hit event reports quality and a mishit field; lastShot too', ev && 'mishit' in ev && typeof ev.quality === 'number' && sim.state.lastShot.quality === ev.quality && 'mishit' in sim.state.lastShot, ev && `q ${f(ev.quality)} mishit ${ev.mishit}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
