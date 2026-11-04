// Footwork: distance-driven locomotion poses with planted feet (DESIGN.md §6.1).
//
// The sprite anchor is the player's ground position. A foot in stance must stay fixed in WORLD space, so in the
// sprite (character) frame it slides backwards at exactly the body's speed: with the cycle phase `gait` advanced by
// distance / strideLen, a stance foot moves -strideLen * dGait along the travel direction. The rig's orthographic
// sprite view and the game's perspective camera map metres to pixels slightly differently (sprite boost, depth
// foreshortening), so the along-travel foot offset is scaled per screen axis by kx / kz (camera px per metre divided
// by sprite px per metre) — see SpriteFactory.groundRatio().
//
// All poses are authored for a right-hander in the final character frame (x right, z forward); `yaw` turns the body
// to its facing and the feet are expressed back in the pre-yaw frame that solve() expects.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
const frac = (x) => x - Math.floor(x);

export const LOCO = new Set(['run', 'walk', 'shuffle', 'crossover', 'backpedal', 'brake']);
// stance fraction of each foot per cycle (depends only on style and stride, so the main thread can reproduce it)
export function locoSigma(name, L) {
  switch (name) {
    case 'shuffle': return clamp(0.30 / L + 0.02, 0.22, 0.5);
    case 'crossover': return 0.44;
    case 'backpedal': return 0.52;
    case 'brake': return clamp(0.4 / L, 0.3, 0.7);
    case 'walk': return 0.62;
    default: return 0.35;
  }
}
// planted-foot correction (metres along travel) when a frame rendered for stride Lq is shown for the true stride L:
// the stance foot of the quantised frame sits (sigma/2 - u) * (Lq - L) away from where it belongs.
export function strideCorrection(name, gq, Lq, L) {
  const sig = locoSigma(name, Lq);
  for (const off of [0, 0.5]) { const u = frac(gq + off); if (u < sig) return (sig / 2 - u) * (L - Lq); }
  return 0;
}
export const DEFAULT_STRIDE = { run: 2.0, walk: 1.3, shuffle: 0.9, crossover: 1.5, backpedal: 1.0, brake: 1.2 };

// world {x,z} -> final character frame (pre-mirror), see renderer/ballScreen: near: (x, -z), far: (-x, z)
export function worldToChar(v, role, mir) {
  if (!v) return null;
  const x = role === 'near' ? v.x : -v.x, z = role === 'near' ? -v.z : v.z;
  return [x * mir, z];
}

// Feet trajectory for one foot. u: foot phase (0 = touchdown), sigma: stance fraction, L: stride length.
// Returns travel offset s (metres along travel, relative to the foot's centre) and swing lift.
function footCycle(u, sigma, L, hmax) {
  u = frac(u);
  const span = sigma * L; // ground distance covered while this foot is planted
  if (u < sigma) {
    const t = u / sigma;
    return { s: span * 0.5 - u * L, y: 0, t, stance: true };
  }
  const t = (u - sigma) / (1 - sigma);
  return { s: -span * 0.5 + span * smooth(t), y: hmax * Math.sin(Math.PI * Math.pow(t, 0.7)), t, stance: false };
}

/**
 * anim: { name, gait, strideLen, dir, face, speed, accel }, ctx: { role, mir, kx, kz }
 * mk: pose constructor (READY defaults), V: vec helper. Returns a pose object for solve().
 */
