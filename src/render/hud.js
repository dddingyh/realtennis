// In-canvas HUD (640x360): TV score bug, serve speed, last-shot panel, big calls, timing ring, connection icon.
import { RENDER } from '../config.js';
import { camera } from './camera.js';
import { drawPixText, textWidth, drawText, measureText } from './font.js';

const W = RENDER.width, H = RENDER.height;
const PANEL = '#0c1424', EDGE = '#3c4d70', GOLD = '#f2c230', WHITE = '#f4f4ee', DIM = '#8fa0c0';
const SHOT_CN = { flat: '平击', topspin: '上旋', slice: '切削', lob: '挑高', volley: '截击', smash: '高压', serve: '发球' };
const SIDE_CN = { fh: '正手', bh: '反手' };
const CALL_COL = { OUT: '#ff4d4d', FAULT: '#ffd23f', 'DOUBLE FAULT': '#ff7a3a', ACE: '#4de1ff', LET: '#ffffff', 'NOT UP': '#ffd23f', GAME: GOLD, SET: GOLD, MATCH: '#7dff9a', 'GAME SET MATCH': '#7dff9a' };

function ptsLabel(m, i) {
  const a = m.points[i], b = m.points[1 - i];
  if (m.isTiebreak) return String(a);
  if (a >= 3 && b >= 3) { if (a === b) return '40'; return a > b ? 'AD' : '40'; }
  return ['0', '15', '30', '40', '40'][Math.min(4, a)];
}

export class Hud {
  constructor() {
    this.calls = [];
    this.serveInfo = null;   // {kmh, t}
    this.t = 0;
    this.lastCallText = '';
  }

  onEvents(events, state) {
    for (const e of events) {
      if (e.type === 'call' && e.text) this.pushCall(e.text);
      else if (e.type === 'score' && (e.text === 'GAME' || e.text === 'SET' || e.text === 'MATCH')) this.pushCall(e.text === 'MATCH' ? 'GAME SET MATCH' : e.text, 1.9);
      else if (e.type === 'serve') this.serveInfo = { kmh: Math.round(e.speedKmh), t: 0, by: e.by };
    }
  }
  pushCall(text, dur = 1.5) { this.calls.push({ text, t: 0, dur }); if (this.calls.length > 3) this.calls.shift(); }

  panel(ctx, x, y, w, h) {
    ctx.fillStyle = '#05080f'; ctx.fillRect(x + 1, y + 1, w, h);
    ctx.fillStyle = PANEL; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = EDGE; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  }

  textFit(ctx, str, x, y, color, maxW) {
    if (/^[\x20-\x7e]*$/.test(str)) return drawPixText(ctx, str, x, y + 2, color, 1);
    return drawText(ctx, str, x, y - 1, color, 12);
  }

  draw(ctx, state, dt, ui = {}) {
    this.t += dt;
    const m = state.match;
    if (this.serveInfo) { this.serveInfo.t += dt; if (this.serveInfo.t > 4) this.serveInfo = null; }
    if (m && ui.hudOn !== false) this.scoreBug(ctx, state, ui);
    this.lastShot(ctx, state);
    this.timingRing(ctx, state, ui);
    this.callsDraw(ctx, dt);
    if (ui.phoneMode) this.phoneIcon(ctx, ui.phoneStatus);
  }

