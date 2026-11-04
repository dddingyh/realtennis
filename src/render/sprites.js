// Procedural pixel-art tennis players. A 3D skeleton (pose.js) is projected orthographically at an integer
// pixel scale and rasterised with hard-edged, 3-tone shaded capsules + outlines. Frames are cached per size.
import { PixBuf, hex, shade, mix, lift, rgba, R, G, B, A } from './raster.js';
import { poseFor, solve, BODY, clamp } from './pose.js';

const OUT = hex('#0f131c');
const WHITE = hex('#f3f3ee');
const rampCache = new Map();
function ramp(c) {
  let r = rampCache.get(c);
  if (!r) {
    r = {
      d: rgba(R(c) * 0.62, G(c) * 0.64, Math.min(255, B(c) * 0.74 + 8)),
      b: c,
      l: rgba(Math.min(255, R(c) + (255 - R(c)) * 0.24), Math.min(255, G(c) + (255 - G(c)) * 0.24), Math.min(255, B(c) + (255 - B(c)) * 0.2)),
      o: rgba(R(c) * 0.38, G(c) * 0.4, Math.min(255, B(c) * 0.5 + 10)),
    };
    rampCache.set(c, r);
  }
  return r;
}
const LX = -0.55, LY = -0.83;
const toneBySide = (c, side, flat) => {
  const r = ramp(c);
  if (flat) return side < -0.3 ? r.d : r.b;
  return side > 0.42 ? r.l : side < -0.28 ? r.d : r.b;
};

class Painter {
  constructor(pb, role, s, big) {
    this.pb = pb; this.role = role; this.s = s; this.big = big; // big: draw inner outlines
    const near = role === 'near';
    this.phi = near ? 0.50 : 0.25;
    this.cs = Math.cos(this.phi); this.sn = Math.sin(this.phi);
    this.near = near;
    this.ox = pb.w / 2; this.oy = pb.h - 0.30 * s;
    this.parts = [];
  }
  P(p) {
    const vx = this.near ? p[0] : -p[0];
    const d = this.near ? p[2] : -p[2];
    return { x: this.ox + vx * this.s, y: this.oy - (p[1] * this.cs + d * this.sn) * this.s, d };
  }
  add(d, fn) { this.parts.push({ d, fn }); }
  flush() {
    this.parts.sort((a, b) => b.d - a.d);
    for (const p of this.parts) p.fn();
  }
  rad(r) { return Math.max(0.85, r * this.s); }

  capsule(a, b, ra, rb, colorAt, outline = true) {
    const pb = this.pb;
    const x0 = Math.floor(Math.min(a.x - ra, b.x - rb) - 2), x1 = Math.ceil(Math.max(a.x + ra, b.x + rb) + 2);
    const y0 = Math.floor(Math.min(a.y - ra, b.y - rb) - 2), y1 = Math.ceil(Math.max(a.y + ra, b.y + rb) + 2);
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-6;
    const flat = Math.max(ra, rb) < 1.6;
    const pass = (extra, col) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = ((px - a.x) * dx + (py - a.y) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = a.x + dx * t, cy = a.y + dy * t;
        const r = ra + (rb - ra) * t + extra;
        const ex = px - cx, ey = py - cy;
        if (ex * ex + ey * ey > r * r) continue;
        if (col === null) {
          const c = colorAt(t);
          const side = (ex * LX + ey * LY) / r;
          pb.set(x, y, toneBySide(c, side, flat));
        } else pb.set(x, y, col);
      }
    };
    if (outline && this.big) pass(0.9, ramp(colorAt(0.5)).o);
    pass(0, null);
  }
  limb(a3, b3, r0, r1, segs, outline = true) {
    const a = this.P(a3), b = this.P(b3);
    const segAt = (t) => { for (const sg of segs) if (t >= sg[0] && t <= sg[1] + 1e-6) return sg[2]; return segs[segs.length - 1][2]; };
    this.capsule(a, b, this.rad(r0), this.rad(r1), segAt, outline);
  }
  disc(c3, r, color, outline = true) {
    const p = this.P(c3);
    this.capsule(p, p, this.rad(r), this.rad(r), () => color, outline);
  }
  line3(a3, b3, col, thick = 1) {
    const a = this.P(a3), b = this.P(b3);
    this.pb.line(Math.floor(a.x), Math.floor(a.y), Math.floor(b.x), Math.floor(b.y), col);
    if (thick > 1) this.pb.line(Math.floor(a.x) + 1, Math.floor(a.y), Math.floor(b.x) + 1, Math.floor(b.y), col);
  }
}

