// Procedural skeleton + keyframed tennis poses. Character space: x = character's right, y = up, z = forward.
// All poses are authored for a RIGHT-handed player; left-handers are produced by mirroring x at the end.
const TAU = Math.PI * 2;
const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
const ease = (t) => t * t * (3 - 2 * t);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const BODY = { hipHalf: 0.10, shoulderHalf: 0.215, thigh: 0.45, shin: 0.45, ankleY: 0.07, upperArm: 0.30, foreArm: 0.29, torso: 0.50, neck: 0.10, headR: 0.108 };

// ---------- base pose ----------
export function basePose() {
  return {
    hip: v3(0, 0.80, 0), lean: 0.33, side: 0, twist: 0, yaw: 0, headYaw: 0, headPitch: 0,
    footL: v3(-0.30, 0.07, 0.05), footR: v3(0.30, 0.07, -0.05),
    hD: v3(0.14, 1.02, 0.42), hO: v3(-0.02, 1.05, 0.36),
    axis: v3(0, 0.38, 0.93), face: v3(1, 0, 0),
    twoHand: 1,       // 1 = off hand holds the racket throat (follows hD)
    handLen: 0.10,    // off-hand offset along the grip toward the butt
  };
}
const KEYS = ['lean', 'side', 'twist', 'yaw', 'headYaw', 'headPitch', 'twoHand', 'handLen'];
const VKEYS = ['hip', 'footL', 'footR', 'hD', 'hO', 'axis', 'face'];
function mk(o) { const p = basePose(); for (const k in o) p[k] = Array.isArray(o[k]) ? o[k].slice() : o[k]; return p; }
function blend(a, b, t) {
  const o = {};
  for (const k of KEYS) o[k] = lerp(a[k], b[k], t);
  for (const k of VKEYS) o[k] = lerpV(a[k], b[k], t);
  return o;
}
// keyframes: [[t, overrides], ...] each built from ready base
function sampleKeys(frames, t) {
  t = clamp(t, 0, 1);
  let i = 0;
  while (i < frames.length - 2 && t > frames[i + 1][0]) i++;
  const [t0, p0] = frames[i], [t1, p1] = frames[i + 1];
  const u = t1 > t0 ? ease(clamp((t - t0) / (t1 - t0), 0, 1)) : 1;
  return blend(p0, p1, u);
}
const K = (t, o) => [t, mk(o)];
const READY = mk({});

