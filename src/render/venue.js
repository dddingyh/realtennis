// Show-court "immersion" details:
//  - static extra layers (photographers' pits, TV camera + operator, towel boxes, shot-clock housings)
//  - per-frame dynamics: back-wall LED ribbon with live data, serve shot clocks driven by the match phase.
import { camera } from './camera.js';
import { STAGE, THEMES } from './stage.js';
import { LED_RECT } from './court.js';
import { PixBuf, hex, rgba, shade } from './raster.js';
import { drawPixText, textWidth } from './font.js';
import { box3, quad3 } from './props.js';

const W = camera.W, H = camera.H;
const { ZB } = STAGE;
const P = (x, y, z) => camera.project(x, y, z);

// shot clocks: one at each end, on a low stand at the left back corner (faces the server)
export const CLOCKS = [
  { id: 'far', x: -7.75, z: -ZB + 0.55, y0: 0.62, w: 0.62, h: 0.36 },
  { id: 'near', x: -7.6, z: 14.7, y0: 0.62, w: 0.62, h: 0.36 },
];
function clockRect(c) {
  const p = P(c.x, c.y0 + c.h / 2, c.z), k = p.scale;
  const w = Math.round(c.w * k), h = Math.round(c.h * k);
  return { x: Math.round(p.sx - w / 2), y: Math.round(p.sy - h / 2), w, h, k, base: P(c.x, 0, c.z) };
}

function drawClockHousing(pb, c) {
  const r = clockRect(c);
  const pole = Math.max(2, Math.round(0.05 * r.k));
  const bx = Math.round(r.base.sx - pole / 2);
  pb.ellipse(Math.round(r.base.sx) + 1, Math.round(r.base.sy), Math.max(3, r.w * 0.45), Math.max(1, r.k * 0.06), rgba(0, 0, 0, 70), true);
  pb.rect(bx, r.y + r.h, pole, Math.round(r.base.sy) - r.y - r.h, hex('#2a2f3a'));
  pb.rect(bx, r.y + r.h, 1, Math.round(r.base.sy) - r.y - r.h, hex('#4a5264'));
  pb.rect(Math.round(r.base.sx) - pole * 2, Math.round(r.base.sy) - 1, pole * 4, 2, hex('#1b1e26'));
  // bezel + dark face
  pb.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, hex('#0b0d12'));
  pb.rect(r.x, r.y, r.w, r.h, hex('#141820'));
  pb.rect(r.x, r.y, r.w, 1, hex('#3a4252'));
}

function photographer(pb, x, z, lensCol, bib) {
  // crouched behind the pit wall: shoulders/head/camera with a long lens pointed at the court (seen front-on)
  const p = P(x, 0.62, z), k = p.scale, m = (v) => Math.max(1, Math.round(v * k));
  const cx = Math.round(p.sx), top = Math.round(p.sy);
  pb.rect(cx - m(0.2), top - m(0.3), m(0.4), m(0.32), hex(bib));                  // torso / bib
  pb.rect(cx - m(0.2), top - m(0.3), m(0.4), 1, shade(hex(bib), 1.2));
  pb.rect(cx - m(0.08), top - m(0.3) - m(0.18), m(0.17), m(0.18), hex('#d9a77d')); // head
  pb.rect(cx - m(0.08), top - m(0.3) - m(0.18), m(0.17), Math.max(1, m(0.05)), hex('#2a1d12'));
  // camera body + lens (white telephoto seen from the front)
  const lx = cx + m(0.02), ly = top - m(0.3) - m(0.04);
  pb.rect(lx - m(0.09), ly - m(0.05), m(0.18), m(0.1), hex('#15161b'));
  const r = Math.max(2, Math.round(0.065 * k));
  pb.ellipse(lx, ly + m(0.03), r + 1, r + 1, hex('#15161b'));
  pb.ellipse(lx, ly + m(0.03), r, r, hex(lensCol));
  pb.ellipse(lx, ly + m(0.03), Math.max(1, r - 1), Math.max(1, r - 1), hex('#2a3140'));
}

