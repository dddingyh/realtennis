// Character construction: rig definition, merged skinned body geometry, palette texture,
// toon + outline materials, racket, face decal. Everything procedural.
import * as THREE from 'three';

// ---------------------------------------------------------------- rig definition
// [name, parent, restX, restY, restZ]  (rest offset in parent frame; all rest rotations are identity)
// Canonical body frame "B": +z forward, +y up, +x = DOMINANT side (the whole rig is mirrored for right-handers).
export const BONES = [
  ['pelvis', -1, 0, 0.86, 0],
  ['spine', 0, 0, 0.12, 0],
  ['chest', 1, 0, 0.16, 0],
  ['neck', 2, 0, 0.20, 0],
  ['head', 3, 0, 0.07, 0],
  ['clavD', 2, 0.06, 0.19, 0],
  ['uaD', 5, 0.14, 0, 0],
  ['faD', 6, 0, -0.36, 0],
  ['handD', 7, 0, -0.34, 0],
  ['clavN', 2, -0.06, 0.19, 0],
  ['uaN', 9, -0.14, 0, 0],
  ['faN', 10, 0, -0.36, 0],
  ['handN', 11, 0, -0.34, 0],
  ['thighD', 0, 0.10, -0.02, 0],
  ['shinD', 13, 0, -0.38, 0],
  ['footD', 14, 0, -0.38, 0],
  ['thighN', 0, -0.10, -0.02, 0],
  ['shinN', 16, 0, -0.38, 0],
  ['footN', 17, 0, -0.38, 0],
  ['pony1', 4, 0, 0.235, -0.175],
  ['pony2', 19, 0, -0.14, -0.045],
];
export const BI = {}; BONES.forEach((b, i) => { BI[b[0]] = i; });
export const REST = BONES.map(() => new THREE.Vector3());
{ // absolute rest positions (B frame)
  BONES.forEach((b, i) => {
    REST[i].set(b[2], b[3], b[4]);
    if (b[1] >= 0) REST[i].add(REST[b[1]]);
  });
}
export const DIM = { upperArm: 0.36, foreArm: 0.34, thigh: 0.38, shin: 0.38, ankleH: 0.08, palm: 0.07,
  racketLen: 0.685, gripY: 0.10, headCY: 0.42 /* sweet spot above grip point */ };

// ---------------------------------------------------------------- palette
export const SLOT = { skin: 0, hair: 1, shirt: 2, shorts: 3, shoes: 4, accent: 5, white: 6, dark: 7, sole: 8, shirt2: 9, hair2: 10 };
const PAL_N = 16;

