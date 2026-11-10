# Arcade Tennis（卡通版）— design contract

A second, **cartoon-style 3D** version of the game living in `cartoon/`. The existing pixel version (root `index.html`,
`src/`) stays untouched and playable. Focus: the **phone is the racket** — swing to hit, and **swing timing decides
left/right direction**, in the spirit of motion-controlled party tennis games, but **singles**, with a **one-button net
rush**, and tuned so points are a real contest. The venue is a realistically proportioned Grand-Slam-style show court,
rendered in a clean cartoon look.

**Hard constraints**
- Static site, plain ES modules, no build step, works on GitHub Pages and `python3 -m http.server`.
- 3D via vendored three.js r170: `vendor/three/three.module.min.js` (import map: `"three": "../vendor/three/three.module.min.js"`).
  No other runtime dependencies (PeerJS / qrcode already vendored). No downloaded models/textures/fonts/audio — everything
  procedural (geometry from primitives, CanvasTexture, WebAudio).
- Original designs only: no real player/tournament/brand names or logos, and do **not** copy any existing game's
  characters or UI (no Mii / Sportsmate look-alikes, no Nintendo assets). "Inspired by the genre", not a clone.
- UI text in Simplified Chinese.
- The simulation (`cartoon/src/sim`) is DOM-free and runs under Node for tests.
- Reuse (import by relative path, do not copy): `src/config.js` (court dimensions, coordinate system — read it),
  `src/physics/ball.js` (flight, bounce, net, `simulateTrajectory`), `src/game/match.js` (scoring), `src/game/rng.js`,
  `src/net/*` (host/client/transport/protocol), `src/controller/gesture.js` (swing recognizer), `src/audio/sfx.js`.
  Do not change the behaviour of those modules for the pixel game (additive, backwards-compatible edits only, by their owner below).

Coordinates (same as pixel game): x = right, y = up, z = toward the camera; net at z = 0; near baseline z = +11.885;
player 0 = near (human), player 1 = far. Metres / seconds.

## 1. Ownership
| Area | Files | Agent |
|---|---|---|
| Contract | `docs/ARCADE.md`, `vendor/three/*` | lead |
| Simulation | `cartoon/src/sim/*`, `cartoon/src/input/keyboard.js`, `tests/arcade_*.mjs` | **A-SIM** |
| Stage & app | `cartoon/index.html`, `cartoon/css/*`, `cartoon/src/main.js`, `cartoon/src/view/*` except `view/character/`, `cartoon/src/ui/*` | **A-STAGE** |
| Characters | `cartoon/src/view/character/*`, `cartoon/dev_character.html` | **A-CHAR** |
| Phone | `cartoon/controller.html`, `cartoon/css/controller.css`, `cartoon/src/controller/*`, `cartoon/src/input/remote.js`, additive edits in `src/net/protocol.js`, `tests/arcade_ctl*.mjs`, `docs/ARCADE_CONTROLLER.md` | **A-CTL** |

Do not edit files you do not own; code against the interfaces below and report gaps. Do not `git commit`.

## 2. Gameplay rules (what makes it a contest)
1. **Auto-movement.** The player's character runs to the ball automatically (finite speed/acceleration, realistic footwork
   states). The human controls **when and how to swing** and **where to stand: baseline or net**.
2. **Timing → direction.** Let `t = swingTime − idealContactTime` (ms, negative = early).
   Early = "pull" across the body, late = "push": for a forehand of a right-hander early sends the ball to the player's
   LEFT (cross-court from the deuce side), late to the RIGHT; mirrored for backhands and left-handers.
   `dir = clamp(t / T_FULL, −1, 1)` with `T_FULL ≈ 140 ms` (sim time) maps to the target's lateral position; |t| beyond
   `T_FULL` up to `T_MISS ≈ 240 ms` = dragged wide (likely out) with a weak mishit; beyond that = whiff.
   On-screen feedback every hit: 早 / 准 / 晚 with ms, and the resulting direction.
3. **Power** from swing speed (phone) / hold time (keyboard). Harder = faster but more scatter, especially near the lines
   and when the player is not set (running / stretched).
4. **Shot type** from swing shape: `topspin` (default drive), `flat` (hard level swing), `slice` (high-to-low; soft slice =
   drop shot), `lob` (steep upward swing). Near the net every stroke becomes a `volley`; a high ball near the net becomes a `smash`.
5. **One-button net rush.** `setNet(i, true)` sends the player to the net position (≈2.5 m from the net), `false` back to the
   baseline. At the net: volleys take time away and open sharp angles, but the player is exposed to lobs and passing shots
   and covers less width. Transition takes real time (≈1.2–1.6 s), so rushing at the wrong moment is punished.
