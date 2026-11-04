// Player archetypes (DESIGN.md §7.2) and contact-dependent stroke adaptation (§7.1).
//
// Archetypes are inspired by playing styles and builds, not by any particular person: no names, likenesses or marks.
//   'classic' — the default build.
//   'elastic' — lean, wiry, very flexible all-court defender: wide low base, slides / split-lunges, compact take-back,
//               two-handed backhand with full extension through contact and a wide balanced finish.
//   'lanky'   — tall, long-limbed aggressive baseliner: upright, narrow shoulders for the height, long levers, early
//               take-back, flat penetrating strokes from an open stance, quick light steps, fuller wavy hair.
// Everything here edits the pose parameter object P (pose.js) — no solving — so it runs in the workers too.

export const ARCHETYPES = {
  classic: {
    h: 1.0, leg: 1.0, arm: 1.0, sh: 1.0, hipW: 1.0, muscle: 1.0, lean: 0, stance: 1.0, drop: 0, tb: 1.0, early: 0, flat: 0, open: 0, hair: 'short',
    look: { skin: '#e0a97c', hair: '#2a1d12', shirt: '#e8e8e0', shorts: '#2a3a6a', shoes: '#f0f0f0', headband: null },
  },
  elastic: {
    h: 1.01, leg: 1.0, arm: 1.02, sh: 0.97, hipW: 0.97, muscle: 0.88, lean: 0.04, stance: 1.16, drop: 0.045, tb: 0.80, early: 0, flat: 0.25, open: 0.2, hair: 'short',
    look: { skin: '#d9a27a', hair: '#1e1712', shirt: '#2e6fbf', shorts: '#1d2433', shoes: '#f2f2f2', headband: null, trim: '#e8eef6' },
  },
  lanky: {
    h: 1.06, leg: 1.03, arm: 1.05, sh: 0.93, hipW: 0.95, muscle: 0.86, lean: -0.06, stance: 1.02, drop: -0.02, tb: 1.15, early: 0.25, flat: 0.55, open: 1.0, hair: 'wavy',
    look: { skin: '#f0c8a8', hair: '#a8582a', shirt: '#2f7d4a', shorts: '#f2f2ee', shoes: '#f4f4f4', headband: '#f4f4f4' },
  },
};
export function archOf(look) { return ARCHETYPES[(look && look.archetype) || 'classic'] || ARCHETYPES.classic; }
export function archName(look) { const n = look && look.archetype; return ARCHETYPES[n] ? n : 'classic'; }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// rig dimensions for an archetype (pose.js BODY scaled)
const bodyCache = new Map();
export function bodyFor(BODY, A) {
  let b = bodyCache.get(A);
  if (!b) {
    const H = A.h;
    b = { ...BODY,
      hipHalf: BODY.hipHalf * A.hipW, thigh: BODY.thigh * H * A.leg, shin: BODY.shin * H * A.leg, ankleH: BODY.ankleH,
      upperArm: BODY.upperArm * H * A.arm, foreArm: BODY.foreArm * H * A.arm, shoulderHalf: BODY.shoulderHalf * A.sh,
      spine: BODY.spine * H * (2 - A.leg), waist: BODY.waist * H };
    bodyCache.set(A, b);
  }
  return b;
}

// ---- archetype posture / stance for standing poses and strokes (not serve: its hands follow the serve choreography)
// legScale: how much taller the hips are (leg length ratio), so feet stay on the ground with the same knee bend
export function archPose(P, A, name) {
  if (A === ARCHETYPES.classic) return P;
  const legK = A.h * A.leg;
  const stand = name === 'ready' || name === 'split' || name === 'idle' || name === 'celebrate' || name === 'dejected';
  P.hip = [P.hip[0], P.hip[1] * legK - (stand || name === 'swing' ? A.drop : 0), P.hip[2]];
  P.lean += A.lean;
  if (stand || name === 'swing') {
    const cx = (P.fL[0] + P.fR[0]) / 2;
    P.fL = [cx + (P.fL[0] - cx) * A.stance, P.fL[1], P.fL[2]];
    P.fR = [cx + (P.fR[0] - cx) * A.stance, P.fR[1], P.fR[2]];
  }
  // longer levers: hands further from the shoulders (scale about the chest)
  const k = A.h * A.arm;
  if (k !== 1) {
    const c = [0, P.hip[1] + 0.5, 0];
    const sc = (p) => add(c, mul([p[0] - c[0], p[1] - c[1], p[2] - c[2]], k));
    P.hD = sc(P.hD); P.hO = sc(P.hO);
  }
  return P;
}

