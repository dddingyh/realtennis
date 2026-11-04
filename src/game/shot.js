// Shot model: contact geometry, contact quality, target selection, launch solver and error model.
// "Position matters": court position, contact height, reach, timing, running speed, incoming pace/spin and
// racket-side all change the outcome. DOM-free.

import { COURT, SURFACES, BALL } from '../config.js';
import { simulateTrajectory, makeSpin, topspinOf } from '../physics/ball.js';

// ---------------------------------------------------------------- tunables
export const IDEAL_F = 0.5;         // ideal contact: metres in front of the body (toward the net)
export const IDEAL_LAT = 0.8;       // ideal contact: metres to the racket-hand side
export const REACH = { fh: 1.45, bh: 1.30 };          // max lateral reach (m)
export const LUNGE = 0.4;                  // extra lateral reach (m) at full sprint
export const MAX_REACH_Y = 2.35;    // groundstroke max contact height
export const SMASH_REACH_Y = 2.95;  // smash with jump
const TAU = { keyboard: 110, ai: 105, remote: 165 };  // timing tolerance (ms) for 1/(1+(t/tau)^2)
const QUALITY_EXP = 0.85;           // overall softening of the product of factors
const MIN_NET_CLEAR = 0.12;         // solver: required ball-bottom clearance above the tape (m)
const SOLVE_DT = 1 / 120;
const SERVE_NOISE_FLOOR = 0.75;      // deg: even a perfect serve has some scatter
const SERVE_NOISE_K = 3.6;
const GROUND_NOISE_FLOOR = 0.2;     // deg launch-angle scatter at q->1 (non-forced)
const GROUND_NOISE_K = 3.0;          // deg per unit of (1-q)^1.2 * risk
const RPM = Math.PI / 30;
const KMH = 1 / 3.6;

/** Stroke parameter table. v: km/h range (power 0..1), spin: rpm range, top: spin sign, mIn: metres inside baseline. */
export const STROKES = {
  flat:    { v: [105, 165], spin: [400, 1300],  top: +1, mIn: 1.5, band: [0.70, 1.20], penHigh: 0.55 },
  topspin: { v: [85, 135],  spin: [2000, 3400], top: +1, mIn: 1.9, band: [0.55, 1.30], penHigh: 0.50 },
  slice:   { v: [65, 105],  spin: [1500, 2800], top: -1, mIn: 2.3, band: [0.35, 1.20], penHigh: 0.25 },
  lob:     { v: [50, 90],   spin: [600, 1800],  top: +1, mIn: 1.6, band: [0.30, 1.40], penHigh: 0.20 },
};
const VOLLEY = { v: [30, 115], spin: [500, 1300], top: -1, band: [0.70, 1.55], penHigh: 0.35 };
const SMASH  = { v: [95, 190], spin: [200, 700],  top: +1, band: [1.95, 2.85], penHigh: 0.4 };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sign = (x) => (x < 0 ? -1 : 1);

// ---------------------------------------------------------------- geometry
/**
 * Contact geometry of a ball relative to a player.
 * lat: signed distance toward the racket-hand side (m). fwd: metres in front of the feet (toward the net).
 * tEarly: seconds until the ball reaches the ideal strike plane (positive = ball not there yet = swing early).
 */
export function contactGeometry(h, ball) {
  const handX = (h.hand === 'R' ? 1 : -1) * h.facing;
  const fwdZ = -h.facing;
  const rx = ball.pos.x - h.pos.x, rz = ball.pos.z - h.pos.z;
  const lat = rx * handX;
  const fwd = rz * fwdZ;
  const vf = ball.vel.z * fwdZ;
  let tEarly;
  if (vf < -0.5) tEarly = (fwd - IDEAL_F) / -vf;
  else tEarly = fwd - IDEAL_F > 0 ? Infinity : (fwd - IDEAL_F) / Math.max(3, Math.abs(vf));
  const speed = h.vel ? Math.hypot(h.vel.x, h.vel.z) : 0;
  return { lat, latAbs: Math.abs(lat), fwd, y: ball.pos.y, vf, tEarly, side: lat >= 0 ? 'fh' : 'bh', handX, speed };
}