// ---------- strokes (right-handed) ----------
const FH_TOP = [
  K(0.0, {}),
  K(0.2, { yaw: 0.85, twist: 0.38, hip: v3(0, 0.78, 0), lean: 0.3, footL: v3(-0.27, 0.07, 0.30), footR: v3(0.28, 0.07, -0.20), hD: v3(0.42, 1.12, -0.30), axis: v3(0.15, 0.85, -0.5), face: v3(0.2, 0, 1), hO: v3(-0.05, 1.22, 0.36), twoHand: 0 }),
  K(0.36, { yaw: 0.95, twist: 0.35, hip: v3(0, 0.72, 0), lean: 0.34, footL: v3(-0.27, 0.07, 0.30), footR: v3(0.28, 0.07, -0.22), hD: v3(0.46, 0.82, -0.34), axis: v3(0.25, -0.35, -0.85), face: v3(0.3, 0.3, 1), hO: v3(-0.10, 1.20, 0.42), twoHand: 0 }),
  K(0.5, { yaw: 0.48, twist: 0.05, hip: v3(0, 0.78, 0.06), lean: 0.3, footL: v3(-0.27, 0.07, 0.34), footR: v3(0.26, 0.07, -0.14), hD: v3(0.58, 1.0, 0.50), axis: v3(0.15, 0.95, 0.30), face: v3(0.05, 0.1, 1), hO: v3(-0.28, 1.15, 0.2), twoHand: 0 }),
  K(0.7, { yaw: -0.4, twist: -0.5, hip: v3(0, 0.88, 0.1), lean: 0.2, footL: v3(-0.25, 0.07, 0.40), footR: v3(0.22, 0.17, -0.02), hD: v3(-0.12, 1.62, 0.34), axis: v3(-0.55, 0.55, -0.6), face: v3(0.2, 0.7, 0.3), hO: v3(-0.22, 1.35, 0.30), twoHand: 0.4 }),
  K(0.88, { yaw: -0.25, twist: -0.3, hip: v3(0, 0.84, 0.06), lean: 0.28, footL: v3(-0.27, 0.07, 0.36), footR: v3(0.24, 0.07, 0.05), hD: v3(-0.05, 1.3, 0.3), axis: v3(-0.3, 0.2, -0.9), face: v3(0.2, 0.6, 0.3), hO: v3(-0.12, 1.2, 0.34), twoHand: 0.9 }),
  K(1.0, {}),
];
const BH_TOP = [
  K(0.0, {}),
  K(0.2, { yaw: -0.95, twist: -0.4, hip: v3(0, 0.78, 0), lean: 0.3, footL: v3(-0.28, 0.07, -0.20), footR: v3(0.27, 0.07, 0.30), hD: v3(-0.22, 1.12, -0.12), hO: v3(-0.30, 1.08, -0.04), axis: v3(-0.35, 0.8, -0.55), face: v3(-0.2, 0, 1), twoHand: 1 }),
  K(0.36, { yaw: -1.0, twist: -0.4, hip: v3(0, 0.72, 0), lean: 0.34, footL: v3(-0.28, 0.07, -0.22), footR: v3(0.27, 0.07, 0.30), hD: v3(-0.28, 0.9, -0.14), hO: v3(-0.34, 0.84, -0.06), axis: v3(-0.4, -0.2, -0.88), face: v3(-0.3, 0.3, 1), twoHand: 1 }),
  K(0.5, { yaw: -0.55, twist: -0.08, hip: v3(0, 0.78, 0.06), lean: 0.3, footL: v3(-0.14, 0.07, -0.12), footR: v3(0.26, 0.07, 0.34), hD: v3(-0.32, 1.0, 0.52), hO: v3(-0.40, 0.96, 0.44), axis: v3(-0.2, 0.95, 0.28), face: v3(-0.05, 0.1, 1), twoHand: 1 }),
  K(0.7, { yaw: 0.45, twist: 0.5, hip: v3(0, 0.88, 0.1), lean: 0.2, footL: v3(-0.22, 0.17, -0.02), footR: v3(0.25, 0.07, 0.40), hD: v3(0.14, 1.65, 0.28), hO: v3(0.04, 1.60, 0.22), axis: v3(0.5, 0.55, -0.6), face: v3(-0.2, 0.7, 0.3), twoHand: 1 }),
  K(0.88, { yaw: 0.3, twist: 0.3, hip: v3(0, 0.84, 0.06), lean: 0.28, footL: v3(-0.24, 0.07, 0.05), footR: v3(0.27, 0.07, 0.36), hD: v3(0.08, 1.4, 0.3), hO: v3(-0.02, 1.36, 0.26), axis: v3(0.4, 0.2, -0.88), face: v3(-0.2, 0.6, 0.3), twoHand: 1 }),
  K(1.0, {}),
];
const FH_FLAT = FH_TOP.map(([t, p]) => [t, { ...p, hD: p.hD.slice(), axis: p.axis.slice(), face: p.face.slice() }]);
// flat: lower, more direct drop and a straighter finish
FH_FLAT[2][1].hD = v3(0.46, 1.0, -0.34); FH_FLAT[2][1].axis = v3(0.25, 0.1, -0.9);
FH_FLAT[4][1].hD = v3(0.15, 1.35, 0.5); FH_FLAT[4][1].axis = v3(-0.1, 0.5, -0.5);
const BH_FLAT = BH_TOP.map(([t, p]) => [t, { ...p, hD: p.hD.slice(), hO: p.hO.slice(), axis: p.axis.slice(), face: p.face.slice() }]);
BH_FLAT[2][1].hD = v3(-0.28, 1.05, -0.14); BH_FLAT[2][1].hO = v3(-0.34, 0.99, -0.06); BH_FLAT[2][1].axis = v3(-0.4, 0.1, -0.9);

