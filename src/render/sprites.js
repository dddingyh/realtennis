// Procedural pixel-art tennis athletes.
//   pose.js       keyframed biomechanics + IK  ->  rig joints
//   char_model.js rig -> SDF primitives (tapered limbs, torso, head, costume, racket)
//   char_sdf.js   orthographic sphere-tracing at the exact sprite resolution, toon ramp, selective outline
// Frames are cached per (role, hand, animation, quantised phase, size, colours) and rendered off the main thread
// in a pool of module workers (sprite_worker.js); while a frame is in flight the nearest cached frame of the same
// state is shown.
import { PixBuf } from './raster.js';
import { poseFor, solve, clamp, mixPose } from './pose.js';
import { buildModel, viewBasis } from './char_model.js';
import { marchModel, finish, paletteFor } from './char_sdf.js';
import { LOCO, DEFAULT_STRIDE, strideCorrection } from './char_loco.js';
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


const SWING_Q = 64, SERVE_Q = 64, RUN_Q = 16, READY_Q = 8, DIR_Q = 128, FACE_Q = 16, BLEND_T = 0.12;
export const SPRITE_SERVE_Q = SERVE_Q; // serve / bounce phase quantisation (renderer.js places the held ball with it)
const ZERO = { x: 0, z: 0 };
let _empty = null;
const EMPTY_FRAME = () => { if (!_empty) { const c = document.createElement('canvas'); c.width = 1; c.height = 1; _empty = { canvas: c, ax: 0, ay: 0, w: 1, h: 1, fam: null, ph: 0, s: 0 }; } return _empty; };
const CACHE_BYTES = 160 * 1024 * 1024, SYNC_BUDGET_MS = 6;
// pose-blend categories: switching between these cross-fades the pose over BLEND_T seconds
function blendCat(n) {
  if (LOCO.has(n)) return 'loco:' + n;
  if (n === 'ready' || n === 'split' || n === 'idle') return 'stand:' + n;
  if (n === 'swing') return 'swing';
  return null;
}
const lookKey = (look) => `${look.shirt}${look.shorts}${look.hair}${look.skin}${look.shoes}${look.headband || ''}`;

// crop a rendered RGBA frame to its opaque bounds (shared by the worker and the synchronous path)
export function cropPixels(r) {
  const { w, h, px, ox, oy } = r;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) if (px[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return { w: 1, h: 1, px: new Uint32Array(1), ax: 0, ay: 0 };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new Uint32Array(cw * ch);
  for (let y = 0; y < ch; y++) out.set(px.subarray((y + y0) * w + x0, (y + y0) * w + x0 + cw), y * cw);
  return { w: cw, h: ch, px: out, ax: ox - x0, ay: oy - y0 };
}
function toCanvas(c) {
  const cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(c.px.buffer, c.px.byteOffset, c.w * c.h * 4), c.w, c.h), 0, 0);
  return cv;
}

