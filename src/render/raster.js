// Crisp, non-anti-aliased pixel rasterizer helpers (no canvas path AA anywhere).
// Colors are packed little-endian ABGR ints so they can be written straight into a Uint32Array view of ImageData.

export function rgba(r, g, b, a = 255) {
  return ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0;
}
export function hex(s) {
  if (typeof s === 'number') return s;
  s = (s || '#ff00ff').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
}
export const R = (c) => c & 255;
export const G = (c) => (c >>> 8) & 255;
export const B = (c) => (c >>> 16) & 255;
export const A = (c) => (c >>> 24) & 255;
export function css(c) { return `rgba(${R(c)},${G(c)},${B(c)},${A(c) / 255})`; }
export function mix(c1, c2, t) {
  return rgba(
    R(c1) + (R(c2) - R(c1)) * t, G(c1) + (G(c2) - G(c1)) * t, B(c1) + (B(c2) - B(c1)) * t,
    A(c1) + (A(c2) - A(c1)) * t);
}
export function shade(c, f) {
  return rgba(Math.min(255, R(c) * f), Math.min(255, G(c) * f), Math.min(255, B(c) * f), A(c));
}
// brightness shift in 0..255 units, keeps hue-ish
export function lift(c, d) {
  return rgba(clamp8(R(c) + d), clamp8(G(c) + d), clamp8(B(c) + d), A(c));
}
export function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

// 4x4 Bayer ordered dither thresholds in [0,1)
export const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((v) => (v + 0.5) / 16);
export function bayer(x, y) { return BAYER4[((y & 3) << 2) | (x & 3)]; }

// fast integer hash -> [0,1)
export function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class PixBuf {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
  }
  clear(c = 0) { this.px.fill(c); }
  flush() { this.ctx.putImageData(this.img, 0, 0); return this.canvas; }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }
  // alpha-blend a colour (A channel as coverage)
  blend(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const a = A(c);
    if (a === 255) { this.px[y * this.w + x] = c; return; }
    if (a === 0) return;
    const i = y * this.w + x, d = this.px[i], t = a / 255;
    const da = A(d);
    if (da === 0) { this.px[i] = c; return; }
    this.px[i] = rgba(R(d) + (R(c) - R(d)) * t, G(d) + (G(c) - G(d)) * t, B(d) + (B(c) - B(d)) * t, 255);
  }
  rect(x, y, w, h, c) {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this.px[j * this.w + i] = c;
  }
  hspan(x0, x1, y, c) {
    if (y < 0 || y >= this.h) return;
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    x0 = Math.max(0, x0); x1 = Math.min(this.w - 1, x1);
    for (let i = x0; i <= x1; i++) this.px[y * this.w + i] = c;
  }
  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.blend(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  // scanline convex/concave polygon fill, pts = [[x,y],...] (pixel-centre sampling, even-odd)
  poly(pts, c) {
    const op = A(c) === 255;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const y0 = Math.max(0, Math.ceil(minY - 0.5)), y1 = Math.min(this.h - 1, Math.floor(maxY - 0.5));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5; xs.length = 0;
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k] - 0.5), xb = Math.floor(xs[k + 1] - 0.5);
        for (let x = xa; x <= xb; x++) (op ? this.set(x, y, c) : this.blend(x, y, c));
      }
    }
  }
  ellipse(cx, cy, rx, ry, c, blend = false) {
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const hw = rx * Math.sqrt(1 - dy * dy);
      const xa = Math.ceil(cx - hw - 0.5), xb = Math.floor(cx + hw - 0.5);
      for (let x = xa; x <= xb; x++) blend ? this.blend(x, y, c) : this.set(x, y, c);
    }
  }
}

// Draw helpers on a plain 2D canvas context (integer-aligned fillRects only).
export function ellipseSpans(ctx, cx, cy, rx, ry, fill) {
  ctx.fillStyle = fill;
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const hw = rx * Math.sqrt(1 - dy * dy);
    const xa = Math.ceil(cx - hw - 0.5), xb = Math.floor(cx + hw - 0.5);
    if (xb >= xa) ctx.fillRect(xa, y, xb - xa + 1, 1);
  }
}
