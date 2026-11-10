// Pose field layout, keyframe tables (Hermite interpolation) and the stroke library.
// All positions are in the "torso frame" T: origin = pelvis ground projection, yaw = pelvis yaw + chest yaw,
// +x = dominant side (canonical, right-hander look), +z = chest facing, y up. Metres / radians.
// racket: hx,hy,hz = grip (palm centre) position; ax,ay,az = shaft direction (towards the head); nx,ny,nz = hitting-face hint.

export const FN = ['pYaw', 'cYaw', 'lean', 'side', 'tilt', 'hip', 'sx', 'sz', 'px', 'pz', 'hipX',
  'hx', 'hy', 'hz', 'ax', 'ay', 'az', 'nx', 'ny', 'nz',
  'lw', 'lg', 'lx', 'ly', 'lz', 'palm', 'hYaw', 'hPitch', 'track', 'eD', 'eN', 'jmp', 'heel', 'eff', 'lean2', 'side2'];
export const NF = FN.length;
export const F = {}; FN.forEach((n, i) => { F[n] = i; });

export const BASE = Float32Array.from(FN.map((n) => ({
  pYaw: 0, cYaw: 0, lean: 0.13, side: 0, tilt: 0.06, hip: 0.13, sx: 0, sz: 0.02, px: 0, pz: 0, hipX: 0,
  hx: 0.12, hy: 0.98, hz: 0.42, ax: 0, ay: 0.55, az: 0.8, nx: 1, ny: 0, nz: 0,
  lw: 1, lg: 0.25, lx: -0.2, ly: 1.0, lz: 0.3, palm: 0, hYaw: 0, hPitch: 0, track: 1, eD: 0.35, eN: 0.35,
  jmp: 0, heel: 0, eff: 0, lean2: 0, side2: 0,
}[n])));

export function makeTable(keys) {
  const t = [], v = [];
  let cur = Float32Array.from(BASE);
  for (const [p, o] of keys) {
    cur = Float32Array.from(cur);
    for (const k in o) { if (!(k in F)) throw new Error('bad field ' + k); cur[F[k]] = o[k]; }
    t.push(p); v.push(cur);
  }
  const n = t.length;
  const m = v.map(() => new Float32Array(NF));
  for (let i = 1; i < n - 1; i++) {
    const dt = t[i + 1] - t[i - 1];
    for (let f = 0; f < NF; f++) m[i][f] = (v[i + 1][f] - v[i - 1][f]) / dt;
  }
  return { t, v, m, n };
}

export function evalTable(tb, p, out) {
  const { t, v, m, n } = tb;
  if (p <= t[0]) { out.set(v[0]); return out; }
  if (p >= t[n - 1]) { out.set(v[n - 1]); return out; }
  let i = 0;
  while (i < n - 2 && p > t[i + 1]) i++;
  const dt = t[i + 1] - t[i], u = (p - t[i]) / dt, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const a = v[i], b = v[i + 1], ma = m[i], mb = m[i + 1];
  for (let f = 0; f < NF; f++) out[f] = h00 * a[f] + h10 * dt * ma[f] + h01 * b[f] + h11 * dt * mb[f];
  return out;
}

// stance foot spots in B (canonical, dominant = +x): [x, z, yaw]
const S = (dx, dz, dy, nx, nz, ny) => ({ D: [dx, dz, dy], N: [nx, nz, ny] });

// --------------------------------------------------------------------------- strokes
// nominal contact in dominant-lateral coordinates {lat (+ = dominant side), fwd, h}
const FH_NOM = { lat: 0.68, fwd: 0.45, h: 0.92 };
const BH_NOM = { lat: -0.55, fwd: 0.38, h: 0.95 };

const FH_STANCE = S(0.34, -0.12, 0.85, -0.16, 0.30, 0.45);
const BH_STANCE = S(0.12, 0.30, -0.80, -0.34, -0.08, -0.85);

const T = {}; // key = shot_side