/** Can the racket physically reach the ball right now? */
export function isReachable(geo, source = 'keyboard', hitter) {
  const rem = source === 'remote';
  const reach = REACH[geo.side] + (rem ? 0.2 : 0) + LUNGE * clamp((geo.speed || 0) / 6, 0, 1);   // running players lunge farther
  const fwdMin = rem ? -1.3 : -0.9;
  const fwdMax = IDEAL_F + (rem ? 1.15 : 0.85);
  return geo.latAbs <= reach && geo.fwd >= fwdMin && geo.fwd <= fwdMax && geo.y >= 0.08 && geo.y <= SMASH_REACH_Y;
}

function heightFactor(y, band, penHigh) {
  if (y < band[0]) return 1 - 0.5 * clamp((band[0] - y) / (band[0] - 0.12), 0, 1);
  if (y > band[1]) return Math.max(0.2, 1 - penHigh * clamp((y - band[1]) / 1.0, 0, 1.4));
  return 1;
}

// ---------------------------------------------------------------- launch solver
function runShot(pos, speed, el, rot, h0x, h0z, top, side, surface) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hx = h0x * c - h0z * s, hz = h0x * s + h0z * c;
  const ce = Math.cos(el);
  const vel = { x: speed * ce * hx, y: speed * Math.sin(el), z: speed * ce * hz };
  const spin = makeSpin(hx, hz, top, side);
  const r = simulateTrajectory({ pos, vel, spin }, { surface, dt: SOLVE_DT, stopAfterBounces: 1, maxTime: 4 });
  return { r, vel, spin, hx, hz };
}

/**
 * Solve a launch (elevation by bisection, azimuth by fixed-point iteration) so the first bounce hits `target`.
 * @param {object} spec {pos, target:{x,z}, speed (m/s), top, side (rad/s), surface, minNetClear,
 *                       elevation (rad, fixes elevation and solves speed instead), elMin, elMax}
 * @returns {{vel,spin,speed,el,landing,netClear,ok:boolean}}
 */
export function solveLaunch(spec) {
  const { pos, target, top, side, surface } = spec;
  const minClear = spec.minNetClear ?? MIN_NET_CLEAR;
  const dx0 = target.x - pos.x, dz0 = target.z - pos.z;
  const D = Math.hypot(dx0, dz0) || 1;
  const h0x = dx0 / D, h0z = dz0 / D, px = -h0z, pz = h0x;
  const along = (l) => (l.x - pos.x) * h0x + (l.z - pos.z) * h0z;
  const rangeOf = (r) => (r.landing ? along(r.landing) : -1e9);
  const fixedEl = spec.elevation !== undefined;

  const solveOnce = (speed, rot) => {
    if (fixedEl) {                                   // bisect speed
      let lo = 7, hi = 42;
      for (let i = 0; i < 12; i++) {
        const mid = 0.5 * (lo + hi);
        const { r } = runShot(pos, mid, spec.elevation, rot, h0x, h0z, top, side, surface);
        if (rangeOf(r) < D) lo = mid; else hi = mid;
      }
      return { speed: hi, el: spec.elevation };
    }
    const elMin = spec.elMin ?? -55 * Math.PI / 180;
    let hi = 0, best = -1e9;
    for (const d of [22, 31, 40]) {                  // find roughly the max-range angle
      const rg = rangeOf(runShot(pos, speed, d * Math.PI / 180, rot, h0x, h0z, top, side, surface).r);
      if (rg > best) { best = rg; hi = d * Math.PI / 180; }
    }
    if (best < D) return { speed, el: hi, unreachable: true };
    let lo = elMin;
    for (let i = 0; i < 13; i++) {
      const mid = 0.5 * (lo + hi);
      const { r } = runShot(pos, speed, mid, rot, h0x, h0z, top, side, surface);
      if (rangeOf(r) < D) lo = mid; else hi = mid;
    }
    return { speed, el: hi };
  };

  let speed = spec.speed, rot = 0, sol, out, topNow = top;
  let slowSteps = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    for (let it = 0; it < 3; it++) {
      sol = solveOnce(speed, rot);
      if (sol.unreachable) break;
      out = runShot(pos, sol.speed, sol.el, rot, h0x, h0z, topNow, side, surface);
      if (!out.r.landing) break;
      const E = (out.r.landing.x - pos.x) * px + (out.r.landing.z - pos.z) * pz;
      if (Math.abs(E) < 0.04) break;
      rot -= E / Math.max(along(out.r.landing), 3);
    }
    if (sol.unreachable) {                           // not enough pace/too much dip to reach the target: hit harder, spin less
      speed *= 1.1; topNow *= 0.93;
      out = runShot(pos, sol.speed, sol.el, rot, h0x, h0z, topNow, side, surface);
      continue;
    }
    const nc = out.r.netClear;
    const clears = !out.r.hitNet && (nc === null || nc >= minClear);
    if (clears || fixedEl) break;
    speed *= slowSteps++ < 4 ? 0.92 : 0.84;          // too flat to clear the net: slow it down (higher arc)
  }
  const l = out.r.landing;
  return {
    vel: out.vel, spin: out.spin, speed: sol.speed, top: topNow, el: sol.el, rot,
    landing: l ? { x: l.x, z: l.z } : null, netClear: out.r.netClear,
    ok: !!l && !out.r.hitNet && !sol.unreachable && Math.hypot(l.x - target.x, l.z - target.z) < 0.5,
  };
}

