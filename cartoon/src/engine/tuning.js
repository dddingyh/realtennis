// Tunable constants of the arcade simulation (all times in SIM seconds unless noted, lengths in metres).

// ---- timing -> direction (ARCADE.md 2.2). t = swingTime - idealContactTime.
export const T_FULL = 0.150;        // |t| >= T_FULL => full lateral aim (|dir| = 1)
export const T_MISS = 0.260;        // |t| beyond => whiff; between T_FULL and T_MISS = dragged wide, weak mishit
export const T_PERFECT = 0.035;
export const T_FULL_EARLY = 0.140, T_FULL_LATE = 0.100, T_MISS_LATE = 0.180;   // sided windows (a late swing is judged tighter)     // |t| <= this is labelled 'perfect'
export const REMOTE = { T_MISS: 0.295, T_MISS_LATE: 0.215, T_PERFECT: 0.045 };   // a little more forgiving (latency jitter)
export const AIM_X = 3.45;          // lateral target (m) at |dir| = 1 (sidelines are at 4.115)
export const AIM_WIDE = 3.4;        // extra metres of drag at |dir| = 1.7 (T_MISS)

// ---- movement
export const VMAX = 4.4;            // top running speed (m/s)
export const ACC = 8.5;                 // acceleration (m/s^2)
export const DEC = 11;              // braking
export const RUSH_VMAX = 5.8;       // sprint toward the net
export const WALK_SPEED = 3.4;      // between points
export const HUMAN_REACTION = 0.17; // auto-movement reaction after the opponent's contact (s)
export const SETUP_TIME = 0.10;     // wanted time standing still before contact
export const NET_Z = 2.6;           // net position distance from the net
export const NET_ARRIVE = 5.5;      // zone becomes 'net' when closer to the net than this
export const BASE_Z = 12.65;        // |z| of the baseline home position
export const BACK_Z = 13.7;         // defensive home depth
export const NET_LATERAL = 0.65;     // lateral speed factor at the net (covers less width)

// ---- contact geometry
export const IDEAL_LAT = { fh: 0.85, bh: 0.72 };
export const IDEAL_FWD = 1.30;
export const IDEAL_LAT_V = 0.80;
export const REACH = { fh: 1.32, bh: 1.18 };
export const LUNGE = 0.30;
export const REACH_Y = 2.35;
export const SMASH_Y = 3.05;

// ---- phases (s)
export const TIMING = { prep: 1.25, pointOver: 1.7, changeover: 2.6, matchOver: 4, serveRetry: 0.8 };

// ---- stamina
export const STAMINA = { rush: 0.4, drain: 0.16, jog: 0.006, rest: 0.010, between: 0.35 };

// ---- serve
export const SERVE = {
  raise: 0.42,                      // swing 1 -> release of the ball (s)
  releaseY: 2.0, apexY: 3.05,       // release height / apex height of the toss
  catchAfter: 0.30,                 // no hit this long after the ideal contact => toss is wasted (re-toss, no fault)
  contactBack: 0.12,
  contactY: 2.775,                  // ideal contact height (after the apex on the way down; reachable with the jump)
  releaseFwd: 0.35,                 // toss hand / release point in front of the feet
  contactFwd: 0.45,                 // ball in front of the feet-at-contact (0.35..0.55)
  contactLat: 0.17,                 // toward the racket-arm side (0.10..0.25)
  jumpLead: 0.16, jumpY: 0.24,      // take-off this long before the ideal contact; jump height at contact
  stepIn: 0.42, stepTime: 0.40,     // forward step into the court during the jump
};

// ---- timing -> lateral target curve: x = AIM_X * (1 - (1 - |dir|)^AIM_CURVE); a moderate timing offset already
// opens the court (so a human with ~45 ms timing error can still place the ball), the last bit toward the line is costly.
export const AIM_CURVE = 1.7;
export function aimToX(aim) {
  const a = Math.abs(aim), s = aim < 0 ? -1 : 1;
  return a <= 1 ? s * AIM_X * (1 - Math.pow(1 - a, AIM_CURVE)) : s * (AIM_X + (a - 1) * AIM_WIDE / 0.7);
}
export function xToAim(x) {
  const a = Math.min(1, Math.abs(x) / AIM_X), s = x < 0 ? -1 : 1;
  return s * (1 - Math.pow(1 - a, 1 / AIM_CURVE));
}
export const RUSH_ACC = 12.5;          // acceleration while sprinting to the net
export const NET_PRESSURE = 1.6;     // extra scatter factor (x(1+this)) for passing shots against a fully set net player
export const PRESSURE_REACT = 0.42;  // s of extra (or fewer) reaction time for a ball with pressure 1 (0 = average ball at 0.35)
export const PRESSURE_Q = 0.5;         // quality loss for a reply to a maximum-pressure ball
export const PRESSURE_NET = 9.5;       // multiplier of both pressure effects when the hitter is following the ball to the net

// ---- how far behind the hip line a ball can still be struck (fwd < 0 = behind the body)
export const FWD_CLEAN = -0.7;     // cleanly struck down to here
export const FWD_WHIFF = -2.6;     // between CLEAN and WHIFF = weak frame shot (mishit 'frame'); beyond = whiff reason 'late'