T.topspin_fh = {
  nom: FH_NOM, stance: FH_STANCE, dur: 0.75, lowAdapt: 1,
  tbl: makeTable([
    [0.00, {}],
    [0.12, { pYaw: 0.45, cYaw: 0.2, lean: 0.22, hip: 0.16, hx: 0.30, hy: 1.02, hz: 0.30, ax: 0.1, ay: 0.55, az: 0.8, nx: 1, ny: 0, nz: 0.1 }],
    [0.27, { pYaw: 0.95, cYaw: 0.5, lean: 0.2, hip: 0.20, hx: 0.50, hy: 1.12, hz: -0.14, ax: 0.25, ay: 0.35, az: -0.9, nx: 0.5, ny: -0.8, nz: 0.1, lw: 0.55, lx: -0.38, ly: 1.28, lz: 0.5 }],
    [0.40, { pYaw: 0.85, cYaw: 0.5, lean: 0.28, hip: 0.27, hx: 0.42, hy: 0.88, hz: -0.14, ax: 0.1, ay: -0.55, az: -0.8, nx: 0.9, ny: 0.2, nz: 0.1, lw: 0, lx: -0.4, ly: 1.28, lz: 0.5, eD: 0.2 }],
    [0.50, { pYaw: 0.25, cYaw: 0.12, lean: 0.3, hip: 0.22, hx: 0.36, hy: 0.88, hz: 0.34, ax: 0.9, ay: 0.12, az: 0.4, nx: 0.1, ny: 0.2, nz: 1, lx: -0.35, ly: 1.15, lz: 0.2 }],
    [0.62, { pYaw: -0.2, cYaw: -0.12, lean: 0.24, hip: 0.15, hx: 0.10, hy: 1.22, hz: 0.52, ax: -0.1, ay: 0.9, az: 0.4, nx: 1, ny: 0, nz: 0.3, lx: -0.5, ly: 1.1, lz: 0.0, eD: 0.45 }],
    [0.80, { pYaw: -0.55, cYaw: -0.45, lean: 0.12, hip: 0.1, hx: -0.15, hy: 1.5, hz: 0.20, ax: -0.4, ay: -0.5, az: -0.7, nx: 0, ny: 1, nz: 0.5, lx: -0.2, ly: 1.15, lz: 0.2, eD: 0.6 }],
    [1.00, { pYaw: -0.3, cYaw: -0.25, lean: 0.18, hip: 0.13, hx: 0.0, hy: 1.3, hz: 0.45, ax: -0.1, ay: 0.3, az: 0.9, nx: 1, ny: 0, nz: 0, lw: 1, lg: 0.25 }],
  ]),
};

T.flat_fh = {
  nom: FH_NOM, stance: FH_STANCE, dur: 0.65, lowAdapt: 1,
  tbl: makeTable([
    [0.00, {}],
    [0.12, { pYaw: 0.5, cYaw: 0.2, lean: 0.22, hip: 0.16, hx: 0.32, hy: 1.04, hz: 0.25, ax: 0.1, ay: 0.4, az: 0.9, nx: 1, ny: 0, nz: 0.1 }],
    [0.27, { pYaw: 0.95, cYaw: 0.5, lean: 0.2, hip: 0.2, hx: 0.50, hy: 1.06, hz: -0.06, ax: 0.2, ay: 0.12, az: -1, nx: 0.5, ny: -0.6, nz: 0.4, lw: 0.55, lx: -0.38, ly: 1.28, lz: 0.5 }],
    [0.40, { pYaw: 0.8, cYaw: 0.45, lean: 0.26, hip: 0.24, hx: 0.44, hy: 0.98, hz: -0.04, ax: 0.2, ay: 0.0, az: -1, nx: 0.6, ny: -0.3, nz: 0.6, lw: 0, lx: -0.4, ly: 1.28, lz: 0.5 }],
    [0.50, { pYaw: 0.25, cYaw: 0.12, lean: 0.3, hip: 0.22, hx: 0.36, hy: 0.92, hz: 0.38, ax: 0.9, ay: 0.08, az: 0.4, nx: 0.1, ny: 0.1, nz: 1, lx: -0.35, ly: 1.15, lz: 0.2 }],
    [0.64, { pYaw: -0.25, cYaw: -0.12, lean: 0.24, hip: 0.15, hx: 0.20, hy: 1.08, hz: 0.58, ax: 0.5, ay: 0.3, az: 0.8, nx: 0.3, ny: 0, nz: 1, lx: -0.5, ly: 1.1, lz: 0.0 }],
    [0.82, { pYaw: -0.55, cYaw: -0.4, lean: 0.14, hip: 0.1, hx: -0.12, hy: 1.28, hz: 0.38, ax: -0.7, ay: 0.2, az: 0.5, nx: 0, ny: 0.4, nz: 1, lx: -0.2, ly: 1.15, lz: 0.2 }],
    [1.00, { pYaw: -0.3, cYaw: -0.25, lean: 0.18, hip: 0.13, hx: 0.0, hy: 1.3, hz: 0.45, ax: -0.1, ay: 0.3, az: 0.9, nx: 1, ny: 0, nz: 0, lw: 1 }],
  ]),
};

