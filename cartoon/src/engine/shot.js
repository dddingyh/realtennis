// Shot model: stroke table, launch solver (shooting method on simulateTrajectory) and scatter. DOM-free, pure.
import { COURT } from '../../../src/config.js';
import { simulateTrajectory, makeSpin } from '../../../src/physics/ball.js';

const RPM = Math.PI / 30;
const KMH = 1 / 3.6;
const SOLVE_DT = 1 / 60;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
export { clamp, lerp };

/**
 * Stroke table. v: launch speed km/h for power 0..1; top: spin rpm (+topspin / -backspin);
 * mIn: metres inside the baseline of the target for power 0..1 (deeper with more power);
 * clear: required net clearance (m, ball bottom above the tape) - flatter shots may skim, spinny ones arc.
 */
export const STROKES = {
  topspin: { v: [90, 138], top: [2200, 3300], mIn: [3.0, 1.5], clear: 0.50 },
  flat:    { v: [106, 158], top: [250, 900],   mIn: [2.9, 1.1], clear: 0.28 },
  slice:   { v: [66, 106],  top: [-2900, -1900], mIn: [3.0, 1.7], clear: 0.35 },
  volley:  { v: [40, 112], top: [-1200, -300], mIn: [3.4, 1.4], clear: 0.16 },
  smash:   { v: [100, 155], top: [300, 900],   mIn: [3.4, 1.6], clear: 0.12 },
};
/** Soft slice / soft volley below this power is a drop shot. */
export const DROP_POWER = 0.26;
/** Lob elevation (rad) for power 0 (high, safe) .. 1 (low, offensive). */
export const LOB_EL = [60 * Math.PI / 180, 30 * Math.PI / 180];

export function strokeParams(kind, power) {
  const s = STROKES[kind];
  const p = clamp(power, 0, 1);
  return {
    speed: lerp(s.v[0], s.v[1], p) * KMH,
    top: lerp(s.top[0], s.top[1], p) * RPM,
    mIn: lerp(s.mIn[0], s.mIn[1], p),
    clear: s.clear,
  };
}

function fly(pos, v, el, hx, hz, top, surface, dt = SOLVE_DT) {
  const ce = Math.cos(el);
  return simulateTrajectory(
    { pos, vel: { x: v * ce * hx, y: v * Math.sin(el), z: v * ce * hz }, spin: makeSpin(hx, hz, top) },
    { surface, dt, stopAfterBounces: 1, maxTime: 4.5 },
  );
}
const rangeOf = (r, pos, hx, hz) => {
  const p = r.landing || r.end.pos;
  return (p.x - pos.x) * hx + (p.z - pos.z) * hz;
};

/**
 * Solve a launch so that the first bounce lands at `target`.
 * spec: {pos, target:{x,z}, speed (m/s), top (rad/s), surface, clear, elevation?(rad: fixed elevation, solves speed)}
 * returns {vel, spin, speed, el, hx, hz, D, slope (m of range per rad of elevation, or per m/s for fixedEl),
 *          landing, netClear, ok}
 */
