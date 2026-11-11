// Geometry toolkit: merged skinned mesh builder, tubes with analytic-ish normals, swept tapered "locks", ellipsoids,
// and the parametric anime head surface shared by the skull, hair cap, face decal and hair locks.
import * as THREE from 'three';

const V = THREE.Vector3;
export const PAL_N = 16;
export const SLOT = {
  skin: 0, hair: 1, shirt: 2, shorts: 3, shoes: 4, accent: 5, white: 6, dark: 7, sole: 8, sleeve: 9, hair2: 10, trim: 11, skin2: 12, hair3: 13, band: 14, mouth: 15,
};

// ---------------------------------------------------------------- merged geometry with palette uv + aux attribute
// aux = (highlight mask, ao/shade, outline width multiplier, soft-lit flag)
export class Merge {
  constructor() { this.ox = 0; this.oy = 0; this.oz = 0; this.p = []; this.n = []; this.u = []; this.a = []; this.si = []; this.sw = []; this.i = []; this.count = 0; }
  // wp: bone index, or [b0,w0,b1,w1,...]
  vert(px, py, pz, nx, ny, nz, slot, hl, ao, ow, soft, wp) {
    this.p.push(px + this.ox, py + this.oy, pz + this.oz); this.n.push(nx, ny, nz);
    this.u.push((slot + 0.5) / PAL_N, 0.5);
    this.a.push(hl || 0, ao || 0, ow == null ? 1 : ow, soft || 0);
    if (typeof wp === 'number') { this.si.push(wp, 0, 0, 0); this.sw.push(1, 0, 0, 0); } else {
      let s = 0; for (let k = 1; k < wp.length; k += 2) s += wp[k];
      const si = [0, 0, 0, 0], sw = [0, 0, 0, 0];
      for (let k = 0, m = 0; k < wp.length && m < 4; k += 2, m++) { si[m] = wp[k]; sw[m] = wp[k + 1] / s; }
      this.si.push(...si); this.sw.push(...sw);
    }
    return this.count++;
  }
  origin(v) { this.ox = v ? v.x : 0; this.oy = v ? v.y : 0; this.oz = v ? v.z : 0; }
  tri(a, b, c) { this.i.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.a, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.i);
    return g;
  }
}

export const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

// weights blending two bones along a coordinate: coordinate c in [cA, cB] -> bone b0 (c<=cA) .. b1 (c>=cB)
export const blend2 = (b0, b1, cA, cB) => (c) => { const w = sst(cA, cB, c); return w <= 0 ? b0 : w >= 1 ? b1 : [b0, 1 - w, b1, w]; };

