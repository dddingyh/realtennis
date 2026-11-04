// Serve choreography: the single source of truth for the serve timeline, the ball-bounce routine and the
// tossing-hand path. Used by the Simulation (to place the held / dribbled / tossed ball) and by
// src/render/pose.js (to drive the toss-hand IK), so the hand and the ball cannot drift apart. DOM-free.
//
// LOCAL ("handed") coordinates, metres, relative to the server's STAND ORIGIN O (the feet position when the
// routine starts):
//   x = toward the racket-hand side (right for a right-hander), y = up, z = forward (toward the net).
// The same numbers are the right-hander authoring frame of pose.js (which mirrors x for left-handers).
// Use toWorld()/toLocal() to convert to world coordinates.
//
// Body-relative ("root") coordinates = local minus rootOffset(t): the feet move forward during the jump/landing.

const G = 9.81;
export const BALL_R = 0.0335;
export const PLAYER_HEIGHT = 1.85;            // rig height (pose.js BODY)

// ------------------------------------------------------------------ serve timeline (seconds from motion start)
export const SERVE_T = {
  release: 0.55,      // toss leaves the hand at full extension
  flight: 0.82,       // release -> contact
  contact: 0.55 + 0.82,
  land: 0.55 + 0.82 + 0.25,     // front foot lands inside the baseline
  finish: 0.55 + 0.82 + 0.55,   // racket across the body on the non-hitting side
  end: 0.55 + 0.82 + 0.95,      // recovery step done
  drop: 0.22,         // both arms dropped together
  trophy: 0,          // filled below (= ball apex)
  racketDrop: 1.25,
  jumpStart: 1.23,    // feet start leaving the ground
  catchLate: 0.42,    // no swing by contact+this => the server lets the toss drop (re-toss, no fault)
};

// stance (root frame): lead foot near the baseline. The stand origin is STAND_BEHIND metres behind the baseline.
export const STAND_BEHIND = 0.40;
export const STANCE = { lead: [-0.12, 0, 0.25], back: [0.30, 0, -0.22] };

// toss per serve type: release point R and contact point C (local, relative to O)
export const TOSS = {
  flat:    { R: [-0.02, 1.80, 0.42], C: [0.20, 2.80, 0.66] },   // in front, slightly to the hitting side
  topspin: { R: [-0.12, 1.80, 0.30], C: [-0.06, 2.74, 0.40] },  // kick: over / behind the head
  slice:   { R: [0.04, 1.80, 0.38], C: [0.40, 2.78, 0.58] },    // to the hitting-arm side
};
const tossType = (type) => (TOSS[type] ? type : 'flat');

/** Release velocity (local) so that the ball reaches C exactly `flight` seconds after leaving R. */
export function tossVelocity(type) {
  const { R, C } = TOSS[tossType(type)], T = SERVE_T.flight;
  return [(C[0] - R[0]) / T, (C[1] - R[1] + 0.5 * G * T * T) / T, (C[2] - R[2]) / T];
}
const V_FLAT = tossVelocity('flat');
SERVE_T.trophy = SERVE_T.release + V_FLAT[1] / G;   // ball apex (flat toss)

/** Ball apex height (local y) of a toss. */
export function tossApex(type) { const v = tossVelocity(type); return TOSS[tossType(type)].R[1] + v[1] * v[1] / (2 * G); }

// anim.phase <-> time mapping (anim 'serve'): 0 setup, 0.30 release, 0.50 trophy (apex), 0.57 racket drop,
// 0.65 contact, 0.76 landing, 0.88 finish, 1 recovered.
export const SERVE_PHASES = [
  [0, 0], [SERVE_T.drop, 0.12], [SERVE_T.release, 0.30], [SERVE_T.trophy, 0.50], [SERVE_T.racketDrop, 0.57],
  [SERVE_T.contact, 0.65], [SERVE_T.land, 0.76], [SERVE_T.finish, 0.88], [SERVE_T.end, 1.0],
];
function pw(table, x, from, to) {
  if (x <= table[0][from]) return table[0][to];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1], b = table[i];
    if (x <= b[from]) return a[to] + (b[to] - a[to]) * (x - a[from]) / ((b[from] - a[from]) || 1);
  }
  return table[table.length - 1][to];
}
/** anim phase for a motion time t (s). */
export function servePhase(t) { return pw(SERVE_PHASES, t, 0, 1); }
/** motion time (s) for an anim phase. */
export function serveTime(phase) { return pw(SERVE_PHASES, phase, 1, 0); }

