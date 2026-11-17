# Engine v2 — shot physics, footwork, side choice, contact-point direction

Goal (user, 2026-11-17): set character art aside and make the **tennis engine** great first:
exaggerated but physically consistent **curving trajectories**, smooth **auto-movement**, sensible **forehand/backhand
choice**, and **direction determined by the contact point**, so that hitting feels fluid, rallies happen easily, and
there is real **strategy**. Animation quality is out of scope; the sim must still output the existing `anim` fields so
the current view keeps working.

Branch: `engine2`. The current game (`cartoon/src/sim/arcade.js`, ArcadeSim v1) stays untouched and default until v2 is
approved. The pixel game (`src/`) must not change behaviour.

## 0. Files & ownership
| Area | Files | Owner |
|---|---|---|
| Spec | `docs/ENGINE2.md` | lead |
| Engine v2 | `cartoon/src/engine/*` (entry `cartoon/src/engine/sim.js` exporting `ArcadeSim2`, also `export { ArcadeSim2 as ArcadeSim }`), `cartoon/src/engine/flight.js` (own copy/extension of the ball physics), `tests/engine_*.mjs` | **E-SIM** |
| Physics lab | `cartoon/lab.html`, `cartoon/css/lab.css`, `cartoon/src/lab/*` | **E-LAB** |

Reuse by import (read-only): `src/config.js`, `src/physics/ball.js` (only if you don't need to change it — E-SIM keeps
its own `flight.js`), `src/game/match.js`, `src/game/rng.js`, `src/net/*`, `cartoon/src/input/remote.js`
(`RemoteAdapter`), `cartoon/src/input/keyboard.js` (or a lab-specific copy), and ArcadeSim v1 as a **starting point**:
E-SIM may copy `cartoon/src/sim/*` into `cartoon/src/engine/` and refactor; v1 files are not edited.

## 1. Public API (superset of `docs/ARCADE.md` §3 — the view, HUD, phone adapter must keep working)
`new ArcadeSim2(opts)` with the same options as v1 plus `tuning: {…}` overrides (see §7). Same methods
(`step(realDt)`, `swing(i,{shot,power,ageMs,source})`, `setNet/toggleNet`, `pause`, `drainEvents`, `setLag`,
`timingForAim`, `debugPlace`, `debugFeed`) plus:
- `setTuning(partial)` / `getTuning()` — live changes from the lab sliders (physics gains, windows, speeds).
- `feed(o)` — ball machine for the lab: launch a ball from the far side with `{from:{x,z}, target:{x,z}, kmh, topRpm,
  sideRpm, shot}` into the human's half; the human (player 0) plays it as in a rally; the point ends without scoring.
- `predict(i)` — for debug drawing: `{path:[{x,y,z,t}], landing, contact:{x,y,z,t,side,kind}|null}` of the ball coming
  to player i (cached per plan, no per-frame allocation in steady state).
