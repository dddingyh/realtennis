// Procedural canvas textures for the court surface, net, boards, LED, sky.
import * as THREE from 'three';
import { COURT } from '../../../src/config.js';
import { THEMES, SPONSORS } from '../../../src/render/stage.js';
import { canvasTex, mulberry32, speckle, roundRect } from './gfx.js';

export const VENUE = Object.freeze({ BX: 10.5, BZ: 18.4, PPM: 72 });

export const TOURNEY = {
  hard: { name: 'HARBOR OPEN', sub: '港湾公开赛' },
  clay: { name: 'TERRA CLASSIC', sub: '红土经典赛' },
  grass: { name: 'GREENFIELD CHAMPIONSHIPS', sub: '绿茵锦标赛' },
};

export const SURF_LOOK = {
  hard: { court: '#2f6db4', surround: '#7f97ad', line: '#f6f8fa', dust: '#c9d4de', mark: '#1d4a80', bounce: '#e8eef5' },
  clay: { court: '#cc6a41', surround: '#bd5f38', line: '#f3eee2', dust: '#e0805a', mark: '#a64a28', bounce: '#e7a07f' },
  grass: { court: '#5aa846', surround: '#4f9a3f', line: '#f2f4e6', dust: '#9ed07a', mark: '#3f7f31', bounce: '#8ec968' },
};