// ---------------------------------------------------------------- worker pool
// Frames are ray-marched in module workers; the main thread only looks up the cache. Three priority lanes:
// 0 = frame needed now (newest first), 1 = look-ahead along gait / phase, 2 = prewarm.
class WorkerPool {
  constructor(n, onDone) {
    this.onDone = onDone; this.workers = []; this.idle = []; this.lanes = [[], [], []]; this.inflight = new Map(); this.seq = 0; this.ok = true; this.busyWarm = 0;
    for (let k = 0; k < n; k++) {
      let w;
      try { w = new Worker(new URL('./sprite_worker.js', import.meta.url), { type: 'module' }); } catch (e) { this.ok = false; break; }
      w.onmessage = (e) => this._done(w, e.data);
      w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); this.ok = false; };
      this.workers.push(w); this.idle.push(w);
    }
    if (!this.workers.length) this.ok = false;
  }
  has(key) { return this.inflight.has(key); }
  pending(lane) { return this.lanes[lane].length; }
  request(key, job, lane) {
    const cur = this.inflight.get(key);
    if (cur) {
      if (cur.lane > lane && !cur.sent) { const L = this.lanes[cur.lane]; const k = L.indexOf(cur); if (k >= 0) L.splice(k, 1); cur.lane = lane; this.lanes[lane].push(cur); }
      return;
    }
    const it = { key, job, lane, sent: false, t: performance.now() };
    this.inflight.set(key, it);
    this.lanes[lane].push(it);
    // stale "now" / look-ahead requests are dropped once the player has moved on
    const L = this.lanes[lane];
    const cap = lane === 0 ? 6 : lane === 1 ? 24 : 1e9;
    while (L.length > cap) { const old = L.shift(); this.inflight.delete(old.key); }
    this._pump();
  }
  _pump() {
    while (this.idle.length) {
      let it = null;
      if (this.lanes[0].length) it = this.lanes[0].pop();          // newest "now" first
      else if (this.lanes[1].length) it = this.lanes[1].pop();     // newest look-ahead first (older ones are stale)
      else if (this.lanes[2].length && this.busyWarm < Math.max(1, this.workers.length - 2)) it = this.lanes[2].shift(); // keep a worker free for "now"
      if (!it) return;
      if (it.sentLane === 2) this.busyWarm++;
      const w = this.idle.pop();
      it.sent = true; it.w = w; it.sentLane = it.lane;
      w.postMessage({ key: it.key, ...it.job });
    }
  }
  _done(w, d) {
    this.idle.push(w);
    const it = this.inflight.get(d.key);
    if (it && it.sentLane === 2) this.busyWarm--;
    this.inflight.delete(d.key);
    this.onDone(d, it);
    this._pump();
  }
}

export class SpriteFactory {
  constructor(opts = {}) {
    this.cache = new Map(); this.bytes = 0; this.fam = new Map();
    this.runPhase = [0, 0]; this.lastPos = [null, null];
    this.gait = [0, 0]; this.shift = [null, null]; this.trans = [null, null]; this.last = [null, null]; this.wasExact = [true, true];
    this.disp = [null, null]; // displayed swing phase (eases the jump from the load pose to contact)
    this.stats = { frames: 0, ms: 0, maxMs: 0, gets: 0, exact: 0, fallback: 0, fbNear: 0, sync: 0, fbRuns: 0, fbFrames: 0, main: [], cur: 0 };
    this.fbRun = [0, 0];
    this.warmed = new Set(); this.warmQ = []; this.autoWarm = true;
    this.sync = !!opts.sync; this.syncSpent = 0; this.forceExact = !!opts.exact;
    this.pool = null;
    if (!this.sync && !this.forceExact && typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      this.pool = new WorkerPool(n, (d, it) => this._receive(d, it));
      if (!this.pool.ok) this.pool = null;
    }
  }

  // advance gait phase by travelled distance
  updateRun(i, player, dt) {
    const t0 = performance.now();
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
    this.stats.cur += performance.now() - t0;
  }

  // camera px per metre / sprite px per metre on the ground at the player's position, per screen axis.
  // Locomotion poses scale the planted-foot travel by these so feet stay fixed on the court.
  groundRatio(pl, role, s) {
    if (!pl.pos) return [1, 1, 1, 0];
    // secant ratios over a typical stance excursion; depth uses separate ratios ahead of / behind the anchor
    // because perspective is not linear in depth
    const x = pl.pos.x, z = pl.pos.z, e = 0.35, fw = role === 'near' ? -1 : 1;
    const p0 = camera.project(x, 0, z), px = camera.project(x + e, 0, z);
    const pf = camera.project(x, 0, z + fw * e), pb = camera.project(x, 0, z - fw * e);
    const sinp = Math.sin(viewBasis(role).pitch);
    // depth moves also shift the anchor sideways (perspective convergence): screen-x px per metre of char-forward
    const kxz = (pf.sx - pb.sx) / (2 * e) / s * viewBasis(role).R[0];
    return [Math.abs(px.sx - p0.sx) / e / s, Math.abs(pf.sy - p0.sy) / e / (s * sinp), Math.abs(pb.sy - p0.sy) / e / (s * sinp), kxz];
  }

