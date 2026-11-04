// Tennis rig: keyframed athletic poses + two-bone IK.
//
// Character space: x = character's right, y = up, z = forward (towards the net while hitting). All keyframes are
// authored for a RIGHT-handed player in a "stance frame" (no global yaw); pelvis and chest yaw are explicit so that
// the kinetic chain (legs -> hips -> shoulders -> arm) reads. Left-handers are produced by mirroring x at the end.
//
//   poseFor(anim, ctx) -> P   (plain parameter object)
//   solve(P, hand)     -> J   (joint positions, frames and racket pose; consumed by char_model.js)
import { SERVE_T, TOSS, serveTime, tossHand, contactPoint, rootOffset, dribble, PALM_BELOW_BALL } from '../game/serve_choreo.js';
const TAU = Math.PI * 2;
import { locoPose } from './char_loco.js';
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerpV = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);
const V = (x, y, z) => [x, y, z];

export const BODY = {
  hipHalf: 0.095, thigh: 0.445, shin: 0.425, ankleH: 0.085,
  upperArm: 0.305, foreArm: 0.265, shoulderHalf: 0.186,
  spine: 0.60, waist: 0.24, gripT: 0.085, // grip centre measured from the racket butt
};

// ------------------------------------------------------------------ pose parameters
const SCHEMA = [
  ['hip', 3], ['lean', 1], ['side', 1], ['py', 1], ['cy', 1], ['hy', 1], ['hp', 1],
  ['fL', 3], ['fR', 3], ['fLy', 1], ['fRy', 1], ['fLp', 1], ['fRp', 1],
  ['hD', 3], ['ax', 3], ['fc', 3], ['hO', 3], ['th', 1], ['offT', 1], ['yaw', 1],
];
const N = SCHEMA.reduce((s, e) => s + e[1], 0);
const READY = {
  hip: V(0, 0.79, -0.06), lean: 0.30, side: 0, py: 0.0, cy: 0.06, hy: 0, hp: 0.06,
  fL: V(-0.34, 0, 0.04), fR: V(0.34, 0, -0.04), fLy: -0.10, fRy: 0.10, fLp: 0, fRp: 0,
  hD: V(0.13, 1.00, 0.36), ax: V(0.06, 0.52, 0.85), fc: V(0.75, 0.55, 0), hO: V(-0.1, 1.05, 0.35), th: 1, offT: 0.2, yaw: 0,
};
const mk = (o) => { const p = {}; for (const [k, n] of SCHEMA) { const v = o && o[k] !== undefined ? o[k] : READY[k]; p[k] = n === 1 ? v : v.slice(); } return p; };
function pack(p) { const a = new Float64Array(N); let i = 0; for (const [k, n] of SCHEMA) { if (n === 1) a[i++] = p[k]; else for (let j = 0; j < n; j++) a[i++] = p[k][j]; } return a; }
function unpack(a) { const p = {}; let i = 0; for (const [k, n] of SCHEMA) { if (n === 1) p[k] = a[i++]; else { p[k] = [a[i], a[i + 1], a[i + 2]]; i += 3; } } p.ax = norm(p.ax); p.fc = norm(p.fc); return p; }

// Keyframe track: [[t, overrides-on-READY], ...] sampled with a non-uniform Catmull-Rom spline (flowing motion, no
// stop-and-go at every key). `base` lets a track inherit from another pose instead of READY.
function track(keys) {
  const T = keys.map((k) => k[0]);
  const A = keys.map((k) => pack(mk(k[1])));
  return { T, A };
}
function sample(tr, t) {
  const { T, A } = tr, n = T.length;
  t = clamp(t, T[0], T[n - 1]);
  let i = 0; while (i < n - 2 && t > T[i + 1]) i++;
  const t0 = T[i], t1 = T[i + 1], h = t1 - t0, u = h > 0 ? (t - t0) / h : 0;
  const out = new Float64Array(N);
  const tan = (j, side) => { // tangent at key j (per second of phase), one-sided at the ends
    const a = j > 0 ? j - 1 : j, b = j < n - 1 ? j + 1 : j;
    return [a, b];
  };
  const [a0, b0] = tan(i), [a1, b1] = tan(i + 1);
  const d0 = T[b0] - T[a0] || 1, d1 = T[b1] - T[a1] || 1;
  const h00 = (1 + 2 * u) * (1 - u) * (1 - u), h10 = u * (1 - u) * (1 - u), h01 = u * u * (3 - 2 * u), h11 = u * u * (u - 1);
  for (let k = 0; k < N; k++) {
    let m0 = (A[b0][k] - A[a0][k]) / d0, m1 = (A[b1][k] - A[a1][k]) / d1;
    if (i === 0) m0 *= 0.0; if (i + 1 === n - 1) m1 *= 0.0; // settle at the ends
    // limit overshoot: clamp tangents so the curve stays between neighbouring values (monotone-ish)
    const dv = A[i + 1][k] - A[i][k];
    if (dv === 0) { m0 = 0; m1 = 0; } else {
      const lim = 2.2 * Math.abs(dv) / h;
      m0 = clamp(m0, -lim, lim); m1 = clamp(m1, -lim, lim);
      if (m0 * dv < 0) m0 = 0; if (m1 * dv < 0) m1 = 0;
    }
    out[k] = h00 * A[i][k] + h10 * h * m0 + h01 * A[i + 1][k] + h11 * h * m1;
  }
  return unpack(out);
}
const K = (t, o) => [t, o];
// cross-fade two poses (w = weight of b); used for locomotion / stance / swing transitions
export function mixPose(a, b, w) {
  const A = pack(a), B = pack(b), o = new Float64Array(N);
  for (let k = 0; k < N; k++) o[k] = A[k] + (B[k] - A[k]) * w;
  const p = unpack(o);
  let dy = (b.yaw || 0) - (a.yaw || 0); dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  p.yaw = (a.yaw || 0) + dy * w;
  return p;
}

// ------------------------------------------------------------------ stance building blocks
// Feet in the neutral/semi-open forehand stance (right-hander): left foot forward-ish, right foot back & turned.
const FH_FEET = { fL: V(-0.16, 0, 0.30), fR: V(0.34, 0, -0.14), fLy: 0.55, fRy: 1.25 };
const BH_FEET = { fL: V(-0.34, 0, -0.14), fR: V(0.16, 0, 0.32), fLy: -1.25, fRy: -0.5 };