// ---- stroke style per archetype (phase warp + keyframe blends), applied before contact adaptation
// returns the (possibly warped) phase to sample and a list of [otherTrackKey, weight] blends
export function strokeStyle(A, shot, side, ph) {
  let p = ph;
  // early / compact take-back: the preparation runs ahead (lanky) and is shorter (elastic: tb < 1 handled later)
  if (A.early > 0 && p < 0.45) p = Math.min(0.45, p * (1 + A.early));
  const blends = [];
  if (A.flat > 0 && shot === 'topspin') blends.push([`flat|${side}`, A.flat]);
  return { p, blends };
}
export function strokeTweak(P, A, shot, side, ph, READY) {
  // compact take-back: pull the hands toward the ready position during the backswing
  if (A.tb !== 1 && ph < 0.5) {
    const w = (1 - A.tb) * smooth(ph / 0.2) * (1 - smooth((ph - 0.40) / 0.1));
    if (w > 0) P.hD = lerpV(P.hD, READY.hD, A.tb < 1 ? w : 0);
    if (A.tb > 1) { const e = (A.tb - 1) * smooth(ph / 0.25) * (1 - smooth((ph - 0.42) / 0.08)); P.hD = add(P.hD, mul([P.hD[0] - READY.hD[0], P.hD[1] - READY.hD[1], P.hD[2] - READY.hD[2]], e)); }
  }
  // open stance forehand: the front foot stays beside the back foot (parallel to the baseline)
  if (A.open > 0 && side === 'fh' && ph > 0.08) {
    const w = A.open * smooth((ph - 0.08) / 0.12);
    P.fL = lerpV(P.fL, [P.fR[0] - 0.62, 0, P.fR[2] + 0.04], w * 0.75);
    P.fLy = P.fLy * (1 - w) + -0.1 * w;
    P.py -= 0.15 * w * (ph < 0.5 ? 1 : 0);
  }
  // elastic two-hander: full extension through contact and a wide, balanced finish
  if (A === ARCHETYPES.elastic && side === 'bh' && shot !== 'slice') {
    const w = smooth((ph - 0.44) / 0.1) * (1 - smooth((ph - 0.72) / 0.12));
    P.hD = add(P.hD, [0.04 * w, 0.0, 0.12 * w]);
    const fw = smooth((ph - 0.6) / 0.2);
    P.side += -0.06 * fw; P.fR = [P.fR[0] + 0.08 * fw, P.fR[1], P.fR[2]];
  }
  return P;
}