// ---------------------------------------------------------------- grid helper: positions -> smooth normals -> triangles
const _t1 = new V(), _t2 = new V(), _n = new V();
// pos: array of V for R rows x C cols; wrapC: columns wrap; brk[r] = {prev:bool,next:bool} availability of neighbour rows
export function pushGridPublic(M, pos, R, C, wrapC, attr, outDir, rowFlags, flip) { return pushGrid(M, pos, R, C, wrapC, attr, outDir, rowFlags, flip); }
function pushGrid(M, pos, R, C, wrapC, attr, outDir, rowFlags, flip) {
  const base = M.count;
  const normals = new Array(R * C);
  for (let r = 0; r < R; r++) {
    const f = rowFlags ? rowFlags[r] : null;
    const hasPrev = r > 0 && (!f || f.prev !== false), hasNext = r < R - 1 && (!f || f.next !== false);
    for (let c = 0; c < C; c++) {
      const i = r * C + c;
      const cm = c > 0 ? c - 1 : wrapC ? C - 1 : c, cp = c < C - 1 ? c + 1 : wrapC ? 0 : c;
      _t1.subVectors(pos[r * C + cp], pos[r * C + cm]);
      const ra = hasPrev ? r - 1 : r, rb = hasNext ? r + 1 : r;
      _t2.subVectors(pos[rb * C + c], pos[ra * C + c]);
      _n.crossVectors(_t2, _t1);
      let ok = _n.lengthSq() > 1e-14;
      if (ok) _n.normalize();
      const o = outDir(r, c, pos[i]);
      if (!ok) _n.copy(o); else if (_n.dot(o) < 0) _n.negate();
      normals[i] = _n.clone();
    }
  }
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c, p = pos[i], n = normals[i], a = attr(r, c);
    M.vert(p.x, p.y, p.z, n.x, n.y, n.z, a.slot, a.hl, a.ao, a.ow, a.soft, a.wp);
  }
  // winding: make geometric normal agree with the vertex normal
  const Cc = wrapC ? C : C - 1;
  let sign = 1;
  {
    let found = false;
    for (let r = 0; r < R - 1 && !found; r++) for (let c = 0; c < Cc && !found; c++) {
      const a = pos[r * C + c], b = pos[r * C + (c + 1) % C], d = pos[(r + 1) * C + c];
      _t1.subVectors(d, a); _t2.subVectors(b, a); _n.crossVectors(_t1, _t2);
      if (_n.lengthSq() > 1e-12) { sign = _n.dot(normals[r * C + c]) >= 0 ? 1 : -1; found = true; }
    }
  }
  if (flip) sign = -sign;
  for (let r = 0; r < R - 1; r++) {
    if (rowFlags && rowFlags[r] && rowFlags[r].next === false) continue;
    for (let c = 0; c < Cc; c++) {
      const c2 = (c + 1) % C;
      const a = base + r * C + c, b = base + r * C + c2, d = base + (r + 1) * C + c, e = base + (r + 1) * C + c2;
      if (sign > 0) { M.tri(a, d, b); M.tri(b, d, e); } else { M.tri(a, b, d); M.tri(b, e, d); }
    }
  }
}

// ---------------------------------------------------------------- tubes along +y with elliptical rings
// rings: { y, rx, rz, cx, cz, slot, hl, ao, ow, soft, mod:[amp,k,phase] }; duplicate y values make hard material splits
export function tube(M, rings, o = {}) {
  const N = o.N || 12;
  const arc = o.arc; // [a0, a1] open shell instead of a closed ring
  const NC = arc ? N + 1 : N;
  const R = rings.length;
  const pos = [];
  const rowFlags = [];
  for (let i = 0; i < R; i++) {
    const g = rings[i];
    const cx = g.cx || 0, cz = g.cz || 0;
    for (let j = 0; j < NC; j++) {
      const th = arc ? arc[0] + (arc[1] - arc[0]) * (j / N) : (j / N) * Math.PI * 2 + (o.start || 0);
      let k = 1;
      if (g.mod) k += g.mod[0] * Math.cos(g.mod[1] * th + (g.mod[2] || 0));
      pos.push(new V(cx + g.rx * k * Math.sin(th), g.y, cz + g.rz * k * Math.cos(th)));
    }
    const same = (a, b) => rings[a] && rings[b] && Math.abs(rings[a].y - rings[b].y) < 1e-6;
    rowFlags.push({ prev: i > 0 && !same(i - 1, i), next: i < R - 1 && !same(i, i + 1) });
  }
  const wt = o.wt;
  const attr = (r, c) => {
    const g = rings[r];
    const p = pos[r * NC + c];
    return { slot: g.slot, hl: g.hl, ao: g.ao, ow: g.ow, soft: g.soft, wp: typeof wt === 'function' ? wt(p.y, p.x, p.z, c / N) : wt };
  };
  const outDir = (r, c, p) => {
    const g = rings[r];
    const d = _t1.set(p.x - (g.cx || 0), 0, p.z - (g.cz || 0));
    if (d.lengthSq() < 1e-10) { // pole
      const up = (r > 0 ? rings[r - 1].y : rings[r + 1].y) < g.y;
      return d.set(0, up ? 1 : -1, 0).clone();
    }
    return d.normalize().clone();
  };
  // faces with a split row (same y, different slot): rows are joined only when `next` is true
  pushGrid(M, pos, R, NC, !arc, attr, outDir, rowFlags, o.flip);
}