/** Court texture covering x ±BX, z ±BZ (canvas top = far end, z = -BZ). */
export function makeCourtTexture(surface) {
  const { BX, BZ, PPM } = VENUE;
  const W = Math.round(BX * 2 * PPM), H = Math.round(BZ * 2 * PPM);
  const L = SURF_LOOK[surface];
  const rnd = mulberry32(11 + surface.length);
  return canvasTex(W, H, (g) => {
    const X = (x) => (x + BX) * PPM, Z = (z) => (z + BZ) * PPM;
    const R = (x0, z0, x1, z1) => g.fillRect(X(x0), Z(z0), (x1 - x0) * PPM, (z1 - z0) * PPM);
    const hl = COURT.halfLength, dw = COURT.doublesHalfWidth, sw = COURT.singlesHalfWidth, sl = COURT.serviceLineDist;
    // ---- base
    g.fillStyle = L.surround; g.fillRect(0, 0, W, H);
    if (surface === 'hard') {
      const th = THEMES.hard;
      g.fillStyle = th.accent; R(-7.5 - 0.14, -15.2 - 0.14, 7.5 + 0.14, 15.2 + 0.14);
      g.fillStyle = L.court; R(-7.5, -15.2, 7.5, 15.2);
      // soft pools of lighter/darker paint
      for (let i = 0; i < 26; i++) {
        const x = rnd() * W, y = rnd() * H, r = 80 + rnd() * 220;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rnd() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,10,40,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      speckle(g, rnd, 0, 0, W, H, 26000, ['#ffffff', '#0a2a55', '#6aa0d8'], 1.4, 0.07);
      // painted sponsor wordmarks behind each baseline
      for (const zz of [-16.7, 16.7]) {
        g.save(); g.globalAlpha = 0.17; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `900 ${PPM * 0.75}px Arial Black, Arial, sans-serif`;
        g.translate(X(0), Z(zz)); g.fillText('KORVA', 0, 0); g.restore();
      }
    } else if (surface === 'clay') {
      g.fillStyle = L.court; R(-9.4, -16.4, 9.4, 16.4);
      for (let i = 0; i < 90; i++) { // brush sweeps
        g.strokeStyle = rnd() < 0.5 ? 'rgba(255,225,190,0.04)' : 'rgba(110,40,15,0.045)';
        g.lineWidth = 4 + rnd() * 22; g.beginPath();
        const x0 = rnd() * W, y0 = rnd() * H, len = 300 + rnd() * 900, bend = (rnd() - 0.5) * 220;
        g.moveTo(x0, y0); g.quadraticCurveTo(x0 + bend, y0 + len * 0.5, x0 + bend * 0.4, y0 + len); g.stroke();
      }
      for (let i = 0; i < 40; i++) { // worn patches
        const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 180;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rnd() < 0.5 ? 'rgba(240,160,120,0.10)' : 'rgba(120,40,20,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (const s of [-1, 1]) { // baseline wear
        const gr = g.createRadialGradient(X(0), Z(s * (hl + 0.6)), 0, X(0), Z(s * (hl + 0.6)), PPM * 4);
        gr.addColorStop(0, 'rgba(110,40,20,0.22)'); gr.addColorStop(1, 'rgba(110,40,20,0)');
        g.save(); g.translate(0, 0); g.fillStyle = gr; g.fillRect(X(-5), Z(s * (hl + 0.6)) - PPM * 4, PPM * 10, PPM * 8); g.restore();
      }
      speckle(g, rnd, 0, 0, W, H, 60000, ['#e89a72', '#8c3a1c', '#f0b896', '#a64a28'], 1.6, 0.16);
    } else { // grass
      g.fillStyle = L.court; g.fillRect(0, 0, W, H);
      const band = 2.2 * PPM;
      for (let x = -4; x * band < W + band; x++) {
        g.fillStyle = (x & 1) ? 'rgba(255,255,200,0.07)' : 'rgba(0,50,0,0.07)';
        g.fillRect(x * band + (W / 2 % band), 0, band, H);
      }
      // cross-mow shading near the edges
      g.fillStyle = 'rgba(20,70,20,0.18)'; g.fillRect(0, 0, X(-8.6), H); g.fillRect(X(8.6), 0, W, H); g.fillRect(0, 0, W, Z(-15.4)); g.fillRect(0, Z(15.4), W, H);
      for (const s of [-1, 1]) { // worn baseline + service-line patches
        for (const [cx, cz, rx, rz, a] of [[0, s * (hl + 0.3), 2.6, 1.5, 0.55], [0, s * (hl - 1.4), 1.6, 1.0, 0.25], [-2.2, s * (hl - 0.3), 1.2, 0.8, 0.3], [2.2, s * (hl - 0.3), 1.2, 0.8, 0.3], [0, s * (sl - 0.3), 1.8, 0.7, 0.18]]) {
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
          gr.addColorStop(0, `rgba(176,148,86,${a})`); gr.addColorStop(0.6, `rgba(150,130,70,${a * 0.5})`); gr.addColorStop(1, 'rgba(150,130,70,0)');
          g.save(); g.translate(X(cx), Z(cz)); g.scale(rx * PPM, rz * PPM); g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore();
        }
      }
      speckle(g, rnd, 0, 0, W, H, 90000, ['#74c25c', '#3c8a30', '#8fd070', '#2f7a2a'], 1.3, 0.2);
      g.strokeStyle = 'rgba(30,90,30,0.18)'; g.lineWidth = 1;
      for (let i = 0; i < 9000; i++) { const x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y - 4 - rnd() * 4); g.stroke(); }
    }
    // ---- lines (outer edge on the court boundary, lines count as "in")
    g.fillStyle = L.line;
    const lw = COURT.lineWidth, bw = 0.09;
    R(-dw, -hl, -dw + lw, hl); R(dw - lw, -hl, dw, hl);                 // doubles sidelines
    R(-sw, -hl, -sw + lw, hl); R(sw - lw, -hl, sw, hl);                 // singles sidelines
    R(-dw, -hl, dw, -hl + bw); R(-dw, hl - bw, dw, hl);                 // baselines
    R(-sw, -sl, sw, -sl + lw); R(-sw, sl - lw, sw, sl);                 // service lines
    R(-lw / 2, -sl, lw / 2, sl);                                        // centre service line
    R(-lw / 2, -hl, lw / 2, -hl + bw + 0.1); R(-lw / 2, hl - bw - 0.1, lw / 2, hl); // centre marks
    // dusty / worn finish on the lines
    const lineDust = surface === 'clay' ? ['#d8a58a', '#c97f5c'] : surface === 'grass' ? ['#b8c8a0', '#8fb070'] : ['#c4d0dc', '#9fb4c8'];
    for (const [x0, z0, x1, z1] of [[-dw, -hl, -dw + lw, hl], [dw - lw, -hl, dw, hl], [-sw, -hl, -sw + lw, hl], [sw - lw, -hl, sw, hl], [-dw, -hl, dw, -hl + bw], [-dw, hl - bw, dw, hl], [-sw, -sl, sw, -sl + lw], [-sw, sl - lw, sw, sl], [-lw / 2, -sl, lw / 2, sl]]) {
      const n = Math.round(((x1 - x0) + (z1 - z0)) * (surface === 'clay' ? 220 : 90));
      speckle(g, rnd, X(x0), Z(z0), (x1 - x0) * PPM, (z1 - z0) * PPM, n, lineDust, 1.4, surface === 'clay' ? 0.55 : 0.3);
    }
  });
}

