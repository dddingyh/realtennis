// Instanced cartoon crowd: ~6k seated figures animated entirely in the vertex shader.
import * as THREE from 'three';
import { STANDS, inRoofShade } from './stands.js';
import { mulberry32, GeoBuilder } from './gfx.js';

const NEUTRALS = ['#f4f2ec', '#ffffff', '#e9e4d8', '#d8cdb6', '#c9c9cc', '#9aa0aa', '#2b3552', '#1f2a48', '#3b4a6b', '#6f7686', '#efe7d4', '#14182a'];
const PASTELS = ['#cfe0f2', '#f2d6d6', '#d6ecd9', '#f0e6c8', '#d9d2ee', '#bcd6e8', '#f3dccb'];
const ACCENTS = ['#e84a4a', '#f2c230', '#2f6db4', '#2fa36b', '#f08a3a', '#e86aa8'];
const SKINS = ['#f6d3b8', '#efc4a0', '#e8b88f', '#d9a074', '#c68d5e', '#a8693f', '#8c5a36', '#5a3a22'];
const HAIRS = ['#1b1410', '#2b1c12', '#3b2616', '#6b4423', '#a67c3d', '#d6b25e', '#b8b8b8', '#7a3b1e'];

function figureGeometry() {
  const parts = [];
  const mk = (fn, part) => { const b = new GeoBuilder(); fn(b); const g = b.build(); parts.push([g, part]); };
  mk((b) => b.box(0, 0.35, 0, 0.42, 0.7, 0.25, '#ffffff'), 0);
  mk((b) => b.sph(0, 0.88, 0.01, 0.175, '#ffffff', { w: 6, h: 3 }), 1);
  mk((b) => { for (const s of [-1, 1]) b.cyl(s * 0.26, 0.49, 0, 0.04, 0.035, 0.34, '#ffffff', { seg: 4, open: true }); }, 2);
  let n = 0; for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), part = new Float32Array(n);
  let o = 0;
  for (const [g, p] of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) part[o + i] = p;
    o += g.attributes.position.count;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return geo;
}

const VERT = /* glsl */`
attribute float aPart;
attribute vec3 iPos; attribute float iRot; attribute vec4 iRand; attribute vec3 iShirt; attribute vec3 iSkin; attribute vec3 iHair; attribute float iShade;
uniform float uTime, uOvation, uClap, uWave, uWaveOn; uniform vec3 uSun;
varying vec3 vP; varying float vPart; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying float vL; varying float vShade; varying float vJ; varying float vDist;
void main(){
  vec3 p = position; vP = position; vPart = aPart;
  float side = p.x < 0.0 ? -1.0 : 1.0;
  float t = uTime * (1.0 + iRand.w * 0.5) + iRand.y * 40.0;
  float stand = step(iRand.x, uOvation);
  float d = fract(uWave - iRand.z);
  float wv = uWaveOn * smoothstep(0.0, 0.012, d) * (1.0 - smoothstep(0.035, 0.075, d));
  float up = max(stand, wv);
  float clapOn = step(iRand.y, uClap) * (1.0 - up);
  float hop = stand * (0.5 + 0.5 * sin(t * 7.0)) * 0.07;
  float lift = up * 0.6 + hop + clapOn * 0.015 * sin(t * 12.0);
  if (aPart > 1.5) {
    vec3 pv = vec3(side * 0.26, 0.66, 0.0); vec3 q = p - pv;
    float a = side * up * (2.7 + 0.35 * sin(t * 9.0));
    float ca = cos(a), sa = sin(a);
    q.xy = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
    float ph = clapOn * (1.15 + 0.3 * sin(t * 14.0));
    float cp = cos(-ph), sp = sin(-ph);
    q.yz = vec2(cp * q.y - sp * q.z, sp * q.y + cp * q.z);
    q.x -= side * clapOn * 0.16 * (0.5 + 0.5 * sin(t * 14.0));
    p = pv + q;
  }
  float k = (aPart < 0.5) ? clamp(p.y / 0.7, 0.0, 1.0) : 1.0;
  p.y += lift * k;
  p.x += sin(t * 0.8) * 0.012 * p.y; p.y += sin(t * 1.3) * 0.006;
  float cy = cos(iRot), sy = sin(iRot);
  vec3 w = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z) + iPos;
  vec3 n = vec3(cy * normal.x + sy * normal.z, normal.y, -sy * normal.x + cy * normal.z);
  vL = dot(n, uSun) * 0.5 + 0.5;
  vShirt = iShirt; vSkin = iSkin; vHair = iHair; vShade = iShade; vJ = iRand.w;
  vec4 mv = modelViewMatrix * vec4(w, 1.0); vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
varying vec3 vP; varying float vPart; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying float vL; varying float vShade; varying float vJ; varying float vDist;
void main(){
  vec3 c;
  if (vPart < 0.5) c = vP.y < 0.3 ? vec3(0.07, 0.10, 0.2) * (0.6 + vJ * 0.9) : vShirt;
  else if (vPart < 1.5) c = (vP.y > 0.93 || vP.z < -0.09) ? vHair : vSkin;
  else c = vP.y < 0.4 ? vSkin : vShirt;
  float l = floor(vL * 3.0 + 0.5) / 3.0;
  float lit = mix(0.62, 1.0, l) * mix(0.78, 1.0, vShade);
  vec3 oc = c * lit; float fa = smoothstep(30.0, 80.0, vDist);
  oc = mix(oc, oc * vec3(0.6, 0.68, 0.9), fa);
  gl_FragColor = vec4(oc, 1.0);
  #include <colorspace_fragment>
}`;

