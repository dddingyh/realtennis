// Ball path prediction and interception planning, shared by the AI and the human auto-move assist.
// DOM-free.

import { simulateTrajectory } from '../physics/ball.js';
import { COURT } from '../config.js';
import { IDEAL_F, IDEAL_LAT } from './shot.js';

/**
 * Predict the ball path (sampled). Times are relative to now.
 * @returns {Array<{t,x,y,z,vx,vy,vz,b}>}
 */
export function predictPath(ball, surface, opts = {}) {
  const r = simulateTrajectory(ball, {
    surface, dt: 1 / 120, pathDt: 1 / 60, path: true,
    maxTime: opts.maxTime ?? 4.5, stopAfterBounces: opts.stopAfterBounces ?? 2,
  });
  return { path: r.path, result: r };
}

/**
 * Time (s) for a player starting at rest to travel `d` metres and stop there, with the locomotion model of player.js:
 * drive a(v) = a0 (1 - v/vmax) (v(t) = vmax (1 - e^{-t/tau}), tau = vmax/a0) and planned braking steps at the end.
 * Short lateral moves are side shuffles (lower top speed).
 */
export function travelTime(d, vmax, a0 = 20, brake = 7) {
  if (d <= 0.3) return d / 2.5;                         // inside the hysteresis band: a quick adjustment step
  const vm = d <= 2.5 ? Math.min(vmax, 3.6) : vmax;
  const tau = vm / a0;
  // distance covered while accelerating for t, plus the braking distance from the reached speed
  const dist = (t) => { const v = vm * (1 - Math.exp(-t / tau)); return vm * (t - tau * (1 - Math.exp(-t / tau))) + v * v / (2 * brake); };
  let lo = 0, hi = 0.2 + d / vm * 2 + 1;
  for (let i = 0; i < 24; i++) { const m = 0.5 * (lo + hi); if (dist(m) < d) lo = m; else hi = m; }
  const v = vm * (1 - Math.exp(-hi / tau));
  return hi + v / brake;
}

/**
 * Choose where/when to meet the ball.
 * @param {Array} path from predictPath
 * @param {{pos,vel,facing,hand}} me
 * @param {object} prefs {vmax, accel, reactDelay, allowVolley, yMin, yMax, prefY, prefDepth, timeBias,
 *                        noiseX, noiseZ, rng, volleyYMin}
 * @returns {null|{t:number, ball:{x,y,z}, stand:{x,z}, side:'fh'|'bh', bounces:number, feasible:boolean, tNeed:number}}
 */
export function planInterception(path, me, prefs = {}) {
  const vmax = prefs.vmax ?? 6, acc = prefs.accel ?? 20;
  const react = prefs.reactDelay ?? 0;
  const yMin = prefs.yMin ?? 0.4, yMax = prefs.yMax ?? 1.8;
  const prefY = prefs.prefY ?? 0.95, prefDepth = prefs.prefDepth ?? 0.5;
  const timeBias = prefs.timeBias ?? 0;
  const handX = (me.hand === 'R' ? 1 : -1) * me.facing;
  const rng = prefs.rng;
  let best = null, bestScore = Infinity, fallback = null, fbScore = Infinity;
  const nx = prefs.noiseX ? rng.gauss(0, prefs.noiseX) : 0;
  const nz = prefs.noiseZ ? rng.gauss(0, prefs.noiseZ) : 0;
  for (let i = 1; i < path.length; i++) {
    const s = path[i];
    if (s.t < 0.02) continue;
    if (s.z * me.facing < 0.3) continue;                 // must be on my side
    const volley = s.b === 0;
    if (volley && !prefs.allowVolley) continue;
    if (s.b > 1) continue;
    const ylo = volley ? (prefs.volleyYMin ?? 0.55) : yMin;
    const yhi = volley ? (prefs.volleyYMax ?? 2.0) : yMax;
    if (s.y < ylo || s.y > yhi) continue;
    // two possible stands: forehand / backhand
    const sx = s.x + nx, sz = s.z + nz;
    const standZ = sz + me.facing * IDEAL_F;
    const fx = sx - handX * IDEAL_LAT, bx = sx + handX * IDEAL_LAT;
    const df = Math.hypot(fx - me.pos.x, standZ - me.pos.z);
    const db = Math.hypot(bx - me.pos.x, standZ - me.pos.z);
    // prefer the forehand a little
    const useF = df <= db + 0.35;
    const d = useF ? df : db;
    const tNeed = react + travelTime(d, vmax, acc);
    const slack = s.t - 0.03 - tNeed;
    const depthBehind = Math.abs(s.z) - COURT.halfLength;
    let sc;
    if (volley) sc = Math.abs(s.y - (prefs.volleyY ?? 1.2)) * 0.5 + Math.abs(Math.abs(s.z) - (prefs.volleyZ ?? 4)) * 0.1 + (prefs.volleyBias ?? 0) + timeBias * 0.1 * s.t;
    else sc = Math.abs(s.y - prefY) * 0.8 + Math.abs(depthBehind - prefDepth) * 0.12 + timeBias * 0.25 * s.t;
    const tol = volley ? (prefs.volleyTol ?? 0) : 0;
    const cand = { t: s.t, ball: { x: s.x, y: s.y, z: s.z }, stand: { x: useF ? fx : bx, z: standZ }, side: useF ? 'fh' : 'bh', bounces: s.b, feasible: slack >= -tol, tNeed, slack };
    if (slack >= -tol) { if (sc < bestScore) { bestScore = sc; best = cand; } }
    else { const f = -slack + sc * 0.2; if (f < fbScore) { fbScore = f; fallback = cand; } }
  }
  return best || fallback;
}