const FH_SLICE = [
  K(0.0, {}),
  K(0.22, { yaw: 0.85, twist: 0.35, hip: v3(0, 0.80, 0), footL: v3(-0.27, 0.07, 0.28), footR: v3(0.28, 0.07, -0.18), hD: v3(0.42, 1.55, -0.22), axis: v3(0.3, 0.55, -0.7), face: v3(0.3, 0.8, 0.2), hO: v3(-0.05, 1.3, 0.35), twoHand: 0 }),
  K(0.5, { yaw: 0.5, twist: 0.0, hip: v3(0, 0.78, 0.05), footL: v3(-0.27, 0.07, 0.34), footR: v3(0.26, 0.07, -0.14), hD: v3(0.58, 1.05, 0.52), axis: v3(0.9, 0.25, 0.2), face: v3(0, 0.9, 0.3), hO: v3(-0.4, 1.2, -0.05), twoHand: 0 }),
  K(0.75, { yaw: 0.2, twist: -0.1, hip: v3(0, 0.80, 0.08), footL: v3(-0.27, 0.07, 0.38), footR: v3(0.26, 0.07, -0.02), hD: v3(0.5, 0.78, 0.78), axis: v3(0.3, -0.3, 0.9), face: v3(0, 0.9, 0.2), hO: v3(-0.42, 1.15, -0.1), twoHand: 0 }),
  K(1.0, {}),
];
const BH_SLICE = [
  K(0.0, {}),
  K(0.22, { yaw: -0.95, twist: -0.35, hip: v3(0, 0.80, 0), footL: v3(-0.28, 0.07, -0.18), footR: v3(0.27, 0.07, 0.28), hD: v3(-0.30, 1.6, -0.1), axis: v3(-0.3, 0.6, -0.7), face: v3(-0.2, 0.8, 0.2), hO: v3(0.28, 1.3, 0.0), twoHand: 0 }),
  K(0.5, { yaw: -0.6, twist: -0.05, hip: v3(0, 0.78, 0.05), footL: v3(-0.14, 0.07, -0.1), footR: v3(0.26, 0.07, 0.34), hD: v3(-0.62, 1.05, 0.45), axis: v3(-0.9, 0.2, 0.25), face: v3(0, 0.9, 0.3), hO: v3(0.45, 1.2, -0.2), twoHand: 0 }),
  K(0.75, { yaw: -0.3, twist: 0.0, hip: v3(0, 0.80, 0.08), footL: v3(-0.2, 0.07, 0.0), footR: v3(0.27, 0.07, 0.38), hD: v3(-0.6, 0.8, 0.75), axis: v3(-0.35, -0.3, 0.9), face: v3(0, 0.9, 0.2), hO: v3(0.45, 1.15, -0.2), twoHand: 0 }),
  K(1.0, {}),
];
const FH_LOB = [
  K(0.0, {}),
  K(0.25, { yaw: 0.85, twist: 0.35, hip: v3(0, 0.72, 0), footL: v3(-0.27, 0.07, 0.30), footR: v3(0.28, 0.07, -0.20), hD: v3(0.45, 0.7, -0.25), axis: v3(0.3, -0.5, -0.8), face: v3(0.2, 0.2, 1), hO: v3(-0.05, 1.2, 0.36), twoHand: 0 }),
  K(0.5, { yaw: 0.5, twist: 0.05, hip: v3(0, 0.74, 0.06), footL: v3(-0.27, 0.07, 0.34), footR: v3(0.26, 0.07, -0.14), hD: v3(0.56, 0.85, 0.5), axis: v3(0.15, 0.6, 0.7), face: v3(0.05, 0.5, 0.9), hO: v3(-0.3, 1.1, 0.2), twoHand: 0 }),
  K(0.72, { yaw: -0.2, twist: -0.4, hip: v3(0, 0.92, 0.1), footR: v3(0.22, 0.17, -0.02), footL: v3(-0.25, 0.07, 0.40), hD: v3(0.05, 1.95, 0.25), axis: v3(-0.3, 0.9, -0.3), face: v3(0.1, 0.1, 1), hO: v3(-0.25, 1.5, 0.2), twoHand: 0.3 }),
  K(1.0, {}),
];
const BH_LOB = [
  K(0.0, {}),
  K(0.25, { yaw: -0.95, twist: -0.4, hip: v3(0, 0.72, 0), footL: v3(-0.28, 0.07, -0.2), footR: v3(0.27, 0.07, 0.30), hD: v3(-0.28, 0.7, -0.1), hO: v3(-0.34, 0.64, -0.02), axis: v3(-0.3, -0.5, -0.8), face: v3(-0.2, 0.2, 1), twoHand: 1 }),
  K(0.5, { yaw: -0.55, twist: -0.05, hip: v3(0, 0.74, 0.06), footL: v3(-0.14, 0.07, -0.12), footR: v3(0.26, 0.07, 0.34), hD: v3(-0.32, 0.85, 0.5), hO: v3(-0.4, 0.8, 0.42), axis: v3(-0.15, 0.6, 0.7), face: v3(-0.05, 0.5, 0.9), twoHand: 1 }),
  K(0.72, { yaw: 0.3, twist: 0.4, hip: v3(0, 0.92, 0.1), footL: v3(-0.22, 0.17, -0.02), footR: v3(0.25, 0.07, 0.40), hD: v3(0.1, 1.95, 0.25), hO: v3(0.0, 1.9, 0.2), axis: v3(0.3, 0.9, -0.3), face: v3(-0.1, 0.1, 1), twoHand: 1 }),
  K(1.0, {}),
];
const FH_VOLLEY = [
  K(0.0, { hip: v3(0, 0.82, 0), lean: 0.28 }),
  K(0.25, { yaw: 0.3, twist: 0.2, hip: v3(0, 0.78, 0), hD: v3(0.34, 1.18, 0.12), axis: v3(0.05, 0.85, 0.2), face: v3(0.5, 0, 0.8), hO: v3(-0.12, 1.12, 0.3), twoHand: 0.3 }),
  K(0.5, { yaw: 0.15, twist: 0.05, hip: v3(0, 0.76, 0.05), footL: v3(-0.28, 0.07, 0.32), hD: v3(0.46, 1.12, 0.72), axis: v3(0.1, 0.85, 0.45), face: v3(0.05, 0.1, 1), hO: v3(-0.2, 1.1, 0.4), twoHand: 0.2 }),
  K(0.75, { yaw: 0.1, hip: v3(0, 0.78, 0.07), hD: v3(0.42, 1.0, 0.82), axis: v3(0.1, 0.5, 0.8), face: v3(0.05, 0.4, 0.9), hO: v3(-0.2, 1.1, 0.4), twoHand: 0.3 }),
  K(1.0, { hip: v3(0, 0.82, 0), lean: 0.28 }),
];
const BH_VOLLEY = [
  K(0.0, { hip: v3(0, 0.82, 0), lean: 0.28 }),
  K(0.25, { yaw: -0.3, twist: -0.2, hip: v3(0, 0.78, 0), hD: v3(-0.22, 1.18, 0.12), hO: v3(-0.3, 1.12, 0.18), axis: v3(-0.05, 0.85, 0.2), face: v3(-0.5, 0, 0.8), twoHand: 1 }),
  K(0.5, { yaw: -0.15, twist: -0.05, hip: v3(0, 0.76, 0.05), footR: v3(0.28, 0.07, 0.32), hD: v3(-0.3, 1.1, 0.72), hO: v3(-0.38, 1.06, 0.62), axis: v3(-0.1, 0.85, 0.45), face: v3(-0.05, 0.1, 1), twoHand: 1 }),
  K(0.75, { yaw: -0.1, hip: v3(0, 0.78, 0.07), hD: v3(-0.28, 1.0, 0.82), hO: v3(-0.36, 0.96, 0.72), axis: v3(-0.1, 0.5, 0.8), face: v3(-0.05, 0.4, 0.9), twoHand: 1 }),
  K(1.0, { hip: v3(0, 0.82, 0), lean: 0.28 }),
];
const SMASH = [
  K(0.0, {}),
  K(0.25, { yaw: 0.9, twist: 0.3, hip: v3(0, 0.82, 0), lean: 0.1, footL: v3(-0.24, 0.07, 0.2), footR: v3(0.26, 0.07, -0.16), hD: v3(0.3, 1.78, -0.18), axis: v3(0.1, 0.5, -0.85), face: v3(1, 0, 0.1), hO: v3(-0.1, 2.0, 0.3), twoHand: 0 }),
  K(0.42, { yaw: 0.8, twist: 0.2, hip: v3(0, 0.78, 0), lean: -0.05, hD: v3(0.28, 1.6, -0.35), axis: v3(0.1, -0.7, -0.7), hO: v3(-0.1, 2.15, 0.35), footL: v3(-0.24, 0.07, 0.2), footR: v3(0.26, 0.07, -0.16), face: v3(1, 0, 0.1), twoHand: 0 }),
  K(0.55, { yaw: 0.35, twist: 0.0, hip: v3(0, 1.0, 0.05), lean: 0.1, footL: v3(-0.22, 0.2, 0.2), footR: v3(0.22, 0.22, -0.05), hD: v3(0.18, 2.32, 0.28), axis: v3(0.05, 1, 0.12), face: v3(0.0, 0.1, 1), hO: v3(-0.2, 1.5, 0.4), twoHand: 0 }),
  K(0.78, { yaw: -0.3, twist: -0.3, hip: v3(0, 0.88, 0.15), lean: 0.3, footL: v3(-0.22, 0.07, 0.1), footR: v3(0.2, 0.07, 0.4), hD: v3(-0.15, 1.2, 0.5), axis: v3(-0.4, -0.7, 0.4), face: v3(0.3, 0.5, 0.3), hO: v3(-0.25, 1.15, 0.3), twoHand: 0.5 }),
  K(1.0, {}),
];
const SERVE = [
  K(0.0, { yaw: 1.15, twist: 0.0, hip: v3(0, 0.92, 0), lean: 0.12, footL: v3(-0.22, 0.07, 0.22), footR: v3(0.22, 0.07, -0.16), hD: v3(0.12, 1.0, 0.22), axis: v3(0.1, -0.35, 0.9), face: v3(1, 0, 0), hO: v3(-0.08, 1.05, 0.28), twoHand: 0 }),
  K(0.18, { yaw: 1.15, twist: 0.05, hip: v3(0, 0.9, 0), lean: 0.1, footL: v3(-0.22, 0.07, 0.22), footR: v3(0.22, 0.07, -0.16), hD: v3(0.2, 0.82, -0.08), axis: v3(0.1, -0.7, 0.7), face: v3(1, 0, 0), hO: v3(-0.1, 0.95, 0.3), twoHand: 0 }),
  K(0.32, { yaw: 1.1, twist: 0.1, hip: v3(0, 0.88, 0), lean: 0.0, footL: v3(-0.22, 0.07, 0.22), footR: v3(0.22, 0.07, -0.16), hD: v3(0.34, 1.3, -0.22), axis: v3(0.05, -0.3, -0.95), face: v3(1, 0, 0), hO: v3(-0.12, 1.95, 0.32), twoHand: 0 }),
  K(0.5, { yaw: 1.0, twist: 0.2, hip: v3(0, 0.80, -0.02), lean: -0.18, footL: v3(-0.22, 0.07, 0.22), footR: v3(0.22, 0.07, -0.16), hD: v3(0.32, 1.78, -0.12), axis: v3(0.05, 0.55, -0.85), face: v3(1, 0, 0), hO: v3(-0.08, 2.2, 0.36), twoHand: 0, headPitch: -0.5 }),
  K(0.58, { yaw: 0.9, twist: 0.15, hip: v3(0, 0.82, -0.02), lean: -0.2, footL: v3(-0.22, 0.07, 0.22), footR: v3(0.22, 0.07, -0.16), hD: v3(0.28, 1.6, -0.4), axis: v3(0.05, -0.8, -0.6), face: v3(1, 0, 0), hO: v3(-0.12, 1.7, 0.4), twoHand: 0, headPitch: -0.5 }),
  K(0.66, { yaw: 0.45, twist: 0.0, hip: v3(0, 1.0, 0.1), lean: 0.05, footL: v3(-0.2, 0.17, 0.25), footR: v3(0.2, 0.2, -0.05), hD: v3(0.16, 2.32, 0.30), axis: v3(0.05, 1, 0.1), face: v3(0.0, 0.1, 1), hO: v3(-0.22, 1.45, 0.4), twoHand: 0, headPitch: -0.4 }),
  K(0.82, { yaw: -0.25, twist: -0.3, hip: v3(0, 0.88, 0.2), lean: 0.3, footL: v3(-0.22, 0.07, 0.10), footR: v3(0.18, 0.07, 0.5), hD: v3(-0.2, 1.15, 0.5), axis: v3(-0.4, -0.8, 0.4), face: v3(0.3, 0.5, 0.3), hO: v3(-0.25, 1.1, 0.3), twoHand: 0.4 }),
  K(1.0, { hip: v3(0, 0.84, 0.1), footL: v3(-0.28, 0.07, 0.05), footR: v3(0.28, 0.07, 0.4), lean: 0.3 }),
];
const STROKES = {
  'topspin|fh': FH_TOP, 'topspin|bh': BH_TOP, 'flat|fh': FH_FLAT, 'flat|bh': BH_FLAT,
  'slice|fh': FH_SLICE, 'slice|bh': BH_SLICE, 'lob|fh': FH_LOB, 'lob|bh': BH_LOB,
  'volley|fh': FH_VOLLEY, 'volley|bh': BH_VOLLEY, 'smash|fh': SMASH, 'smash|bh': SMASH,
};