function polyTone(pb, pts, colorTone) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const y0 = Math.ceil(minY - 0.5), y1 = Math.floor(maxY - 0.5);
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) xs.push(a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.ceil(xs[k] - 0.5), xb = Math.floor(xs[k + 1] - 0.5);
      for (let x = xa; x <= xb; x++) pb.set(x, y, colorTone(x, y, xs[k], xs[k + 1], yc - minY, maxY - minY));
    }
  }
}

function drawRacket(pt, J, look) {
  const s = pt.s, big = pt.big;
  const hand = J.handR, ax = J.axis, fc = J.face;
  const P3 = (k) => [hand[0] + ax[0] * k, hand[1] + ax[1] * k, hand[2] + ax[2] * k];
  const frame = hex('#1f2735'), accent = hex(look.racket || '#e0463a');
  const d = (pt.P(hand).d + pt.P(P3(0.4)).d) / 2;
  pt.add(d + 0.01, () => {
    const pb = pt.pb;
    // handle
    pt.limb(P3(-0.12), P3(0.16), 0.024, 0.02, [[0, 0.1, hex('#2b3447')], [0.1, 0.8, hex('#3a4660')], [0.8, 1, WHITE]], false);
    // throat + head
    const Cc = P3(0.25 + 0.165);
    const f2 = [ax[1] * fc[2] - ax[2] * fc[1], ax[2] * fc[0] - ax[0] * fc[2], ax[0] * fc[1] - ax[1] * fc[0]];
    const fl = Math.hypot(f2[0], f2[1], f2[2]) || 1;
    const pts = [];
    const N = 28;
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const q = [Cc[0] + ax[0] * 0.168 * c + f2[0] / fl * 0.122 * sn, Cc[1] + ax[1] * 0.168 * c + f2[1] / fl * 0.122 * sn, Cc[2] + ax[2] * 0.168 * c + f2[2] / fl * 0.122 * sn];
      pts.push(pt.P(q));
    }
    const thick = s > 30 ? 2 : 1;
    // string bed
    polyTone(pb, pts, (x, y) => (((x + y) & 1) ? hex('#cfd9e6') : hex('#8e9db3')));
    if (s > 30) {
      const c0 = pt.P(Cc);
      // main strings (cross)
      for (let k = 0; k < N; k += 7) {
        const a = pts[k], b = pts[(k + N / 2) % N];
        pb.line(Math.floor(a.x), Math.floor(a.y), Math.floor(b.x), Math.floor(b.y), hex('#7d8da6'));
      }
    }
    for (let k = 0; k < N; k++) {
      const a = pts[k], b = pts[(k + 1) % N];
      const col = (k % 9 === 0 || k % 9 === 1) ? accent : frame;
      pb.line(Math.floor(a.x), Math.floor(a.y), Math.floor(b.x), Math.floor(b.y), col);
      if (thick > 1) pb.line(Math.floor(a.x), Math.floor(a.y) + 1, Math.floor(b.x), Math.floor(b.y) + 1, col);
    }
    // shaft (Y-throat)
    const th0 = Math.PI - 0.42, th1 = Math.PI + 0.42;
    const T = pt.P(P3(0.2));
    for (const th of [th0, th1]) {
      const k = Math.round((th / (Math.PI * 2)) * N) % N;
      pb.line(Math.floor(T.x), Math.floor(T.y), Math.floor(pts[k].x), Math.floor(pts[k].y), frame);
    }
  });
}

