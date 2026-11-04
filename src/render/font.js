// Pixel bitmap font (5x7, Latin+digits) defined in code, plus crisp CJK text via binarised system-font rasterisation.
const G5 = {
  A: [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11], B: [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  C: [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E], D: [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
  E: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F], F: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  G: [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F], H: [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  I: [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  M: [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], P: [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  Q: [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D], R: [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  S: [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E], T: [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A], X: [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04], Z: [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
  0: [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], 1: [0x04, 0x0C, 0x14, 0x04, 0x04, 0x04, 0x1F],
  2: [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F], 3: [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
  4: [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], 5: [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  6: [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E], 7: [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E], 9: [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  '-': [0, 0, 0, 0x1F, 0, 0, 0], ':': [0, 0x04, 0x04, 0, 0x04, 0x04, 0], '.': [0, 0, 0, 0, 0, 0x0C, 0x0C],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04], '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03], "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '+': [0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0], ' ': [0, 0, 0, 0, 0, 0, 0], '?': [0x0E, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08], '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  '&': [0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D], '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02], ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
};

// Second, larger pixel font (10x14): the 5x7 glyphs upscaled with EPX/Scale2x so diagonals and curves are
// smoothed instead of blocky. Used for the HUD score bug, big calls and sponsor lettering.
function epx(rows, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : (rows[y] >> (w - 1 - x)) & 1;
  const out = new Array(h * 2).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = at(x, y), A = at(x, y - 1), Bv = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
    let p1 = P, p2 = P, p3 = P, p4 = P;
    if (C === A && C !== D && A !== Bv) p1 = A;
    if (A === Bv && A !== C && Bv !== D) p2 = Bv;
    if (D === C && D !== Bv && C !== A) p3 = C;
    if (Bv === D && Bv !== A && D !== C) p4 = D;
    const W2 = w * 2;
    if (p1) out[y * 2] |= 1 << (W2 - 1 - x * 2);
    if (p2) out[y * 2] |= 1 << (W2 - 2 - x * 2);
    if (p3) out[y * 2 + 1] |= 1 << (W2 - 1 - x * 2);
    if (p4) out[y * 2 + 1] |= 1 << (W2 - 2 - x * 2);
  }
  return out;
}
const G10 = {};
for (const k in G5) G10[k] = epx(G5[k], 5, 7);
export const FONTS = {
  small: { g: G5, w: 5, h: 7, adv: 6 },
  big: { g: G10, w: 10, h: 14, adv: 12 },
};

export function textWidth(str, scale = 1, font = 'small') {
  const f = FONTS[font] || FONTS.small;
  return Math.max(0, String(str).length * f.adv - (f.adv - f.w)) * scale;
}
export function fontHeight(scale = 1, font = 'small') { return (FONTS[font] || FONTS.small).h * scale; }

// Draw text with a pixel font onto a PixBuf-like target {rect(x,y,w,h,c)} or CanvasRenderingContext2D.
// opts: { font: 'small'|'big', outline: colour, shadow: colour }
export function drawPixText(target, str, x, y, color, scale = 1, opts = {}) {
  str = String(str).toUpperCase();
  const f = FONTS[opts.font] || FONTS.small;
  const isCtx = typeof target.fillRect === 'function';
  const put = (px, py, w, h, c) => {
    if (isCtx) { target.fillStyle = c; target.fillRect(px, py, w, h); } else target.rect(px, py, w, h, c);
  };
  const draw = (ox, oy, c) => {
    let cx = x + ox;
    for (const ch of str) {
      const g = f.g[ch] || f.g['?'];
      for (let r = 0; r < f.h; r++) {
        const bits = g[r];
        if (!bits) continue;
        let c0 = -1;
        for (let b = 0; b <= f.w; b++) {
          const on = b < f.w && (bits >> (f.w - 1 - b)) & 1;
          if (on && c0 < 0) c0 = b;
          if (!on && c0 >= 0) { put(cx + c0 * scale, y + oy + r * scale, (b - c0) * scale, scale, c); c0 = -1; }
        }
      }
      cx += f.adv * scale;
    }
  };
  if (opts.outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) draw(dx * scale, dy * scale, opts.outline);
  } else if (opts.shadow) draw(scale, scale, opts.shadow);
  draw(0, 0, color);
  return textWidth(str, scale, opts.font);
}

// ---- CJK / arbitrary text: rasterise with the system font then threshold alpha -> crisp pixels ----
const maskCache = new Map();
const scratch = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
function getMask(str, size, bold) {
  const key = `${str}|${size}|${bold}`;
  let m = maskCache.get(key);
  if (m) return m;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  const font = `${bold ? 'bold ' : ''}${size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC","WenQuanYi Zen Hei","Hiragino Sans GB",sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(str).width) + 2, h = Math.ceil(size * 1.35);
  scratch.width = w; scratch.height = h;
  ctx.font = font; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
  ctx.fillText(str, 1, Math.round(size * 0.12));
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > 120) out.push(i, j);
  m = { w, h, pts: out };
  maskCache.set(key, m);
  return m;
}
export function measureText(str, size = 12, bold = false) { return getMask(str, size, bold).w - 2; }
const textCanvasCache = new Map();
// ctx: CanvasRenderingContext2D. Cached per (text,size,colour,effects) so it is a single drawImage per frame.
export function drawText(ctx, str, x, y, color = '#fff', size = 12, opts = {}) {
  const m = getMask(str, size, !!opts.bold);
  const key = `${str}|${size}|${color}|${opts.bold ? 1 : 0}|${opts.outline || ''}|${opts.shadow || ''}`;
  let c = textCanvasCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = m.w + 2; c.height = m.h + 2;
    const g = c.getContext('2d');
    const paint = (ox, oy, col) => {
      g.fillStyle = col;
      for (let k = 0; k < m.pts.length; k += 2) g.fillRect(1 + ox + m.pts[k] - 1, 1 + oy + m.pts[k + 1], 1, 1);
    };
    if (opts.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) paint(dx, dy, opts.outline);
    } else if (opts.shadow) paint(1, 1, opts.shadow);
    paint(0, 0, color);
    textCanvasCache.set(key, c);
  }
  ctx.drawImage(c, Math.round(x) - 1, Math.round(y) - 1);
  return m.w - 2;
}