function tvCamera(pb, x, z) {
  const k = P(x, 0, z).scale, m = (v) => Math.max(1, Math.round(v * k));
  // operator (behind the camera): dark clothes, headset
  const o = P(x + 0.05, 0, z - 0.45), ox = Math.round(o.sx), oy = Math.round(o.sy);
  pb.rect(ox - m(0.16), oy - m(0.85), m(0.13), m(0.85), hex('#1c1f27')); pb.rect(ox + m(0.03), oy - m(0.85), m(0.13), m(0.85), hex('#1c1f27'));
  pb.rect(ox - m(0.2), oy - m(1.45), m(0.4), m(0.62), hex('#23262e'));
  pb.rect(ox - m(0.2), oy - m(1.45), 1, m(0.62), hex('#3a404e'));
  pb.rect(ox - m(0.08), oy - m(1.45) - m(0.21), m(0.17), m(0.21), hex('#e0a97c'));
  pb.rect(ox - m(0.08), oy - m(1.45) - m(0.21), m(0.17), Math.max(1, m(0.06)), hex('#3b2415'));
  pb.rect(ox - m(0.1), oy - m(1.45) - m(0.16), m(0.21), 1, hex('#0b0d12'));        // headset band
  // tripod
  const t = P(x, 0, z), tx = Math.round(t.sx), ty = Math.round(t.sy), head = ty - m(1.25);
  pb.line(tx, head, tx - m(0.35), ty, hex('#2a2f3a')); pb.line(tx, head, tx + m(0.35), ty, hex('#2a2f3a')); pb.line(tx, head, tx, ty + 1, hex('#3a404e'));
  // camera body with lens facing the court (toward the viewer)
  box3(pb, x - 0.2, x + 0.2, 1.25, 1.55, z - 0.35, z + 0.15, '#2a2f3a', { top: '#4a5264', end: '#1b1e26', side: '#23262e' });
  const lp = P(x, 1.4, z + 0.3), lr = Math.max(3, Math.round(0.11 * k));
  pb.ellipse(Math.round(lp.sx), Math.round(lp.sy), lr + 1, lr + 1, hex('#0b0d12'));
  pb.ellipse(Math.round(lp.sx), Math.round(lp.sy), lr, lr, hex('#3a404e'));
  pb.ellipse(Math.round(lp.sx), Math.round(lp.sy), Math.max(1, lr - 2), Math.max(1, lr - 2), hex('#0e1a2a'));
  pb.set(Math.round(lp.sx) - 1, Math.round(lp.sy) - 1, hex('#8fb3e0'));
  // tally light + viewfinder
  const vf = P(x - 0.22, 1.6, z - 0.1);
  pb.rect(Math.round(vf.sx) - m(0.06), Math.round(vf.sy) - m(0.06), m(0.12), m(0.09), hex('#1b1e26'));
  const tl = P(x + 0.12, 1.57, z + 0.1); pb.rect(Math.round(tl.sx), Math.round(tl.sy), 2, 1, hex('#ff3a2a'));
}

function towelBox(pb, x, z, TH) {
  box3(pb, x - 0.2, x + 0.2, 0, 0.62, z - 0.18, z + 0.18, TH.wallLite, { top: '#f2f2ea' });
  box3(pb, x - 0.17, x + 0.17, 0.62, 0.68, z - 0.15, z + 0.15, '#f2f2ea', { top: '#ffffff', end: '#d9dce2', side: '#e6e6df' });
}

