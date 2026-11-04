// In-canvas HUD (layout derived from RENDER size): TV score bug, serve speed, last-shot panel, big calls, timing ring, connection icon.
import { RENDER } from '../config.js';
import { camera } from './camera.js';
import { drawPixText, textWidth, drawText, measureText, fontHeight } from './font.js';

const W = RENDER.width, H = RENDER.height;
// UI scale relative to the original 360-line design; BIG = use the 10x14 pixel font for primary text.
const U = H / 360;
const BIG = H >= 480;
const FMAIN = BIG ? 'big' : 'small';
const u = (v) => Math.round(v * U);
const CJK = Math.round(12 * U);
const PANEL = '#0c1424', EDGE = '#3c4d70', GOLD = '#f2c230', WHITE = '#f4f4ee', DIM = '#8fa0c0';
const SHOT_CN = { flat: '平击', topspin: '上旋', slice: '切削', lob: '挑高', volley: '截击', smash: '高压', serve: '发球' };
const SIDE_CN = { fh: '正手', bh: '反手' };
const VARIANT_CN = { stretch: '救球', jammed: '被挤压', run: '跑动中', high: '高点', low: '低点', defensive: '防守' };
const MISHIT_CN = { frame: '打框' };   // any other truthy mishit -> 质量差
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
      if (e.type === 'hit') {
        this.hitVariant = { v: e.variant || e.anim?.variant || null, t: 0 };
        if (e.mishit) this.pushSmall(MISHIT_CN[e.mishit] || '质量差', e.mishit === 'frame' ? '#ffb347' : '#ff8a7a', e.by);
      }
    }
  }
  // small CJK call that floats above the hitting player for ~1 s
  pushSmall(text, color, by) { this.small = this.small || []; this.small.push({ text, color, by, t: 0 }); if (this.small.length > 2) this.small.shift(); }
  smallDraw(ctx, state, dt) {
    if (!this.small?.length) return;
    for (let i = this.small.length - 1; i >= 0; i--) { const c = this.small[i]; c.t += dt; if (c.t > 1.2) this.small.splice(i, 1); }
    for (const c of this.small) {
      const pl = state.players?.[c.by];
      let x = W / 2, y = u(110);
      if (pl?.pos) { const p = camera.project(pl.pos.x, 2.35, pl.pos.z); x = p.sx; y = p.sy - u(10); }
      const size = Math.round(CJK * (c.by === 0 ? 1.25 : 1.0));
      const w = measureText(c.text, size, true);
      const rise = Math.round(Math.min(1, c.t / 0.25) * u(8));
      ctx.globalAlpha = c.t > 0.9 ? Math.max(0, (1.2 - c.t) / 0.3) : 1;
      drawText(ctx, c.text, Math.round(x - w / 2), Math.round(y - rise - size), c.color, size, { bold: true, outline: '#0a0a12' });
      ctx.globalAlpha = 1;
    }
  }
  pushCall(text, dur = 1.5) { this.calls.push({ text, t: 0, dur }); if (this.calls.length > 3) this.calls.shift(); }

  panel(ctx, x, y, w, h) {
    const b = BIG ? 2 : 1;
    ctx.fillStyle = '#05080f'; ctx.fillRect(x + b, y + b, w, h);
    ctx.fillStyle = PANEL; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = EDGE; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    if (BIG) { ctx.fillStyle = '#1a2846'; ctx.fillRect(x + 1, y + 1, w - 2, 1); }
  }

  // primary text (names / digits): big pixel font; CJK through the binarised system font
  mainText(ctx, str, x, y, color, rowH) {
    if (/^[\x20-\x7e]*$/.test(str)) {
      const fh = fontHeight(1, FMAIN);
      return drawPixText(ctx, str, x, y + Math.round((rowH - fh) / 2), color, 1, { font: FMAIN });
    }
    return drawText(ctx, str, x, y + Math.round((rowH - CJK * 1.3) / 2), color, CJK, { bold: true });
  }
  mainW(str) { return textWidth(str, 1, FMAIN); }

  draw(ctx, state, dt, ui = {}) {
    this.t += dt; this._dt = dt;
    const m = state.match;
    if (this.serveInfo) { this.serveInfo.t += dt; if (this.serveInfo.t > 4) this.serveInfo = null; }
    if (m && ui.hudOn !== false) this.scoreBug(ctx, state, ui);
    this.lastShot(ctx, state);
    this.timingRing(ctx, state, ui);
    this.callsDraw(ctx, dt);
    this.smallDraw(ctx, state, dt);
    if (ui.phoneMode) this.phoneIcon(ctx, ui.phoneStatus);
  }

  scoreBug(ctx, state, ui) {
    const m = state.match, X = u(6), Y = u(6);
    const sets = m.sets || [];
    const rh = u(15) + (BIG ? 1 : 0);            // 23 px rows at 540p
    const colSet = u(12), nameW = u(48), gameW = u(16), ptsW = u(26), lead = u(14);
    const w = lead + nameW + sets.length * colSet + gameW + ptsW + 1;
    this.panel(ctx, X, Y, w, rh * 2 + 2);
    for (let i = 0; i < 2; i++) {
      const y = Y + 1 + i * rh;
      const pl = state.players[i];
      if (i === 1) { ctx.fillStyle = EDGE; ctx.fillRect(X + 1, y, w - 2, 1); }
      const top = y + (i ? 1 : 0), hh = rh - (i ? 1 : 0);
      ctx.fillStyle = pl.look?.shirt || '#fff'; ctx.fillRect(X + 1, top, u(3), hh);
      if (m.server === i) {
        const bx = X + u(6), by = y + Math.round(rh / 2) - 2, bs = BIG ? 5 : 3;
        ctx.fillStyle = '#1a2a10'; ctx.fillRect(bx - 1, by, bs + 2, bs); ctx.fillRect(bx, by - 1, bs, bs + 2);
        ctx.fillStyle = '#d9f23a'; ctx.fillRect(bx, by, bs, bs);
        ctx.fillStyle = '#fbffc4'; ctx.fillRect(bx, by, 1, 1);
        ctx.fillStyle = '#8cb31c'; ctx.fillRect(bx + bs - 1, by + bs - 1, 1, 1);
      }
      const nm = pl.name || (i ? 'AI' : 'YOU');
      this.mainText(ctx, nm, X + lead, y, i === m.server ? WHITE : '#c4cfe4', rh);
      let cx = X + lead + nameW;
      for (const st of sets) {
        const win = st[i] > st[1 - i];
        const t = String(st[i]);
        this.mainText(ctx, t, cx + Math.round((colSet - this.mainW(t)) / 2), y, win ? WHITE : DIM, rh);
        cx += colSet;
      }
      ctx.fillStyle = '#17315c'; ctx.fillRect(cx, top, gameW, hh);
      const g = String(m.games[i]);
      this.mainText(ctx, g, cx + Math.round((gameW - this.mainW(g)) / 2), y, WHITE, rh);
      cx += gameW;
      ctx.fillStyle = GOLD; ctx.fillRect(cx, top, ptsW, hh);
      if (BIG) { ctx.fillStyle = '#ffe07a'; ctx.fillRect(cx, top, ptsW, 1); }
      const pt = ptsLabel(m, i);
      this.mainText(ctx, pt, cx + Math.round((ptsW - this.mainW(pt)) / 2), y, '#1a1a22', rh);
    }
    let yy = Y + rh * 2 + u(5);
    const tagH = u(11) + (BIG ? 1 : 0);
    const tag = (text, col) => {
      const tw = textWidth(text) + u(10);
      this.panel(ctx, X, yy, tw, tagH); drawPixText(ctx, text, X + u(5), yy + Math.round((tagH - 7) / 2), col, 1); yy += tagH + u(3);
    };
    if (m.faultCount === 1 && (m.phase === 'serve-prep' || m.phase === 'serving' || m.phase === 'rally')) tag('2ND SERVE', '#ffd23f');
    if (m.isTiebreak) tag('TIEBREAK', GOLD);
    if (this.serveInfo) {
      const a = this.serveInfo.t > 3.2 ? 1 - (this.serveInfo.t - 3.2) / 0.8 : 1;
      if (a > 0.05) {
        ctx.globalAlpha = Math.max(0, a);
        const txt = `${this.serveInfo.kmh}`;
        const ph = u(14) + (BIG ? 2 : 0);
        const lw = textWidth('SERVE'), kw = textWidth('KM/H');
        const pw = u(5) + lw + u(6) + this.mainW(txt) + u(4) + kw + u(6);
        this.panel(ctx, X, yy, pw, ph);
        drawPixText(ctx, 'SERVE', X + u(5), yy + Math.round((ph - 7) / 2), DIM, 1);
        this.mainText(ctx, txt, X + u(5) + lw + u(6), yy, WHITE, ph);
        drawPixText(ctx, 'KM/H', X + u(5) + lw + u(6) + this.mainW(txt) + u(4), yy + Math.round((ph - 7) / 2), DIM, 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  lastShot(ctx, state) {
    const ls = state.lastShot;
    if (!ls) return;
    const w = u(132), h = u(42), x = W - w - u(6), y = H - h - u(6);
    const mine = ls.by === 0;
    this.panel(ctx, x, y, w, h);
    ctx.fillStyle = mine ? (state.players[0].look?.shirt || '#e23d3d') : (state.players[1].look?.shirt || '#f2c230');
    ctx.fillRect(x + 1, y + 1, u(3), h - 2);
    const cn = `${SHOT_CN[ls.shot] || ls.shot}${ls.side ? ' ' + (SIDE_CN[ls.side] || '') : ''}`;
    const cnW = drawText(ctx, cn, x + u(9), y + u(3), WHITE, CJK, { shadow: '#000', bold: BIG });
    // stroke variant (from lastShot, else from the hit event) shown for a few seconds when not 'normal'
    if (ls !== this.lsRef) { this.lsRef = ls; this.lsT = 0; }
    this.lsT = (this.lsT || 0) + (this._dt || 0);
    const variant = ls.variant || ls.anim?.variant || this.hitVariant?.v || null;
    if (variant && variant !== 'normal' && VARIANT_CN[variant] && this.lsT < 3.0) {
      const tag = VARIANT_CN[variant], ts = Math.round(CJK * 0.85);
      const tx = x + u(9) + cnW + u(6), tw = measureText(tag, ts, false) + u(6);
      ctx.fillStyle = '#ffb347'; ctx.fillRect(tx, y + u(4), tw, ts + u(3));
      drawText(ctx, tag, tx + u(3), y + u(4) + 1, '#1a1405', ts, {});
    }
    const who = mine ? 'YOU' : 'OPP';
    drawPixText(ctx, who, x + w - textWidth(who) - u(6), y + u(6), mine ? '#ff8a8a' : '#ffe27a', 1);
    const rowY = y + u(19);
    const sp = String(Math.round(ls.speedKmh)), rpm = String(Math.round(ls.spinRpm / 10) * 10);
    const bigH = fontHeight(1, FMAIN);
    drawPixText(ctx, sp, x + u(9), rowY, WHITE, 1, { font: FMAIN });
    drawPixText(ctx, 'KM/H', x + u(9) + this.mainW(sp) + u(3), rowY + bigH - 7, DIM, 1);
    const rx = x + u(70);
    drawPixText(ctx, rpm, rx, rowY, WHITE, 1, { font: FMAIN });
    drawPixText(ctx, 'RPM', rx + this.mainW(rpm) + u(3), rowY + bigH - 7, DIM, 1);
    // quality bar
    const q = Math.max(0, Math.min(1, ls.quality || 0)), segs = 22, sw = u(5), bw = segs * sw + 1, bx = x + u(9), bh = BIG ? 7 : 5, by = y + h - bh - u(3);
    ctx.fillStyle = '#1a2640'; ctx.fillRect(bx, by, bw, bh);
    for (let i = 0; i < segs; i++) {
      if (i / segs >= q) break;
      const f = i / segs;
      ctx.fillStyle = f < 0.35 ? '#e4534a' : f < 0.65 ? '#f2c230' : '#5ee07a';
      ctx.fillRect(bx + 1 + i * sw, by + 1, sw - 1, bh - 2);
      if (BIG) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(bx + 1 + i * sw, by + 1, sw - 1, 1); }
    }
  }

  timingRing(ctx, state, ui) {
    const h = state.hint, b = state.ball;
    if (ui.timingRing === false || !h || !h.reachable || h.contactIn == null || !b.visible) return;
    const p = camera.project(b.pos.x, b.pos.y, b.pos.z);
    const ci = Math.max(0, h.contactIn);
    const r = Math.round(u(4) + Math.min(1, ci / 0.6) * u(22));
    const good = ci < 0.09;
    const col = good ? '#5dff8a' : ci < 0.25 ? '#ffe45c' : '#ffffff';
    ctx.fillStyle = col;
    ctx.globalAlpha = good ? 1 : 0.85;
    this.ring(ctx, Math.round(p.sx), Math.round(p.sy), r, 1);
    ctx.globalAlpha = 0.5; this.ring(ctx, Math.round(p.sx), Math.round(p.sy), u(5), 2);
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
    // big calls use the 10x14 font at an integer scale (3x = 42 px letters at 540p)
    const font = BIG ? 'big' : 'small';
    const scale = BIG ? (c.text.length > 9 ? 2 : 3) : (c.text.length > 9 ? 3 : 4);
    const sc = c.t < 0.14 ? scale + 1 : scale;
    const col = CALL_COL[c.text] || '#fff';
    const w = textWidth(c.text, sc, font), hgt = fontHeight(sc, font);
    const x = Math.round((W - w) / 2), y = u(66) + Math.round((fontHeight(scale, font) - hgt) / 2);
    const fade = c.t > c.dur - 0.3 ? Math.max(0, (c.dur - c.t) / 0.3) : 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(8,12,22,0.55)'; ctx.fillRect(x - u(10), y - u(6), w + u(20), hgt + u(12));
    drawPixText(ctx, c.text, x, y, col, sc, { outline: '#0a0a12', font });
    ctx.globalAlpha = 1;
  }

  phoneIcon(ctx, status) {
    const k = BIG ? 2 : 1;
    const bw = 20 * k - (k - 1) * 6, bh = 17 * k - (k - 1) * 6;
    const x = W - bw - u(6) + 2, y = u(8);
    const col = status === 'connected' ? '#5dff8a' : status === 'connecting' ? '#ffe45c' : '#ff6b6b';
    ctx.fillStyle = '#05080f'; ctx.fillRect(x - 1, y - 1, bw, bh);
    ctx.fillStyle = PANEL; ctx.fillRect(x - 2, y - 2, bw, bh);
    ctx.fillStyle = EDGE; ctx.fillRect(x - 2, y - 2, bw, 1); ctx.fillRect(x - 2, y + bh - 3, bw, 1); ctx.fillRect(x - 2, y - 2, 1, bh); ctx.fillRect(x + bw - 3, y - 2, 1, bh);
    const pw = BIG ? 10 : 7, ph = BIG ? 17 : 12;
    ctx.fillStyle = '#cfd8ea'; ctx.fillRect(x + 1, y, pw, ph); ctx.fillStyle = '#18233a'; ctx.fillRect(x + 2, y + 1, pw - 2, ph - 3);
    ctx.fillStyle = '#8fa0c0'; ctx.fillRect(x + 1 + (pw >> 1) - 1, y + ph - 2, 2, 1);
    const ds = BIG ? 6 : 4;
    ctx.fillStyle = col; ctx.fillRect(x + pw + 4, y + (ph >> 1) - (ds >> 1), ds, ds);
    ctx.fillStyle = '#05080f'; ctx.fillRect(x + pw + 4, y + (ph >> 1) - (ds >> 1), 1, 1);
  }
}
