// Tunable constants of the arcade simulation (all times in SIM seconds unless noted, lengths in metres).

// ---- timing -> direction (ARCADE.md 2.2). t = swingTime - idealContactTime.
export const T_FULL = 0.140;        // |t| >= T_FULL => full lateral aim (|dir| = 1)
export const T_MISS = 0.240;        // |t| beyond => whiff; between T_FULL and T_MISS = dragged wide, weak mishit
export const T_PERFECT = 0.028;     // |t| <= this is labelled 'perfect'
export const REMOTE = { T_MISS: 0.275, T_PERFECT: 0.036 };   // a little more forgiving (latency jitter)
export const AIM_X = 3.45;          // lateral target (m) at |dir| = 1 (sidelines are at 4.115)
export const AIM_WIDE = 3.4;        // extra metres of drag at |dir| = 1.7 (T_MISS)

// ---- movement
export const VMAX = 4.2;            // top running speed (m/s)
export const ACC = 8;                 // acceleration (m/s^2)
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
export const IDEAL_FWD = 0.90;
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
export const NET_PRESSURE = 2.2;     // extra scatter factor (x(1+this)) for passing shots against a fully set net player
export const PRESSURE_REACT = 0.2;  // s of extra (or fewer) reaction time for a ball with pressure 1 (0 = average ball at 0.35)
export const PRESSURE_Q = 0.2;         // quality loss for a reply to a maximum-pressure ball
export const PRESSURE_NET = 9.5;       // multiplier of both pressure effects when the hitter is following the ball to the net

// ---- how far behind the hip line a ball can still be struck (fwd < 0 = behind the body)
export const FWD_CLEAN = -0.5;     // cleanly struck down to here
export const FWD_WHIFF = -1.5;     // between CLEAN and WHIFF = weak frame shot (mishit 'frame'); beyond = whiff reason 'late'
