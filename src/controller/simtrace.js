// Physically-consistent synthetic IMU generator (rigid phone = racket, arm pivoting about a shoulder).
// Used by tests/gesture.test.mjs and by the controller's ?sim=1 desktop simulator.
// Independent of gesture.js on purpose (own rotation maths) so the tests are not self-confirming.
//
// World: x = right, y = forward (toward net), z = up. Phone device axes: x right of screen, y top of screen
// (racket head), z out of screen. Orientation is built from (head axis l, hitting-face normal n).
// Sensors are derived from the pose by finite differences at 1 kHz: gyro = body-frame angular velocity,
// accelerometer = R^T (a_world + g up) with a_world the second derivative of the sensor position
// (centripetal + tangential terms therefore come out right), plus noise.

const DEG = Math.PI / 180;
const G = 9.81;

// ---- tiny matrix helpers (3x3 row-major arrays) ----
const v3 = (x, y, z) => [x, y, z];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vunit = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const fromCols = (ex, ey, ez) => [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
const mT = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const mmul = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
function rodrigues(axis, ang) { // rotation matrix
  const [x, y, z] = vunit(axis), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
function rotAxisAngle(m) { // rotation vector (axis*angle) of rotation matrix
  const tr = m[0] + m[4] + m[8];
  const c = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const a = Math.acos(c);
  if (a < 1e-9) return [(m[7] - m[5]) / 2, (m[2] - m[6]) / 2, (m[3] - m[1]) / 2];
  const k = a / (2 * Math.sin(a));
  return [(m[7] - m[5]) * k, (m[2] - m[6]) * k, (m[3] - m[1]) * k];
}
const rotVec = (w) => { const a = Math.hypot(w[0], w[1], w[2]); return a < 1e-12 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : rodrigues(w, a); };
function mslerp(A, B, u) { const d = rotAxisAngle(mmul(mT(A), B)); return mmul(A, rotVec(vmul(d, u))); }
const minJerk = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (10 - 15 * t + 6 * t * t); };

export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const n = () => { let a = 0; for (let i = 0; i < 6; i++) a += u(); return (a - 3) / Math.sqrt(0.5); };
  return { u, n, range: (a, b) => a + (b - a) * u(), pick: (arr) => arr[Math.floor(u() * arr.length)] };
}

// ---- swing archetypes (reference = CCW swing of a right-hander's forehand) ----
// dpsi: sweep of the arm azimuth (deg); dtheta: change of arm elevation over the sweep (= swing-plane tilt:
// hand-path elevation at contact ~ atan(dtheta/dpsi)); ec/de: hitting-face elevation at contact and its change.
export const ARCHETYPES = {
  flat:    { D: 0.38, dpsi: 170, dtheta: 8,   ec: 2,  ecSd: 5, de: 0 },
  topspin: { D: 0.46, dpsi: 165, dtheta: 75,  ec: -8, ecSd: 6, de: -35 },
  slice:   { D: 0.50, dpsi: 150, dtheta: -55, ec: 22, ecSd: 6, de: 10 },
  lob:     { D: 0.52, dpsi: 130, dtheta: 100, ec: 42, ecSd: 7, de: 30 },
};
const ARM = 0.40, GRIP_TO_SENSOR = 0.075, WARP = 1.15;

// peak of the speed profile d/dtau minJerk(tau^WARP): contact (peak |omega|) happens there
const PROFILE = (() => {
  let best = 0, tPk = 0.5;
  for (let i = 1; i < 4000; i++) {
    const t = i / 4000, h = 1e-4;
    const v = (minJerk(Math.pow(t + h, WARP)) - minJerk(Math.pow(t - h, WARP))) / (2 * h);
    if (v > best) { best = v; tPk = t; }
  }
  return { tPk, sDotPk: best, sPk: minJerk(Math.pow(tPk, WARP)) };
})();
export const SWING_PROFILE = PROFILE;
const TRUNC_T = 0.035;   // s: time constant of the abrupt stop of a truncated follow-through