// ---------- gait ----------
function gait(phase, dir, speed, walk) {
  // dir: unit vector in body frame {x,z}; speed 0..1
  const g = phase * TAU;
  const amp = walk ? 0.22 : 0.20 + 0.28 * speed;
  const liftH = walk ? 0.07 : 0.10 + 0.20 * speed;
  const foot = (sgn, gg) => {
    const sw = Math.sin(gg) * amp, lift = Math.max(0, Math.cos(gg)) * liftH;
    return v3(sgn * 0.13 + dir.x * sw, 0.07 + lift, dir.z * sw);
  };
  const p = mk({});
  p.footL = foot(-1, g); p.footR = foot(1, g + Math.PI);
  const bob = Math.abs(Math.sin(g)) * (walk ? 0.02 : 0.05);
  p.hip = v3(0, (walk ? 0.94 : 0.88) - 0.03 * speed + bob - 0.02, 0);
  const lean = walk ? 0.08 : 0.2 + 0.25 * speed;
  p.lean = lean * clamp(0.4 + dir.z, 0.2, 1.4);
  p.side = clamp(dir.x * 0.18 * speed, -0.2, 0.2);
  const armAmp = walk ? 0.08 : 0.18 + 0.1 * speed;
  p.hD = v3(0.22, walk ? 0.88 : 1.0, 0.26 + armAmp * Math.sin(g));
  p.hO = v3(-0.22, walk ? 0.88 : 1.02, 0.22 + armAmp * Math.sin(g + Math.PI));
  p.axis = walk ? v3(0.0, -0.25, 0.95) : v3(0.05, 0.45, 0.88);
  p.twoHand = 0;
  p.twist = 0.18 * Math.sin(g) * (walk ? 0.4 : 1);
  return p;
}

