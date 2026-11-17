// Shot model: stroke table, launch solver (shooting method on simulateTrajectory) and scatter. DOM-free, pure.
import { COURT } from '../../../src/config.js';
import { simulateTrajectory, makeSpin } from './flight.js';

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

function fly(pos, v, el, hx, hz, top, side, surface, tune, dt = SOLVE_DT, path = false) {
  const ce = Math.cos(el);
  return simulateTrajectory(
    { pos, vel: { x: v * ce * hx, y: v * Math.sin(el), z: v * ce * hz }, spin: makeSpin(hx, hz, top, side) },
    { surface, dt, stopAfterBounces: 1, maxTime: 4.5, tuning: tune, path, pathDt: 1 / 30 },
  );
}
/** Radial distance of the first bounce from the launch point (m); short flights that never bounce count as 0. */
const radial = (r, pos) => { const p = r.landing || r.end.pos; return Math.hypot(p.x - pos.x, p.z - pos.z); };

/**
 * 2-D shooting solver: find elevation (depth) AND azimuth (lateral) so that the first bounce lands at `target` even though
 * sidespin / Magnus bend the flight (the launch line starts off the target and the ball bends in).
 * spec: {pos, target:{x,z}, speed (m/s), top (rad/s), side? (rad/s about the vertical axis), surface, clear, tune?, elevation?(rad: fixed elevation, solves speed)}
 * returns {vel, spin, speed, el, hx, hz, az, D, slope, slopeV, side, landing, netClear, curveM, ok}
 */
export function solveLaunch(spec) {
  const { pos, target, top, surface } = spec;
  const side = spec.side || 0, tune = spec.tune || null;
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const D = Math.hypot(dx, dz) || 1;
  const h0x = dx / D, h0z = dz / D;
  const clear = spec.clear ?? 0.15;
  const dirAt = (az) => { const c = Math.cos(az), s = Math.sin(az); return [h0x * c - h0z * s, h0x * s + h0z * c]; };
  const fixedEl = spec.elevation !== undefined;
  let v = Math.max(5, spec.speed), el = fixedEl ? spec.elevation : 0, az = 0, r, hx = h0x, hz = h0z, slope = 60, slopeV = 1;
  // solve the free variable (elevation, or speed for a lob) so that the bounce is at radial distance D along the launch azimuth
  const solveRange = (wide) => {
    [hx, hz] = dirAt(az);
    if (fixedEl) {
      let lo = wide ? 6 : v * 0.8, hi = wide ? 40 : v * 1.25;
      for (let i = 0; i < (wide ? 11 : 7); i++) {
        const mid = 0.5 * (lo + hi);
        if (radial(fly(pos, mid, el, hx, hz, top, side, surface, tune), pos) < D) lo = mid; else hi = mid;
      }
      v = hi;
    } else {
      let lo = wide ? -0.9 : el - 0.07, hi = wide ? 0.72 : el + 0.07;
      if (!wide && (radial(fly(pos, v, hi, hx, hz, top, side, surface, tune), pos) < D || radial(fly(pos, v, lo, hx, hz, top, side, surface, tune), pos) > D)) { lo = -0.9; hi = 0.72; }
      for (let i = 0; i < (wide ? 11 : 8); i++) {
        const mid = 0.5 * (lo + hi);
        if (radial(fly(pos, v, mid, hx, hz, top, side, surface, tune), pos) < D) lo = mid; else hi = mid;
      }
      el = hi;
    }
    r = fly(pos, v, el, hx, hz, top, side, surface, tune);
  };
  const crossAngle = () => {
    const p = r.landing || r.end.pos, ex = p.x - pos.x, ez = p.z - pos.z;
    return Math.atan2(h0x * ez - h0z * ex, h0x * ex + h0z * ez);           // angle of the landing direction relative to the target line
  };
  for (let attempt = 0; attempt < 16; attempt++) {
    if (!fixedEl && radial(fly(pos, v, 0.72, ...dirAt(az), top, side, surface, tune), pos) < D) { v *= 1.15; continue; }
    solveRange(true);
    for (let k = 0; k < 3; k++) {
      const phi = crossAngle();
      if (Math.abs(phi) * D < 0.03) break;
      az -= phi * 0.95;
      solveRange(false);
    }
    if (fixedEl || (!r.hitNet && (r.netClear === null || r.netClear >= clear))) break;
    v *= attempt < 5 ? 0.93 : 0.86;
    if (v < 6) break;
  }
  if (!r) solveRange(true);                                    // (range never reachable: use the best effort)
  [hx, hz] = dirAt(az);
  if (fixedEl) {
    const r2 = fly(pos, v + 0.4, el, hx, hz, top, side, surface, tune);
    slope = Math.max(0.5, (radial(r2, pos) - radial(r, pos)) / 0.4);
  } else {
    const r2 = fly(pos, v, el + 0.01, hx, hz, top, side, surface, tune);
    slope = Math.max(15, (radial(r2, pos) - radial(r, pos)) / 0.01);
    const r3 = fly(pos, v + 0.5, el, hx, hz, top, side, surface, tune);
    slopeV = Math.max(0.3, (radial(r3, pos) - radial(r, pos)) / 0.5);
  }
  // maximum lateral deviation of the real flight from the straight launch line (signed, + = toward +x)
  let curveM = 0;
  if (side !== 0 || tune) {
    const rp = fly(pos, v, el, hx, hz, top, side, surface, tune, SOLVE_DT, true);
    for (const q of rp.path) {
      const d = (-(q.x - pos.x) * hz + (q.z - pos.z) * hx) * (hz <= 0 ? 1 : -1);   // lateral offset from the launch line, + = toward +x (world), for either court end
      if (Math.abs(d) > Math.abs(curveM)) curveM = d;
    }
  }
  const ce = Math.cos(el);
  return {
    vel: { x: v * ce * hx, y: v * Math.sin(el), z: v * ce * hz },
    spin: makeSpin(hx, hz, top, side), speed: v, el, hx, hz, az, D, slope, slopeV, top, side, tune,
    fixedEl,
    landing: r.landing ? { x: r.landing.x, z: r.landing.z } : null,
    netClear: r.netClear, hitNet: r.hitNet, curveM, landVy: r.landing ? r.landing.vy : undefined,
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
    spin: makeSpin(hx, hz, sol.top, sol.side || 0), speed: v, el, hx, hz,
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
