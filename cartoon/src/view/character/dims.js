// Proportion tables ("styles") and the rig definition derived from them.
// One parametric table drives the skeleton, the sculpted geometry and the animator, so every pose works for both styles.
import * as THREE from 'three';

export const STYLES = ['chibi', 'anime'];

// All lengths in metres. Racket stays a real racket (0.685 m) but is scaled by racketK.
export const DIMS = {
  chibi: {
    id: 'chibi',
    thigh: 0.325, shin: 0.305, ankleH: 0.085, legX: 0.078, hipOff: 0.015,
    spine: 0.065, chest: 0.085, neckUp: 0.10, clavUp: 0.09, clavX: 0.06, uaX: 0.072,
    ua: 0.31, fa: 0.285, palm: 0.07, headUp: 0.02,
    headH: 0.47, headW: 0.215, headD: 0.205, chinY: 0.018,
    // torso girth
    hipW: 0.118, hipD: 0.098, waistW: 0.105, waistD: 0.088, chestW: 0.118, chestD: 0.096, shW: 0.112,
    armR: 0.047, wristR: 0.036, thighR: 0.066, calfR: 0.05, ankleR: 0.042, neckR: 0.05,
    handK: 1.22, shoeK: 1.3, racketK: 1.15,
    // animation retargeting of the (human-scaled) pose tables
    kY: 0.80, kXZ: 0.88, jmpK: 1.5, sqK: 1.5, stretchMax: 1.34, legStretch: 1.16, gaitK: 1.4,
  },
  anime: {
    id: 'anime',
    thigh: 0.425, shin: 0.41, ankleH: 0.07, legX: 0.083, hipOff: 0.02,
    spine: 0.10, chest: 0.15, neckUp: 0.17, clavUp: 0.155, clavX: 0.055, uaX: 0.09,
    ua: 0.335, fa: 0.305, palm: 0.07, headUp: 0.055,
    headH: 0.31, headW: 0.112, headD: 0.108, chinY: 0.025,
    hipW: 0.138, hipD: 0.095, waistW: 0.098, waistD: 0.075, chestW: 0.138, chestD: 0.088, shW: 0.15,
    armR: 0.034, wristR: 0.026, thighR: 0.062, calfR: 0.038, ankleR: 0.03, neckR: 0.032,
    handK: 1.0, shoeK: 1.0, racketK: 1.0,
    kY: 1.02, kXZ: 1.0, jmpK: 1.05, sqK: 1.0, stretchMax: 1.12, legStretch: 1.06, gaitK: 1.0,
  },
};
for (const k of STYLES) {
  const D = DIMS[k];
  D.hip0 = D.thigh + D.shin + D.ankleH + D.hipOff;           // standing pelvis height
  D.shoulderY = D.hip0 + D.spine + D.chest + D.clavUp;
  D.headY = D.hip0 + D.spine + D.chest + D.neckUp + D.headUp; // head bone (base of skull)
  D.armLen = D.ua + D.fa;
  D.height = D.headY + D.chinY + D.headH;
}

