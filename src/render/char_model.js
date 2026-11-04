// Volumetric athlete model: rig `J` (pose.js) -> SDF primitives (round cones + ellipsoids) in VIEW space
// (x right on screen, y up, z away from the camera, metres). char_sdf.js ray-marches them at sprite resolution.
//
// Anatomy is built from muscle masses rather than tubes: deltoid / biceps / triceps / forearm flexors, lats, pecs,
// trapezius, glutes, quads + hamstrings + vastus medialis, gastrocnemius with an Achilles narrowing, malleoli.
// Costume: crew-neck shirt (separate sleeve parts so seams appear), shorts (waistband, flared legs, side stripe),
// wristbands, crew socks with cuff, shoes (upper, toe cap, heel counter, laces, sole), optional headband / cap.
// Detail level follows the pixel size `s` (px per metre).
import { BODY } from './pose.js';

export const MAT = {
  NONE: 0, SKIN: 1, HAIR: 2, SHIRT: 3, SHORTS: 4, SOCK: 5, SHOE: 6, SOLE: 7, BAND: 8, FRAME: 9, GRIP: 10, STRING: 11,
  EYE: 12, TRIM: 13, LACE: 14, ACCENT: 15, SHOE2: 16, STRIM: 17, CAP: 18, RACC: 19, BROW: 20, HOLE: 255,
};
export const HOOK = { NONE: 0, HEAD: 1, SLEEVE: 2, SHIN: 3, SLEG: 4, TORSO: 5, PELVIS: 6, SHOE: 7, GRIP: 8, FRAME: 9, HAIR: 10 };
export const PART = { TORSO: 1, SLEEVE_R: 2, SLEEVE_L: 3, PELVIS: 4, SLEG_R: 5, SLEG_L: 6, BODY: 7, HAIR: 8, RACKET: 9, SHOE: 10 };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const perp = (v, a) => sub(v, mul(a, dot(v, a))); // component of v orthogonal to unit a
const comb = (o, ...terms) => { let p = o; for (let i = 0; i < terms.length; i += 2) p = add(p, mul(terms[i], terms[i + 1])); return p; };
// orthonormal frame with first axis a and second axis close to `hint`
function basis(a, hint) {
  let b = perp(hint, a);
  if (len(b) < 1e-3) b = perp(Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], a);
  b = norm(b);
  return [a, b, norm(cross(a, b))];
}

// camera: view = (right, up, forward) basis in character space
export function viewBasis(role) {
  const pitch = role === 'near' ? 0.48 : 0.24;
  const c = Math.cos(pitch), s = Math.sin(pitch);
  if (role === 'near') return { R: [1, 0, 0], U: [0, c, s], F: [0, -s, c], pitch };
  return { R: [-1, 0, 0], U: [0, c, -s], F: [0, -s, -c], pitch };
}

// detail level from pixel size
export function lodOf(s) { return s >= 34 ? 2 : s >= 20 ? 1 : 0; }

