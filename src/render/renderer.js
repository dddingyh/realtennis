// Frame composition: background -> crowd -> ground decals/shadows -> depth-sorted entities (with net layer) -> HUD.
import { RENDER, BALL, COURT } from '../config.js';
import { camera } from './camera.js';
import { renderBackground } from './court.js';
import { renderNetLayer, drawStaticPeople } from './props.js';
import { Crowd } from './crowd.js';
import { SpriteFactory } from './sprites.js';
import { ellipseSpans, hex, css, rgba } from './raster.js';

const W = RENDER.width, H = RENDER.height;
const BALL_C = '#d9f23a', BALL_D = '#8cb31c', BALL_L = '#fbffc4', BALL_O = '#1a2a10';

export class Renderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.sprites = new SpriteFactory();
    this.crowd = new Crowd();
    this.netLayer = null; this.bgCanvas = null; this.surface = null;
    this.particles = [];
    this.trail = [];
    this.lastBallVisible = false;
    this.shake = 0;
  }

  setSurface(surface) {
    if (this.surface === surface && this.bgCanvas) return;
    this.surface = surface;
    const pb = renderBackground(surface);
    drawStaticPeople(pb, surface);
    this.bgCanvas = pb.flush();
    this.netLayer = renderNetLayer(surface).flush();
  }

  // react to sim events (visual part)
  onEvents(events, state) {
    for (const e of events) {
      if (e.type === 'bounce' && e.pos) this.spawnPuff(e.pos, e.in);
      else if (e.type === 'point') this.crowd.onPoint(e.winner === 0 ? 1 : 0.6);
      else if (e.type === 'call' && e.text === 'ACE') this.crowd.onPoint(0.9);
      else if (e.type === 'hit' && e.quality > 0.85) this.crowd.onPoint(0.25);
    }
  }

  spawnPuff(pos, inBounds) {
    const s = this.surface;
    const n = s === 'clay' ? 9 : s === 'grass' ? 5 : 4;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (s === 'clay' ? 0.8 : 0.5) * (0.4 + Math.random());
      this.particles.push({ x: pos.x, y: 0.02, z: pos.z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 1.2, vz: Math.sin(a) * sp, life: 0, max: 0.35 + Math.random() * 0.3, kind: s });
    }
  }

  groundShadow(ctx, x, z, wx, wz, a) {
    const p = camera.project(x, 0, z);
    const rx = wx * p.scale, ry = Math.max(1, wz * p.scale * 0.5);
    ellipseSpans(ctx, p.sx, p.sy, rx, ry, `rgba(8,14,24,${a})`);
  }

  ballPx(b) {
    const p = camera.project(b.pos.x, b.pos.y, b.pos.z);
    return p;
  }

  draw(state, dt, time, ui) {
    const ctx = this.ctx;
    ctx.drawImage(this.bgCanvas, 0, 0);
    // crowd
    this.crowd.update(dt, time);
    ctx.drawImage(this.crowd.pb.canvas, 0, 0);

    const b = state.ball;
    // ----- ground decals: ball marks -----
    for (const m of (b.marks || [])) {
      const p = camera.project(m.x, 0, m.z);
      let a, col;
      if (this.surface === 'clay') { a = Math.max(0, 0.75 - m.age / 60); col = `rgba(120,50,22,${a})`; }
      else if (this.surface === 'grass') { a = Math.max(0, 0.45 - m.age / 8); col = `rgba(190,210,120,${a})`; }
      else { a = Math.max(0, 0.55 - m.age / 2.2); col = `rgba(235,240,250,${a})`; }
      if (a <= 0.02) continue;
      ellipseSpans(ctx, p.sx, p.sy, Math.max(1.2, 0.09 * p.scale), Math.max(0.8, 0.045 * p.scale), col);
    }
    // ----- shadows -----
    for (let i = 0; i < 2; i++) {
      const pl = state.players[i];
      this.groundShadow(ctx, pl.pos.x + 0.22, pl.pos.z + 0.12, 0.42, 0.55, 0.30);
    }
    if (b.visible) {
      const hgt = Math.max(0, b.pos.y);
      const k = 1 / (1 + hgt * 0.35);
      this.groundShadow(ctx, b.pos.x + hgt * 0.22, b.pos.z + hgt * 0.16, BALL.radius * 1.5 * (0.6 + 0.4 * k) , BALL.radius * 1.6, 0.18 + 0.32 * k);
    }
    // ----- entities sorted by depth (z ascending = far first) -----
    const items = [];
    items.push({ z: 0, kind: 'net' });
    for (let i = 0; i < 2; i++) items.push({ z: state.players[i].pos.z, kind: 'player', i });
    if (b.visible) items.push({ z: b.pos.z, kind: 'ball' });
    items.sort((p, q) => p.z - q.z);
    for (const it of items) {
      if (it.kind === 'net') ctx.drawImage(this.netLayer, 0, 0);
      else if (it.kind === 'player') this.drawPlayer(ctx, state, it.i, dt, time);
      else this.drawBall(ctx, b, dt);
    }
    // particles (dust) in front of everything on the ground plane
    this.drawParticles(ctx, dt);
    if (!b.visible) this.trail.length = 0;
    return this.canvas;
  }

  drawPlayer(ctx, state, i, dt, time) {
    const pl = state.players[i];
    const role = i === 0 ? 'near' : 'far';
    this.sprites.updateRun(i, pl, dt);
    const p = camera.project(pl.pos.x, 0, pl.pos.z);
    const boost = role === 'near' ? 1.12 : 1.1;
    let s = Math.round((p.scale * boost) / 2) * 2;
    s = Math.max(14, s);
    const f = this.sprites.get(i, pl, role, s, time);
    const x = Math.round(p.sx - f.ax), y = Math.round(p.sy - f.ay);
    ctx.drawImage(f.canvas, x, y);
  }

  drawBall(ctx, b, dt) {
    const p = camera.project(b.pos.x, b.pos.y, b.pos.z);
    const sp = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    // trail history (render-frame samples)
    this.trail.push({ x: p.sx, y: p.sy, t: 0 });
    for (const t of this.trail) t.t += dt;
    while (this.trail.length && this.trail[0].t > 0.09) this.trail.shift();
    if (sp > 22 && this.trail.length > 1) {
      for (let k = 0; k < this.trail.length - 1; k++) {
        const a = this.trail[k], c = this.trail[k + 1];
        const al = 0.45 * (1 - a.t / 0.09);
        ctx.fillStyle = `rgba(230,250,140,${al})`;
        this.dotLine(ctx, a.x, a.y, c.x, c.y);
      }
    }
    const d = Math.max(1, Math.min(4, Math.round(BALL.radius * 2 * p.scale * 1.55)));
    const cx = Math.round(p.sx), cy = Math.round(p.sy);
    this.pixelBall(ctx, cx, cy, d);
  }

  dotLine(ctx, x0, y0, x1, y1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    for (;;) {
      ctx.fillRect(x0, y0, 1, 1);
      if ((x0 === x1 && y0 === y1) || n++ > 80) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  pixelBall(ctx, cx, cy, d) {
    if (d <= 1) {
      ctx.fillStyle = BALL_O; ctx.fillRect(cx - 1, cy - 1, 3, 3);
      ctx.fillStyle = BALL_L; ctx.fillRect(cx, cy, 1, 1);
      return;
    }
    const r = d / 2;
    const px0 = cx - Math.floor(d / 2), py0 = cy - Math.floor(d / 2);
    // outline (disc r+1) then ball
    const disc = (rr, col) => {
      ctx.fillStyle = col;
      for (let j = -1; j <= d; j++) for (let i = -1; i <= d; i++) {
        const dx = i + 0.5 - r, dy = j + 0.5 - r;
        if (dx * dx + dy * dy <= rr * rr) ctx.fillRect(px0 + i, py0 + j, 1, 1);
      }
    };
    disc(r + 0.95, BALL_O);
    disc(r + 0.05, BALL_C);
    ctx.fillStyle = BALL_D; ctx.fillRect(px0 + d - 1, py0 + d - 1, 1, 1); if (d >= 3) ctx.fillRect(px0 + d - 1, py0 + d - 2, 1, 1);
    ctx.fillStyle = BALL_L; ctx.fillRect(px0, py0, 1, 1); if (d >= 4) ctx.fillRect(px0 + 1, py0, 1, 1);
  }

  drawParticles(ctx, dt) {
    const g = 6;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life += dt;
      if (q.life > q.max) { this.particles.splice(i, 1); continue; }
      q.vy -= g * dt; q.x += q.vx * dt; q.z += q.vz * dt; q.y = Math.max(0, q.y + q.vy * dt);
      const p = camera.project(q.x, q.y, q.z);
      const a = 1 - q.life / q.max;
      const col = q.kind === 'clay' ? `rgba(232,160,110,${a})` : q.kind === 'grass' ? `rgba(120,180,80,${a})` : `rgba(240,245,255,${a * 0.8})`;
      ctx.fillStyle = col;
      const sz = q.kind === 'clay' && a > 0.5 ? 2 : 1;
      ctx.fillRect(Math.round(p.sx), Math.round(p.sy), sz, sz);
    }
  }
}