export function makePalette() {
  const data = new Uint8Array(PAL_N * 4);
  const tex = new THREE.DataTexture(data, PAL_N, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const _c = new THREE.Color();
function setSlot(tex, slot, hex, mul = 1) {
  _c.set(hex);
  const d = tex.image.data;
  d[slot * 4] = Math.min(255, Math.round(_c.r * 255 * mul));
  d[slot * 4 + 1] = Math.min(255, Math.round(_c.g * 255 * mul));
  d[slot * 4 + 2] = Math.min(255, Math.round(_c.b * 255 * mul));
  d[slot * 4 + 3] = 255;
}
export function fillPalette(tex, look) {
  setSlot(tex, SLOT.skin, look.skin);
  setSlot(tex, SLOT.hair, look.hair);
  setSlot(tex, SLOT.shirt, look.shirt);
  setSlot(tex, SLOT.shorts, look.shorts);
  setSlot(tex, SLOT.shoes, look.shoes);
  setSlot(tex, SLOT.accent, look.accent);
  setSlot(tex, SLOT.white, '#f4f4f0');
  setSlot(tex, SLOT.dark, '#26232e');
  setSlot(tex, SLOT.sole, '#fbfbf6');
  setSlot(tex, SLOT.shirt2, look.block ? look.accent : look.shirt);
  setSlot(tex, SLOT.hair2, look.hair, 0.8);
  tex.needsUpdate = true;
}

// ---------------------------------------------------------------- shared materials
export function makeToon(map) {
  // Colour is quantised in a lighting-independent way: the ratio of received light to albedo picks one of three
  // soft steps (lit = base colour, ~85% and ~70% with a warm/purple shift), so shadows stay colourful on any skin tone.
  const m = new THREE.MeshLambertMaterial({ map });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      `{
         float lumA = max(dot(diffuseColor.rgb, vec3(0.333)), 0.02);
         float r = dot(outgoingLight, vec3(0.333)) / lumA;
         vec3 tint = mix(vec3(0.74, 0.68, 0.82), vec3(0.88, 0.84, 0.92), smoothstep(0.30, 0.46, r));
         tint = mix(tint, vec3(1.0), smoothstep(0.62, 0.84, r));
         float rimD = 1.0 - saturate(dot(normalize(normal), normalize(vViewPosition)));
         outgoingLight = diffuseColor.rgb * tint + vec3(1.0, 0.96, 0.9) * smoothstep(0.62, 0.92, rimD) * 0.10;
       }
       #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'cc-toon-soft-2';
  return m;
}

export function makeOutlineMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <skinning_vertex>',
      `#include <skinning_vertex>
       {
         #ifdef USE_SKINNING
           vec3 on_ = normalize(objectNormal);
         #else
           vec3 on_ = normalize(normal);
         #endif
         float dd = -(modelViewMatrix * vec4(transformed, 1.0)).z;
         transformed += on_ * clamp(dd * 0.0017, 0.004, 0.012);
       }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
      `#include <map_fragment>
       diffuseColor.rgb = diffuseColor.rgb * 0.30 + vec3(0.035, 0.025, 0.08);`);
  };
  m.customProgramCacheKey = () => 'cc-outline-2';
  return m;
}

// ---------------------------------------------------------------- geometry merge helper
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function xf(px = 0, py = 0, pz = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}

class Merge {
  constructor() { this.p = []; this.n = []; this.u = []; this.i = []; this.si = []; this.sw = []; this.count = 0; }
  add(geo, m, slot, bone) {
    const g = geo.clone();
    g.applyMatrix4(m);
    const pa = g.attributes.position, na = g.attributes.normal;
    const uu = (slot + 0.5) / PAL_N;
    for (let k = 0; k < pa.count; k++) {
      this.p.push(pa.getX(k), pa.getY(k), pa.getZ(k));
      this.n.push(na.getX(k), na.getY(k), na.getZ(k));
      this.u.push(uu, 0.5);
      if (bone >= 0) { this.si.push(bone, 0, 0, 0); this.sw.push(1, 0, 0, 0); }
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(g.index.getX(k) + this.count);
    else for (let k = 0; k < pa.count; k++) this.i.push(k + this.count);
    this.count += pa.count;
    g.dispose();
  }
  vert(px, py, pz, nx, ny, nz, slot, b0, b1, w) {
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.u.push((slot + 0.5) / PAL_N, 0.5);
    this.si.push(b0, b1, 0, 0); this.sw.push(1 - w, w, 0, 0);
    return this.count++;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (this.si.length) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    }
    g.setIndex(this.i);
    return g;
  }
}

// primitive prototypes (shared, cloned+transformed per use)
const SPH_LO = new THREE.SphereGeometry(1, 8, 6);
const SPH_MD = new THREE.SphereGeometry(1, 12, 8);
const SPH_HI = new THREE.SphereGeometry(1, 20, 12);
const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
const cap = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 2, Math.min(seg, 7));

export const BUILDS = {
  slim: { w: 0.93, leg: 0.94, arm: 0.92 },
  athletic: { w: 1.0, leg: 1.0, arm: 1.0 },
  sturdy: { w: 1.1, leg: 1.1, arm: 1.12 },
};

