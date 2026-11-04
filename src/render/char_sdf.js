// Orthographic sphere-tracing of the SDF athlete (char_model.js) at the exact sprite resolution.
// One ray per pixel centre (crisp, never blurred). Per-tile primitive culling + exact per-ray z-intervals keep it cheap.
// Shading: 6-tone hue-shifted ramps per material, warm subsurface terminator on skin, soft specular on hair/shoes,
// sun rim light, ambient-occlusion creases, pose-driven fabric folds, seams between garment parts, selective outline,
// tone-speckle and orphan-pixel clean-up, and a crisp contact shadow under the shoes.
import { MAT, HOOK, PART } from './char_model.js';
import { hex, rgba, R as cR, G as cG, B as cB } from './raster.js';

// sun direction (towards the light) in view space: upper-left, towards the camera
const LV = (() => { const v = [-0.50, 0.66, -0.56]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
const LX = LV[0], LY = LV[1], LZ = LV[2];
// half vector for specular (viewer looks down +z)
const HV = (() => { const v = [LX, LY, LZ - 1]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

// ---------------------------------------------------------------- palette (6 tones + outline per material)
const toRGB = (c) => [cR(c), cG(c), cB(c)];
const pk = (a) => rgba(Math.max(0, Math.min(255, Math.round(a[0]))), Math.max(0, Math.min(255, Math.round(a[1]))), Math.max(0, Math.min(255, Math.round(a[2]))));
const mixc = (a, t, k) => [a[0] + (t[0] - a[0]) * k, a[1] + (t[1] - a[1]) * k, a[2] + (t[2] - a[2]) * k];
const mulc = (c, f) => [c[0] * f[0], c[1] * f[1], c[2] * f[2]];
const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
function ramp6(c, kind) {
  const b = toRGB(c), L = lum(b);
  const warm = [255, 240, 205], cool = [44, 48, 92];
  let t;
  if (kind === 'skin') {
    // shadows go red/orange (subsurface), highlights warm and slightly desaturated
    t = [mulc(b, [0.46, 0.30, 0.32]), mulc(b, [0.66, 0.47, 0.45]), mulc(b, [0.86, 0.72, 0.66]), b, mixc(b, warm, 0.22), mixc(b, [255, 236, 214], 0.45), mulc(b, [0.30, 0.18, 0.20])];
  } else {
    const dark = L < 70; // very dark materials need lifted highlights to show form
    const hi = dark ? mixc(b, [150, 165, 200], 0.42) : mixc(b, warm, 0.44);
    const li = dark ? mixc(b, [120, 130, 165], 0.22) : mixc(b, warm, 0.20);
    t = [mixc(mulc(b, [0.46, 0.34, 0.50]), cool, 0.22), mixc(mulc(b, [0.70, 0.58, 0.70]), cool, 0.10), mulc(b, [0.88, 0.80, 0.86]), b, li, hi, mixc(mulc(b, [0.28, 0.22, 0.34]), [16, 18, 34], 0.35)];
  }
  return t.map(pk);
}
export function makePalette(look) {
  const P = new Array(256).fill(null);
  const skin = hex(look.skin), hair = hex(look.hair), shirt = hex(look.shirt), shorts = hex(look.shorts), shoes = hex(look.shoes || '#f0f0f0');
  const white = hex('#eef0f2');
  const sh = toRGB(shirt), so = toRGB(shorts), sz = toRGB(shoes);
  const trim = look.trim ? hex(look.trim) : (lum(sh) > 170 ? pk(mulc(sh, [0.62, 0.64, 0.74])) : white);
  P[MAT.SKIN] = ramp6(skin, 'skin'); P[MAT.HAIR] = ramp6(hair, 'hair'); P[MAT.SHIRT] = ramp6(shirt); P[MAT.SHORTS] = ramp6(shorts);
  P[MAT.SOCK] = ramp6(white); P[MAT.SHOE] = ramp6(shoes);
  P[MAT.SHOE2] = ramp6(lum(sz) > 150 ? pk(mulc(sz, [0.86, 0.88, 0.94])) : pk(mixc(sz, [255, 255, 255], 0.25)));
  P[MAT.SOLE] = ramp6(lum(sz) > 150 ? hex('#b9c1cf') : hex('#e8eaee'));
  P[MAT.BAND] = ramp6(look.headband ? hex(look.headband) : white);
  P[MAT.FRAME] = ramp6(hex('#2b313d')); P[MAT.GRIP] = ramp6(hex('#3b4559'));
  P[MAT.STRING] = ramp6(hex('#e4eaf0')); P[MAT.EYE] = ramp6(hex('#1d1820'));
  P[MAT.BROW] = ramp6(pk(mixc(toRGB(hair), [30, 20, 15], 0.3)));
  P[MAT.TRIM] = ramp6(trim); P[MAT.LACE] = ramp6(white);
  P[MAT.ACCENT] = ramp6(look.accent ? hex(look.accent) : shirt);
  P[MAT.STRIM] = ramp6(lum(so) > 150 ? pk(mulc(so, [0.6, 0.6, 0.7])) : white);
  P[MAT.CAP] = ramp6(look.cap ? hex(look.cap) : white);
  P[MAT.RACC] = ramp6(hex(look.racket || '#d8432f'));
  return P;
}
const paletteCache = new Map();
export function paletteFor(look) {
  const key = [look.skin, look.hair, look.shirt, look.shorts, look.shoes, look.headband, look.trim, look.racket, look.accent, look.cap].join('|');
  let p = paletteCache.get(key);
  if (!p) { p = makePalette(look); paletteCache.set(key, p); }
  return p;
}

// ---------------------------------------------------------------- primitive packing
const STRIDE = 16;
function packPrims(model) {
  const prims = model.prims, n = prims.length;
  const D = new Float64Array(n * STRIDE);
  const type = new Uint8Array(n), mat = new Uint8Array(n), hook = new Uint8Array(n), part = new Uint8Array(n), kk = new Float64Array(n);
  // 2D bound: for cones a capsule (ax,ay,bx,by,R), for ellipsoids a circle (cx,cy,cx,cy,R) ; z centre for spheres
  const bd = new Float64Array(n * 6);
  const ex = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = prims[i], o = i * STRIDE, b = i * 6;
    type[i] = p.t; mat[i] = p.m; hook[i] = p.hook; kk[i] = p.k; part[i] = p.part || 0; ex[i] = p.ex;
    if (p.t === 0) {
      const a = p.a, q = p.b;
      const bax = q[0] - a[0], bay = q[1] - a[1], baz = q[2] - a[2];
      const l2 = bax * bax + bay * bay + baz * baz;
      const rr = p.ra - p.rb;
      D[o] = a[0]; D[o + 1] = a[1]; D[o + 2] = a[2]; D[o + 3] = bax; D[o + 4] = bay; D[o + 5] = baz;
      D[o + 6] = p.ra; D[o + 7] = p.rb; D[o + 8] = l2; D[o + 9] = l2 - rr * rr; D[o + 10] = 1 / (l2 || 1e-9);
      const L = Math.sqrt(l2) || 1e-9; D[o + 11] = bax / L; D[o + 12] = bay / L; D[o + 13] = baz / L; D[o + 14] = L;
      bd[b] = a[0]; bd[b + 1] = a[1]; bd[b + 2] = q[0]; bd[b + 3] = q[1]; bd[b + 4] = Math.max(p.ra, p.rb) + p.k + 0.004; bd[b + 5] = 0;
    } else {
      const c = p.c;
      D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2];
      // rows pre-divided by radii: local coords scaled to the unit sphere
      D[o + 3] = p.u[0] / p.ru; D[o + 4] = p.u[1] / p.ru; D[o + 5] = p.u[2] / p.ru;
      D[o + 6] = p.v[0] / p.rv; D[o + 7] = p.v[1] / p.rv; D[o + 8] = p.v[2] / p.rv;
      D[o + 9] = p.w[0] / p.rw; D[o + 10] = p.w[1] / p.rw; D[o + 11] = p.w[2] / p.rw;
      D[o + 12] = 1 / p.ru; D[o + 13] = 1 / p.rv; D[o + 14] = 1 / p.rw;
      const r = Math.max(p.ru, p.rv, p.rw) + p.k + 0.004;
      bd[b] = c[0]; bd[b + 1] = c[1]; bd[b + 2] = c[0]; bd[b + 3] = c[1]; bd[b + 4] = r; bd[b + 5] = c[2];
    }
  }
  return { n, D, type, mat, hook, part, kk, bd, ex };
}

function primDist(D, type, i, x, y, z) {
  const o = i * STRIDE;
  if (type[i] === 0) {
    const pax = x - D[o], pay = y - D[o + 1], paz = z - D[o + 2];
    const bax = D[o + 3], bay = D[o + 4], baz = D[o + 5];
    const r1 = D[o + 6], r2 = D[o + 7], l2 = D[o + 8], a2 = D[o + 9], il2 = D[o + 10];
    const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2, rr = r1 - r2;
    const k = (rr < 0 ? -1 : 1) * rr * rr * x2;
    if ((zz < 0 ? -1 : 1) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if ((yy < 0 ? -1 : 1) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  }
  const dx = x - D[o], dy = y - D[o + 1], dz = z - D[o + 2];
  const ax = dx * D[o + 3] + dy * D[o + 4] + dz * D[o + 5];
  const ay = dx * D[o + 6] + dy * D[o + 7] + dz * D[o + 8];
  const az = dx * D[o + 9] + dy * D[o + 10] + dz * D[o + 11];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax * D[o + 12], by = ay * D[o + 13], bz = az * D[o + 14];
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-9;
  return k0 * (k0 - 1) / k1;
}
function sdfSet(M, list, nl, x, y, z) {
  const { D, type, kk } = M;
  let acc = 1e9, rig = 1e9;
  for (let q = 0; q < nl; q++) {
    const i = list[q];
    const d = primDist(D, type, i, x, y, z);
    const k = kk[i];
    if (k > 0) {
      if (acc > 1e8) acc = d;
      else { const h = k - Math.abs(acc - d); acc = (acc < d ? acc : d) - (h > 0 ? h * h * 0.25 / k : 0); }
    } else if (d < rig) rig = d;
  }
  return acc < rig ? acc : rig;
}

// ---------------------------------------------------------------- render (label buffers)
export function marchModel(model, s, look, opts = {}) {
  const M = packPrims(model);
  const { n, bd, D, type } = M;
  const lod = model.lod;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) {
    const b = i * 6, r = bd[b + 4];
    x0 = Math.min(x0, bd[b] - r, bd[b + 2] - r); x1 = Math.max(x1, bd[b] + r, bd[b + 2] + r);
    y0 = Math.min(y0, bd[b + 1] - r, bd[b + 3] - r); y1 = Math.max(y1, bd[b + 1] + r, bd[b + 3] + r);
  }
  const PAD = 4;
  const ox = Math.ceil(-x0 * s) + PAD, oy = Math.ceil(y1 * s) + PAD;
  const W = ox + Math.ceil(x1 * s) + PAD + 1, H = oy + Math.ceil(-y0 * s) + PAD + 1;
  const N = W * H;
  const matB = new Uint8Array(N), tone = new Uint8Array(N), partB = new Uint8Array(N), dep = new Float32Array(N).fill(1e9);
  const shadow = new Uint8Array(N);
  const inv = 1 / s;

  // ---- tile culling (8x8 px)
  const TS = 4, TW = Math.ceil(W / TS), TH = Math.ceil(H / TS);
  const tStart = new Int32Array(TW * TH + 1);
  const tmp = [];
  const halfDiag = (TS * 0.7072) * inv;
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const cx = ((tx + 0.5) * TS - ox) * inv, cy = (oy - (ty + 0.5) * TS) * inv;
    tStart[ty * TW + tx] = tmp.length;
    for (let i = 0; i < n; i++) {
      const b = i * 6;
      const ax = bd[b], ay = bd[b + 1], bx = bd[b + 2], by = bd[b + 3], r = bd[b + 4] + halfDiag;
      const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
      let t = l2 > 1e-12 ? ((cx - ax) * ex + (cy - ay) * ey) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = cx - ax - ex * t, dy = cy - ay - ey * t;
      if (dx * dx + dy * dy <= r * r) tmp.push(i);
    }
  }
  tStart[TW * TH] = tmp.length;
  const tList = Int32Array.from(tmp);

  const cand = new Int32Array(n), act = new Int32Array(n), loc = new Int32Array(n), tin = new Float64Array(n), tout = new Float64Array(n);
  const hd = model.head, tor = model.torso, str = model.strings;
  const sa2 = 1 / (str.a * str.a), sb2 = 1 / (str.b * str.b);
  const eps = 0.0014;
  const isFar = opts.role === 'far';
  const strGrid = lod === 2;

  for (let Y = 0; Y < H; Y++) {
    const yv = (oy - (Y + 0.5)) * inv;
    for (let X = 0; X < W; X++) {
      const xv = (X - ox + 0.5) * inv;
      const tile = ((Y / TS) | 0) * TW + ((X / TS) | 0);
      let nc = 0, tmin = 1e9, tmax = -1e9;
      for (let q = tStart[tile], qe = tStart[tile + 1]; q < qe; q++) {
        const i = tList[q], b = i * 6, r = bd[b + 4];
        let lo, hi;
        if (type[i] === 1) {
          const dx = xv - bd[b], dy = yv - bd[b + 1], d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          const hc = Math.sqrt(r * r - d2); lo = bd[b + 5] - hc; hi = bd[b + 5] + hc;
        } else {
          // ray (xv,yv,t) vs capsule of radius r around the segment: exact quadratic + end slab
          const o = i * STRIDE;
          const ax = D[o], ay = D[o + 1], az = D[o + 2], dx = D[o + 11], dy = D[o + 12], dz = D[o + 13], L = D[o + 14];
          const wx = xv - ax, wy = yv - ay;
          // distance from line: |(p-a) x d|, p = (xv,yv,t)
          // (p-a) x d = (wy*dz - (t-az)*dy, (t-az)*dx - wx*dz, wx*dy - wy*dx)
          const c0x = wy * dz + az * dy, c1x = -dy;       // x comp = c0x + c1x*t
          const c0y = -az * dx - wx * dz, c1y = dx;       // y comp = c0y + c1y*t
          const cz = wx * dy - wy * dx;
          const A2 = c1x * c1x + c1y * c1y;               // = 1 - dz^2
          const B2 = 2 * (c0x * c1x + c0y * c1y);
          const C2 = c0x * c0x + c0y * c0y + cz * cz - r * r;
          if (A2 < 1e-6) { if (C2 > 0) continue; lo = Math.min(az, az + dz * L) - r; hi = Math.max(az, az + dz * L) + r; } else {
            const disc = B2 * B2 - 4 * A2 * C2;
            if (disc < 0) continue;
            const sq = Math.sqrt(disc);
            lo = (-B2 - sq) / (2 * A2); hi = (-B2 + sq) / (2 * A2);
            // slab along the axis: s(t) = wx*dx + wy*dy + (t-az)*dz in [-r, L+r]
            if (Math.abs(dz) > 1e-6) {
              const s0 = wx * dx + wy * dy - az * dz;
              let ta = (-r - s0) / dz, tb = (L + r - s0) / dz; if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
              if (ta > lo) lo = ta; if (tb < hi) hi = tb;
              if (lo > hi) continue;
            } else {
              const s0 = wx * dx + wy * dy;
              if (s0 < -r || s0 > L + r) continue;
            }
          }
        }
        cand[nc] = i; tin[nc] = lo; tout[nc] = hi; nc++;
        if (lo < tmin) tmin = lo; if (hi > tmax) tmax = hi;
      }
      const idx = Y * W + X;
      let hit = false, t = tmin;
      if (nc > 0) {
        for (let it = 0; it < 64; it++) {
          let cap = 1e9, na = 0;
          for (let q = 0; q < nc; q++) {
            if (t < tin[q]) { const g = tin[q] - t; if (g < cap) cap = g; } else if (t <= tout[q]) act[na++] = cand[q];
          }
          let d = na ? sdfSet(M, act, na, xv, yv, t) : 1e9;
          if (d < eps) { hit = true; break; }
          if (cap < d) d = cap + 1e-4;
          if (d > 1e8) break;
          t += d;
          if (t > tmax) break;
        }
      }
      // string bed: analytic plane/ellipse test
      let strHit = false, strT = 1e9, slu = 0, slv = 0;
      {
        const nz = str.n[2];
        if (Math.abs(nz) > 0.04) {
          const ts = str.c[2] + ((str.c[0] - xv) * str.n[0] + (str.c[1] - yv) * str.n[1]) / nz;
          const px = xv - str.c[0], py = yv - str.c[1], pz = ts - str.c[2];
          slu = px * str.u[0] + py * str.u[1] + pz * str.u[2]; slv = px * str.v[0] + py * str.v[1] + pz * str.v[2];
          if (slu * slu * sa2 + slv * slv * sb2 < 1) { strHit = true; strT = ts; }
        }
      }
      if (!hit && !strHit) continue;
      if (strHit && (!hit || strT < t - 0.004)) {
        let on;
        if (strGrid) {
          // mains + crosses aligned with the racket: a lattice of holes every ~2 px of string-bed
          const g = 2.0 / s * 0.92 * Math.max(0.55, Math.abs(str.n[2]));
          const iu = Math.floor(slu / g * 2 + 1000), iv = Math.floor(slv / g * 2 + 1000);
          on = ((iu & 1) === 0) || ((iv & 1) === 0);
        } else on = ((X + Y) & 1) === 0;
        if (on) { matB[idx] = MAT.STRING; tone[idx] = 3 + (str.n[0] * LX + str.n[1] * LY + str.n[2] * LZ < 0 ? 0 : 1) * 0 + ((slu > 0) ? 1 : 0); dep[idx] = strT; partB[idx] = PART.RACKET; continue; }
        if (!hit) { matB[idx] = MAT.HOLE; dep[idx] = strT; continue; }
      }
      // ---- shading
      const px = xv, py = yv, pz = t;
      let nl_ = 0;
      for (let q = 0; q < nc; q++) if (t >= tin[q] - 0.07 && t <= tout[q] + 0.07) loc[nl_++] = cand[q];
      const h = 0.004;
      const e1 = sdfSet(M, loc, nl_, px + h, py - h, pz - h), e2 = sdfSet(M, loc, nl_, px - h, py - h, pz + h);
      const e3 = sdfSet(M, loc, nl_, px - h, py + h, pz - h), e4 = sdfSet(M, loc, nl_, px + h, py + h, pz + h);
      let Nx = e1 - e2 - e3 + e4, Ny = -e1 - e2 + e3 + e4, Nz = -e1 + e2 - e3 + e4;
      const nn = Math.hypot(Nx, Ny, Nz) || 1; Nx /= nn; Ny /= nn; Nz /= nn;
      // nearest primitive decides the material (later = more specific wins ties)
      let best = 1e9, pi = loc[0];
      for (let q = 0; q < nl_; q++) { const i = loc[q]; const d = primDist(D, type, i, px, py, pz); if (d <= best + 0.0005) { if (d < best) best = d; pi = i; } }
      let m = M.mat[pi];
      const hk = M.hook[pi], ex = M.ex[pi];
      let dTone = 0, dl = 0, specK = 0;
      switch (hk) {
        case HOOK.HEAD: {
          const qx = px - hd.c[0], qy = py - hd.c[1], qz = pz - hd.c[2];
          const lu = (qx * hd.u[0] + qy * hd.u[1] + qz * hd.u[2]) / hd.ru;
          const lv = (qx * hd.v[0] + qy * hd.v[1] + qz * hd.v[2]) / hd.rv;
          const lw = (qx * hd.w[0] + qy * hd.w[1] + qz * hd.w[2]) / hd.rw;
          const au = Math.abs(lu);
          if (lw > 0.45 && lod >= 1) {
            if (lv > -0.02 && lv < 0.26 && au > 0.14 && au < 0.64) dTone = -1;               // eye sockets
            if (lod === 2) {
              if (lv > 0.05 && lv < 0.15 && au > 0.26 && au < 0.52) m = MAT.EYE;
              else if (lv >= 0.24 && lv < 0.33 && au > 0.14 && au < 0.6) m = MAT.BROW;
              else if (lv > -0.60 && lv < -0.50 && au < 0.24) dTone = -1;                   // mouth line
            } else if (isFar && lv > 0.04 && lv < 0.17 && au > 0.22 && au < 0.56) dTone = -2;
          }
          specK = 0.97;
          break;
        }
        case HOOK.HAIR: {
          // clumped strands flowing from the crown: break up the highlight into locks
          const qx = px - hd.c[0], qy = py - hd.c[1], qz = pz - hd.c[2];
          const lu = (qx * hd.u[0] + qy * hd.u[1] + qz * hd.u[2]) / hd.ru;
          const lv = (qx * hd.v[0] + qy * hd.v[1] + qz * hd.v[2]) / hd.rv;
          const lw = (qx * hd.w[0] + qy * hd.w[1] + qz * hd.w[2]) / hd.rw;
          if (lod >= 1) dl = 0.20 * Math.sin(Math.atan2(lu, lw) * 7 + lv * 4.5) * Math.min(1, 1.2 - lv * 0.5);
          specK = 0.90;
          break;
        }
        case HOOK.SLEEVE: {
          const tt = ((px - ex.a[0]) * ex.d[0] + (py - ex.a[1]) * ex.d[1] + (pz - ex.a[2]) * ex.d[2]) / ex.L;
          if (tt > 0.86) m = MAT.TRIM; else if (tt > 0.80 && lod === 2) dTone = -1;
          break;
        }
        case HOOK.TORSO: {
          const qx = px - tor.c[0], qy = py - tor.c[1], qz = pz - tor.c[2];
          const nx = px - tor.neck[0], ny = py - tor.neck[1], nz = pz - tor.neck[2];
          const d2 = nx * nx + ny * ny + nz * nz;
          if (d2 < 0.063 * 0.063) m = MAT.SKIN; else if (d2 < 0.071 * 0.071) m = MAT.TRIM; else if (d2 < 0.077 * 0.077) dTone = -1;
          // folds: diagonal twist folds around the waist + soft drape below the chest
          const hgt = qx * tor.u[0] + qy * tor.u[1] + qz * tor.u[2];
          const ang = Math.atan2(qx * tor.f[0] + qy * tor.f[1] + qz * tor.f[2], qx * tor.r[0] + qy * tor.r[1] + qz * tor.r[2]);
          const tw = tor.twist;
          const below = Math.max(0, Math.min(1, (0.26 - hgt) / 0.3));
          const amp = (0.14 + 0.60 * Math.min(1, Math.abs(tw))) * below;
          dl = amp * Math.sin(ang * 3.2 + hgt * 26 * tw + 0.8) + 0.08 * below * Math.sin(hgt * 55 + ang * 1.5);
          break;
        }
        case HOOK.PELVIS: {
          const qx = px - tor.c[0], qy = py - tor.c[1], qz = pz - tor.c[2];
          const hgt = qx * tor.u[0] + qy * tor.u[1] + qz * tor.u[2];
          if (hgt > -0.075) m = MAT.STRIM; // waistband (mostly under the shirt hem)
          break;
        }
        case HOOK.SLEG: {
          const rx = px - ex.a[0], ry = py - ex.a[1], rz = pz - ex.a[2];
          const tt = (rx * ex.d[0] + ry * ex.d[1] + rz * ex.d[2]) / ex.L;
          const ux = rx - ex.d[0] * tt * ex.L, uy = ry - ex.d[1] * tt * ex.L, uz = rz - ex.d[2] * tt * ex.L;
          const ul = Math.hypot(ux, uy, uz) || 1;
          const side = (ux * ex.o[0] + uy * ex.o[1] + uz * ex.o[2]) / ul;
          if (lod >= 1 && side > 0.97) dTone = -1;
          if (tt > 0.92) dTone = -1;
          break;
        }
        case HOOK.SHIN: {
          const along = ((px - ex.a[0]) * ex.d[0] + (py - ex.a[1]) * ex.d[1] + (pz - ex.a[2]) * ex.d[2]) / ex.L;
          if (along > 0.62) { m = MAT.SOCK; if (along < 0.68 && lod >= 1) dTone = -1; if (lod === 2 && along > 0.645 && along < 0.668) m = MAT.ACCENT; }
          break;
        }
        case HOOK.SHOE: {
          const rx = px - ex.a[0], ry = py - ex.a[1], rz = pz - ex.a[2];
          const tt = (rx * ex.d[0] + ry * ex.d[1] + rz * ex.d[2]) / ex.L;
          const up = rx * ex.up[0] + ry * ex.up[1] + rz * ex.up[2];
          const lat = Math.abs(rx * ex.o[0] + ry * ex.o[1] + rz * ex.o[2]);
          if (lod >= 1 && lat > 0.028 && tt > 0.28 && tt < 0.78) {
            const c = -0.006 + 0.05 * (tt - 0.28);
            if (up > c && up < c + 0.016) m = MAT.ACCENT;
          }
          specK = 0.92;
          break;
        }
        case HOOK.GRIP: {
          const rx = px - ex.a[0], ry = py - ex.a[1], rz = pz - ex.a[2];
          const tt = rx * ex.d[0] + ry * ex.d[1] + rz * ex.d[2];
          const ang = Math.atan2(rx * ex.n[0] + ry * ex.n[1] + rz * ex.n[2], rx * ex.s[0] + ry * ex.s[1] + rz * ex.s[2]);
          const f = tt / 0.024 + ang / (Math.PI * 2);
          if (f - Math.floor(f) < 0.22) dTone = -1;
          if (tt > 0.178) m = MAT.RACC;
          break;
        }
        case HOOK.FRAME: {
          if (ex.th < 0) m = MAT.FRAME;
          else { const c = Math.cos(ex.th); if (c > 0.35 || (c < -0.2 && c > -0.55)) m = MAT.RACC; }
          specK = 0.9;
          break;
        }
        default: break;
      }
      // ---- toon tone
      let l = Nx * LX + Ny * LY + Nz * LZ + dl;
      let tn = l > 0.86 ? 5 : l > 0.62 ? 4 : l > 0.28 ? 3 : l > 0.0 ? 2 : l > -0.32 ? 1 : 0;
      if (lod >= 1) {
        const ao = sdfSet(M, loc, nl_, px + Nx * 0.045, py + Ny * 0.045, pz + Nz * 0.045) / 0.045;
        if (ao < 0.62 && tn > 0) tn--;
        if (ao < 0.32 && tn > 0) tn--;
        // sun rim on the silhouette
        if (Nz > -0.28 && (Nx * LX + Ny * LY) > 0.25 && tn < 5) tn = Math.min(5, tn + 1);
      }
      if (specK > 0) { const sp = Nx * HV[0] + Ny * HV[1] + Nz * HV[2]; if (sp > specK) tn = 5; else if (specK < 0.95 && sp > specK - 0.08 && tn < 4) tn = 4; }
      else if (tn === 5 && m !== MAT.SKIN) tn = 4; // cloth: keep the top tone for rims / specular only
      tn += dTone; if (tn < 0) tn = 0;
      matB[idx] = m; tone[idx] = tn; dep[idx] = t; partB[idx] = M.part[pi];
    }
  }

  // ---- contact shadow on the ground under / around the shoes
  if (opts.contactShadow !== false) {
    const shoe = [];
    for (let i = 0; i < n; i++) if (M.part[i] === PART.SHOE) shoe.push(i);
    if (shoe.length) {
      const U = opts.U, F = opts.F; // view basis (char space) -> ground plane solve
      let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
      for (const i of shoe) { const b = i * 6, r = bd[b + 4] + 0.06; sx0 = Math.min(sx0, bd[b] - r, bd[b + 2] - r); sx1 = Math.max(sx1, bd[b] + r, bd[b + 2] + r); sy0 = Math.min(sy0, bd[b + 1] - r, bd[b + 3] - r); sy1 = Math.max(sy1, bd[b + 1] + r, bd[b + 3] + r); }
      const X0 = Math.max(0, Math.floor(sx0 * s + ox)), X1 = Math.min(W - 1, Math.ceil(sx1 * s + ox));
      const Y0 = Math.max(0, Math.floor(oy - sy1 * s)), Y1 = Math.min(H - 1, Math.ceil(oy - sy0 * s));
      const sl = Int32Array.from(shoe);
      for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
        const idx = Y * W + X;
        if (matB[idx] !== MAT.NONE) continue;
        const xv = (X - ox + 0.5) * inv, yv = (oy - (Y + 0.5)) * inv;
        const tg = -U[1] * yv / F[1]; // char y = U.y*yv + F.y*t = 0
        let d = 1e9; for (let q = 0; q < sl.length; q++) { const dd = primDist(D, type, sl[q], xv, yv, tg); if (dd < d) d = dd; }
        if (d < 0.022) shadow[idx] = 2; else if (d < 0.05) shadow[idx] = 1;
      }
    }
  }
  return { W, H, ox, oy, mat: matB, tone, dep, part: partB, shadow, lod };
}

// ---------------------------------------------------------------- clean-up, seams, outlines -> RGBA
export function finish(buf, pal, s, opts = {}) {
  const { W, H, mat, tone, dep, part, shadow, lod } = buf;
  const solid = (i) => mat[i] !== MAT.NONE && mat[i] !== MAT.HOLE;
  const thin = (m) => m === MAT.FRAME || m === MAT.STRING || m === MAT.GRIP || m === MAT.EYE || m === MAT.BAND || m === MAT.RACC || m === MAT.BROW || m === MAT.ACCENT || m === MAT.STRIM;
  // 1) orphans + one-pixel material islands
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!solid(i)) continue;
    const m = mat[i]; if (m === MAT.STRING) continue;
    let same = 0, any = 0;
    const nb0 = i - 1, nb1 = i + 1, nb2 = i - W, nb3 = i + W;
    if (solid(nb0)) any++; if (solid(nb1)) any++; if (solid(nb2)) any++; if (solid(nb3)) any++;
    if (mat[nb0] === m) same++; if (mat[nb1] === m) same++; if (mat[nb2] === m) same++; if (mat[nb3] === m) same++;
    if (any === 0) { mat[i] = MAT.NONE; continue; }
    if (same === 0 && !thin(m)) {
      const c = {}; let bst = 0, bm = m, bt = tone[i];
      for (const j of [nb0, nb1, nb2, nb3]) if (solid(j)) { c[mat[j]] = (c[mat[j]] || 0) + 1; if (c[mat[j]] > bst) { bst = c[mat[j]]; bm = mat[j]; bt = tone[j]; } }
      if (bst >= 3) { mat[i] = bm; tone[i] = bt; }
    }
  }
  // 2) tone speckles: a pixel whose tone differs from all same-material neighbours takes the majority tone
  if (lod >= 1) {
    const t2 = tone.slice(); const hist = new Int32Array(6);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; const m = mat[i]; if (!solid(i) || thin(m) || m === MAT.STRING) continue;
      let cnt = 0, diff = 0; hist.fill(0);
      for (let q = 0; q < 4; q++) { const j = q === 0 ? i - 1 : q === 1 ? i + 1 : q === 2 ? i - W : i + W; if (mat[j] === m) { cnt++; if (tone[j] !== tone[i]) diff++; hist[Math.min(5, tone[j])]++; } }
      if (cnt >= 3 && diff === cnt) { let bt = tone[i], bc = 0; for (let k = 0; k < 6; k++) if (hist[k] > bc) { bc = hist[k]; bt = k; } t2[i] = bt; }
    }
    tone.set(t2);
  }
  // 3) colour + seams + inner depth lines
  const out = new Uint32Array(W * H);
  const innerD = opts.innerDepth == null ? 0.08 : opts.innerDepth;
  const doInner = opts.inner !== false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!solid(i)) continue;
    const m = mat[i];
    const P = pal[m];
    let tn = Math.min(5, tone[i]);
    if (m === MAT.STRING) { out[i] = P[tn >= 4 ? 4 : 3]; continue; }
    // garment seams: same fabric, different garment part, similar depth -> one tone darker on the lower/right pixel
    if (lod === 2 && (m === MAT.SHIRT || m === MAT.SHORTS) && x > 0 && y > 0) {
      const a = i - 1, b = i - W;
      if ((mat[a] === m && part[a] !== part[i] && Math.abs(dep[a] - dep[i]) < 0.04) || (mat[b] === m && part[b] !== part[i] && Math.abs(dep[b] - dep[i]) < 0.04)) tn = Math.max(0, tn - 2);
    }
    let c = P[tn];
    if (doInner && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
      const d = dep[i];
      const lim = d - innerD;
      const nr = (j) => dep[j] < lim && mat[j] !== MAT.STRING && mat[j] !== MAT.NONE && mat[j] !== MAT.HOLE;
      const near = nr(i - 1) || nr(i + 1) || nr(i - W) || nr(i + W);
      if (near) c = (m === MAT.FRAME || m === MAT.GRIP) ? P[6] : P[0];
    }
    out[i] = c;
  }
  // 4) outer selective outline (softer on the lit side) + contact shadow
  const res = out.slice();
  const shA = rgba(18, 22, 40, 120), shB = rgba(18, 22, 40, 64);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (mat[i] !== MAT.NONE) continue;
    let bm = 0, bd = 1e9, bt = 0;
    for (let q = 0; q < 4; q++) { const j = q === 0 ? i - 1 : q === 1 ? i + 1 : q === 2 ? i - W : i + W; if (solid(j) && mat[j] !== MAT.STRING && dep[j] < bd) { bd = dep[j]; bm = mat[j]; bt = tone[j]; } }
    if (bm) { res[i] = bt >= 4 && lod >= 1 && bm !== MAT.FRAME ? pal[bm][1] : pal[bm][6]; continue; }
    if (shadow[i] === 2) res[i] = shA; else if (shadow[i] === 1) res[i] = shB;
  }
  return res;
}