// [name, parent, restX, restY, restZ]  canonical body frame: +z forward, +y up, +x = dominant side
export const BONE_NAMES = [
  'pelvis', 'spine', 'chest', 'neck', 'head', 'clavD', 'uaD', 'faD', 'handD', 'clavN', 'uaN', 'faN', 'handN',
  'thighD', 'shinD', 'footD', 'thighN', 'shinN', 'footN',
  // secondary-motion bones (head-local anchors, chains hang along -y)
  'ponyA1', 'ponyA2', 'ponyA3',   // 19-21 high ponytail / side tail anchor at the back-top of the head
  'tailL1', 'tailL2', 'tailL3',   // 22-24 left twin tail
  'tailR1', 'tailR2', 'tailR3',   // 25-27 right twin tail / side pony
  'lng1', 'lng2', 'lng3',         // 28-30 long hair / braid at the nape
  'fringe', 'ahoge', 'band1', 'band2', // 31-34
  'skirt',                         // 35
];
export const BI = {}; BONE_NAMES.forEach((n, i) => { BI[n] = i; });
export const NB = BONE_NAMES.length;
const PARENT = {
  pelvis: -1, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  clavD: 'chest', uaD: 'clavD', faD: 'uaD', handD: 'faD', clavN: 'chest', uaN: 'clavN', faN: 'uaN', handN: 'faN',
  thighD: 'pelvis', shinD: 'thighD', footD: 'shinD', thighN: 'pelvis', shinN: 'thighN', footN: 'shinN',
  ponyA1: 'head', ponyA2: 'ponyA1', ponyA3: 'ponyA2', tailL1: 'head', tailL2: 'tailL1', tailL3: 'tailL2',
  tailR1: 'head', tailR2: 'tailR1', tailR3: 'tailR2', lng1: 'head', lng2: 'lng1', lng3: 'lng2',
  fringe: 'head', ahoge: 'head', band1: 'head', band2: 'band1', skirt: 'pelvis',
};
export const PAR = BONE_NAMES.map((n) => (PARENT[n] === -1 ? -1 : BI[PARENT[n]]));

// head-local point at height fraction t (0 chin .. 1 crown), lateral fraction fx of half-width, depth fraction fz
export function headAt(D, t, fx = 0, fz = 0) { return [fx * D.headW, D.chinY + t * D.headH, fz * D.headD]; }

// chain segment lengths for secondary bones
export const CHAIN_LEN = { chibi: { pony: 0.15, tail: 0.15, lng: 0.17 }, anime: { pony: 0.17, tail: 0.17, lng: 0.2 } };

export function makeBones(D) {
  const s = D.id;
  const cl = CHAIN_LEN[s];
  const o = {
    pelvis: [0, D.hip0, 0], spine: [0, D.spine, 0], chest: [0, D.chest, 0], neck: [0, D.neckUp, 0], head: [0, D.headUp, 0],
    clavD: [D.clavX, D.clavUp, 0], uaD: [D.uaX, 0, 0], faD: [0, -D.ua, 0], handD: [0, -D.fa, 0],
    clavN: [-D.clavX, D.clavUp, 0], uaN: [-D.uaX, 0, 0], faN: [0, -D.ua, 0], handN: [0, -D.fa, 0],
    thighD: [D.legX, -D.hipOff, 0], shinD: [0, -D.thigh, 0], footD: [0, -D.shin, 0],
    thighN: [-D.legX, -D.hipOff, 0], shinN: [0, -D.thigh, 0], footN: [0, -D.shin, 0],
    ponyA1: headAt(D, 0.80, 0, -0.80), ponyA2: [0, -cl.pony, 0], ponyA3: [0, -cl.pony, 0],
    tailL1: headAt(D, 0.74, -0.94, -0.12), tailL2: [0, -cl.tail, 0], tailL3: [0, -cl.tail, 0],
    tailR1: headAt(D, 0.74, 0.94, -0.12), tailR2: [0, -cl.tail, 0], tailR3: [0, -cl.tail, 0],
    lng1: headAt(D, 0.50, 0, -0.9), lng2: [0, -cl.lng, 0], lng3: [0, -cl.lng, 0],
    fringe: headAt(D, 0.86, 0, 0.62), ahoge: headAt(D, 0.99, 0, 0.1), band1: headAt(D, 0.70, 0, -0.98), band2: [0, -0.06, 0],
    skirt: [0, 0.03, 0],
  };
  return BONE_NAMES.map((n, i) => [n, PAR[i], o[n][0], o[n][1], o[n][2]]);
}

export function restPositions(bones) {
  const R = bones.map(() => new THREE.Vector3());
  bones.forEach((b, i) => { R[i].set(b[2], b[3], b[4]); if (b[1] >= 0) R[i].add(R[b[1]]); });
  return R;
}

// racket (in unscaled racket units; the racket node is scaled by D.racketK)
export const RACKET = { len: 0.685, gripY: 0.10, headCY: 0.42 };