// ------------------------------------------------------------------ small spline helpers
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// cubic Hermite between p0 (vel v0) and p1 (vel v1) over duration T, local time s in [0,T]
function hermite(p0, v0, p1, v1, T, s) {
  const u = clamp(s / T, 0, 1), u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return [0, 1, 2].map((k) => h00 * p0[k] + h10 * T * v0[k] + h01 * p1[k] + h11 * T * v1[k]);
}
// keyed path [[t, pos, vel?], ...] with Catmull-Rom tangents where vel is not given (ends: zero)
function keyed(keys, t) {
  if (t <= keys[0][0]) return keys[0][1].slice();
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], T = b[0] - a[0];
      const tan = (j) => {
        const k = keys[j];
        if (k[2]) return k[2];
        if (j === 0 || j === keys.length - 1) return [0, 0, 0];
        const p = keys[j - 1], n = keys[j + 1];
        return [0, 1, 2].map((c) => (n[1][c] - p[1][c]) / (n[0] - p[0]) * 0.8);
      };
      return hermite(a[1], tan(i - 1), b[1], tan(i), T, t - a[0]);
    }
  }
  return keys[keys.length - 1][1].slice();
}

// ------------------------------------------------------------------ hand rest / ball-bounce routine
/** Rest position of the tossing hand with the ball (local == root before the motion). Serve phase 0 starts here. */
export const HAND_REST = [-0.16, 1.00, 0.46];
// the hand/ball centre sits this far above the palm centre used by the IK
export const PALM_BELOW_BALL = 0.045;

const DR = { period: 0.80, push: 0.16, releaseY: 0.88, impact: 5.5, cor: 0.76 };
(() => {
  const h = DR.releaseY - BALL_R;
  DR.v0 = Math.sqrt(DR.impact * DR.impact - 2 * G * h);
  DR.tf = (DR.impact - DR.v0) / G;
  DR.vr = DR.cor * DR.impact;
  DR.tr = (DR.vr - Math.sqrt(DR.vr * DR.vr - 2 * G * h)) / G;
  DR.vc = DR.vr - G * DR.tr;                        // upward speed when the hand catches it
  DR.tRel = DR.push * DR.period;
  DR.tGround = DR.tRel + DR.tf;
  DR.tCatch = DR.tRel + DR.tf + DR.tr;
})();
export const DRIBBLE = DR;

/**
 * One ball-bounce ("dribble") cycle, u in [0,1] (anim 'bounce', phase = u).
 * The hand pushes down, the ball hits the ground in front of the lead foot and comes back up into the hand.
 * @returns {{hand:number[], ball:number[], ballVel:number[], held:boolean, groundAt:number}} local coordinates
 */
export function dribble(u) {
  const t = clamp(u, 0, 1) * DR.period;
  const x = HAND_REST[0], z = HAND_REST[2], yr = HAND_REST[1], y1 = DR.releaseY;
  let hy, by, bv, held;
  if (t < DR.tRel) {                                    // push down
    const p = hermite([0, yr, 0], [0, 0, 0], [0, y1, 0], [0, -DR.v0, 0], DR.tRel, t);
    const e = 1e-3, p2 = hermite([0, yr, 0], [0, 0, 0], [0, y1, 0], [0, -DR.v0, 0], DR.tRel, t + e);
    hy = by = p[1]; bv = (p2[1] - p[1]) / e; held = true;
  } else if (t < DR.tCatch) {                           // ball free
    held = false;
    const s = t - DR.tRel;
    if (s < DR.tf) { by = y1 - DR.v0 * s - 0.5 * G * s * s; bv = -DR.v0 - G * s; }
    else { const r = s - DR.tf; by = BALL_R + DR.vr * r - 0.5 * G * r * r; bv = DR.vr - G * r; }
    const k = (t - DR.tRel) / (DR.tCatch - DR.tRel);
    hy = y1 - 0.05 * Math.sin(Math.PI * k);            // follow-through down, back up for the catch
  } else {                                              // catch and carry back to rest
    const s = t - DR.tCatch, T = DR.period - DR.tCatch;
    const p = hermite([0, y1, 0], [0, DR.vc, 0], [0, yr, 0], [0, 0, 0], T, s);
    const p2 = hermite([0, y1, 0], [0, DR.vc, 0], [0, yr, 0], [0, 0, 0], T, s + 1e-3);
    hy = by = p[1]; bv = (p2[1] - p[1]) / 1e-3; held = true;
  }
  return { hand: [x, hy, z], ball: [x, by, z], ballVel: [0, bv, 0], held, groundAt: DR.tGround / DR.period };
}

