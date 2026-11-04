// Gesture recognizer for the phone controller. DOM-free (runs in Node for tests).
//
// GRIP CONVENTION (see docs/CONTROLLER.md)
//   The phone is held like a racket: fist around the BOTTOM edge of the phone, the TOP edge is the
//   racket head, the screen plane is the racket face (device z = face normal). Neutral/ready pose:
//   head pointing forward and ~30 deg up, face vertical. Swing horizontally like a ground stroke.
//   Everything the swing classifier uses is expressed in WORLD frame quantities (gravity-referenced),
//   so it does not matter which face of the phone points at the ball (screen forehand/back of phone
//   backhand, or the other way round) nor how the phone is yawed.
//
// SAMPLES: { t (ms, monotonic), acc:{x,y,z} m/s2 (no gravity, optional), accG:{x,y,z} m/s2 (with gravity;
//   at rest reads +9.81 along world-up, W3C convention), rot:{alpha,beta,gamma} deg/s }.
//   Device frame: x right of screen, y toward top of screen, z out of screen; omega = (beta, gamma, alpha).
//
// EVENTS: {type:'tilt', x, z}  and  {type:'swing', shot, side, power, conf, ts, aimX, lift, spin, exec, speedDps, feat}
//   analog fields (DESIGN.md 6.2): aimX -1..1 face direction at contact vs. ready-pose heading (+ = player's right;
//   early contact = cross-court: R-fh/L-bh -> negative), lift 0..1 path elevation, spin -1 slice..+1 topspin,
//   exec 0..1 motion quality (feat.ex holds the sub-scores), speedDps = peak |omega|.
//   tilt x: +right, z: +toward camera (head tipped UP = back), z=-1 = head tipped down = toward net.
//   swing.ts is the sample time (ms) of peak |omega| (= contact). Emitted ~decisionMs after contact.

const DEG = Math.PI / 180;
const G = 9.81;

// ---------- small vector / quaternion helpers ----------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qnorm = (q) => { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };
const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
function qrot(q, v) { // rotate v by q
  const u = [q[1], q[2], q[3]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[0])), cross(u, t));
}
function qexp(w, dt) { // rotation quaternion for angular velocity w (rad/s) over dt
  const a = norm(w) * dt;
  if (a < 1e-9) return [1, w[0] * dt / 2, w[1] * dt / 2, w[2] * dt / 2];
  const s = Math.sin(a / 2) / norm(w);
  return [Math.cos(a / 2), w[0] * s, w[1] * s, w[2] * s];
}
function qFromTo(a, b) { // shortest rotation taking unit a to unit b
  const c = cross(a, b), d = dot(a, b);
  if (d < -0.999999) { const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const p = unit(cross(a, ax)); return [0, p[0], p[1], p[2]]; }
  return qnorm([1 + d, c[0], c[1], c[2]]);
}

// ---------- tunables ----------
export const DEFAULTS = Object.freeze({
  startDps: 200,       // |omega| (deg/s) to open a swing window
  endDps: 100,
  minPeakDps: 380,     // a window must reach this peak to count as a swing
  decisionMs: 70,      // time after peak before the event is emitted (follow-through features)
  refractoryMs: 450,
  maxWindowMs: 1500,
  quietAbortMs: 260,
  preRollMs: 120,
  powerLoDps: 300, powerHiDps: 1200,
  tiltDeadDeg: 5, tiltFullDeg: 28, tiltSmoothMs: 120, tiltHoldMs: 300, tiltRateHz: 30,
  tiltFreezeDps: 120,
  aimFullDeg: 30,      // face yaw (deg) at contact that maps to aimX = +-1
  accSign: 1,          // -1 for platforms whose accelerationIncludingGravity has inverted sign (older iOS)
  rotUnit: 'auto',     // 'deg' | 'rad' | 'auto'
});

