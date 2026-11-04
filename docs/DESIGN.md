# Real Tennis — Design Spec (contract between modules)

Pixel-art browser tennis game. Camera fixed behind the near baseline (broadcast-style, elevated).
Realistic ball physics (drag, Magnus, spin-dependent bounce). Opponent AI with tactical styles.
Phone can be connected as a motion controller (gyro/accelerometer) over WebRTC.

**Hard constraints**
- Static site, no build step, plain ES modules (`<script type="module">`). Must run from GitHub Pages
  (HTTPS) and from `python3 -m http.server` locally.
- No runtime network dependencies except the PeerJS public signalling server (`0.peerjs.com`).
  Third-party libs are vendored in `vendor/` (`peerjs.min.js` 1.5.4 → global `Peer`;
  `qrcode.js` 1.4.4 → global `qrcode`). Load them with classic `<script>` tags.
- All art and sound are generated procedurally in code (no downloaded images/audio). No real brands,
  tournament names, logos, or real player likenesses.
- UI text in Simplified Chinese (in-canvas score digits/short calls like `OUT`, `FAULT`, `15-30` may be Latin).
- Simulation code (`src/physics`, `src/game`) must be DOM-free so it runs under Node for tests.
- Keyboard play must always work (fallback + dev testing).

Shared constants & coordinate system: **`src/config.js`** (read it first). Summary:
x = right (from camera), y = up, z = toward camera; net at z=0; near baseline z=+11.885;
player 0 = near (human), player 1 = far (AI). The human always stays on the near side
(we do not visually swap ends at changeovers; serve alternates deuce/ad court as in real rules).

---

## 1. File ownership

| Area | Files | Owner |
|---|---|---|
| Shared | `src/config.js`, `docs/DESIGN.md` | lead |
| Simulation | `src/physics/*`, `src/game/*`, `src/input/keyboard.js`, `tests/sim*.mjs` | agent SIM |
| Presentation | `index.html`, `css/*`, `src/main.js`, `src/render/*`, `src/audio/*`, `src/ui/*` | agent VIS |
| Phone controller | `controller.html`, `src/controller/*`, `src/net/*`, `src/input/remote.js`, `tests/gesture*.mjs` | agent CTL |

Do not edit files you do not own. If you need something from another module, code against the
interface below; if the interface is insufficient, note it in your final report.

---

## 2. Simulation API (`src/game/simulation.js`, owner SIM)

```js
import { Simulation } from './game/simulation.js';
const sim = new Simulation({
  surface: 'hard',                 // key of SURFACES
  aiStyle: 'grinder',              // 'grinder' | 'aggressive' | 'serveVolley' | 'counter'
  aiLevel: 0.6,                    // 0..1 difficulty
  format: { sets: 1, gamesPerSet: 6, tiebreak: true, shortGames: false },
  playerNames: ['你', 'AI'],
  autoMove: ['assist', 'off'],     // per player: 'off' | 'assist' | 'full'  (AI ignores)
  humanHand: 'R',                  // 'R' | 'L'
  seed: 12345,                     // deterministic RNG for tests
});

sim.step(dt);            // advance by dt seconds (caller passes 1/PHYSICS.simHz); internally substeps physics
sim.setMove(i, x, z);    // continuous move intent for player i, each in [-1,1]; x=right, z=toward camera(+)/net(-)
                         // for player 0, z=-1 means "toward the net". Values are screen-relative for the near player.
sim.prepare(i, { shot }) // keyboard only: start backswing (shot in SHOT_TYPES). optional.
sim.swing(i, {
  shot: 'flat'|'topspin'|'slice'|'lob',
  side: 'fh'|'bh'|'auto',  // 'auto' = sim picks the correct side
  power: 0..1,             // swing speed (phone: from angular velocity; keyboard: hold duration)
  aimX: -1..1 | null,      // optional explicit lateral aim; null = derive from timing (early→cross, late→line)
  aimDepth: -1..1 | null,  // optional (-1 short/drop, +1 deep)
  ageMs: 0,                // how long ago the swing physically happened (latency compensation, ≤150ms)
  source: 'keyboard'|'remote'
});
sim.serveToss(i, {shot}?) // optional explicit toss (shot picks the toss: flat/topspin=kick/slice); if not called, swing()
                          // during serve-prep does toss+hit automatically. A request during a ball bounce waits until the
                          // ball is back in the hand. sim.serverReady(i): routine finished, ball held.
sim.pause(bool)
sim.drainEvents()  -> Event[]   // events since last drain
sim.state                       // read-only snapshot, see below
```