  // anim -> { key, qa (quantised anim), ctx, shift (world metres the sprite anchor must move so the quantised
  // gait matches the true distance travelled) }
  quant(i, pl, role, s, time, ahead = 0) {
    const a = pl.anim || { name: 'ready' };
    const look = pl.look || DEFAULT_LOOK;
    const name = a.name || 'ready';
    const qa = { ...a };
    const ctx = {};
    let ph = 0, extra = '', fextra = '', shift = null, cyc = 0, gs = 0, dirv = null, Lr = 0;
    if (name === 'swing') { ph = Math.min(SWING_Q, Math.round(clamp(this.disp[i] != null ? this.disp[i] : a.phase || 0, 0, 1) * SWING_Q) + ahead); qa.phase = ph / SWING_Q; }
    else if (name === 'serve' || name === 'bounce') { ph = Math.min(SERVE_Q, Math.round(clamp(a.phase || 0, 0, 1) * SERVE_Q) + ahead); qa.phase = ph / SERVE_Q; }
    else if (name === 'split') { ph = a.phase == null ? 20 : Math.min(20, Math.round(clamp(a.phase, 0, 1) * 20) + ahead); qa.phase = ph / 20; }
    else if (LOCO.has(name)) {
      const L = a.strideLen || DEFAULT_STRIDE[name] || 1.5;
      const Lq = Math.max(0.5, Math.round(L * 4) / 4); // coarse: the anchor shift corrects the stance foot for L - Lq
      const g = a.gait != null ? a.gait : (this.gait[i] || 0);
      gs = g * RUN_Q; const gr = Math.round(gs) + ahead; cyc = RUN_Q; Lr = L;
      ph = ((gr % RUN_Q) + RUN_Q) % RUN_Q;
      const dir = a.dir && Math.hypot(a.dir.x, a.dir.z) > 1e-6 ? a.dir : null;
      const dang = dir ? Math.atan2(dir.x, dir.z) : 0;
      const DQ = name === 'walk' ? 32 : DIR_Q;
      const dq = Math.round(dang / (Math.PI * 2) * DQ) * (DIR_Q / DQ);
      const fa = a.face && Math.hypot(a.face.x, a.face.z) > 1e-6 ? Math.atan2(a.face.x, a.face.z) : null;
      const fq = fa == null ? 'n' : Math.round(fa / (Math.PI * 2) * FACE_Q);
      const spq = Math.round(clamp(a.speed == null ? 0.6 : a.speed, 0, 1) * 3);
      const acq = (a.accel || 0) > 0.5 ? 1 : (a.accel || 0) < -0.5 ? -1 : 0;
      const [kx, kz, kzb, kxz] = this.groundRatio(pl, role, s);
      // perspective corrections only enter the key when they act on this travel direction (fewer distinct frames)
      const cdx = Math.abs(dir ? dir.x : 0), cdz = Math.abs(dir ? dir.z : 0);
      const kxq = cdx > 0.05 ? Math.round(kx * 50) : 50, kzq = cdz > 0.05 ? Math.round(kz * 50) : 50, kzbq = cdz > 0.05 ? Math.round(kzb * 50) : 50, kxzq = cdz > 0.05 ? Math.round(kxz * 50) * 2 : 0;
      const qd = dq * Math.PI * 2 / DIR_Q;
      qa.gait = ph / RUN_Q; qa.strideLen = Lq; qa.speed = spq / 3; qa.accel = acq * 0.8;
      qa.dir = dir ? { x: Math.sin(qd), z: Math.cos(qd) } : null;
      qa.face = fq === 'n' ? null : { x: Math.sin(fq * Math.PI * 2 / FACE_Q), z: Math.cos(fq * Math.PI * 2 / FACE_Q) };
      ctx.kx = kxq / 50; ctx.kz = kzq / 50; ctx.kzb = kzbq / 50; ctx.kxz = kxzq / 100;
      if (dir) { dirv = dir; const back = (gs - gr) / RUN_Q * L - strideCorrection(name, ph / RUN_Q, Lq, L); shift = { x: -dir.x * back, z: -dir.z * back }; }
      gs = ((gs % RUN_Q) + RUN_Q) % RUN_Q;
      fextra = `|d${Math.round(dang / (Math.PI * 2) * 16)}|f${fq === 'n' ? 'n' : Math.round(fq / 2)}`;
      extra = `|d${dq}|f${fq}|v${spq}|a${acq}|L${Lq}|k${kxq},${kzq},${kzbq},${kxzq}`;
    }
    else if (name === 'ready') { ph = (Math.floor(time * 6.0 / (Math.PI * 2) * READY_Q) + ahead) % READY_Q; cyc = READY_Q; ctx.time = (ph + 0.5) / READY_Q * (Math.PI * 2 / 6.0); }
    else if (name === 'idle') { ph = Math.floor(time * 0.9) % 3; ctx.time = ph / 0.9; }
    else if (name === 'celebrate') { ph = Math.floor((time * 1.8 % 1) * 12); ctx.time = ph / 12 / 1.8; }
    else if (name === 'dejected') { ph = Math.floor(time * 0.6) % 4; ctx.time = ph / 0.6; }
    const base = `${role}|${pl.hand || 'R'}|${name}|${a.shot || ''}|${a.side || ''}`;
    const key = `${base}|${ph}${extra}|${s}|${lookKey(look)}`;
    // family: same state, any phase / size / perspective correction -> nearest-frame fallback while rendering
    const fam = `${base}${fextra}|${lookKey(look)}`;
    return { key, qa, ctx, shift, fam, ph, cyc, gs: cyc === RUN_Q ? gs : ph, dirv, L: Lr, Lq: cyc === RUN_Q ? qa.strideLen : 0, name, s };
  }

