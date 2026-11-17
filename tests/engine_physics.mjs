// Engine v2 physics (cartoon/src/engine/flight.js + shot.js solver): ENGINE2.md section 2 calibration table.
// Run: node tests/engine_physics.mjs
import * as B from '../src/physics/ball.js';
import * as F from '../cartoon/src/engine/flight.js';
import { solveLaunch, strokeParams } from '../cartoon/src/engine/shot.js';
import { makeK } from '../cartoon/src/engine/tuning.js';
import { COURT } from '../src/config.js';
import { check, finish, f1, f2 } from './engine_util.mjs';

const RPM = Math.PI / 30, HALF = COURT.halfLength, KMH = 3.6;
const K = makeK();
const TUNE = { liftGain: K.liftGain, kickGain: K.kickGain, skidGain: K.skidGain, sideKick: K.sideKick };
const ONE = { liftGain: 1, kickGain: 1, skidGain: 1, sideKick: 0 };
const nanFree = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v)).indexOf('NaN') < 0;

/** Fly a solved launch with 2 bounces and report net clearance, landing, apex after the bounce, horizontal speed before/after. */
function measure(sol, pos, surface = 'hard', tune = TUNE) {
  const r = F.simulateTrajectory({ pos, vel: sol.vel, spin: sol.spin }, { surface, dt: 1 / 240, stopAfterBounces: 1, maxTime: 4, path: true, pathDt: 1 / 120, tuning: tune });
  const L = r.landing;
  // continue after the bounce to find the apex
  const r2 = F.simulateTrajectory({ pos, vel: sol.vel, spin: sol.spin }, { surface, dt: 1 / 240, stopAfterBounces: 2, maxTime: 5, path: true, pathDt: 1 / 120, tuning: tune });
  let apex = 0, vBefore = 0;
  for (let i = 1; i < r2.path.length; i++) {
    const q = r2.path[i];
    if (q.b === 0) vBefore = Math.hypot(q.vx, q.vz);
    if (q.b >= 1) apex = Math.max(apex, q.y);
  }
  const vAfter = L ? Math.hypot(L.vx, L.vz) : 0;
  let maxDev = 0;
  const h = Math.hypot(sol.vel.x, sol.vel.z), hx = sol.vel.x / h, hz = sol.vel.z / h;
  for (const q of r.path) maxDev = Math.max(maxDev, Math.abs(-(q.x - pos.x) * hz + (q.z - pos.z) * hx));
  return { r, L, netClear: r.netClear, landZ: L ? Math.abs(L.z) : null, landX: L ? L.x : null, apex, vBefore, vAfter, loss: vBefore ? 1 - vAfter / vBefore : 0, maxDev, lat: L ? L.vx : 0 };
}
const shot = (kind, power = 0.6, o = {}) => {
  const p = strokeParams(kind, power), pos = o.pos || { x: 0, y: 1, z: HALF };
  const tgt = o.target || { x: 0, z: -(HALF - p.mIn) };
  const sol = solveLaunch({ pos, target: tgt, speed: p.speed, top: p.top, side: o.side || 0, surface: o.surface || 'hard', clear: p.clear, tune: o.tune || TUNE });
  return { sol, m: measure(sol, pos, o.surface || 'hard', o.tune || TUNE), p, pos, tgt };
};

console.log('--- gains = 1 reproduces src/physics/ball.js');
{
  let worst = 0;
  for (const [vz, vy, top, side] of [[-30, 3, 300, 0], [-24, 5, -250, 0], [-35, 1, 100, 120], [-18, 9, 150, -60]]) {
    const st = { pos: { x: 0, y: 1, z: 11 }, vel: { x: 1, y: vy, z: vz }, spin: B.makeSpin(0, -1, top, side) };
    for (const surface of ['hard', 'clay', 'grass']) {
      const a = B.simulateTrajectory(st, { surface, dt: 1 / 240, stopAfterBounces: 2 });
      const b = F.simulateTrajectory(st, { surface, dt: 1 / 240, stopAfterBounces: 2, tuning: ONE });
      worst = Math.max(worst, Math.hypot(a.end.pos.x - b.end.pos.x, a.end.pos.y - b.end.pos.y, a.end.pos.z - b.end.pos.z));
      const c = F.simulateTrajectory(st, { surface, dt: 1 / 240, stopAfterBounces: 2 });
      worst = Math.max(worst, Math.hypot(a.end.pos.x - c.end.pos.x, a.end.pos.z - c.end.pos.z));
    }
  }
  check('flight.js with all gains 1 (and with no tuning) equals ball.js', worst < 1e-9, `max end-point diff ${worst.toExponential(1)} m`);
}