function drawHead(pt, J, look, near) {
  const s = pt.s;
  const hair = hex(look.hair), skin = hex(look.skin), band = look.headband ? hex(look.headband) : 0;
  const c = pt.P(J.head);
  const r = pt.rad(BODY.headR) * 1.08;
  pt.add(c.d - 0.02, () => {
    const pb = pt.pb;
    const x0 = Math.floor(c.x - r - 2), x1 = Math.ceil(c.x + r + 2), y0 = Math.floor(c.y - r - 2), y1 = Math.ceil(c.y + r + 2);
    // vertical squash for the elevated view (head is a sphere, but slightly taller reads better)
    for (let pass = 0; pass < 2; pass++) {
      const rr = pass === 0 ? r + (pt.big ? 0.9 : 0.7) : r;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const ex = x + 0.5 - c.x, ey = y + 0.5 - c.y;
        if (ex * ex + ey * ey > rr * rr) continue;
        if (pass === 0) { pb.set(x, y, OUT); continue; }
        const nx = ex / r, ny = ey / r;
        const side = (nx * LX + ny * LY);
        let base;
        if (near) {
          base = hair;
          if (ny > 0.62) base = skin;                 // nape / neck
          if (Math.abs(nx) > 0.78 && ny > 0.0 && ny < 0.55) base = skin; // ears
        } else {
          base = skin;
          const hairLine = -0.22 + 0.22 * nx * nx;
          if (ny < hairLine) base = hair;
          if (Math.abs(nx) > 0.82 && ny < 0.25) base = hair;
        }
        if (band && ny > -0.38 && ny < -0.12 + (near ? 0.04 : 0)) base = band;
        let col = toneBySide(base, side, r < 3);
        pb.set(x, y, col);
      }
    }
    if (!near && r >= 2.6) {
      // face: eyes + brows
      const eyeY = Math.round(c.y + r * 0.08), dx = Math.max(1, Math.round(r * 0.42));
      pb.set(Math.round(c.x - dx - 0.5 + 0.5), eyeY, hex('#1c1c24'));
      pb.set(Math.round(c.x + dx - 0.5 + 0.5), eyeY, hex('#1c1c24'));
      if (r >= 3.6) pb.set(Math.round(c.x), Math.round(c.y + r * 0.5), shade(skin, 0.7));
    }
  });
}