### 2.1 `sim.state`
```js
{
  time,                         // sim seconds
  surface: 'hard',
  ball: {
    pos:{x,y,z}, vel:{x,y,z}, spin:{x,y,z},  // spin = angular velocity vector (rad/s)
    visible: bool,              // false between points
    inPlay: bool,
    bounces: 0|1|2,             // bounces since last hit
    lastHitBy: 0|1|-1,
    marks: [{x,z,age}],         // recent bounce marks (clay shows them longer)
    attach: null | { i, held, mode:'routine'|'toss'|'hit', k, O },
                                // ball tied to server i's serve choreography (src/game/serve_choreo.js):
                                // held = in the tossing hand; k = 1 while held/bounced/tossed, fades to 0 over
                                // 0.12 s after contact. The renderer draws an attached ball with the server's
                                // sprite transform (held: at the hand of the exact quantised pose) so hand and
                                // ball always coincide on screen.
  },
  players: [ {
    pos:{x,z}, vel:{x,z},       // feet on ground, y=0
    facing: +1|-1,              // +1 = facing -z (near player looking at net), -1 = facing +z
    hand: 'R'|'L',
    isHuman: bool,
    name, look: { skin, hair, shirt, shorts, shoes, headband|null },  // CSS hex colors
    anim: {
      name: 'ready'|'idle'|'run'|'split'|'swing'|'serve'|'bounce'|'celebrate'|'dejected'|'walk',
      shot: 'flat'|'topspin'|'slice'|'lob'|'volley'|'smash'|null,
      side: 'fh'|'bh'|null,
      phase: 0..1,              // swing/serve progress; 0.5 = ball contact; serve: 0.0 setup, 0.12 arms drop,
                                // 0.30 toss release, 0.50 trophy (ball apex), 0.57 racket drop, 0.65 contact,
                                // 0.76 landing inside the baseline, 0.88 finish, 1 recovered.
                                // 'bounce' = pre-serve ball bounce, phase 0..1 per bounce (0 = ball held at rest,
                                // identical to serve phase 0). For 'serve', shot = toss type 'flat'|'topspin'|'slice'.
                                // Timeline + toss-hand path: src/game/serve_choreo.js (also used by render/pose.js).
                                // sprites.js has no 'bounce' key yet: renderer.js draws it as {name:'serve', shot:'bounce'}.
      dir: {x,z},               // run direction unit vector (for run anim)
      speed: 0..1               // normalized run speed
    },
    racketHead: {x,y,z},        // optional world pos of racket head (for VIS to draw racket if wanted)
    stamina: 0..1,
  }, {...} ],
  match: {
    phase: 'menu'|'serve-prep'|'serving'|'rally'|'point-over'|'changeover'|'match-over',
    server: 0|1, serveCourt: 'deuce'|'ad', faultCount: 0|1,
    points: [p0,p1], games: [g0,g1], sets: [[g0,g1],...], setsWon:[s0,s1],
    isTiebreak: bool,
    pointText: '15-30' | 'DEUCE' | 'AD IN' | 'AD OUT' | '3-2' (tiebreak),
    winner: null|0|1,
    stats: { aces:[,], doubleFaults:[,], winners:[,], unforcedErrors:[,], firstServePct:[,], maxServeKmh:[,] }
  },
  lastShot: { by, shot, side, speedKmh, spinRpm, quality: 0..1, timingMs } | null,
  hint: { i:0, reachable: bool, side:'fh'|'bh', contactIn: seconds|null } // for HUD timing helper
}
```

