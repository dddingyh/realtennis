// Procedural pixel-art tennis athletes.
//   pose.js       keyframed biomechanics + IK  ->  rig joints
//   char_model.js rig -> SDF primitives (tapered limbs, torso, head, costume, racket)
//   char_sdf.js   orthographic sphere-tracing at the exact sprite resolution, toon ramp, selective outline
// Frames are cached per (role, hand, animation, quantised phase, size, colours).
import { PixBuf } from './raster.js';
import { poseFor, solve, clamp, mixPose } from './pose.js';
import { buildModel, viewBasis } from './char_model.js';
import { marchModel, finish, paletteFor } from './char_sdf.js';
import { LOCO, DEFAULT_STRIDE } from './char_loco.js';
import camera from './camera.js';

const DEFAULT_LOOK = { skin: '#e0a97c', hair: '#2a1d12', shirt: '#e8e8e0', shorts: '#2a3a6a', shoes: '#f0f0f0', headband: null };

// DOM-free: animation -> RGBA pixels { w, h, px: Uint32Array, ox, oy } (ox/oy = feet anchor)
export function renderPlayerPixels(anim, pl, role, s, ctx = {}) {
  const look = pl.look || DEFAULT_LOOK, hand = pl.hand || 'R';
  const mir = hand === 'L' ? -1 : 1;
  let P = poseFor(anim, { ...ctx, role, mir });
  if (ctx.from) P = mixPose(poseFor(ctx.from.a, { ...ctx.from.c, role, mir }), P, ctx.from.w);
  const J = solve(P, hand);
  // secondary motion: hair / headband tails trail the head (pose a moment earlier)
  let lag = null;
  const prev = prevAnim(anim, ctx);
  if (prev && s >= 22) {
    const Jp = solve(poseFor(prev.a, { ...prev.c, role, mir }), hand);
    lag = [Jp.headC[0] - J.headC[0], Jp.headC[1] - J.headC[1], Jp.headC[2] - J.headC[2]].map((v) => Math.max(-0.05, Math.min(0.05, v * 1.4)));
  }
  const model = buildModel(J, look, role, s, { lag });
  const vb = viewBasis(role);
  const buf = marchModel(model, s, look, { role, U: vb.U, F: vb.F });
  const px = finish(buf, paletteFor(look), s, { innerDepth: role === 'near' ? 0.08 : 0.10, inner: s >= 22 });
  return { w: buf.W, h: buf.H, px, ox: buf.ox, oy: buf.oy };
}
function prevAnim(a, ctx) {
  if (a.name === 'swing' || a.name === 'serve') return { a: { ...a, phase: Math.max(0, (a.phase || 0) - 0.035) }, c: ctx };
  if (LOCO.has(a.name)) return { a: { ...a, gait: (((a.gait || 0) - 0.05) % 1 + 1) % 1 }, c: ctx };
  return null;
}