  frameKey(i, pl, role, s, time) { return this.quant(i, pl, role, s, time).key; }

  // serve / bounce phase of the frame shown for player i (the ball is placed in that exact pose's hand)
  shownPhase(i, phase) {
    const f = this.last[i];
    if (f && f.fam && /\|(serve|bounce)\|/.test(f.fam)) return f.ph / SERVE_Q;
    return Math.round(clamp(phase || 0, 0, 1) * SERVE_Q) / SERVE_Q;
  }

  // world-space offset (metres) to add to the player's position when placing the sprite of the last get() call
  anchorShift(i) { return this.shift[i] || ZERO; }

  // ---- cache (LRU by bytes) with a per-family index for nearest-frame fallbacks
  _put(key, f) {
    const old = this.cache.get(key);
    if (old) { this.bytes -= old.bytes; this.cache.delete(key); }
    f.bytes = f.w * f.h * 4 + 256;
    this.cache.set(key, f); this.bytes += f.bytes;
    if (f.fam) { let S = this.fam.get(f.fam); if (!S) { S = new Map(); this.fam.set(f.fam, S); } S.set(key, f); }
    while (this.bytes > CACHE_BYTES && this.cache.size > 1) {
      const [k0, f0] = this.cache.entries().next().value;
      this.cache.delete(k0); this.bytes -= f0.bytes;
      const S = f0.fam && this.fam.get(f0.fam); if (S) { S.delete(k0); if (!S.size) this.fam.delete(f0.fam); }
      if (f0.canvas && f0.canvas.close) f0.canvas.close();
    }
  }
  _hit(key) {
    const f = this.cache.get(key);
    if (f && f.lru !== this.stats.gets) { this.cache.delete(key); this.cache.set(key, f); f.lru = this.stats.gets; } // LRU touch
    return f;
  }
  _nearest(q) {
    const S = this.fam.get(q.fam);
    if (!S) return null;
    let best = null, bd = 1e9;
    for (const f of S.values()) {
      let d = Math.abs(f.ph - q.ph);
      if (q.cyc) d = Math.min(d, q.cyc - d);
      d += f.s === q.s ? 0 : 0.5;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  _job(q, pl, role, s, from) {
    return { qa: q.qa, pl: { hand: pl.hand || 'R', look: pl.look || DEFAULT_LOOK }, role, s, ctx: { ...q.ctx, from }, meta: this._meta(q, s) };
  }
  _meta(q, s) { return { fam: q.fam, ph: q.ph, s }; }
  _receive(d, it) {
    if (!d || d.err) { if (d && d.err) console.warn('sprite worker:', d.err); return; }
    const f = { canvas: d.bmp || toCanvas(d), ax: d.ax, ay: d.ay, w: d.w, h: d.h, fam: d.meta.fam, ph: d.meta.ph, s: d.meta.s };
    this._put(d.key, f);
    this.stats.frames++; this.stats.ms += d.ms; this.stats.maxMs = Math.max(this.stats.maxMs, d.ms);
  }
  _renderSync(key, q, pl, role, s, from) {
    const t0 = performance.now();
    const c = cropPixels(renderPlayerPixels(q.qa, pl, role, s, { ...q.ctx, from }));
    const f = { canvas: toCanvas(c), ax: c.ax, ay: c.ay, w: c.w, h: c.h, ...this._meta(q, s) };
    this._put(key, f);
    const dt = performance.now() - t0; this.stats.frames++; this.stats.ms += dt; this.stats.maxMs = Math.max(this.stats.maxMs, dt); this.stats.sync++;
    return f;
  }

  get(i, pl, role, s, time) {
    const t0 = performance.now();
    const f = this._get(i, pl, role, s, time);
    const st = this.stats;
    st.cur += performance.now() - t0;
    if (i === 0) { st.main.push(st.cur); if (st.main.length > 4000) st.main.shift(); st.cur = 0; this.syncSpent = 0; }
    return f;
  }

  _get(i, pl, role, s, time) {
    this.stats.gets++;
    const q = this.quant(i, pl, role, s, time);
    // transitions between locomotion / ready / swing states: two in-between frames blending the last frame of the
    // old state into the first frame of the new one (both requested at the switch, cached by from+to key)
    const cat = blendCat(q.qa.name);
    let T = i < 2 ? this.trans[i] : null;
    if (T) {
      if (T.cat !== cat) {
        T.from = T.last; T.to = q; T.t = 0; T.cat = cat;
        if (this.pool && cat && T.from && blendCat(T.from.qa.name)) for (const w of [1 / 3, 2 / 3]) this.pool.request(`${q.key}<${T.from.key}@${w.toFixed(2)}`, this._job(q, pl, role, s, { a: T.from.qa, c: T.from.ctx, w }), 0);
      }
      T.last = q;
    } else if (i < 2) T = this.trans[i] = { cat, last: q, from: null, to: null, t: 1 };
    let key = q.key, from = null, blendQ = null;
    if (T && T.from && T.to && T.t < BLEND_T && cat && blendCat(T.from.qa.name)) {
      const w = T.t < BLEND_T / 2 ? 1 / 3 : 2 / 3;
      const bk = `${T.to.key}<${T.from.key}@${w.toFixed(2)}`;
      if (!this.pool || this.cache.has(bk)) { key = bk; from = { a: T.from.qa, c: T.from.ctx, w }; blendQ = T.to; }
    }
    let f = this._hit(key);
    const exact = !!f;
    if (!f) {
      if (!this.pool) {
        // synchronous fallback (no workers): render now within a per-frame budget, else show the nearest frame
        const near = this._nearest(q);
        if (this.syncSpent < SYNC_BUDGET_MS || !near || this.forceExact) { const t1 = performance.now(); f = this._renderSync(key, blendQ || q, pl, role, s, from); this.syncSpent += performance.now() - t1; } else f = near;
      } else {
        this.pool.request(key, this._job(q, pl, role, s, from), 0);
        f = this._nearest(q);
        if (f && f.fam === q.fam && Math.min(Math.abs(f.ph - q.ph), q.cyc ? q.cyc - Math.abs(f.ph - q.ph) : 99) <= 1) this.stats.fbNear++;
        if (!f) f = this.last[i] || EMPTY_FRAME(); // nothing of this player yet: draw nothing rather than block the frame
      }
    }
    // sprite anchor: locomotion frames are drawn where their (quantised) gait puts the body so the planted foot stays
    if (i < 2) {
      let sh = q.shift;
      if (!exact && f && q.cyc === RUN_Q && f.fam === q.fam && q.dirv && f.ph !== q.ph) {
        let dph = q.gs - f.ph; dph -= Math.round(dph / RUN_Q) * RUN_Q;
        const back = Math.max(-0.25, Math.min(0.25, dph / RUN_Q * q.L - strideCorrection(q.name, f.ph / RUN_Q, q.Lq, q.L)));
        sh = { x: -q.dirv.x * back, z: -q.dirv.z * back };
      }
      this.shift[i] = sh;
      this.last[i] = f; this.wasExact[i] = exact;
      if (exact) { if (this.fbRun[i]) { this.stats.fbRuns++; this.fbRun[i] = 0; } this.stats.exact++; } else { this.stats.fallback++; this.fbRun[i]++; this.stats.fbFrames++; const by = this.stats.fbBy || (this.stats.fbBy = {}); by[q.name] = (by[q.name] || 0) + 1; }
      if (this.debug && i === 0) { this.debug.push((exact ? 'E ' : 'F ') + key.split('|').slice(2, 14).join('|')); if (this.debug.length > 3000) this.debug.shift(); }
      const al = this.stats.allBy || (this.stats.allBy = {}); al[q.name] = (al[q.name] || 0) + 1;
    }
    if (this.pool) {
      // look-ahead: the next frames along gait / phase
      if (i < 2 && q.cyc === RUN_Q && !this.fam.has(q.fam)) for (let k = 5; k < RUN_Q; k += 2) {
        const qn = this.quant(i, pl, role, s, time, k);
        if (!this.cache.has(qn.key)) this.pool.request(qn.key, this._job(qn, pl, role, s, null), 1);
      }
      if (i < 2) for (const k of (q.cyc === RUN_Q ? [1, 2, 3, 4] : q.name === 'swing' ? [2, 4, 6] : q.name === 'serve' || q.name === 'bounce' || q.name === 'split' ? [1, 2, 3] : [1])) {
        const qn = this.quant(i, pl, role, s, time, k);
        if (qn.key !== q.key && !this.cache.has(qn.key)) this.pool.request(qn.key, this._job(qn, pl, role, s, null), 1);
      }
      if (this.autoWarm && i < 2) this._warmFor(pl, role, s);
      if (i === 0) this._feedWarm();
    }
    return f;
  }

  // ---- prewarm in the workers: likely frames at the player's current size / position
  _warmFor(pl, role, s) {
    const look = pl.look || DEFAULT_LOOK, hand = pl.hand || 'R';
    const a = pl.anim || {};
    const z = pl.pos ? Math.round(pl.pos.z) : 0;
    const wk = `${role}|${s}|${hand}|${z}|${lookKey(look)}`;
    if (this.warmed.has(wk)) return;
    // warm while the player is not in a rally move, or when nothing else is queued
    const calm = !LOCO.has(a.name) && a.name !== 'swing';
    if (!calm && (this.pool.pending(2) > 0 || this.warmQ.length)) return;
    this.warmed.add(wk);
    for (const it of this.warmList(pl, role, s)) this.warmQ.push({ ...it, role, s });
  }
  // feed the prewarm list to the workers a few entries per frame (keeps main-thread work ~0.1 ms)
  _feedWarm() {
    for (let n = 0; n < 16 && this.warmQ.length && this.pool.pending(2) < 32; n++) {
      const it = this.warmQ.shift();
      const q = this.quant(2, it.pl, it.role, it.s, it.time);
      if (!this.cache.has(q.key)) this.pool.request(q.key, this._job(q, it.pl, it.role, it.s, null), 2);
    }
  }
  warmList(pl, role, s) {
    const look = pl.look || DEFAULT_LOOK, hand = pl.hand || 'R', pos = pl.pos || { x: 0, z: role === 'near' ? 12 : -12 };
    const out = [];
    const P = (anim, time = 0) => out.push({ pl: { hand, look, pos, anim }, time });
    for (let k = 0; k < READY_Q; k++) P({ name: 'ready' }, ((k + 0.5) / READY_Q) * (Math.PI * 2 / 6.0));
    for (let k = 0; k <= 20; k += 2) P({ name: 'split', phase: k / 20 });
    const net = { x: 0, z: role === 'near' ? -1 : 1 };
    // typical sim values (game/player.js stride table: run 1.5+0.18v, crossover 1.5+0.05v, shuffle 0.9+0.04v ...)
    for (let d8 = 0; d8 < 8; d8++) {
      const ang = d8 * Math.PI / 4, dir = { x: Math.sin(ang), z: Math.cos(ang) };
      const lateral = Math.abs(dir.x) > 0.6, back = dir.z * net.z < -0.3;
      const xf = { x: dir.x * 0.6 + net.x * 0.4, z: dir.z * 0.6 + net.z * 0.4 }, xl = Math.hypot(xf.x, xf.z) || 1;
      for (let g = 0; g < RUN_Q; g++) {
        const G = g / RUN_Q;
        P({ name: 'run', gait: G, strideLen: 2.4, dir, face: dir, speed: 0.8, accel: 0 });
        if (lateral) P({ name: 'shuffle', gait: G, strideLen: 1.0, dir, face: net, speed: 0.4, accel: 0 });
        if (lateral) P({ name: 'crossover', gait: G, strideLen: 1.7, dir, face: { x: xf.x / xl, z: xf.z / xl }, speed: 0.6, accel: 0.6 });
        if (back) P({ name: 'backpedal', gait: G, strideLen: 1.1, dir, face: net, speed: 0.5, accel: 0 });
        if (lateral || back) P({ name: 'brake', gait: G, strideLen: 1.0, dir, face: net, speed: 0.3, accel: -1 });
      }
    }
    for (const [shot, side] of [['topspin', 'fh'], ['topspin', 'bh'], ['slice', 'fh'], ['slice', 'bh'], ['flat', 'fh'], ['flat', 'bh']]) {
      for (let k = 1; k <= SWING_Q; k += 2) P({ name: 'swing', shot, side, phase: k / SWING_Q });
    }
    return out;
  }

  // number of frames still being rendered (tests / loading screens)
  pendingCount() { return this.pool ? this.pool.inflight.size : 0; }
  // main-thread cost summary
  perf() {
    const m = [...this.stats.main].sort((x, y) => x - y), n = m.length;
    const pct = (p) => (n ? m[Math.min(n - 1, Math.floor(p * n))] : 0);
    const st = this.stats;
    return {
      workers: this.pool ? this.pool.workers.length : 0, frames: n, mainAvgMs: n ? +(m.reduce((a, b) => a + b, 0) / n).toFixed(3) : 0, mainP95Ms: +pct(0.95).toFixed(3), mainMaxMs: +(n ? m[n - 1] : 0).toFixed(2),
      rendered: st.frames, renderAvgMs: st.frames ? +(st.ms / st.frames).toFixed(1) : 0, syncRenders: st.sync,
      exactFrames: st.exact, fallbackFrames: st.fallback, fallbackNear: st.fbNear, fallbackRate: +(st.fallback / Math.max(1, st.exact + st.fallback)).toFixed(3),
      fallbackAvgRun: +(st.fbFrames / Math.max(1, st.fbRuns + (this.fbRun[0] ? 1 : 0) + (this.fbRun[1] ? 1 : 0))).toFixed(2), cacheMB: +(this.bytes / 1048576).toFixed(1), cached: this.cache.size, fallbackBy: st.fbBy, framesBy: st.allBy,
    };
  }
}
