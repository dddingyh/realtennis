// Builds the volumetric body model (round cones + ellipsoids, SDF primitives) from a solved rig `J` (pose.js).
// Output primitives are expressed in VIEW space (x right on screen, y up, z away from the camera, metres) so the
// orthographic ray-marcher in char_sdf.js can shoot rays straight down +z.
import { BODY } from './pose.js';

export const MAT = { NONE: 0, SKIN: 1, HAIR: 2, SHIRT: 3, SHORTS: 4, SOCK: 5, SHOE: 6, SOLE: 7, BAND: 8, FRAME: 9, GRIP: 10, STRING: 11, EYE: 12, TRIM: 13, LACE: 14, HOLE: 255 };
export const HOOK = { NONE: 0, HEAD: 1, SLEEVE: 2, SHIN: 3, SHORTS: 4, SHIRT: 5, HAIR: 6 };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// camera: view = (right, up, forward) basis in character space
export function viewBasis(role) {
  // near player: we look at the back, camera pitched down by `pitch`
  const pitch = role === 'near' ? 0.42 : 0.24;
  const c = Math.cos(pitch), s = Math.sin(pitch);
  if (role === 'near') return { R: [1, 0, 0], U: [0, c, s], F: [0, -s, c], pitch };
  return { R: [-1, 0, 0], U: [0, c, -s], F: [0, -s, -c], pitch };
}