// ---------------------------------------------------------------- body
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Continuous skinned tube along +y. rings: [y, rx, rz, slot, dz?]; bf(y) -> [b0, b1, w]. Ends are closed by r = 0 rings.
function tube(M, rings, cx, bf, N = 10) {
  if (rings[0][0] > rings[rings.length - 1][0]) rings = rings.slice().reverse();
  const base = M.count;
  const ys = rings.map((r) => r[0]);
  const rad = rings.map((r) => (r[1] + r[2]) * 0.5);
  for (let i = 0; i < rings.length; i++) {
    const [y, rx, rz, slot, dz = 0] = rings[i];
    // slope from distinct neighbours
    let a = i, c = i;
    while (a > 0 && ys[a] === ys[i]) a--;
    while (c < rings.length - 1 && ys[c] === ys[i]) c++;
    const dy = ys[c] - ys[a];
    const slope = dy > 1e-6 ? (rad[c] - rad[a]) / dy : 0;
    const [b0, b1, w] = bf(y);
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2, co = Math.cos(th), si = Math.sin(th);
      let nx = co, ny = -slope, nz = si;
      if (rx < 1e-4) { nx = 0; nz = 0; ny = i === 0 ? -1 : 1; }
      const l = Math.hypot(nx, ny, nz) || 1;
      M.vert(cx + rx * co, y, dz + rz * si, nx / l, ny / l, nz / l, slot, b0, b1, w);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = base + i * N + j, b = base + i * N + (j + 1) % N, c = base + (i + 1) * N + j, d = base + (i + 1) * N + (j + 1) % N;
      M.i.push(a, c, b, b, c, d);
    }
  }
}
const bfLimb = (b0, b1, yA, yB) => (y) => [b0, b1, 1 - sst(yA, yB, y)]; // y>yB -> b0, y<yA -> b1