  scoreBug(ctx, state, ui) {
    const m = state.match, X = 6, Y = 6;
    const sets = m.sets || [];
    const colSet = 12, nameW = 46;
    const w = 6 + nameW + sets.length * colSet + 16 + 24;
    const rh = 15;
    this.panel(ctx, X, Y, w, rh * 2 + 2);
    for (let i = 0; i < 2; i++) {
      const y = Y + 1 + i * rh;
      const pl = state.players[i];
      if (i === 1) { ctx.fillStyle = EDGE; ctx.fillRect(X + 1, y, w - 2, 1); }
      // team colour bar
      ctx.fillStyle = pl.look?.shirt || '#fff'; ctx.fillRect(X + 1, y + (i ? 1 : 0), 3, rh - (i ? 1 : 0));
      // serve ball
      if (m.server === i) { ctx.fillStyle = '#d9f23a'; ctx.fillRect(X + 6, y + 6, 3, 3); ctx.fillStyle = '#7a9a10'; ctx.fillRect(X + 8, y + 8, 1, 1); }
      const nm = pl.name || (i ? 'AI' : 'YOU');
      this.textFit(ctx, nm, X + 12, y + 3, i === m.server ? WHITE : '#c4cfe4', nameW - 8);
      let cx = X + 6 + nameW;
      for (const s of sets) {
        const win = s[i] > s[1 - i];
        drawPixText(ctx, String(s[i]), cx + 3, y + 4, win ? WHITE : DIM, 1);
        cx += colSet;
      }
      // games (highlight)
      ctx.fillStyle = '#17315c'; ctx.fillRect(cx, y + (i ? 1 : 0), 16, rh - (i ? 1 : 0));
      drawPixText(ctx, String(m.games[i]), cx + 8 - (String(m.games[i]).length * 6 - 1) / 2 | 0, y + 4, WHITE, 1);
      cx += 16;
      // points
      ctx.fillStyle = GOLD; ctx.fillRect(cx, y + (i ? 1 : 0), 24, rh - (i ? 1 : 0));
      const pt = ptsLabel(m, i);
      drawPixText(ctx, pt, cx + 12 - ((pt.length * 6 - 1) / 2 | 0), y + 4, '#1a1a22', 1);
    }
    let yy = Y + rh * 2 + 5;
    if (m.faultCount === 1 && (m.phase === 'serve-prep' || m.phase === 'serving' || m.phase === 'rally')) {
      this.panel(ctx, X, yy, 62, 11); drawPixText(ctx, '2ND SERVE', X + 5, yy + 2, '#ffd23f', 1); yy += 14;
    }
    if (m.isTiebreak) { this.panel(ctx, X, yy, 50, 11); drawPixText(ctx, 'TIEBREAK', X + 4, yy + 2, GOLD, 1); yy += 14; }
    if (this.serveInfo) {
      const a = this.serveInfo.t > 3.2 ? 1 - (this.serveInfo.t - 3.2) / 0.8 : 1;
      if (a > 0.05) {
        ctx.globalAlpha = Math.max(0, a);
        const txt = `${this.serveInfo.kmh}`;
        this.panel(ctx, X, yy, 86, 14);
        drawPixText(ctx, 'SERVE', X + 5, yy + 4, DIM, 1);
        drawPixText(ctx, txt, X + 38, yy + 4, WHITE, 1);
        drawPixText(ctx, 'KM/H', X + 38 + textWidth(txt) + 4, yy + 4, DIM, 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  lastShot(ctx, state) {
    const ls = state.lastShot;
    if (!ls) return;
    const w = 128, h = 40, x = W - w - 6, y = H - h - 6;
    const mine = ls.by === 0;
    this.panel(ctx, x, y, w, h);
    ctx.fillStyle = mine ? (state.players[0].look?.shirt || '#e23d3d') : (state.players[1].look?.shirt || '#f2c230');
    ctx.fillRect(x + 1, y + 1, 3, h - 2);
    const cn = `${SHOT_CN[ls.shot] || ls.shot}${ls.side ? ' ' + (SIDE_CN[ls.side] || '') : ''}`;
    drawText(ctx, cn, x + 9, y + 3, WHITE, 12, { shadow: '#000' });
    const who = mine ? 'YOU' : 'OPP';
    drawPixText(ctx, who, x + w - 22, y + 6, mine ? '#ff8a8a' : '#ffe27a', 1);
    drawPixText(ctx, String(Math.round(ls.speedKmh)), x + 9, y + 20, WHITE, 1);
    drawPixText(ctx, 'KM/H', x + 9 + textWidth(String(Math.round(ls.speedKmh))) + 3, y + 20, DIM, 1);
    drawPixText(ctx, String(Math.round(ls.spinRpm / 10) * 10), x + 68, y + 20, WHITE, 1);
    drawPixText(ctx, 'RPM', x + 68 + textWidth(String(Math.round(ls.spinRpm / 10) * 10)) + 3, y + 20, DIM, 1);
    // quality bar
    const q = Math.max(0, Math.min(1, ls.quality || 0)), bw = 110, bx = x + 9, by = y + h - 9;
    ctx.fillStyle = '#1a2640'; ctx.fillRect(bx, by, bw, 5);
    const segs = 22;
    for (let i = 0; i < segs; i++) {
      if (i / segs >= q) break;
      const f = i / segs;
      ctx.fillStyle = f < 0.35 ? '#e4534a' : f < 0.65 ? '#f2c230' : '#5ee07a';
      ctx.fillRect(bx + 1 + i * 5, by + 1, 4, 3);
    }
  }

  timingRing(ctx, state, ui) {
    const h = state.hint, b = state.ball;
    if (ui.timingRing === false || !h || !h.reachable || h.contactIn == null || !b.visible) return;
    const p = camera.project(b.pos.x, b.pos.y, b.pos.z);
    const ci = Math.max(0, h.contactIn);
    const r = Math.round(4 + Math.min(1, ci / 0.6) * 22);
    const good = ci < 0.09;
    const col = good ? '#5dff8a' : ci < 0.25 ? '#ffe45c' : '#ffffff';
    ctx.fillStyle = col;
    ctx.globalAlpha = good ? 1 : 0.85;
    this.ring(ctx, Math.round(p.sx), Math.round(p.sy), r, 1);
    ctx.globalAlpha = 0.5; this.ring(ctx, Math.round(p.sx), Math.round(p.sy), 5, 2);
    ctx.globalAlpha = 1;
  }
  ring(ctx, cx, cy, r, skip) {
    let x = r, y = 0, err = 1 - r, n = 0;
    const pl = (px, py) => { if (!skip || ((px + py) & 1) === 0) ctx.fillRect(cx + px, cy + py, 1, 1); };
    while (x >= y) {
      pl(x, y); pl(y, x); pl(-y, x); pl(-x, y); pl(-x, -y); pl(-y, -x); pl(y, -x); pl(x, -y);
      y++; if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }

  callsDraw(ctx, dt) {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i]; c.t += dt;
      if (c.t > c.dur) { this.calls.splice(i, 1); continue; }
    }
    const c = this.calls[this.calls.length - 1];
    if (!c) return;
    const pop = Math.min(1, c.t / 0.14);
    const scale = c.text.length > 9 ? 3 : 4;
    const sc = c.t < 0.14 ? scale + 1 : scale;
    const col = CALL_COL[c.text] || '#fff';
    const w = textWidth(c.text, sc), x = Math.round((W - w) / 2), y = 66;
    const fade = c.t > c.dur - 0.3 ? Math.max(0, (c.dur - c.t) / 0.3) : 1;
    ctx.globalAlpha = fade;
    // plate
    ctx.fillStyle = 'rgba(8,12,22,0.55)'; ctx.fillRect(x - 10, y - 6, w + 20, 7 * sc + 12);
    drawPixText(ctx, c.text, x, y, col, sc, { outline: '#0a0a12' });
    ctx.globalAlpha = 1;
  }

  phoneIcon(ctx, status) {
    const x = W - 26, y = 8;
    const col = status === 'connected' ? '#5dff8a' : status === 'connecting' ? '#ffe45c' : '#ff6b6b';
    ctx.fillStyle = '#05080f'; ctx.fillRect(x - 1, y - 1, 20, 17);
    ctx.fillStyle = PANEL; ctx.fillRect(x - 2, y - 2, 20, 17);
    ctx.fillStyle = EDGE; ctx.fillRect(x - 2, y - 2, 20, 1); ctx.fillRect(x - 2, y + 14, 20, 1); ctx.fillRect(x - 2, y - 2, 1, 17); ctx.fillRect(x + 17, y - 2, 1, 17);
    // phone glyph
    ctx.fillStyle = '#cfd8ea'; ctx.fillRect(x + 1, y, 7, 12); ctx.fillStyle = '#18233a'; ctx.fillRect(x + 2, y + 1, 5, 9);
    ctx.fillStyle = col; ctx.fillRect(x + 11, y + 4, 4, 4);
    ctx.fillStyle = '#05080f'; ctx.fillRect(x + 11, y + 4, 1, 1);
  }
}
