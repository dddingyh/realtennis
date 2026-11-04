// Procedural pixel-art tennis athletes.
//   pose.js       keyframed biomechanics + IK  ->  rig joints
//   char_model.js rig -> SDF primitives (tapered limbs, torso, head, costume, racket)
//   char_sdf.js   orthographic sphere-tracing at the exact sprite resolution, toon ramp, selective outline
// Frames are cached per (role, hand, animation, quantised phase, size, colours).
import { PixBuf } from './raster.js';
import { poseFor, solve, clamp } from './pose.js';
import { buildModel } from './char_model.js';
import { marchModel, finish, paletteFor } from './char_sdf.js';

const DEFAULT_LOOK = { skin: '#e0a97c', hair: '#2a1d12', shirt: '#e8e8e0', shorts: '#2a3a6a', shoes: '#f0f0f0', headband: null };

export function renderPlayerFrame(P, J, look, role, s) {
  const model = buildModel(J, look, role, s);
  const pal = paletteFor(look);
  const buf = marchModel(model, s, look, { role, noEyes: s < 30 || role === 'near' });
  const px = finish(buf, pal, s, { innerDepth: role === 'near' ? 0.085 : 0.11, inner: s >= 24 });
  const pb = new PixBuf(buf.W, buf.H);
  pb.px.set(px);
  pb.flush();
  return { pb, ox: buf.ox, oy: buf.oy };
}