// ---- contact-dependent adaptation (SIM: anim.contact {lat,fwd,h}, anim.variant, anim.reachT)
// S0: default string-bed centre of this stroke at contact (character frame, right-hander); C: wanted contact
export function contactWeight(ph) {
  return ph < 0.5 ? smooth((ph - 0.10) / 0.38) : 1 - 0.75 * smooth((ph - 0.5) / 0.3);
}
export function contactTarget(anim) {
  const c = anim.contact; if (!c) return null;
  const sgn = anim.side === 'bh' ? -1 : 1;
  return [c.lat * sgn, c.h, c.fwd];
}
export function adaptContact(P, anim, ph, S0, A, samplePose) {
  const C = contactTarget(anim);
  const v = anim.variant || 'normal';
  const rt = clamp(anim.reachT == null ? 0 : anim.reachT, 0, 1);
  const sgn = anim.side === 'bh' ? -1 : 1;
  const w = contactWeight(ph);
  const wb = ph < 0.5 ? smooth((ph - 0.05) / 0.35) : 1 - 0.5 * smooth((ph - 0.55) / 0.4); // body / stance
  let D = [0, 0, 0];
  if (C) {
    D = [C[0] - S0[0], C[1] - S0[1], C[2] - S0[2]];
    P.hD = add(P.hD, mul(D, w));
    if (P.th > 0.5) P.hO = add(P.hO, mul(D, w));
    // the body goes toward the ball: lateral lunge, lower for low balls, step in for balls in front
    P.hip = add(P.hip, [clamp(D[0] * 0.45, -0.35, 0.35) * wb, clamp(D[1] * 0.15, -0.10, 0.04) * wb, clamp(D[2] * 0.3, -0.2, 0.25) * wb]);
    // outside foot steps toward the ball (fh: racket-side foot, bh: other foot); front foot toward balls in front
    const lat = D[0] * sgn;
    const out = clamp(lat * 0.75, -0.25, 0.6) * sgn * wb;
    if (sgn > 0) P.fR = add(P.fR, [out, 0, 0]); else P.fL = add(P.fL, [out, 0, 0]);
    const fz = clamp(D[2] * 0.5, -0.2, 0.35) * wb;
    if (sgn > 0) P.fL = add(P.fL, [0, 0, fz]); else P.fR = add(P.fR, [0, 0, fz]);
  }
  switch (v) {
    case 'stretch': {
      const k = (0.5 + 0.5 * rt) * wb;
      if (A === ARCHETYPES.elastic) {
        // hard-court split slide: both legs extended, very low, outside foot sliding flat
        P.hip = add(P.hip, [0.10 * sgn * k, -0.20 * k, 0]);
        if (sgn > 0) { P.fR = add(P.fR, [0.42 * k, 0, 0.05 * k]); P.fL = add(P.fL, [-0.22 * k, 0, -0.05 * k]); P.fRp *= 1 - k; P.fRy += 0.9 * k; }
        else { P.fL = add(P.fL, [-0.42 * k, 0, 0.05 * k]); P.fR = add(P.fR, [0.22 * k, 0, -0.05 * k]); P.fLp *= 1 - k; P.fLy -= 0.9 * k; }
        P.lean += 0.10 * k; P.side += -0.10 * sgn * k;
      } else {
        // open-stance lunge: outside leg loaded far out, centre of mass low, arm fully out
        P.hip = add(P.hip, [0.08 * sgn * k, -0.10 * k, 0]);
        if (sgn > 0) P.fR = add(P.fR, [0.22 * k, 0, 0.06 * k]); else P.fL = add(P.fL, [-0.22 * k, 0, 0.06 * k]);
        P.lean += 0.12 * k; P.side += 0.06 * sgn * k;
      }
      break;
    }
    case 'jammed': {
      // ball into the body: lean / step away, elbow tucked, compact swing
      const k = wb;
      P.hip = add(P.hip, [-0.09 * sgn * k, -0.02 * k, -0.04 * k]);
      P.side += -0.10 * sgn * k; P.cy *= 1 - 0.25 * k;
      if (ph > 0.5 && samplePose) { const pp = 0.5 + (ph - 0.5) * 0.45, m = samplePose(pp); m.hD = add(m.hD, mul(D, contactWeight(pp))); compress(P, m, 0.6 * smooth((ph - 0.5) / 0.1)); }
      break;
    }
    case 'run': {
      // hitting on the move: follow-through carries forward, back foot comes through
      const f = smooth((ph - 0.42) / 0.5);
      P.hip = add(P.hip, [0, 0.03 * f, 0.22 * f]);
      P.lean += 0.10 * f;
      const back = sgn > 0 ? 'fR' : 'fL';
      P[back] = add(P[back], [0, 0.14 * Math.sin(Math.PI * clamp((ph - 0.5) / 0.4, 0, 1)), 0.45 * f]);
      P[back + 'p'] = 0.6 * f;
      break;
    }
    case 'high': {
      // shoulder-height take-back; jump for very high balls
      const tbw = smooth((ph - 0.08) / 0.2) * (1 - smooth((ph - 0.45) / 0.1));
      P.hD = add(P.hD, [0, 0.28 * tbw, 0]);
      P.lean -= 0.10 * wb;
      const hh = C ? C[1] : 1.6;
      const lift = clamp((hh - 1.75) * 0.7, 0, 0.26) * Math.sin(Math.PI * clamp((ph - 0.36) / 0.3, 0, 1));
      if (lift > 0) { P.hip = add(P.hip, [0, lift, 0]); P.fL = add(P.fL, [0, lift * 0.9, 0]); P.fR = add(P.fR, [0, lift * 0.9, 0]); P.fLp = 0.4; P.fRp = 0.4; }
      break;
    }
    case 'low': {
      P.hip = add(P.hip, [0, -0.13 * wb, -0.03 * wb]);
      P.lean += 0.12 * wb;
      P.ax = norm(add(P.ax, [0, -0.6 * w, 0]));   // racket head dropped
      break;
    }
    case 'defensive': {
      // blocked / sliced: open face, short punch
      P.fc = norm(add(P.fc, [0, 0.8 * w, 0]));
      if (ph > 0.5 && samplePose) { const pp = 0.5 + (ph - 0.5) * 0.4, m = samplePose(pp); m.hD = add(m.hD, mul(D, contactWeight(pp))); compress(P, m, 0.55 * smooth((ph - 0.5) / 0.1)); }
      P.hip = add(P.hip, [0, -0.04 * wb, 0]);
      break;
    }
    default: break;
  }
  return P;
}
// pull the arm / racket part of P toward a reference pose (shorter follow-through)
function compress(P, M, k) {
  if (k <= 0) return;
  P.hD = lerpV(P.hD, M.hD, k); P.ax = norm(lerpV(P.ax, M.ax, k)); P.fc = norm(lerpV(P.fc, M.fc, k));
  P.cy += (M.cy - P.cy) * k; P.py += (M.py - P.py) * k;
}