// ------------------------------------------------------------------ groundstrokes
// phase: 0 ready -> 0.2 unit turn -> 0.40 racket drop/load -> 0.45 hips fire -> 0.5 CONTACT -> follow-through -> 1 ready
const FH_TOP = track([
  K(0.0, {}),
  K(0.10, { py: 0.35, cy: 0.70, hip: V(0.02, 0.77, -0.08), hD: V(0.30, 1.10, 0.10), ax: V(0.18, 0.50, 0.80), fc: V(0.9, 0.2, 0), hO: V(-0.10, 1.12, 0.35), th: 1, hy: 0.15, fL: V(-0.26, 0, 0.14), fR: V(0.34, 0, -0.10), fLy: 0.25, fRy: 0.75 }),
  K(0.22, { ...FH_FEET, py: 0.75, cy: 1.28, hip: V(0.06, 0.75, -0.08), lean: 0.30, hD: V(0.40, 1.22, -0.30), ax: V(0.28, 0.62, -0.72), fc: V(0.35, -0.55, 0.6), hO: V(-0.02, 1.38, 0.52), th: 0.0, hy: 0.45, hp: 0.10 }),
  K(0.40, { ...FH_FEET, py: 0.80, cy: 1.34, hip: V(0.10, 0.70, -0.12), lean: 0.34, hD: V(0.44, 0.86, -0.34), ax: V(0.25, -0.05, -0.97), fc: V(0.4, -0.7, 0.5), hO: V(-0.10, 1.34, 0.50), th: 0, hy: 0.50, hp: 0.14 }),
  K(0.45, { ...FH_FEET, py: 0.38, cy: 1.00, hip: V(0.07, 0.72, -0.04), lean: 0.34, hD: V(0.46, 0.84, -0.10), ax: V(0.40, 0.05, -0.92), fc: V(0.3, -0.6, 0.7), hO: V(-0.20, 1.34, 0.48), th: 0, hy: 0.45, hp: 0.15 }),
  K(0.50, { ...FH_FEET, py: -0.05, cy: 0.35, hip: V(0.0, 0.78, 0.10), lean: 0.30, hD: V(0.52, 1.00, 0.46), ax: V(-0.42, 0.80, 0.30), fc: V(0.0, 0.1, 1), hO: V(-0.36, 1.26, 0.22), th: 0, hy: 0.35, hp: 0.15 }),
  K(0.58, { ...FH_FEET, fR: V(0.30, 0.03, -0.05), fRp: 0.5, fRy: 0.7, py: -0.45, cy: -0.25, hip: V(-0.03, 0.86, 0.16), lean: 0.22, hD: V(0.30, 1.28, 0.60), ax: V(-0.45, 0.70, 0.50), fc: V(-0.2, 0.7, 0.7), hO: V(-0.34, 1.20, 0.10), th: 0, hy: 0.15 }),
  K(0.68, { fL: V(-0.18, 0, 0.32), fLy: 0.5, fR: V(0.22, 0.10, 0.10), fRp: 0.7, fRy: 0.2, py: -0.65, cy: -0.75, hip: V(-0.06, 0.88, 0.16), lean: 0.2, hD: V(0.02, 1.52, 0.38), ax: V(-0.75, 0.25, 0.1), fc: V(-0.2, 0.9, 0.0), hO: V(-0.30, 1.12, 0.12), th: 0.3, hy: -0.05, hp: 0.0 }),
  K(0.82, { fL: V(-0.2, 0, 0.30), fLy: 0.2, fR: V(0.20, 0, 0.18), fRy: 0.1, py: -0.60, cy: -0.85, hip: V(-0.04, 0.86, 0.14), lean: 0.22, hD: V(-0.20, 1.48, 0.12), ax: V(-0.45, -0.35, -0.80), fc: V(-0.3, 0.8, -0.2), hO: V(-0.18, 1.18, 0.30), th: 0.8, hy: -0.2 }),
  K(1.0, {}),
]);
const FH_FLAT = track([
  K(0.0, {}),
  K(0.10, { py: 0.35, cy: 0.70, hip: V(0.02, 0.77, -0.08), hD: V(0.30, 1.10, 0.10), ax: V(0.18, 0.50, 0.80), fc: V(0.9, 0.2, 0), hO: V(-0.10, 1.12, 0.35), th: 1, hy: 0.15, fL: V(-0.26, 0, 0.14), fR: V(0.34, 0, -0.10), fLy: 0.25, fRy: 0.75 }),
  K(0.22, { ...FH_FEET, py: 0.75, cy: 1.28, hip: V(0.06, 0.76, -0.08), hD: V(0.40, 1.14, -0.30), ax: V(0.20, 0.35, -0.90), fc: V(0.2, -0.3, 0.9), hO: V(-0.02, 1.38, 0.52), th: 0.0, hy: 0.45, hp: 0.10 }),
  K(0.40, { ...FH_FEET, py: 0.78, cy: 1.30, hip: V(0.08, 0.72, -0.10), hD: V(0.44, 1.02, -0.30), ax: V(0.15, 0.20, -0.96), fc: V(0.2, -0.3, 0.9), hO: V(-0.10, 1.34, 0.50), th: 0, hy: 0.50, hp: 0.14 }),
  K(0.45, { ...FH_FEET, py: 0.38, cy: 0.95, hip: V(0.06, 0.74, -0.02), hD: V(0.46, 1.00, -0.06), ax: V(0.30, 0.25, -0.92), fc: V(0.15, -0.2, 0.95), hO: V(-0.20, 1.34, 0.48), th: 0, hy: 0.45, hp: 0.15 }),
  K(0.50, { ...FH_FEET, py: -0.02, cy: 0.35, hip: V(0.0, 0.78, 0.12), hD: V(0.54, 1.04, 0.52), ax: V(-0.15, 0.55, 0.82), fc: V(0.0, 0.0, 1), hO: V(-0.36, 1.26, 0.22), th: 0, hy: 0.35, hp: 0.15 }),
  K(0.60, { ...FH_FEET, fR: V(0.28, 0.03, 0.0), fRp: 0.5, fRy: 0.6, py: -0.35, cy: -0.10, hip: V(-0.02, 0.84, 0.22), lean: 0.24, hD: V(0.36, 1.22, 0.78), ax: V(-0.50, 0.25, 0.80), fc: V(-0.1, 0.4, 0.9), hO: V(-0.34, 1.18, 0.10), th: 0, hy: 0.1 }),
  K(0.72, { fL: V(-0.18, 0, 0.34), fLy: 0.45, fR: V(0.22, 0.10, 0.14), fRp: 0.7, fRy: 0.2, py: -0.55, cy: -0.55, hip: V(-0.05, 0.88, 0.22), lean: 0.22, hD: V(0.10, 1.40, 0.60), ax: V(-0.80, 0.15, 0.20), fc: V(-0.2, 0.8, 0.2), hO: V(-0.30, 1.12, 0.12), th: 0.3, hy: -0.05, hp: 0.0 }),
  K(0.86, { fL: V(-0.2, 0, 0.30), fLy: 0.2, fR: V(0.20, 0, 0.18), fRy: 0.1, py: -0.5, cy: -0.6, hip: V(-0.04, 0.86, 0.16), lean: 0.22, hD: V(-0.08, 1.38, 0.38), ax: V(-0.80, -0.10, 0.30), fc: V(-0.3, 0.8, 0), hO: V(-0.18, 1.18, 0.30), th: 0.8, hy: -0.15 }),
  K(1.0, {}),
]);