export function buildBodyGeometry(look) {
  const M = new Merge();
  const b = BUILDS[look.build] || BUILDS.athletic;
  const part = (bone, geo, local, slot) => {
    const bi = BI[bone];
    const m = new THREE.Matrix4().makeTranslation(REST[bi].x, REST[bi].y, REST[bi].z).multiply(local);
    M.add(geo, m, slot, bi);
  };
  const skirt = !!look.skirt, sleeveless = !!look.sleeveless;
  const SK = SLOT.skin, SH = SLOT.shirt, SH2 = SLOT.shirt2, SO = SLOT.shorts, AC = SLOT.accent, WH = SLOT.white;
  const P = BI.pelvis, SP = BI.spine, CH = BI.chest;

  // torso: one pear/bean shaped tube, weights blend pelvis -> spine -> chest
  const tw = b.w;
  const torso = [
    [0.78, 0, 0, SO], [0.80, 0.10 * tw, 0.08, SO], [0.84, 0.165 * tw, 0.13, SO], [0.90, 0.205 * tw, 0.155, SO, -0.005], [0.97, 0.20 * tw, 0.152, SO, -0.005],
    [0.97, 0.20 * tw, 0.152, SH, -0.005], [1.05, 0.172 * tw, 0.135, SH], [1.14, 0.182 * tw, 0.14, SH], [1.24, 0.196 * tw, 0.145, SH, 0.005], [1.31, 0.17 * tw, 0.125, SH, 0.005],
    [1.355, 0.09 * tw, 0.08, SH], [1.385, 0, 0, SH],
  ];
  tube(M, torso, 0, (y) => {
    if (y < 0.93) return [P, P, 0];
    if (y < 1.02) return [P, SP, sst(0.93, 1.02, y)];
    if (y < 1.04) return [SP, SP, 0];
    if (y < 1.16) return [SP, CH, sst(1.04, 1.16, y)];
    return [CH, CH, 0];
  }, 12);
  if (skirt) {
    const sk = [[0.66, 0, 0, SO], [0.66, 0.255, 0.215, SO], [0.72, 0.235, 0.20, SO], [0.82, 0.19, 0.165, SO], [0.93, 0.165, 0.15, SO], [0.95, 0, 0, SO]];
    tube(M, sk, 0, () => [P, P, 0], 14);
  }
  part('neck', cyl(0.055, 0.06, 0.15, 8), xf(0, 0.03, 0), SK);

  // limbs
  for (const s of ['D', 'N']) {
    const sg = s === 'D' ? 1 : -1;
    const ua = BI['ua' + s], fa = BI['fa' + s], hd = 'hand' + s, cx = sg * 0.20, ar = b.arm;
    const sleeve = sleeveless ? SK : SH2;
    const arm = [
      [1.415, 0, 0, sleeve], [1.40, 0.04, 0.04, sleeve], [1.375, 0.068 * ar, 0.068 * ar, sleeve], [1.33, 0.082 * ar, 0.082 * ar, sleeve],
      [1.25, 0.075 * ar, 0.075 * ar, sleeve], [1.19, 0.068 * ar, 0.068 * ar, sleeve],
    ];
    if (!sleeveless) arm.push([1.19, 0.068 * ar, 0.068 * ar, SK]);
    arm.push([1.12, 0.058 * ar, 0.058 * ar, SK], [1.04, 0.054 * ar, 0.054 * ar, SK], [1.0, 0.053 * ar, 0.053 * ar, SK], [0.97, 0.054 * ar, 0.054 * ar, SK],
      [0.94, 0.053 * ar, 0.053 * ar, SK], [0.90, 0.051 * ar, 0.051 * ar, SK], [0.80, 0.047 * ar, 0.047 * ar, SK], [0.72, 0.046 * ar, 0.046 * ar, SK],
      [0.72, 0.056 * ar, 0.056 * ar, AC], [0.64, 0.056 * ar, 0.056 * ar, AC], [0.64, 0.045 * ar, 0.045 * ar, SK], [0.62, 0, 0, SK]);
    tube(M, arm, cx, bfLimb(ua, fa, 0.90, 1.04), 10);
    // big mitten hand + thumb
    part(hd, SPH_MD, xf(0, -0.075, 0, 0.052, 0.08, 0.064), SK);
    part(hd, SPH_LO, xf(-sg * 0.045, -0.04, 0.035, 0.028, 0.042, 0.03), SK);
  }
  for (const s of ['D', 'N']) {
    const sg = s === 'D' ? 1 : -1;
    const th = BI['thigh' + s], sh = BI['shin' + s], ft = 'foot' + s, cx = sg * 0.10, lg = b.leg;
    const hem = skirt ? 0.80 : 0.68;
    const leg = [
      [0.955, 0, 0, SO], [0.94, 0.085 * lg, 0.085 * lg, SO], [0.88, 0.108 * lg, 0.108 * lg, SO], [hem, 0.112 * lg, 0.112 * lg, SO],
      [hem, 0.088 * lg, 0.088 * lg, SK], [0.60, 0.082 * lg, 0.082 * lg, SK], [0.52, 0.074 * lg, 0.074 * lg, SK], [0.49, 0.071 * lg, 0.071 * lg, SK],
      [0.46, 0.070 * lg, 0.070 * lg, SK], [0.43, 0.069 * lg, 0.069 * lg, SK], [0.40, 0.066 * lg, 0.066 * lg, SK], [0.30, 0.060 * lg, 0.060 * lg, SK],
      [0.22, 0.057 * lg, 0.057 * lg, SK], [0.22, 0.066 * lg, 0.066 * lg, WH], [0.13, 0.060 * lg, 0.060 * lg, WH], [0.09, 0.0, 0.0, WH],
    ];
    tube(M, leg, cx, bfLimb(th, sh, 0.40, 0.52), 10);
    // chunky shoe
    part(ft, SPH_MD, xf(0, -0.005, 0.075, 0.092, 0.078, 0.17), SLOT.shoes);
    part(ft, SPH_LO, xf(0, -0.03, 0.215, 0.082, 0.06, 0.07), SLOT.shoes);
    part(ft, SPH_MD, xf(0, -0.058, 0.09, 0.1, 0.03, 0.205), SLOT.sole);
  }
  buildHead(M, look, part);
  return M.build();
}