// ---------------------------------------------------------------- error model
function perturb(vel, spin, sd, rng, mishit) {
  // rotate velocity by azimuth/elevation noise; scale speed
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  const hz = Math.hypot(vel.x, vel.z) || 1e-9;
  let el = Math.atan2(vel.y, hz) + sd.el * rng.gauss();
  let az = sd.az * rng.gauss();
  let s = sp * (1 + sd.v * rng.gauss());
  if (mishit) { el += rng.range(-0.15, 0.45); az += rng.gauss(0, 0.18); s *= rng.range(0.55, 1.05); }
  const ux = vel.x / hz, uz = vel.z / hz;
  const c = Math.cos(az), sn = Math.sin(az);
  const nx = ux * c - uz * sn, nz = ux * sn + uz * c;
  const ce = Math.cos(el);
  const nv = { x: s * ce * nx, y: s * Math.sin(el), z: s * ce * nz };
  // re-aim spin axis with the new direction (keeps topspin/backspin semantic)
  const ts = topspinOf(spin, ux, uz);
  const ns = makeSpin(nx, nz, ts, spin.y);
  return { vel: nv, spin: ns };
}

const D2R = Math.PI / 180;
function noiseSd(q, risk, power, floor, k) {
  if (q >= 0.9999) return { el: 0, az: 0, v: 0 };
  const e = Math.pow(1 - q, 1.2) * risk * (0.65 + 0.7 * power);
  return { el: (floor + k * e) * D2R, az: (floor * 1.2 + k * 1.25 * e) * D2R, v: 0.003 + 0.02 * e };
}

// ---------------------------------------------------------------- rally shots
/**
 * Compute the outgoing ball for a groundstroke / volley / smash / lob.
 * @param {object} inp {hitter:{pos,vel,facing,hand,stamina}, ball:{pos,vel,spin,bounces}, swing:{shot,side,power,aimX,aimDepth,
 *        source,risk,edge}, surface:string, rng, geo?, timingEarlyMs?, opts?:{forceQuality, noError}}
 */