T.slice_fh = {
  nom: { lat: 0.66, fwd: 0.46, h: 0.95 }, stance: FH_STANCE, dur: 0.7, lowAdapt: 1,
  tbl: makeTable([
    [0.00, {}],
    [0.12, { pYaw: 0.5, cYaw: 0.2, lean: 0.2, hip: 0.15, hx: 0.36, hy: 1.12, hz: 0.20, ax: 0.2, ay: 0.7, az: 0.5, nx: 1, ny: 0, nz: 0 }],
    [0.28, { pYaw: 0.95, cYaw: 0.5, lean: 0.14, hip: 0.18, hx: 0.46, hy: 1.46, hz: -0.06, ax: 0.35, ay: 0.7, az: -0.6, nx: 0.7, ny: 0.5, nz: -0.2, lw: 0.6, lx: -0.4, ly: 1.3, lz: 0.5 }],
    [0.40, { pYaw: 0.8, cYaw: 0.45, lean: 0.2, hip: 0.22, hx: 0.42, hy: 1.50, hz: 0.06, ax: 0.35, ay: 0.85, az: -0.1, nx: 0.6, ny: 0.7, nz: 0.2, lw: 0, lx: -0.4, ly: 1.3, lz: 0.5 }],
    [0.50, { pYaw: 0.3, cYaw: 0.12, lean: 0.28, hip: 0.22, hx: 0.38, hy: 1.1, hz: 0.38, ax: 0.9, ay: 0.3, az: 0.35, nx: 0.1, ny: 0.55, nz: 1, lx: -0.35, ly: 1.2, lz: 0.2 }],
    [0.68, { pYaw: -0.1, cYaw: -0.05, lean: 0.3, hip: 0.2, hx: 0.12, hy: 0.88, hz: 0.58, ax: 0.2, ay: -0.2, az: 0.95, nx: 0.2, ny: 0.7, nz: 0.6, lx: -0.55, ly: 1.15, lz: 0.0 }],
    [0.85, { pYaw: -0.2, cYaw: -0.12, lean: 0.24, hip: 0.15, hx: 0.12, hy: 0.88, hz: 0.52, ax: 0.1, ay: 0.0, az: 1, nx: 0.5, ny: 0.7, nz: 0.2 }],
    [1.00, { pYaw: -0.1, cYaw: -0.05, lean: 0.18, hip: 0.13, hx: 0.1, hy: 1.0, hz: 0.45, ax: 0, ay: 0.45, az: 0.9, nx: 1, ny: 0, nz: 0, lw: 1 }],
  ]),
};