// progression s(tau) of the swing, including optional jerkiness and truncated follow-through
function sOf(P, tau) {
  tau = Math.max(0, Math.min(1, tau));
  let s = minJerk(Math.pow(tau, WARP));
  if (P.trunc > 0 && tau > PROFILE.tPk) {
    const dt = (tau - PROFILE.tPk) * P.D;
    const sStop = PROFILE.sPk + (PROFILE.sDotPk / P.D) * TRUNC_T * (1 - Math.exp(-dt / TRUNC_T));
    s += P.trunc * (sStop - s);
  }
  if (P.jerk > 0) s += P.jerk * 0.02 * Math.sin(2 * Math.PI * 14 * tau * P.D + (P.jph || 0)) * Math.sin(Math.PI * tau) ** 2;
  return s;
}
function swingGeometry(P, tau) { // reference (CCW) geometry; tau in [0,1]
  const s = sOf(P, tau);
  const psi = (P.psi0 + P.dpsi * s) * DEG;
  const th = (P.theta0 + P.dtheta * s) * DEG;
  let eDeg = P.e0 + P.de * s;
  if (P.jerk > 0) eDeg += P.jerk * 5 * Math.sin(2 * Math.PI * 11 * tau * P.D + (P.jph || 0) * 1.7) * Math.sin(Math.PI * Math.max(0, Math.min(1, tau))) ** 2;
  return geom(psi, th, P.thl * DEG, eDeg * DEG, 0.25 * Math.min(1, s), P.zoff || 0);
}
function geom(psi, th, thl, e, body, zoff) {
  const l = [Math.cos(thl) * Math.cos(psi), Math.cos(thl) * Math.sin(psi), Math.sin(thl)];
  const tang = [-Math.sin(psi), Math.cos(psi), 0];
  const nb = vadd(vmul(tang, Math.cos(e)), [0, 0, Math.sin(e)]);
  const n = vunit(vsub(nb, vmul(l, vdot(nb, l))));
  const d = [Math.cos(th) * Math.cos(psi), Math.cos(th) * Math.sin(psi), Math.sin(th)];
  const S = [0.2, 0, 1.3 + zoff];
  const p = vadd(vadd(vadd(S, [0, body, 0]), vmul(d, ARM)), vmul(l, GRIP_TO_SENSOR));
  return { l, n, p };
}
const mirrorX = (g) => ({ l: [-g.l[0], g.l[1], g.l[2]], n: [-g.n[0], g.n[1], g.n[2]], p: [-g.p[0], g.p[1], g.p[2]] });
const toR = (g, fz) => fromCols(vunit(vcross(g.l, vmul(g.n, fz))), g.l, vmul(g.n, fz));

export class PhoneSim {
  constructor({ hand = 'R', hz = 100, seed = 1, flip = false, noise = 1 } = {}) {
    this.hand = hand; this.hz = hz; this.flip = flip; this.noiseK = noise;
    this.rng = makeRng(seed);
    this.tick = 0; this.acc = 0;
    this.tiltTarget = [0, 0]; this.tilt = [0, 0]; // [pitchDeg head-up+, rollDeg bank-right+]
    this.script = null; this.walk = null;
    this.hist = [];
    this.gyroBias = [this.rng.n() * 0.4, this.rng.n() * 0.4, this.rng.n() * 0.4];
    this.tremPh = [this.rng.u() * 6.28, this.rng.u() * 6.28, this.rng.u() * 6.28];
    this.contactTrue = null;
  }
  setTilt(pitchDeg, rollDeg) { this.tiltTarget = [pitchDeg, rollDeg]; }
  setWalk(cfg) { this.walk = cfg ? { t0: this.tick, bob: cfg.bob ?? 0.025, f: cfg.f ?? 2, sway: cfg.sway ?? 8, swayF: cfg.swayF ?? 1.1, arm: cfg.arm ?? 6 } : null; }
  get busy() { return !!this.script; }

  neutralGeom(mirror) {
    const [pitch, roll] = this.tilt;
    let g = geom(90 * DEG, 0, (30 + pitch) * DEG, 0, 0, 0);
    if (mirror) g = mirrorX(g);
    if (roll) { const Rb = rodrigues(g.l, roll * DEG); g = { ...g, n: mv(Rb, g.n) }; }
    return g;
  }
  neutralR() { return toR(this.neutralGeom(this.hand === 'L'), this.flip ? -1 : 1); }