// =================================================================== ENGINE v2 additions (docs/ENGINE2.md section 7)
// Every tunable lives in one flat object (see DEFAULTS); each sim owns a copy (sim.K) that setTuning() mutates live.
// -- flight physics (flight.js)
export const LIFT_GAIN = 1.8, KICK_GAIN = 1.6, SKID_GAIN = 1.4, SIDE_KICK = 0.5;
export const SIDE_SCALE = 1.0, SPIN_SCALE = 1.0, BALL_SPEED_SCALE = 1.0;
// -- contact point -> face yaw psi (deg; + = pulled across the body): psi = G_T*clamp(-t/T_FULL) + G_F*(fwd-FWD_IDEAL) + G_L*(lat-LAT_IDEAL)
export const G_T = 9, G_F = 2, G_L = 2.0, G_C = 0.9, PSI_MAX = 55;
export const PSI_REF_DIST = 20, PSI_DIST_EXP = 0.8;                  // timing gain grows for short targets (volleys)
export const PSI_CURVE = 0.8;             // psi_t = G_T * (a|x| + (1-a)x^2), x = -t/T_FULL (a = 1 -> linear, as in the spec)
export const PSI_T_CLAMP = 1.7;
// -- sidespin: sideRpm = S_type * (k0 + k1 * |psi| / 30deg) (rpm, signed by stroke/hand in arcade.js)
export const SIDE_RPM = { topspin: 1500, flat: 500, slice: 1500, lob: 800, volley: 600, smash: 350 };
export const SIDE_K0 = 0.6, SIDE_K1 = 0.55;
// -- errors / quality
export const SCATTER = 0.22;                // global scale of the landing scatter
export const DIR_CHANGE_K = 1.3;            // scatter multiplier = 1 + K * (angle/45deg)^0.8 * clamp(vIn/30, .4, 1.3)
export const SPIN_IN_K = 0.5;               // quality loss from heavy incoming topspin kick above the shoulder
// -- movement
export const JERK = 110;                    // m/s^3 (acceleration slew)
export const REACT = HUMAN_REACTION;        // alias (live: sim.K.HUMAN_REACTION is used)
export const SETTLE = 0.18;                 // wanted time standing still before contact (alias of SETUP_TIME)
export const AGGRESSION = 0.5;              // 0 = drop back / safe, 1 = step in and take it on the rise

// -- side choice / intercept
export const FH_PREF = 0.30, RUN_AROUND = 1.2, RUN_SPARE = -0.04;   // forehand tie-break (m), run-around window (m), required spare time (s)
export const Z_BACK = 13.7, Z_FRONT = 11.0, MARGIN_MIN = 0.12;       // preferred contact depth for aggression 0 / 1, min comfortable margin (s)
export const PACE_PEN_FH = 0.014, PACE_PEN_BH = 0.011;               // quality loss per m/s of incoming speed above 22 (bh steadier)
export const FH_POWER = 1.04, BH_POWER = 0.97, TX_MAX = 7.5;

export const VOLLEY_SCATTER = 1.7;                                    // volleys keep their risk when the global scatter is low
export const RECOVER_SPEED = 0.85;                                     // recovery run speed (share of VMAX)
export const BACKRUN = 0.62;                                         // speed factor when running straight away from the net (lobs!)
export const LOCK_TIME = 0.45;                                       // side is locked this long before contact

export const TAU_V = 0.09, BRAKE_K = 0.7;                           // velocity-tracking time constant (s), braking-profile deceleration fraction
export const REPLY_W = 3.9, BISECT_GAIN = 1.0;                      // half width of the reply fan for the recovery bisector

export const DEFAULTS = {};
for (const k of ['LIFT_GAIN', 'KICK_GAIN', 'SKID_GAIN', 'SIDE_KICK', 'SIDE_SCALE', 'SPIN_SCALE', 'BALL_SPEED_SCALE']) {
  const camel = k.toLowerCase().replace(/_([a-z])/g, (m, c) => c.toUpperCase());
  DEFAULTS[camel] = { LIFT_GAIN, KICK_GAIN, SKID_GAIN, SIDE_KICK, SIDE_SCALE, SPIN_SCALE, BALL_SPEED_SCALE }[k];
}
Object.assign(DEFAULTS, { timeScale: 0.8 });

/** Names accepted by setTuning in addition to the exported constants of this module (camelCase physics gains + timeScale). */
export function makeK(overrides = {}) {
  const K = {};
  for (const [k, v] of Object.entries(MODULE)) K[k] = (v && typeof v === 'object') ? { ...v } : v;
  Object.assign(K, DEFAULTS);
  K.SETUP_TIME = SETTLE;
  applyTuning(K, overrides);
  return K;
}
/** Merge `t` into K (nested objects are merged one level deep). Unknown keys are accepted (the lab may add its own). */
export function applyTuning(K, t) {
  for (const [k, v] of Object.entries(t || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && K[k] && typeof K[k] === 'object') Object.assign(K[k], v);
    else K[k] = v;
    if (k === 'T_MISS') K.REMOTE.T_MISS = v + 0.035;
    if (k === 'T_MISS_LATE') K.REMOTE.T_MISS_LATE = v + 0.035;
    if (k === 'T_PERFECT') K.REMOTE.T_PERFECT = v + 0.010;
    if (k === 'SETTLE') K.SETUP_TIME = v;
    if (k === 'REACT') K.HUMAN_REACTION = v;
    if (k === 'SETUP_TIME') K.SETTLE = v;
    if (k === 'HUMAN_REACTION') K.REACT = v;
  }
  return K;
}
import * as MODULE_NS from './tuning.js';
const { makeK: _a, applyTuning: _b, DEFAULTS: _c, ...MODULE } = MODULE_NS;