export function buildModel(J, look, role, s, opt = {}) {
  const { R, U, F } = viewBasis(role);
  const TP = (p) => [dot(p, R), dot(p, U), dot(p, F)]; // point / direction -> view space
  const lod = lodOf(s);
  const prims = [];
  const K = 0.03;
  const lag = opt.lag || [0, 0, 0]; // secondary-motion offset (metres, character space) for hair / tails

  const cone = (m, a, b, ra, rb, k, part, hook = 0, ex = null) => { prims.push({ t: 0, m, a: TP(a), b: TP(b), ra, rb, k, part, hook, ex }); };
  const ell = (m, c, ax, r3, k, part, hook = 0, ex = null) => {
    prims.push({ t: 1, m, c: TP(c), u: TP(ax[0]), v: TP(ax[1]), w: TP(ax[2]), ru: r3[0], rv: r3[1], rw: r3[2], k, part, hook, ex });
  };
  const sph = (m, c, r, k, part, hook = 0) => ell(m, c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [r, r, r], k, part, hook);

  // ================================================================ torso
  const pel = J.pelvis, chs = J.chest;
  const P3 = [pel.r, pel.u, pel.f], C3 = [chs.r, chs.u, chs.f];
  const midR = norm(lerpV(pel.r, chs.r, 0.5)), midU = norm(lerpV(pel.u, chs.u, 0.5)), midF = norm(cross(midR, midU));
  const M3 = [midR, midU, midF];
  // twist between chest and pelvis (drives shirt folds)
  const twist = Math.atan2(dot(cross(pel.f, chs.f), [0, 1, 0]), dot(pel.f, chs.f));
  // pelvis + glutes (shorts)
  ell(MAT.SHORTS, comb(J.hip, pel.u, 0.03), P3, [0.158, 0.105, 0.108], K, PART.PELVIS, HOOK.PELVIS);
  for (const sg of [1, -1]) ell(MAT.SHORTS, comb(J.hip, pel.r, 0.072 * sg, pel.f, -0.048, pel.u, -0.035), P3, [0.080, 0.090, 0.070], 0.06, PART.PELVIS, HOOK.PELVIS);
  // waist, ribcage, lats, pecs, upper back
  ell(MAT.SHIRT, comb(J.hip, midU, 0.200), M3, [0.136, 0.135, 0.100], 0.07, PART.TORSO, HOOK.TORSO);
  ell(MAT.SHIRT, J.chestC, C3, [0.158, 0.165, 0.108], 0.07, PART.TORSO, HOOK.TORSO);
  for (const sg of [1, -1]) {
    ell(MAT.SHIRT, comb(J.chestC, chs.r, 0.085 * sg, chs.f, -0.030, chs.u, -0.01), C3, [0.078, 0.14, 0.070], 0.07, PART.TORSO, HOOK.TORSO);
    ell(MAT.SHIRT, comb(J.chestC, chs.r, 0.066 * sg, chs.f, 0.050, chs.u, 0.065), C3, [0.074, 0.058, 0.050], 0.06, PART.TORSO, HOOK.TORSO);
  }
  ell(MAT.SHIRT, comb(J.neckBase, chs.u, -0.08, chs.f, -0.035), C3, [0.13, 0.075, 0.066], 0.05, PART.TORSO, HOOK.TORSO);
  // trapezius slope and clavicles: proper neck-to-shoulder line
  for (const sh of [J.shR, J.shL]) {
    cone(MAT.SHIRT, comb(J.neckBase, chs.u, 0.025, chs.f, -0.012), comb(sh, chs.u, 0.018), 0.046, 0.036, 0.045, PART.TORSO, HOOK.TORSO);
    cone(MAT.SHIRT, comb(J.neckBase, chs.f, 0.05, chs.u, -0.03), comb(sh, chs.f, 0.028), 0.022, 0.022, 0.03, PART.TORSO, HOOK.TORSO);
  }
  // neck (with a hint of sternocleidomastoid taper)
  cone(MAT.SKIN, comb(J.neckBase, chs.u, -0.035), J.neckTop, 0.056, 0.047, 0.035, PART.BODY);

  // ================================================================ head
  const hd = J.head, hc = J.headC;
  const hs = lod === 2 ? 1.05 : lod === 1 ? 1.10 : 1.16; // heads read slightly larger at small sizes
  const H3 = [hd.r, hd.u, hd.f];
  const hp = (x, y, z) => comb(hc, hd.r, x * hs, hd.u, y * hs, hd.f, z * hs);
  const hr = (a, b, c) => [a * hs, b * hs, c * hs];
  ell(MAT.SKIN, hp(0, 0.008, -0.012), H3, hr(0.077, 0.097, 0.094), 0.02, PART.BODY, HOOK.HEAD);         // cranium
  ell(MAT.SKIN, hp(0, -0.022, 0.028), H3, hr(0.064, 0.080, 0.070), 0.03, PART.BODY, HOOK.HEAD);         // face mass
  ell(MAT.SKIN, hp(0, -0.064, 0.026), H3, hr(0.054, 0.040, 0.058), 0.03, PART.BODY, HOOK.HEAD);         // jaw
  ell(MAT.SKIN, hp(0, -0.088, 0.058), H3, hr(0.025, 0.022, 0.022), 0.025, PART.BODY, HOOK.HEAD);        // chin
  if (lod >= 1) {
    cone(MAT.SKIN, hp(0, 0.004, 0.082), hp(0, -0.030, 0.098), 0.009 * hs, 0.013 * hs, 0.012, PART.BODY, HOOK.HEAD); // nose
    cone(MAT.SKIN, hp(-0.045, 0.034, 0.076), hp(0.045, 0.034, 0.076), 0.012 * hs, 0.012 * hs, 0.02, PART.BODY, HOOK.HEAD); // brow ridge
  }
  for (const sg of [1, -1]) ell(MAT.SKIN, hp(0.079 * sg, -0.008, -0.004), H3, hr(0.013, 0.030, 0.020), 0.012, PART.BODY, HOOK.HEAD); // ears

  // hair: cap + clumps (volume, broken silhouette); clumps trail the head motion slightly
  const hairLag = mul(lag, 0.5);
  const cap = !!look.cap;
  ell(MAT.HAIR, hp(0, 0.018, -0.022), H3, hr(0.084, 0.098, 0.099), 0.02, PART.HAIR, HOOK.HAIR);
  ell(MAT.HAIR, hp(0, -0.012, -0.055), H3, hr(0.068, 0.062, 0.052), 0.03, PART.HAIR, HOOK.HAIR); // nape
  if (lod >= 1 && !cap) {
    const CL = [[0, 0.085, 0.045, 0.040], [0.040, 0.075, 0.02, 0.034], [-0.042, 0.074, 0.015, 0.034], [0, 0.090, -0.02, 0.040],
      [0.050, 0.055, -0.045, 0.036], [-0.050, 0.055, -0.045, 0.036], [0, 0.060, -0.075, 0.040], [0.022, 0.07, 0.07, 0.026], [-0.03, 0.068, 0.068, 0.026]];
    for (const [x, y, z, r] of CL) ell(MAT.HAIR, add(hp(x, y, z), hairLag), H3, hr(r, r * 0.8, r), 0.022, PART.HAIR, HOOK.HAIR);
  }
  if (cap) {
    ell(MAT.CAP, hp(0, 0.032, -0.012), H3, hr(0.090, 0.085, 0.104), 0.01, PART.HAIR, HOOK.HAIR);
    ell(MAT.CAP, hp(0, 0.040, 0.105), H3, hr(0.07, 0.010, 0.06), 0.0, PART.HAIR); // brim
  }
  // headband: a raised ring + knot tails at the back
  if (look.headband && !cap) {
    const NB = lod === 2 ? 14 : 10, ring = [];
    for (let i = 0; i < NB; i++) {
      const th = (i / NB) * Math.PI * 2;
      ring.push(hp(Math.sin(th) * 0.086, 0.045 + 0.012 * Math.cos(th), Math.cos(th) * 0.100 - 0.012));
    }
    for (let i = 0; i < NB; i++) cone(MAT.BAND, ring[i], ring[(i + 1) % NB], 0.013 * hs, 0.013 * hs, 0.0, PART.HAIR);
    if (lod >= 1) {
      const kb = hp(0, 0.035, -0.108);
      for (const sg of [1, -1]) cone(MAT.BAND, kb, add(add(kb, comb([0, 0, 0], hd.r, 0.018 * sg, hd.u, -0.07, hd.f, -0.03)), mul(lag, 1.2)), 0.010, 0.007, 0.0, PART.HAIR);
    }
  }

  // ================================================================ arms
  const arm = (sh, el, wr, handC, handDir, gripping, sgn, partSleeve) => {
    const a = norm(sub(el, sh)), fa = norm(sub(wr, el));
    let bend = perp(fa, a); bend = len(bend) < 0.08 ? norm(perp(chs.f, a)) : norm(bend); // biceps side
    const side = norm(cross(a, bend));
    const A3 = [a, bend, side];
    const ul = len(sub(el, sh)), fl = len(sub(wr, el));
    // deltoid + sleeve (shirt)
    ell(MAT.SHIRT, comb(sh, a, 0.040, chs.u, 0.006), A3, [0.083, 0.058, 0.060], 0.04, partSleeve, HOOK.SLEEVE, { a: TP(sh), d: TP(a), L: 0.155 });
    cone(MAT.SHIRT, sh, comb(sh, a, 0.155), 0.062, 0.056, 0.03, partSleeve, HOOK.SLEEVE, { a: TP(sh), d: TP(a), L: 0.155 });
    // upper arm: humerus core + biceps + triceps
    cone(MAT.SKIN, sh, el, 0.045, 0.036, K, PART.BODY);
    if (lod >= 1) {
      ell(MAT.SKIN, comb(sh, a, ul * 0.56, bend, 0.014), A3, [0.095, 0.031, 0.035], 0.03, PART.BODY);
      ell(MAT.SKIN, comb(sh, a, ul * 0.46, bend, -0.019), A3, [0.105, 0.033, 0.037], 0.03, PART.BODY);
    }
    sph(MAT.SKIN, comb(el, bend, -0.006), 0.034, 0.03, PART.BODY);
    // forearm: flexor/brachioradialis bulge near the elbow, tapering to a flat wrist
    const fb = norm(perp(bend, fa)), fs = norm(cross(fa, fb));
    cone(MAT.SKIN, el, wr, 0.036, 0.024, K, PART.BODY);
    if (lod >= 1) ell(MAT.SKIN, comb(el, fa, fl * 0.27, fs, 0.006 * sgn), [fa, fb, fs], [0.090, 0.039, 0.042], 0.035, PART.BODY);
    ell(MAT.SKIN, wr, [fa, fb, fs], [0.022, 0.020, 0.028], 0.02, PART.BODY);
    // wristband
    cone(MAT.BAND, comb(wr, fa, -0.012), comb(wr, fa, -0.075), 0.033, 0.035, 0.0, PART.BODY);
    // hand
    if (gripping) {
      const ax = handDir, fc = J.racket.face, sd = norm(cross(ax, fc));
      ell(MAT.SKIN, handC, [ax, sd, fc], [0.050, 0.040, 0.042], 0.018, PART.BODY);                   // fist
      if (lod >= 2) {
        cone(MAT.SKIN, comb(handC, ax, -0.034, fc, 0.030), comb(handC, ax, 0.036, fc, 0.026), 0.016, 0.014, 0.015, PART.BODY); // knuckle roll
        cone(MAT.SKIN, comb(handC, ax, -0.030, sd, 0.030), comb(handC, ax, 0.020, sd, 0.020, fc, -0.018), 0.013, 0.011, 0.012, PART.BODY); // thumb
      }
    } else {
      const d = handDir;
      const [, sd, nn] = basis(d, cross(d, [0, 1, 0]));
      ell(MAT.SKIN, handC, [d, sd, nn], [0.070, 0.036, 0.024], 0.02, PART.BODY);
      if (lod >= 2) cone(MAT.SKIN, comb(handC, d, -0.03, sd, 0.03 * sgn), comb(handC, d, 0.02, sd, 0.045 * sgn), 0.013, 0.011, 0.012, PART.BODY);
    }
  };
  arm(J.shR, J.elbR, J.wrR, J.handRc, J.racket.axis, true, 1, PART.SLEEVE_R);
  arm(J.shL, J.elbL, J.wrL, J.handLc, J.handLdir, J.handLgrip, -1, PART.SLEEVE_L);

  // ================================================================ legs
  const leg = (hj, kn, an, ft, sgn, partLeg) => {
    const a = norm(sub(kn, hj)), sa = norm(sub(an, kn));
    let kf = perp(sub(kn, lerpV(hj, an, 0.5)), a);
    kf = len(kf) < 0.02 ? norm(perp(ft.dir, a)) : norm(kf); // knee forward
    const kside = norm(cross(a, kf));
    const inward = mul(kside, -sgn * Math.sign(dot(kside, pel.r) || 1));
    const tl = len(sub(kn, hj)), sl = len(sub(an, kn));
    const T3 = [a, kf, kside];
    // thigh: femur core + quads + hamstrings + vastus medialis teardrop
    cone(MAT.SKIN, hj, kn, 0.082, 0.049, K, PART.BODY);
    ell(MAT.SKIN, comb(hj, a, tl * 0.50, kf, 0.022), T3, [0.20, 0.060, 0.066], 0.04, PART.BODY);
    if (lod >= 1) {
      ell(MAT.SKIN, comb(hj, a, tl * 0.42, kf, -0.03), T3, [0.19, 0.054, 0.060], 0.04, PART.BODY);
      ell(MAT.SKIN, add(comb(hj, a, tl * 0.84, kf, 0.012), mul(inward, 0.028)), T3, [0.062, 0.034, 0.033], 0.03, PART.BODY);
      ell(MAT.SKIN, comb(kn, kf, 0.026, a, -0.004), T3, [0.030, 0.022, 0.030], 0.02, PART.BODY); // patella
    }
    // shorts leg (flared), with hem + side stripe painted
    const outward = mul(inward, -1);
    cone(MAT.SHORTS, comb(hj, a, -0.02), comb(hj, a, tl * 0.50), 0.099, 0.104, 0.02, partLeg, HOOK.SLEG, { a: TP(comb(hj, a, -0.02)), d: TP(a), L: tl * 0.52, o: TP(outward) });
    // lower leg: tibia core + gastrocnemius (two heads) + Achilles narrowing
    let sb = perp(kf, sa); sb = len(sb) < 0.05 ? norm(perp(ft.dir, sa)) : norm(sb);
    const ss = norm(cross(sa, sb));
    const S3 = [sa, sb, ss];
    const shinEx = { a: TP(kn), d: TP(sa), L: sl };
    cone(MAT.SKIN, kn, an, 0.046, 0.025, K, PART.BODY, HOOK.SHIN, shinEx);
    ell(MAT.SKIN, comb(kn, sa, sl * 0.28, sb, -0.026), S3, [0.12, 0.042, 0.048], 0.035, PART.BODY, HOOK.SHIN, shinEx);
    if (lod >= 1) {
      ell(MAT.SKIN, add(comb(kn, sa, sl * 0.33, sb, -0.020), mul(inward, 0.016)), S3, [0.10, 0.038, 0.034], 0.03, PART.BODY, HOOK.SHIN, shinEx);
      cone(MAT.SKIN, comb(kn, sa, sl * 0.62, sb, -0.020), comb(an, sb, -0.026), 0.020, 0.016, 0.02, PART.BODY, HOOK.SHIN, shinEx); // Achilles
    }
    ell(MAT.SKIN, an, S3, [0.030, 0.026, 0.034], 0.02, PART.BODY, HOOK.SHIN, shinEx); // malleoli
    // shoe
    const fw = ft.dir;
    const fsd = norm(cross([0, 1, 0], fw)), fup = norm(cross(fw, fsd));
    const F3 = [fw, fup, fsd];
    const heel = comb(an, fw, -0.050, fup, -0.030), toe = comb(an, fw, 0.150, fup, -0.040);
    const shoeEx = { a: TP(heel), d: TP(norm(sub(toe, heel))), L: len(sub(toe, heel)), o: TP(fsd), up: TP(fup) };
    cone(MAT.SHOE, heel, toe, 0.047, 0.042, 0.03, PART.SHOE, HOOK.SHOE, shoeEx);
    cone(MAT.SHOE, comb(an, fup, -0.012), comb(an, fup, 0.032), 0.045, 0.041, 0.03, PART.SHOE, HOOK.SHOE, shoeEx); // collar
    if (lod >= 1) {
      ell(MAT.SHOE2, comb(toe, fw, 0.006, fup, -0.004), F3, [0.042, 0.034, 0.043], 0.015, PART.SHOE);          // toe cap
      ell(MAT.SHOE2, comb(heel, fw, -0.004, fup, 0.006), F3, [0.032, 0.040, 0.044], 0.015, PART.SHOE);         // heel counter
      cone(MAT.LACE, comb(an, fw, 0.022, fup, 0.020), comb(an, fw, 0.092, fup, 0.002), 0.021, 0.020, 0.0, PART.SHOE); // laces / tongue
    }
    cone(MAT.SOLE, comb(heel, fw, -0.008, fup, -0.028), comb(toe, fw, 0.010, fup, -0.028), 0.031, 0.029, 0.0, PART.SHOE);
  };
  leg(J.hjR, J.kneeR, J.ankR, J.footR, 1, PART.SLEG_R);
  leg(J.hjL, J.kneeL, J.ankL, J.footL, -1, PART.SLEG_L);

  // ================================================================ racket (68.5 cm)
  const rk = J.racket;
  const ax = rk.axis, side = norm(cross(ax, rk.face)), pxm = 1 / s;
  const fr = Math.max(0.0085, 0.55 * pxm);
  const at = (t) => add(rk.butt, mul(ax, t));
  const gripEx = { a: TP(rk.butt), d: TP(ax), s: TP(side), n: TP(rk.face) };
  cone(MAT.GRIP, at(0.004), at(0.195), 0.0165, 0.0150, 0.0, PART.RACKET, HOOK.GRIP, gripEx);
  ell(MAT.FRAME, at(0.002), [ax, side, rk.face], [0.008, 0.020, 0.018], 0.0, PART.RACKET); // butt cap
  const hcn = at(0.30 + 0.1925), A = 0.1925, Bw = 0.133;
  const NR = lod === 2 ? 18 : lod === 1 ? 14 : 12;
  const beams = lod === 2 ? [-0.0055, 0.0055] : [0];
  const ringPt = (th, off) => comb(hcn, ax, A * Math.cos(th), side, Bw * Math.sin(th), rk.face, off);
  for (const off of beams) {
    for (let i = 0; i < NR; i++) {
      const t0 = (i / NR) * Math.PI * 2, t1 = ((i + 1) / NR) * Math.PI * 2;
      cone(MAT.FRAME, ringPt(t0, off), ringPt(t1, off), fr, fr, 0.0, PART.RACKET, HOOK.FRAME, { th: (t0 + t1) / 2 });
    }
  }
  // throat: open triangle (two struts from the handle into the bottom of the hoop)
  const tp = at(0.215), thb = Math.PI - 0.62;
  for (const sg of [1, -1]) cone(MAT.FRAME, tp, ringPt(Math.PI + sg * 0.62, 0), fr * 1.15, fr, 0.0, PART.RACKET, HOOK.FRAME, { th: -1 });
  cone(MAT.FRAME, at(0.19), tp, fr * 1.5, fr * 1.2, 0.0, PART.RACKET, HOOK.FRAME, { th: -1 });
  void thb;
  const inner = fr * (beams.length > 1 ? 1.0 : 0.9);
  const strings = { c: TP(hcn), n: TP(rk.face), u: TP(ax), v: TP(side), a: A - inner, b: Bw - inner };

  const head = { c: TP(hp(0, 0.008, -0.012)), u: TP(hd.r), v: TP(hd.u), w: TP(hd.f), ru: 0.077 * hs, rv: 0.097 * hs, rw: 0.094 * hs };
  const torso = { c: TP(J.waist), r: TP(midR), u: TP(midU), f: TP(midF), twist, neck: TP(J.neckBase), chestU: TP(chs.u), chestF: TP(chs.f) };
  return { prims, strings, head, torso, lod, look };
}