// ---------- public: pose for an anim ----------
// ctx: { runPhase 0..1, time, role: 'near'|'far' }
export function poseFor(anim, ctx) {
  const name = anim.name || 'ready';
  const ph = clamp(anim.phase || 0, 0, 1);
  const time = ctx.time || 0;
  switch (name) {
    case 'swing': {
      const shot = anim.shot || 'topspin';
      const side = anim.side || 'fh';
      const frames = STROKES[`${shot}|${side}`] || STROKES[`topspin|${side}`];
      return sampleKeys(frames, ph);
    }
    case 'serve': return sampleKeys(SERVE, ph);
    case 'split': {
      const p = mk({ hip: v3(0, 0.74, 0), lean: 0.28, footL: v3(-0.36, 0.2, 0.05), footR: v3(0.36, 0.2, -0.05), hD: v3(0.15, 1.08, 0.44), hO: v3(-0.02, 1.1, 0.38) });
      return p;
    }
    case 'run': {
      let dx = anim.dir ? anim.dir.x : 0, dz = anim.dir ? anim.dir.z : 0;
      // convert world dir -> character-local (forward=+z, right=+x)
      const near = ctx.role === 'near';
      let cx = near ? dx : -dx, cz = near ? -dz : dz;
      const l = Math.hypot(cx, cz) || 1; cx /= l; cz /= l;
      const sp = clamp(anim.speed == null ? 0.7 : anim.speed, 0.15, 1);
      let yaw;
      if (cz >= -0.15) yaw = clamp(Math.atan2(cx, cz) * 0.75, -1.1, 1.1);
      else yaw = (cx >= 0 ? 1 : -1) * Math.min(1.1, 0.5 + Math.abs(cx));
      // direction relative to body after yaw
      const rel = rotY([cx, 0, cz], -yaw);
      const p = gait(ctx.runPhase || 0, { x: rel[0], z: rel[2] }, sp, false);
      p.yaw = yaw;
      p.twist += 0.0;
      // keep the racket arm in front when running sideways
      return p;
    }
    case 'walk': {
      const p = gait(ctx.runPhase || 0, { x: 0, z: 1 }, 0.4, true);
      return p;
    }
    case 'celebrate': {
      const t = (time * 2.2) % 1, g = Math.sin(t * TAU);
      const jump = Math.max(0, g) * 0.12;
      return mk({ hip: v3(0, 0.92 + jump, 0), lean: 0.0, footL: v3(-0.2, 0.07 + jump, 0.05), footR: v3(0.2, 0.07 + jump, -0.05), hD: v3(0.3, 2.05 + 0.15 * g, 0.12), axis: v3(0.3 + 0.2 * g, 0.9, 0.1), face: v3(0, 0, 1), hO: v3(-0.3, 1.95 - 0.12 * g, 0.1), twoHand: 0, headPitch: -0.2 });
    }
    case 'dejected': {
      const g = Math.sin(time * 1.3) * 0.03;
      return mk({ hip: v3(0, 0.9, 0), lean: 0.42 + g * 2, footL: v3(-0.2, 0.07, 0.05), footR: v3(0.2, 0.07, -0.02), hD: v3(0.24, 0.6, 0.18), axis: v3(0.05, -1, 0.3), face: v3(1, 0, 0), hO: v3(-0.22, 0.62, 0.1), twoHand: 0, headPitch: 0.5, yaw: 0.0 });
    }
    case 'idle': {
      const b = Math.sin(time * 2.2) * 0.012;
      return mk({ hip: v3(0, 0.93 + b, 0), lean: 0.1, footL: v3(-0.2, 0.07, 0.04), footR: v3(0.2, 0.07, -0.04), hD: v3(0.26, 0.86, 0.2), axis: v3(0.1, -0.45, 0.85), face: v3(1, 0, 0), hO: v3(-0.22, 0.84, 0.1), twoHand: 0 });
    }
    case 'ready':
    default: {
      const b = Math.sin(time * 3.0) * 0.012;
      return mk({ hip: v3(0, 0.80 + b, 0), hD: v3(0.14, 1.02 + b, 0.42), hO: v3(-0.02, 1.05 + b, 0.36) });
    }
  }
}

