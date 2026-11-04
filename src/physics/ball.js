// Ball physics: flight (gravity, quadratic drag, Magnus lift, spin decay), impulse bounce with
// Coulomb friction / grip, net collision (incl. net cord) and a pure trajectory simulator.
//
// Coordinates: x right, y up, z toward the near camera, net at z=0. Spin = angular velocity vector (rad/s).
//
// SPIN SIGN CONVENTION (verified in tests/sim_physics.mjs):
//   Magnus force direction is  omega x v.  For a ball travelling toward -z (near -> far),
//   TOPSPIN is omega = (-w, 0, 0) (top of ball moves forward); omega x v then points DOWN.
//   General rule: topspin omega = w * (up x v_horizontal_unit) = w * (dz, 0, -dx).  Backspin = negative w.
//   Positive omega.y (counter-clockwise seen from above) pushes a -z travelling ball toward -x.

import { COURT, BALL, PHYSICS, SURFACES } from '../config.js';

// ---------------------------------------------------------------- tunables
export const R = BALL.radius;
const G = PHYSICS.gravity;
const AREA = Math.PI * R * R;
const K_DRAG = 0.5 * BALL.airDensity * BALL.dragCoeff * AREA / BALL.mass;   // a_drag = -K |v| v
const K_LIFT = 0.5 * BALL.airDensity * AREA / BALL.mass;
export const MAX_CL = 0.45;                 // lift coefficient clamp
/** Tangential restitution when the ball grips (rolls) during impact. */
export const TANGENTIAL_RESTITUTION = { hard: 0.18, clay: 0.12, grass: 0.0 };
const ROLL_VY = 0.7;                        // post-bounce vertical speed below this -> rolling
const ROLL_DECEL = 1.2;                     // m/s^2 rolling resistance
/** Extra vertical rebound (fraction of the tangential impulse) when the ball grips: topspin 'kick' from ball/court deformation. */
export const GRIP_KICK = { hard: 0.12, clay: 0.2, grass: 0.04 };
export const NET_CORD_BELOW = 0.02;         // ball centre this far under the tape still counts as tape contact
const NET_HIT_DAMP = { vx: 0.2, vy: 0.3, vz: -0.12, spin: 0.3 };

/** Net tape height at lateral position x (m). Beyond the posts there is no net. */
export function netHeightAt(x) {
  const ax = Math.min(Math.abs(x), COURT.netPostX);
  return COURT.netHeightCenter + (COURT.netHeightPost - COURT.netHeightCenter) * ax / COURT.netPostX;
}

/** Create a ball state object. */
export function createBall(p = {}) {
  return {
    pos: { x: 0, y: 1, z: 0, ...(p.pos || {}) },
    vel: { x: 0, y: 0, z: 0, ...(p.vel || {}) },
    spin: { x: 0, y: 0, z: 0, ...(p.spin || {}) },
    bounces: p.bounces || 0,
    rolling: !!p.rolling,
    netHit: false,
  };
}
export function cloneBall(b) {
  return {
    pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
    vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
    spin: { x: b.spin.x, y: b.spin.y, z: b.spin.z },
    bounces: b.bounces || 0, rolling: !!b.rolling, netHit: !!b.netHit,
  };
}

/**
 * Build a spin vector from topspin / sidespin magnitudes for a ball travelling along horizontal unit (dx,dz).
 * @param {number} dx @param {number} dz horizontal travel direction (unit)
 * @param {number} top rad/s, positive = topspin, negative = backspin
 * @param {number} side rad/s about the vertical axis (positive = CCW seen from above)
 */
export function makeSpin(dx, dz, top, side = 0) {
  return { x: top * dz, y: side, z: -top * dx };
}
/** Signed topspin rate (rad/s, +topspin) of spin vector w for horizontal travel direction (dx,dz). */
export function topspinOf(w, dx, dz) { return w.x * dz - w.z * dx; }

const _a = [0, 0, 0];
function accel(vx, vy, vz, wx, wy, wz, out) {
  const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const kd = K_DRAG * sp;
  let ax = -kd * vx, ay = -kd * vy - G, az = -kd * vz;
  const wm = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (wm > 1 && sp > 0.5) {
    const cl = Math.min(MAX_CL, 1 / (2 + sp / (R * wm)));       // CL = 1/(2 + v/(r|w|))
    const k = K_LIFT * cl * sp / wm;                             // (w x v)/(|w||v|) * 0.5 rho CL A v^2 / m
    ax += (wy * vz - wz * vy) * k;
    ay += (wz * vx - wx * vz) * k;
    az += (wx * vy - wy * vx) * k;
  }
  out[0] = ax; out[1] = ay; out[2] = az;
}