// ------------------------------------------------------------------ the serve motion
/** Forward (z) / lateral (x) movement of the feet relative to O: jump into the court, land, recovery step. */
export function rootOffset(t) {
  const K = [[0, 0], [SERVE_T.jumpStart, 0], [SERVE_T.contact, 0.30], [SERVE_T.land, 0.95], [SERVE_T.finish, 1.10], [SERVE_T.end, 1.15]];
  let z = 0;
  if (t <= K[0][0]) z = 0;
  else if (t >= K[K.length - 1][0]) z = K[K.length - 1][1];
  else for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
    const u = (t - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
    const s = i === 1 || i >= 3 ? u * u * (3 - 2 * u) : u;   // ease in/out except through contact
    z = lerp(K[i - 1][1], K[i][1], i === 2 ? u * u : i === 3 ? 1 - (1 - u) * (1 - u) : s);
    break;
  }
  return [0, 0, z];
}

/**
 * Tossing-hand target in ROOT coordinates at motion time t (the ball centre when held).
 * Before release the ball is in the hand; afterwards the arm keeps pointing at the ball, then tucks in.
 */
export function tossHand(type, t) {
  const { R } = TOSS[tossType(type)];
  const V = tossVelocity(type);
  if (t <= SERVE_T.release) {
    return keyed([[0, HAND_REST], [SERVE_T.drop, [-0.12, 0.94, 0.40]], [SERVE_T.release, R, V]], t);
  }
  const ro = rootOffset(t);
  const k = keyed([
    [SERVE_T.release, R, V],
    [SERVE_T.release + 0.22, [R[0] - 0.02, 2.03, R[2] - 0.02]],
    [SERVE_T.trophy, [R[0] - 0.03, 2.04, R[2] - 0.03]],
    [SERVE_T.racketDrop, [-0.05, 1.90, 0.40]],
    [SERVE_T.contact, [-0.12, 1.50, 0.52]],
    [SERVE_T.land, [-0.20, 1.18, 0.30 + 0.95]],
    [SERVE_T.finish, [-0.22, 1.05, 0.30 + 1.10]],
    [SERVE_T.end, [-0.10, 1.05, 0.35 + 1.15]],
  ], t);
  // keys after release are written in LOCAL coords (relative to O); convert to root
  return [k[0] - ro[0], k[1] - ro[1], k[2] - ro[2]];
}

/** Ball (local, relative to O) at motion time t, while it has not been hit. */
export function tossBall(type, t) {
  const tt = tossType(type);
  if (t <= SERVE_T.release) {
    const h = tossHand(tt, t), h2 = tossHand(tt, t + 1e-3);
    return { pos: h, vel: [(h2[0] - h[0]) / 1e-3, (h2[1] - h[1]) / 1e-3, (h2[2] - h[2]) / 1e-3], held: true };
  }
  const { R } = TOSS[tt], V = tossVelocity(tt), s = t - SERVE_T.release;
  return { pos: [R[0] + V[0] * s, R[1] + V[1] * s - 0.5 * G * s * s, R[2] + V[2] * s], vel: [V[0], V[1] - G * s, V[2]], held: false };
}

/** Ideal contact point (local, relative to O) for a toss type. */
export function contactPoint(type) { return TOSS[tossType(type)].C.slice(); }

// ------------------------------------------------------------------ frames
/** local (relative to origin O) -> world. player: {facing, hand}. Returns {x,y,z}. */
export function toWorld(player, O, l) {
  const handX = (player.hand === 'L' ? -1 : 1) * player.facing;
  return { x: O.x + handX * l[0], y: l[1], z: O.z - player.facing * l[2] };
}
/** world vector -> local vector (no origin). */
export function vecToWorld(player, v) {
  const handX = (player.hand === 'L' ? -1 : 1) * player.facing;
  return { x: handX * v[0], y: v[1], z: -player.facing * v[2] };
}
/** world point -> local (relative to O). */
export function toLocal(player, O, w) {
  const handX = (player.hand === 'L' ? -1 : 1) * player.facing;
  return [(w.x - O.x) * handX, w.y, -(w.z - O.z) * player.facing];
}
