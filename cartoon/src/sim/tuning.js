// Tunable constants of the arcade simulation (all times in SIM seconds unless noted, lengths in metres).

// ---- timing -> direction (ARCADE.md 2.2). t = swingTime - idealContactTime.
export const T_FULL = 0.140;        // |t| >= T_FULL => full lateral aim (|dir| = 1)
export const T_MISS = 0.240;        // |t| beyond => whiff; between T_FULL and T_MISS = dragged wide, weak mishit
export const T_PERFECT = 0.028;     // |t| <= this is labelled 'perfect'
export const REMOTE = { T_MISS: 0.275, T_PERFECT: 0.036 };   // a little more forgiving (latency jitter)
export const AIM_X = 3.45;          // lateral target (m) at |dir| = 1 (sidelines are at 4.115)
export const AIM_WIDE = 3.4;        // extra metres of drag at |dir| = 1.7 (T_MISS)

// ---- movement
export const VMAX = 5.5;            // top running speed (m/s)
export const ACC = 11.5;              // acceleration (m/s^2)
export const DEC = 15;              // braking
export const RUSH_VMAX = 5.9;       // sprint toward the net
export const WALK_SPEED = 3.4;      // between points
export const HUMAN_REACTION = 0.17; // auto-movement reaction after the opponent's contact (s)
export const SETUP_TIME = 0.10;     // wanted time standing still before contact
export const NET_Z = 2.6;           // net position distance from the net
export const NET_ARRIVE = 5.5;      // zone becomes 'net' when closer to the net than this
export const BASE_Z = 12.65;        // |z| of the baseline home position
export const BACK_Z = 13.7;         // defensive home depth
export const NET_LATERAL = 0.8;     // lateral speed factor at the net (covers less width)

// ---- contact geometry
export const IDEAL_LAT = { fh: 0.85, bh: 0.72 };
export const IDEAL_FWD = 0.50;
export const REACH = { fh: 1.50, bh: 1.35 };
export const LUNGE = 0.45;
export const REACH_Y = 2.35;
export const SMASH_Y = 3.05;

// ---- phases (s)
export const TIMING = { prep: 1.25, pointOver: 1.7, changeover: 2.6, matchOver: 4, serveRetry: 0.8 };

// ---- stamina
export const STAMINA = { drain: 0.09, jog: 0.006, rest: 0.010, between: 0.35 };

// ---- serve
export const SERVE = {
  raise: 0.42,                      // swing 1 -> release of the ball (s)
  releaseY: 2.0, apexY: 3.05,       // release height / apex height of the toss
  catchAfter: 0.42,                 // no hit this long after the apex => toss is wasted (re-toss, no fault)
  contactBack: 0.12,                // contact point is this far inside the baseline
};