### 2.2 Events (`drainEvents()`)
```
{type:'hit', by, shot, side, power, quality, mishit, speedKmh, spinRpm, pos}   // mishit: null|'frame'|'floater'|'net'|'long'; serve: also serve:true
{type:'serve', by, speedKmh, pos}
{type:'bounce', pos, in: bool, court: 'deuce'|'ad'|'singles'|null}
{type:'net', pos, cord: bool}          // cord = clipped tape and went over
{type:'call', text: 'OUT'|'FAULT'|'LET'|'DOUBLE FAULT'|'NOT UP'|'ACE'}
{type:'point', winner, reason: 'winner'|'ace'|'double-fault'|'out'|'net'|'double-bounce'|'unforced'|'forced'}
{type:'score', text}                   // e.g. '30-15', 'GAME', 'SET', 'MATCH'
{type:'whiff', by}                     // swung and missed
{type:'phase', phase}
```

### 2.3 Physics requirements (`src/physics/ball.js`)
- State integrated at `PHYSICS.fixedDt` (semi-implicit Euler or RK2).
- Forces: gravity; quadratic drag `0.5 ρ Cd A |v| v`; Magnus lift `0.5 ρ CL A |v|² (ω̂×v̂)` with
  `CL = 1 / (2 + v/(r|ω|))` (spin-parameter model); slow spin decay.
- Bounce: impulse model with vertical COR `e` from surface and Coulomb friction `μ` at contact point,
  ball either slides through or reaches rolling (grip) during impact — use contact-point velocity
  `v + ω × (−r ŷ)`, moment of inertia `k m r²`. Must reproduce: topspin kicks up and accelerates
  forward after bounce, slice skids low and slows, flat in between; clay higher/slower, grass lower/faster.