export function computeHit(inp) {
  const { hitter, ball, swing, surface, rng } = inp;
  const opts = inp.opts || {};
  const geo = inp.geo || contactGeometry(hitter, ball);
  const source = swing.source || 'keyboard';
  const power = clamp(swing.power ?? 0.7, 0, 1);
  const dirZ = -hitter.facing;
  const netD = Math.abs(hitter.pos.z);
  const behind = netD - COURT.halfLength;                       // >0 behind the baseline
  const y = ball.pos.y;
  const hSpeed = Math.hypot(hitter.vel.x, hitter.vel.z);
  const inSpeed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
  const inSpin = Math.hypot(ball.spin.x, ball.spin.y, ball.spin.z);

  let shot = SHOT_SET.has(swing.shot) ? swing.shot : 'topspin';
  let kind = 'ground';
  if (shot === 'lob') kind = 'lob';
  else if (shot !== 'slice' && y > 1.9 && netD < 9.5 && ball.vel.y < 2.5) kind = 'smash';
  else if (ball.bounces === 0 && netD < 6.8) kind = 'volley';
  const P = kind === 'volley' ? VOLLEY : kind === 'smash' ? SMASH : STROKES[shot];
  const label = kind === 'ground' ? shot : kind;

  // ---- contact quality
  const early = clamp((inp.timingEarlyMs ?? geo.tEarly * 1000), -400, 400);
  const inside = clamp(-behind, 0, 3) / 3;                      // 0..1 how far inside the baseline
  const tau = TAU[source] * (1 - 0.15 * inside) * (kind === 'volley' ? 0.9 : 1);
  const fTiming = 1 / (1 + (early / tau) ** 2);
  const fHeight = heightFactor(y, P.band, P.penHigh);
  const maxR = REACH[geo.side] + LUNGE;
  let fReach = 1;
  if (geo.latAbs < 0.65) fReach = 1 - 0.5 * (0.65 - geo.latAbs) / 0.65;            // jammed
  else if (geo.latAbs > 1.0) fReach = 1 - 0.55 * clamp((geo.latAbs - 1.0) / (maxR - 1.0), 0, 1.3);   // stretched
  const fRun = 1 - 0.25 * clamp(hSpeed / 6, 0, 1);
  const fPace = 1 - 0.2 * clamp((inSpeed - 28) / 25, 0, 1) - 0.15 * clamp((inSpin - 200) / 300, 0, 1);
  const fSide = sideFactor(swing.side, geo);
  const fStam = 0.9 + 0.1 * (hitter.stamina ?? 1);
  let q = Math.pow(fTiming * fHeight * fReach * fRun * fPace * fSide * fStam, QUALITY_EXP);
  q = clamp(q, 0.02, 1);
  if (opts.forceQuality != null) q = opts.forceQuality;
  const stretch = Math.max(clamp((geo.latAbs - 1.0) / 0.45, 0, 1), 0.8 * clamp((hSpeed - 4.6) / 1.4, 0, 1));

  // ---- target
  const kA = clamp(1 - 0.08 * clamp(behind, 0, 4) - 0.3 * stretch + 0.04 * clamp(-behind, 0, 3) + (kind === 'volley' ? 0.12 : 0), 0.45, 1.15);
  const edge = swing.edge ?? 0.4;
  const marginX = lerp(0.95, 0.25, edge) - (kind === 'volley' ? 0.1 : 0);
  const halfW = COURT.singlesHalfWidth;
  const xLim = (halfW - marginX) * kA;
  let aim;
  if (swing.aimX != null) aim = clamp(swing.aimX, -1, 1);
  else {
    const hxp = hitter.pos.x;
    const sg = Math.abs(hxp) > 0.8 ? sign(hxp) : sign(ball.pos.x || geo.handX);
    const late = clamp(-early / 70, -1, 1);                     // + = late
    const mag = late >= 0 ? 0.55 - 1.1 * late : 0.55 + 0.35 * -late;
    aim = -sg * mag + rng.range(-0.08, 0.08);
  }
  const tx = clamp(aim * xLim, -halfW + 0.15, halfW - 0.15);
  const ad = swing.aimDepth;
  let dNet;
  if (kind === 'lob') {
    const d0 = COURT.halfLength - 1.7;
    dNet = ad == null ? d0 : ad >= 0 ? lerp(d0, COURT.halfLength - 0.6, ad) : lerp(d0, 6.5, -ad);
  } else if (kind === 'volley') {
    const d0 = 6.8;
    dNet = ad == null ? d0 : ad >= 0 ? lerp(d0, 11.0, ad) : lerp(d0, 2.3, -ad);
  } else if (kind === 'smash') {
    const d0 = 6.3;
    dNet = ad == null ? d0 : ad >= 0 ? lerp(d0, 10.6, ad) : lerp(d0, 3.5, -ad);
  } else {
    const d0 = COURT.halfLength - STROKES[shot].mIn - 0.15 * stretch;
    dNet = ad == null ? d0 : ad >= 0 ? lerp(d0, COURT.halfLength - 0.55, ad) : lerp(d0, 3.0, -ad);
  }
  dNet = clamp(dNet, 2.2, COURT.halfLength - 0.4);
  const target = { x: tx, z: dirZ * dNet };

  // ---- pace & spin
  const inKmh = inSpeed * 3.6;
  let kmh;
  if (kind === 'volley') {
    kmh = lerp(25, 85, power) * 0.5 + 0.55 * inKmh * (0.7 + 0.3 * q);
    if (ad != null && ad < -0.5) kmh = lerp(28, 48, power);            // drop volley
  } else {
    kmh = lerp(P.v[0], P.v[1], power) * (0.75 + 0.25 * Math.pow(q, 0.7));
    kmh += Math.min(14, (shot === 'slice' ? 0.08 : 0.15) * Math.max(0, inKmh - 70)) * (kind === 'lob' ? 0 : 1);
    kmh *= 1 + 0.025 * clamp(-behind, 0, 3) - 0.03 * clamp(behind, 0, 4);
    kmh *= 1 - 0.35 * stretch * (kind === 'smash' ? 0.3 : 1);
    if (shot === 'slice' && ad != null && ad < -0.5) kmh *= 0.85;      // drop shot
  }
  kmh = Math.max(kind === 'smash' ? 70 : 24, kmh);
  const spinFrac = clamp(0.3 + 0.5 * power + 0.3 * q, 0, 1);
  let rpm = lerp(P.spin[0], P.spin[1], spinFrac);
  const top = P.top * rpm * RPM;
  const sideSp = (shot === 'slice' || kind === 'volley') ? (geo.side === 'fh' ? 1 : -1) * geo.handX * 0.1 * Math.abs(top) : 0;

  // ---- solve ideal launch
  const spec = { pos: { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z }, target, speed: kmh * KMH, top, side: sideSp, surface };
  if (kind === 'lob') spec.elevation = lerp(60, 40, power) * D2R;
  if (kind === 'smash') spec.elMin = -70 * D2R;
  if (kind === 'volley') spec.elMin = -65 * D2R;
  const sol = solveLaunch(spec);
  let vel = sol.vel, spin = sol.spin;

  // ---- error (emerges as net / out through physics)
  let mishit = false;
  if (!opts.noError) {
    const risk = (swing.risk ?? 1) * (kind === 'volley' ? 1.1 : 1) * (1 + 0.5 * stretch);
    const sd = noiseSd(q, risk, power, GROUND_NOISE_FLOOR, GROUND_NOISE_K);
    mishit = q < 0.3 && rng.chance((0.3 - q) * 1.6);
    const pt = perturb(vel, spin, sd, rng, mishit);
    vel = pt.vel; spin = pt.spin;
  }
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  const hz = Math.hypot(vel.x, vel.z) || 1;
  const topOut = topspinOf(spin, vel.x / hz, vel.z / hz);
  return {
    vel, spin, quality: q, shot: label, kind, side: geo.side, speedKmh: sp * 3.6, spinRpm: topOut / RPM,
    target, planned: sol.landing, plannedNetClear: sol.netClear, solved: sol.ok,
    timingMs: -early, mishit, stretch, parts: { fTiming, fHeight, fReach, fRun, fPace, fSide, fStam },
  };
}
const SHOT_SET = new Set(['flat', 'topspin', 'slice', 'lob']);