function hairCap(part, slot, thetaLen, tilt, k = 1) {
  const g = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, thetaLen);
  const m = xf(0, 0.16, -0.004, 0.168 * k, 0.18 * k, 0.172 * k, tilt, 0, 0);
  part('head', g, m, slot);
  // rounded rim closes the open edge (keeps the outline shell from showing through)
  const rim = new THREE.TorusGeometry(Math.sin(thetaLen), 0.05, 5, 18);
  rim.rotateX(Math.PI / 2); rim.translate(0, Math.cos(thetaLen), 0);
  // part('head', rim, m, slot);
}

function buildHead(M, look, partRaw) {
  const HS = xf(0, 0, 0, 1.17, 1.17, 1.17);
  const part = (bone, geo, local, slot) => partRaw(bone, geo, bone === 'head' ? HS.clone().multiply(local) : local, slot);
  const H = SLOT.hair;
  // skull, ears, nose
  part('head', SPH_HI, xf(0, 0.16, 0, 0.158, 0.172, 0.165), SLOT.skin);
  part('head', SPH_LO, xf(0.157, 0.15, -0.005, 0.03, 0.04, 0.03), SLOT.skin);
  part('head', SPH_LO, xf(-0.157, 0.15, -0.005, 0.03, 0.04, 0.03), SLOT.skin);
  part('head', SPH_LO, xf(0, 0.135, 0.163, 0.022, 0.02, 0.02), SLOT.skin);
  const hw = look.headwear || 'none';
  const style = look.hairStyle || 'short';
  const capOn = hw === 'cap';
  switch (style) {
    case 'buzz': hairCap(part, H, 1.55, -0.5, 0.99); break;
    case 'spiky': {
      hairCap(part, H, 1.6, -0.5, 1.05);
      // five bold swept-back tufts in a clean row
      const tufts = [[-0.1, 0.3, 0.02, 0.5], [-0.05, 0.34, -0.03, 0.2], [0.0, 0.36, -0.08, 0.0], [0.05, 0.34, -0.03, -0.2], [0.1, 0.3, 0.02, -0.5]];
      for (const [x, y, z, rz] of tufts) part('head', new THREE.ConeGeometry(0.052, 0.17, 7), xf(x, y, z, 1, 1, 1, -0.55, 0, rz), H);
      part('head', SPH_MD, xf(0.0, 0.27, 0.1, 0.11, 0.05, 0.06, 0.4, 0, 0), H);
      break;
    }
    case 'ponytail': {
      hairCap(part, H, 1.6, -0.55);
      part('head', SPH_LO, xf(0, 0.215, -0.152, 0.036, 0.036, 0.036), SLOT.accent);
      part('pony1', SPH_MD, xf(0, -0.06, -0.015, 0.05, 0.11, 0.05), H);
      part('pony2', SPH_MD, xf(0, -0.1, -0.01, 0.042, 0.13, 0.04), H);
      break;
    }
    case 'bun': {
      hairCap(part, H, 1.6, -0.55);
      part('head', SPH_MD, xf(0, 0.345, -0.05, 0.075, 0.07, 0.075), H);
      part('head', new THREE.TorusGeometry(0.068, 0.012, 5, 12), xf(0, 0.31, -0.05, 1, 1, 1, Math.PI / 2, 0, 0), SLOT.accent);
      break;
    }
    case 'bob': {
      hairCap(part, H, 1.75, -0.45, 1.01);
      part('head', SPH_MD, xf(0.14, 0.1, -0.02, 0.05, 0.12, 0.12), H);
      part('head', SPH_MD, xf(-0.14, 0.1, -0.02, 0.05, 0.12, 0.12), H);
      part('head', SPH_MD, xf(0, 0.09, -0.1, 0.15, 0.13, 0.075), H);
      break;
    }
    case 'long': {
      hairCap(part, H, 1.75, -0.45, 1.01);
      part('head', SPH_MD, xf(0.14, 0.08, -0.03, 0.05, 0.14, 0.12), H);
      part('head', SPH_MD, xf(-0.14, 0.08, -0.03, 0.05, 0.14, 0.12), H);
      part('head', SPH_MD, xf(0, 0.0, -0.12, 0.14, 0.2, 0.075), H);
      part('pony1', SPH_MD, xf(0, -0.1, 0.02, 0.1, 0.12, 0.05), H);
      break;
    }
    case 'curly': {
      hairCap(part, H, 1.55, -0.5, 1.12);
      const pts = [[0, 0.3, -0.02, 0.12], [0.11, 0.26, -0.03, 0.085], [-0.11, 0.26, -0.03, 0.085], [0.14, 0.18, -0.08, 0.08],
        [-0.14, 0.18, -0.08, 0.08], [0, 0.2, -0.14, 0.1], [0.07, 0.34, 0.03, 0.07], [-0.07, 0.34, 0.03, 0.07]];
      for (const [x, y, z, r] of pts) part('head', SPH_MD, xf(x, y, z, r, r, r), H);
      break;
    }
    case 'mohawk': {
      hairCap(part, H, 1.2, -0.3, 0.995);
      for (let i = 0; i < 6; i++) {
        const z = 0.1 - i * 0.045;
        part('head', new THREE.ConeGeometry(0.04, 0.12 - Math.abs(i - 2) * 0.012, 6), xf(0, 0.33 - i * 0.012, z, 1, 1, 1, -0.2, 0, 0), H);
      }
      break;
    }
    default: // short
      hairCap(part, H, 1.55, -0.5, 1.06);
  }
  if (hw === 'cap') {
    part('head', new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, 1.45), xf(0, 0.162, -0.005, 0.176, 0.19, 0.18, -0.38, 0, 0), SLOT.accent);
    part('head', SPH_MD, xf(0, 0.262, 0.175, 0.125, 0.014, 0.1, 0.1, 0, 0), SLOT.accent);
  } else if (hw === 'visor') {
    part('head', new THREE.TorusGeometry(0.15, 0.024, 6, 24), xf(0, 0.25, -0.005, 1, 1.06, 1.0, Math.PI / 2 + 0.12, 0, 0), SLOT.accent);
    part('head', SPH_MD, xf(0, 0.262, 0.175, 0.125, 0.014, 0.1, 0.1, 0, 0), SLOT.accent);
  } else if (hw === 'headband') {
    part('head', new THREE.TorusGeometry(0.148, 0.026, 6, 24), xf(0, 0.238, -0.004, 1, 1.06, 1.0, Math.PI / 2 + 0.18, 0, 0), SLOT.accent);
  } else if (hw === 'bandana') {
    part('head', new THREE.TorusGeometry(0.15, 0.028, 6, 24), xf(0, 0.242, -0.004, 1, 1.06, 1.0, Math.PI / 2 + 0.22, 0, 0), SLOT.accent);
    part('head', SPH_LO, xf(0.0, 0.225, -0.172, 0.04, 0.05, 0.04), SLOT.accent);
    part('head', SPH_LO, xf(0.03, 0.19, -0.18, 0.02, 0.05, 0.02, 0, 0, 0.4), SLOT.accent);
  }
  void capOn;
}