6. **Pressure model.** Shot quality depends on being set at contact (distance still to run, speed, stretch), incoming pace,
   and position. Quality scales pace, accuracy, and available angle. Pulling the opponent wide ⇒ weaker reply ⇒ opening.
   Stamina: long sprints drain it within a point (slower first step), it recovers between points.
7. **Serve.** Swing 1 = toss, swing 2 = hit. Contact near the toss apex = fast serve; early/late reduces pace and adds
   error. Timing also picks wide/T like rule 2. Faults/double faults as in real rules; second serve is safer automatically.
8. **Pace of play.** Arcade-friendly: world runs at `timeScale` (default 0.8); typical rally ball 70–115 km/h, serves ≤ 165 km/h.
   Remote timing windows are in sim time after `timeScale` and include latency compensation via `ageMs`.
9. **AI opponent** plays by the same rules (it has timing error, reaction delay, limited speed): difficulty 0..1 and styles
   `baseliner` 底线相持 / `attacker` 压迫进攻 / `netrusher` 上网型 / `trickster` 变化型 (drops, lobs, angles). It must
   construct points: move the human side to side, attack short balls, approach the net, lob/pass a human at the net.
10. Full real scoring via `Match` (points, games, sets, tiebreak, deuce/ad courts, faults, lets).

## 3. Simulation API — `cartoon/src/sim/arcade.js` (A-SIM)
```js
import { ArcadeSim } from './sim/arcade.js';
const sim = new ArcadeSim({
  surface: 'hard'|'clay'|'grass', timeScale: 0.8, seed,
  format: { sets, gamesPerSet, tiebreak, shortGames },          // same shape as Match
  players: [ { human: true,  hand: 'R', name: '你',  look }, { human: false, hand: 'R', name: 'AI', look, ai: { level: 0.5, style: 'baseliner' } } ],
  timing: { /* optional overrides of pauses between points */ },
});
sim.step(realDt);                      // seconds of real time; advances realDt × timeScale
sim.swing(i, { shot, power, ageMs = 0, source: 'keyboard'|'remote'|'ai' });   // direction comes from timing
sim.setNet(i, bool); sim.toggleNet(i); // one-button net rush / retreat
sim.pause(bool); sim.drainEvents(); sim.state;
```
### 3.1 `sim.state`
```js
{ time, timeScale, surface,
  ball: { pos:{x,y,z}, vel, spin, visible, inPlay, bounces, lastHitBy, attach: null|{player, hand:'toss'|'racket'} },
  players: [ {
     pos:{x,z}, vel:{x,z}, y,            // y = jump height of the root (smash/serve), usually 0
     hand:'R'|'L', isHuman, name, look,  // look: { skin, hair, shirt, shorts, shoes, accent, hairStyle, build } (A-CHAR defines defaults)
     zone: 'base'|'net'|'toNet'|'toBase',
     stamina: 0..1, set: 0..1,           // set = how settled/balanced the player is right now
     anim: { name: 'ready'|'split'|'shuffle'|'run'|'backpedal'|'brake'|'swing'|'serve'|'toss'|'celebrate'|'dejected'|'walk',
             shot: 'topspin'|'flat'|'slice'|'lob'|'volley'|'smash'|null, side:'fh'|'bh'|null,
             phase: 0..1,                // swing: 0..0.45 backswing, 0.5 contact, →1 follow-through; serve: 0.3 toss release, 0.65 contact
             gait: 0..1, strideLen, dir:{x,z}, face:{x,z}, speed: 0..1, accel: -1..1,   // locomotion (gait advances with distance)
             contact: {lat,fwd,h}|null,  // planned/actual ball position in the player's local frame at contact
             reachT: 0..1, emote: null|'happy'|'frustrated'|'focused' },
     racketTip: {x,y,z}|null }, {…} ],
  match: { phase:'serve-prep'|'serving'|'rally'|'point-over'|'changeover'|'match-over', server, serveCourt, faultCount,
           points, games, sets, setsWon, isTiebreak, pointText, winner, stats:{…} },
  rally: { shots, lastHitTime },
  hint: { i, contactIn: seconds|null,   // real seconds until the human's ideal contact (already ÷ timeScale); null when not applicable
          side:'fh'|'bh', canServe: bool, tossUp: bool, text },
  lastShot: { by, shot, side, timing:'early'|'perfect'|'late'|'wide', timingMs, dir:-1..1, power, quality, speedKmh, spinRpm, target:{x,z}, mishit:null|string } | null }
```
### 3.2 Events
`hit {by, shot, side, timing, timingMs, dir, power, quality, speedKmh, pos, serve?:true, mishit}`, `toss {by}`,
`bounce {pos, in}`, `net {pos, cord}`, `call {text}` (`OUT|FAULT|DOUBLE FAULT|LET`), `point {winner, reason, shots}`,
`score {text}`, `whiff {by}`, `zone {by, zone}`, `phase {phase}`, `big {kind:'ace'|'winner'|'longrally'|'break'|'set'|'match'}`.