function sideFactor(swingSide, geo) {
  if (!swingSide || swingSide === 'auto' || swingSide === geo.side) return 1;
  const d = geo.latAbs;
  return d < 0.25 ? 0.92 : Math.max(0.25, 0.85 - 0.5 * (d - 0.25));
}

// ---------------------------------------------------------------- serve
/** Service box for a server (facing +1 = near) in the deuce/ad court. */
export function serviceBox(facing, deuce) {
  const ss = (deuce ? 1 : -1) * facing;        // side of the baseline the server stands on (x sign)
  const bs = -ss;                              // receiving box lies diagonally across
  const near = facing > 0;
  return { xMin: bs > 0 ? 0 : -COURT.singlesHalfWidth, xMax: bs > 0 ? COURT.singlesHalfWidth : 0,
    zMin: near ? -COURT.serviceLineDist : 0, zMax: near ? 0 : COURT.serviceLineDist, boxSign: bs, standSign: ss };
}

/** Is a ball landing at (x,z) inside the box (lines count as in, 2 cm tolerance)? */
export function inBox(box, x, z) {
  const tol = 0.02;
  return x >= box.xMin - tol && x <= box.xMax + tol && z >= box.zMin - tol && z <= box.zMax + tol;
}
/** Is (x,z) inside the singles court half (side of `facing` player's opponent)? */
export function inSinglesCourt(x, z) {
  const tol = 0.02;
  return Math.abs(x) <= COURT.singlesHalfWidth + tol && Math.abs(z) <= COURT.halfLength + tol;
}