const BH_TOP = track([
  K(0.0, {}),
  K(0.10, { py: -0.35, cy: -0.70, hip: V(-0.02, 0.77, -0.08), hD: V(-0.18, 1.08, 0.14), ax: V(-0.30, 0.45, 0.70), fc: V(0.9, 0.2, 0), hO: V(-0.28, 1.10, 0.18), th: 1, hy: -0.15, fL: V(-0.34, 0, -0.02), fR: V(0.26, 0, 0.14), fLy: -0.75, fRy: -0.25 }),
  K(0.22, { ...BH_FEET, py: -0.70, cy: -1.25, hip: V(-0.06, 0.74, -0.08), hD: V(-0.34, 1.12, -0.18), ax: V(-0.35, 0.40, -0.82), fc: V(-0.2, -0.3, 0.9), hO: V(-0.28, 1.06, -0.02), th: 1, offT: 0.17, hy: -0.50, hp: 0.10 }),
  K(0.40, { ...BH_FEET, py: -0.78, cy: -1.32, hip: V(-0.10, 0.70, -0.12), lean: 0.34, hD: V(-0.38, 0.90, -0.28), ax: V(-0.20, -0.05, -0.97), fc: V(-0.1, -0.5, 0.8), hO: V(-0.34, 0.86, -0.18), th: 1, offT: 0.17, hy: -0.52, hp: 0.14 }),
  K(0.45, { ...BH_FEET, py: -0.34, cy: -0.98, hip: V(-0.06, 0.72, -0.04), lean: 0.34, hD: V(-0.34, 0.90, -0.06), ax: V(-0.28, 0.05, -0.95), fc: V(-0.1, -0.3, 0.9), hO: V(-0.28, 0.88, 0.04), th: 1, offT: 0.17, hy: -0.46, hp: 0.15 }),
  K(0.50, { ...BH_FEET, py: 0.05, cy: -0.40, hip: V(0.0, 0.78, 0.12), hD: V(-0.18, 1.04, 0.50), ax: V(0.42, 0.80, 0.30), fc: V(0, 0.1, 1), hO: V(-0.26, 1.02, 0.42), th: 1, offT: 0.17, hy: -0.36, hp: 0.15 }),
  K(0.60, { ...BH_FEET, fL: V(-0.30, 0.03, 0.0), fLp: 0.5, fLy: -0.6, py: 0.45, cy: 0.20, hip: V(0.03, 0.86, 0.22), lean: 0.24, hD: V(0.02, 1.32, 0.54), ax: V(0.30, 0.80, 0.30), fc: V(0.1, 0.8, 0.5), hO: V(-0.06, 1.22, 0.40), th: 1, offT: 0.17, hy: -0.15 }),
  K(0.72, { fR: V(0.18, 0, 0.34), fRy: -0.45, fL: V(-0.22, 0.10, 0.12), fLp: 0.7, fLy: -0.2, py: 0.65, cy: 0.65, hip: V(0.06, 0.88, 0.20), lean: 0.22, hD: V(0.26, 1.54, 0.20), ax: V(0.55, 0.35, -0.60), fc: V(0.1, 0.9, 0), hO: V(0.20, 1.46, 0.18), th: 1, offT: 0.17, hy: 0.05, hp: 0.0 }),
  K(0.86, { fR: V(0.20, 0, 0.30), fRy: -0.2, fL: V(-0.20, 0, 0.18), fLy: -0.1, py: 0.55, cy: 0.80, hip: V(0.04, 0.86, 0.14), lean: 0.22, hD: V(0.22, 1.50, 0.06), ax: V(0.40, -0.40, -0.80), fc: V(0.2, 0.8, -0.2), hO: V(0.12, 1.42, 0.04), th: 1, offT: 0.17, hy: 0.15 }),
  K(1.0, {}),
]);
const BH_FLAT = track([
  K(0.0, {}),
  K(0.10, { py: -0.35, cy: -0.70, hip: V(-0.02, 0.77, -0.08), hD: V(-0.18, 1.08, 0.14), ax: V(-0.30, 0.45, 0.70), fc: V(0.9, 0.2, 0), hO: V(-0.28, 1.10, 0.18), th: 1, hy: -0.15, fL: V(-0.34, 0, -0.02), fR: V(0.26, 0, 0.14), fLy: -0.75, fRy: -0.25 }),
  K(0.22, { ...BH_FEET, py: -0.70, cy: -1.25, hip: V(-0.06, 0.75, -0.08), hD: V(-0.34, 1.08, -0.20), ax: V(-0.25, 0.20, -0.92), fc: V(-0.1, -0.2, 0.95), hO: V(-0.28, 1.00, -0.04), th: 1, offT: 0.17, hy: -0.50, hp: 0.10 }),
  K(0.40, { ...BH_FEET, py: -0.76, cy: -1.30, hip: V(-0.08, 0.72, -0.10), hD: V(-0.38, 1.00, -0.26), ax: V(-0.15, 0.10, -0.98), fc: V(-0.1, -0.2, 0.95), hO: V(-0.34, 0.94, -0.16), th: 1, offT: 0.17, hy: -0.52, hp: 0.14 }),
  K(0.45, { ...BH_FEET, py: -0.34, cy: -0.98, hip: V(-0.06, 0.74, -0.02), hD: V(-0.34, 1.00, -0.04), ax: V(-0.20, 0.15, -0.96), fc: V(-0.05, -0.2, 0.95), hO: V(-0.28, 0.96, 0.06), th: 1, offT: 0.17, hy: -0.46, hp: 0.15 }),
  K(0.50, { ...BH_FEET, py: 0.05, cy: -0.40, hip: V(0.0, 0.78, 0.12), hD: V(-0.18, 1.06, 0.52), ax: V(0.40, 0.60, 0.65), fc: V(0, 0, 1), hO: V(-0.26, 1.04, 0.44), th: 1, offT: 0.17, hy: -0.36, hp: 0.15 }),
  K(0.62, { ...BH_FEET, fL: V(-0.30, 0.03, 0.0), fLp: 0.5, fLy: -0.6, py: 0.35, cy: 0.10, hip: V(0.03, 0.86, 0.24), lean: 0.24, hD: V(-0.02, 1.28, 0.78), ax: V(0.50, 0.30, 0.78), fc: V(0.1, 0.4, 0.9), hO: V(-0.1, 1.22, 0.66), th: 1, offT: 0.17, hy: -0.15 }),
  K(0.78, { fR: V(0.18, 0, 0.34), fRy: -0.4, fL: V(-0.22, 0.10, 0.14), fLp: 0.7, fLy: -0.2, py: 0.55, cy: 0.45, hip: V(0.05, 0.88, 0.22), lean: 0.22, hD: V(0.14, 1.42, 0.62), ax: V(0.82, 0.15, 0.30), fc: V(0.1, 0.8, 0.2), hO: V(0.06, 1.36, 0.54), th: 1, offT: 0.17, hy: 0.0 }),
  K(1.0, {}),
]);

// slice: high take-back, open face, high-to-low path, long forward finish, off arm back for balance
const FH_SLICE = track([
  K(0.0, {}),
  K(0.12, { py: 0.35, cy: 0.70, hip: V(0.02, 0.78, -0.07), hD: V(0.30, 1.22, 0.06), ax: V(0.22, 0.60, 0.70), fc: V(0.6, 0.5, 0), hO: V(-0.10, 1.12, 0.35), th: 1, hy: 0.15, fL: V(-0.26, 0, 0.14), fR: V(0.34, 0, -0.10), fLy: 0.25, fRy: 0.75 }),
  K(0.26, { ...FH_FEET, py: 0.70, cy: 1.22, hip: V(0.05, 0.77, -0.06), hD: V(0.40, 1.56, -0.20), ax: V(0.28, 0.72, -0.60), fc: V(0.25, 0.9, 0.3), hO: V(0.05, 1.30, 0.48), th: 0, hy: 0.45, hp: 0.10 }),
  K(0.42, { ...FH_FEET, py: 0.72, cy: 1.26, hip: V(0.08, 0.74, -0.08), hD: V(0.46, 1.56, -0.28), ax: V(0.40, 0.68, -0.60), fc: V(0.25, 0.9, 0.3), hO: V(-0.02, 1.34, 0.50), th: 0, hy: 0.48 }),
  K(0.45, { ...FH_FEET, py: 0.40, cy: 0.98, hip: V(0.06, 0.74, -0.02), hD: V(0.48, 1.42, -0.06), ax: V(0.40, 0.55, -0.70), fc: V(0.25, 0.9, 0.3), hO: V(-0.14, 1.34, 0.44), th: 0, hy: 0.45 }),
  K(0.50, { ...FH_FEET, py: 0.05, cy: 0.40, hip: V(0.0, 0.77, 0.12), hD: V(0.54, 1.12, 0.48), ax: V(0.70, 0.25, 0.65), fc: V(0, 0.9, 0.3), hO: V(-0.46, 1.28, 0.0), th: 0, hy: 0.35, hp: 0.15 }),
  K(0.62, { ...FH_FEET, fR: V(0.30, 0.03, 0.0), fRp: 0.5, fRy: 0.6, py: -0.1, cy: 0.0, hip: V(-0.01, 0.80, 0.22), lean: 0.30, hD: V(0.46, 1.02, 0.82), ax: V(0.35, 0.20, 0.92), fc: V(0, 0.95, 0.2), hO: V(-0.54, 1.26, -0.10), th: 0, hy: 0.15 }),
  K(0.80, { fL: V(-0.2, 0, 0.36), fLy: 0.35, fR: V(0.26, 0.04, 0.10), fRp: 0.5, fRy: 0.3, py: -0.15, cy: -0.05, hip: V(-0.02, 0.82, 0.24), lean: 0.30, hD: V(0.36, 1.00, 0.88), ax: V(0.20, 0.30, 0.94), fc: V(0, 0.95, 0.2), hO: V(-0.56, 1.28, -0.12), th: 0, hy: 0.05 }),
  K(1.0, {}),
]);
const BH_SLICE = track([
  K(0.0, {}),
  K(0.12, { py: -0.35, cy: -0.70, hip: V(-0.02, 0.78, -0.07), hD: V(-0.14, 1.30, 0.10), ax: V(-0.30, 0.66, 0.60), fc: V(-0.5, 0.6, 0), hO: V(-0.22, 1.20, 0.18), th: 1, hy: -0.15, fL: V(-0.34, 0, -0.02), fR: V(0.26, 0, 0.14), fLy: -0.75, fRy: -0.25 }),
  K(0.26, { ...BH_FEET, py: -0.70, cy: -1.25, hip: V(-0.05, 0.77, -0.07), hD: V(-0.30, 1.56, -0.12), ax: V(-0.35, 0.80, -0.35), fc: V(-0.2, 0.9, 0.3), hO: V(-0.30, 1.46, -0.10), th: 1, offT: 0.235, hy: -0.50, hp: 0.10 }),
  K(0.42, { ...BH_FEET, py: -0.74, cy: -1.30, hip: V(-0.08, 0.74, -0.09), hD: V(-0.34, 1.58, -0.20), ax: V(-0.45, 0.76, -0.40), fc: V(-0.2, 0.9, 0.3), hO: V(-0.34, 1.48, -0.16), th: 0.8, offT: 0.235, hy: -0.52 }),
  K(0.45, { ...BH_FEET, py: -0.34, cy: -1.00, hip: V(-0.05, 0.74, -0.03), hD: V(-0.20, 1.50, 0.06), ax: V(-0.50, 0.65, -0.45), fc: V(-0.1, 0.9, 0.3), hO: V(-0.32, 1.44, -0.10), th: 0.4, offT: 0.235, hy: -0.46 }),
  K(0.50, { ...BH_FEET, py: 0.05, cy: -0.45, hip: V(0.0, 0.77, 0.12), hD: V(0.10, 1.12, 0.62), ax: V(-0.20, 0.30, 0.93), fc: V(0, 0.95, 0.2), hO: V(0.50, 1.28, -0.30), th: 0, hy: -0.35, hp: 0.15 }),
  K(0.62, { ...BH_FEET, fL: V(-0.30, 0.03, 0.0), fLp: 0.5, fLy: -0.6, py: 0.2, cy: -0.1, hip: V(0.03, 0.80, 0.22), lean: 0.30, hD: V(0.20, 1.02, 0.86), ax: V(0.0, 0.25, 0.96), fc: V(0, 0.95, 0.2), hO: V(0.56, 1.30, -0.36), th: 0, hy: -0.15 }),
  K(0.80, { fR: V(0.2, 0, 0.36), fRy: -0.35, fL: V(-0.26, 0.04, 0.08), fLp: 0.5, fLy: -0.3, py: 0.2, cy: -0.05, hip: V(0.02, 0.82, 0.24), lean: 0.30, hD: V(0.20, 0.98, 0.90), ax: V(0.0, 0.30, 0.95), fc: V(0, 0.95, 0.2), hO: V(0.58, 1.30, -0.38), th: 0, hy: -0.05 }),
  K(1.0, {}),
]);

