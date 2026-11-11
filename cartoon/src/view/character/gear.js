// Racket geometry (origin at the grip point, shaft +y, face normal +z). Unskinned, palette-coloured, with the aux attribute.
import * as THREE from 'three';
import { PAL_N, SLOT } from './sculpt.js';
import { RACKET } from './dims.js';

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function xf(px = 0, py = 0, pz = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}

let _racket = null;
export function getRacketGeometry() {
  if (_racket) return _racket;
  const parts = [];
  const add = (geo, m, slot) => { const g = geo.clone(); g.applyMatrix4(m); parts.push([g, slot]); };
  const gy = RACKET.gripY, cy = RACKET.headCY;
  const cap = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);
  // grip + butt cap
  add(cap(0.0195, 0.2, 10), xf(0, 0.01, 0), SLOT.dark);
  add(new THREE.SphereGeometry(1, 10, 8), xf(0, -gy, 0, 0.026, 0.021, 0.026), SLOT.band);
  add(new THREE.CylinderGeometry(0.0225, 0.0225, 0.028, 10), xf(0, 0.056, 0), SLOT.band);
  // throat: two struts meeting the head
  const a = 0.135, b = 0.165;
  for (const s of [-1, 1]) {
    const x0 = s * 0.01, y0 = 0.12, x1 = s * a * 0.62, y1 = cy - b * 0.78;
    const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(x1 - x0, y1 - y0);
    add(cap(0.0145, len - 0.029, 8), xf((x0 + x1) / 2, (y0 + y1) / 2, 0, 1, 1, 1, 0, 0, -ang), SLOT.band);
  }
  const pts = [];
  for (let i = 0; i < 32; i++) { const t = (i / 32) * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(t) * a, cy + Math.cos(t) * b, 0)); }
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 32, 0.0185, 6, true), new THREE.Matrix4(), SLOT.band);
  // merge
  const P = [], N = [], U = [], A = [], I = [];
  let base = 0;
  for (const [g, slot] of parts) {
    const pa = g.attributes.position, na = g.attributes.normal;
    for (let k = 0; k < pa.count; k++) {
      P.push(pa.getX(k), pa.getY(k), pa.getZ(k)); N.push(na.getX(k), na.getY(k), na.getZ(k));
      U.push((slot + 0.5) / PAL_N, 0.5); A.push(0, 0, 1, 0);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) I.push(g.index.getX(k) + base); else for (let k = 0; k < pa.count; k++) I.push(k + base);
    base += pa.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setAttribute('aux', new THREE.Float32BufferAttribute(A, 4));
  geo.setIndex(I);
  // strings
  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const x = sc.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,0.22)'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(255,255,255,0.92)'; x.lineWidth = 2.4;
  for (let i = 4; i < 64; i += 10) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(64, i); x.stroke(); }
  const stex = new THREE.CanvasTexture(sc);
  stex.colorSpace = THREE.SRGBColorSpace; stex.anisotropy = 4;
  const smat = new THREE.MeshBasicMaterial({ map: stex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const sgeo = new THREE.CircleGeometry(1, 28);
  sgeo.scale(a - 0.01, b - 0.01, 1); sgeo.translate(0, cy, 0);
  _racket = { geo, sgeo, smat };
  return _racket;
}