// geometry cache keyed by the look fields that affect geometry
const _geoCache = new Map();
export function getBodyGeometry(look) {
  const key = [look.build, look.hairStyle, look.headwear, look.skirt ? 1 : 0, look.sleeveless ? 1 : 0].join('|');
  let g = _geoCache.get(key);
  if (!g) { g = buildBodyGeometry(look); g.userData.cacheKey = key; _geoCache.set(key, g); }
  return g;
}

// ---------------------------------------------------------------- racket (origin at the grip point, shaft +y, face normal +z)
let _racket = null;
export function getRacketGeometry() {
  if (_racket) return _racket;
  const M = new Merge();
  const gy = DIM.gripY;
  // handle + butt cap
  M.add(cap(0.0185, 0.2, 8), xf(0, 0.01, 0), SLOT.dark, -1);
  M.add(SPH_LO, xf(0, -gy, 0, 0.024, 0.02, 0.024), SLOT.accent, -1);
  M.add(cyl(0.021, 0.021, 0.03, 8), xf(0, 0.05, 0), SLOT.accent, -1);
  // throat (two struts into the head)
  const a = 0.135, b = 0.165, cy = DIM.headCY;
  for (const s of [-1, 1]) {
    const x0 = s * 0.01, y0 = 0.12, x1 = s * a * 0.62, y1 = cy - b * 0.78;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(x1 - x0, y1 - y0);
    M.add(cap(0.0135, len - 0.027, 6), xf((x0 + x1) / 2, (y0 + y1) / 2, 0, 1, 1, 1, 0, 0, -ang), SLOT.accent, -1);
  }
  // head frame: tube along an ellipse
  const pts = [];
  for (let i = 0; i < 28; i++) { const t = (i / 28) * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(t) * a, cy + Math.cos(t) * b, 0)); }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  M.add(new THREE.TubeGeometry(curve, 28, 0.0175, 5, true), new THREE.Matrix4(), SLOT.accent, -1);
  const geo = M.build();
  // strings
  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const x = sc.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,0.20)'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2.2;
  for (let i = 4; i < 64; i += 10) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(64, i); x.stroke(); }
  const stex = new THREE.CanvasTexture(sc);
  stex.colorSpace = THREE.SRGBColorSpace;
  stex.anisotropy = 4;
  const smat = new THREE.MeshBasicMaterial({ map: stex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const sgeo = new THREE.CircleGeometry(1, 28);
  sgeo.scale(a - 0.01, b - 0.01, 1);
  sgeo.translate(0, cy, 0);
  _racket = { geo, sgeo, smat };
  return _racket;
}

// ---------------------------------------------------------------- face decal
export const FACE = { W: 256, H: 160 };
let _faceGeo = null;
export function faceGeometry() {
  if (_faceGeo) return _faceGeo;
  // cap of an ellipsoid slightly larger than the skull; canvas rows map to theta 1.0..2.35, columns to +-0.85 rad
  const g = new THREE.SphereGeometry(1, 28, 14, Math.PI / 2 - 0.85, 1.7, 1.0, 1.35);
  g.scale(0.158 * 1.17 * 1.012, 0.172 * 1.17 * 1.012, 0.165 * 1.17 * 1.012);
  g.translate(0, 0.16 * 1.17, 0);
  _faceGeo = g;
  return g;
}

export const MOUTHS = ['smile', 'neutral', 'open', 'effort', 'shout', 'frown', 'grin', 'pant'];
export const BROWS = ['neutral', 'angry', 'sad', 'up'];

export class Face {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = FACE.W; this.canvas.height = FACE.H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.sig = -1;
    this.blush = 'rgba(255,110,120,0.30)';
  }
  // blink 0 open..1 closed (quantised to 0,1,2); mouth/brow strings; gaze in [-1,1]
  draw(blink, mouth, brow, gx, gy) {
    const sig = blink * 100000 + MOUTHS.indexOf(mouth) * 1000 + BROWS.indexOf(brow) * 100 + (gx + 1) * 10 + (gy + 1);
    if (sig === this.sig) return;
    this.sig = sig;
    const c = this.ctx, W = FACE.W, H = FACE.H;
    c.clearRect(0, 0, W, H);
    const ink = '#201a2a';
    c.lineCap = 'round'; c.lineJoin = 'round';
    // cheeks
    c.fillStyle = this.blush;
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(W / 2 + s * 82, H * 0.64, 15, 9, 0, 0, 7); c.fill(); }
    // eyes
    const ey = H * 0.47, ex = 56;
    for (const s of [-1, 1]) {
      const cx = W / 2 + s * ex;
      const open = blink === 0 ? 1 : blink === 1 ? 0.3 : 0.0;
      if (open > 0.05) {
        const ry = 33 * open, rx = 24;
        c.fillStyle = '#fff'; c.strokeStyle = ink; c.lineWidth = 5;
        c.beginPath(); c.ellipse(cx, ey, rx, ry, 0, 0, 7); c.fill(); c.stroke();
        c.fillStyle = ink;
        c.beginPath(); c.ellipse(cx + gx * 6, ey + gy * 8 * open, 15, Math.min(21, 21 * open + 2), 0, 0, 7); c.fill();
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(cx + gx * 6 + 6, ey + gy * 8 * open - 8 * open, 5.2, 0, 7); c.arc(cx + gx * 6 - 5, ey + gy * 8 * open + 7 * open, 2.4, 0, 7); c.fill();
      } else {
        c.strokeStyle = ink; c.lineWidth = 6;
        c.beginPath(); c.moveTo(cx - 18, ey + 2); c.quadraticCurveTo(cx, ey + 9, cx + 18, ey + 2); c.stroke();
      }
    }
    // brows
    c.strokeStyle = ink; c.lineWidth = 8;
    for (const s of [-1, 1]) {
      const cx = W / 2 + s * ex, by = H * 0.17;
      let inY = by, outY = by;
      if (brow === 'angry') { inY = by + 11; outY = by - 4; }
      else if (brow === 'sad') { inY = by - 7; outY = by + 8; }
      else if (brow === 'up') { inY = by - 8; outY = by - 8; }
      c.beginPath(); c.moveTo(cx - s * 16, inY); c.quadraticCurveTo(cx + s * 2, Math.min(inY, outY) - 5, cx + s * 22, outY); c.stroke();
    }
    // mouth
    const mx = W / 2, my = H * 0.77;
    c.strokeStyle = ink; c.fillStyle = '#7a2230'; c.lineWidth = 5.5;
    const tooth = '#fff';
    switch (mouth) {
      case 'smile': c.beginPath(); c.moveTo(mx - 20, my - 2); c.quadraticCurveTo(mx, my + 14, mx + 20, my - 2); c.stroke(); break;
      case 'neutral': c.beginPath(); c.moveTo(mx - 14, my + 2); c.lineTo(mx + 14, my + 2); c.stroke(); break;
      case 'frown': c.beginPath(); c.moveTo(mx - 18, my + 8); c.quadraticCurveTo(mx, my - 8, mx + 18, my + 8); c.stroke(); break;
      case 'open': c.beginPath(); c.ellipse(mx, my + 3, 13, 11, 0, 0, 7); c.fill(); c.stroke(); break;
      case 'shout': c.beginPath(); c.ellipse(mx, my + 5, 19, 17, 0, 0, 7); c.fill(); c.stroke();
        c.fillStyle = '#e8606c'; c.beginPath(); c.ellipse(mx, my + 13, 11, 6, 0, 0, 7); c.fill(); break;
      case 'effort': // clenched teeth
        c.beginPath(); c.roundRect(mx - 22, my - 7, 44, 18, 6); c.fillStyle = tooth; c.fill(); c.stroke();
        c.lineWidth = 3; c.beginPath(); c.moveTo(mx - 22, my + 2); c.lineTo(mx + 22, my + 2); c.moveTo(mx, my - 7); c.lineTo(mx, my + 11); c.stroke(); break;
      case 'grin':
        c.beginPath(); c.moveTo(mx - 24, my - 5); c.quadraticCurveTo(mx, my + 2, mx + 24, my - 5); c.quadraticCurveTo(mx + 18, my + 26, mx, my + 26); c.quadraticCurveTo(mx - 18, my + 26, mx - 24, my - 5);
        c.fillStyle = '#7a2230'; c.fill(); c.stroke();
        c.fillStyle = tooth; c.beginPath(); c.moveTo(mx - 20, my - 3); c.quadraticCurveTo(mx, my + 3, mx + 20, my - 3); c.lineTo(mx + 16, my + 6); c.quadraticCurveTo(mx, my + 10, mx - 16, my + 6); c.fill(); break;
      case 'pant': c.beginPath(); c.ellipse(mx, my + 4, 17, 8, 0, 0, 7); c.fill(); c.stroke(); break;
    }
    this.texture.needsUpdate = true;
  }
  dispose() { this.texture.dispose(); this.material.dispose(); }
}