// lob: open face, low-to-high, finishing high
const FH_LOB = track([
  K(0.0, {}),
  K(0.10, { py: 0.35, cy: 0.70, hip: V(0.02, 0.76, -0.08), hD: V(0.30, 1.05, 0.10), ax: V(0.18, 0.50, 0.80), fc: V(0.9, 0.2, 0), hO: V(-0.10, 1.12, 0.35), th: 1, hy: 0.15, fL: V(-0.26, 0, 0.14), fR: V(0.34, 0, -0.10), fLy: 0.25, fRy: 0.75 }),
  K(0.24, { ...FH_FEET, py: 0.75, cy: 1.26, hip: V(0.06, 0.72, -0.08), hD: V(0.40, 1.00, -0.28), ax: V(0.25, 0.30, -0.90), fc: V(0.3, 0.2, 0.9), hO: V(-0.02, 1.36, 0.52), th: 0, hy: 0.45, hp: 0.10 }),
  K(0.40, { ...FH_FEET, py: 0.80, cy: 1.30, hip: V(0.10, 0.66, -0.12), lean: 0.36, hD: V(0.44, 0.74, -0.28), ax: V(0.25, -0.35, -0.90), fc: V(0.3, 0.3, 0.9), hO: V(-0.10, 1.34, 0.50), th: 0, hy: 0.50, hp: 0.16 }),
  K(0.45, { ...FH_FEET, py: 0.40, cy: 1.00, hip: V(0.08, 0.68, -0.06), lean: 0.34, hD: V(0.46, 0.74, -0.06), ax: V(0.30, -0.20, -0.92), fc: V(0.2, 0.5, 0.8), hO: V(-0.20, 1.34, 0.48), th: 0, hy: 0.45 }),
  K(0.50, { ...FH_FEET, py: -0.05, cy: 0.40, hip: V(0.0, 0.76, 0.08), lean: 0.28, hD: V(0.52, 0.88, 0.44), ax: V(0.0, 0.55, 0.80), fc: V(0.0, 0.7, 0.7), hO: V(-0.36, 1.26, 0.22), th: 0, hy: 0.30, hp: 0.10 }),
  K(0.62, { ...FH_FEET, fR: V(0.28, 0.05, -0.02), fRp: 0.55, fRy: 0.6, py: -0.3, cy: -0.05, hip: V(-0.02, 0.90, 0.16), lean: 0.14, hD: V(0.34, 1.50, 0.42), ax: V(-0.10, 0.95, 0.30), fc: V(0, 0.4, 0.9), hO: V(-0.34, 1.20, 0.10), th: 0, hy: 0.10, hp: -0.1 }),
  K(0.78, { fL: V(-0.2, 0, 0.32), fLy: 0.4, fR: V(0.24, 0.08, 0.06), fRp: 0.6, fRy: 0.3, py: -0.45, cy: -0.4, hip: V(-0.04, 0.92, 0.14), lean: 0.12, hD: V(0.02, 1.88, 0.20), ax: V(-0.30, 0.90, -0.20), fc: V(-0.1, 0.3, 0.9), hO: V(-0.30, 1.30, 0.12), th: 0.3, hy: 0.0, hp: -0.15 }),
  K(1.0, {}),
]);
const BH_LOB = track([
  K(0.0, {}),
  K(0.10, { py: -0.35, cy: -0.70, hip: V(-0.02, 0.76, -0.08), hD: V(-0.18, 1.04, 0.14), ax: V(-0.30, 0.45, 0.70), fc: V(0.9, 0.2, 0), hO: V(-0.28, 1.08, 0.18), th: 1, hy: -0.15, fL: V(-0.34, 0, -0.02), fR: V(0.26, 0, 0.14), fLy: -0.75, fRy: -0.25 }),
  K(0.24, { ...BH_FEET, py: -0.70, cy: -1.25, hip: V(-0.06, 0.72, -0.08), hD: V(-0.34, 1.00, -0.18), ax: V(-0.25, 0.20, -0.92), fc: V(-0.1, 0.1, 0.95), hO: V(-0.28, 0.94, -0.02), th: 1, offT: 0.17, hy: -0.50, hp: 0.10 }),
  K(0.40, { ...BH_FEET, py: -0.78, cy: -1.32, hip: V(-0.10, 0.66, -0.12), lean: 0.36, hD: V(-0.38, 0.74, -0.26), ax: V(-0.20, -0.30, -0.93), fc: V(-0.1, 0.3, 0.9), hO: V(-0.34, 0.70, -0.16), th: 1, offT: 0.17, hy: -0.52, hp: 0.16 }),
  K(0.45, { ...BH_FEET, py: -0.34, cy: -0.98, hip: V(-0.06, 0.68, -0.04), lean: 0.34, hD: V(-0.34, 0.76, -0.04), ax: V(-0.25, -0.15, -0.95), fc: V(-0.1, 0.4, 0.85), hO: V(-0.28, 0.72, 0.06), th: 1, offT: 0.17, hy: -0.46 }),
  K(0.50, { ...BH_FEET, py: 0.05, cy: -0.40, hip: V(0.0, 0.76, 0.10), hD: V(-0.18, 0.88, 0.48), ax: V(0.0, 0.60, 0.78), fc: V(0, 0.6, 0.8), hO: V(-0.26, 0.86, 0.40), th: 1, offT: 0.17, hy: -0.30, hp: 0.10 }),
  K(0.64, { ...BH_FEET, fL: V(-0.30, 0.05, -0.02), fLp: 0.55, fLy: -0.6, py: 0.3, cy: 0.1, hip: V(0.02, 0.90, 0.18), lean: 0.14, hD: V(0.0, 1.52, 0.44), ax: V(0.20, 0.92, 0.30), fc: V(0, 0.4, 0.9), hO: V(-0.08, 1.42, 0.38), th: 1, offT: 0.17, hy: -0.10, hp: -0.1 }),
  K(0.80, { fR: V(0.2, 0, 0.32), fRy: -0.4, fL: V(-0.24, 0.08, 0.06), fLp: 0.6, fLy: -0.3, py: 0.45, cy: 0.4, hip: V(0.04, 0.92, 0.14), lean: 0.12, hD: V(0.16, 1.86, 0.18), ax: V(0.35, 0.88, -0.2), fc: V(0.1, 0.3, 0.9), hO: V(0.08, 1.78, 0.14), th: 1, offT: 0.17, hy: 0.0, hp: -0.15 }),
  K(1.0, {}),
]);