// ---------- IK / solve ----------
function ik2(root, target, l1, l2, pole) {
  let d = sub(target, root);
  let dist = len(d);
  const maxd = l1 + l2 - 0.005;
  if (dist > maxd) { target = add(root, mul(norm(d), maxd)); d = sub(target, root); dist = maxd; }
  const u = norm(d);
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  let pn = sub(pole, mul(u, dot(pole, u)));
  pn = norm(pn);
  return { mid: add(add(root, mul(u, along)), mul(pn, h)), end: target };
}

// Returns joints in character space (yaw applied, mirrored for left-handers).
export function solve(P, hand = 'R') {
  const B = BODY;
  const yaw = P.yaw;
  const H = P.hip;
  const u = norm([Math.sin(P.side), Math.cos(P.lean), Math.sin(P.lean)]);
  const C = add(H, mul(u, B.torso));
  const sa = [Math.cos(P.twist), 0, -Math.sin(P.twist)];
  const shR = add(add(C, mul(sa, B.shoulderHalf)), [0, -0.04, 0]);
  const shL = add(add(C, mul(sa, -B.shoulderHalf)), [0, -0.04, 0]);
  const neck = add(C, mul(u, 0.07));
  const headC = add(add(C, mul(u, B.neck + B.headR + 0.04)), [0, 0, 0.02 + 0.06 * Math.max(0, P.headPitch)]);
  const hipR = add(H, [B.hipHalf, 0, 0]), hipL = add(H, [-B.hipHalf, 0, 0]);
  const legR = ik2(hipR, P.footR, B.thigh, B.shin, [0.25, 0, 1]);
  const legL = ik2(hipL, P.footL, B.thigh, B.shin, [-0.25, 0, 1]);
  const armR = ik2(shR, P.hD, B.upperArm, B.foreArm, [0.55, -1, -0.35]);
  const axis = norm(P.axis);
  let hO = P.hO;
  if (P.twoHand > 0) hO = lerpV(P.hO, sub(P.hD, mul(axis, P.handLen)), P.twoHand);
  const armL = ik2(shL, hO, B.upperArm, B.foreArm, [-0.55, -1, -0.35]);
  let face = norm(sub(P.face, mul(axis, dot(P.face, axis))));
  if (len(face) < 1e-3) face = [1, 0, 0];
  const J = {
    hipC: H, hipR, hipL, chest: C, shR, shL, neck, head: headC, headPitch: P.headPitch, headYaw: P.headYaw,
    kneeR: legR.mid, ankR: legR.end, kneeL: legL.mid, ankL: legL.end,
    elbR: armR.mid, handR: armR.end, elbL: armL.mid, handL: armL.end,
    axis, face: norm(face), torsoUp: u, shoulderAxis: sa, twist: P.twist,
  };
  const mir = hand === 'L' ? -1 : 1;
  const T = (p) => { const q = rotY(p, yaw); return [q[0] * mir, q[1], q[2]]; };
  const T2 = (p) => { const q = rotY(p, yaw); return [q[0] * mir, q[1], q[2]]; };
  const out = {};
  for (const k in J) {
    const val = J[k];
    if (Array.isArray(val)) out[k] = (k === 'axis' || k === 'face' || k === 'torsoUp' || k === 'shoulderAxis') ? T2(val) : T(val);
    else out[k] = val;
  }
  out.yaw = yaw; out.mir = mir;
  return out;
}