- Net: height profile linear from `netHeightCenter` at x=0 to `netHeightPost` at `netPostX`.
  Ball whose bottom crosses z=0 below the tape → hits net (falls on hitter's side). Ball clipping the tape
  (within ~radius) → cord: random loss of speed + upward deflection, may dribble over.
- Provide pure helper `simulateTrajectory(state, opts) -> {landing:{x,z,t}, netClear, path?}` for the shot
  solver and AI prediction (no side effects).

### 2.4 Shot model (`src/game/shot.js`) — "position matters"
Given hitter state, incoming ball state at contact, swing params → outgoing velocity + spin.
1. **Choose target** (x,z on opponent side) from: aim (explicit or timing: early contact → cross-court,
   late → down-the-line/inside-out), shot type, depth intent, AI decision.
2. **Contact quality q∈[0,1]** combines: timing error (ms from ideal contact), contact height
   (ideal 0.7–1.2 m; very low balls/very high balls penalized), lateral distance from body (ideal reach
   band; too close = jammed, too far = stretched), player speed at contact (running shot penalty),
   incoming ball pace & spin (heavy balls harder), correct side (wrong side = big penalty / mishit), stamina.
3. **Court position effects** (the core gameplay idea):
   - Inside baseline / mid-court: more available angle, can hit flatter & harder ("take it early"),
     but timing window narrower.
   - Deep behind baseline: less angle available, less pace, more arc/margin needed.
   - At net (z within ~4 m of net): volley — short swing, pace mostly from incoming ball, sharp angles,
     drop volleys possible; high balls near net → smash.
   - Stretched wide: only defensive replies (slice/lob), reduced pace, more error.
   - Ball above shoulder at baseline: topspin/flat weaker, slice/lob favored.
4. **Solve launch** by shooting method using `simulateTrajectory` (bisect elevation for target depth
   given speed & spin per shot type) so outgoing shots are physically consistent.
5. **Error**: Gaussian scatter on target and launch angle scaled by `(1 − q) × risk`; errors (net/out)
   must emerge naturally from the physics, not be scripted.
6. Shot type parameters (typical pro-ish ranges): flat 110–170 km/h, ~500–1500 rpm topspin;
   topspin 90–140 km/h, 2000–3500 rpm; slice 70–110 km/h, 1500–3000 rpm backspin (some sidespin);
   lob 50–90 km/h, high arc (topspin lob or defensive). Serve: flat up to ~200 km/h (scaled by power/quality),
   kick/slice serves via shot type (topspin→kick, slice→slice serve, flat→flat).

### 2.5 Players & AI
- Kinematics: max speed ~6.0 m/s, accel ~9 m/s², split-step when opponent hits, reach ~1.4 m forehand side,
  ~1.3 m backhand side, slower when preparing a swing. Stamina drains with sprinting, recovers between points.
- `autoMove` 'assist' (default for phone): sim moves the player toward the predicted ideal contact point;
  manual move input is blended on top. 'full': fully automatic positioning. 'off': manual only.
- **AI** (`src/game/ai.js`): predicts incoming trajectory (with noise ∝ 1−level), reaction delay
  (~350 ms at level 0 → ~120 ms at level 1), chooses recovery position (bisector of opponent's angle range),
  and chooses shots by **style**:
  - `grinder` 底线型: high margin, heavy topspin cross-court, waits for errors, rarely approaches.
  - `aggressive` 进攻型: takes ball early (stands closer), flat, targets lines and open court, approaches on short balls.
  - `serveVolley` 发球上网: big serve then net rush, slice approaches, volleys to open court.
  - `counter` 防守反击: deep court position, retrieves everything, lobs net-rushers, passing shots when opponent approaches.
  AI also adapts: exploits human's weaker side (tracks error rate per side), varies serve placement.
- Scoring per real rules (15/30/40/deuce/advantage, tiebreak to 7 by 2, server rotation, deuce/ad courts,
  faults, lets on serve cord landing in box, double bounce, out). Changeovers just pause briefly.

### 2.6 Keyboard (`src/input/keyboard.js`, owner SIM)
`attachKeyboard(sim, playerIndex)`: WASD/arrows = move. Shot keys: `J` topspin, `K` flat, `L` slice, `I` lob.
Keydown = prepare (backswing), keyup = swing (power = hold time, capped ~0.6 s). Direction keys held at
contact override aim (left/right → aimX, up/down → aimDepth). Space = serve (toss on down, hit on up);
shot key also serves. `Esc`/`P` = pause.

---

## 3. Presentation (owner VIS)

- `index.html` + `src/main.js`: boots, shows menu (Chinese), runs loop: fixed `sim.step(1/120)` with accumulator,
  render at rAF. Low-res canvas `RENDER.width × RENDER.height` (640×360) upscaled with nearest-neighbor
  (`image-rendering: pixelated`, integer scale when possible, letterbox).
- Menu: 对手风格 (4 styles with Chinese description), 难度, 场地 (硬地/红土/草地), 赛制 (抢七/一盘/三盘短局),
  控制方式 (键盘 / 手机体感). Phone option shows QR code + room code + connection status, using `src/net/host.js`.
- **Camera** (`src/render/camera.js`): pinhole perspective from roughly (0, 7–9, 23–26) looking at
  (0, 0, ~-2), tuned so the full court incl. far player & run-off is visible, near player around the bottom.
  May follow the ball/near player laterally a little (smoothed) — but static background is preferred for crispness;
  if the camera moves, re-render the background layer only when it moves by ≥1 px.
- **Art direction**: refined 16-bit-era pixel art ("精致像素风"). Realistic court: surface colors per surface type
  (hard: blue inner court + green outer; clay: orange-red with line texture & sliding marks; grass: striped mowing pattern & worn baseline),
  white lines with correct dimensions, net with mesh, white tape, posts and singles sticks, umpire chair,
  line judges/ball kids (simple), stadium stands with procedurally varied pixel crowd (subtle idle animation, cheer on points),
  generic sponsor boards (made-up names), back wall, scoreboard, shadows (ball shadow on ground is essential for depth reading).
  No anti-aliased edges: draw with integer pixels (custom rasterizer or `fillRect` per pixel/span); use limited palette + dithering.
- **Sprites** (`src/render/sprites.js`): procedurally generated pixel players (back view for near player, front view
  for far player), animations for every `anim.name`/`shot`/`side`/`phase`; handedness mirroring; per-player colors from `look`.
  Near player ~56–72 px tall, far player ~24–34 px (generate at needed size or with per-size caches, no blurry scaling).
  Racket visible. Ball: small pixel ball + shadow + optional motion trail; ball size scales with depth (1–4 px).
- **HUD**: TV-style score bug, serve speed, last shot type/spin/quality, timing hint (optional ring around ball when
  in reach window), calls (`OUT`, `FAULT`, `ACE`…) with pixel bitmap font, connection indicator, pause menu, match stats at end.
- **Audio** (`src/audio/sfx.js`): WebAudio-synthesized: racket hit (varies with power/shot), bounce (surface-dependent),
  net, crowd murmur/applause (noise-based), umpire calls via `speechSynthesis` (English: "Fifteen love", "Out", "Fault") optional/toggle.
  Unlock audio on first user gesture.
- Integrate inputs: keyboard (`attachKeyboard`), phone (`RemoteInput` from `src/input/remote.js`).
  Handle `sim.drainEvents()` for sounds/effects; forward haptics/state to phone via `remote.notify(...)`.

---

## 4. Phone controller (owner CTL)

### 4.1 Pages
- `controller.html?room=XXXXXX` (mobile-first, Chinese UI). Flow: 1) 安全上下文检查 (if not HTTPS → explain);
  2) "开始" button → `DeviceMotionEvent.requestPermission()` (iOS) + `DeviceOrientationEvent.requestPermission()`;
  3) handedness choice (右手/左手); 4) grip instructions + neutral calibration ("握持中立姿势 2 秒");
  5) optional swing calibration (3 swings × each type → per-user centroids saved in localStorage);
  6) play screen: big status, last detected swing (type/side/power), touch fallback buttons
  (平击/上旋/切削/挑高 hold-to-override type), serve button, pause. Screen Wake Lock (`navigator.wakeLock`).
  Haptics with `navigator.vibrate` where supported (not on iOS — degrade silently).