T.lob_fh = {
  nom: { lat: 0.66, fwd: 0.4, h: 0.7 }, stance: FH_STANCE, dur: 0.75, lowAdapt: 1,
  tbl: makeTable([
    [0.00, {}],
    [0.14, { pYaw: 0.55, cYaw: 0.25, lean: 0.26, hip: 0.2, hx: 0.34, hy: 1.0, hz: 0.2, ax: 0.1, ay: 0.3, az: 0.9, nx: 1, ny: 0, nz: 0.1 }],
    [0.30, { pYaw: 0.95, cYaw: 0.5, lean: 0.26, hip: 0.3, hx: 0.48, hy: 0.88, hz: -0.1, ax: 0.2, ay: -0.2, az: -1, nx: 0.5, ny: -0.5, nz: 0.4, lw: 0.55, lx: -0.38, ly: 1.2, lz: 0.5 }],
    [0.42, { pYaw: 0.8, cYaw: 0.45, lean: 0.3, hip: 0.36, hx: 0.42, hy: 0.58, hz: -0.04, ax: 0.2, ay: -0.5, az: -0.9, nx: 0.7, ny: 0.3, nz: 0.3, lw: 0, lx: -0.4, ly: 1.2, lz: 0.5, eD: 0.2 }],
    [0.50, { pYaw: 0.35, cYaw: 0.15, lean: 0.24, hip: 0.3, hx: 0.38, hy: 0.62, hz: 0.28, ax: 0.8, ay: 0.4, az: 0.3, nx: 0.0, ny: 0.7, nz: 1, lx: -0.35, ly: 1.15, lz: 0.2 }],
    [0.64, { pYaw: -0.1, cYaw: -0.05, lean: 0.06, hip: 0.05, hx: 0.18, hy: 1.3, hz: 0.4, ax: 0.4, ay: 1.0, az: 0.4, nx: 0.6, ny: 0.0, nz: 0.6, lx: -0.5, ly: 1.1, lz: 0.1, heel: 0.6 }],
    [0.82, { pYaw: -0.45, cYaw: -0.35, lean: 0.0, hip: 0.0, hx: -0.05, hy: 1.7, hz: 0.18, ax: -0.5, ay: 0.2, az: -0.8, nx: 0, ny: 0.8, nz: 0.5, lx: -0.2, ly: 1.2, lz: 0.2, heel: 0.8 }],
    [1.00, { pYaw: -0.3, cYaw: -0.25, lean: 0.14, hip: 0.1, hx: 0.0, hy: 1.4, hz: 0.4, ax: -0.1, ay: 0.4, az: 0.9, nx: 1, ny: 0, nz: 0, lw: 1 }],
  ]),
};

// two-handed backhand drive (keys in body frame B; hands: dominant on the butt, other hand above it)
const bh2 = (flat) => ({
  nom: BH_NOM, stance: BH_STANCE, dur: 0.75, lowAdapt: 1, twoHand: true,
  tbl: makeTable([
    [0.00, {}],
    [0.12, { pYaw: -0.5, cYaw: -0.2, lean: 0.22, hip: 0.16, hx: 0.0, hy: 1.02, hz: 0.34, ax: -0.2, ay: 0.5, az: 0.8, nx: 1, ny: 0, nz: 0.2, lg: 0.13 }],
    [0.27, { pYaw: -1.0, cYaw: -0.5, lean: 0.2, hip: 0.2, hx: -0.12, hy: flat ? 1.06 : 1.14, hz: 0.10, ax: -0.35, ay: flat ? 0.1 : 0.4, az: -0.85, nx: 0.2, ny: -0.6, nz: -0.1, lg: 0.13 }],
    [0.40, { pYaw: -0.95, cYaw: -0.45, lean: 0.28, hip: 0.27, hx: -0.12, hy: flat ? 0.98 : 0.84, hz: 0.14, ax: -0.4, ay: flat ? 0.0 : -0.5, az: -0.8, nx: -0.3, ny: 0.2, nz: 0.4, lg: 0.13, eN: 0.3 }],
    [0.50, { pYaw: -0.45, cYaw: -0.2, lean: 0.3, hip: 0.22, hx: -0.12, hy: 0.9, hz: 0.36, ax: -0.88, ay: 0.12, az: 0.45, nx: 0, ny: 0.1, nz: 1, lg: 0.13 }],
    [0.64, { pYaw: 0.15, cYaw: 0.08, lean: 0.22, hip: 0.14, hx: 0.05, hy: 1.25, hz: 0.5, ax: -0.4, ay: 0.85, az: 0.35, nx: 0.3, ny: 0, nz: 1, lg: 0.13 }],
    [0.82, { pYaw: 0.55, cYaw: 0.3, lean: 0.1, hip: 0.1, hx: 0.22, hy: 1.5, hz: 0.1, ax: 0.2, ay: -0.2, az: -1, nx: 0.5, ny: 0.5, nz: 0.2, lg: 0.13 }],
    [1.00, { pYaw: 0.25, cYaw: 0.15, lean: 0.18, hip: 0.13, hx: 0.2, hy: 1.25, hz: 0.45, ax: 0, ay: 0.4, az: 0.9, nx: 1, ny: 0, nz: 0, lg: 0.25 }],
  ]),
});
T.topspin_bh = bh2(false);
T.flat_bh = bh2(true);