// ---------------------------------------------------------------- swept lock: tapered ribbon / tube along a Catmull-Rom path
const _cv = [];
export function sweep(M, o) {
  // o: pts[[x,y,z]], w(t), th(t) (half extents), rings, segs, slot, hint(point)->V, wt(t,p)->wp, hl:[t0,t1], ao(t), ow, soft, root:'open'|'point'
  const curve = new THREE.CatmullRomCurve3(o.pts.map((p) => new V(p[0], p[1], p[2])), false, 'centripetal');
  const R = o.rings || 7, C = o.segs || 6;
  const pos = [], tt = [];
  const hint = o.hint || ((p) => _t1.set(p.x, p.y - 0.2, p.z).normalize());
  const T = new V(), S = new V(), U = new V(), H = new V(), P = new V();
  let prevU = null;
  for (let k = 0; k < R; k++) {
    const t = k / (R - 1);
    curve.getPoint(t, P); curve.getTangent(Math.min(t, 0.999), T);
    H.copy(hint(P, t));
    S.crossVectors(T, H);
    if (S.lengthSq() < 1e-8) S.set(1, 0, 0).cross(T);
    S.normalize();
    U.crossVectors(S, T).normalize(); // ~ along the hint (outward)
    if (prevU && U.dot(prevU) < 0) { U.negate(); S.negate(); }
    prevU = prevU || new V(); prevU.copy(U);
    const w = o.w(t), th = o.th ? o.th(t) : w;
    for (let j = 0; j < C; j++) {
      const a = (j / C) * Math.PI * 2;
      pos.push(new V().copy(P).addScaledVector(S, w * Math.cos(a)).addScaledVector(U, th * Math.sin(a)));
    }
    tt.push(t);
  }
  const hl = o.hl, wt = o.wt;
  const attr = (r, c) => {
    const t = tt[r];
    const a = (c / C) * Math.PI * 2;
    let h = 0;
    if (hl && t >= hl[0] && t <= hl[1] && Math.sin(a) > 0.2 && Math.cos(a) > -0.2) h = 1; // outer-facing side stripe
    const p = pos[r * C + c];
    return { slot: o.slot, hl: o.noHl ? 0 : h, ao: o.ao ? o.ao(t, a) : 0, ow: o.ow == null ? 1 : o.ow, soft: o.soft || 0, wp: typeof wt === 'function' ? wt(t, p) : wt };
  };
  const ctr = new Array(R).fill(0).map((_, k) => curve.getPoint(k / (R - 1)));
  const outDir = (r, c, p) => _t1.subVectors(p, ctr[r]).clone().normalize();
  pushGrid(M, pos, R, C, true, attr, (r, c, p) => { const d = _t1.subVectors(p, ctr[r]); if (d.lengthSq() < 1e-12) { curve.getTangent(Math.min(1, r / (R - 1)), _t2); return _t2.clone(); } return d.clone().normalize(); }, null, o.flip);
}

// lock width profile helpers (half width as a fraction of w0)
export const prof = {
  lock: (t) => Math.min(1, 0.6 + t * 3.2) * Math.pow(1 - Math.pow(t, 1.5), 0.9),
  spike: (t) => Math.min(1, 0.7 + t * 2) * (1 - Math.pow(t, 1.15)),
  round: (t) => Math.sqrt(Math.max(0, 1 - Math.pow(t, 3))) * (0.75 + 0.25 * Math.min(1, t * 4)),
  tail: (t) => (0.8 + 0.4 * Math.sin(t * Math.PI * 0.8)) * Math.pow(1 - Math.pow(t, 2.2), 0.7),
  ribbon: (t) => 1 - 0.25 * t,
};