- Desktop testing: `controller.html?room=XXX&sim=1` shows a sensor simulator (mouse drag/keys generate synthetic
  motion samples through the SAME recognizer pipeline).

### 4.2 Gesture recognition (`src/controller/gesture.js`, DOM-free, testable in Node)
Input samples: `{t, acc:{x,y,z} (no gravity, m/s²), accG:{x,y,z} (incl. gravity), rot:{alpha,beta,gamma} (deg/s)}`
in device frame (W3C: alpha about z/screen-normal, beta about x, gamma about y).
- Estimate gravity direction (low-pass of accG) → world "up" in device frame.
- **Tilt → movement**: neutral orientation captured at calibration; pitch delta → move z, roll delta → move x;
  dead-zone, clamp to [-1,1], low-pass; send at ~30 Hz; freeze/zero while a swing is in progress.
- **Swing detection**: |ω| exceeds start threshold (~250 °/s, hysteresis) → collect window; contact = time of peak |ω|;
  refractory ~400 ms; reject tiny/slow motions.
- **Side (fh/bh)**: sign of ω projected on world up (yaw rate) at peak, combined with handedness.
- **Type**: features over window: vertical path ratio (∫ linear acc · up, normalized), racket-face (screen normal) tilt vs up at
  peak, yaw-rate magnitude, roll rate about long axis. Heuristic default thresholds: up-swing + closed face → topspin;
  strong up + slow + open face → lob; down-swing + open face → slice; else flat. If user calibration exists → nearest centroid
  (normalized features). Output `conf` 0..1.