export function solveLaunch(spec) {
  const { pos, target, top, surface } = spec;
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const D = Math.hypot(dx, dz) || 1;
  const hx = dx / D, hz = dz / D;
  const clear = spec.clear ?? 0.15;
  let v = Math.max(5, spec.speed), el = 0, r, slope = 60, slopeV = 1;
  if (spec.elevation !== undefined) {
    // lob: fixed elevation, bisect speed
    el = spec.elevation;
    let lo = 6, hi = 40;
    for (let i = 0; i < 11; i++) {
      const mid = 0.5 * (lo + hi);
      if (rangeOf(fly(pos, mid, el, hx, hz, top, surface), pos, hx, hz) < D) lo = mid; else hi = mid;
    }
    v = hi;
    r = fly(pos, v, el, hx, hz, top, surface);
    const r2 = fly(pos, v + 0.4, el, hx, hz, top, surface);
    slope = Math.max(0.5, (rangeOf(r2, pos, hx, hz) - rangeOf(r, pos, hx, hz)) / 0.4);
  } else {
    const elLo = -0.9, elHi = 0.72;
    for (let attempt = 0; attempt < 16; attempt++) {
      // enough range at the highest elevation?
      if (rangeOf(fly(pos, v, elHi, hx, hz, top, surface), pos, hx, hz) < D) { v *= 1.15; continue; }
      let lo = elLo, hi = elHi;
      for (let i = 0; i < 11; i++) {
        const mid = 0.5 * (lo + hi);
        if (rangeOf(fly(pos, v, mid, hx, hz, top, surface), pos, hx, hz) < D) lo = mid; else hi = mid;
      }
      el = hi;
      r = fly(pos, v, el, hx, hz, top, surface);
      if (!r.hitNet && (r.netClear === null || r.netClear >= clear)) break;
      v *= attempt < 5 ? 0.93 : 0.86;
      if (v < 6) break;
    }
    const r2 = fly(pos, v, el + 0.01, hx, hz, top, surface);
    slope = Math.max(15, (rangeOf(r2, pos, hx, hz) - rangeOf(r, pos, hx, hz)) / 0.01);
    const r3 = fly(pos, v + 0.5, el, hx, hz, top, surface);
    slopeV = Math.max(0.3, (rangeOf(r3, pos, hx, hz) - rangeOf(r, pos, hx, hz)) / 0.5);
  }
  const ce = Math.cos(el);
  return {
    vel: { x: v * ce * hx, y: v * Math.sin(el), z: v * ce * hz },
    spin: makeSpin(hx, hz, top), speed: v, el, hx, hz, D, slope, slopeV, top,
    fixedEl: spec.elevation !== undefined,
    landing: r.landing ? { x: r.landing.x, z: r.landing.z } : null,
    netClear: r.netClear, hitNet: r.hitNet,
    ok: !!r.landing && !r.hitNet,
  };
}

/**
 * Perturb a solved launch by landing-error sigmas (metres): depth (along the shot) and lateral.
 * The depth error is applied through the elevation (or speed for a lob) so net / long errors emerge from physics.
 */
export function scatterLaunch(sol, sigmaDepth, sigmaLat, rng, sigmaClear = 0) {
  let { speed: v, el } = sol;
  if (sol.fixedEl) v += rng.gauss(0, sigmaDepth / sol.slope);
  else {
    el += rng.gauss(0, sigmaDepth / sol.slope);
    if (sigmaClear > 0) {                       // move along the iso-depth curve: same landing depth, different net clearance
      const eps = rng.gauss(0, sigmaClear / 11);
      el += eps; v -= eps * sol.slope / sol.slopeV;
    }
  }
  v *= 1 + rng.gauss(0, 0.004);
  const az = rng.gauss(0, sigmaLat / sol.D);
  const c = Math.cos(az), s = Math.sin(az);
  const hx = sol.hx * c - sol.hz * s, hz = sol.hx * s + sol.hz * c;
  const ce = Math.cos(el);
  return {
    vel: { x: v * ce * hx, y: v * Math.sin(el), z: v * ce * hz },
    spin: makeSpin(hx, hz, sol.top), speed: v, el, hx, hz,
  };
}

// ---- court helpers
export const LINE_TOL = 0.035;
export function inCourt(x, z) {
  return Math.abs(x) <= COURT.singlesHalfWidth + LINE_TOL && Math.abs(z) <= COURT.halfLength + LINE_TOL;
}
/** Service box test; boxSign = sign of x of the receiving box, side = sign of z of the receiving side. */
export function inServiceBox(x, z, boxSign, side) {
  return Math.sign(z) === side && Math.abs(z) <= COURT.serviceLineDist + LINE_TOL
    && x * boxSign >= -LINE_TOL && Math.abs(x) <= COURT.singlesHalfWidth + LINE_TOL;
}