// Feature vector order used by the classifier.
export const FEATURE_KEYS = ['rise', 'face', 'roll', 'dur', 'peak'];
// Default prototypes (physical reasoning, see docs/CONTROLLER.md): hand-path elevation angle at contact (deg),
// hitting-face elevation (deg, + = open/up), face roll rate (deg/s, - = closing), acceleration time (ms), peak |omega|.
const PROTO = {
  flat:    [2, 2, 5, 125, 900],
  topspin: [16, -10, -120, 160, 700],
  slice:   [-12, 21, 20, 170, 620],
  lob:     [24, 36, 75, 178, 560],
};
const PROTO_SCALE = [8, 10, 80, 40, 250];
const PROTO_W = [1, 1, 0.3, 0.15, 0.15];
const USER_W = [1, 1, 0.7, 0.5, 0.5];

export function createRecognizer(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let hand = opts.hand === 'L' ? 'L' : 'R';
  let calib = { v: 1, samples: { flat: [], topspin: [], slice: [], lob: [] }, aim: { fh: [], bh: [] } };
  let neutralExplicit = false;        // neutral captured by calibrateNeutral (vs. the grip-convention default)
  let neutralUp = null;                // device-frame world-up at neutral
  let axes = null;                     // {a, r} device-frame head / right axes
  if (opts.calibration) loadCalibration(opts.calibration);
  if (!neutralUp) setNeutral(defaultNeutral(hand));

  let q = null, prev = null;
  let rotUnit = cfg.rotUnit === 'rad' ? 'rad' : 'deg';
  let radVotes = 0, degVotes = 0;
  const buf = [];                      // processed samples
  let state = 'idle';                  // idle | active | cool
  let win = null;                      // {startT, peak, tPeak, tLast}
  let refractoryUntil = -Infinity;
  let lastSwing = null;
  let tiltHeld = [0, 0], tiltSm = [0, 0], tiltHoldUntil = -Infinity, lastTiltT = -Infinity, lastTiltSent = [NaN, NaN], lastTiltSentT = -Infinity;
  let tiltDeg = [0, 0];
  let wPrev = 0, sm = 0;

  function defaultNeutral(h) { return h === 'L' ? [-0.866, 0.5, 0] : [0.866, 0.5, 0]; }
  function setNeutral(u) {
    neutralUp = unit(u);
    // head axis: device axis with the largest horizontal projection, preferring +y (top of phone)
    const cands = [[0, 1, 0], [0, 0, -1], [1, 0, 0]];
    let a = null;
    for (const c of cands) {
      const p = sub(c, scale(neutralUp, dot(c, neutralUp)));
      if (norm(p) > 0.5) { a = unit(p); break; }
    }
    if (!a) a = unit(cross(neutralUp, [1, 0, 0]));
    axes = { a, r: unit(cross(a, neutralUp)) };
  }
  function loadCalibration(c) {
    if (!c) return;
    if (c.hand === 'L' || c.hand === 'R') hand = c.hand;
    if (c.neutralUp) { setNeutral(c.neutralUp); neutralExplicit = c.neutralExplicit !== false; }
    if (c.aim) for (const k of ['fh', 'bh']) calib.aim[k] = (c.aim[k] || []).filter(Number.isFinite);
    if (c.samples) for (const k of Object.keys(calib.samples)) calib.samples[k] = (c.samples[k] || []).filter((v) => Array.isArray(v) && v.length === FEATURE_KEYS.length);
  }

  function degPerSecOf(rot) {
    if (!rot) return [0, 0, 0];
    const k = (rotUnit === 'rad' ? 1 : DEG);
    return [(rot.beta || 0) * k, (rot.gamma || 0) * k, (rot.alpha || 0) * k];
  }

  // ---------- classification ----------
  function protoModel() {
    const means = {}, scales = PROTO_SCALE.slice(); let W = PROTO_W; let user = false;
    const labels = Object.keys(PROTO);
    for (const l of labels) means[l] = PROTO[l];
    const have = labels.filter((l) => calib.samples[l].length >= 2);
    if (have.length) {
      user = true; W = USER_W;
      for (const l of have) {
        const S = calib.samples[l];
        means[l] = FEATURE_KEYS.map((_, i) => S.reduce((a, v) => a + v[i], 0) / S.length);
      }
      // pooled std per dim over user-calibrated labels, floored at 40% of default scale
      for (let i = 0; i < scales.length; i++) {
        let ss = 0, n = 0;
        for (const l of have) { const S = calib.samples[l]; const m = means[l][i]; for (const v of S) { ss += (v[i] - m) ** 2; n++; } }
        const sd = Math.sqrt(ss / Math.max(1, n - have.length));
        scales[i] = Math.max(sd, PROTO_SCALE[i] * 0.4);
      }
    }
    return { means, scales, W, user };
  }
  function classify(vec) {
    const m = protoModel();
    const ds = Object.keys(m.means).map((l) => {
      let s = 0;
      for (let i = 0; i < vec.length; i++) s += m.W[i] * ((vec[i] - m.means[l][i]) / m.scales[i]) ** 2;
      return [l, Math.sqrt(s)];
    }).sort((a, b) => a[1] - b[1]);
    const d1 = ds[0][1], d2 = ds[1][1];
    let conf = clamp(1 - d1 / (d2 + 1e-9), 0, 1) * Math.exp(-Math.max(0, d1 - 2.5) * 0.4);
    return { shot: ds[0][0], conf, user: m.user, dists: ds };
  }

  // ---------- feature extraction over the buffered window ----------
  // Ready pose = last quiet sample before the backswing. Walk back from contact through the forward swing; once the
  // opposite-direction yaw of the backswing has been seen, the next quiet sample is the ready pose. Without a visible
  // backswing, the first quiet sample before the forward swing is used. Only gyro integration inside this
  // ~0.5-1.5 s span matters for the heading, so yaw drift is negligible.
  function findReady(ci, sgn) {
    let phase = 0, backPeak = 0, firstQuiet = -1;
    for (let i = ci; i >= 0; i--) {
      const b = buf[i], y = (b.ww[2] / DEG) * sgn;
      if (phase === 0) {                       // forward swing (+ pause at the top of the backswing)
        if (y < -60) { phase = 1; backPeak = b.w; } else if (b.w < 80 && firstQuiet < 0) firstQuiet = i;
      } else if (phase === 1) {                // inside the backswing, walking back towards its peak
        if (b.w > backPeak) backPeak = b.w; else if (b.w < 0.6 * backPeak) phase = 2;
      } else if (b.w < Math.max(40, 0.15 * backPeak)) return { b, how: 'ready' };   // start of the backswing
    }
    if (phase > 0) return { b: buf[0], how: 'buffer-start' };
    return firstQuiet >= 0 ? { b: buf[firstQuiet], how: 'no-backswing' } : null;
  }
  // residual RMS of y against a local quadratic fit over +-halfMs (sample-rate independent smoothness measure)
  function quadResidual(ts, ys, i0, i1, halfMs) {
    let ss = 0, n = 0;
    for (let i = i0; i <= i1; i++) {
      let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
      for (let j = 0; j < ts.length; j++) {
        const x = (ts[j] - ts[i]) / halfMs;
        if (Math.abs(x) > 1) continue;
        const y = ys[j], x2 = x * x;
        S0++; S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2; T0 += y; T1 += x * y; T2 += x2 * y;
      }
      if (S0 < 4) continue;
      // solve 3x3 normal equations for y ~ c0 + c1 x + c2 x^2, evaluate at x=0 -> c0
      const M = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], r = [T0, T1, T2];
      const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const d = det(M); if (Math.abs(d) < 1e-9) continue;
      const c0 = det([[r[0], M[0][1], M[0][2]], [r[1], M[1][1], M[1][2]], [r[2], M[2][1], M[2][2]]]) / d;
      ss += (ys[i] - c0) ** 2; n++;
    }
    return n ? Math.sqrt(ss / n) : 0;
  }

  function features(startIdx, ci) {
    const c = buf[ci];
    // hand/phone velocity in a yaw-arbitrary world frame, integrated from window start
    let v = [0, 0, 0];
    for (let i = startIdx + 1; i <= ci; i++) {
      const dt = (buf[i].t - buf[i - 1].t) / 1000;
      v = add(v, scale(add(buf[i - 1].lw, buf[i].lw), 0.5 * dt));
    }
    const vH = Math.hypot(v[0], v[1]);
    const rise = Math.atan2(v[2], Math.max(vH, 0.3)) / DEG;
    const n = qrot(c.q, [0, 0, 1]);
    let s = 1;
    if (vH > 0.4) s = (n[0] * v[0] + n[1] * v[1]) >= 0 ? 1 : -1;
    const face = Math.asin(clamp(s * n[2], -1, 1)) / DEG;
    // yaw (about world up) and face roll rate averaged around the peak
    let yaw = 0, roll = 0, cnt = 0;
    for (let i = Math.max(0, ci - 1); i <= Math.min(buf.length - 1, ci + 1); i++) { yaw += buf[i].ww[2]; cnt++; }
    yaw = yaw / cnt / DEG;
    cnt = 0;
    for (let i = Math.max(0, ci - 2); i <= Math.min(buf.length - 1, ci + 1); i++) {
      const ni = qrot(buf[i].q, [0, 0, 1]);
      roll += s * (buf[i].ww[0] * ni[1] - buf[i].ww[1] * ni[0]); cnt++;
    }
    roll = roll / cnt / DEG;
    let i25 = ci;
    for (let i = ci; i >= startIdx; i--) { if (buf[i].w >= 0.25 * c.w) i25 = i; else break; }
    const dur = c.t - buf[i25].t;

    // ---- direction: hitting-face normal at contact vs forward heading at the ready pose ----
    const nh = [s * n[0], s * n[1]], nhn = Math.hypot(nh[0], nh[1]);
    let aimDeg = 0, aimOk = false, squareDeg = 0, readyHow = null, readyMs = null;
    const rd = findReady(ci, Math.sign(yaw) || 1);
    if (rd) {
      readyHow = rd.how; readyMs = c.t - rd.b.t;
      const f = qrot(rd.b.q, headAxisDev());
      const fn = Math.hypot(f[0], f[1]);
      // face pointing direction in the horizontal plane: perpendicular to the racket's (horizontal) long axis, on the
      // hitting side. Unlike the raw normal this does not yaw when the face is opened/closed about the long axis.
      const l = qrot(c.q, [0, 1, 0]), lhn = Math.hypot(l[0], l[1]);
      let d = null;
      if (lhn > 0.35) {
        d = [-l[1] / lhn, l[0] / lhn];
        const ref = nhn > 0.2 ? nh : [v[0], v[1]];
        if (d[0] * ref[0] + d[1] * ref[1] < 0) d = [-d[0], -d[1]];
      } else if (nhn > 0.3) d = [nh[0] / nhn, nh[1] / nhn];
      if (fn > 0.3 && d) {
        const fx = f[0] / fn, fy = f[1] / fn, rx = fy, ry = -fx;       // right = forward x up
        aimDeg = Math.atan2(d[0] * rx + d[1] * ry, d[0] * fx + d[1] * fy) / DEG; aimOk = true;
      }
    }
    // sub-sample contact time: parabolic interpolation of |omega| around the peak sample
    let dtPk = 0;
    if (ci > 0 && ci < buf.length - 1) {
      const a0 = buf[ci - 1].w, a1 = c.w, a2 = buf[ci + 1].w, den = a0 - 2 * a1 + a2;
      if (den < 0) { const d = clamp(0.5 * (a0 - a2) / den, -0.5, 0.5); dtPk = d * (d > 0 ? buf[ci + 1].t - c.t : c.t - buf[ci - 1].t); }
    }
    if (aimOk) aimDeg -= yaw * dtPk / 1000;           // + yaw turns the face to the left
    if (vH > 0.4 && nhn > 0.3) squareDeg = Math.acos(clamp((nh[0] * v[0] + nh[1] * v[1]) / (nhn * vH), -1, 1)) / DEG;

    // ---- execution: face stability, smooth acceleration, follow-through, duration ----
    const lastI = buf.length - 1;
    const fT = [], fE = [];
    for (let i = Math.max(0, ci - 12); i <= Math.min(lastI, ci + 12); i++) {
      if (Math.abs(buf[i].t - c.t) > 60) continue;
      const ni = qrot(buf[i].q, [0, 0, 1]);
      fT.push(buf[i].t); fE.push(Math.asin(clamp(s * ni[2], -1, 1)) / DEG);
    }
    let wobble = 0;
    if (fT.length >= 4) {   // residual RMS about a straight line (the face may rotate steadily, but should not wobble)
      const mt = fT.reduce((a, x) => a + x, 0) / fT.length, me = fE.reduce((a, x) => a + x, 0) / fE.length;
      let sxy = 0, sxx = 0;
      for (let k = 0; k < fT.length; k++) { sxy += (fT[k] - mt) * (fE[k] - me); sxx += (fT[k] - mt) ** 2; }
      const b1 = sxx ? sxy / sxx : 0;
      wobble = Math.sqrt(fE.reduce((a, e, k) => a + (e - (me + b1 * (fT[k] - mt))) ** 2, 0) / fE.length);
    }
    let i1 = ci; while (i1 < lastI && buf[i1 + 1].t <= c.t + 70) i1++;
    const ts = [], ws = [];
    for (let i = Math.max(0, i25 - 2); i <= Math.min(lastI, i1 + 2); i++) { ts.push(buf[i].t); ws.push(buf[i].w); }
    const off = i25 - Math.max(0, i25 - 2);
    const rough = quadResidual(ts, ws, off, off + (i1 - i25), 45) / c.w;
    let dips = 0;
    for (let i = i25 + 1; i <= ci; i++) dips += Math.max(0, buf[i - 1].w - buf[i].w);
    const nonMono = dips / c.w;
    let pre = 0, nPre = 0, post = 0, nPost = 0;
    for (let i = Math.max(0, ci - 12); i <= Math.min(lastI, ci + 12); i++) {
      const dt = buf[i].t - c.t;
      if (dt < 0 && dt >= -70) { pre += buf[i].w; nPre++; } else if (dt > 0 && dt <= 70) { post += buf[i].w; nPost++; }
    }
    const follow = nPre && nPost ? Math.min(1.3, (post / nPost) / (pre / nPre)) : 1;
    return { yaw, rise, face, roll, dur, peak: c.w, dtPk, vH, vUp: v[2], aimDeg, aimOk, squareDeg, wobble, rough, nonMono, follow, readyHow, readyMs };
  }

  function headAxisDev() {
    if (neutralExplicit) return axes.a;
    const p = sub([0, 1, 0], scale(neutralUp, dot([0, 1, 0], neutralUp)));
    return norm(p) > 0.3 ? [0, 1, 0] : axes.a;
  }

  // ---- continuous outputs (DESIGN.md 6.2) ----
  const spinRaw = (f) => f.brush / 32 - f.roll / 450;     // brush = path elevation - face elevation (deg)
  function userMeans() {
    const m = {};
    for (const l of Object.keys(calib.samples)) {
      const S = calib.samples[l];
      if (S.length >= 2) m[l] = FEATURE_KEYS.map((_, i) => S.reduce((a, v) => a + v[i], 0) / S.length);
    }
    return m;
  }
  function analog(f) {
    const um = userMeans();
    const asF = (v) => ({ rise: v[0], face: v[1], roll: v[2], brush: v[0] - v[1], peak: v[4] });
    // spin
    const x = spinRaw({ brush: f.rise - f.face, roll: f.roll });
    let spin = Math.tanh(x);
    if (um.flat && um.topspin && um.slice) {
      const xf = spinRaw(asF(um.flat)), xt = spinRaw(asF(um.topspin)), xs = spinRaw(asF(um.slice));
      if (xt - xf > 0.15 && xf - xs > 0.15) spin = Math.tanh(0.973 * (x >= xf ? (x - xf) / (xt - xf) : (x - xf) / (xf - xs)));  // centroids -> +-0.75
    }
    // lift
    let lift = clamp(f.rise / 38, 0, 1);
    if (um.flat && um.lob && um.lob[0] - um.flat[0] > 8) lift = clamp(0.85 * (f.rise - um.flat[0]) / (um.lob[0] - um.flat[0]), 0, 1);
    // power (relative to the user's own drive speed when calibrated)
    let lo = cfg.powerLoDps, hi = cfg.powerHiDps;
    const drives = [um.flat, um.topspin].filter(Boolean);
    if (drives.length) { const ref = drives.reduce((a, v) => a + v[4], 0) / drives.length; lo = 0.35 * ref; hi = clamp(1.3 * ref, 600, 1600); }
    const power = clamp(0.2 + 0.8 * (f.peak - lo) / (hi - lo), 0.05, 1);
    // aim: subtract the user's habitual face angle per side (calibration swings are aimed straight)
    let aimDeg = f.aimDeg;
    const side = (f.yaw > 0) === (hand === 'R') ? 'fh' : 'bh';
    const A = calib.aim[side];
    if (A.length >= 3) aimDeg -= clamp(A.reduce((a, x) => a + x, 0) / A.length, -20, 20);
    const aimX = f.aimOk ? clamp(aimDeg / cfg.aimFullDeg, -1, 1) : 0;
    // execution quality
    const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);           // 0 at a, 1 at b
    const ex = {
      face: 1 - ramp(f.wobble, 0.8, 3.5),
      square: 1 - ramp(f.squareDeg, 20, 50),
      smooth: 1 - ramp(f.rough + 0.5 * f.nonMono, 0.03, 0.15),
      follow: ramp(f.follow, 0.55, 0.9),
      dur: f.dur < 70 ? ramp(f.dur, 30, 70) : 1 - ramp(f.dur, 320, 470),
    };
    const exec = clamp(1 - 0.3 * (1 - ex.face) - 0.15 * (1 - ex.square) - 0.45 * (1 - ex.smooth) - 0.6 * (1 - ex.follow) - 0.3 * (1 - ex.dur), 0, 1);
    return { aimX, aimDeg, lift, spin, power, exec, ex };
  }

  function emitSwing(out) {
    const tPeak = win.tPeak;
    let ci = buf.length - 1;
    while (ci > 0 && buf[ci].t > tPeak) ci--;
    let si = 0;
    for (let i = 0; i < buf.length; i++) { if (buf[i].t >= win.startT) { si = i; break; } }
    si = Math.min(si, ci);
    const f = features(si, ci);
    const vec = [f.rise, f.face, f.roll, f.dur, f.peak];
    const cl = classify(vec);
    const fh = (f.yaw > 0) === (hand === 'R');
    const sideConf = clamp(Math.abs(f.yaw) / (f.peak + 1e-9), 0, 1);
    const an = analog(f);
    const r2 = (x) => Math.round(x * 100) / 100;
    const feat = { ...f, sideConf, vec, ex: an.ex };
    for (const k of Object.keys(feat)) if (typeof feat[k] === 'number') feat[k] = r2(feat[k]);
    feat.vec = vec.map(r2);
    feat.ex = Object.fromEntries(Object.entries(an.ex).map(([k, x]) => [k, r2(x)]));
    const ev = { type: 'swing', shot: cl.shot, side: fh ? 'fh' : 'bh', power: r2(an.power),
      conf: r2(cl.conf * sideConf ** 0.5), ts: tPeak + f.dtPk,
      aimX: r2(an.aimX), lift: r2(an.lift), spin: r2(an.spin), exec: r2(an.exec), speedDps: Math.round(f.peak), feat };
    lastSwing = ev;
    out.push(ev);
  }

  function updateTilt(t, out, u, w) {
    // pitch: head up/down; roll: bank right/left (see header)
    const pitch = Math.asin(clamp(dot(axes.a, u), -1, 1)) / DEG;
    const roll = Math.asin(clamp(-dot(axes.r, u), -1, 1)) / DEG;
    const frozen = state !== 'idle' || t < tiltHoldUntil || w > cfg.tiltFreezeDps;
    if (!frozen) tiltHeld = [roll, pitch];
    tiltDeg = [roll, pitch];
    const f = (d) => { const a = Math.abs(d); const k = clamp((a - cfg.tiltDeadDeg) / (cfg.tiltFullDeg - cfg.tiltDeadDeg), 0, 1); return Math.sign(d) * k; };
    const target = [f(tiltHeld[0]), f(tiltHeld[1])];
    const dt = lastTiltT === -Infinity ? 0 : Math.min(0.1, (t - lastTiltT) / 1000);
    lastTiltT = t;
    const a = 1 - Math.exp(-dt * 1000 / cfg.tiltSmoothMs);
    tiltSm = [tiltSm[0] + (target[0] - tiltSm[0]) * a, tiltSm[1] + (target[1] - tiltSm[1]) * a];
    if (t - lastTiltSentT >= 1000 / cfg.tiltRateHz) {
      const x = Math.round(tiltSm[0] * 100) / 100, z = Math.round(tiltSm[1] * 100) / 100;
      if (x !== lastTiltSent[0] || z !== lastTiltSent[1] || t - lastTiltSentT > 300) {
        out.push({ type: 'tilt', x: x || 0, z: z || 0 });
        lastTiltSent = [x, z]; lastTiltSentT = t;
      }
    }
  }

  function push(s) {
    const out = [];
    const t = s.t;
    if (!(s.accG || s.acc)) return out;
    let dt = prev ? (t - prev.t) / 1000 : 0;
    if (prev && (dt <= 0 || dt > 0.25)) { if (dt > 0.25) { q = null; buf.length = 0; state = 'idle'; win = null; } dt = 0; }
    const sign = cfg.accSign;
    const gA = s.accG ? [s.accG.x * sign, s.accG.y * sign, s.accG.z * sign] : null;
    const lA = s.acc ? [s.acc.x * sign, s.acc.y * sign, s.acc.z * sign] : null;
    let om = degPerSecOf(s.rot);
    const omMagDeg = norm(om) / DEG;
    // unit auto-detect: a vigorous motion (>30 m/s2 linear) with a small gyro reading means rad/s
    if (cfg.rotUnit === 'auto' && s.rot) {
      const la = gA ? Math.abs(norm(gA) - G) : (lA ? norm(lA) : 0);
      const reading = rotUnit === 'deg' ? omMagDeg : omMagDeg / DEG;
      if (la > 30 && reading > 2 && reading < 25) radVotes++;
      if (reading > 70) degVotes++;
      if (rotUnit === 'deg' && radVotes >= 3 && degVotes === 0) { rotUnit = 'rad'; om = degPerSecOf(s.rot); }
    }
    // ---- orientation ----
    if (!q) {
      const up0 = gA ? unit(gA) : [0, 0, 1];
      q = qFromTo(up0, [0, 0, 1]);
    } else if (dt > 0) {
      const wavg = prev ? scale(add(prev.om, om), 0.5) : om;
      q = qnorm(qmul(q, qexp(wavg, dt)));
      if (gA) {
        const gm = norm(gA);
        if (Math.abs(gm - G) < 1.0 && norm(om) < 2.0) {
          const upPred = qrot(qconj(q), [0, 0, 1]);
          const d = cross(unit(gA), upPred);
          q = qnorm(qmul(q, qexp(scale(d, 2.5), dt)));
        }
      }
    }
    const upDev = qrot(qconj(q), [0, 0, 1]);
    const linDev = gA ? sub(gA, scale(upDev, G)) : lA;
    const w = norm(om) / DEG;
    const rec = { t, q, om, w, lw: qrot(q, linDev), ww: qrot(q, om), up: upDev };
    prev = { t, om };
    buf.push(rec);
    while (buf.length && t - buf[0].t > 3000) buf.shift();
    sm = 0.5 * (w + wPrev); wPrev = w;

    // ---- swing state machine ----
    if (state === 'cool') { if (t > refractoryUntil && sm < cfg.startDps) state = 'idle'; }
    if (state === 'idle') {
      if (sm > cfg.startDps && t > refractoryUntil) {
        state = 'active';
        win = { startT: t - cfg.preRollMs, peak: w, tPeak: t, tLast: t, t0: t };
      }
    } else if (state === 'active') {
      if (w > win.peak) { win.peak = w; win.tPeak = t; }
      if (sm > cfg.endDps) win.tLast = t;
      const sinceP = t - win.tPeak;
      if (win.peak >= cfg.minPeakDps && ((sinceP >= cfg.decisionMs && sm < 0.75 * win.peak) || sinceP >= cfg.decisionMs * 2.2)) {
        emitSwing(out);
        refractoryUntil = win.tPeak + cfg.refractoryMs;
        tiltHoldUntil = t + cfg.tiltHoldMs;
        state = 'cool'; win = null;
      } else if (win.peak < cfg.minPeakDps && t - win.tLast > cfg.quietAbortMs) {
        state = 'idle'; win = null;
      } else if (t - win.t0 > cfg.maxWindowMs) {
        state = 'cool'; refractoryUntil = t + 300; win = null; tiltHoldUntil = t + cfg.tiltHoldMs;
      }
    }
    updateTilt(t, out, upDev, w);
    return out;
  }

  // ---------- calibration ----------
  function calibrateNeutral(windowMs = 1000, force = false) {
    const t1 = buf.length ? buf[buf.length - 1].t : 0;
    const win = buf.filter((b) => t1 - b.t <= windowMs);
    if (win.length < 8 || (win[win.length - 1].t - win[0].t) < windowMs * 0.7) return { ok: false, reason: 'not-enough-data', spreadDeg: null };
    let m = [0, 0, 0];
    for (const b of win) m = add(m, b.up);
    m = unit(m);
    let spread = 0, wMean = 0;
    for (const b of win) { spread = Math.max(spread, Math.acos(clamp(dot(b.up, m), -1, 1)) / DEG); wMean += b.w; }
    wMean /= win.length;
    const ok = spread < 4 && wMean < 40;
    if (ok || force) {
      setNeutral(m); neutralExplicit = true;
      tiltHeld = [0, 0]; tiltSm = [0, 0];
    }
    return { ok, reason: ok ? null : 'moving', spreadDeg: Math.round(spread * 10) / 10, wMean: Math.round(wMean), up: m };
  }
  function stillness(windowMs = 500) {
    const t1 = buf.length ? buf[buf.length - 1].t : 0;
    const win = buf.filter((b) => t1 - b.t <= windowMs);
    if (win.length < 4) return { still: false, spreadDeg: 99, wMean: 999 };
    let m = [0, 0, 0], wMean = 0;
    for (const b of win) { m = add(m, b.up); wMean += b.w; }
    m = unit(m); let spread = 0;
    for (const b of win) spread = Math.max(spread, Math.acos(clamp(dot(b.up, m), -1, 1)) / DEG);
    wMean /= win.length;
    return { still: spread < 4 && wMean < 40, spreadDeg: spread, wMean };
  }
  function addCalibrationSwing(label, ev = lastSwing) {
    if (!(label in calib.samples)) throw new Error('bad label ' + label);
    if (!ev || !ev.feat || !ev.feat.vec) return false;
    calib.samples[label].push(ev.feat.vec.slice());
    if (ev.feat.aimOk && (ev.side === 'fh' || ev.side === 'bh')) calib.aim[ev.side].push(ev.feat.aimDeg);
    return true;
  }
  function clearCalibration(label) {
    for (const k of Object.keys(calib.samples)) if (!label || label === k) calib.samples[k] = [];
    if (!label) calib.aim = { fh: [], bh: [] };
  }
  function exportCalibration() {
    return { v: 1, hand, neutralUp: neutralUp.slice(), neutralExplicit, samples: JSON.parse(JSON.stringify(calib.samples)), aim: JSON.parse(JSON.stringify(calib.aim)) };
  }

  return {
    push, calibrateNeutral, stillness, addCalibrationSwing, clearCalibration, exportCalibration,
    loadCalibration, setHand(h) { hand = h === 'L' ? 'L' : 'R'; },
    get hand() { return hand; },
    get lastSwing() { return lastSwing; },
    get calibratedCount() { return Object.fromEntries(Object.entries(calib.samples).map(([k, v]) => [k, v.length])); },
    debug() { return { state, w: wPrev, tiltDeg: tiltDeg.slice(), rotUnit, tilt: tiltSm.slice() }; },
    classify,
    reset() { q = null; prev = null; buf.length = 0; state = 'idle'; win = null; refractoryUntil = -Infinity; },
  };
}