// volley: split stance, compact punch
const VOL_STANCE = { hip: V(0, 0.76, 0.0), lean: 0.30, fL: V(-0.36, 0.0, 0.10), fR: V(0.36, 0, -0.04), fLy: -0.05, fRy: 0.2 };
const FH_VOLLEY = track([
  K(0.0, {}),
  K(0.22, { ...VOL_STANCE, py: 0.20, cy: 0.55, hD: V(0.30, 1.28, 0.20), ax: V(0.10, 0.88, 0.40), fc: V(0.7, 0.3, 0.2), hO: V(-0.10, 1.22, 0.34), th: 1, hy: 0.2 }),
  K(0.45, { ...VOL_STANCE, fL: V(-0.18, 0, 0.32), fLy: 0.3, py: 0.15, cy: 0.62, hD: V(0.34, 1.24, 0.06), ax: V(0.10, 0.90, 0.30), fc: V(0.3, 0.7, 0.4), hO: V(-0.14, 1.28, 0.34), th: 0.5, hy: 0.25 }),
  K(0.50, { ...VOL_STANCE, fL: V(-0.16, 0, 0.36), fLy: 0.35, py: -0.05, cy: 0.30, hip: V(0, 0.74, 0.08), hD: V(0.40, 1.16, 0.56), ax: V(0.08, 0.80, 0.55), fc: V(0, 0.4, 0.9), hO: V(-0.34, 1.24, 0.20), th: 0, hy: 0.2, hp: 0.15 }),
  K(0.62, { ...VOL_STANCE, fL: V(-0.16, 0, 0.38), fLy: 0.35, py: -0.12, cy: 0.12, hip: V(0, 0.74, 0.10), hD: V(0.40, 1.08, 0.70), ax: V(0.05, 0.55, 0.85), fc: V(0, 0.7, 0.6), hO: V(-0.38, 1.22, 0.14), th: 0, hy: 0.1 }),
  K(0.80, { ...VOL_STANCE, fL: V(-0.2, 0, 0.30), fLy: 0.2, py: -0.05, cy: 0.2, hD: V(0.30, 1.14, 0.55), ax: V(0.06, 0.70, 0.7), fc: V(0.3, 0.5, 0.4), hO: V(-0.2, 1.2, 0.3), th: 0.6 }),
  K(1.0, {}),
]);
const BH_VOLLEY = track([
  K(0.0, {}),
  K(0.22, { ...VOL_STANCE, py: -0.20, cy: -0.60, hD: V(0.0, 1.30, 0.10), ax: V(-0.2, 0.88, 0.35), fc: V(-0.4, 0.5, 0.3), hO: V(-0.22, 1.24, 0.18), th: 1, hy: -0.2 }),
  K(0.45, { ...VOL_STANCE, fR: V(0.18, 0, 0.32), fRy: -0.3, py: -0.18, cy: -0.66, hD: V(0.0, 1.28, 0.02), ax: V(-0.20, 0.90, 0.30), fc: V(-0.3, 0.6, 0.4), hO: V(-0.22, 1.28, 0.10), th: 1, offT: 0.235, hy: -0.25 }),
  K(0.50, { ...VOL_STANCE, fR: V(0.16, 0, 0.36), fRy: -0.3, py: 0.0, cy: -0.40, hip: V(0, 0.74, 0.08), hD: V(0.12, 1.16, 0.60), ax: V(0.0, 0.75, 0.62), fc: V(0, 0.4, 0.9), hO: V(0.38, 1.26, -0.16), th: 0, hy: -0.2, hp: 0.15 }),
  K(0.62, { ...VOL_STANCE, fR: V(0.16, 0, 0.38), fRy: -0.3, py: 0.1, cy: -0.25, hip: V(0, 0.74, 0.10), hD: V(0.16, 1.08, 0.76), ax: V(0.0, 0.5, 0.86), fc: V(0, 0.7, 0.6), hO: V(0.42, 1.28, -0.22), th: 0, hy: -0.1 }),
  K(0.80, { ...VOL_STANCE, fR: V(0.2, 0, 0.30), fRy: -0.2, py: 0.0, cy: -0.2, hD: V(0.2, 1.12, 0.62), ax: V(0.0, 0.7, 0.7), fc: V(0, 0.5, 0.4), hO: V(0.2, 1.2, 0.2), th: 0.5 }),
  K(1.0, {}),
]);

// overhead smash: sideways, non-hitting arm pointing at the ball, scissor kick
const SM_STANCE = { fL: V(-0.20, 0, 0.18), fR: V(0.30, 0, -0.22), fLy: 0.6, fRy: 1.3 };
const SMASH = track([
  K(0.0, {}),
  K(0.18, { ...SM_STANCE, py: 0.85, cy: 1.20, hip: V(0.04, 0.82, -0.14), lean: 0.12, hD: V(0.34, 1.50, -0.20), ax: V(0.05, 0.90, -0.40), fc: V(0.9, 0.1, 0), hO: V(-0.06, 2.00, 0.30), th: 0, hy: 0.55, hp: -0.55 }),
  K(0.38, { ...SM_STANCE, fR: V(0.30, 0.0, -0.30), py: 0.90, cy: 1.30, hip: V(0.06, 0.78, -0.20), lean: 0.02, hD: V(0.34, 1.62, -0.26), ax: V(0.05, 0.60, -0.80), fc: V(0.9, 0.2, 0), hO: V(-0.04, 2.12, 0.34), th: 0, hy: 0.55, hp: -0.65 }),
  K(0.45, { fL: V(-0.20, 0.10, 0.28), fR: V(0.26, 0.14, -0.30), fLp: 0.3, fRp: 0.4, fLy: 0.6, fRy: 1.1, py: 0.62, cy: 0.95, hip: V(0.04, 0.96, -0.12), lean: 0.0, hD: V(0.30, 1.82, -0.22), ax: V(0.0, -0.35, -0.94), fc: V(0.9, 0.2, 0), hO: V(-0.10, 2.06, 0.32), th: 0, hy: 0.5, hp: -0.7 }),
  K(0.50, { fL: V(-0.18, 0.28, 0.40), fR: V(0.22, 0.40, -0.42), fLp: 0.3, fRp: 0.7, fLy: 0.4, fRy: 0.9, py: 0.15, cy: 0.40, hip: V(0.0, 1.04, 0.0), lean: 0.08, hD: V(0.28, 2.26, 0.28), ax: V(0.0, 0.98, 0.18), fc: V(0, 0.1, 1), hO: V(-0.32, 1.60, 0.28), th: 0, hy: 0.3, hp: -0.65 }),
  K(0.60, { fL: V(-0.2, 0.14, 0.30), fR: V(0.22, 0.20, -0.08), fLp: 0.4, fRp: 0.6, fLy: 0.3, fRy: 0.4, py: -0.35, cy: -0.30, hip: V(-0.03, 0.96, 0.16), lean: 0.26, hD: V(0.06, 1.55, 0.46), ax: V(-0.55, -0.50, 0.60), fc: V(-0.2, 0.6, 0.6), hO: V(-0.36, 1.35, 0.20), th: 0, hy: 0.1, hp: -0.1 }),
  K(0.76, { fL: V(-0.22, 0, 0.26), fLy: 0.3, fR: V(0.20, 0, 0.12), fRy: 0.2, py: -0.5, cy: -0.55, hip: V(-0.04, 0.84, 0.18), lean: 0.34, hD: V(-0.12, 1.14, 0.38), ax: V(-0.60, -0.80, 0.0), fc: V(-0.2, 0.5, 0.6), hO: V(-0.26, 1.18, 0.28), th: 0.4, hy: 0.0, hp: 0.1 }),
  K(1.0, {}),
]);