// one-handed slice / lob backhand
T.slice_bh = {
  nom: { lat: -0.58, fwd: 0.4, h: 0.95 }, stance: BH_STANCE, dur: 0.7, lowAdapt: 1,
  tbl: makeTable([
    [0.00, {}],
    [0.12, { pYaw: -0.45, cYaw: -0.2, lean: 0.2, hip: 0.15, hx: 0.06, hy: 1.1, hz: 0.3, ax: -0.2, ay: 0.7, az: 0.6, nx: 1, ny: 0, nz: 0 }],
    [0.28, { pYaw: -0.95, cYaw: -0.5, lean: 0.14, hip: 0.18, hx: -0.12, hy: 1.42, hz: 0.14, ax: -0.5, ay: 0.7, az: -0.5, nx: 0.2, ny: 0.8, nz: 0.2, lw: 1, lg: 0.28, eD: 0.5 }],
    [0.40, { pYaw: -0.9, cYaw: -0.5, lean: 0.2, hip: 0.22, hx: -0.14, hy: 1.46, hz: 0.2, ax: -0.5, ay: 0.8, az: -0.1, nx: 0.3, ny: 0.8, nz: 0.3, lw: 0.5, lg: 0.28, lx: -0.5, ly: 1.2, lz: -0.2 }],
    [0.50, { pYaw: -0.5, cYaw: -0.25, lean: 0.26, hip: 0.22, hx: -0.02, hy: 1.12, hz: 0.42, ax: -0.9, ay: 0.3, az: 0.3, nx: 0.1, ny: 0.55, nz: 1, lw: 0, lx: -0.62, ly: 1.2, lz: -0.2 }],
    [0.68, { pYaw: -0.3, cYaw: -0.15, lean: 0.28, hip: 0.2, hx: 0.08, hy: 0.9, hz: 0.58, ax: -0.4, ay: -0.2, az: 0.9, nx: 0.2, ny: 0.7, nz: 0.5, lw: 0, lx: -0.62, ly: 1.25, lz: -0.3 }],
    [0.85, { pYaw: -0.3, cYaw: -0.15, lean: 0.24, hip: 0.15, hx: 0.1, hy: 0.9, hz: 0.52, ax: -0.1, ay: 0.0, az: 1, nx: 0.5, ny: 0.7, nz: 0.2, lw: 0, lx: -0.62, ly: 1.2, lz: -0.2 }],
    [1.00, { pYaw: -0.1, cYaw: -0.05, lean: 0.18, hip: 0.13, hx: 0.1, hy: 1.0, hz: 0.45, ax: 0, ay: 0.45, az: 0.9, nx: 1, ny: 0, nz: 0, lw: 1, lg: 0.25 }],
  ]),
};
T.lob_bh = {
  nom: { lat: -0.58, fwd: 0.35, h: 0.7 }, stance: BH_STANCE, dur: 0.75, lowAdapt: 1, twoHand: true,
  tbl: makeTable([
    [0.00, {}],
    [0.14, { pYaw: -0.55, cYaw: -0.25, lean: 0.26, hip: 0.2, hx: 0.04, hy: 1.0, hz: 0.3, ax: -0.15, ay: 0.3, az: 0.9, nx: 1, ny: 0, nz: 0.2, lg: 0.13 }],
    [0.30, { pYaw: -1.0, cYaw: -0.5, lean: 0.26, hip: 0.3, hx: -0.06, hy: 0.9, hz: 0.14, ax: -0.4, ay: -0.2, az: -0.9, nx: 0.2, ny: -0.5, nz: 0.2, lg: 0.13 }],
    [0.42, { pYaw: -1.0, cYaw: -0.45, lean: 0.3, hip: 0.36, hx: -0.04, hy: 0.62, hz: 0.18, ax: -0.4, ay: -0.5, az: -0.8, nx: -0.2, ny: 0.4, nz: 0.4, lg: 0.13 }],
    [0.50, { pYaw: -0.55, cYaw: -0.22, lean: 0.24, hip: 0.3, hx: 0.0, hy: 0.66, hz: 0.32, ax: -0.8, ay: 0.4, az: 0.3, nx: 0, ny: 0.7, nz: 1, lg: 0.13 }],
    [0.64, { pYaw: 0.0, cYaw: 0.0, lean: 0.06, hip: 0.05, hx: 0.1, hy: 1.3, hz: 0.4, ax: -0.3, ay: 1.0, az: 0.4, nx: 0.4, ny: 0, nz: 0.8, lg: 0.13, heel: 0.6 }],
    [0.82, { pYaw: 0.35, cYaw: 0.25, lean: 0.0, hip: 0.0, hx: 0.25, hy: 1.7, hz: 0.12, ax: 0.3, ay: 0.2, az: -0.8, nx: 0.4, ny: 0.7, nz: 0.2, lg: 0.13, heel: 0.8 }],
    [1.00, { pYaw: 0.2, cYaw: 0.1, lean: 0.14, hip: 0.1, hx: 0.2, hy: 1.4, hz: 0.4, ax: 0, ay: 0.4, az: 0.9, nx: 1, ny: 0, nz: 0, lg: 0.25 }],
  ]),
};