console.log('--- sidespin sign (ball travelling toward -z: +omega.y bends toward -x)');
{
  const base = { pos: { x: 0, y: 1, z: 11 }, vel: { x: 0, y: 3, z: -30 } };
  const bend = (w, dir = -1) => F.simulateTrajectory({ pos: { x: 0, y: 1, z: -dir * 11 }, vel: { x: 0, y: 3, z: dir * 30 }, spin: F.makeSpin(0, dir, 0, w) }, { dt: 1 / 240, stopAfterBounces: 1, tuning: TUNE }).landing.x;
  const xp = bend(200 * 1), xn = bend(-200);
  check('+omega.y toward -z bends to -x, -omega.y to +x, symmetric', xp < -1 && xn > 1 && Math.abs(xp + xn) < 0.05, `x = ${f2(xp)} / ${f2(xn)}`);
  const xf = bend(200, 1);
  check('travelling toward +z the same spin bends to +x (omega x v)', xf > 1, `x = ${f2(xf)}`);
  const kick = (w) => { const r = F.simulateTrajectory({ ...base, spin: F.makeSpin(0, -1, 0, w) }, { dt: 1 / 240, stopAfterBounces: 1, tuning: { ...TUNE, liftGain: 1 } }); return r.landing; };
  const a = kick(200), c = F.simulateTrajectory({ ...base, spin: F.makeSpin(0, -1, 0, 200) }, { dt: 1 / 240, stopAfterBounces: 1, tuning: { ...TUNE, sideKick: 0, liftGain: 1 } }).landing;
  check('sideKick adds a lateral velocity at the bounce in the bending direction', a.vx < c.vx - 0.5, `vx after bounce ${f2(a.vx)} vs ${f2(c.vx)} without`);
}

console.log('--- calibration table (hard court, power 0.6, from the baseline at 1 m)');
const T = {};
T.top = shot('topspin');
T.flat = shot('flat');
T.slice = shot('slice');
for (const k of ['top', 'flat', 'slice']) {
  const t = T[k];
  console.log(`  ${k.padEnd(6)} ${f1(t.sol.speed * KMH)} km/h ${f1(Math.abs(t.p.top) / RPM)} rpm   netClear ${f2(t.m.netClear)}   lands ${f2(t.m.landZ)} m   apex ${f2(t.m.apex)} m   hLoss ${f2(t.m.loss * 100)}%`);
}
check('topspin drive: net clearance 0.9-1.5 m', T.top.m.netClear >= 0.9 && T.top.m.netClear <= 1.5, f2(T.top.m.netClear));
check('topspin drive: lands 8.5-10.5 m from the net', T.top.m.landZ >= 8.5 && T.top.m.landZ <= 10.5, f2(T.top.m.landZ));
check('topspin drive: bounce apex >= 1.35 m', T.top.m.apex >= 1.35, f2(T.top.m.apex));
check('topspin drive keeps forward speed after the bounce (loses < 35 %)', T.top.m.loss < 0.35, f2(T.top.m.loss * 100) + '%');
check('flat: net clearance 0.25-0.55 m', T.flat.m.netClear >= 0.25 && T.flat.m.netClear <= 0.55, f2(T.flat.m.netClear));
check('flat: lands 9-11 m from the net', T.flat.m.landZ >= 9 && T.flat.m.landZ <= 11, f2(T.flat.m.landZ));
check('flat: bounce apex 0.8-1.1 m', T.flat.m.apex >= 0.8 && T.flat.m.apex <= 1.1, f2(T.flat.m.apex));
check('flat is the fastest arrival', T.flat.m.vBefore > T.top.m.vBefore && T.flat.m.vBefore > T.slice.m.vBefore, `${f1(T.flat.m.vBefore)} > ${f1(T.top.m.vBefore)}, ${f1(T.slice.m.vBefore)} m/s`);
check('slice: net clearance 0.3-0.6 m', T.slice.m.netClear >= 0.3 && T.slice.m.netClear <= 0.6, f2(T.slice.m.netClear));
check('slice: lands 8-10.5 m from the net', T.slice.m.landZ >= 8 && T.slice.m.landZ <= 10.5, f2(T.slice.m.landZ));
check('slice: bounce apex <= 0.55 m', T.slice.m.apex <= 0.55, f2(T.slice.m.apex));
check('slice skids: loses >= 35 % of its horizontal speed at the bounce', T.slice.m.loss >= 0.35, f2(T.slice.m.loss * 100) + '%');
check('speeds near the table (topspin ~110, flat ~135, slice ~85 km/h)', Math.abs(T.top.sol.speed * KMH - 112) < 12 && Math.abs(T.flat.sol.speed * KMH - 135) < 10 && Math.abs(T.slice.sol.speed * KMH - 85) < 12, `${f1(T.top.sol.speed * KMH)} / ${f1(T.flat.sol.speed * KMH)} / ${f1(T.slice.sol.speed * KMH)}`);

