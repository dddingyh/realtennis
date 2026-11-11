// Anime hair (chunky pointed locks over a scalp shell), hair accessories and headwear. All built in head-local space
// (the caller sets the Merge origin to the head bone's rest position) and skinned to the head / spring chain bones.
import * as THREE from 'three';
import { Merge, SLOT, sweep, tube, ellipsoid, prof, sst, clamp, lerp, HEAD_T } from './sculpt.js';
import { BI } from './dims.js';

const V = THREE.Vector3;
export const HAIR_STYLES = ['spiky', 'tousled', 'short', 'bob', 'long', 'ponytail', 'twin', 'sidePony', 'bun', 'braid'];

const tab = (pairs, x) => { // piecewise-linear table lookup
  if (x <= pairs[0][0]) return pairs[0][1];
  for (let i = 1; i < pairs.length; i++) if (x <= pairs[i][0]) { const a = pairs[i - 1], b = pairs[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  return pairs[pairs.length - 1][1];
};

// weights along a spring chain (3 bones) for param u in 0..1 (0 = at the head)
function chainW(b1, b2, b3) {
  return (u) => {
    if (u < 0.12) return [BI.head, 1 - u / 0.12, b1, u / 0.12];
    if (u < 0.5) return [b1, 1 - (u - 0.12) / 0.38, b2, (u - 0.12) / 0.38];
    return [b2, 1 - (u - 0.5) / 0.5, b3, (u - 0.5) / 0.5];
  };
}

export function buildHair(M, D, look, H) {
  const W = D.headW, HH = D.headH, u = W; // unit
  const style = look.hairStyle || 'short';
  const hw = look.headwear || 'none';
  const HAIR = SLOT.hair, HAIR2 = SLOT.hair2;
  const head = BI.head;
  const cy = H.y(0.5);
  const hintHead = (p) => new V(p.x, p.y - cy, p.z - 0.0).normalize();
  const P = (t, th, off) => H.surf(t, th, off);
  const thick = 0.013 * (W / 0.215) ** 0.6 + 0.004;
  const capOn = hw !== 'cap';

  // ------------------------------------------------------------ scalp shell
  const capBottom = {
    short: [[0, 0.80], [0.6, 0.79], [1.1, 0.72], [1.57, 0.63], [2.2, 0.46], [3.14, 0.30]],
    bob: [[0, 0.80], [0.7, 0.74], [1.2, 0.5], [1.6, 0.3], [2.2, 0.2], [3.14, 0.18]],
    long: [[0, 0.80], [0.6, 0.79], [1.1, 0.68], [1.57, 0.58], [2.3, 0.4], [3.14, 0.3]],
  };
  const capTab = style === 'bob' ? capBottom.bob : style === 'long' ? capBottom.long : capBottom.short;
  if (capOn || true) {
    const C = 28, R = 15;
    const pos = [];
    const tv = [];
    for (let r = 0; r < R; r++) {
      const v = r / (R - 1);
      for (let c = 0; c < C; c++) {
        let th = (c / C) * Math.PI * 2; if (th > Math.PI) th -= Math.PI * 2;
        const tb = tab(capTab, Math.abs(th));
        const t = lerp(1, tb, Math.pow(v, 0.9));
        let off = thick * (0.8 + 0.5 * Math.sin(v * Math.PI * 0.9)) + (hw === 'cap' ? 0.0 : 0);
        if (style === 'bob') off += 0.028 * sst(0.25, 0.85, v) * sst(0.15, 0.6, Math.abs(th)) - 0.034 * sst(0.9, 1, v);
        if (style === 'long') off += 0.012 * sst(0.3, 0.9, v) * sst(0.5, 1.4, Math.abs(th));
        pos.push(P(t, th, off));
        tv.push([t, th, v]);
      }
    }
    // push as a grid through a temporary tube-like path (reuse pushGrid via sweep-free approach)
    capGrid(M, pos, tv, R, C, H, tab([[0, 0.82], [3.14, 0.8]], 0), hw);
  }

  // ------------------------------------------------------------ lock helpers
  const lockBase = {
    rings: 6, segs: 5, slot: HAIR, hint: hintHead, hl: [0.08, 0.5], wt: head,
    ao: (t, a) => (Math.sin(a) < -0.3 ? 1 : 0),
  };
  const lock = (pts, w0, o = {}) => sweep(M, Object.assign({}, lockBase, {
    pts, w: (t) => w0 * (o.prof || prof.lock)(t), th: (t) => w0 * (o.thk || 0.55) * (o.prof || prof.lock)(t),
  }, o));
  const surfPts = (arr) => arr.map(([t, th, off, dx = 0, dy = 0, dz = 0]) => { const p = P(t, th, off); return [p.x + dx, p.y + dy, p.z + dz]; });

  // ------------------------------------------------------------ fringe (bangs)
  const fringeSets = {
    chibi: [[-1.05, 0.50, -0.8, 1.15], [-0.7, 0.60, -0.55, 1.0], [-0.36, 0.69, -0.28, 0.95], [-0.04, 0.665, 0.0, 0.9], [0.30, 0.70, 0.22, 0.95], [0.64, 0.61, 0.55, 1.0], [1.0, 0.52, 0.85, 1.1]],
    anime: [[-1.05, 0.40, -0.85, 1.1], [-0.68, 0.55, -0.5, 1.0], [-0.34, 0.66, -0.22, 0.95], [-0.02, 0.62, 0.1, 0.9], [0.32, 0.67, 0.34, 0.95], [0.66, 0.56, 0.6, 1.0], [1.02, 0.44, 0.9, 1.1]],
  };
  const fringe = (set, wmul = 1, swoop = 0, tipMul = 1) => {
    for (const [thR, tTip, thTip, wm] of set) {
      const root = Math.abs(thR) < 0.5 ? 0.97 : 0.94;
      const tm = lerp(root, tTip, 0.5);
      const thm = lerp(thR * 0.6, thTip, 0.55) + swoop * 0.2;
      const pts = surfPts([[root, thR * 0.55, 0.012], [tm, thm, 0.034 * wm], [tTip, thTip + swoop * 0.35, 0.018 + 0.006 * (wm > 1 ? 1 : 0)]]);
      lock(pts, 0.2 * u * wm * wmul, { rings: 6, wt: (t) => (t < 0.5 ? head : [head, 1 - sst(0.5, 1, t) * 0.55, BI.fringe, sst(0.5, 1, t) * 0.55]) });
      void tipMul;
    }
  };
  const sideLocks = (tTip = 0.2, wmul = 1, sx = [-1, 1], o = {}) => {
    for (const s of sx) {
      const pts = surfPts([[0.8, s * 1.28, 0.016], [(0.8 + tTip) / 2 + 0.05, s * 1.34, 0.036], [tTip, s * 1.24, 0.026]]);
      lock(pts, 0.17 * u * wmul, Object.assign({ rings: 6, hl: [0.1, 0.45] }, o));
    }
  };
  const fringeSet = fringeSets[D.id];

  // ------------------------------------------------------------ styles
  switch (style) {
    case 'spiky': {
      fringe(fringeSet, 0.95, 0.0);
      sideLocks(0.34, 0.9);
      // crown spikes sweeping up and back
      const sp = [[-1.35, 0.72, 0.8], [-0.9, 0.9, 1.0], [-0.4, 0.97, 1.1], [0.1, 1.0, 1.15], [0.6, 0.97, 1.05], [1.05, 0.9, 0.95], [1.5, 0.74, 0.85],
        [-2.1, 0.78, 0.9], [-2.7, 0.7, 0.85], [2.2, 0.78, 0.9], [2.8, 0.68, 0.85], [3.14, 0.58, 0.8]];
      for (const [th, t, k] of sp) {
        const r0 = P(t, th, 0.004);
        const dirx = Math.sin(th) * 0.8, dirz = Math.cos(th) * 0.5 - 0.55;
        const len = (0.2 + 0.07 * k) * HH;
        const d = new V(dirx, 0.7, dirz).normalize();
        const mid = r0.clone().addScaledVector(d, len * 0.5).add(new V(0, 0.01, 0));
        const tip = r0.clone().addScaledVector(d, len).add(new V(0, -0.02 * HH, -0.03 * HH));
        lock([[r0.x, r0.y, r0.z], [mid.x, mid.y, mid.z], [tip.x, tip.y, tip.z]], 0.23 * u * k, { rings: 5, prof: prof.spike, wt: head, hl: [0.0, 0.5] });
      }
      break;
    }
    case 'tousled': {
      fringe(fringeSet, 1.0, 0.25);
      sideLocks(0.3, 0.95);
      // wild crown tufts + nape flicks
      const tf = [[-0.9, 0.93, 1], [-0.3, 0.99, 1.2], [0.4, 0.98, 1.1], [1.0, 0.92, 1], [-2.2, 0.82, 1], [-3.0, 0.7, 0.9], [2.4, 0.8, 1]];
      for (const [th, t, k] of tf) {
        const r0 = P(t, th, 0.004);
        const d = new V(Math.sin(th) * 1.0, 0.55, Math.cos(th) * 0.7 - 0.2).normalize();
        const len = 0.16 * HH * k;
        const mid = r0.clone().addScaledVector(d, len * 0.55);
        const tip = r0.clone().addScaledVector(d, len).add(new V(0.02 * Math.sign(th), -0.025 * HH, 0));
        lock([[r0.x, r0.y, r0.z], [mid.x, mid.y, mid.z], [tip.x, tip.y, tip.z]], 0.22 * u * k, { rings: 5, prof: prof.spike, wt: head, hl: [0.0, 0.5] });
      }
      for (const th of [2.5, 3.14, -2.5]) {
        const r0 = P(0.5, th, 0.008);
        const d = new V(Math.sin(th) * 0.9, -0.6, Math.cos(th) * 0.9).normalize();
        lock([[r0.x, r0.y, r0.z], [r0.x + d.x * 0.06, r0.y + d.y * 0.06, r0.z + d.z * 0.06], [r0.x + d.x * 0.12, r0.y + d.y * 0.12 - 0.02, r0.z + d.z * 0.12]], 0.18 * u, { rings: 5, prof: prof.spike, slot: HAIR2, wt: head });
      }
      break;
    }
    case 'short': {
      // neat side-swept fringe
      fringe(fringeSet.map(([a, b, c, d], i) => [a, b - 0.01 * i, c + 0.28, d]), 1.0, 0.5);
      sideLocks(0.34, 0.9);
      for (const th of [2.7, 3.14, -2.7]) {
        const r0 = P(0.46, th, 0.008);
        lock([[r0.x, r0.y, r0.z], [r0.x * 1.02, r0.y - 0.05, r0.z * 1.02], [r0.x * 1.0, r0.y - 0.1, r0.z * 0.98]], 0.19 * u, { rings: 5, prof: prof.spike, slot: HAIR2, wt: head });
      }
      break;
    }
    case 'bob': {
      fringe(fringeSet.map(([a, b, c, d]) => [a, b + 0.0, c, d]), 1.05, 0.0);
      sideLocks(0.16, 1.15, [-1, 1], { hl: [0.1, 0.4] });
      break;
    }
    case 'long': {
      fringe(fringeSet, 1.0, -0.1);
      sideLocks(-0.18 * 0 + 0.0, 1.25, [-1, 1], { hl: [0.1, 0.4] });
      // broad back locks hanging from the crown/back, weighted along the nape chain
      const L = D.id === 'chibi' ? 0.50 : 0.56;
      const W3 = chainW(BI.lng1, BI.lng2, BI.lng3);
      const ths = [-2.7, -2.2, -1.8, -3.14, 3.14, 1.8, 2.2, 2.7, -2.5, 2.5];
      ths.forEach((th, i) => {
        const dep = 0.8 + 0.2 * ((i * 7) % 5) / 4;
        const rr = 1.0 + 0.02 * (i % 3);
        const t0 = 0.62, x0 = P(t0, th, 0.015);
        const bottom = H.y(0) - L * dep + 0.02;
        const pts = [[x0.x, x0.y, x0.z], [x0.x * 1.05, lerp(x0.y, bottom, 0.3), x0.z * 1.08 - 0.01], [x0.x * 1.0, lerp(x0.y, bottom, 0.65), x0.z * 1.06 - 0.02], [x0.x * 0.9, bottom, x0.z * 1.0 - 0.01]];
        const total = x0.y - bottom;
        lock(pts, 0.28 * u * rr, { rings: 8, prof: prof.tail, slot: (i % 2) ? HAIR : HAIR2, hl: [0.1, 0.5], wt: (t) => W3(clamp(((x0.y - lerp(x0.y, bottom, t)) - 0.0) / Math.max(total, 1e-3), 0, 1) * 0.0 + t * 1) });
      });
      break;
    }
    case 'ponytail': {
      fringe(fringeSet, 1.0, 0.1);
      sideLocks(0.3, 0.95);
      tail(M, D, H, { anchor: [0.0, H.y(0.80), -0.80 * D.headD], dir: 0, bones: [BI.ponyA1, BI.ponyA2, BI.ponyA3], len: D.id === 'chibi' ? 0.36 : 0.44, w: 0.34 * u, count: 3, spread: 0.04 * u * 5, flip: 0, curl: 0.0, swoop: 0.06 });
      break;
    }
    case 'twin': {
      fringe(fringeSet, 1.0, 0.0);
      sideLocks(0.3, 0.9);
      for (const s of [-1, 1]) tail(M, D, H, { anchor: [s * 0.94 * D.headW, H.y(0.74), -0.12 * D.headD], dir: s, bones: s < 0 ? [BI.tailL1, BI.tailL2, BI.tailL3] : [BI.tailR1, BI.tailR2, BI.tailR3], len: D.id === 'chibi' ? 0.44 : 0.5, w: 0.3 * u, count: 3, spread: 0.035 * u * 5, flip: s, curl: 0.05, swoop: 0.0, side: true });
      break;
    }
    case 'sidePony': {
      fringe(fringeSet.map(([a, b, c, d]) => [a, b, c - 0.1, d]), 1.0, -0.2);
      sideLocks(0.3, 0.9, [-1]);
      tail(M, D, H, { anchor: [0.94 * D.headW, H.y(0.72), -0.1 * D.headD], dir: 1, bones: [BI.tailR1, BI.tailR2, BI.tailR3], len: D.id === 'chibi' ? 0.4 : 0.46, w: 0.32 * u, count: 3, spread: 0.035 * u * 5, flip: 1, curl: 0.06, swoop: 0, side: true });
      sideLocks(0.3, 0.9, [1]);
      break;
    }
    case 'bun': {
      fringe(fringeSet, 1.0, 0.0);
      sideLocks(0.32, 0.9);
      const c = [0, H.y(1.0) + 0.045 * HH, -0.28 * D.headD];
      ellipsoid(M, c, [0.36 * u, 0.3 * u, 0.36 * u], { lat: 8, lon: 12, slot: HAIR, wt: [head, 0.55, BI.ponyA1, 0.45], hl: (nx, ny, nz) => (ny > 0.3 && nz > -0.2 ? 1 : 0) });
      ellipsoid(M, [c[0], c[1] - 0.2 * u, c[2] - 0.02], [0.3 * u, 0.1 * u, 0.3 * u], { lat: 5, lon: 10, slot: SLOT.band, wt: head, rot: [0.3, 0, 0] });
      break;
    }
    case 'braid': {
      fringe(fringeSet, 1.0, 0.1);
      sideLocks(0.28, 0.95);
      braid(M, D, H);
      break;
    }
    default: fringe(fringeSet, 1, 0);
  }

  if (look.ahoge) {
    const r0 = P(0.985, 0.0, 0.0);
    const hh = 0.2 * HH;
    lock([[r0.x, r0.y, r0.z + 0.01], [r0.x + 0.01, r0.y + hh * 0.5, r0.z + 0.04 * HH], [r0.x + 0.03 * HH, r0.y + hh * 0.85, r0.z + 0.09 * HH], [r0.x + 0.07 * HH, r0.y + hh * 0.9, r0.z + 0.13 * HH]], 0.1 * u, { rings: 7, segs: 4, prof: prof.spike, wt: (t) => [head, 1 - sst(0, 0.5, t), BI.ahoge, sst(0, 0.5, t)], hl: [0, 0] });
  }

  // ------------------------------------------------------------ headwear
  headwear(M, D, H, look, hw);
}

// cap shell as a skinned grid
import { pushGridPublic } from './sculpt.js';
function capGrid(M, pos, tv, R, C, H, _unused, hw) {
  const attr = (r, c) => {
    const [t, th, v] = tv[r * C + c];
    const band = Math.exp(-Math.pow((t - (0.80 + 0.02 * Math.cos(th * 2))) / 0.05, 2));
    const hl = band > 0.5 && Math.abs(th) > 0.4 ? 1 : 0;
    const ao = (v > 0.86 && Math.abs(th) > 1.3) ? 1 : 0;
    return { slot: SLOT.hair, hl: band, ao, ow: 1, soft: 0, wp: BI.head };
  };
  const nrm = new V();
  pushGridPublic(M, pos, R, C, true, attr, (r, c, p) => { const [t, th] = tv[r * C + c]; return H.normal(Math.min(t, 0.995), th, nrm).clone(); });
}

// ------------------------------------------------------------ ponytail / twin tail bundle
function tail(M, D, H, o) {
  const [b1, b2, b3] = o.bones;
  const W3 = chainW(b1, b2, b3);
  const [ax, ay, az] = o.anchor;
  const L = o.len, s = o.dir;
  // tie
  ellipsoid(M, [ax, ay, az], [0.045 * D.headW * 5 * 0.8 + 0.01, 0.03 * D.headW * 5 * 0.7 + 0.008, 0.045 * D.headW * 5 * 0.8 + 0.01], { lat: 5, lon: 9, slot: SLOT.band, wt: [BI.head, 0.5, b1, 0.5] });
  for (let k = 0; k < o.count; k++) {
    const f = k - (o.count - 1) / 2;
    const sx = f * o.spread * 1.0;
    const ln = L * (1 - 0.12 * Math.abs(f));
    const pts = o.side
      ? [[ax + s * 0.005, ay, az], [ax + s * (0.045 + 0.01 * f) + sx * 0.6, ay - 0.02, az - 0.03], [ax + s * (0.07 + o.curl) + sx, ay - ln * 0.4, az - 0.035 + 0.01 * f], [ax + s * (0.075 + o.curl * 1.6) + sx * 1.3, ay - ln * 0.75, az - 0.02], [ax + s * (0.06 + o.curl * 2.6) + sx * 1.4, ay - ln, az + 0.0]]
      : [[ax, ay, az], [ax + sx * 0.4, ay + 0.03, az - 0.05], [ax + sx, ay - 0.03, az - 0.1 - o.swoop], [ax + sx * 1.3, ay - ln * 0.45, az - 0.12 - o.swoop * 1.2], [ax + sx * 1.4, ay - ln * 0.8, az - 0.1 - o.swoop], [ax + sx * 1.5, ay - ln, az - 0.07]];
    sweep(M, {
      pts, rings: 9, segs: 6, slot: (k === 1) ? SLOT.hair2 : SLOT.hair,
      w: (t) => o.w * prof.tail(t) * (1 - 0.1 * Math.abs(f)), th: (t) => o.w * 0.9 * prof.tail(t) * (1 - 0.1 * Math.abs(f)),
      hint: () => new V(0, 0, -1), wt: (t) => W3(t), hl: [0.08, 0.45], ao: (t, a) => (Math.sin(a) < -0.3 ? 1 : 0),
    });
  }
}

function braid(M, D, H) {
  const W3 = chainW(BI.lng1, BI.lng2, BI.lng3);
  const ay = H.y(0.55), az = -0.9 * D.headD;
  const L = D.id === 'chibi' ? 0.42 : 0.5;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = ay - t * L, z = az - 0.035 - 0.012 * Math.sin(t * 3);
    const r = (0.075 - 0.03 * t) * D.headW * 4.2 / 4;
    const sgn = i % 2 ? 1 : -1;
    ellipsoid(M, [sgn * 0.012, y, z], [r * 1.1 + 0.012, L / n * 0.75, r + 0.01], { lat: 5, lon: 8, slot: i % 2 ? SLOT.hair : SLOT.hair2, wt: W3(clamp(t * 0.95 + 0.04, 0, 1)), hl: (nx, ny, nz) => (nz < -0.2 && ny > 0.2 ? 1 : 0), rot: [0, 0, sgn * 0.35] });
  }
  ellipsoid(M, [0, ay - L - 0.01, az - 0.04], [0.03 * D.headW * 5 * 0.7, 0.02, 0.03 * D.headW * 5 * 0.7], { lat: 5, lon: 8, slot: SLOT.band, wt: W3(1) });
  // tip tuft
  sweep(M, { pts: [[0, ay - L, az - 0.04], [0, ay - L - 0.05, az - 0.045], [0, ay - L - 0.1, az - 0.04]], rings: 4, segs: 5, slot: SLOT.hair, w: (t) => 0.03 * D.headW * 5 * 0.8 * prof.spike(t), hint: () => new V(0, 0, -1), wt: W3(1) });
}

// ------------------------------------------------------------ headwear
function headwear(M, D, H, look, hw) {
  if (hw === 'none') return;
  const head = BI.head;
  const W = D.headW;
  const A = SLOT.band;
  const ring = (tFront, tBack, off, w, th, gap, slot, rings = 26, wtf) => {
    const pts = [];
    const n = 14;
    const a0 = gap, a1 = Math.PI * 2 - gap;
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      const thv = a > Math.PI ? a - Math.PI * 2 : a;
      const t = lerp(tFront, tBack, Math.pow(Math.abs(thv) / Math.PI, 1.3));
      const p = H.surf(t, thv, off);
      pts.push([p.x, p.y, p.z]);
    }
    const hint = (p) => new V(0, 1, 0);
    sweep(M, { pts, rings, segs: 6, slot, w: () => th, th: () => w, hint, wt: wtf || head, ao: () => 0, hl: [0, 0], noHl: true });
  };
  if (hw === 'headband') {
    ring(0.74, 0.62, 0.016, 0.026 * (W / 0.215) ** 0.5 + 0.008, 0.01, 0.0, A);
    // knot + tails at the back
    const p = H.surf(0.64, Math.PI, 0.02);
    ellipsoid(M, [p.x, p.y, p.z - 0.005], [0.028 * (W / 0.2) ** 0.5 + 0.01, 0.025 * (W / 0.2) ** 0.5 + 0.01, 0.026 * (W / 0.2) ** 0.5 + 0.01], { lat: 5, lon: 8, slot: A, wt: head });
    for (const s of [-1, 1]) {
      sweep(M, { pts: [[p.x, p.y, p.z - 0.01], [p.x + s * 0.03, p.y - 0.035, p.z - 0.035], [p.x + s * 0.05, p.y - 0.1, p.z - 0.05]], rings: 5, segs: 4, slot: A, w: (t) => 0.02 * (1 - 0.5 * t) + 0.005, th: () => 0.006, hint: () => new V(0, 0, -1), wt: (t) => [head, 1 - sst(0, 0.6, t), BI.band1, sst(0, 0.6, t)] });
    }
  } else if (hw === 'visor') {
    ring(0.80, 0.68, 0.014, 0.022 * (W / 0.215) ** 0.5 + 0.008, 0.009, 0.45, A);
    // brim
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const th = lerp(-1.2, 1.2, i / 8);
      const p = H.surf(0.80, th, 0.014 + 0.05 * Math.cos(th * 0.8) * (W / 0.215) ** 0.6 + 0.0);
      pts.push([p.x, p.y + 0.004, p.z]);
    }
    sweep(M, { pts, rings: 12, segs: 6, slot: A, w: (t) => 0.034 * (W / 0.215) ** 0.6 + 0.012, th: () => 0.006, hint: () => new V(0, 1, 0), wt: head, hl: [0, 0], noHl: true, ow: 1 });
  } else if (hw === 'cap') {
    // dome shell
    const C = 28, R = 12, pos = [], tv = [];
    for (let r = 0; r < R; r++) {
      const v = r / (R - 1);
      for (let c = 0; c < C; c++) {
        let th = (c / C) * Math.PI * 2; if (th > Math.PI) th -= Math.PI * 2;
        const tb = lerp(0.82, 0.62, Math.pow(Math.abs(th) / Math.PI, 1.1));
        const t = lerp(1, tb, Math.pow(v, 0.95));
        pos.push(H.surf(t, th, 0.03 * (W / 0.215) ** 0.6 + 0.01 + 0.012 * Math.sin(v * 2.2)));
        tv.push([t, th, v]);
      }
    }
    const nrm = new V();
    pushGridPublic(M, pos, R, C, true, (r, c) => ({ slot: A, hl: 0, ao: 0, ow: 1, soft: 0, wp: head }), (r, c) => H.normal(Math.min(tv[r * C + c][0], 0.995), tv[r * C + c][1], nrm).clone());
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const th = lerp(-1.25, 1.25, i / 8);
      const p = H.surf(0.80, th, 0.03 + 0.06 * Math.cos(th * 0.85) * (W / 0.215) ** 0.6 + 0.01);
      pts.push([p.x, p.y + 0.01, p.z]);
    }
    sweep(M, { pts, rings: 12, segs: 6, slot: A, w: (t) => 0.04 * (W / 0.215) ** 0.6 + 0.014, th: () => 0.008, hint: () => new V(0, 1, 0), wt: head, noHl: true });
    // button
    ellipsoid(M, [0, H.y(1) + 0.02, 0], [0.012, 0.012, 0.012], { lat: 4, lon: 6, slot: SLOT.white, wt: head });
  }
}

void tube; void Merge; void HEAD_T;