- **Power**: peak |ω| mapped (e.g., 300 °/s → 0.2, 1200 °/s → 1.0), clamp.
- Ship a test with synthetic traces for each type/side (`tests/gesture.test.mjs`, run with `node`).
- Android Chrome reports rotationRate in deg/s (old versions rad/s — detect by magnitude heuristics).

### 4.3 Networking (`src/net/*`)
- `src/net/transport.js`: abstraction over PeerJS DataChannel; also `BroadcastChannel` transport for same-browser
  testing (`?local=1`). Auto-reconnect.
- `src/net/host.js`: `createRemoteHost({ onMessage, onStatus, local })` → `{ roomCode, controllerUrl, send(msg), close() }`.
  Peer id = `PEER_ID_PREFIX + roomCode` (6 uppercase alnum, no ambiguous chars). `controllerUrl` built from
  `location` (same directory) `controller.html?room=CODE`. Also export `drawQR(canvas, text, scale)` using vendored `qrcode`.
- Clock sync: ping/pong to estimate RTT/2 and offset so host computes `ageMs` for swing events.
- Data channel: JSON; for tilt use unreliable/unordered if available, swings reliable.

### 4.4 Protocol (v1) — JSON objects with field `t`
Phone → host:
```
{t:'hello', v:1, hand:'R'|'L', ua, calibrated:bool}
{t:'tilt', x, z, ts}                 // x,z in [-1,1]; z=-1 = tilt forward = move toward net
{t:'swing', shot, side, power, conf, ts, feat?,    // ts = phone performance.now() at peak |ω| (sub-sample interpolated)
         aimX, lift, spin, exec, speedDps}         // analog fields, see §6.2 (optional: old controllers omit them)
{t:'btn', id:'serve'|'pause'|'resume'|'shotOverride', value?}
{t:'ping', id, ts}   {t:'pong', id, ts, hostTs}
```
Host → phone:
```
{t:'welcome', v:1, player:0}
{t:'state', phase, pointText, server, youServe:bool}
{t:'haptic', pattern:[ms,...]}     // e.g. on hit quality, on point won/lost
{t:'ping', id, ts}   {t:'pong', id, ts, phoneTs}
```
Analog swing field conventions (CTL, see docs/CONTROLLER.md §3b):
- `aimX` = horizontal direction of the hitting face at contact (perpendicular to the racket's horizontal long axis, on the
  hitting side), relative to the head direction at the ready pose found just before the backswing; ±30° → ±1.
  Absolute left/right for the player (−1 left). Early contact ⇒ face turned across the body ⇒ cross-court:
  R-forehand/L-backhand → aimX<0, R-backhand/L-forehand → aimX>0. With swing calibration the user's habitual per-side
  bias is subtracted.
- `spin` = tanh((pathElev − faceElev)/32° − faceRollRate/450°/s); with calibration rescaled so the user's own
  topspin/slice centroids map to ±0.75 and flat to 0. `lift` = pathElev/38° clamped (calibrated: flat→0, lob→0.85).
- `exec` = 1 − weighted penalties: face wobble around contact, |ω| roughness/dips during acceleration, follow-through
  (mean |ω| 0–70 ms after peak ÷ 70 ms before), acceleration time (70–320 ms ok), face-vs-path misalignment.
- A touch-forced type (`shotOverride`) keeps `aimX`/`exec` but RemoteInput passes `spin`/`lift` as null.

### 4.5 `src/input/remote.js`
`class RemoteInput { constructor(sim, playerIndex, host); handle(msg); notify(events, state); }` —
maps `tilt`→`sim.setMove`, `swing`→`sim.swing({shot, side, power, aimX, aimDepth:null, spin, lift, exec, ageMs, source:'remote'})`
(missing analog fields → null), `btn serve`→ serve swing,
emits `haptic`/`state` to phone from sim events. Applies user timing offset setting.

---

## 6. v3 contracts (movement realism + analog phone swings)