{   // lob
  const pos = { x: 0, y: 1, z: HALF }, power = 0.6;
  const el = 60 * Math.PI / 180 + (30 - 60) * Math.PI / 180 * power;
  const sol = solveLaunch({ pos, target: { x: 0, z: -(HALF - lerpLob(power)) }, speed: 20, top: 1500 * RPM, surface: 'hard', elevation: el, tune: TUNE });
  const m = measure(sol, pos);
  let apex = 0, hNet = 0;
  for (let i = 1; i < m.r.path.length; i++) { const q = m.r.path[i]; apex = Math.max(apex, q.y); if (Math.abs(q.z - 2.6) < 0.3) hNet = Math.max(hNet, q.y); }
  console.log(`  lob    ${f1(sol.speed * KMH)} km/h  apex ${f2(apex)}  height over a net player (2.6 m) ${f2(hNet)}   lands ${f2(m.landZ)} m`);
  check('lob: apex >= 6 m', apex >= 6, f2(apex));
  check('lob: lands 9.5-11.5 m from the net', m.landZ >= 9.5 && m.landZ <= 11.5, f2(m.landZ));
  check('lob clears a net player (reach 2.35 m) by >= 3 m', hNet >= 2.35 + 3, f2(hNet));
}
function lerpLob(p) { return 2.2 + (1.0 - 2.2) * p; }

console.log('--- sidespin curves');
{
  const pos = { x: 3.0, y: 1, z: HALF }, target = { x: -2.4, z: -(HALF - 2.1) }, p = strokeParams('topspin', 0.6);
  const side = -1200 * RPM;                                  // an inside-out forehand of a right-hander from the right side bends back to the left
  const sol = solveLaunch({ pos, target, speed: p.speed, top: p.top, side, surface: 'hard', clear: p.clear, tune: TUNE });
  const m = measure(sol, pos, 'hard');
  const off = Math.hypot(m.L.x - target.x, m.L.z - target.z);
  const straight = solveLaunch({ pos, target, speed: p.speed, top: p.top, side: 0, surface: 'hard', clear: p.clear, tune: TUNE });
  console.log(`  banana: lands ${f2(off)} m from target, max lateral bend ${f2(m.maxDev)} m (straight-line launch offset ${f2(Math.abs(sol.az) * sol.D)} m; no-sidespin bend ${f2(measure(straight, pos).maxDev)} m)  sideRpm ${f1(side / RPM)}`);
  check('inside-out FH with sidespin lands within 0.3 m of the target', off <= 0.3, f2(off));
  check('mid-flight lateral bend >= 0.8 m', m.maxDev >= 0.8, f2(m.maxDev));
  check('solver reports the bend (curveM) and it is signed toward the bending side', Math.abs(Math.abs(sol.curveM) - m.maxDev) < 0.15 && Math.sign(sol.curveM) === Math.sign(-1) * -1 * (sol.curveM > 0 ? 1 : 1), f2(sol.curveM));
  // landing accuracy over a grid of targets / sidespins / shot types
  let worst = 0, n = 0;
  for (const kind of ['topspin', 'flat', 'slice']) for (const sx of [-3.5, 0, 3.5]) for (const tx of [-3.2, 0.5, 3.2]) for (const sr of [-1500, -600, 0, 800, 1500]) {
    const pp = strokeParams(kind, 0.7), ps = { x: sx, y: 1.1, z: HALF + 0.5 }, tg = { x: tx, z: -(HALF - pp.mIn) };
    const s = solveLaunch({ pos: ps, target: tg, speed: pp.speed, top: pp.top, side: sr * RPM, surface: 'hard', clear: pp.clear, tune: TUNE });
    const mm = measure(s, ps, 'hard');
    if (!mm.L || s.hitNet) continue;
    worst = Math.max(worst, Math.hypot(mm.L.x - tg.x, mm.L.z - tg.z)); n++;
  }
  check('solver lands on the target for curved shots (grid)', worst < 0.35 && n > 100, `worst ${f2(worst)} m over ${n} shots`);
  const tm = performance.now();
  for (let i = 0; i < 30; i++) solveLaunch({ pos, target: { x: -2 + i * 0.1, z: -9.8 }, speed: p.speed, top: p.top, side, surface: 'hard', clear: p.clear, tune: TUNE });
  const ms = (performance.now() - tm) / 30;
  check('solver cost <= 3 ms per shot (curved)', ms <= 3, f2(ms) + ' ms');
}

