// Small three.js helpers shared by the view modules: toon materials, merged-geometry builder, procedural people, canvas textures.
import * as THREE from 'three';

export const gfxState = { maxAniso: 4 };

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _ramp = null;
export function toonRamp() {
  if (!_ramp) {
    const d = new Uint8Array([120, 165, 205, 235, 255]);
    _ramp = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat);
    _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter;
    _ramp.generateMipmaps = false;
    _ramp.needsUpdate = true;
  }
  return _ramp;
}

export function toonMat(color, o = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...o });
}

export function canvasTex(w, h, draw, { srgb = true, repeat = false, aniso = true, nearest = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (aniso) t.anisotropy = gfxState.maxAniso;
  if (nearest) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  return t;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Matrix3();
const _c = new THREE.Color();

/** Collects primitives into one vertex-coloured, non-indexed BufferGeometry. */
export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.stack = []; this.cur = new THREE.Matrix4(); }
  push(m) { this.stack.push(this.cur.clone()); this.cur.multiply(m); return this; }
  pop() { this.cur.copy(this.stack.pop()); return this; }
  pushT(x, y, z, ry = 0, s = 1) {
    _q.setFromEuler(_e.set(0, ry, 0)); _v.set(x, y, z); _s.set(s, s, s);
    return this.push(new THREE.Matrix4().compose(_v, _q, _s));
  }
  add(geo, m, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const full = new THREE.Matrix4().multiplyMatrices(this.cur, m);
    _n.getNormalMatrix(full);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    _c.set(color);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(full);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(n, i).applyMatrix3(_n).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r, _c.g, _c.b);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
    }
    if (g !== geo) g.dispose();
    return this;
  }
  _tr(x, y, z, rx, ry, rz, sx, sy, sz) {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')); _v.set(x, y, z); _s.set(sx, sy, sz);
    return _m.compose(_v, _q, _s).clone();
  }
  box(x, y, z, w, h, d, color, o = {}) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    this.add(g, this._tr(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, w, h, d), color); g.dispose(); return this;
  }
  cyl(x, y, z, rTop, rBot, h, color, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg || 10, 1, !!o.open);
    this.add(g, this._tr(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, o.sx || 1, 1, o.sz || 1), color); g.dispose(); return this;
  }
  sph(x, y, z, r, color, o = {}) {
    const g = new THREE.SphereGeometry(r, o.w || 10, o.h || 8);
    this.add(g, this._tr(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, o.sx || 1, o.sy || 1, o.sz || 1), color); g.dispose(); return this;
  }
  /** Quad p0..p3 (arrays), normal from winding p0->p1->p3. Optional uv corners. */
  quad(p0, p1, p2, p3, color, flip = false) {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), c = new THREE.Vector3(...p2), d = new THREE.Vector3(...p3);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    if (flip) n.negate();
    _c.set(color);
    const tri = flip ? [[a, d, c], [a, c, b]] : [[a, b, c], [a, c, d]];
    for (const t of tri) for (const v of t) { _v.copy(v).applyMatrix4(this.cur); this.pos.push(_v.x, _v.y, _v.z); this.col.push(_c.r, _c.g, _c.b); this.uv.push(0, 0);
      _v.copy(n).transformDirection(this.cur); this.nor.push(_v.x, _v.y, _v.z); }
    return this;
  }
  quadF(p0, p1, p2, p3, color, nx, ny, nz) {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), d = new THREE.Vector3(...p3);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    return this.quad(p0, p1, p2, p3, color, n.x * nx + n.y * ny + n.z * nz < 0);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Simple cartoon person built from primitives (local frame: origin at feet/seat-floor, facing +z). */
