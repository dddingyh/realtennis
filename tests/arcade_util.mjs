// Shared helpers for the arcade tests (not a test itself).
import { ArcadeSim } from '../cartoon/src/sim/arcade.js';
import { netHeightAt } from '../src/physics/ball.js';
import { COURT } from '../src/config.js';

export const HALF = COURT.halfLength;
export const H = 1 / 120;

let failed = 0, passed = 0;
export function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
export function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
export const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));

/** Two human-controlled players (nothing moves the sim except the test). */
export function mkSim(o = {}) {
  const { hand0 = 'R', hand1 = 'R', ...rest } = o;
  const sim = new ArcadeSim({
    seed: 1, timeScale: 1,
    players: [{ human: true, hand: hand0, name: 'A' }, { human: true, hand: hand1, name: 'B' }],
    ...rest,
  });
  sim.log = [];
  return sim;
}
export function stepOnce(sim) {
  sim.step(H / sim.timeScale);
  const ev = sim.drainEvents();
  for (const e of ev) sim.log.push(e);
  return ev;
}
export function flush(sim) { for (const e of sim.drainEvents()) sim.log.push(e); }
export function stepTo(sim, t) { while (sim.time < t - 1e-9) stepOnce(sim); }
export function stepWhile(sim, cond, max = 20000) { let n = 0; while (cond() && n++ < max) stepOnce(sim); return n < max; }

/** Serve with player `srv` (default current server): toss, hit at apex + offsetMs. Returns after the hit. */
export function doServe(sim, { offsetMs = 0, power = 0.9, source = 'keyboard' } = {}) {
  stepWhile(sim, () => sim.phase !== 'serving');
  const srv = sim.match.server;
  sim.swing(srv, { source });
  stepWhile(sim, () => sim.sv.stage !== 'flight');
  stepTo(sim, sim.sv.tIdeal + offsetMs / 1000);
  sim.swing(srv, { power, source });
  flush(sim);
  return srv;
}

/** Wait for player i's plan, step to contact + offsetMs, then swing; returns {plan, hit}. */
export function swingAt(sim, i, offsetMs, o = {}) {
  stepWhile(sim, () => !sim.P[i].plan && sim.phase === 'rally');
  const p = sim.P[i];
  if (!p.plan) return null;
  const side = p.plan.side, kind = p.plan.kind;
  const planBefore = p.plan;
  const age = (o.ageMs || 0) * sim.timeScale / 1000;
  stepWhile(sim, () => p.plan && !p.plan.swing && sim.time < p.plan.tContact + offsetMs / 1000 + age - 1e-9);
  if (!p.plan) return null;
  const before = sim.lastShot;
  const tContact = p.plan.tContact;
  const ok = sim.swing(i, { shot: o.shot || 'topspin', power: o.power ?? 0.6, ageMs: o.ageMs || 0, source: o.source || 'keyboard' });
  flush(sim);
  stepWhile(sim, () => sim.lastShot === before && sim.phase === 'rally' && sim.time < tContact + 0.6, 400);
  return { plan: planBefore, side, kind, ok, hit: sim.lastShot !== before ? sim.lastShot : null, tContact };
}

/** Follow the ball after a hit: first bounce, net crossing clearance and the apex after the bounce. */
export function flightInfo(sim, maxT = 3.5) {
  const out = { landing: null, netClear: null, netY: null, apexAfter: null, ys: [], zAtY: null };
  const t0 = sim.time;
  let prevZ = sim.b.pos.z, prevY = sim.b.pos.y, bounced = false, descending = false, netHit = false, hitterSide = Math.sign(sim.b.pos.z);
  while (sim.time - t0 < maxT && sim.phase === 'rally') {
    const ev = stepOnce(sim);
    const b = sim.b;
    if (!out.crossed && Math.sign(b.pos.z) !== Math.sign(prevZ) && prevZ !== 0) {
      const f = prevZ / (prevZ - b.pos.z);
      const x = sim.b.pos.x, y = prevY + (b.pos.y - prevY) * f;
      out.netY = y; out.netClear = y - netHeightAt(x) - 0.0335; out.crossed = true;
    }
    for (const e of ev) {
      if (e.type === 'bounce' && !out.landing) { out.landing = { x: e.pos.x, z: e.pos.z, in: e.in }; bounced = true; out.apexAfter = 0; out.hAfter = Math.hypot(b.vel.x, b.vel.z); }
      if (e.type === 'net' && !e.cord) netHit = true;
    }
    if (bounced) {
      out.apexAfter = Math.max(out.apexAfter, b.pos.y);
      if (b.vel.y < 0 && b.pos.y < 0.6) break;
    }
    if (netHit) { out.netHit = true; break; }
    prevZ = b.pos.z; prevY = b.pos.y;
  }
  return out;
}

/** Height of the ball when it passes z = zq (towards decreasing |z|); steps until the first bounce. */
export function heightAtZ(sim, zq, maxT = 3.5) {
  const t0 = sim.time;
  let prevZ = sim.b.pos.z, prevY = sim.b.pos.y;
  while (sim.time - t0 < maxT && sim.phase === 'rally') {
    stepOnce(sim);
    const b = sim.b;
    if ((prevZ - zq) * (b.pos.z - zq) <= 0 && prevZ !== b.pos.z) return prevY + (b.pos.y - prevY) * ((prevZ - zq) / (prevZ - b.pos.z));
    prevZ = b.pos.z; prevY = b.pos.y;
  }
  return null;
}

export function allFinite(o, path = 'state', seen = new Set()) {
  if (typeof o === 'number') return Number.isFinite(o) ? null : path;
  if (!o || typeof o !== 'object' || seen.has(o)) return null;
  seen.add(o);
  for (const k of Object.keys(o)) { const r = allFinite(o[k], path + '.' + k, seen); if (r) return r; }
  return null;
}