// volleys: compact punch
T.volley_fh = {
  nom: { lat: 0.55, fwd: 0.5, h: 1.1 }, stance: S(0.28, -0.08, 0.5, -0.18, 0.32, 0.25), dur: 0.5, lowAdapt: 1,
  tbl: makeTable([
    [0.00, {}],
    [0.22, { pYaw: 0.35, cYaw: 0.25, lean: 0.24, hip: 0.22, hx: 0.38, hy: 1.12, hz: 0.12, ax: 0.15, ay: 0.9, az: 0.2, nx: 1, ny: 0, nz: 0.1, lw: 0.8, lx: -0.35, ly: 1.2, lz: 0.4 }],
    [0.40, { pYaw: 0.25, cYaw: 0.2, lean: 0.26, hip: 0.24, hx: 0.38, hy: 1.12, hz: 0.2, ax: 0.2, ay: 0.9, az: 0.3, nx: 1, ny: 0, nz: 0.2, lw: 0.5, lx: -0.35, ly: 1.2, lz: 0.4 }],
    [0.50, { pYaw: 0.1, cYaw: 0.1, lean: 0.28, hip: 0.24, hx: 0.34, hy: 1.12, hz: 0.42, ax: 0.35, ay: 0.85, az: 0.55, nx: 0.3, ny: 0.2, nz: 1, lw: 0, lx: -0.4, ly: 1.15, lz: 0.2 }],
    [0.66, { pYaw: 0.0, cYaw: 0.0, lean: 0.26, hip: 0.22, hx: 0.3, hy: 1.08, hz: 0.5, ax: 0.3, ay: 0.7, az: 0.7, nx: 0.4, ny: 0.2, nz: 1, lw: 0, lx: -0.4, ly: 1.15, lz: 0.2 }],
    [1.00, { pYaw: 0.0, cYaw: 0.0, lean: 0.2, hip: 0.18, hx: 0.12, hy: 1.0, hz: 0.45, ax: 0, ay: 0.6, az: 0.8, nx: 1, ny: 0, nz: 0, lw: 1 }],
  ]),
};
T.volley_bh = {
  nom: { lat: -0.5, fwd: 0.5, h: 1.1 }, stance: S(0.2, 0.30, -0.4, -0.3, -0.06, -0.5), dur: 0.5, lowAdapt: 1,
  tbl: makeTable([
    [0.00, {}],
    [0.22, { pYaw: -0.4, cYaw: -0.3, lean: 0.24, hip: 0.22, hx: 0.0, hy: 1.14, hz: 0.22, ax: -0.2, ay: 0.9, az: 0.2, nx: 1, ny: 0, nz: 0.1, lw: 1, lg: 0.27 }],
    [0.40, { pYaw: -0.35, cYaw: -0.25, lean: 0.26, hip: 0.24, hx: 0.0, hy: 1.14, hz: 0.25, ax: -0.3, ay: 0.9, az: 0.3, nx: 1, ny: 0, nz: 0.2, lw: 1, lg: 0.27 }],
    [0.50, { pYaw: -0.2, cYaw: -0.15, lean: 0.28, hip: 0.24, hx: 0.0, hy: 1.12, hz: 0.5, ax: -0.5, ay: 0.8, az: 0.55, nx: 0.3, ny: 0.2, nz: 1, lw: 0.5, lg: 0.27, lx: -0.6, ly: 1.2, lz: 0.0 }],
    [0.66, { pYaw: -0.1, cYaw: -0.1, lean: 0.26, hip: 0.22, hx: 0.05, hy: 1.1, hz: 0.55, ax: -0.4, ay: 0.7, az: 0.7, nx: 0.4, ny: 0.2, nz: 1, lw: 0, lx: -0.6, ly: 1.2, lz: -0.1 }],
    [1.00, { pYaw: 0.0, cYaw: 0.0, lean: 0.2, hip: 0.18, hx: 0.12, hy: 1.0, hz: 0.45, ax: 0, ay: 0.6, az: 0.8, nx: 1, ny: 0, nz: 0, lw: 1, lg: 0.25 }],
  ]),
};