export function locoPose(anim, ctx, mk, V) {
  const name = anim.name;
  const mir = ctx.mir || 1, role = ctx.role || 'near';
  const kx = ctx.kx || 1, kz = ctx.kz || 1, kzb = ctx.kzb || kz, kxz = (ctx.kxz || 0) * mir;
  const sp = clamp(anim.speed == null ? 0.6 : anim.speed, 0, 1);
  const acc = clamp(anim.accel || 0, -1, 1);
  const L = anim.strideLen || DEFAULT_STRIDE[name] || 1.5;
  const g = anim.gait != null ? anim.gait : (ctx.runPhase || 0);
  // travel and facing in the final character frame
  let d = worldToChar(anim.dir, role, mir) || [0, 1];
  let dl = Math.hypot(d[0], d[1]); d = dl > 1e-6 ? [d[0] / dl, d[1] / dl] : [0, 1];
  let f = worldToChar(anim.face, role, mir);
  // default facing: run faces the travel direction, the others face the net (character +z)
  if (!f || Math.hypot(f[0], f[1]) < 1e-6) f = name === 'run' || name === 'walk' ? d : [0, 1];
  dl = Math.hypot(f[0], f[1]); f = [f[0] / dl, f[1] / dl];
  const yaw = Math.atan2(f[0], f[1]);
  const rel = rotY([d[0], 0, d[1]], -yaw);           // travel in the body frame
  const latSign = rel[0] >= 0 ? 1 : -1;               // +1: travelling to the body's right

  // ---- per-style parameters
  let sigma, hmax, hipY, lean, side = 0, py = 0, cy = 0, hy = 0, hp = 0.04, bobA;
  let centres; // foot centres in the body frame [L, R]
  let fyaw = [0, 0];
  let arms;
  switch (name) {
    case 'shuffle': {
      // side steps facing the net: feet come together and push apart, never cross
      sigma = locoSigma(name, L); hmax = 0.045 + 0.03 * sp; hipY = 0.74 - 0.03 * sp; lean = 0.32; bobA = 0.018;
      centres = [V(-0.20, 0, 0.0), V(0.20, 0, 0.0)]; fyaw = [-0.18, 0.18];
      side = -0.05 * latSign * sp; py = 0.12 * latSign; cy = 0.05 * latSign; hy = -0.1 * latSign;
      arms = 'ready';
      break;
    }
    case 'crossover': {
      // hips open toward travel, shoulders stay squarer; the trailing leg crosses over in front
      sigma = locoSigma(name, L); hmax = 0.10 + 0.08 * sp; hipY = 0.78 - 0.03 * sp; lean = 0.26 + 0.15 * Math.max(0, acc); bobA = 0.03;
      // (the sim already half-turns `face` toward the travel; hips open further, shoulders counter-rotate square)
      py = 0.45 * latSign; cy = -0.12 * latSign; hy = -0.35 * latSign;
      const lead = latSign > 0 ? 1 : 0; // index of the leading foot (0 = L, 1 = R)
      centres = [V(-0.11, 0, lead === 0 ? -0.05 : 0.11), V(0.11, 0, lead === 1 ? -0.05 : 0.11)];
      fyaw = [0.8 * latSign, 0.8 * latSign];
      arms = 'carry';
      break;
    }
    case 'backpedal': {
      // drop step: hips turned sideways, stepping back; shoulders turned back toward the ball
      sigma = locoSigma(name, L); hmax = 0.06 + 0.04 * sp; hipY = 0.80; lean = 0.16 - 0.1 * Math.max(0, acc); bobA = 0.02;
      const sgn = rel[0] > 0.2 ? 1 : rel[0] < -0.2 ? -1 : 1;
      py = 0.95 * sgn; cy = 0.45 * sgn; hy = -0.15 * sgn; hp = 0.0;
      centres = [V(-0.13, 0, 0), V(0.13, 0, 0)].map((c) => rotY(c, py)); fyaw = [py, py];
      arms = 'ready';
      break;
    }
    case 'brake': {
      // wide, low base: outside leg planted far to the travel side, torso leaning back against the motion
      sigma = locoSigma(name, L); hmax = 0.04; hipY = 0.68; lean = 0.30; bobA = 0.0;
      const tside = Math.abs(rel[0]) > Math.abs(rel[2]) ? latSign : 0;
      side = -0.20 * tside; py = 0.35 * tside; cy = 0.55 * tside; hy = 0.0;
      if (tside === 0) { lean = rel[2] > 0 ? 0.05 : 0.38; }
      centres = [V(-0.25, 0, 0.02), V(0.25, 0, -0.02)]; fyaw = [-0.25 + 0.5 * Math.min(0, tside), 0.25 + 0.5 * Math.max(0, tside)];
      arms = 'prep';
      break;
    }
    case 'walk': {
      sigma = locoSigma(name, L); hmax = 0.06; hipY = 0.88; lean = 0.07; bobA = 0.015;
      centres = [V(-0.09, 0, 0), V(0.09, 0, 0)];
      arms = 'walk';
      break;
    }
    case 'run':
    default: {
      sigma = locoSigma(name, L); hmax = 0.12 + 0.20 * sp; hipY = 0.84 - 0.05 * sp; bobA = 0.035;
      lean = 0.14 + 0.18 * sp + 0.28 * Math.max(0, acc) - 0.12 * Math.max(0, -acc);
      centres = [V(-0.085, 0, 0), V(0.085, 0, 0)];
      arms = 'drive';
      break;
    }
  }

  // ---- feet (final frame), stance feet locked to the ground
  const feet = [], pitches = [];
  for (let k = 0; k < 2; k++) {
    const fc = footCycle(g + (k === 0 ? 0 : 0.5), sigma, L, hmax);
    const c = rotY(centres[k], yaw);
    const dz = d[1] * fc.s;
    const fx = c[0] + d[0] * fc.s * kx + dz * kxz, fz = c[2] + dz * (dz > 0 ? kz : kzb);
    feet.push(rotY([fx, fc.y, fz], -yaw)); // back to the pre-yaw frame
    // heel-off late in stance, toe-down in early swing
    pitches.push(fc.stance ? 0.5 * smooth(clamp((fc.t - 0.65) / 0.35, 0, 1)) : 0.45 * (1 - fc.t));
  }
  // travel-aligned foot yaw for run/walk
  if (name === 'run' || name === 'walk') { const ty = Math.atan2(rel[0], Math.max(0.25, rel[2])) * 0.6; fyaw = [ty, ty]; }

  const ph = TAU * g;
  const bob = Math.cos(2 * ph) * bobA; // lowest at mid-stance of each foot (twice per cycle)
  const p = mk({
    hip: V(0, hipY - bob, name === 'brake' ? -0.04 : 0.0), lean, side: side + 0.025 * Math.sin(ph) * (name === 'run' ? 1 : 0.4),
    py: py + (name === 'run' || name === 'walk' ? 0.18 * Math.sin(ph) * (name === 'walk' ? 0.5 : 1) : 0.04 * Math.sin(ph)),
    cy: cy - (name === 'run' || name === 'walk' ? 0.24 * Math.sin(ph) * (name === 'walk' ? 0.5 : 1) : 0.03 * Math.sin(ph)),
    hy, hp, fL: feet[0], fR: feet[1], fLy: fyaw[0], fRy: fyaw[1], fLp: pitches[0], fRp: pitches[1], yaw,
  });
  // ---- arms
  const cg = Math.cos(ph);
  if (arms === 'drive') {
    const a = 0.10 + 0.12 * sp;
    p.hD = V(0.17, 1.04 + 0.04 * Math.sin(ph), 0.26 + a * cg); p.ax = V(0.12, 0.62, 0.78); p.fc = V(0.7, 0.4, 0); p.th = 0;
    p.hO = V(-0.19, 1.10 + 0.06 * Math.abs(cg), 0.20 - (0.20 + 0.20 * sp) * cg);
  } else if (arms === 'carry') {
    p.hD = V(0.20 * latSign + 0.02, 1.06, 0.30); p.ax = V(0.15 * latSign, 0.6, 0.78); p.fc = V(0.8, 0.3, 0); p.th = 0.5;
    p.hO = V(-0.10, 1.10, 0.30 - 0.12 * cg);
  } else if (arms === 'walk') {
    p.hD = V(0.25, 0.78, 0.08 + 0.17 * cg); p.ax = V(0.10, -0.80, 0.45); p.fc = V(1, 0, 0); p.th = 0;
    p.hO = V(-0.25, 0.80, 0.08 - 0.17 * cg);
  } else if (arms === 'prep') {
    // braking is the loading position: racket already going back toward the stroke side
    const sgn = Math.abs(rel[0]) > 0.3 ? latSign : 1;
    p.hD = V(0.30 * sgn, 1.10, 0.10); p.ax = V(0.25 * sgn, 0.62, -0.5); p.fc = V(0.4, -0.3, 0.6); p.th = sgn > 0 ? 0.3 : 1; p.offT = sgn > 0 ? 0.235 : 0.17;
    p.hO = V(-0.05 * sgn, 1.20, 0.42);
  }
  // 'ready': READY hands (racket in front, off hand on the throat)
  return p;
}