export function renderPlayerFrame(P, J, look, role, s) {
  const W = Math.round(2.9 * s), H = Math.round(3.5 * s);
  const pb = new PixBuf(W, H);
  const big = s >= 30;
  const pt = new Painter(pb, role, s, big);
  const near = role === 'near';
  const skin = hex(look.skin), shirt = hex(look.shirt), shorts = hex(look.shorts), shoes = hex(look.shoes);
  const sockC = WHITE;

  // legs
  for (const side of ['R', 'L']) {
    const hip = side === 'R' ? J.hipR : J.hipL, knee = side === 'R' ? J.kneeR : J.kneeL, ank = side === 'R' ? J.ankR : J.ankL;
    const dMid = pt.P(knee).d;
    pt.add(dMid, () => {
      pt.limb(hip, knee, 0.088, 0.072, [[0, 0.62, shorts], [0.62, 1, skin]]);
      pt.limb(knee, ank, 0.066, 0.048, [[0, 0.74, skin], [0.74, 1, sockC]]);
    });
    // shoe
    const fwd = [Math.sin(J.yaw), 0, Math.cos(J.yaw)];
    const toe = [ank[0] + fwd[0] * 0.17, Math.max(0.035, ank[1] - 0.03), ank[2] + fwd[2] * 0.17];
    const heel = [ank[0] - fwd[0] * 0.05, ank[1] - 0.02, ank[2] - fwd[2] * 0.05];
    pt.add(pt.P(ank).d - 0.01, () => {
      pt.limb(heel, toe, 0.058, 0.05, [[0, 1, shoes]]);
      // white sole
      const a = pt.P([heel[0], heel[1] - 0.04, heel[2]]), b = pt.P([toe[0], toe[1] - 0.04, toe[2]]);
      pt.pb.line(Math.floor(a.x), Math.floor(a.y + 0.5), Math.floor(b.x), Math.floor(b.y + 0.5), WHITE);
    });
  }
  // pelvis + shorts
  pt.add(pt.P(J.hipC).d + 0.02, () => {
    pt.limb(J.hipL, J.hipR, 0.115, 0.115, [[0, 1, shorts]]);
  });
  // torso
  const chD = pt.P(J.chest).d;
  pt.add(chD + 0.03, () => {
    const pb = pt.pb;
    const sh = (p, dx, dy) => { const q = pt.P(p); return { x: q.x + dx, y: q.y + dy }; };
    const o = pt.big ? 1.0 : 0.6;
    const pts = [sh(J.shL, -pt.s * 0.045, -pt.s * 0.02), sh(J.shR, pt.s * 0.045, -pt.s * 0.02),
      sh(J.hipR, pt.s * 0.05, pt.s * 0.02), sh(J.hipL, -pt.s * 0.05, pt.s * 0.02)];
    const chestP = pt.P(J.chest), hipP = pt.P(J.hipC);
    const r = ramp(shirt);
    // thickness capsule for side views
    pt.capsule(pt.P([J.chest[0], J.chest[1] - 0.04, J.chest[2]]), pt.P([J.hipC[0], J.hipC[1] + 0.08, J.hipC[2]]), pt.rad(0.14), pt.rad(0.125), () => shirt, true);
    // outline polygon
    if (pt.big) polyTone(pb, pts.map((p, i) => ({ x: p.x + (i === 0 || i === 3 ? -1 : 1), y: p.y + (i < 2 ? -1 : 0) })), () => r.o);
    polyTone(pb, pts, (x, y, xa, xb, yy, hh) => {
      const u = (x + 0.5 - xa) / Math.max(1, xb - xa);
      let c;
      if (u < 0.22) c = r.l; else if (u > 0.78) c = r.d; else c = r.b;
      if (hh > 8 && yy > hh - 1.2) c = r.d;              // hem
      // collar / neck line
      return c;
    });
  });
  // neck
  pt.add(chD + 0.04, () => {
    pt.limb(J.chest, J.neck, 0.05, 0.045, [[0, 1, skin]], false);
    pt.limb([J.chest[0], J.chest[1] + 0.02, J.chest[2]], [J.neck[0], J.neck[1] + 0.08, J.neck[2]], 0.05, 0.045, [[0, 1, skin]], false);
  });
  drawHead(pt, J, look, near);
  // arms
  const armD = (side) => {
    const sh = side === 'R' ? J.shR : J.shL, el = side === 'R' ? J.elbR : J.elbL, hd = side === 'R' ? J.handR : J.handL;
    const dd = (pt.P(el).d + pt.P(sh).d) / 2;
    pt.add(dd, () => {
      pt.limb(sh, el, 0.058, 0.05, [[0, 0.5, shirt], [0.5, 1, skin]]);
      pt.limb(el, hd, 0.047, 0.04, [[0, 0.8, skin], [0.8, 1, WHITE]]);
    });
    pt.add(pt.P(hd).d - 0.03, () => pt.disc(hd, 0.05, skin));
  };
  armD('R'); armD('L');
  drawRacket(pt, J, look);
  pt.flush();
  return pb;
}

function cropAndOutline(pb, anchorX, anchorY) {
  const { w, h, px } = pb;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { return { canvas: document.createElement('canvas'), ax: 0, ay: 0 }; }
  x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = new PixBuf(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = x + x0, sy = y + y0;
    const c = pb.get(sx, sy);
    if (c) { out.px[y * cw + x] = c; continue; }
    if (pb.get(sx - 1, sy) || pb.get(sx + 1, sy) || pb.get(sx, sy - 1) || pb.get(sx, sy + 1)) out.px[y * cw + x] = OUT;
  }
  out.flush();
  return { canvas: out.canvas, ax: anchorX - x0, ay: anchorY - y0 };
}