// static layer drawn after the back-wall LED (things standing in front of the back wall)
export function buildBackLayer(surface) {
  const TH = THEMES[surface] || THEMES.hard;
  const pb = new PixBuf(W, H);
  const pitZ = -ZB + 1.45;
  for (const sg of [-1, 1]) {
    // photographers first (behind the pit wall), then the low wall in the theme colour
    const xs = sg > 0 ? [9.2, 9.75, 10.35] : [-9.25, -9.85, -10.4];
    const bibs = ['#e86a3a', '#2f6fd0', '#e86a3a'];
    xs.forEach((x, i) => photographer(pb, x, -ZB + 0.75, i === 1 ? '#15161b' : '#eeeeea', bibs[i]));
    box3(pb, sg > 0 ? 8.75 : -10.95, sg > 0 ? 10.95 : -8.75, 0, 0.6, pitZ - 0.12, pitZ, TH.wall, { end: shade(hex(TH.wall), 0.9), top: TH.wallLite });
    quad3(pb, [[sg > 0 ? 8.75 : -10.95, 0.5, pitZ + 0.001], [sg > 0 ? 10.95 : -8.75, 0.5, pitZ + 0.001], [sg > 0 ? 10.95 : -8.75, 0.53, pitZ + 0.001], [sg > 0 ? 8.75 : -10.95, 0.53, pitZ + 0.001]], hex(TH.accent));
    towelBox(pb, sg * 6.75, -ZB + 0.75, TH);
  }
  tvCamera(pb, 0.15, -ZB + 1.1);
  drawClockHousing(pb, CLOCKS[0]);
  return pb;
}

// static layer for the near end (drawn in the depth sort at FRONT_Z): shot clock
export const FRONT_Z = 14.6;
export function buildFrontLayer(surface) {
  const TH = THEMES[surface] || THEMES.hard;
  const pb = new PixBuf(W, H);
  drawClockHousing(pb, CLOCKS[1]);
  return pb;
}

function ptsLabel(m, i) {
  const a = m.points?.[i] ?? 0, b = m.points?.[1 - i] ?? 0;
  if (m.isTiebreak) return String(a);
  if (a >= 3 && b >= 3) return a === b ? '40' : a > b ? 'AD' : '40';
  return ['0', '15', '30', '40', '40'][Math.min(4, a)];
}