// ---------------------------------------------------------------- ellipsoid (smooth normals)
const _sp = new Map();
function sphereGrid(lat, lon) {
  const key = lat + 'x' + lon;
  if (_sp.has(key)) return _sp.get(key);
  const pts = [];
  for (let i = 0; i <= lat; i++) {
    const a = (i / lat) * Math.PI;
    for (let j = 0; j < lon; j++) { const b = (j / lon) * Math.PI * 2; pts.push([Math.sin(a) * Math.sin(b), Math.cos(a), Math.sin(a) * Math.cos(b)]); }
  }
  _sp.set(key, pts);
  return pts;
}
// o: {lat, lon, slot, wt, hl:(nx,ny,nz)->0/1, ao:(nx,ny,nz)->v, ow, soft, rot:[rx,ry,rz]}
export function ellipsoid(M, c, r, o = {}) {
  const lat = o.lat || 7, lon = o.lon || 10;
  const g = sphereGrid(lat, lon);
  const pos = [];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot || [0, 0, 0])));
  const ns = [];
  for (const p of g) {
    const v = new V(p[0] * r[0], p[1] * r[1], p[2] * r[2]).applyQuaternion(q);
    pos.push(v.add(new V(c[0], c[1], c[2])));
    ns.push(p);
  }
  const wt = o.wt;
  const attr = (rr, cc) => {
    const p = pos[rr * lon + cc], n = ns[rr * lon + cc];
    return { slot: o.slot, hl: o.hl ? o.hl(n[0], n[1], n[2]) : 0, ao: o.ao ? o.ao(n[0], n[1], n[2]) : 0, ow: o.ow, soft: o.soft, wp: typeof wt === 'function' ? wt(p.y, p.x, p.z) : wt };
  };
  pushGrid(M, pos, lat + 1, lon, true, attr, (rr, cc, p) => _t1.set(ns[rr * lon + cc][0] / r[0], ns[rr * lon + cc][1] / r[1], ns[rr * lon + cc][2] / r[2]).applyQuaternion(q).normalize().clone());
}

// ---------------------------------------------------------------- the head surface
function curve1(tab, t) { // Catmull-Rom through [t, v] pairs
  const n = tab.length;
  if (t <= tab[0][0]) return tab[0][1];
  if (t >= tab[n - 1][0]) return tab[n - 1][1];
  let i = 0; while (i < n - 2 && t > tab[i + 1][0]) i++;
  const t0 = tab[i][0], t1 = tab[i + 1][0], v0 = tab[i][1], v1 = tab[i + 1][1];
  const pa = tab[Math.max(0, i - 1)], pb = tab[Math.min(n - 1, i + 2)];
  const m0 = (v1 - pa[1]) / (t1 - pa[0]) * (t1 - t0), m1 = (pb[1] - v0) / (pb[0] - t0) * (t1 - t0);
  const u = (t - t0) / (t1 - t0), u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1;
}
const HEAD_TAB = {
  chibi: {
    wx: [[0, 0], [0.02, 0.17], [0.06, 0.35], [0.12, 0.54], [0.2, 0.72], [0.3, 0.88], [0.42, 0.975], [0.52, 1], [0.64, 0.995], [0.76, 0.95], [0.86, 0.84], [0.94, 0.62], [0.985, 0.32], [1, 0]],
    wz: [[0, 0], [0.02, 0.12], [0.06, 0.3], [0.12, 0.5], [0.2, 0.7], [0.3, 0.88], [0.42, 0.98], [0.52, 1], [0.64, 1], [0.76, 0.96], [0.86, 0.86], [0.94, 0.66], [0.985, 0.35], [1, 0]],
    cz: [[0, 0.5], [0.06, 0.45], [0.12, 0.35], [0.2, 0.25], [0.3, 0.12], [0.42, 0.02], [0.52, 0], [0.64, -0.02], [0.76, -0.04], [0.86, -0.06], [0.94, -0.07], [1, -0.07]],
  },
  anime: {
    wx: [[0, 0], [0.02, 0.14], [0.06, 0.28], [0.12, 0.42], [0.2, 0.6], [0.3, 0.78], [0.42, 0.93], [0.54, 1], [0.66, 0.995], [0.77, 0.95], [0.87, 0.84], [0.94, 0.62], [0.985, 0.32], [1, 0]],
    wz: [[0, 0], [0.02, 0.1], [0.06, 0.26], [0.12, 0.44], [0.2, 0.64], [0.3, 0.84], [0.42, 0.96], [0.54, 1], [0.66, 1], [0.77, 0.96], [0.87, 0.86], [0.94, 0.66], [0.985, 0.35], [1, 0]],
    cz: [[0, 0.55], [0.06, 0.5], [0.12, 0.4], [0.2, 0.3], [0.3, 0.16], [0.42, 0.04], [0.54, 0], [0.66, -0.02], [0.77, -0.04], [0.87, -0.06], [0.94, -0.07], [1, -0.07]],
  },
};
export const HEAD_T = [0, 0.02, 0.06, 0.12, 0.2, 0.3, 0.42, 0.52, 0.64, 0.76, 0.86, 0.94, 0.985, 1];