/**
 * Impulse bounce on the ground plane. Mutates v and w.
 * Normal: vy' = -e vy. Tangential: contact point velocity u = v + w x (-R y); friction impulse limited by
 * mu*Jn; the ball either slides (impulse = mu Jn) or grips (impulse reverses slip, with tangential restitution).
 * @returns {{grip:boolean, slip:number}}
 */
export function bounceVelocity(v, w, surf, surfKey = 'hard') {
  const e = surf.cor, mu = surf.friction, k = BALL.inertiaFactor;
  const eT = TANGENTIAL_RESTITUTION[surfKey] ?? 0.1;
  const jn = (1 + e) * (-v.y);                 // normal impulse per unit mass
  const ux = v.x + R * w.z;                    // contact-point velocity (w x r_c with r_c = (0,-R,0))
  const uz = v.z - R * w.x;
  const ut = Math.hypot(ux, uz);
  v.y = -e * v.y;
  let grip = false;
  if (ut > 1e-6) {
    const need = (1 + eT) * k / (1 + k) * ut;  // impulse (per mass) needed to end in rolling (with elastic recovery)
    const maxF = mu * jn;
    grip = need <= maxF;
    const J = grip ? need : maxF;
    if (grip) v.y += (GRIP_KICK[surfKey] ?? 0.1) * J;
    const jx = -J * ux / ut, jz = -J * uz / ut;
    v.x += jx; v.z += jz;
    w.x += -jz / (k * R);                      // dw = (r_c x J) / (k m R^2)
    w.z += jx / (k * R);
  }
  return { grip, slip: ut };
}

/**
 * Advance the ball by dt (RK2). Handles net and ground contacts, mutating `b`.
 * @param {object} b ball {pos,vel,spin,bounces,rolling,netHit}
 * @param {number} dt
 * @param {{surf:object, surfKey?:string, rng?:object, events?:Array}} env  events receives
 *   {type:'bounce',x,z,speed,vy}, {type:'netcross',x,y,clear}, {type:'net',cord,x,y,z}
 */
export function stepBall(b, dt, env) {
  const p = b.pos, v = b.vel, w = b.spin;
  if (b.rolling) {
    p.x += v.x * dt; p.z += v.z * dt; p.y = R;
    const sp = Math.hypot(v.x, v.z);
    if (sp > 1e-4) { const ns = Math.max(0, sp - ROLL_DECEL * dt); v.x *= ns / sp; v.z *= ns / sp; }
    return;
  }
  const x0 = p.x, y0 = p.y, z0 = p.z;
  accel(v.x, v.y, v.z, w.x, w.y, w.z, _a);
  const hx = v.x + _a[0] * dt * 0.5, hy = v.y + _a[1] * dt * 0.5, hz = v.z + _a[2] * dt * 0.5;
  accel(hx, hy, hz, w.x, w.y, w.z, _a);
  p.x += hx * dt; p.y += hy * dt; p.z += hz * dt;
  v.x += _a[0] * dt; v.y += _a[1] * dt; v.z += _a[2] * dt;
  const dec = Math.exp(-BALL.spinDecayPerSec * dt);
  w.x *= dec; w.y *= dec; w.z *= dec;
  const wm = Math.hypot(w.x, w.y, w.z);
  if (wm > BALL.maxSpin) { const s = BALL.maxSpin / wm; w.x *= s; w.y *= s; w.z *= s; }

  // ---- net
  if ((z0 > 0 && p.z <= 0) || (z0 < 0 && p.z >= 0)) {
    const f = z0 / (z0 - p.z);
    const cx = x0 + (p.x - x0) * f, cy = y0 + (p.y - y0) * f;
    if (Math.abs(cx) <= COURT.netPostX) {
      const h = netHeightAt(cx);
      const c = cy - h;                                // ball centre relative to the tape top
      if (env.events) env.events.push({ type: 'netcross', x: cx, y: cy, clear: c - R });
      if (c < -NET_CORD_BELOW) {                       // into the mesh
        const sgn = z0 > 0 ? 1 : -1;
        p.x = cx; p.y = cy; p.z = sgn * (R + 0.004);
        v.x *= NET_HIT_DAMP.vx; v.y *= NET_HIT_DAMP.vy; v.z *= NET_HIT_DAMP.vz;
        w.x *= NET_HIT_DAMP.spin; w.y *= NET_HIT_DAMP.spin; w.z *= NET_HIT_DAMP.spin;
        b.netHit = true;
        if (env.events) env.events.push({ type: 'net', cord: false, x: cx, y: cy, z: p.z });
      } else if (c < R && env.rng) {                   // clipped the tape
        const r = env.rng;
        v.z *= r.range(0.28, 0.65);
        v.y = Math.max(v.y, 0) * 0.5 + r.range(0.8, 2.6);
        v.x += r.range(-1.2, 1.2);
        p.y = Math.max(p.y, h + R + 0.005);
        if (env.events) env.events.push({ type: 'net', cord: true, x: cx, y: cy, z: 0 });
      }
    }
  }

  // ---- ground
  if (p.y < R && v.y < 0) {
    const f = y0 > R ? (y0 - R) / (y0 - p.y) : 0;
    p.x = x0 + (p.x - x0) * f; p.z = z0 + (p.z - z0) * f; p.y = R;
    const speed = Math.hypot(v.x, v.y, v.z);
    const vyIn = v.y;
    bounceVelocity(v, w, env.surf, env.surfKey);
    b.bounces++;
    if (env.events) env.events.push({ type: 'bounce', x: p.x, z: p.z, speed, vyIn, vy: v.y, vx: v.x, vz: v.z });
    if (v.y < ROLL_VY) { v.y = 0; b.rolling = true; }
    const rem = (1 - f) * dt;
    p.x += v.x * rem; p.z += v.z * rem; p.y = R + Math.max(0, v.y * rem);
  }
}