/**
 * Compute a serve.
 * @param {object} inp {server:{pos,facing,hand,stamina}, ball (at contact), swing:{shot,power,aimX,aimDepth,source,risk},
 *        serveNumber:1|2, deuce:boolean, surface, rng, opts}
 */
export function computeServe(inp) {
  const { server, ball, swing, surface, rng } = inp;
  const opts = inp.opts || {};
  const dirZ = -server.facing;
  const handX = (server.hand === 'R' ? 1 : -1) * server.facing;
  const box = serviceBox(server.facing, inp.deuce);
  const power = clamp(swing.power ?? 0.85, 0, 1);
  const shot = SHOT_SET.has(swing.shot) && swing.shot !== 'lob' ? swing.shot : 'flat';

  const dy = ball.pos.y - 2.85;
  const qh = Math.exp(-((dy / 0.5) ** 2));
  const hd = Math.hypot(ball.pos.x - (server.pos.x + 0.25 * handX), ball.pos.z - (server.pos.z + dirZ * 0.35));
  const qp = 1 - 0.6 * clamp((hd - 0.6) / 1.0, 0, 1);
  let q = clamp(qh * qp * (0.9 + 0.1 * (server.stamina ?? 1)), 0.02, 1);
  if (opts.forceQuality != null) q = opts.forceQuality;

  const aimX = swing.aimX == null ? 0 : clamp(swing.aimX, -1, 1);
  const tx = clamp(box.boxSign * 2.1 + 1.7 * aimX, box.xMin + 0.2, box.xMax - 0.2) ;
  const ad = swing.aimDepth == null ? 0.2 : clamp(swing.aimDepth, -1, 1);
  const dNet = lerp(4.0, 6.0, (ad + 1) / 2);
  const target = { x: tx, z: dirZ * dNet };

  let kmh, top, side;
  const curve = handX;                                 // slice curves toward the server's racket side (x sign)
  const vzSign = dirZ;
  if (shot === 'topspin') {                            // kick
    kmh = 90 + 45 * power;
    top = (3000 + 1200 * power) * RPM; side = curve * vzSign * 350 * RPM;
  } else if (shot === 'slice') {
    kmh = 105 + 55 * power;
    top = -700 * RPM; side = curve * vzSign * (900 + 600 * power) * RPM;
  } else {
    kmh = 110 + 80 * power;
    top = (350 + 300 * power) * RPM; side = curve * vzSign * 100 * RPM;
  }
  kmh *= 0.8 + 0.2 * Math.pow(q, 0.7);
  const spec = { pos: { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z }, target, speed: kmh * KMH, top, side, surface, elMin: -40 * D2R };
  const sol = solveLaunch(spec);
  let vel = sol.vel, spin = sol.spin, mishit = false;
  if (!opts.noError) {
    const sd = noiseSd(q, (swing.risk ?? 1), power, SERVE_NOISE_FLOOR, SERVE_NOISE_K);
    mishit = q < 0.25 && rng.chance((0.25 - q) * 2);
    const pt = perturb(vel, spin, sd, rng, mishit);
    vel = pt.vel; spin = pt.spin;
  }
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  const hz = Math.hypot(vel.x, vel.z) || 1;
  return {
    vel, spin, quality: q, shot, kind: 'serve', speedKmh: sp * 3.6, spinRpm: topspinOf(spin, vel.x / hz, vel.z / hz) / RPM,
    target, planned: sol.landing, plannedNetClear: sol.netClear, solved: sol.ok, mishit, box,
  };
}