export function buildModel(J, look, role, s) {
  const { R, U, F } = viewBasis(role);
  const TP = (p) => [dot(p, R), dot(p, U), dot(p, F)]; // point / direction -> view space
  const prims = [];
  const K = 0.032; // smooth-union radius for organic joints
  const small = s < 26;
  const hs = small ? 1.10 : 1.0; // slightly oversized head at the small (far) size so it reads

  const cone = (m, a, b, ra, rb, k = K, hook = 0) => { prims.push({ t: 0, m, a: TP(a), b: TP(b), ra, rb, k, hook }); };
  const ell = (m, c, u, v, w, ru, rv, rw, k = K, hook = 0) => { prims.push({ t: 1, m, c: TP(c), u: TP(u), v: TP(v), w: TP(w), ru, rv, rw, k, hook }); };
  const frameOf = (fr) => [fr.r, fr.u, fr.f];

  // ---------------- torso ----------------
  const pel = J.pelvis, chs = J.chest;
  const midR = norm(lerpV(pel.r, chs.r, 0.5)), midU = norm(lerpV(pel.u, chs.u, 0.5)), midF = norm(cross(midR, midU));
  ell(MAT.SHORTS, add(J.hip, mul(pel.u, 0.025)), pel.r, pel.u, pel.f, 0.160, 0.105, 0.112, K, HOOK.SHORTS);
  ell(MAT.SHIRT, add(J.hip, mul(midU, 0.205)), midR, midU, midF, 0.138, 0.15, 0.098, 0.05, HOOK.SHIRT);
  ell(MAT.SHIRT, J.chestC, chs.r, chs.u, chs.f, 0.178, 0.175, 0.118, 0.05, HOOK.SHIRT);
  ell(MAT.SHIRT, add(add(J.neckBase, mul(chs.u, -0.11)), mul(chs.f, -0.018)), chs.r, chs.u, chs.f, 0.172, 0.10, 0.10, 0.05, HOOK.SHIRT);
  // trapezius slope + deltoid caps
  for (const sh of [J.shR, J.shL]) {
    cone(MAT.SHIRT, add(J.neckBase, mul(chs.u, 0.0)), sh, 0.050, 0.060, 0.05, HOOK.SHIRT);
    ell(MAT.SHIRT, sh, chs.r, chs.u, chs.f, 0.064, 0.066, 0.062, 0.04, HOOK.SHIRT);
  }
  // neck
  cone(MAT.SKIN, sub(J.neckBase, mul(chs.u, 0.03)), J.neckTop, 0.057, 0.050, 0.04);

  // ---------------- head ----------------
  const hd = J.head, hc = J.headC;
  const hr = 1.0 * hs;
  ell(MAT.SKIN, hc, hd.r, hd.u, hd.f, 0.078 * hr, 0.102 * hr, 0.092 * hr, 0.02, HOOK.HEAD);
  ell(MAT.SKIN, add(add(hc, mul(hd.u, -0.056 * hr)), mul(hd.f, 0.020 * hr)), hd.r, hd.u, hd.f, 0.060 * hr, 0.058 * hr, 0.062 * hr, 0.03, HOOK.HEAD);
  ell(MAT.HAIR, add(add(hc, mul(hd.u, 0.014 * hr)), mul(hd.f, -0.017 * hr)), hd.r, hd.u, hd.f, 0.085 * hr, 0.104 * hr, 0.099 * hr, 0.02, HOOK.HEAD);
  ell(MAT.HAIR, add(add(hc, mul(hd.u, -0.020 * hr)), mul(hd.f, -0.050 * hr)), hd.r, hd.u, hd.f, 0.068 * hr, 0.066 * hr, 0.055 * hr, 0.03, HOOK.HEAD);

  // ---------------- arms ----------------
  const arm = (sh, el, wr, handC, handDir, gripping, dominant) => {
    const mid = lerpV(sh, el, 0.46), f30 = lerpV(el, wr, 0.30);
    cone(MAT.SKIN, sh, mid, 0.054, 0.050);
    cone(MAT.SKIN, mid, el, 0.050, 0.041);
    cone(MAT.SKIN, el, f30, 0.041, 0.046);
    cone(MAT.SKIN, f30, wr, 0.046, 0.031);
    // short sleeve with hem trim
    cone(MAT.SHIRT, sh, lerpV(sh, el, 0.56), 0.068, 0.062, 0.03, HOOK.SLEEVE);
    // wristband
    cone(MAT.BAND, lerpV(wr, el, 0.02), lerpV(wr, el, 0.17), 0.037, 0.039, 0.0);
    // hand
    if (gripping) {
      const ax = handDir, side = norm(cross(ax, J.racket.face)), nn = norm(cross(ax, side));
      ell(MAT.SKIN, handC, ax, side, nn, 0.052, 0.040, 0.044, 0.02);
    } else {
      const d = handDir;
      let sd = cross(d, [0, 1, 0]); if (len(sd) < 0.2) sd = [1, 0, 0]; sd = norm(sd);
      const nn = norm(cross(d, sd));
      ell(MAT.SKIN, handC, d, sd, nn, 0.072, 0.034, 0.022, 0.02);
    }
  };
  arm(J.shR, J.elbR, J.wrR, J.handRc, J.racket.axis, true, true);
  arm(J.shL, J.elbL, J.wrL, J.handLc, J.handLdir, J.handLgrip, false);

  // ---------------- legs ----------------
  const leg = (hj, kn, an, ft) => {
    const t40 = lerpV(hj, kn, 0.42);
    cone(MAT.SKIN, hj, t40, 0.090, 0.080);
    cone(MAT.SKIN, t40, kn, 0.080, 0.056);
    ell(MAT.SKIN, kn, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.054, 0.054, 0.054, 0.03);
    cone(MAT.SHORTS, hj, lerpV(hj, kn, 0.60), 0.098, 0.099, 0.02, HOOK.SHORTS);
    const c30 = lerpV(kn, an, 0.30);
    cone(MAT.SKIN, kn, c30, 0.054, 0.059, K, HOOK.SHIN);
    cone(MAT.SKIN, c30, an, 0.059, 0.036, K, HOOK.SHIN);
    // shoe: chunky upper, light sole, collar
    const fw = ft.dir;
    const heel = add(add(an, mul(fw, -0.052)), [0, -0.030, 0]);
    const toe = add(add(an, mul(fw, 0.140)), [0, -0.040 + 0.0, 0]);
    cone(MAT.SHOE, heel, toe, 0.046, 0.041, 0.03);
    cone(MAT.SOLE, add(heel, [0, -0.027, 0]), add(toe, [0, -0.027, 0]), 0.031, 0.029, 0.0);
    cone(MAT.SHOE, add(an, [0, -0.01, 0]), add(an, [0, 0.025, 0]), 0.043, 0.041, 0.03);
    // laces / tongue
    const ins = add(add(an, mul(fw, 0.065)), [0, 0.012, 0]);
    cone(MAT.LACE, add(an, mul(fw, 0.03)), ins, 0.020, 0.022, 0.0);
  };
  leg(J.hjR, J.kneeR, J.ankR, J.footR);
  leg(J.hjL, J.kneeL, J.ankL, J.footL);

  // ---------------- racket ----------------
  const rk = J.racket;
  const ax = rk.axis, side = norm(cross(ax, rk.face)), pxm = 1 / s;
  const fr = Math.max(0.0105, 0.62 * pxm);
  const at = (t) => add(rk.butt, mul(ax, t));
  cone(MAT.GRIP, at(-0.004), at(0.20), 0.0175, 0.0155, 0.0);
  const hcn = at(0.30 + 0.1925), a = 0.1925, b = 0.135;
  const ring = [];
  const NR = small ? 12 : 16;
  for (let i = 0; i < NR; i++) {
    const th = (i / NR) * Math.PI * 2;
    ring.push(add(hcn, add(mul(ax, a * Math.cos(th)), mul(side, b * Math.sin(th)))));
  }
  for (let i = 0; i < NR; i++) cone(MAT.FRAME, ring[i], ring[(i + 1) % NR], fr, fr, 0.0);
  // throat (Y): two struts from the top of the handle to the base of the ring
  const tp = at(0.205);
  const bl = add(hcn, add(mul(ax, -a * Math.cos(0.62)), mul(side, -b * Math.sin(0.62)))), br = add(hcn, add(mul(ax, -a * Math.cos(0.62)), mul(side, b * Math.sin(0.62))));
  cone(MAT.FRAME, tp, bl, fr, fr, 0.0);
  cone(MAT.FRAME, tp, br, fr, fr, 0.0);
  cone(MAT.FRAME, at(0.19), tp, fr * 1.3, fr, 0.0);
  const strings = { c: TP(hcn), n: TP(rk.face), u: TP(ax), v: TP(side), a: a - fr * 0.9, b: b - fr * 0.9 };

  const head = { c: TP(hc), u: TP(hd.r), v: TP(hd.u), w: TP(hd.f), ru: 0.078 * hr, rv: 0.102 * hr, rw: 0.092 * hr };
  const neck = { c: TP(J.neckBase) };
  return { prims, strings, head, neck, basis: { R, U, F } };
}