// overhead smash
T.smash_fh = T.smash_bh = {
  nom: { lat: 0.25, fwd: 0.4, h: 2.55 }, stance: S(0.30, -0.18, 1.1, -0.18, 0.26, 0.7), dur: 0.7, lowAdapt: 0,
  tbl: makeTable([
    [0.00, {}],
    [0.18, { pYaw: 0.85, cYaw: 0.35, lean: -0.05, hip: 0.14, hx: 0.40, hy: 1.62, hz: -0.06, ax: 0.0, ay: 0.85, az: -0.5, nx: 1, ny: 0, nz: 0, lw: 0, lx: -0.15, ly: 1.95, lz: 0.5, palm: 0, eD: 0.9 }],
    [0.34, { pYaw: 1.05, cYaw: 0.4, lean: -0.18, hip: 0.26, hx: 0.42, hy: 1.55, hz: -0.22, ax: 0.0, ay: -0.3, az: -1, nx: 1, ny: 0.2, nz: 0, lw: 0, lx: -0.12, ly: 2.05, lz: 0.55, eD: 0.9, heel: 0 }],
    [0.45, { pYaw: 0.7, cYaw: 0.3, lean: -0.02, hip: 0.1, hx: 0.34, hy: 1.95, hz: -0.04, ax: 0.0, ay: 0.4, az: -0.9, nx: 1, ny: 0.2, nz: 0, lx: -0.12, ly: 2.0, lz: 0.55, eD: 0.85, heel: 0.6, jmp: 0.08 }],
    [0.52, { pYaw: 0.2, cYaw: 0.1, lean: 0.2, hip: -0.03, hx: 0.24, hy: 2.12, hz: 0.28, ax: 0.1, ay: 0.95, az: 0.3, nx: 0, ny: -0.3, nz: 1, lx: -0.2, ly: 1.6, lz: 0.4, eD: 0.8, heel: 0.9, eff: 1, jmp: 0.17 }],
    [0.68, { pYaw: -0.3, cYaw: -0.2, lean: 0.4, hip: 0.1, hx: 0.0, hy: 1.5, hz: 0.52, ax: -0.5, ay: -0.5, az: 0.7, nx: 0, ny: 0.5, nz: 0.8, lx: -0.3, ly: 1.2, lz: 0.2, eD: 0.5, heel: 0.2, jmp: 0.08 }],
    [0.85, { pYaw: -0.45, cYaw: -0.3, lean: 0.3, hip: 0.22, hx: -0.1, hy: 1.1, hz: 0.45, ax: -0.5, ay: -0.5, az: 0.6, nx: 0, ny: 0.6, nz: 0.5, lx: -0.3, ly: 1.1, lz: 0.2, heel: 0 }],
    [1.00, { pYaw: -0.2, cYaw: -0.1, lean: 0.2, hip: 0.15, hx: 0.1, hy: 1.0, hz: 0.45, ax: 0, ay: 0.5, az: 0.85, nx: 1, ny: 0, nz: 0, lw: 1 }],
  ]),
};