  // Start a swing; returns ground truth (contact time is filled in once known, see truth.contactT).
  // Analog knobs (all optional; default = archetype with random jitter):
  //   contactYaw (deg, + = early: face already turned across the body, i.e. cross-court), pathDeg (hand-path elevation
  //   at contact), faceDeg (hitting-face elevation at contact, + = open), rollDps (face elevation rate at contact,
  //   - = closing / rolling over), jerk 0..1 (shaky, uneven acceleration + face wobble), truncate 0..1 (abrupt stop
  //   right after contact instead of a follow-through).
  startSwing({ shot = 'flat', side = 'fh', speed = 1, sloppy = 0, contactYaw = null, pathDeg = null, faceDeg = null, rollDps = null,
    jerk = 0, truncate = 0, extra = {} } = {}) {
    const A = ARCHETYPES[shot], r = this.rng;
    const mirrorGeo = (this.hand === 'R') === (side === 'bh');
    const sp = speed * r.range(0.9 - 0.25 * sloppy, 1.15 + 0.3 * sloppy);
    const D = A.D / sp * r.range(0.92, 1.1);
    const sc = PROFILE.sPk;
    const dpsi = A.dpsi * r.range(0.9, 1.1);
    const dtheta = pathDeg !== null ? dpsi * Math.tan(pathDeg * DEG)
      : A.dtheta * r.range(0.8 - 0.25 * sloppy, 1.2 + 0.25 * sloppy) + r.n() * (4 + 14 * sloppy);
    const ec = faceDeg !== null ? faceDeg : A.ec + r.n() * A.ecSd * (1 + 1.2 * sloppy);
    const de = rollDps !== null ? rollDps * D / PROFILE.sDotPk : A.de * r.range(0.7 - 0.4 * sloppy, 1.3 + 0.4 * sloppy);
    const psiC = contactYaw !== null ? contactYaw : r.n() * 4 * (1 + sloppy);
    const thc = r.n() * 5 * (1 + 2 * sloppy);               // arm elevation at contact
    const P = { psi0: psiC - dpsi * sc, dpsi, theta0: thc - dtheta * sc, dtheta, e0: ec - de * sc, de, D,
      jerk, trunc: truncate, jph: r.u() * 6.28,
      thl: 22 + r.n() * 8 * (1 + sloppy), zoff: r.n() * 0.04, ...extra };
    const fz = (side === 'fh' ? 1 : -1) * (this.flip ? -1 : 1);
    // backswing duration: keep its peak angular speed (~1.875*angle/T for a min-jerk move) below ~280 deg/s
    const backAngle = Math.hypot(90 - P.psi0, P.theta0, P.e0, P.thl - 30);
    const prep = Math.max(r.range(0.9, 1.25), 1.875 * backAngle / 280), hold = r.range(0.08, 0.2);
    const Rn0 = toR(this.neutralGeom(this.hand === 'L'), this.flip ? -1 : 1);
    const gn0 = this.neutralGeom(this.hand === 'L');
    const g0 = swingGeometry(P, 0), g0m = mirrorGeo ? mirrorX(g0) : g0;
    const Rs = toR(g0m, fz);
    const truth = { contactT: null, shot, side, hand: this.hand, speed: sp, D,
      contactYaw: psiC, aimDeg: mirrorGeo ? psiC : -psiC,          // + = face points to the player's right
      pathDeg: Math.atan2(dtheta, dpsi) / DEG, faceDeg: ec, rollDps: de * PROFILE.sDotPk / D, jerk, truncate };
    this.script = { t0: this.tick, prep, hold, D, P, mirrorGeo, fz, Rn0, pn0: gn0.p, Rs, ps: g0m.p, follow: 0.25, ret: 0.9, truth };
    this.contactTrack = { best: 0, t: 0 };
    return truth;
  }

  poseAt(tk) {
    const t = tk / 1000;
    const sc = this.script;
    let R, p;
    if (!sc) {
      const g = this.neutralGeom(this.hand === 'L');
      R = toR(g, this.flip ? -1 : 1); p = g.p;
      if (this.walk) {
        const w = (tk - this.walk.t0) / 1000, W = this.walk, env = Math.min(1, w / 1.0);
        p = vadd(p, [0, env * 0.01 * Math.sin(2 * Math.PI * W.f * w), env * W.bob * Math.sin(2 * Math.PI * W.f * w)]);
        const a1 = env * W.sway * DEG * Math.sin(2 * Math.PI * W.swayF * w), a2 = env * W.arm * DEG * Math.sin(2 * Math.PI * W.f * w + 1);
        R = mmul(rotVec([a2, 0, a1]), R);   // world-frame wobble about x and z
        R = mmul(rotVec([0, a1 * 0.6, 0]), R);
      }
    } else {
      const ts = (tk - sc.t0) / 1000;
      const tPrep = sc.prep, tHold = tPrep + sc.hold, tSw = tHold + sc.D, tFol = tSw + sc.follow, tEnd = tFol + sc.ret;
      if (ts < tPrep) {
        // backswing: interpolate the stroke parameters from the ready pose (head forward) to the swing start, so the
        // racket turns back the way a real backswing does (opposite yaw to the forward swing); blend out any tilt offset.
        const u = minJerk(ts / tPrep), P = sc.P, lerp = (a, b) => a + (b - a) * u;
        const pitch = this.tilt[0];
        let g = geom(lerp(90, P.psi0) * DEG, lerp(0, P.theta0) * DEG, lerp(30 + pitch, P.thl) * DEG, lerp(0, P.e0) * DEG, 0, lerp(0, P.zoff || 0));
        let g0 = geom(90 * DEG, 0, (30 + pitch) * DEG, 0, 0, 0);
        if (sc.mirrorGeo) { g = mirrorX(g); g0 = mirrorX(g0); }
        const Rp = toR(g, sc.fz), Rp0 = toR(g0, sc.fz);
        const Rn = this.neutralR(), pn = this.neutralGeom(this.hand === 'L').p;
        const D0 = mmul(Rn, mT(Rp0));
        R = mmul(mslerp(D0, [1, 0, 0, 0, 1, 0, 0, 0, 1], u), Rp);
        p = vadd(g.p, vmul(vsub(pn, g0.p), 1 - u));
      }
      else if (ts < tHold) { R = sc.Rs; p = sc.ps; }
      else if (ts < tSw) {
        let g = swingGeometry(sc.P, (ts - tHold) / sc.D); if (sc.mirrorGeo) g = mirrorX(g);
        R = toR(g, sc.fz); p = g.p;
      } else {
        let gE = swingGeometry(sc.P, 1); if (sc.mirrorGeo) gE = mirrorX(gE);
        const RE = toR(gE, sc.fz);
        if (ts < tFol) { R = RE; p = gE.p; }
        else {
          const u = minJerk((ts - tFol) / sc.ret); const gn = this.neutralGeom(this.hand === 'L');
          R = mslerp(RE, this.neutralR(), u); p = vadd(vmul(gE.p, 1 - u), vmul(gn.p, u));
          if (ts >= tEnd) { this.script = null; }
        }
      }
    }
    // hand tremor
    const f1 = 8 * 2 * Math.PI, ph = this.tremPh;
    p = vadd(p, [0.0008 * Math.sin(f1 * t + ph[0]), 0.0008 * Math.sin(f1 * 1.3 * t + ph[1]), 0.0008 * Math.sin(f1 * 0.9 * t + ph[2])]);
    R = mmul(rotVec([0.004 * Math.sin(f1 * 1.2 * t + ph[0]), 0.004 * Math.sin(f1 * 0.8 * t + ph[1]), 0.004 * Math.sin(f1 * t + ph[2])]), R);
    return { R, p };
  }