// ------------------------------------------------------------------ serve + pre-serve ball bounce
// Timeline, toss-hand path and contact points come from src/game/serve_choreo.js (single source of truth shared with
// the simulation). Phases: 0 setup, 0.12 arms drop, 0.30 toss release, 0.50 trophy (ball apex), 0.57 racket drop,
// 0.65 contact (airborne, full extension), 0.76 landing on the front foot inside the baseline, 0.88 finish across the
// body, 1 recovery. Feet/hips are root-relative (the sim moves the root forward during the jump).
// Side-on stance: lead (left) foot near the baseline pointing at the right net post, back foot parallel to the baseline.
const SV_FEET = { fL: V(-0.12, 0, 0.25), fR: V(0.30, 0, -0.22), fLy: 0.85, fRy: 1.50 };
const SV_SET = {
  ...SV_FEET, py: 0.85, cy: 0.95, hip: V(0.02, 0.89, -0.02), lean: 0.12, side: 0, hy: 0.35, hp: 0.12,
  hD: V(0.02, 1.00, 0.40), ax: V(-0.15, 0.30, 0.94), fc: V(0.9, 0.3, 0), th: 0, offT: 0.2,
};
const SERVE = track([
  K(0.0, SV_SET),
  // both arms drop together, weight onto the back foot
  K(0.12, { ...SV_SET, hip: V(0.04, 0.87, -0.04), lean: 0.14, hD: V(0.30, 0.82, 0.06), ax: V(0.20, -0.45, 0.87), fc: V(0.9, 0.2, 0.3), hy: 0.40 }),
  // toss release: tossing arm fully extended, racket arm swinging back and up, knees start to flex
  K(0.30, { ...SV_SET, py: 0.95, cy: 1.15, hip: V(0.03, 0.82, 0.02), lean: -0.02, side: 0.06, hD: V(0.44, 1.12, -0.30), ax: V(0.20, -0.30, -0.93), fc: V(0.9, 0, 0.2), hy: 0.45, hp: -0.25 }),
  K(0.42, { ...SV_SET, fRp: 0.15, py: 0.95, cy: 1.20, hip: V(0.04, 0.74, 0.04), lean: -0.14, side: 0.10, hD: V(0.42, 1.48, -0.28), ax: V(0.10, 0.75, -0.65), fc: V(0.9, 0, 0.2), hy: 0.45, hp: -0.55 }),
  // trophy: deep knee bend, back arched, racket up behind the head, tossing arm pointing at the ball
  K(0.50, { ...SV_SET, fRp: 0.35, py: 0.90, cy: 1.20, hip: V(0.06, 0.68, 0.04), lean: -0.24, side: 0.14, hD: V(0.36, 1.62, -0.22), ax: V(0.05, 0.96, -0.25), fc: V(0.95, 0, 0.1), hy: 0.45, hp: -0.75 }),
  // racket drop behind the back while the legs drive up
  K(0.57, { ...SV_SET, fRp: 0.55, fR: V(0.26, 0.02, -0.18), py: 0.70, cy: 0.95, hip: V(0.05, 0.84, 0.06), lean: -0.18, side: 0.10, hD: V(0.30, 1.56, -0.28), ax: V(0.10, -0.80, -0.58), fc: V(0.95, 0, 0.1), hy: 0.40, hp: -0.80 }),
  K(0.62, { fL: V(-0.12, 0.10, 0.25), fR: V(0.22, 0.14, -0.18), fLp: 0.6, fRp: 0.8, fLy: 0.7, fRy: 1.2, py: 0.45, cy: 0.55, hip: V(0.04, 1.06, 0.08), lean: -0.02, side: 0.0, hD: V(0.26, 2.00, 0.02), ax: V(0.05, 0.70, -0.70), fc: V(0.6, 0.2, 0.7), th: 0, hy: 0.25, hp: -0.85 }),
  // contact: airborne at full extension, chest square to the net, racket face toward the target
  K(0.65, { fL: V(-0.10, 0.22, 0.10), fR: V(0.18, 0.24, -0.20), fLp: 0.9, fRp: 1.0, fLy: 0.5, fRy: 0.9, py: 0.25, cy: 0.20, hip: V(0.06, 1.23, 0.0), lean: 0.06, side: -0.06, hD: V(0.20, 2.40, 0.10), ax: V(0.00, 0.95, 0.30), fc: V(0, 0.15, 1), th: 0, hy: 0.15, hp: -0.80 }),
  // pronation: racket face turns out, head swings down in front
  K(0.70, { fL: V(-0.10, 0.12, 0.20), fR: V(0.20, 0.30, -0.30), fLp: 0.5, fRp: 1.1, fLy: 0.4, fRy: 0.6, py: 0.0, cy: -0.10, hip: V(0.02, 1.02, 0.06), lean: 0.30, side: -0.06, hD: V(0.20, 1.86, 0.42), ax: V(-0.20, 0.10, 0.97), fc: V(-0.7, 0.1, 0.7), th: 0, hy: 0.05, hp: -0.20 }),
  // landing on the front (left) foot inside the baseline, back leg kicking up behind for balance
  K(0.76, { fL: V(-0.10, 0, 0.12), fR: V(0.24, 0.30, -0.40), fLp: 0, fRp: 1.2, fLy: 0.25, fRy: 0.4, py: -0.15, cy: -0.40, hip: V(0.0, 0.84, 0.0), lean: 0.48, side: -0.04, hD: V(-0.04, 1.12, 0.48), ax: V(-0.70, -0.55, 0.45), fc: V(-0.4, 0.5, 0.5), th: 0, hy: 0.0, hp: 0.15 }),
  // finish: racket across the body on the left side
  K(0.88, { fL: V(-0.14, 0, 0.12), fR: V(0.24, 0.06, -0.10), fLy: 0.2, fRy: 0.4, fRp: 0.5, py: -0.25, cy: -0.60, hip: V(0.0, 0.84, 0.04), lean: 0.36, hD: V(-0.32, 0.98, 0.20), ax: V(-0.45, -0.55, -0.70), fc: V(-0.3, 0.6, 0.4), th: 0, hy: 0.0, hp: 0.15 }),
  // recovery step: feet square, back toward the ready position
  K(1.0, { fL: V(-0.30, 0, 0.06), fR: V(0.30, 0, -0.02), fLy: -0.1, fRy: 0.1, py: 0.0, cy: 0.05, hip: V(0, 0.82, -0.04), lean: 0.28, hD: V(0.12, 1.00, 0.38), ax: V(0.06, 0.52, 0.85), fc: V(0.75, 0.55, 0), th: 1, hy: 0, hp: 0.06 }),
]);
// pre-serve ball bounce (one dribble per anim cycle); key 0/1 == serve phase 0 so the serve starts seamlessly
const BOUNCE = track([
  K(0.0, SV_SET),
  K(0.16, { ...SV_SET, hip: V(0.02, 0.84, 0.0), lean: 0.36, hp: 0.35, hD: V(0.06, 0.92, 0.44) }),
  K(0.45, { ...SV_SET, hip: V(0.02, 0.83, 0.0), lean: 0.40, hp: 0.50, hD: V(0.06, 0.90, 0.44) }),
  K(0.74, { ...SV_SET, hip: V(0.02, 0.85, 0.0), lean: 0.34, hp: 0.35, hD: V(0.05, 0.94, 0.43) }),
  K(1.0, SV_SET),
]);
const RACKET_HEAD = 0.30 + 0.1925 - BODY.gripT;     // grip point (hD) -> string-bed centre along the racket axis

// serve pose for a toss type: keyframes + choreographed tossing hand + racket head exactly on the contact point
function servePose(type, ph) {
  const P = sample(SERVE, ph);
  const t = serveTime(ph);
  const h = tossHand(type, t);                           // ball centre while held, root frame (right-hander)
  P.hO = V(h[0], h[1] - PALM_BELOW_BALL, h[2]);
  // racket: pull the string bed onto the choreographed contact point around contact
  const w = ph <= 0.585 || ph >= 0.715 ? 0 : ph <= 0.65 ? smooth((ph - 0.585) / 0.065) : 1 - smooth((ph - 0.65) / 0.065);
  if (w > 0) {
    const C = contactPoint(type), ro = rootOffset(SERVE_T.contact);
    const ax = norm(P.ax);
    const tgt = V(C[0] - ro[0] - ax[0] * RACKET_HEAD, C[1] - ro[1] - ax[1] * RACKET_HEAD, C[2] - ro[2] - ax[2] * RACKET_HEAD);
    P.hD = lerpV(P.hD, tgt, w);
    // shift the hips under the contact point a little (kick: more under the ball, slice: more to the side)
    const dx = C[0] - TOSS.flat.C[0];
    P.hip = V(P.hip[0] + 0.5 * dx * w, P.hip[1], P.hip[2] + 0.5 * (C[2] - TOSS.flat.C[2]) * w);
  }
  return P;
}
function bouncePose(ph) {
  const P = sample(BOUNCE, ph);
  const d = dribble(ph);
  P.hO = V(d.hand[0], d.hand[1] - PALM_BELOW_BALL, d.hand[2]);
  return P;
}