export function addPerson(b, o = {}) {
  const { x = 0, y = 0, z = 0, yaw = 0, s = 1, pose = 'stand', shirt = '#e44', shorts = '#223', skin = '#e0a97c', hair = '#222', cap = null, tie = null } = o;
  b.pushT(x, y, z, yaw, s);
  const head = (hy, hz = 0, tilt = 0) => {
    b.sph(0, hy, hz, 0.17, skin, { sy: 1.04, w: 10, h: 8 });
    if (cap) { b.sph(0, hy + 0.05, hz - 0.01, 0.18, cap, { sy: 0.7, w: 10, h: 6 }); b.box(0, hy + 0.01, hz + 0.16, 0.2, 0.025, 0.14, cap); }
    else b.sph(0, hy + 0.05, hz - 0.025, 0.175, hair, { sy: 0.78, w: 10, h: 6 });
    b.sph(-0.055, hy - 0.01, hz + 0.145, 0.022, '#222', { w: 5, h: 4 }); b.sph(0.055, hy - 0.01, hz + 0.145, 0.022, '#222', { w: 5, h: 4 });
  };
  if (pose === 'stand') {
    b.cyl(-0.09, 0.4, 0, 0.065, 0.055, 0.8, skin, { seg: 7 }); b.cyl(0.09, 0.4, 0, 0.065, 0.055, 0.8, skin, { seg: 7 });
    b.cyl(-0.09, 0.72, 0, 0.09, 0.085, 0.3, shorts, { seg: 8 }); b.cyl(0.09, 0.72, 0, 0.09, 0.085, 0.3, shorts, { seg: 8 });
    b.box(-0.09, 0.03, 0.04, 0.12, 0.07, 0.24, '#f2f2f2'); b.box(0.09, 0.03, 0.04, 0.12, 0.07, 0.24, '#f2f2f2');
    b.cyl(0, 1.12, 0, 0.19, 0.16, 0.5, shirt, { seg: 10 });
    b.cyl(-0.25, 1.1, 0, 0.05, 0.045, 0.5, skin, { seg: 6, rz: 0.15 }); b.cyl(0.25, 1.1, 0, 0.05, 0.045, 0.5, skin, { seg: 6, rz: -0.15 });
    head(1.55);
  } else if (pose === 'sit') {
    // seated on a chair; thighs forward, shins down
    b.cyl(-0.09, 0.0, 0.2, 0.075, 0.07, 0.4, shorts, { seg: 8, rx: Math.PI / 2 }); b.cyl(0.09, 0.0, 0.2, 0.075, 0.07, 0.4, shorts, { seg: 8, rx: Math.PI / 2 });
    b.cyl(-0.09, -0.24, 0.4, 0.055, 0.05, 0.46, skin, { seg: 6 }); b.cyl(0.09, -0.24, 0.4, 0.055, 0.05, 0.46, skin, { seg: 6 });
    b.box(-0.09, -0.5, 0.45, 0.11, 0.06, 0.22, '#333'); b.box(0.09, -0.5, 0.45, 0.11, 0.06, 0.22, '#333');
    b.cyl(0, 0.3, 0, 0.19, 0.17, 0.5, shirt, { seg: 10 });
    b.cyl(-0.23, 0.28, 0.12, 0.05, 0.045, 0.42, skin, { seg: 6, rx: -1.0 }); b.cyl(0.23, 0.28, 0.12, 0.05, 0.045, 0.42, skin, { seg: 6, rx: -1.0 });
    head(0.73);
  } else if (pose === 'crouch') {
    b.cyl(-0.1, 0.18, 0.1, 0.085, 0.07, 0.36, shorts, { seg: 7, rx: -0.9 }); b.cyl(0.1, 0.18, 0.1, 0.085, 0.07, 0.36, shorts, { seg: 7, rx: -0.9 });
    b.cyl(-0.1, 0.17, 0.3, 0.055, 0.05, 0.34, skin, { seg: 6, rx: 0.5 }); b.cyl(0.1, 0.17, 0.3, 0.055, 0.05, 0.34, skin, { seg: 6, rx: 0.5 });
    b.box(-0.1, 0.03, 0.4, 0.11, 0.06, 0.22, '#eee'); b.box(0.1, 0.03, 0.4, 0.11, 0.06, 0.22, '#eee');
    b.push(new THREE.Matrix4().makeRotationX(0.5).setPosition(0, 0.38, 0.02));
    b.cyl(0, 0.2, 0, 0.19, 0.16, 0.5, shirt, { seg: 10 });
    b.pop();
    b.cyl(-0.22, 0.45, 0.28, 0.05, 0.045, 0.38, skin, { seg: 6, rx: -1.2 }); b.cyl(0.22, 0.45, 0.28, 0.05, 0.045, 0.38, skin, { seg: 6, rx: -1.2 });
    head(0.86, 0.22);
  } else if (pose === 'kneel') { // photographer behind a long lens
    b.cyl(-0.1, 0.12, -0.05, 0.085, 0.07, 0.34, shorts, { seg: 7, rx: Math.PI / 2 }); b.cyl(0.1, 0.12, -0.05, 0.085, 0.07, 0.34, shorts, { seg: 7, rx: Math.PI / 2 });
    b.cyl(-0.1, 0.35, 0.12, 0.085, 0.07, 0.5, shorts, { seg: 7 }); b.cyl(0.1, 0.35, 0.12, 0.085, 0.07, 0.5, shorts, { seg: 7 });
    b.cyl(0, 0.9, 0.1, 0.19, 0.16, 0.5, shirt, { seg: 10 });
    b.cyl(-0.2, 0.95, 0.35, 0.05, 0.045, 0.42, skin, { seg: 6, rx: -1.35 }); b.cyl(0.2, 0.95, 0.35, 0.05, 0.045, 0.42, skin, { seg: 6, rx: -1.35 });
    b.cyl(0, 0.98, 0.7, 0.07, 0.1, 0.55, '#262a30', { seg: 10, rx: Math.PI / 2 }); b.box(0, 0.98, 0.35, 0.16, 0.16, 0.18, '#1a1c20');
    head(1.33, 0.12);
  }
  b.pop();
}

/** Tiny deterministic noise helper for canvas painting. */
export function speckle(g, rnd, x, y, w, h, n, colors, size = 1.5, alpha = 1) {
  g.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rnd() * colors.length) | 0];
    g.fillRect(x + rnd() * w, y + rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
  g.globalAlpha = 1;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
