// Orthographic sphere-tracing of the SDF body model at exact sprite resolution, with a toon ramp, ambient-occlusion
// creasing, selective outlines and palette-snapped materials. One ray per pixel centre: crisp pixels, no blur.
import { MAT, HOOK } from './char_model.js';
import { hex, rgba, R as cR, G as cG, B as cB } from './raster.js';

// light direction (towards the light) in view space: upper-left, towards the camera
const LL = (() => { const v = [-0.50, 0.64, -0.58]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
const LX = LL[0], LY = LL[1], LZ = LL[2];

// ---------------------------------------------------------------- palette
const mulc = (c, f) => [c[0] * f[0], c[1] * f[1], c[2] * f[2]];
const toRGB = (c) => [cR(c), cG(c), cB(c)];
const pack = (a) => rgba(Math.max(0, Math.min(255, a[0])), Math.max(0, Math.min(255, a[1])), Math.max(0, Math.min(255, a[2])));
function rampOf(c, kind) {
  const b = toRGB(c);
  const lightT = kind === 'skin' ? [255, 226, 190] : [255, 246, 222];
  const mixc = (a, t, k) => [a[0] + (t[0] - a[0]) * k, a[1] + (t[1] - a[1]) * k, a[2] + (t[2] - a[2]) * k];
  const sh = kind === 'skin' ? [[0.50, 0.38, 0.50], [0.76, 0.66, 0.74], [0.38, 0.27, 0.34]] : [[0.50, 0.50, 0.70], [0.76, 0.77, 0.90], [0.30, 0.31, 0.46]];
  return [pack(mulc(b, sh[0])), pack(mulc(b, sh[1])), c, pack(mixc(b, lightT, kind === 'skin' ? 0.30 : 0.34)), pack(mulc(b, sh[2]))];
}
export function makePalette(look) {
  const P = new Array(256).fill(null);
  const skin = hex(look.skin), hair = hex(look.hair), shirt = hex(look.shirt), shorts = hex(look.shorts), shoes = hex(look.shoes || '#f0f0f0');
  const white = hex('#eef0f2');
  const trim = look.trim ? hex(look.trim) : (() => { const s = toRGB(shirt); const lum = (s[0] * 0.3 + s[1] * 0.59 + s[2] * 0.11); return lum > 170 ? pack(mulc(s, [0.72, 0.74, 0.82])) : white; })();
  P[MAT.SKIN] = rampOf(skin, 'skin'); P[MAT.HAIR] = rampOf(hair, 'hair'); P[MAT.SHIRT] = rampOf(shirt, 'cloth'); P[MAT.SHORTS] = rampOf(shorts, 'cloth');
  P[MAT.SOCK] = rampOf(white, 'cloth'); P[MAT.SHOE] = rampOf(shoes, 'cloth');
  const sh = toRGB(shoes); const slum = sh[0] * 0.3 + sh[1] * 0.59 + sh[2] * 0.11;
  P[MAT.SOLE] = rampOf(slum > 150 ? hex('#aab3c2') : hex('#e8eaee'), 'cloth');
  P[MAT.BAND] = rampOf(look.headband ? hex(look.headband) : white, 'cloth');
  P[MAT.FRAME] = rampOf(hex('#2a303c'), 'hair'); P[MAT.GRIP] = rampOf(hex('#394357'), 'cloth');
  P[MAT.STRING] = rampOf(hex('#dfe6ee'), 'cloth'); P[MAT.EYE] = rampOf(hex('#1b1620'), 'hair');
  P[MAT.TRIM] = rampOf(trim, 'cloth'); P[MAT.LACE] = rampOf(white, 'cloth');
  // frame accent
  P.accent = hex(look.racket || '#e0463a');
  return P;
}
const paletteCache = new Map();
export function paletteFor(look) {
  const key = [look.skin, look.hair, look.shirt, look.shorts, look.shoes, look.headband, look.trim, look.racket].join('|');
  let p = paletteCache.get(key);
  if (!p) { p = makePalette(look); paletteCache.set(key, p); }
  return p;
}

// ---------------------------------------------------------------- SDF evaluation
// primitive records are packed into flat typed arrays (view space)
function pack_(model, s) {
  const prims = model.prims, n = prims.length;
  const D = new Float64Array(n * 22);
  const type = new Uint8Array(n), mat = new Uint8Array(n), hook = new Uint8Array(n), kk = new Float64Array(n);
  const bc = new Float64Array(n * 4); // bounding sphere cx,cy,cz,r
  for (let i = 0; i < n; i++) {
    const p = prims[i], o = i * 22;
    type[i] = p.t; mat[i] = p.m; hook[i] = p.hook; kk[i] = p.k;
    if (p.t === 0) {
      const a = p.a, b = p.b;
      const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
      const l2 = bax * bax + bay * bay + baz * baz;
      D[o] = a[0]; D[o + 1] = a[1]; D[o + 2] = a[2]; D[o + 3] = bax; D[o + 4] = bay; D[o + 5] = baz;
      D[o + 6] = p.ra; D[o + 7] = p.rb; D[o + 8] = l2;
      const rr = p.ra - p.rb; D[o + 9] = l2 - rr * rr; D[o + 10] = 1 / (l2 || 1e-9);
      const r = Math.sqrt(l2) * 0.5 + Math.max(p.ra, p.rb);
      bc[i * 4] = (a[0] + b[0]) / 2; bc[i * 4 + 1] = (a[1] + b[1]) / 2; bc[i * 4 + 2] = (a[2] + b[2]) / 2; bc[i * 4 + 3] = r + p.k + 0.01;
    } else {
      const c = p.c;
      D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2];
      D[o + 3] = p.u[0]; D[o + 4] = p.u[1]; D[o + 5] = p.u[2];
      D[o + 6] = p.v[0]; D[o + 7] = p.v[1]; D[o + 8] = p.v[2];
      D[o + 9] = p.w[0]; D[o + 10] = p.w[1]; D[o + 11] = p.w[2];
      D[o + 12] = p.ru; D[o + 13] = p.rv; D[o + 14] = p.rw;
      bc[i * 4] = c[0]; bc[i * 4 + 1] = c[1]; bc[i * 4 + 2] = c[2]; bc[i * 4 + 3] = Math.max(p.ru, p.rv, p.rw) + p.k + 0.01;
    }
  }
  return { n, D, type, mat, hook, kk, bc };
}

function sdfSet(M, cand, nc, x, y, z) {
  const { D, type, kk } = M;
  let acc = 1e9, rig = 1e9;
  for (let q = 0; q < nc; q++) {
    const i = cand[q], o = i * 22;
    let d;
    if (type[i] === 0) {
      const pax = x - D[o], pay = y - D[o + 1], paz = z - D[o + 2];
      const bax = D[o + 3], bay = D[o + 4], baz = D[o + 5];
      const r1 = D[o + 6], r2 = D[o + 7], l2 = D[o + 8], a2 = D[o + 9], il2 = D[o + 10];
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2, z2 = zz * zz * l2;
      const rr = r1 - r2;
      const k = (rr < 0 ? -1 : 1) * rr * rr * x2;
      if ((zz < 0 ? -1 : 1) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - r2;
      else if ((yy < 0 ? -1 : 1) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - r1;
      else d = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    } else {
      const dx = x - D[o], dy = y - D[o + 1], dz = z - D[o + 2];
      const px = dx * D[o + 3] + dy * D[o + 4] + dz * D[o + 5];
      const py = dx * D[o + 6] + dy * D[o + 7] + dz * D[o + 8];
      const pz = dx * D[o + 9] + dy * D[o + 10] + dz * D[o + 11];
      const ru = D[o + 12], rv = D[o + 13], rw = D[o + 14];
      const ax = px / ru, ay = py / rv, az = pz / rw;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const bx = ax / ru, by = ay / rv, bz = az / rw;
      const k1 = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-9;
      d = k0 * (k0 - 1) / k1;
    }
    const k = kk[i];
    if (k > 0) {
      if (acc > 1e8) acc = d;
      else { const h = Math.max(k - Math.abs(acc - d), 0) / k; acc = (acc < d ? acc : d) - h * h * k * 0.25; }
    } else if (d < rig) rig = d;
  }
  return acc < rig ? acc : rig;
}
function nearestPrim(M, cand, nc, x, y, z) {
  // material = prim with the smallest signed distance (ties keep the later = more specific one)
  let best = 1e9, bi = -1;
  const saveK = M.kk;
  for (let q = 0; q < nc; q++) {
    const i = cand[q];
    const d = primDist(M, i, x, y, z);
    if (d <= best + 0.0004) { if (d < best) best = d; bi = i; }
  }
  return bi;
}
function primDist(M, i, x, y, z) {
  const { D, type } = M; const o = i * 22;
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
  const px = dx * D[o + 3] + dy * D[o + 4] + dz * D[o + 5], py = dx * D[o + 6] + dy * D[o + 7] + dz * D[o + 8], pz = dx * D[o + 9] + dy * D[o + 10] + dz * D[o + 11];
  const ru = D[o + 12], rv = D[o + 13], rw = D[o + 14];
  const ax = px / ru, ay = py / rv, az = pz / rw;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const k1 = Math.sqrt((ax / ru) ** 2 + (ay / rv) ** 2 + (az / rw) ** 2) || 1e-9;
  return k0 * (k0 - 1) / k1;
}

// ---------------------------------------------------------------- render
// Returns { w, h, ox, oy, mat, tone, dep } label buffers (before outlines) plus the palette
export function marchModel(model, s, look, opts = {}) {
  const M = pack_(model, s);
  const { n, bc } = M;
  // bounds in pixels
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) {
    const r = bc[i * 4 + 3] - 0.01;
    x0 = Math.min(x0, bc[i * 4] - r); x1 = Math.max(x1, bc[i * 4] + r);
    y0 = Math.min(y0, bc[i * 4 + 1] - r); y1 = Math.max(y1, bc[i * 4 + 1] + r);
  }
  const PAD = 3;
  const ox = Math.ceil(-x0 * s) + PAD, oy = Math.ceil(y1 * s) + PAD; // origin (feet at view (0,0)) in pixel coords
  const W = ox + Math.ceil(x1 * s) + PAD + 1, H = oy + Math.ceil(-y0 * s) + PAD + 1;
  const matB = new Uint8Array(W * H), tone = new Uint8Array(W * H), dep = new Float32Array(W * H).fill(1e9);
  const cand = new Int32Array(n), act = new Int32Array(n), loc = new Int32Array(n), tin = new Float64Array(n), tout = new Float64Array(n);
  const hd = model.head;
  const head = hd;
  const band = !!look.headband;
  const showEyes = !opts.noEyes;
  const sleeveP = []; // cache for sleeve axis
  const inv = 1 / s;
  const bcx = bc;
  const str = model.strings;
  const sa2 = str ? 1 / (str.a * str.a) : 0, sb2 = str ? 1 / (str.b * str.b) : 0;
  const isNear = opts.role === 'near';
  const nb = model.neck.c;
  const eps = 0.0016;
  const t0min = new Float64Array(1);

  for (let Y = 0; Y < H; Y++) {
    const yv = (oy - (Y + 0.5)) * inv;
    for (let X = 0; X < W; X++) {
      const xv = (X - ox + 0.5) * inv;
      // candidate prims whose bounding circle covers this pixel centre, with their z-interval along the ray
      let nc = 0, tmin = 1e9, tmax = -1e9;
      for (let i = 0; i < n; i++) {
        const dx = xv - bcx[i * 4], dy = yv - bcx[i * 4 + 1], r = bcx[i * 4 + 3];
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r) {
          const hc = Math.sqrt(r * r - d2), zc = bcx[i * 4 + 2];
          cand[nc] = i; tin[nc] = zc - hc; tout[nc] = zc + hc; nc++;
          if (zc - hc < tmin) tmin = zc - hc; if (zc + hc > tmax) tmax = zc + hc;
        }
      }
      const idx = Y * W + X;
      let hit = false, t = tmin;
      if (nc > 0) {
        for (let it = 0; it < 48; it++) {
          // evaluate only primitives whose interval contains t; cap the step by the nearest one still ahead
          let cap = 1e9, na = 0;
          for (let q = 0; q < nc; q++) {
            if (t < tin[q]) { const g = tin[q] - t; if (g < cap) cap = g; }
            else if (t <= tout[q]) act[na++] = cand[q];
          }
          let d = na ? sdfSet(M, act, na, xv, yv, t) : 1e9;
          if (d < eps) { hit = true; break; }
          if (cap < d) d = cap + 1e-4;
          if (d > 1e8) break;
          t += d;
          if (t > tmax) break;
        }
      }
      // racket strings: analytic disc test, in front of (or without) a body hit
      let strHit = false, strT = 1e9;
      if (str) {
        const nz = str.n[2];
        if (Math.abs(nz) > 0.05) {
          // plane through str.c with normal str.n; ray (xv,yv,t)
          const ts = str.c[2] + ((str.c[0] - xv) * str.n[0] + (str.c[1] - yv) * str.n[1]) / nz;
          const px = xv - str.c[0], py = yv - str.c[1], pz = ts - str.c[2];
          const lu = px * str.u[0] + py * str.u[1] + pz * str.u[2], lv = px * str.v[0] + py * str.v[1] + pz * str.v[2];
          if (lu * lu * sa2 + lv * lv * sb2 < 1) { strHit = true; strT = ts; }
        }
      }
      if (!hit && !strHit) continue;
      if (strHit && (!hit || strT < t - 0.004)) {
        // checkerboard string pixel (grid look); the other half lets the body behind show through unless nothing is there
        if (((X + Y) & 1) === 0) { matB[idx] = MAT.STRING; tone[idx] = 3; dep[idx] = strT; continue; }
        if (!hit) { matB[idx] = MAT.HOLE; dep[idx] = strT; continue; }
      }
      // ---- shading of the body hit
      const px = xv, py = yv, pz = t;
      let nl_ = 0;
      for (let q = 0; q < nc; q++) if (t >= tin[q] - 0.08 && t <= tout[q] + 0.08) loc[nl_++] = cand[q];
      const h = 0.005;
      const e1 = sdfSet(M, loc, nl_, px + h, py - h, pz - h), e2 = sdfSet(M, loc, nl_, px - h, py - h, pz + h);
      const e3 = sdfSet(M, loc, nl_, px - h, py + h, pz - h), e4 = sdfSet(M, loc, nl_, px + h, py + h, pz + h);
      const nx = e1 - e2 - e3 + e4, ny = -e1 - e2 + e3 + e4, nz2 = -e1 + e2 - e3 + e4;
      const nl = Math.hypot(nx, ny, nz2) || 1;
      const Nx = nx / nl, Ny = ny / nl, Nz = nz2 / nl;
      const pi = nearestPrim(M, loc, nl_, px, py, pz);
      let m = M.mat[pi];
      const hk = M.hook[pi];
      // paint hooks (materials that follow surface coordinates rather than geometry)
      if (hk === HOOK.HEAD) {
        const qx = px - head.c[0], qy = py - head.c[1], qz = pz - head.c[2];
        const lv = (qx * head.v[0] + qy * head.v[1] + qz * head.v[2]) / head.rv;
        const lw = (qx * head.w[0] + qy * head.w[1] + qz * head.w[2]) / head.rw;
        const lu = (qx * head.u[0] + qy * head.u[1] + qz * head.u[2]) / head.ru;
        if (band && lv > 0.30 && lv < 0.54 && (m === MAT.SKIN || m === MAT.HAIR)) m = MAT.BAND;
        else if (showEyes && m === MAT.SKIN && lw > 0.5 && lv > -0.02 && lv < 0.16 && Math.abs(lu) > 0.26 && Math.abs(lu) < 0.58) m = MAT.EYE;
      } else if (hk === HOOK.SLEEVE) {
        const o = pi * 22;
        const bax = M.D[o + 3], bay = M.D[o + 4], baz = M.D[o + 5];
        const tt = ((px - M.D[o]) * bax + (py - M.D[o + 1]) * bay + (pz - M.D[o + 2]) * baz) * M.D[o + 10];
        if (tt > 0.80) m = MAT.TRIM;
      } else if (hk === HOOK.SHIN) {
        // sock covers the lower ~40% of the shin; find the param along knee->ankle with the other hooked prim
        const o = pi * 22;
        const bax = M.D[o + 3], bay = M.D[o + 4], baz = M.D[o + 5];
        const tt = ((px - M.D[o]) * bax + (py - M.D[o + 1]) * bay + (pz - M.D[o + 2]) * baz) * M.D[o + 10];
        const second = M.D[o + 6] === 0.059; // second segment (c30 -> ankle)
        const along = second ? 0.30 + 0.70 * tt : 0.30 * tt;
        if (along > 0.58) m = MAT.SOCK;
        else if (along > 0.53) m = MAT.TRIM;
      } else if (hk === HOOK.SHORTS) {
        // hem trim on the flared leg of the shorts
        const o = pi * 22;
        if (M.type[pi] === 0) {
          const bax = M.D[o + 3], bay = M.D[o + 4], baz = M.D[o + 5];
          const tt = ((px - M.D[o]) * bax + (py - M.D[o + 1]) * bay + (pz - M.D[o + 2]) * baz) * M.D[o + 10];
          if (tt > 0.93) m = MAT.TRIM;
        }
      } else if (hk === HOOK.SHIRT) {
        // crew collar
        const dx = px - nb[0], dy = py - nb[1], dz = pz - nb[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.085 * 0.085 && d2 > 0.0) { if (d2 > 0.068 * 0.068) m = MAT.TRIM; else m = MAT.SKIN; }
      }
      // toon tone
      let l = Nx * LX + Ny * LY + Nz * LZ;
      // ambient occlusion by sampling the field along the normal
      const ao = sdfSet(M, loc, nl_, px + Nx * 0.05, py + Ny * 0.05, pz + Nz * 0.05) / 0.05;
      let tn = l > 0.74 ? 3 : l > 0.26 ? 2 : l > -0.20 ? 1 : 0;
      if (ao < 0.55 && tn > 0) tn--;
      if (ao < 0.30 && tn > 0) tn--;
      // soft rim on the light-facing silhouette
      if (Nz > -0.30 && Nx < -0.25 && l > 0.1 && tn < 3) tn = Math.min(3, tn + 1);
      matB[idx] = m; tone[idx] = tn; dep[idx] = t;
    }
  }
  return { W, H, ox, oy, mat: matB, tone, dep };
}

// ---------------------------------------------------------------- pixel clean-up & outline
export function finish(buf, pal, s, opts = {}) {
  const { W, H, mat, tone, dep } = buf;
  const solid = (i) => mat[i] !== MAT.NONE && mat[i] !== MAT.HOLE;
  const thin = (m) => m === MAT.FRAME || m === MAT.STRING || m === MAT.GRIP || m === MAT.EYE || m === MAT.BAND;
  // 1) remove orphan pixels (no 4-neighbour of the same material class) and tiny material islands
  const cnt = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!solid(i)) continue;
    const m = mat[i]; if (m === MAT.STRING) continue;
    let same = 0, any = 0;
    const nb = [i - 1, i + 1, i - W, i + W];
    for (const j of nb) { if (solid(j)) any++; if (mat[j] === m) same++; }
    if (any === 0) { cnt[i] = 1; continue; }
    if (same === 0 && !thin(m)) {
      // surrounded by another material: adopt the majority neighbour
      const c = {}; let best = 0, bm = m;
      for (const j of nb) if (solid(j)) { c[mat[j]] = (c[mat[j]] || 0) + 1; if (c[mat[j]] > best) { best = c[mat[j]]; bm = mat[j]; } }
      if (best >= 3) { mat[i] = bm; }
    }
  }
  for (let i = 0; i < W * H; i++) if (cnt[i]) { mat[i] = MAT.NONE; }
  // 2) colour
  const out = new Uint32Array(W * H);
  const dark = (m) => (pal[m] ? pal[m][4] : 0);
  const innerD = opts.innerDepth == null ? 0.09 : opts.innerDepth;
  const doInner = opts.inner !== false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!solid(i)) continue;
    const m = mat[i];
    let c;
    if (m === MAT.FRAME) c = ((x * 7 + y * 3) % 11 === 0) ? pal.accent : pal[m][tone[i] >= 3 ? 3 : 2];
    else c = pal[m][Math.min(3, tone[i])];
    if (doInner && m !== MAT.STRING) {
      const d = dep[i];
      if (dep[i - 1] < d - innerD || dep[i + 1] < d - innerD || dep[i - W] < d - innerD || dep[i + W] < d - innerD) {
        // darker line only where the nearer neighbour is a different surface
        c = dark(m);
      }
    }
    out[i] = c;
  }
  // 3) outer selective outline
  const res = new Uint32Array(W * H);
  res.set(out);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (mat[i] !== MAT.NONE) continue; // only truly empty pixels grow an outline (holes in strings stay open)
    let bm = 0, bd = 1e9;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (solid(j) && mat[j] !== MAT.STRING && dep[j] < bd) { bd = dep[j]; bm = mat[j]; }
    }
    if (bm) res[i] = dark(bm);
  }
  return res;
}