### 6.1 Movement animation state (SIM writes, CHAR renders)
`players[i].anim` gains these fields (existing fields keep their meaning):
```
name:  'ready' | 'split' | 'run' | 'shuffle' | 'crossover' | 'backpedal' | 'brake' | 'walk' | 'swing' | 'serve' | 'bounce' | ...
gait:  0..1   // locomotion cycle phase, advanced by DISTANCE travelled: gait += dist / strideLen (one cycle = two steps).
              // Feet must not slide: pose plants the stance foot while gait advances.
strideLen: m  // ground distance per full cycle at the current speed (SIM chooses; e.g. run ≈ 1.6–2.6 m, shuffle ≈ 0.9 m)
dir:   {x,z}  // travel direction (unit, world)
face:  {x,z}  // body facing (unit, world) — shuffle/backpedal keep facing the net while moving sideways/backwards
speed: 0..1   // normalized ground speed
accel: -1..1  // signed acceleration along dir (lean forward when accelerating, lean back / wide base when braking)
```
Semantics: `shuffle` = side steps facing the net (short adjustments ≤ ~2.5 m, recovery); `crossover` = first step(s) of a long
lateral move; `run` = sprint; `backpedal` = moving back while facing the net; `brake` = deceleration / plant before a shot
(wide base, low centre of mass); `split` = split-step hop timed with the opponent's contact.

SIM implementation notes (`src/game/player.js`):
- Drive a(v) = 20·(1 − v/6) + 1.5 m/s² (×1.15 for 0.5 s after a split step): ~0.65 s from rest to 90 % of 6 m/s; braking ≤ 13 m/s²;
  move orders stop with planned 7 m/s² braking steps (`brake` while decelerating hard or settling). During the follow-through
  of a swing the feet plant (no instant recovery reversal).
- Move orders (`player.moveTo(x,z,timeLeft)`, used by the AI and by `autoMove` 'assist'/'full') have start/stop hysteresis
  (start only if > 0.30 m away, set within 0.08 m), so a player is either clearly moving or clearly set.
- Footwork is chosen when a move starts: lateral ≤ 2.5 m → `shuffle` (cap 3.6 m/s); longer lateral → `crossover` (0.32 s) then
  `run`; backwards ≤ 3.5 m → `backpedal` (cap 3.8 m/s); forward/long → `run` (6 m/s). Under time pressure (needed speed > 1.7 m/s)
  short moves are run instead of shuffled.
- `strideLen` (m per gait cycle): run 1.5 + 0.18·v, crossover 1.5, shuffle 0.9 + 0.04·v, backpedal 1.0, brake 1.0, walk 1.35.
  `split` also sets `anim.phase` 0..1 over the 0.2 s hop. `face` = net direction except `run` (= dir) and `crossover` (half turned).
- Auto-move: the interception stand is planned once per incoming ball (re-planned at the bounce), only after the split step;
  after the player's own shot it recovers (shuffle) toward a recovery spot near the centre behind the baseline.

### 6.2 Analog swing (CTL produces, SIM consumes)
Phone → host `swing` message adds (all optional; old fields unchanged):
```
aimX:   -1..1   // horizontal direction of the racket face / hand path at contact, relative to the forward heading
                // captured just before the swing (ready pose). -1 = to the player's left, +1 = right.
lift:   0..1    // swing-path elevation (0 = level/through, 1 = steep low-to-high)  → height/arc, lob tendency
spin:   -1..1   // continuous spin intent: -1 heavy backspin (slice), 0 flat, +1 heavy topspin (from path + face + wrist roll)
exec:   0..1    // execution quality from the motion itself: face stability at contact, smooth acceleration (no jerk),
                // follow-through completeness, peak not truncated. 1 = clean stroke.
speedDps: deg/s // peak angular speed (power is still sent, normalized)
```
`RemoteInput` forwards them to `sim.swing(i, { shot, side, power, aimX, aimDepth: null, spin, lift, exec, ageMs, source:'remote' })`.
SIM must make these produce clearly different, physically consistent shots: power → pace; spin → rpm & arc; lift → net
clearance/depth (high lift + low pace ⇒ lob); aimX blended with timing for direction; exec × timing × body position ⇒ contact
quality ⇒ error scatter (mishits: frame shots, short floaters, shanks on very poor quality). Keyboard (no analog fields) keeps working.