### 3.3 Keyboard (`cartoon/src/input/keyboard.js`, A-SIM)
`attachKeyboard(sim, i) -> detach`; `Space`/`J` = topspin swing, `K` flat, `L` slice, `I` lob (power = hold time, swing on
release; quick tap = medium), `W`/`↑`/`Shift` = toggle net, `Esc`/`P` pause. Exports `KEYBOARD_HELP` (Chinese).

## 4. View (A-STAGE, A-CHAR)
- `cartoon/src/main.js` boots three.js, menu (HTML/CSS overlay, cartoon style), loop (`sim.step(dt)` per frame with
  dt clamp; render at rAF), HUD overlay, audio (`Sfx`), keyboard, phone link (`createRemoteHost`, QR via `drawQR`,
  controller URL must point to `cartoon/controller.html` → pass `controllerBase`), and `RemoteAdapter` from
  `cartoon/src/input/remote.js`. `window.__arcade = { sim, renderer, … }` for tests; `?autostart=1&surface=&level=&style=&control=keyboard|phone&local=1`.
- Camera: behind the near baseline, elevated broadcast-style but closer/lower than the pixel game so the character reads
  large; gentle lateral follow and slight zoom/shake accents; serve camera; short slow-mo/replay-free accents on winners.
- **Venue**: realistically proportioned show court (ITF dimensions, net with band/posts, umpire chair, player benches
  beside it, ball kids at the net posts, shot clocks, back wall with made-up sponsor wordmarks and a live LED ribbon,
  two-tier stands with instanced cartoon crowd that reacts, roof ring / floodlights, sky). One coherent colour theme per
  surface (reuse `THEMES` from `src/render/stage.js`). Soft toon lighting, real-time or blob shadows; ball shadow is essential.
- **Characters** (`cartoon/src/view/character/index.js`, A-CHAR):
  ```js
  export function createCharacter(look, opts) -> { object3d, update(playerState, dtReal, ctx), setLook(look), dispose() }
  export const DEFAULT_LOOKS = [ … ];   // a handful of original designs
  ```
  Stylised cartoon athletes (slightly large head, expressive face, simple hands, chunky shoes), toon-shaded with outline,
  holding a racket; full procedural skeletal animation for every `anim.name` / `shot` / `side` / `phase`, IK so the racket
  meets `anim.contact` at phase 0.5, gait-driven locomotion without foot sliding, emotes. Unit: metres, origin at feet,
  facing −z for the near player (root rotation from `anim.face`). `ctx` = `{ ballPos }` for head tracking.
- **Ball**: bright cartoon ball with trail, squash on impact, ground shadow, landing ring; timing ring/hint around the
  ball for the human (toggle), big juicy feedback text (早/准/晚, 好球!, ACE, OUT…), impact particles, crowd reactions.
- HUD: score bug, serve speed, timing meter, stamina, net/baseline indicator, phone connection status, pause, match stats.

## 5. Phone controller (A-CTL)
- `cartoon/controller.html?room=CODE` — simplified flow: secure-context check → 开始 (sensor permission) → 左/右手 → play.
  No mandatory calibration. Uses `src/controller/gesture.js` for swing detection (peak time, power, and
  shape → `shot`), and `src/net/client.js`. Real forehand/backhand side is **not required** (the character picks the side);
  send it anyway as `side`.
- Play screen (portrait, one-thumb): huge **上网 / 回底线** toggle button, small shot-type override chips, pause; live
  feedback from host (`timing` 早/准/晚, haptic patterns), connection + latency. Wake lock, no scroll/zoom.
  `?sim=1` desktop simulator (buttons trigger synthetic swings through the real recognizer).
- Protocol additions (additive, keep v1 compatible): phone→host `{t:'btn', id:'net', value:true|false|'toggle'}`;
  host→phone `{t:'fb', timing, timingMs, shot, quality}` and `{t:'state', phase, pointText, youServe, zone, tossUp}`.