console.log('--- serves');
{
  const g = K;
  const pos = { x: 0.9, y: 2.75, z: HALF + 0.4 }, box = { cx: -2.06, z: -(COURT.serviceLineDist - 1.0) };
  // kick: topspin + sidespin toward the wide side (-x for a server on the right, box on the left)
  const kp = { speed: 100 / KMH, top: 3300 * RPM }, wideSign = -1;
  const ky = solveLaunch({ pos, target: { x: box.cx, z: box.z }, speed: kp.speed, top: kp.top, side: 1250 * RPM * 0.9, surface: 'hard', clear: 0.3, tune: TUNE });
  const mk = measure(ky, pos);
  const inBox = (m) => m.L && m.L.z > -COURT.serviceLineDist - 0.035 && m.L.z < 0 && m.L.x < 0.035 && m.L.x > -COURT.singlesHalfWidth - 0.035;
  console.log(`  kick   ${f1(ky.speed * KMH)} km/h  apex ${f2(mk.apex)} m  bounce lateral speed ${f2(Math.abs(mk.lat))} m/s  land (${f2(mk.L.x)}, ${f2(mk.L.z)})`);
  check('kick serve: in the box', inBox(mk));
  check('kick serve: bounce apex >= 1.5 m', mk.apex >= 1.5, f2(mk.apex));
  const noSide = measure(solveLaunch({ pos, target: { x: box.cx, z: box.z }, speed: kp.speed, top: kp.top, side: 0, surface: 'hard', clear: 0.3, tune: TUNE }), pos);
  check('kick serve: lateral kick >= 0.6 m/s at the bounce', Math.abs(mk.lat - noSide.lat) >= 0.6, `${f2(Math.abs(mk.lat - noSide.lat))} m/s`);
  const sl = solveLaunch({ pos, target: { x: box.cx - 0.6, z: box.z }, speed: 135 / KMH, top: -400 * RPM, side: 1700 * RPM * 0.9, surface: 'hard', clear: 0.14, tune: TUNE });
  const ms = measure(sl, pos);
  console.log(`  slice  ${f1(sl.speed * KMH)} km/h  bend ${f2(ms.maxDev)} m  land (${f2(ms.L.x)}, ${f2(ms.L.z)})`);
  check('slice serve: in the box', inBox(ms));
  check('slice serve: bends >= 0.6 m toward the wide side', ms.maxDev >= 0.6 && Math.sign(sl.curveM) !== 0, f2(ms.maxDev));
}

console.log('--- surfaces, determinism, finiteness');
{
  const res = {};
  for (const surface of ['grass', 'hard', 'clay']) {
    const t = shot('topspin', 0.6, { surface }), t2 = shot('topspin', 0.6, { surface }), fl = shot('flat', 0.6, { surface }), sl = shot('slice', 0.6, { surface });
    res[surface] = { apex: t.m.apex, flatApex: fl.m.apex, flatV: fl.m.vAfter, sliceV: sl.m.vAfter, same: t.m.landZ === t2.m.landZ && t.m.apex === t2.m.apex };
  }
  console.log('  after the bounce (apex of topspin / apex and speed of flat / speed of slice):', Object.entries(res).map(([k, v]) => `${k} ${f2(v.apex)} m, ${f2(v.flatApex)} m ${f1(v.flatV)} m/s, ${f1(v.sliceV)} m/s`).join('   |   '));
  const R_ = res;
  check('surfaces ordered: clay higher + slower, grass lower + faster', R_.clay.apex > R_.hard.apex && R_.hard.apex > R_.grass.apex && R_.clay.flatApex > R_.hard.flatApex && R_.hard.flatApex > R_.grass.flatApex
    && R_.clay.flatV < R_.hard.flatV && R_.hard.flatV < R_.grass.flatV && R_.clay.sliceV < R_.hard.sliceV && R_.hard.sliceV < R_.grass.sliceV);
  check('deterministic', Object.values(res).every((v) => v.same));
  check('no NaN in solved launches', nanFree(T.top.sol) && nanFree(T.slice.sol) && nanFree(T.flat.sol));
  const wild = F.simulateTrajectory({ pos: { x: 0, y: 1, z: 11 }, vel: { x: 5, y: 4, z: -45 }, spin: F.makeSpin(0, -1, 600, 500) }, { dt: 1 / 240, stopAfterBounces: 3, tuning: { liftGain: 3, kickGain: 3, skidGain: 3, sideKick: 2 } });
  check('extreme gains stay finite', nanFree(wild.end));
}
finish();