  // advance the simulation by `ms` milliseconds; returns the samples that fall in this interval
  advance(ms) {
    const out = [];
    const per = 1000 / this.hz;
    for (let i = 0; i < ms; i++) {
      this.tick++;
      const k = 1 - Math.exp(-1 / 120);
      this.tilt[0] += (this.tiltTarget[0] - this.tilt[0]) * k;
      this.tilt[1] += (this.tiltTarget[1] - this.tilt[1]) * k;
      const pose = this.poseAt(this.tick);
      this.hist.push(pose); if (this.hist.length > 3) this.hist.shift();
      if (this.hist.length < 3) continue;
      const [P0, P1, P2] = this.hist;
      const h = 0.001;
      const w = vmul(rotAxisAngle(mmul(mT(P0.R), P2.R)), 1 / (2 * h));              // body-frame rad/s at middle pose
      const aw = vmul(vadd(vsub(P2.p, vmul(P1.p, 2)), P0.p), 1 / (h * h));           // world linear accel
      const wMag = Math.hypot(w[0], w[1], w[2]);
      if (this.script && wMag > this.contactTrack.best) { this.contactTrack.best = wMag; this.contactTrack.t = this.tick; this.script.truth.contactT = this.tick; this.script.truth.peakDps = wMag / DEG; }
      this.acc += 1;
      if (this.acc >= per) {
        this.acc -= per;
        const RT = mT(P1.R), n = this.noiseK, r = this.rng;
        const lin = mv(RT, aw);
        const gv = mv(RT, [0, 0, G]);
        const nz = (s) => r.n() * s * n;
        const accG = { x: lin[0] + gv[0] + nz(0.05), y: lin[1] + gv[1] + nz(0.05), z: lin[2] + gv[2] + nz(0.05) };
        const acc = { x: lin[0] + nz(0.05), y: lin[1] + nz(0.05), z: lin[2] + nz(0.05) };
        const rot = { beta: w[0] / DEG + this.gyroBias[0] * n + nz(0.5), gamma: w[1] / DEG + this.gyroBias[1] * n + nz(0.5), alpha: w[2] / DEG + this.gyroBias[2] * n + nz(0.5) };
        out.push({ t: this.tick - 1 + (r.u() - 0.5) * 0.6 * n, acc, accG, rot });
      }
    }
    return out;
  }
  run(ms) { return this.advance(Math.round(ms)); }
}

// Convenience: full swing trace (hold, swing, rest). Returns {samples, truth}.
export function genSwingTrace({ shot, side, hand = 'R', flip = false, hz = 100, seed = 1, speed = 1, noise = 1, sloppy = 0, restMs = 900, tailMs = 1500, ...knobs }) {
  const sim = new PhoneSim({ hand, hz, seed, flip, noise });
  const samples = sim.advance(restMs);
  const truth = sim.startSwing({ shot, side, speed, sloppy, ...knobs });
  const t0 = sim.tick;
  while (sim.busy) samples.push(...sim.advance(50));
  samples.push(...sim.advance(tailMs));
  truth.startT = t0;
  return { samples, truth };
}