SIM implementation notes (`src/game/shot.js` `computeHit`):
- Defaults when analog fields are absent (keyboard/AI): flat {spin .12, lift .35}, topspin {.72, .5}, slice {−.72, .3},
  lob {.35, .95}; `exec` = 1. With analog fields the stroke label is derived from `spin` (> .35 topspin, < −.3 slice, else flat).
- power → pace: groundstroke km/h = (50 + (vmax − 50)·power^0.85)·(0.72 + 0.28·q^0.7) + incoming-pace bonus, vmax = 165 flat,
  135 at spin +1, 105 at spin −1. A hard ball that cannot clear the net at the intended depth is hit deeper first, then slowed.
- spin → rpm: +1 ≈ 3500 rpm topspin at full power, −1 ≈ −3000 rpm backspin; topspin raises net clearance and kicks, slice skids.
- lift → target depth (4.6 m inside the baseline at 0 … 0.9 m at 1) and therefore net clearance; lift > 0.72 with power < 0.5 = lob.
- aimX (remote) is relative to the player's own left/right, blended 0.8·aimX + 0.25·timing-aim; inside the court a wide aim
  becomes a shorter, sharper angle.
- quality q = (exec' × timing × height × reach × running × incoming pace/spin × side × stamina)^0.85 (exec' = 0.15 + 0.85·exec).
  Scatter ∝ (1 − q); below q ≈ 0.68 mishits occur with rising probability: `mishit` ∈ 'frame' (wild direction, low pace),
  'floater' (short, high, slow), 'net', 'long'. Reported in the `hit` event (`quality`, `mishit`) and in `state.lastShot`.


---

## 7. v4 contracts (contact-dependent strokes, player archetypes, game speed, competitiveness)

### 7.1 Contact geometry for stroke animation (SIM writes, CHAR renders)
During `anim.name === 'swing'` (and from the start of the backswing when the contact is planned), SIM writes:
```
anim.contact = { lat, fwd, h }   // ball position at (planned) contact in the player's local frame, metres:
                                 //   lat: sideways from the body centre, + = toward the stroke's hitting side (fh: racket-arm side, bh: other side)
                                 //   fwd: + = in front of the body (toward the net)
                                 //   h:   height above the court
anim.variant = 'normal' | 'stretch' | 'jammed' | 'run' | 'high' | 'low' | 'defensive'
anim.reachT  = 0..1              // 0 = comfortable, 1 = at the absolute limit of reach (lunge)
```
CHAR uses IK so the racket's sweet spot meets `contact` at phase 0.5, and adapts the whole body per variant
(stretch: open-stance lunge / slide, arm fully extended; jammed: elbow tucked, short swing, step away; run: hitting on the move;
high: shoulder-height take-back; low: deep knee bend; defensive: blocked/sliced reply).

### 7.2 Player archetypes (`look.archetype`, CHAR defines, VIS exposes in menu, SIM passes through)
`'elastic'` — lean, very flexible all-court defender: wide low stance, splits/slides, compact flat-ish forehand, signature two-handed backhand with full extension.
`'lanky'` — tall, long-limbed aggressive baseliner: upright posture, long levers, early take-back, flat penetrating strokes, open stance.
`'classic'` — current default build.
(Inspired by the playing styles of top professionals; **no real names, likenesses-by-name, logos or brand marks in the game**.)
`look.archetype` also scales SIM tunables slightly (e.g. reach +5 % for 'lanky', slide-recovery for 'elastic').

### 7.3 Game speed
`new Simulation({ timeScale })`, default **0.85**, menu option 0.7–1.0. `sim.step(realDt)` advances sim time by `realDt × timeScale`.
Displayed speeds stay real-world (km/h unchanged). Remote `ageMs` (real time) is converted to sim time inside SIM.