const _hn = new V(), _ha = new V(), _hb = new V(), _hc = new V(), _hd = new V(), _he = new V();
export function makeHead(D) {
  const tab = HEAD_TAB[D.id];
  const W = D.headW, Dp = D.headD, H = D.headH, Y0 = D.chinY;
  const H_ = {
    W, D: Dp, H, Y0,
    rx: (t) => W * Math.max(0, curve1(tab.wx, t)),
    rz: (t) => Dp * Math.max(0, curve1(tab.wz, t)),
    cz: (t) => Dp * curve1(tab.cz, t),
    y: (t) => Y0 + t * H,
    // surface point at height fraction t, azimuth th (0 = front, + = +x), pushed outward by off
    surf(t, th, off, out) {
      out = out || new V();
      out.set(this.rx(t) * Math.sin(th), this.y(t), this.cz(t) + this.rz(t) * Math.cos(th));
      if (off) { this.normal(t, th, _hn); out.addScaledVector(_hn, off); }
      return out;
    },
    normal(t, th, out) {
      const t0 = clamp(t - 0.02, 0, 1), t1 = clamp(t + 0.02, 0, 1), e = 0.04;
      const a = _ha.set(this.rx(t1) * Math.sin(th), this.y(t1), this.cz(t1) + this.rz(t1) * Math.cos(th))
        .sub(_hb.set(this.rx(t0) * Math.sin(th), this.y(t0), this.cz(t0) + this.rz(t0) * Math.cos(th)));
      const tt = clamp(t, 0.01, 0.99);
      const b = _hc.set(this.rx(tt) * Math.sin(th + e), 0, this.rz(tt) * Math.cos(th + e))
        .sub(_hd.set(this.rx(tt) * Math.sin(th - e), 0, this.rz(tt) * Math.cos(th - e)));
      out.crossVectors(b, a); // (tangent around) x (tangent up) = outward for th increasing toward +x
      if (out.lengthSq() < 1e-14) out.set(Math.sin(th), 0, Math.cos(th));
      out.normalize();
      const rad = _he.set(Math.sin(th), 0, Math.cos(th));
      if (out.dot(rad) < 0) out.negate();
      return out;
    },
    // build the skull tube rings
    rings(slot, o = {}) {
      return HEAD_T.map((t, i) => ({ y: this.y(t), rx: this.rx(t), rz: this.rz(t), cz: this.cz(t), slot, soft: 1, ow: o.ow == null ? 0.55 : o.ow }));
    },
  };
  return H_;
}