function cropFrame(r) {
  const { pb, ox, oy } = r;
  const { w, h, px } = pb;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { canvas: document.createElement('canvas'), ax: 0, ay: 0 };
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return { canvas: pb.canvas, ax: ox, ay: oy };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(pb.canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return { canvas: c, ax: ox - x0, ay: oy - y0 };
}

const SWING_Q = 40, SERVE_Q = 48;

export class SpriteFactory {
  constructor() {
    this.cache = new Map(); this.runPhase = [0, 0]; this.lastPos = [null, null];
    this.disp = [null, null]; // displayed swing phase (eases the jump from the load pose to contact)
    this.stats = { frames: 0, ms: 0, maxMs: 0 };
  }

  // advance gait phase by travelled distance
  updateRun(i, player, dt) {
    const sp = Math.hypot(player.vel?.x || 0, player.vel?.z || 0);
    const a = player.anim || {};
    this.runPhase[i] = (this.runPhase[i] + dt * (a.name === 'walk' ? 0.7 + sp * 0.35 : 0.9 + sp * 0.34)) % 1;
    // swing phase smoothing: contact is at phase 0.5 but the sim jumps straight there from the load pose (<=0.45)
    const tgt = a.name === 'swing' ? a.phase || 0 : null;
    let d = this.disp[i];
    if (tgt == null) d = null;
    else if (d == null || tgt < d - 0.02) d = tgt;
    else if (tgt > d) d = Math.min(tgt, d + dt * 24);
    this.disp[i] = d;
  }

  frameKey(i, pl, role, s, time) {
    const a = pl.anim || { name: 'ready' };
    const look = pl.look || DEFAULT_LOOK;
    let ph = 0, extra = '';
    const name = a.name || 'ready';
    if (name === 'swing') ph = Math.round(clamp(this.disp[i] != null ? this.disp[i] : a.phase || 0, 0, 1) * SWING_Q);
    else if (name === 'serve') ph = Math.round(clamp(a.phase || 0, 0, 1) * SERVE_Q);
    else if (name === 'split') ph = a.phase == null ? 20 : Math.round(clamp(a.phase, 0, 1) * 20);
    else if (name === 'run' || name === 'walk') ph = Math.floor(this.runPhase[i] * 12) % 12;
    else if (name === 'ready') ph = Math.floor(time * 6.0 / (Math.PI * 2) * 6) % 6;
    else if (name === 'idle') ph = Math.floor(time * 0.9) % 3;
    else if (name === 'celebrate') ph = Math.floor((time * 1.8 % 1) * 12);
    else if (name === 'dejected') ph = Math.floor(time * 0.6) % 4;
    if (name === 'run') {
      const d = a.dir || { x: 0, z: 0 };
      const ang = Math.round(Math.atan2(d.x, -d.z) / (Math.PI / 4));
      extra = `|d${ang}|s${Math.round((a.speed == null ? 0.7 : a.speed) * 3)}`;
    }
    return `${role}|${pl.hand || 'R'}|${name}|${a.shot || ''}|${a.side || ''}|${ph}${extra}|${s}|${look.shirt}${look.shorts}${look.hair}${look.skin}${look.shoes}${look.headband || ''}`;
  }

  get(i, pl, role, s, time) {
    const key = this.frameKey(i, pl, role, s, time);
    let f = this.cache.get(key);
    if (f) return f;
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    const a = pl.anim || { name: 'ready' };
    const name = a.name || 'ready';
    const ph = parseInt(key.split('|')[5], 10);
    const qa = { ...a };
    if (name === 'swing') qa.phase = ph / SWING_Q;
    else if (name === 'serve') qa.phase = ph / SERVE_Q;
    else if (name === 'split') qa.phase = ph / 20;
    let qTime = time;
    if (name === 'ready') qTime = ph / 6 * (Math.PI * 2 / 6.0);
    if (name === 'idle') qTime = ph / 0.9;
    if (name === 'celebrate') qTime = ph / 12 / 1.8;
    if (name === 'dejected') qTime = ph / 0.6;
    const rp = (name === 'run' || name === 'walk') ? (ph % 12) / 12 : 0;
    if (name === 'run') {
      const d = a.dir || { x: 0, z: 0 };
      const ang = Math.round(Math.atan2(d.x, -d.z) / (Math.PI / 4)) * (Math.PI / 4);
      qa.dir = { x: Math.sin(ang), z: -Math.cos(ang) };
      qa.speed = Math.round((a.speed == null ? 0.7 : a.speed) * 3) / 3 || 0.34;
    }
    const P = poseFor(qa, { runPhase: rp, time: qTime, role });
    const J = solve(P, pl.hand || 'R');
    f = cropFrame(renderPlayerFrame(P, J, pl.look || DEFAULT_LOOK, role, s));
    this.cache.set(key, f);
    if (this.cache.size > 3000) this.cache.delete(this.cache.keys().next().value);
    if (t0) { const dt = performance.now() - t0; this.stats.frames++; this.stats.ms += dt; this.stats.maxMs = Math.max(this.stats.maxMs, dt); }
    return f;
  }

  // Render the commonly used frames ahead of time (call from idle callbacks while in the menu). Returns the number
  // of frames still to do; pass a time budget in ms per call.
  prewarm(role, s, look, hand = 'R', budgetMs = 8) {
    if (!this._warm) this._warm = new Map();
    const wk = `${role}|${s}|${hand}|${look.shirt}${look.shorts}`;
    let q = this._warm.get(wk);
    if (!q) {
      q = [];
      const A = (o) => q.push(o);
      A({ name: 'ready' }); A({ name: 'split', phase: 0.7 });
      for (let k = 0; k < 6; k++) A({ name: 'ready', _t: k });
      for (const [shot, side] of [['topspin', 'fh'], ['topspin', 'bh'], ['flat', 'fh'], ['flat', 'bh'], ['slice', 'fh'], ['slice', 'bh']]) {
        for (let k = 1; k <= SWING_Q; k += 1) A({ name: 'swing', shot, side, phase: k / SWING_Q });
      }
      for (let k = 0; k <= SERVE_Q; k++) A({ name: 'serve', phase: k / SERVE_Q });
      this._warm.set(wk, q);
    }
    const t0 = performance.now();
    while (q.length && performance.now() - t0 < budgetMs) {
      const a = q.shift();
      const time = a._t != null ? a._t * (Math.PI * 2 / 6.0) / 6 * 6 : 0;
      const pl = { hand, look, anim: a, vel: { x: 0, z: 0 } };
      this.disp[2] = null;
      this.get(2, pl, role, s, a._t != null ? (a._t / 6) * (Math.PI * 2 / 6.0) : 0);
    }
    return q.length;
  }
}