/** Net mesh + white band with a made-up wordmark. Canvas covers 12.8 m x 1.07 m. */
export function makeNetTexture(surface) {
  const th = THEMES[surface];
  return canvasTex(2048, 220, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(30,36,48,0.5)'; g.lineWidth = 1.3;
    const cell = 6.4;
    for (let x = 0; x < W; x += cell) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += cell) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // top band (image top = net top)
    const bh = 26;
    g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, W, bh);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, bh - 3, W, 3);
    g.fillStyle = th.wall; g.font = '800 17px Arial Black, Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    for (let x = 180; x < W; x += 340) { if (Math.abs(x - W / 2) < 40) continue; g.fillText('KORVA', x, bh / 2 + 1); }
    // centre strap
    g.fillStyle = '#f7f7f4'; g.fillRect(W / 2 - 7, 0, 14, H);
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(W / 2 + 4, 0, 3, H);
    // bottom cord
    g.fillStyle = 'rgba(240,240,236,0.9)'; g.fillRect(0, H - 6, W, 6);
  }, { aniso: true });
}

/** One continuous wall band in the theme colour with a few tone-on-tone wordmarks (symmetrical). kind: 'end' | 'side' | 'fascia' */
export function makeWallTexture(surface, lenM, hM, kind) {
  const th = THEMES[surface];
  const ppm = kind === 'fascia' ? 64 : 92;
  const W = Math.min(4096, Math.round(lenM * ppm)), H = Math.round(hM * ppm), k = W / lenM;
  const [A, B] = th.brands;
  return canvasTex(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, th.wallLite); gr.addColorStop(0.35, th.wall); gr.addColorStop(1, th.wall);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, H * 0.06, W, Math.max(2, H * 0.03));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const mark = (txt, xm, size, alpha, accent) => {
      g.save(); g.translate(W / 2 + xm * k, H * 0.5); g.globalAlpha = alpha; g.fillStyle = accent ? th.accent : '#ffffff';
      g.font = `900 ${Math.round(size * k)}px Arial Black, Arial, sans-serif`; g.fillText(txt, 0, 0); g.restore();
    };
    if (kind === 'fascia') {
      mark(TOURNEY[surface].name, 0, 0.5, 0.22, false); return;
    }
    const big = Math.min(0.46 * hM / 1.0, 0.62);
    const tn = TOURNEY[surface].name; const tsz = tn.length > 14 ? big * 0.62 : big;
    mark(tn, 0, tsz, 0.93, false);
    g.save(); g.globalAlpha = 0.8; g.fillStyle = th.accent; g.font = `800 ${Math.round(0.17 * k)}px sans-serif`; g.fillText(TOURNEY[surface].sub, W / 2, H * 0.5 + tsz * 0.62 * k + 2); g.restore();
    const pos = kind === 'end' ? [[6.3, A, 0.4]] : [[7.5, A, 0.36], [14, B, 0.34]];
    for (const [x, name, sz] of pos) for (const sg of [-1, 1]) mark(name, sg * x, sz, 0.5, false);
  });
}
function wrapFill(g, text, cx, cy, maxW, lh) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur);
  lines.forEach((l, i) => g.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * lh));
}

/** Soft-cloud sky gradient for the dome (equirect-ish: v = elevation). */
export function makeSkyTexture() {
  const rnd = mulberry32(99);
  return canvasTex(1024, 512, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#2f7fd6'); gr.addColorStop(0.45, '#6fb3ee'); gr.addColorStop(0.5, '#a9d6f7'); gr.addColorStop(0.62, '#dff1fb'); gr.addColorStop(1, '#eef7ee');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 46; i++) {
      const cx = rnd() * W, cy = H * (0.28 + rnd() * 0.22), s = 24 + rnd() * 56;
      for (let k = 0; k < 7; k++) {
        const ox = (rnd() - 0.5) * s * 2.2, oy = (rnd() - 0.5) * s * 0.35, r = s * (0.45 + rnd() * 0.45);
        const rg = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        rg.addColorStop(0, 'rgba(255,255,255,0.92)'); rg.addColorStop(0.6, 'rgba(255,255,255,0.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
      }
    }
  }, { aniso: false });
}