- `cartoon/src/input/remote.js`: `class RemoteAdapter { constructor(sim, i, host, {timingOffsetMs}); handle(msg); notify(events, state); setTimingOffset(ms); destroy() }`
  maps `swing` → `sim.swing(i,{shot,power,ageMs,source:'remote'})`, `btn net` → `sim.setNet/toggleNet`, `btn pause/resume`,
  and sends `fb`/`state`/`haptic` to the phone.

## SIM notes (A-SIM)
Files: `cartoon/src/sim/{arcade,ai,shot,tuning}.js`, `cartoon/src/input/keyboard.js`; tests `tests/arcade_{core,match,compete}.mjs` (+ `arcade_util.mjs`). All tunables live in `tuning.js` (timing windows, movement, stamina, serve) and `ai.js` (`AI_TUNE`, `STYLES`).
- **Timing.** `t = swingTime - idealContact` in sim time. Windows: perfect |t|<=28 ms (remote 36), wide 140..240 ms (remote 275, = dragged wide + weak), beyond = whiff. Early swings (>= -T_MISS) are buffered and connect at the ideal contact moment; late swings are evaluated against a short ball history (contact ball state clamped to ideal+45 ms), then the new ball is advanced by the remaining time. `ageMs` is converted with `* timeScale`.
- **Aim curve.** lateral target `x = 3.45*(1-(1-|dir|)^1.7)` (`tuning.aimToX`), `dir = t/140 ms` in the stroke's frame; late = toward the hand side for a forehand, mirrored for backhand / left-hander / far player. `sim.timingForAim(i, x)` returns the timing offset (ms) for a wanted target x (uses the current plan's stroke side); `sim.serveTimingForAim(i, x)` the same for serves. Serve: early/late shifts the target across the receiving box (T <-> wide), apex timing sets pace/accuracy.
- **Extra fields** (additive): `lastShot.aim` / hit event `aim` (-1..1, world x: -1 = screen left), `lastShot.setv`, `lastShot.pressure`, hit event `setv`, `first` (serve), `anim.prep` (0..1 racket-back preparation while the ball approaches), `sim.paused`, events `whiff {by, reason: 'early'|'late'|'noball'|'reach'|'serve'|'toss'}`, `call` texts `OUT|FAULT|DOUBLE FAULT|LET`, `point {winner, reason: 'out'|'net'|'winner'|'ace'|'error'|'service-winner'|'double-fault', shots, cls: 'winner'|'forced'|'unforced'}`, `score {text, games, points, pointText, gameWon, setWon}`. `match.stats` = per-player arrays `[p0,p1]`: points, winners, unforced, forced, aces, doubleFaults, firstServes, firstServesIn, netApproaches, netPoints, netPointsWon, serviceWinners, returnErrors; plus `rallies` (list of shot counts).
- **Serve flow.** phase `serve-prep` (1.25 s) -> `serving`: swing 1 = toss (`toss` event, `ball.attach = {player, hand:'toss'}`, ball follows the tossing hand: x = server.x - handSign*0.22, z = server.z - facing*0.62, y 0.95 -> 2.0 over 0.42 s, `anim.name='toss'`, phase 0..1 until the apex), release at y=2.0 with parabolic flight to apex y=3.05 (`attach = null`); swing 2 hits at the ball's real position (`anim.name='serve'`, phase 0.65 at the hit). No hit by apex+0.42 s = toss caught (no fault). Phase becomes `rally` at the serve hit. `hint.contactIn` during toss = time to apex. Ball in hand before the toss is also `attach`ed.
- **Net rush.** `setNet` works any time (also while serving); zone `toNet` -> `net` at |z|<=5.5 m; a net player forced behind |z|>9.4 for a contact returns to base automatically.
- **Hint.** `hint.i` = first human; `contactIn` is real seconds (`/timeScale`) until the planned contact of that player, null otherwise.
- **Test hooks** (not for the game): `sim.debugPlace(i,x,z,zone)`, `sim.debugFeed(hitter, {target, speedKmh, topRpm, el, ...})`.
- **Calibration** (bot sigma 45 ms, reaction 250 ms; see `tests/arcade_compete.mjs`): bot wins ~66% / 47% / 33% / 23% of points at AI level 0.2 / 0.5 / 0.8 / 1.0.
- **Known limits.** Late swings teleport the ball back to the contact point (<= ~1.1 m) at impact; no let-cord replay for rallies; doubles/ball-kid logic not modelled; `speedKmh` is launch speed (arrival speed is ~25-30% lower).