// serve (phase 0.3 = toss release, 0.65 = contact)
T.serve = {
  nom: { lat: 0.30, fwd: 0.62, h: 2.65 }, stance: S(0.30, -0.18, 1.35, -0.30, 0.30, 1.15), dur: 1.3, lowAdapt: 0,
  tbl: makeTable([
    [0.00, { pYaw: 0.85, cYaw: 0.3, lean: 0.08, hip: 0.1, hx: 0.20, hy: 1.02, hz: 0.38, ax: 0.1, ay: 0.3, az: 0.95, nx: 1, ny: 0, nz: 0, lw: 0, lx: -0.1, ly: 1.02, lz: 0.42, palm: 1, eD: 0.3 }],
    [0.10, { pYaw: 0.9, cYaw: 0.3, lean: 0.1, hip: 0.14, hx: 0.30, hy: 0.80, hz: 0.20, ax: 0.1, ay: -0.2, az: 0.95, nx: 1, ny: 0, nz: 0, lw: 0, lx: -0.1, ly: 0.9, lz: 0.4, palm: 1, eD: 0.3 }],
    [0.22, { pYaw: 1.0, cYaw: 0.35, lean: 0.02, hip: 0.2, hx: 0.42, hy: 0.90, hz: -0.12, ax: 0.2, ay: 0.4, az: -0.9, nx: 1, ny: 0, nz: 0, lw: 0, lx: -0.12, ly: 1.6, lz: 0.5, palm: 1, eD: 0.45 }],
    [0.30, { pYaw: 1.05, cYaw: 0.38, lean: -0.05, hip: 0.26, hx: 0.46, hy: 1.35, hz: -0.18, ax: 0.1, ay: 0.9, az: -0.4, nx: 1, ny: 0, nz: 0, lw: 0, lx: -0.12, ly: 2.05, lz: 0.55, palm: 1, eD: 0.7 }],
    [0.38, { pYaw: 1.1, cYaw: 0.4, lean: -0.16, hip: 0.32, hx: 0.48, hy: 1.62, hz: -0.2, ax: 0.0, ay: 0.7, az: -0.7, nx: 1, ny: 0, nz: 0, lw: 0, lx: -0.1, ly: 2.12, lz: 0.55, palm: 0.2, eD: 0.9 }],
    [0.47, { pYaw: 1.0, cYaw: 0.4, lean: -0.2, hip: 0.3, hx: 0.42, hy: 1.55, hz: -0.32, ax: -0.1, ay: -0.6, az: -0.75, nx: 1, ny: 0.2, nz: 0, lw: 0, lx: -0.1, ly: 1.9, lz: 0.5, palm: 0, eD: 0.9 }],
    [0.57, { pYaw: 0.5, cYaw: 0.2, lean: 0.06, hip: 0.0, hx: 0.32, hy: 2.1, hz: 0.05, ax: 0.0, ay: 0.5, az: -0.85, nx: 1, ny: 0.1, nz: 0, lw: 0, lx: -0.15, ly: 1.7, lz: 0.45, palm: 0, eD: 0.85, heel: 0.8, jmp: 0.07 }],
    [0.65, { pYaw: 0.1, cYaw: 0.05, lean: 0.26, hip: -0.04, hx: 0.22, hy: 2.12, hz: 0.28, ax: 0.1, ay: 0.95, az: 0.3, nx: 0, ny: -0.3, nz: 1, lw: 0, lx: -0.2, ly: 1.5, lz: 0.4, palm: 0, eD: 0.8, heel: 1, eff: 1, jmp: 0.2 }],
    [0.80, { pYaw: -0.5, cYaw: -0.3, lean: 0.45, hip: 0.14, hx: -0.04, hy: 1.5, hz: 0.5, ax: -0.5, ay: -0.5, az: 0.65, nx: 0, ny: 0.5, nz: 0.8, lw: 0, lx: -0.3, ly: 1.2, lz: 0.2, eD: 0.5, heel: 0.2, jmp: 0.05 }],
    [1.00, { pYaw: -0.15, cYaw: -0.1, lean: 0.22, hip: 0.14, hx: 0.1, hy: 1.0, hz: 0.45, ax: 0, ay: 0.5, az: 0.85, nx: 1, ny: 0, nz: 0, lw: 1, lx: -0.2, ly: 1.1, lz: 0.2 }],
  ]),
};

export const STROKES = T;
export function strokeFor(shot, side) {
  if (shot === 'serve') return T.serve;
  let s = side === 'bh' ? 'bh' : 'fh';
  if (shot === 'smash') s = 'fh';
  return T[shot + '_' + s] || T['topspin_' + s];
}