/**
 * Pure trajectory simulation (no side effects on `state`).
 * @param {{pos,vel,spin,bounces?}} state
 * @param {{surface?:string, dt?:number, maxTime?:number, stopAfterBounces?:number, path?:boolean, pathDt?:number,
 *          rng?:object}} opts
 * @returns {{landing:null|{x,z,t,vx,vz,vy,speed}, netClear:number|null, netT:number|null, netX:number|null,
 *            hitNet:boolean, bounces:Array, path:Array|null, end:object, t:number}}
 *   netClear = height of the ball's bottom above the tape at the net crossing (m; <0 = touched/under).
 */
export function simulateTrajectory(state, opts = {}) {
  const surfKey = opts.surface || 'hard';
  const surf = SURFACES[surfKey];
  const dt = opts.dt || PHYSICS.fixedDt;
  const maxT = opts.maxTime ?? 6;
  const stopB = opts.stopAfterBounces ?? 1;
  const b = cloneBall(state);
  const ev = [];
  const env = { surf, surfKey, rng: opts.rng || null, events: ev };
  const out = { landing: null, netClear: null, netT: null, netX: null, hitNet: false, bounces: [], path: null, end: b, t: 0 };
  if (opts.path) out.path = [{ t: 0, x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, b: b.bounces }];
  const pathEvery = opts.path ? Math.max(1, Math.round((opts.pathDt || dt) / dt)) : 0;
  let t = 0, n = 0;
  const startBounces = b.bounces;
  while (t < maxT) {
    stepBall(b, dt, env);
    t += dt; n++;
    if (ev.length) {
      for (const e of ev) {
        if (e.type === 'netcross' && out.netClear === null) { out.netClear = e.clear; out.netT = t; out.netX = e.x; }
        else if (e.type === 'bounce') {
          const rec = { x: e.x, z: e.z, t, vx: e.vx, vz: e.vz, vy: e.vy, speed: e.speed };
          out.bounces.push(rec);
          if (!out.landing) out.landing = rec;
        }
      }
      ev.length = 0;
    }
    if (pathEvery && n % pathEvery === 0) out.path.push({ t, x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, b: b.bounces });
    if (b.netHit) { out.hitNet = true; break; }
    if (b.bounces - startBounces >= stopB || b.rolling) break;
  }
  out.t = t;
  return out;
}

/** Speed in m/s of a {x,y,z} vector. */
export function speedOf(v) { return Math.hypot(v.x, v.y, v.z); }