export function renderPlayerFrame(anim, pl, role, s, ctx) {
  const r = renderPlayerPixels(anim, pl, role, s, ctx);
  const pb = new PixBuf(r.w, r.h);
  pb.px.set(r.px);
  pb.flush();
  return { pb, ox: r.ox, oy: r.oy };
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

const SWING_Q = 64, SERVE_Q = 64, RUN_Q = 16, READY_Q = 8, DIR_Q = 64, FACE_Q = 16, BLEND_T = 0.12;
const ZERO = { x: 0, z: 0 };
// pose-blend categories: switching between these cross-fades the pose over BLEND_T seconds
function blendCat(n) {
  if (LOCO.has(n)) return 'loco:' + n;
  if (n === 'ready' || n === 'split' || n === 'idle') return 'stand:' + n;
  if (n === 'swing') return 'swing';
  return null;
}

export class SpriteFactory {
  constructor() {
    this.cache = new Map(); this.runPhase = [0, 0]; this.lastPos = [null, null];
    this.gait = [0, 0]; this.shift = [null, null]; this.trans = [null, null];
    this.disp = [null, null]; // displayed swing phase (eases the jump from the load pose to contact)
    this.stats = { frames: 0, ms: 0, maxMs: 0 };
    this.seen = new Map(); this._sched = false; this.autoWarm = true;
  }

  // advance gait phase by travelled distance
  updateRun(i, player, dt) {
    const sp = Math.hypot(player.vel?.x || 0, player.vel?.z || 0);
    const a = player.anim || {};
    this.runPhase[i] = (this.runPhase[i] + dt * (a.name === 'walk' ? 0.7 + sp * 0.35 : 0.9 + sp * 0.34)) % 1;
    // fallback gait (distance / stride) when the sim does not provide anim.gait
    if (a.gait == null && LOCO.has(a.name)) this.gait[i] = ((this.gait[i] || 0) + sp * dt / (a.strideLen || DEFAULT_STRIDE[a.name] || 1.5)) % 1;
    if (this.trans[i]) this.trans[i].t += dt;
    // swing phase smoothing: contact is at phase 0.5 but the sim jumps straight there from the load pose (<=0.45)
    const tgt = a.name === 'swing' ? a.phase || 0 : null;
    let d = this.disp[i];
    if (tgt == null) d = null;
    else if (d == null || tgt < d - 0.02) d = tgt;
    else if (tgt > d) d = Math.min(tgt, d + dt * 24);
    this.disp[i] = d;
  }

  // camera px per metre / sprite px per metre on the ground at the player's position, per screen axis.
  // Locomotion poses scale the planted-foot travel by these so feet stay fixed on the court.
  groundRatio(pl, role, s) {
    if (!pl.pos) return [1, 1];
    const x = pl.pos.x, z = pl.pos.z, e = 0.25;
    const p0 = camera.project(x, 0, z), px = camera.project(x + e, 0, z), pz = camera.project(x, 0, z + e);
    const sinp = Math.sin(viewBasis(role).pitch);
    return [Math.abs(px.sx - p0.sx) / e / s, Math.abs(pz.sy - p0.sy) / e / (s * sinp)];
  }

  // anim -> { key, qa (quantised anim), ctx, shift (world metres the sprite anchor must move so the quantised
  // gait matches the true distance travelled) }
  quant(i, pl, role, s, time) {
    const a = pl.anim || { name: 'ready' };
    const look = pl.look || DEFAULT_LOOK;
    const name = a.name || 'ready';
    const qa = { ...a };
    const ctx = {};
    let ph = 0, extra = '', shift = null;
    if (name === 'swing') { ph = Math.round(clamp(this.disp[i] != null ? this.disp[i] : a.phase || 0, 0, 1) * SWING_Q); qa.phase = ph / SWING_Q; }
    else if (name === 'serve' || name === 'bounce') { ph = Math.round(clamp(a.phase || 0, 0, 1) * SERVE_Q); qa.phase = ph / SERVE_Q; }
    else if (name === 'split') { ph = a.phase == null ? 20 : Math.round(clamp(a.phase, 0, 1) * 20); qa.phase = ph / 20; }
    else if (LOCO.has(name)) {
      const L = a.strideLen || DEFAULT_STRIDE[name] || 1.5;
      const Lq = Math.max(0.3, Math.round(L * 20) / 20);
      const g = a.gait != null ? a.gait : (this.gait[i] || 0);
      const gs = g * RUN_Q, gr = Math.round(gs);
      ph = ((gr % RUN_Q) + RUN_Q) % RUN_Q;
      const dir = a.dir && Math.hypot(a.dir.x, a.dir.z) > 1e-6 ? a.dir : null;
      const dang = dir ? Math.atan2(dir.x, dir.z) : 0;
      const dq = Math.round(dang / (Math.PI * 2) * DIR_Q);
      const fa = a.face && Math.hypot(a.face.x, a.face.z) > 1e-6 ? Math.atan2(a.face.x, a.face.z) : null;
      const fq = fa == null ? 'n' : Math.round(fa / (Math.PI * 2) * FACE_Q);
      const spq = Math.round(clamp(a.speed == null ? 0.6 : a.speed, 0, 1) * 4);
      const acq = Math.round(clamp(a.accel || 0, -1, 1) * 2);
      const [kx, kz] = this.groundRatio(pl, role, s);
      const kxq = Math.round(kx * 50), kzq = Math.round(kz * 50);
      const qd = dq * Math.PI * 2 / DIR_Q;
      qa.gait = ph / RUN_Q; qa.strideLen = Lq; qa.speed = spq / 4; qa.accel = acq / 2;
      qa.dir = dir ? { x: Math.sin(qd), z: Math.cos(qd) } : null;
      qa.face = fq === 'n' ? null : { x: Math.sin(fq * Math.PI * 2 / FACE_Q), z: Math.cos(fq * Math.PI * 2 / FACE_Q) };
      ctx.kx = kxq / 50; ctx.kz = kzq / 50;
      if (dir) { const back = (gs - gr) / RUN_Q * L; shift = { x: -dir.x * back, z: -dir.z * back }; }
      extra = `|d${dq}|f${fq}|v${spq}|a${acq}|L${Lq}|k${kxq},${kzq}`;
    }
    else if (name === 'ready') { ph = Math.floor(time * 6.0 / (Math.PI * 2) * READY_Q) % READY_Q; ctx.time = (ph + 0.5) / READY_Q * (Math.PI * 2 / 6.0); }
    else if (name === 'idle') { ph = Math.floor(time * 0.9) % 3; ctx.time = ph / 0.9; }
    else if (name === 'celebrate') { ph = Math.floor((time * 1.8 % 1) * 12); ctx.time = ph / 12 / 1.8; }
    else if (name === 'dejected') { ph = Math.floor(time * 0.6) % 4; ctx.time = ph / 0.6; }
    const key = `${role}|${pl.hand || 'R'}|${name}|${a.shot || ''}|${a.side || ''}|${ph}${extra}|${s}|${look.shirt}${look.shorts}${look.hair}${look.skin}${look.shoes}${look.headband || ''}`;
    return { key, qa, ctx, shift };
  }

  frameKey(i, pl, role, s, time) { return this.quant(i, pl, role, s, time).key; }

  // world-space offset (metres) to add to the player's position when placing the sprite of the last get() call
  anchorShift(i) { return this.shift[i] || ZERO; }

  get(i, pl, role, s, time) {
    const q = this.quant(i, pl, role, s, time);
    if (i < 2) this.shift[i] = q.shift;
    // transitions between locomotion / ready / swing states: two short in-between frames (cached by from+to key)
    const cat = blendCat(q.qa.name);
    const tr = i < 2 ? this.trans[i] : null;
    if (tr) {
      if (tr.cat !== cat) { tr.from = tr.last; tr.t = 0; tr.cat = cat; }
      tr.last = q;
    } else if (i < 2) this.trans[i] = { cat, last: q, from: null, t: 1 };
    let key = q.key, from = null;
    const T = i < 2 ? this.trans[i] : null;
    if (T && T.from && T.t < BLEND_T && cat && blendCat(T.from.qa.name)) {
      const w = T.t < BLEND_T / 2 ? 1 / 3 : 2 / 3;
      key = `${q.key}<${T.from.key}@${w.toFixed(2)}`;
      from = { a: T.from.qa, c: T.from.ctx, w };
    }
    let f = this.cache.get(key);
    if (f) return f;
    if (this.autoWarm && i < 2) this._note(role, s, pl.look || DEFAULT_LOOK, pl.hand || 'R');
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    f = cropFrame(renderPlayerFrame(q.qa, pl, role, s, { ...q.ctx, from }));
    this.cache.set(key, f);
    if (this.cache.size > 3600) this.cache.delete(this.cache.keys().next().value);
    if (t0) { const dt = performance.now() - t0; this.stats.frames++; this.stats.ms += dt; this.stats.maxMs = Math.max(this.stats.maxMs, dt); }
    return f;
  }

  // remember which (role,size,look,hand) combos are in use and warm their frames while the browser is idle
  _note(role, s, look, hand) {
    const k = `${role}|${s}|${hand}|${look.shirt}${look.shorts}${look.hair}${look.skin}${look.shoes}${look.headband || ''}`;
    if (this.seen.has(k)) return;
    this.seen.set(k, { role, s, look, hand });
    if (this.seen.size > 6) this.seen.delete(this.seen.keys().next().value);
    if (!this._sched && typeof window !== 'undefined') { this._sched = true; this._idle(); }
  }
  _idle() {
    const run = (dl) => {
      let left = 0;
      const t0 = performance.now();
      for (const c of [...this.seen.values()].reverse()) {
        const budget = Math.min(6, (dl && dl.timeRemaining ? dl.timeRemaining() : 6) - (performance.now() - t0));
        if (budget <= 1) { left = 1; break; }
        left += this.prewarm(c.role, c.s, c.look, c.hand, budget);
      }
      if (left) this._idle(); else this._sched = false;
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 400 }); else setTimeout(() => run(null), 40);
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
      for (let k = 0; k < READY_Q; k++) A({ name: 'ready', _t: k });
      for (const [shot, side] of [['topspin', 'fh'], ['topspin', 'bh'], ['flat', 'fh'], ['flat', 'bh'], ['slice', 'fh'], ['slice', 'bh']]) {
        for (let k = 1; k <= SWING_Q; k += 1) A({ name: 'swing', shot, side, phase: k / SWING_Q });
      }
      for (let k = 0; k <= SERVE_Q; k++) A({ name: 'serve', phase: k / SERVE_Q });
      this._warm.set(wk, q);
    }
    const t0 = performance.now();
    while (q.length && performance.now() - t0 < budgetMs) {
      const a = q.shift();
            const pl = { hand, look, anim: a, vel: { x: 0, z: 0 } };
      this.disp[2] = null;
      this.get(2, pl, role, s, a._t != null ? ((a._t + 0.5) / READY_Q) * (Math.PI * 2 / 6.0) : 0);
    }
    return q.length;
  }
}