- `aimPreview(i, tOffsetMs)` — where a swing with this timing offset would aim (target x,z, curve sign) for the current
  plan, without side effects (for the lab's aim fan / teaching overlay).

State additions (all optional for consumers):
- `state.players[i].plan = { side, sideLocked, kind, tContact, contact:{x,y,z} } | null` and `state.hint.side`,
  `hint.sideLocked` (decided early, see §4) — HUD/phone show 正手/反手 as soon as it's decided.
- `lastShot` / `hit` event gain `topRpm`, `sideRpm`, `curveM` (max lateral deviation of the flight from the straight
  launch line, metres, signed), `contact:{fwd,lat,h}`, `face` (deg, face yaw at contact relative to straight ahead),
  `dirChange` (deg, see §3.4), `netClear`, `bounceApex` (predicted).

## 2. Flight & bounce physics (`flight.js`) — exaggerated, still physical
Start from `src/physics/ball.js` (RK2, drag, Magnus, impulse bounce, net cord) and add **tunable gains** (defaults in
§7; all must be 1.0 ⇒ identical to ball.js):
- `liftGain` multiplies the Magnus acceleration (and the CL clamp scales with it). Arcade default ≈ 1.8: topspin
  visibly dips, backspin floats, sidespin bends.
- **Sidespin** = spin component about the vertical axis (`spin.y`); it bends the flight laterally through Magnus
  (already in ω×v) — make sure the sign is right and test it: for a ball travelling toward −z, positive ω.y bends to −x.
- `kickGain` multiplies the topspin grip kick at the bounce (topspin jumps up and forward; backspin skids low and
  checks). `skidGain` scales how much backspin reduces horizontal speed and bounce height.
- `sideKick`: at the bounce, sidespin converts to a lateral velocity change `Δv_lat = sideKick · R · ω.y`
  (arcade, not strict physics) — slice skids sideways, kick serve jumps sideways.
- Keep: net collision and net cord, rolling, spin decay, `simulateTrajectory(state, opts)` with `path` sampling and
  `opts.tuning` gains so the solver and predictions use the same physics as the live ball.

**Calibration targets** (hard court, tuning defaults, shots from the baseline at 1 m height, `tests/engine_physics.mjs`):
| Shot (power 0.6) | Net clearance | Lands (from net) | Bounce apex | Notes |
|---|---|---|---|---|
| Topspin drive (~110 km/h, ~3000 rpm) | 0.9–1.5 m | 8.5–10.5 m | ≥ 1.35 m | clear dip; keeps forward speed after bounce |
| Flat (~135 km/h, ~600 rpm) | 0.25–0.55 m | 9–11 m | 0.8–1.1 m | fastest arrival |
| Slice (~85 km/h, −2500 rpm) | 0.3–0.6 m | 8–10.5 m | ≤ 0.55 m | floats then skids, loses ≥ 35 % horizontal speed |
| Lob (topspin lob) | apex ≥ 6 m | 9.5–11.5 m | — | clears a net player by ≥ 3 m |
| Inside-out FH with sidespin | — | within 0.3 m of target | — | **mid-flight lateral bend ≥ 0.8 m** (visible banana) |
| Kick serve | — | in box | ≥ 1.5 m | lateral kick ≥ 0.6 m/s at the bounce |
| Slice serve | — | in box | — | bends ≥ 0.6 m toward the wide side |
Plus: surfaces still ordered (clay slower/higher, grass faster/lower); determinism; no NaN.

## 3. Shot model (contact point → direction)
### 3.1 Contact
The ball is struck **where it really is** when the swing is processed (v1's no-teleport + phone-lag model stays:
`lagMs`, ring closes one lag early, early swings buffered, contact cap behind the body). In the hitter's local frame
(forward = toward the net, `lat` + = toward the stroke's hitting side):
`contact = {fwd, lat, h}` relative to the hitting shoulder/hip, ideal ≈ `{fwd: 0.6–0.9, lat: 0.75–0.9 (fh) / 0.65–0.8 (bh), h: 0.8–1.2}`.

### 3.2 Face angle → direction (the core mechanic)
The swing is an arc around the body; where the ball is met on that arc sets the racket-face yaw `ψ` (deg, + = pulled
across the body = toward the hitter's non-hitting side):
```
ψ = ψ_t + ψ_f + ψ_l
ψ_t = G_T · clamp(−t / T_FULL, −1.7, 1.7)        // timing: early (t<0) = met further in front = pulled
ψ_f = G_F · (contact.fwd − FWD_IDEAL)            // spatial: ball further in front than ideal also pulls, behind pushes
ψ_l = G_L · (LAT_IDEAL − contact.lat)            // jammed (too close) opens the face = pushed; stretched closes slightly
```
`t` = timing offset (ms, lag-compensated, as in v1). Typical gains: `G_T ≈ 26°`, `G_F ≈ 18°/m`, `G_L ≈ 12°/m`.
Convert to a court direction: the outgoing horizontal direction is the hitter's forward axis rotated by `ψ`
toward the non-hitting side (fh of a right-hander: + = to the left). The **target** is where that ray meets the
intended depth line, from the actual contact position — so geometry matters: from a wide position a pulled shot is a
sharp cross-court angle, a pushed shot runs down the line; inside-out / inside-in forehands happen naturally when the
player stands in the backhand corner. Clamp only extreme angles (|ψ| ≤ 55°); balls aimed outside the lines are errors
that emerge from physics.

### 3.3 Spin, pace, depth
- Shot type from the swing (phone shape / keys): `topspin`, `flat`, `slice`, `lob`; near the net `volley`, overhead `smash`;
  soft slice = drop shot (as v1).
- **Topspin rpm** by type × swing speed (power) × stroke side (forehand +10 %), ×0.8 when stretched.
- **Sidespin** (signed, about the vertical axis) — makes the curves:
  `sideRpm = S_type · (k0 + k1·|ψ|/30°)` with a sign by stroke & hand: forehand topspin **hooks toward the
  non-hitting side** (RH forehand curves left), backhand topspin hooks toward the hitting side, slice carves the
  opposite way and skids sideways after the bounce, inside-out forehands bend back into the court (visible banana).
- **Pace & depth** from power, contact height and quality; high power + low margin shots (flat near lines) are the risk.
- **Solver**: 2-D shooting on `simulateTrajectory` with the same tuning (elevation for depth + azimuth for lateral, a few
  secant iterations) so the ball *lands on the target despite the curve* — the launch line starts outside/inside the
  target and the ball bends in. ≤ ~3 ms per shot.

### 3.4 Errors & quality (graceful, strategic)
Quality `q` (0..1) from: being set (speed at contact, distance still to run), reach (stretch), contact height vs.
stroke (high balls hurt topspin/flat, help slice/lob; low balls hurt flat), incoming pace and **incoming spin** (heavy
topspin kick above the shoulder is hard), timing, stamina, pressure. Scatter (depth, lateral, net-clearance sigmas)
∝ (1 − q) × power × edge-risk × **direction-change risk**:
`dirChange` = angle between the incoming ball's reversed path and the outgoing direction; changing direction against a
fast/heavy ball (e.g. going down the line off a hard cross-court ball) multiplies scatter (×1 → ×1.8 at 45° and 30 m/s).
This is the classic tennis rule that creates strategy: rally cross-court, change direction on the right ball.
Mistimed balls (|t| beyond T_FULL) are still struck but weak and wild; whiffs only when truly unreachable or > T_MISS.
Target: a human-like bot (σ_timing 45 ms) whiffs < 3 % and most of its errors come from power/edges/direction changes.

## 4. Forehand / backhand choice
- Decide at the plan made right after the opponent's contact (+ reaction): side = whichever needs the shorter, more
  comfortable move to put the predicted contact at the ideal `lat` on that side; tie-break toward the forehand.
- **Run-around forehand**: if the ball is within ~1.2 m on the backhand side and the time margin allows (≥ 0.25 s spare),
  prefer the forehand (inside-out / inside-in). Per-player `fhBias` (AI style / archetype) changes how eagerly.
- Forehand slightly stronger (power +8 %, rpm +10 %), backhand slightly steadier vs. pace (lower pace penalty).
- **Hysteresis**: once `sideLocked` (≈ 0.45 s before contact or when the plan is stable), never flip; before that only
  flip if the current side becomes infeasible. Expose `hint.side` / `hint.sideLocked` early (the timing→direction
  mapping mirrors between sides, so the player must know which one is coming).

## 5. Auto-movement (smooth and purposeful)
- One plan per incoming ball (after reaction), re-plan at the bounce only if the error > 0.3 m — no per-frame retargeting.
- **Intercept choice**: sample the predicted path (after the bounce for groundstrokes; out of the air at the net) and
  score candidates by comfort height (0.8–1.2 m), body position (prefer staying near/inside the baseline — taking the
  ball earlier = more aggressive; dropping back = safer but cedes ground), and time margin. Heavy topspin ⇒ choose
  between stepping in (on the rise, tighter timing window) or backing up (higher margin) by a per-player aggression.
- **Motion**: smooth acceleration profile (jerk-limited S-curve), max speed limited (stamina-scaled), braking steps,
  arrive and settle ≈ 0.15–0.25 s before contact, final small adjustment steps; footwork states for the animator
  (`shuffle/crossover/run/backpedal/brake/split`) as v1.
- **Recovery position** after your own shot: the bisector of the opponent's possible reply angles given where your ball
  lands (classic positioning) — hitting a wide angle forces a longer recovery; at the net the volley position.
- Wide balls must be genuinely hard to reach: pulling an opponent wide is the main way to open the court.
- Human: full auto in phone mode; keyboard may optionally nudge (WASD) the auto target.

## 6. AI (same rules as the human)
Port v1's AI (styles, levels, net rush, lag-free timing with level-dependent σ) to the new mechanics: it picks a target
(and shot type/power) by tactics, converts to a timing offset with the inverse of §3.2 (`timingForAim`), and suffers the
same quality/direction-change rules. Tactics to show: cross-court rallies, change direction on short/weak balls,
pull wide then hit to the open court, approach behind a deep/wide shot, lob/pass a net player, drop shot vs a deep
opponent, run-around forehands (style-dependent).

## 7. Tuning (`cartoon/src/engine/tuning.js`, all live-adjustable via `setTuning`)
Physics: `liftGain 1.8, kickGain 1.6, skidGain 1.4, sideKick 0.5, sideScale 1.0, spinScale 1.0, ballSpeedScale 1.0`.
Timing: `T_PERFECT 0.035, T_FULL 0.150, T_MISS 0.260` (sim s; remote a bit wider). Face: `G_T, G_F, G_L, PSI_MAX`.
Movement: `VMAX, ACC, DEC, JERK, REACT, SETTLE`. Errors: scatter coefficients, `DIR_CHANGE_K`. `timeScale 0.8`.

## 8. Tests & calibration (E-SIM, `tests/engine_*.mjs`, < ~90 s total)
- `engine_physics.mjs`: §2 table; gains=1 reproduces ball.js; sidespin sign; solver lands on target with curve.
- `engine_shot.mjs`: ψ monotonic in t, fwd, lat; mirrored for bh / left-handers / far player; geometry (pulled shot
  from a wide position is a sharper angle); dirChange penalty; graceful mistimes; quality factors.
- `engine_move.mjs`: no retarget jitter, settled before contact ≥ 85 % of reachable balls, recovery to bisector,
  wide balls (≥ 3.5 m away with < 1.0 s) unreachable/stretched, side choice + run-around + hysteresis (no flip after lock).
- `engine_compete.mjs`: human-like bot vs AI levels (target bot points ≈ 65 / 50 / 35 / 22 % at 0.2 / 0.5 / 0.8 / 1.0),
  rally length mean 6–10 at 0.5, whiffs < 3 %; **strategy checks**: (a) "cross-court then change direction on short
  balls" bot beats "change direction on every ball" bot by ≥ 6 points; (b) "pull wide then open court" beats "hit to
  the middle"; (c) selective net rush ≥ 58 % net points, blind net rush punished; (d) AI vs AI all style pairs complete.

## E-SIM notes (engine v2 as built)
Files: `cartoon/src/engine/{sim,arcade,flight,shot,tuning,ai}.js` (entry `sim.js` exports `ArcadeSim2` and `ArcadeSim`, plus `AIBrain, STYLES, STYLE_NAMES, AI_TUNE`).
Tests: `node tests/engine_physics.mjs` (§2 table), `engine_shot.mjs` (psi model, spin per stroke/hand, direction-change risk, mistimes, lab API), `engine_move.mjs` (plans, settle, side choice, recovery), `engine_core.mjs` (the v1 contract suite run against v2, 71 checks), `engine_compete.mjs` (calibration + strategy + AI vs AI, ~65 s; `ARCADE_FAST=1` for smaller samples). Everything else is ~6 s. `tests/engine_util.mjs` = helpers.

### API as implemented (superset of §1; nothing removed from ARCADE.md)
- `new ArcadeSim2({..., tuning:{...}})`; `setTuning(partial)` merges flat keys (nested `REMOTE`, `STAMINA`, `SERVE`, `IDEAL_LAT`, `REACH` merged one level) and applies the physics gains live (`sim.ft` is the object handed to flight); `getTuning()` returns a deep copy of every key. `timeScale` is accepted. Remote windows follow `T_MISS/T_PERFECT` (+0.035 / +0.010).
- `timingForAim(i, aimX, depthZ?)` -> ms (negative = early); it solves the inverse of the psi model for the *planned contact point* (late contact depth included), default depth line = 2.2 m inside the baseline. `serveTimingForAim` unchanged.
- `aimPreview(i, tOffsetMs, {depthZ?, shot?, power?})` -> `{x, z, psi, psiT, psiF, psiL, psiC, side, curveSign (+1 = bends toward +x), sideRpm, inCourt, contact:{x,y,z}}` or null when there is no ball; pure.
- `predict(i)` -> `{path:[{t,x,y,z,vx,vy,vz,b}], landing, contact:{x,y,z,t,side,kind}|null, t0}` (`t` relative to `t0` = sim time of the plan); rebuilt only when the plan is (re)made; frozen empty object when there is none.
- `feed({from:{x,z,y?}, target:{x,z}, kmh, topRpm, sideRpm, shot:'topspin'|'flat'|'slice'|'lob', el?, clear?})` -> `{landing, netClear, curveM, speedKmh, ok}`. From then on the sim is in lab mode: the far player gets no plan, a finished ball emits `point {winner:null, lab:true, reason, by}` and never scores; `feed` can be repeated at once. Works from any phase. `sim.lab` = true.
- `state.players[i].plan` = `{side, sideLocked, kind, tContact (absolute sim s), contact:{x,y,z}}` (same object for the life of the plan, updated in place); `state.hint.side/sideLocked`.
- `lastShot` / `hit` gain `topRpm, sideRpm (signed omega.y), curveM (signed, + = +x), contact:{fwd,lat,h}, face (psi deg), dirChange (deg), dirK (scatter multiplier), netClear, bounceApex, psi:{psiT,psiF,psiL,psiC,psi}`, `target` and (lastShot) `pos`. Serve hits carry `serveType: 'flat'|'slice'|'kick'` (request with `swing(i,{shot:'flat'|'slice'|'topspin'|'kick'})`; defaults flat / kick).
- Player options: `fhBias` (default 1; run-around eagerness), `aggr` (0 drop back .. 1 step in; default `tuning.AGGRESSION` 0.5); the AI sets both from its style/level.

### Deviations from the spec text
- psi sign of the lateral term: implemented as `G_L * (lat - LAT_IDEAL)` (jammed = pushed, stretched = pulled), which is what the spec's comment says; the formula as written had the opposite sign.
- Gains: `G_T = 9`, `G_F = 2 deg/m`, `G_L = 2 deg/m` (spec "typical" 26 / 18 / 12 puts a 150 ms mistiming ~10 m wide from a baseline contact; the target line is ~22 m away). The timing term is `G_T * (a|x| + (1-a)x^2)`, x = -t/T_FULL clamped to 1.7, `PSI_CURVE a = 0.8` (a = 1 = linear): forgiving near perfect timing, steeper at the edge. The gain grows for short targets: `G_T * (20 m / distance-to-depth-line)^0.8` (clamped .75..2) so volleys get the same lateral reach per ms.
- Added `psi_c = G_C * atan(|C.x| / dz)` toward the court (`G_C = 0.6`, sign by stroke side): from a wide contact the neutral swing heads back into the court (cross-court), from the backhand corner a neutral forehand is inside-out/in. Geometry still decides: the ray starts at the real contact point.
- Timing windows `T_PERFECT .035, T_FULL .150, T_MISS .260`. A ball struck > ~150 ms late is behind the body (whiff reason 'late', as v1's FWD_WHIFF); early balls are buffered, so early mistimes (to 260 ms) are still struck, weak and wide.
- Side choice: run-around window 1.2 m x `fhBias` on the backhand side, allowed when the forehand stand is reachable with `RUN_SPARE` (-0.04 s; the margin already contains the 0.18 s settle time, so the spec's "0.25 s spare" would never trigger at VMAX 4.4); `FH_PREF` 0.3 m tie-break; the side locks `LOCK_TIME` 0.45 s before contact or as soon as a re-plan confirms it.
- Sidespin: topspin-like strokes bend toward world `-handX`, slice/volley toward `+handX` (this equals the spec's fh/bh rule); `sideRpm = SIDE_RPM[type] * (0.6 + 0.55 |psi|/30) * (0.6 + 0.4 power)`; topspin 1500, slice 1500, flat 500.
- Flight gains: `kickGain` acts as `1 + 1.7 (kickGain-1)` on the grip kick and adds a small forward kick and a "pop" for shallow topspin/flat balls; `skidGain` acts on backspin balls only (horizontal speed, bounce height). Gains 1 / sideKick 0 reproduce ball.js exactly (tested).
- Tuning defaults: liftGain 1.8, kickGain 1.6, skidGain 1.4, sideKick .5, sideScale 1, spinScale 1, ballSpeedScale 1, SCATTER 0.4 (global scatter scale; volleys keep `VOLLEY_SCATTER` 1.3 on top), DIR_CHANGE_K 1.3, VMAX 4.4, ACC 8.5, DEC 11, JERK 110, TAU_V .09, REACT .17 (alias of HUMAN_REACTION), SETTLE .18 (alias of SETUP_TIME), BACKRUN .7 (speed factor running straight away from the net), RECOVER_SPEED .85, PRESSURE_REACT .42 / PRESSURE_Q .5, NET_PRESSURE 1.6, lob depth 1.0-2.2 m inside the baseline with 1500 rpm.
- Strategy (c): the selective net bot wins 57-73% (sample dependent, n~50-90 per run; test threshold 55%, spec 58%) of the points it rushes behind a short ball that finds the AI out of position; blind net rushing wins ~45% of its points, ~5 points below the baseline bot (lobs + `BACKRUN`). The "net presence" statistic of the sim also counts points where the bot was merely pulled to the net.

### Known limitations
- Scatter is calibrated for a 45 ms human-like bot: a perfect (0 ms) player is very accurate, a random-timing player loses ~20 points of share.
- `predict` uses the exact live physics but not the net-cord randomness; a re-plan at the bounce can move the stand target by up to ~0.15 m (never > 0.3 m, tested).
- Sidespin of a *received* ball only changes quality through the incoming-topspin term; there is no separate sidespin handling penalty.
- ARCADE.md "remote" timing constants changed (windows listed above); v1 tests that hard-code 28/36/240/275 ms need the numbers in `tests/engine_core.mjs`.

### E-SIM notes, addendum (feel pass)
- Timing windows are sided: `T_FULL_EARLY .140`, `T_FULL_LATE .100`, `T_MISS .260`, `T_MISS_LATE .180` (remote +0.035). `IDEAL_FWD` is now 1.30 m (`FWD_CLEAN -0.7`, `FWD_WHIFF -2.6`) so +T_FULL_LATE is a clean hit. Direction uses psi_t (timing) + psi_f/psi_l from the body-vs-PLANNED-contact error (footwork), not from the extra depth of a late ball; `timingForAim` / `aimPreview` / the AI use the same maps. `G_C` is 0.9.
- Bounce height: a soft cap on the post-bounce vertical speed (`KNEE_VY 5.8`, `CAP_VY 7.6`, lower for very steep balls such as lobs) in flight.js. `bounceApex` in `hit` / `lastShot` is now the real simulated apex of the ball centre after the first bounce (drag included), not vy^2/2g. Topspin drives ~1.5-1.8 m, flat ~0.9, slice ~0.4, lobs <= 2.4 m, kick serve ~1.7 m.