// crop a mostly-transparent full-screen layer to its bounding box so per-frame blits stay cheap
export function cropLayer(pb) {
  const { w, h, px } = pb;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const c = document.createElement('canvas');
  if (x1 < 0) { c.width = c.height = 1; return { canvas: c, x: 0, y: 0 }; }
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  pb.flush();
  c.getContext('2d').drawImage(pb.canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return { canvas: c, x: x0, y: y0 };
}

export class VenueDynamics {
  constructor() {
    this.surface = 'hard';
    this.led = document.createElement('canvas');
    this.led.width = LED_RECT.w; this.led.height = LED_RECT.h;
    this.ledKey = '';
    this.serveKmh = null; this.serveBy = 0;
    this.phase = null; this.phaseStart = 0; this.clockVal = null;
    this.rot = 0; this.flash = 0;
  }
  setSurface(s) { this.surface = s; this.ledKey = ''; }
  onEvents(events) {
    for (const e of events) {
      if (e.type === 'serve' && e.speedKmh) { this.serveKmh = Math.round(e.speedKmh); this.serveBy = e.by; this.flash = 2.5; }
    }
  }
  update(state, dt) {
    const m = state.match || {}, t = state.time || 0;
    if (m.phase !== this.phase) { this.phase = m.phase; this.phaseStart = t; }
    if (m.phase === 'serve-prep') this.clockVal = Math.max(0, Math.ceil(25 - (t - this.phaseStart)));
    else if (m.phase === 'point-over' || m.phase === 'changeover' || m.phase === 'match-over') this.clockVal = null;
    this.rot += dt; this.flash = Math.max(0, this.flash - dt);
  }

  ledMessages(state) {
    const m = state.match || {}, st = m.stats || {}, pl = state.players || [];
    const nm = (i) => (/^[\x20-\x7e]+$/.test(pl[i]?.name || '') ? pl[i].name : (i === 0 ? 'P1' : 'P2')).toUpperCase().slice(0, 8);
    const out = [];
    const sets = (m.sets || []).map((s) => `${s[0]}-${s[1]}`).join(' ');
    out.push(`${nm(0)} V ${nm(1)}${sets ? '  SETS ' + sets : ''}  GAMES ${m.games?.[0] ?? 0}-${m.games?.[1] ?? 0}  ${ptsLabel(m, 0)}-${ptsLabel(m, 1)}`);
    if (this.serveKmh) out.push(`${this.serveBy === 0 ? nm(0) : nm(1)} SERVE ${this.serveKmh} KM/H`);
    const slot = Math.floor(this.rot / 6) % 3;
    if (slot === 0 && st.aces && (st.aces[0] || st.aces[1])) out.push(`ACES ${st.aces[0] ?? 0}-${st.aces[1] ?? 0}`);
    else if (slot === 1 && st.firstServePct && (st.firstServePct[0] || st.firstServePct[1])) out.push(`1ST SERVE ${Math.round(st.firstServePct[0] || 0)}%-${Math.round(st.firstServePct[1] || 0)}%`);
    else if (slot === 2 && st.maxServeKmh && (st.maxServeKmh[0] || st.maxServeKmh[1])) out.push(`FASTEST ${Math.round(Math.max(st.maxServeKmh[0] || 0, st.maxServeKmh[1] || 0))} KM/H`);
    out.push(THEMES[this.surface].brands[0]);
    return out;
  }

  drawLED(ctx, state) {
    const msgs = this.ledMessages(state);
    const hot = this.flash > 0 && Math.floor(this.flash * 4) % 2 === 0;
    const key = msgs.join('|') + (hot ? '*' : '');
    if (key !== this.ledKey) {
      this.ledKey = key;
      const g = this.led.getContext('2d');
      const w = LED_RECT.w, h = LED_RECT.h;
      g.fillStyle = '#07090e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#10141c';
      for (let y = 1; y < h - 1; y++) for (let x = (y & 1); x < w; x += 2) g.fillRect(x, y, 1, 1);
      g.fillStyle = '#2a3140'; g.fillRect(0, 0, w, 1);
      const col = THEMES[this.surface].led;
      const ty = Math.floor((h - 7) / 2);
      // lay the messages out across the ribbon, separated by small diamonds, repeating to fill it
      let x = 8, i = 0, guard = 0;
      while (x < w && guard++ < 40) {
        const msg = msgs[i % msgs.length];
        const isServe = msg.includes('SERVE') && !msg.includes('%');
        drawPixText(g, msg, x, ty, isServe && hot ? '#ffffff' : col, 1);
        x += textWidth(msg) + 14;
        g.fillStyle = col; g.fillRect(x - 8, ty + 3, 2, 1); g.fillRect(x - 7, ty + 2, 1, 3);
        i++;
      }
    }
    ctx.drawImage(this.led, LED_RECT.x, LED_RECT.y);
  }

  drawClock(ctx, idx) {
    const c = CLOCKS[idx], r = clockRect(c);
    const v = this.clockVal;
    const big = r.h >= 18;
    const txt = v == null ? '--' : String(v).padStart(2, '0');
    const col = v == null ? '#3a3f4a' : v <= 5 ? '#ff4a3a' : '#ffd25a';
    const key = `${txt}|${col}|${big}`;
    this.clockCache = this.clockCache || new Map();
    let img = this.clockCache.get(key);
    if (!img) {
      const font = big ? 'big' : 'small', fh = big ? 14 : 7;
      img = document.createElement('canvas');
      img.width = textWidth('88', 1, font); img.height = fh;
      const g = img.getContext('2d');
      drawPixText(g, '88', 0, 0, '#1d222c', 1, { font });          // unlit segments
      drawPixText(g, txt, Math.round((img.width - textWidth(txt, 1, font)) / 2), 0, col, 1, { font });
      this.clockCache.set(key, img);
    }
    ctx.drawImage(img, Math.round(r.x + (r.w - img.width) / 2), Math.round(r.y + (r.h - img.height) / 2));
  }
}