const STROKES = {
  'topspin|fh': FH_TOP, 'topspin|bh': BH_TOP, 'flat|fh': FH_FLAT, 'flat|bh': BH_FLAT,
  'slice|fh': FH_SLICE, 'slice|bh': BH_SLICE, 'lob|fh': FH_LOB, 'lob|bh': BH_LOB,
  'volley|fh': FH_VOLLEY, 'volley|bh': BH_VOLLEY, 'smash|fh': SMASH, 'smash|bh': SMASH,
};

// ------------------------------------------------------------------ locomotion
// dir: movement direction relative to the body (x right, z forward), speed 0..1
function gait(phase, dir, speed, walk) {
  const g = phase;
  const p = mk({});
  const amp = walk ? 0.20 : 0.22 + 0.26 * speed;
  const hmax = walk ? 0.06 : 0.12 + 0.20 * speed;
  const sigma = walk ? 0.6 : 0.46 - 0.08 * speed;
  const lat = walk ? 0.09 : 0.11 - 0.02 * speed;
  const foot = (sgn, u) => {
    u = ((u % 1) + 1) % 1;
    let along, y, pitch;
    if (u < sigma) { const s = u / sigma; along = amp * (1 - 2 * s); y = 0; pitch = walk ? -0.1 * (1 - s) + 0.35 * smooth(clamp((s - 0.6) / 0.4, 0, 1)) : 0.55 * smooth(clamp((s - 0.7) / 0.3, 0, 1)); } else {
      const s = (u - sigma) / (1 - sigma);
      along = -amp + 2 * amp * smooth(s);
      y = hmax * Math.sin(Math.PI * Math.pow(s, 0.62));
      pitch = walk ? 0.3 * (1 - s) : 0.6 * (1 - s) + 0.2;
    }
    // lateral foot placement: when moving sideways the feet pass close / cross
    const x = sgn * lat + dir.x * along;
    return { p: V(x, y, dir.z * along), pitch };
  };
  const L = foot(-1, g), R = foot(1, g + 0.5);
  p.fL = L.p; p.fR = R.p; p.fLp = L.pitch; p.fRp = R.pitch;
  const fy = (v) => v; void fy;
  // feet point along the travel direction
  const trav = Math.atan2(dir.x, Math.max(0.2, dir.z));
  p.fLy = trav * 0.5; p.fRy = trav * 0.5;
  const bob = Math.cos(4 * Math.PI * (g - sigma / 2));
  const h0 = walk ? 0.88 : 0.80 - 0.02 * speed;
  p.hip = V(0, h0 - (walk ? 0.015 : 0.035) * bob, 0.0);
  const lean = walk ? 0.07 : 0.20 + 0.30 * speed;
  p.lean = lean;
  p.side = clamp(dir.x * 0.10 * speed, -0.12, 0.12) + 0.03 * Math.sin(TAU * g);
  const ps = Math.sin(TAU * g);
  p.py = 0.20 * ps * (walk ? 0.4 : 1); p.cy = -0.26 * ps * (walk ? 0.4 : 1);
  p.hy = 0; p.hp = 0.02;
  if (walk) {
    p.hD = V(0.25 + 0.02 * ps, 0.78, 0.08 + 0.17 * Math.cos(TAU * g)); p.ax = V(0.10, -0.80, 0.45); p.fc = V(1, 0, 0); p.th = 0;
    p.hO = V(-0.25, 0.80, 0.08 - 0.17 * Math.cos(TAU * g));
  } else {
    const a = 0.08 + 0.10 * speed;
    p.hD = V(0.18, 1.06 + 0.03 * ps, 0.30 + a * Math.cos(TAU * g)); p.ax = V(0.15, 0.55, 0.80); p.fc = V(0.7, 0.4, 0); p.th = 0;
    p.hO = V(-0.20, 1.12 + 0.04 * ps, 0.24 - (0.16 + 0.22 * speed) * Math.cos(TAU * g));
  }
  return p;
}

// ------------------------------------------------------------------ public: pose for an anim
// ctx: { runPhase 0..1, time, role: 'near'|'far' }
export function poseFor(anim, ctx = {}) {
  const name = anim.name || 'ready';
  const ph = clamp(anim.phase || 0, 0, 1);
  const time = ctx.time || 0;
  switch (name) {
    case 'swing': {
      const shot = anim.shot || 'topspin', side = anim.side || 'fh';
      const tr = STROKES[`${shot}|${side}`] || STROKES[`topspin|${side}`];
      return sample(tr, ph);
    }
    case 'serve': return anim.shot === 'bounce' ? bouncePose(ph) : servePose(anim.shot || 'flat', ph);
    case 'bounce': return bouncePose(ph);
    case 'split': {
      const u = anim.phase == null ? 0.7 : ph; // 0..0.3 airborne hop, then wide landing
      const air = Math.sin(Math.PI * clamp(u / 0.3, 0, 1));
      const land = smooth(clamp((u - 0.28) / 0.12, 0, 1));
      const o = {
        hip: V(0, lerp(0.88 + 0.10 * air, 0.70, land) - 0.0, -0.04), lean: 0.30 + 0.06 * land, hp: 0.05,
        fL: V(-lerp(0.16, 0.44, land), 0.18 * air * (1 - land), 0.05), fR: V(lerp(0.16, 0.44, land), 0.18 * air * (1 - land), -0.03),
        fLy: -0.15, fRy: 0.15, hD: V(0.14, 1.06 + 0.06 * air, 0.44), hO: V(-0.06, 1.1, 0.4), cy: 0.04,
      };
      return mk(o);
    }
    case 'run': case 'walk': case 'shuffle': case 'crossover': case 'backpedal': case 'brake':
      return locoPose(anim, ctx, mk, V); // footwork with planted feet (char_loco.js)
    case 'celebrate': {
      const t = (time * 1.8) % 1, g = Math.sin(t * TAU);
      const pump = smooth(clamp(Math.sin(t * TAU * 2) * 0.5 + 0.5, 0, 1));
      const jump = Math.max(0, g) * 0.05;
      return mk({
        hip: V(0, 0.86 + jump - 0.03 * (1 - Math.abs(g)), 0), lean: 0.06, py: -0.25, cy: -0.4, hy: -0.2, hp: -0.25,
        fL: V(-0.30, jump * 2, 0.06), fR: V(0.30, jump * 2, -0.04), fLy: -0.2, fRy: 0.2,
        hD: V(0.24, 0.92 - 0.05 * pump, 0.14), ax: V(0.1, -0.85, 0.35), fc: V(1, 0, 0), th: 0,
        hO: V(-0.26 - 0.04 * pump, 1.36 + 0.40 * pump, 0.22 + 0.1 * pump), lean: 0.1,
      });
    }
    case 'dejected': {
      const g = Math.sin(time * 1.1);
      return mk({
        hip: V(0, 0.86 - 0.01 * g, 0), lean: 0.30 + 0.02 * g, py: 0.05, cy: 0.1, hy: 0.2, hp: 0.55,
        fL: V(-0.2, 0, 0.04), fR: V(0.2, 0, -0.04), fLy: -0.2, fRy: 0.2,
        hD: V(0.24, 0.62, 0.10), ax: V(0.15, -0.97, 0.15), fc: V(1, 0, 0), th: 0, hO: V(-0.24, 0.72, 0.06),
      });
    }
    case 'idle': {
      const b = Math.sin(time * 2.2) * 0.008;
      return mk({
        hip: V(0, 0.86 + b, 0), lean: 0.12, hy: 0.0, hp: 0.0, fL: V(-0.22, 0, 0.03), fR: V(0.22, 0, -0.03), fLy: -0.12, fRy: 0.12,
        hD: V(0.24, 0.88, 0.14), ax: V(0.1, -0.7, 0.7), th: 0, hO: V(-0.24, 0.9, 0.08),
      });
    }
    case 'ready':
    default: {
      // rhythmic bounce on the balls of the feet
      const w = Math.sin(time * 6.0), b = w * 0.016, hop = Math.max(0, Math.sin(time * 6.0 + 1.2)) * 0.03;
      return mk({
        hip: V(0, READY.hip[1] + b, READY.hip[2]), hD: V(0.10, READY.hD[1] + b * 0.7, READY.hD[2]),
        fL: V(-0.34, hop, 0.04), fR: V(0.34, hop, -0.04), fLp: hop * 6, fRp: hop * 6,
        hy: 0.0, cy: 0.06 + 0.03 * w,
      });
    }
  }
}