const DEFAULT_LOOK = { skin: '#e0a97c', hair: '#2a1d12', shirt: '#e8e8e0', shorts: '#2a3a6a', shoes: '#f0f0f0', headband: null };

export class SpriteFactory {
  constructor() { this.cache = new Map(); this.runPhase = [0, 0]; this.lastPos = [null, null]; }

  // advance gait phase by travelled distance
  updateRun(i, player, dt) {
    const sp = Math.hypot(player.vel?.x || 0, player.vel?.z || 0);
    this.runPhase[i] = (this.runPhase[i] + dt * (0.55 + sp * 0.62)) % 1;
  }

  frameKey(i, pl, role, s, time) {
    const a = pl.anim || { name: 'ready' };
    const look = pl.look || DEFAULT_LOOK;
    let ph = 0, extra = '';
    const name = a.name || 'ready';
    if (name === 'swing') ph = Math.round(clamp(a.phase || 0, 0, 1) * 24);
    else if (name === 'serve') ph = Math.round(clamp(a.phase || 0, 0, 1) * 30);
    else if (name === 'run' || name === 'walk') ph = Math.floor(this.runPhase[i] * 10) % 10;
    else if (name === 'ready' || name === 'idle') ph = Math.floor(time * 2.5) % 4;
    else if (name === 'celebrate') ph = Math.floor(time * 2.2 % 1 * 10);
    else if (name === 'dejected') ph = Math.floor(time * 0.8) % 3;
    if (name === 'run') {
      const d = a.dir || { x: 0, z: 0 };
      const ang = Math.round(Math.atan2(d.x, -d.z) / (Math.PI / 4));
      extra = `|d${ang}|s${Math.round((a.speed == null ? 0.7 : a.speed) * 3)}`;
    }
    return `${role}|${pl.hand || 'R'}|${name}|${a.shot || ''}|${a.side || ''}|${ph}${extra}|${s}|${look.shirt}${look.shorts}${look.hair}${look.skin}${look.headband || ''}`;
  }

  get(i, pl, role, s, time) {
    const key = this.frameKey(i, pl, role, s, time);
    let f = this.cache.get(key);
    if (f) return f;
    const a = pl.anim || { name: 'ready' };
    const name = a.name || 'ready';
    // quantised inputs so the cache key fully determines the picture
    const ph = key.split('|')[5];
    const qa = { ...a };
    if (name === 'swing') qa.phase = parseInt(ph, 10) / 24;
    else if (name === 'serve') qa.phase = parseInt(ph, 10) / 30;
    let qTime = time;
    if (name === 'ready' || name === 'idle') qTime = (parseInt(ph, 10) / 4) * (Math.PI * 2 / 3.0 * 0 + 1.2);
    if (name === 'celebrate') qTime = parseInt(ph, 10) / 10 / 2.2;
    if (name === 'dejected') qTime = parseInt(ph, 10) * 1.2;
    const rp = (name === 'run' || name === 'walk') ? (parseInt(ph, 10) % 10) / 10 : 0;
    if (name === 'run') {
      const d = a.dir || { x: 0, z: 0 };
      const ang = Math.round(Math.atan2(d.x, -d.z) / (Math.PI / 4)) * (Math.PI / 4);
      qa.dir = { x: Math.sin(ang), z: -Math.cos(ang) };
      qa.speed = Math.round((a.speed == null ? 0.7 : a.speed) * 3) / 3 || 0.34;
    }
    const P = poseFor(qa, { runPhase: rp, time: qTime, role });
    const J = solve(P, pl.hand || 'R');
    const buf = renderPlayerFrame(P, J, pl.look || DEFAULT_LOOK, role, s);
    f = cropAndOutline(buf, buf.w / 2, buf.h - 0.30 * s);
    this.cache.set(key, f);
    if (this.cache.size > 2500) this.cache.delete(this.cache.keys().next().value);
    return f;
  }
}