export class Crowd {
  constructor(theme, sunDir) {
    this.group = new THREE.Group();
    this.uniforms = { uTime: { value: 0 }, uOvation: { value: 0 }, uClap: { value: 0 }, uWave: { value: 0 }, uWaveOn: { value: 0 }, uSun: { value: new THREE.Vector3().copy(sunDir).normalize() } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    this.base = figureGeometry();
    this.meshes = [];
    this.count = 0;
    this._build(theme, sunDir);
    this.ov = 0; this.ovTarget = 0; this.clap = 0; this.clapT = 0; this.wave = 0; this.waveOn = 0; this.waveT = 0; this.time = 0;
  }

  _build(theme, sun) {
    const rnd = mulberry32(2024);
    const { BX, BZ, treads, seatFrac } = STANDS;
    const sh = new THREE.Color(), sk = new THREE.Color(), hr = new THREE.Color();
    const pick = () => { const r = rnd(); const l = r < 0.15 ? ACCENTS : r < 0.45 ? PASTELS : NEUTRALS; return l[(rnd() * l.length) | 0]; };
    // groups by (tier, side)
    const groups = {};
    const push = (key, rec) => (groups[key] = groups[key] || []).push(rec);
    for (const t of treads) {
      if (!t.seat) continue;
      const oc = t.o0 + (t.o1 - t.o0) * seatFrac;
      const hxo = BX + oc, hzo = BZ + oc;
      const empty = t.tier === 0 ? 0.11 : 0.18 + t.row * 0.01;
      const step = 0.56;
      const place = (side, x, z, par, idx) => {
        if (rnd() < empty || idx % 21 < 2) return;
        const tx = 0, tz = THREE.MathUtils.clamp(z * 0.35, -6, 6);
        const rot = Math.atan2(tx - x, tz - z) + (rnd() - 0.5) * 0.25;
        const shade = inRoofShade(x, t.y + 0.7, z, sun.x, sun.y, sun.z) ? 0 : 1;
        push(t.tier + '_' + side, { x, y: t.y, z, rot, par, shade });
      };
      // +x / -x sides include the corner blocks, +z / -z sides span |x| <= hxo - depth
      const nZ = Math.floor((2 * (BZ + t.o1)) / step);
      for (const sx of [1, -1]) for (let i = 0; i < nZ; i++) { const z = -(BZ + t.o1) + (i + 0.5) * step; place(sx > 0 ? 'px' : 'nx', sx * hxo, z, (z + BZ + t.o1) / (2 * (BZ + t.o1)), i); }
      const inner = BX + t.o0;
      const nX = Math.floor((2 * inner) / step);
      for (const sz of [1, -1]) for (let i = 0; i < nX; i++) { const x = -inner + (i + 0.5) * step; place(sz > 0 ? 'pz' : 'nz', x, sz * hzo, (x + inner) / (2 * inner), i); }
    }
    for (const key of Object.keys(groups)) {
      const arr = groups[key]; const n = arr.length;
      const iPos = new Float32Array(n * 3), iRot = new Float32Array(n), iRand = new Float32Array(n * 4), iShirt = new Float32Array(n * 3), iSkin = new Float32Array(n * 3), iHair = new Float32Array(n * 3), iShade = new Float32Array(n);
      const bb = new THREE.Box3();
      arr.forEach((a, i) => {
        iPos.set([a.x, a.y, a.z], i * 3); iRot[i] = a.rot;
        iRand.set([rnd(), rnd(), a.par, rnd()], i * 4);
        sh.set(pick()); if (theme && rnd() < 0.05) sh.set(theme.accent);
        sh.offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
        iShirt.set([sh.r, sh.g, sh.b], i * 3);
        sk.set(SKINS[(rnd() * rnd() * SKINS.length * 1.1) | 0] || SKINS[3]); iSkin.set([sk.r, sk.g, sk.b], i * 3);
        hr.set(HAIRS[(rnd() * HAIRS.length) | 0]); iHair.set([hr.r, hr.g, hr.b], i * 3);
        iShade[i] = a.shade;
        bb.expandByPoint(new THREE.Vector3(a.x, a.y, a.z));
      });
      const g = this.base.clone();
      g.instanceCount = n;
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
      g.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot, 1));
      g.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
      g.setAttribute('iShirt', new THREE.InstancedBufferAttribute(iShirt, 3));
      g.setAttribute('iSkin', new THREE.InstancedBufferAttribute(iSkin, 3));
      g.setAttribute('iHair', new THREE.InstancedBufferAttribute(iHair, 3));
      g.setAttribute('iShade', new THREE.InstancedBufferAttribute(iShade, 1));
      bb.expandByScalar(2.2);
      g.boundingBox = bb; g.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
      const m = new THREE.Mesh(g, this.mat);
      m.frustumCulled = true; m.name = 'crowd_' + key;
      this.group.add(m); this.meshes.push(m); this.count += n;
    }
  }

  ovation(s = 1) { this.ovTarget = Math.max(this.ovTarget, Math.min(1, s)); this.ovHold = 2.0 + s * 2.5; }
  applause(s = 1, dur = 3) { this.clap = Math.max(this.clap, Math.min(1, s)); this.clapT = Math.max(this.clapT, dur); }
  startWave() { this.waveOn = 1; this.waveT = 9; this.wave = 0; }

  update(dt) {
    this.time += dt;
    const u = this.uniforms;
    u.uTime.value = this.time;
    if (this.ovHold > 0) this.ovHold -= dt; else this.ovTarget = Math.max(0, this.ovTarget - dt * 0.25);
    this.ov += (this.ovTarget - this.ov) * Math.min(1, dt * 3);
    u.uOvation.value = this.ov;
    if (this.clapT > 0) { this.clapT -= dt; } else this.clap = Math.max(0, this.clap - dt * 0.6);
    u.uClap.value = this.clap;
    if (this.waveT > 0) { this.waveT -= dt; this.wave = (this.wave + dt * 0.11) % 1; if (this.waveT <= 0) this.waveOn = 0; }
    u.uWave.value = this.wave; u.uWaveOn.value = this.waveOn;
  }
  dispose() { this.base.dispose(); this.mat.dispose(); for (const m of this.meshes) m.geometry.dispose(); }
}