// ------------------------------------------------------------------ IK helpers
function ik2(root, target, l1, l2, pole, frac = 0.992) {
  let d = sub(target, root), dist = len(d);
  const maxd = (l1 + l2) * frac;
  if (dist > maxd) { target = add(root, mul(norm(d), maxd)); d = sub(target, root); dist = maxd; }
  if (dist < 0.05) dist = 0.05;
  const u = norm(d);
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  let pn = sub(pole, mul(u, dot(pole, u)));
  if (len(pn) < 1e-4) pn = [0, 0, 1];
  pn = norm(pn);
  return { mid: add(add(root, mul(u, along)), mul(pn, h)), end: target, stretch: dist / (l1 + l2) };
}
function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
// orientation frame from yaw / forward lean / side bend: { r, u, f }
function frame(yaw, lean, side) {
  let r = [Math.cos(yaw), 0, -Math.sin(yaw)], f = [Math.sin(yaw), 0, Math.cos(yaw)], u = [0, 1, 0];
  const c = Math.cos(lean), s = Math.sin(lean);
  const u2 = add(mul(u, c), mul(f, s)), f2 = sub(mul(f, c), mul(u, s));
  const cs = Math.cos(side), ss = Math.sin(side);
  const u3 = add(mul(u2, cs), mul(r, ss)), r3 = sub(mul(r, cs), mul(u2, ss));
  return { r: norm(r3), u: norm(u3), f: norm(f2) };
}

// Returns the solved rig in character space (global yaw applied, mirrored for left-handers).
export function solve(P, hand = 'R') {
  const B = BODY;
  const H = P.hip;
  const pel = frame(P.py, P.lean * 0.35, P.side * 0.5);
  const chs = frame(P.cy, P.lean, P.side);
  const mid = frame((P.py + P.cy) / 2, P.lean * 0.7, P.side * 0.7);
  const waist = add(H, mul(mid.u, B.waist));
  const neckBase = add(waist, mul(chs.u, B.spine - B.waist));
  const chestC = add(waist, mul(chs.u, 0.17));
  // head
  const hf = frame(P.hy, P.hp, 0);
  const neckTop = add(neckBase, mul(norm(add(mul(chs.u, 0.4), mul(hf.u, 0.6))), 0.085));
  const headC = add(add(neckTop, mul(hf.u, 0.105)), mul(hf.f, 0.012));
  // shoulders (raise slightly when the arm goes overhead)
  const shBase = sub(neckBase, mul(chs.u, 0.045));
  let shR = add(shBase, mul(chs.r, B.shoulderHalf)), shL = sub(shBase, mul(chs.r, B.shoulderHalf));
  const raise = (w) => 0.035 * clamp((w[1] - shR[1] - 0.25) / 0.6, 0, 1);
  // legs
  const hjR = add(H, mul(pel.r, B.hipHalf)), hjL = sub(H, mul(pel.r, B.hipHalf));
  const ankOf = (f) => [f[0], f[1] + B.ankleH, f[2]];
  const aR = ankOf(P.fR), aL = ankOf(P.fL);
  const fwdR = norm(add(mul(pel.f, 0.5), [Math.sin(P.fRy), 0, Math.cos(P.fRy)]));
  const fwdL = norm(add(mul(pel.f, 0.5), [Math.sin(P.fLy), 0, Math.cos(P.fLy)]));
  const legR = ik2(hjR, aR, B.thigh, B.shin, add(fwdR, [0.30, 0, 0]));
  const legL = ik2(hjL, aL, B.thigh, B.shin, add(fwdL, [-0.30, 0, 0]));
  // racket + arms
  const ax = norm(P.ax);
  let fc = sub(P.fc, mul(ax, dot(P.fc, ax)));
  if (len(fc) < 1e-3) fc = cross(ax, [0, 1, 0]);
  fc = norm(fc);
  const wristT = sub(P.hD, mul(ax, B.gripT - 0.01));
  shR = add(shR, [0, raise(wristT), 0]);
  const poleOf = (sh, w, out) => {
    const up = clamp((w[1] - sh[1] + 0.05) / 0.4, 0, 1);
    return add(mul([out, 0, 0], 0.5 + up * 1.2), [0, -1 + 0.8 * up, -0.35 * (1 - up)]);
  };
  const upFrac = (w, sh) => 0.955 + 0.04 * clamp((w[1] - sh[1] - 0.15) / 0.5, 0, 1);
  const armR = ik2(shR, wristT, B.upperArm, B.foreArm, poleOf(shR, wristT, 1), upFrac(wristT, shR));
  const wR = armR.end;
  const grip = add(wR, mul(ax, B.gripT - 0.01));
  const butt = sub(grip, mul(ax, B.gripT));
  // off hand: on the racket (th=1) or free
  let hOc = P.hO;
  const onRack = add(butt, mul(ax, P.offT));
  if (P.th > 0) hOc = lerpV(P.hO, onRack, P.th);
  const offDir = norm(sub(hOc, shL));
  let wristL = sub(hOc, mul(P.th > 0.5 ? ax : offDir, P.th > 0.5 ? B.gripT - 0.015 : 0.075));
  shL = add(shL, [0, raise(wristL), 0]);
  let armL = ik2(shL, wristL, B.upperArm, B.foreArm, poleOf(shL, wristL, -1), upFrac(wristL, shL));
  let wL = armL.end;
  let handLdir = P.th > 0.5 ? ax : norm(sub(wL, armL.mid));
  let handLc = P.th > 0.5 ? add(wL, mul(ax, B.gripT - 0.015)) : add(wL, mul(handLdir, 0.07));
  if (P.th <= 0.5) {
    // free hand (e.g. the serve toss / ball bounce): iterate so that the HAND CENTRE lands on the target, not the wrist
    for (let it = 0; it < 4; it++) {
      const e = sub(hOc, handLc);
      if (len(e) < 0.004) break;
      wristL = add(wristL, e);
      armL = ik2(shL, wristL, B.upperArm, B.foreArm, poleOf(shL, wristL, -1), upFrac(wristL, shL));
      wL = armL.end; handLdir = norm(sub(wL, armL.mid)); handLc = add(wL, mul(handLdir, 0.07));
    }
  }

  const foot = (f, yaw, pitch, ank) => {
    const fw = [Math.sin(yaw), 0, Math.cos(yaw)];
    const dirv = norm([fw[0] * Math.cos(pitch), -Math.sin(pitch), fw[2] * Math.cos(pitch)]);
    return { ank, dir: dirv, yaw, pitch };
  };
  const J = {
    hip: H, pelvis: pel, chest: chs, hips: { r: pel.r, u: pel.u, f: pel.f }, waist, chestC, neckBase, neckTop, headC, head: hf,
    shR, shL, elbR: armR.mid, elbL: armL.mid, wrR: wR, wrL: wL, handRc: grip, handLc, handLdir, handLgrip: P.th > 0.5,
    hjR, hjL, kneeR: legR.mid, kneeL: legL.mid, ankR: legR.end, ankL: legL.end,
    footR: foot(P.fR, P.fRy, P.fRp, legR.end), footL: foot(P.fL, P.fLy, P.fLp, legL.end),
    racket: { butt, axis: ax, face: fc, grip },
  };
  // global yaw + handedness mirror
  const mir = hand === 'L' ? -1 : 1;
  const T = (p) => { const q = rotY(p, P.yaw || 0); return [q[0] * mir, q[1], q[2]]; };
  const mapDeep = (v) => {
    if (Array.isArray(v) && v.length === 3 && typeof v[0] === 'number') return T(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) { const o = {}; for (const k in v) o[k] = mapDeep(v[k]); return o; }
    return v;
  };
  const out = mapDeep(J);
  // when mirroring, the "right" limbs stay the dominant (racket) side; swap physical left/right labels
  out.mir = mir;
  out.stretch = { legR: legR.stretch, legL: legL.stretch, armR: armR.stretch, armL: armL.stretch };
  return out;
}
