// Player kinematics, stamina, animation state. DOM-free.

import { COURT } from '../config.js';

// ---------------------------------------------------------------- tunables
export const PLAYER = {
  maxSpeed: 6.0,           // m/s sprint (only reached on long runs)
  accel0: 20.0,            // m/s^2 drive at standstill; falls linearly to ~0 at top speed (0->90% in ~0.65 s)
  accelMin: 1.5,           // m/s^2 residual drive near top speed
  brake: 13.0,             // m/s^2 maximum braking (planted feet)
  planBrake: 7.0,          // m/s^2 deceleration planned when stopping at a target (braking steps, no instant stop)
  modeCap: { run: 6.0, crossover: 5.2, shuffle: 3.6, backpedal: 3.8, walk: 2.6 },
  shuffleMax: 2.5,         // m: moves up to this long are side shuffles facing the net
  backpedalMax: 3.5,       // m: backward moves up to this long are backpedals (longer: turn and run)
  crossoverT: 0.32,        // s of crossover first step before a long lateral move becomes a run
  startTol: 0.30,          // m: a set player starts moving only if the target is farther than this (hysteresis)
  stopTol: 0.08,           // m: ...and is set again once within this and slow
  stride: { run: [1.5, 0.18], crossover: [1.5, 0.05], shuffle: [0.9, 0.04], backpedal: [1.0, 0.05], brake: [1.0, 0], walk: [1.35, 0.03], ready: [0.9, 0] },
  prepSpeedMul: 0.8,       // while holding a backswing
  swingSpeedMul: 0.5,      // during the swing
  swingDur: 0.30,          // s, follow-through length
  splitDur: 0.2,           // s
  splitBoostDur: 0.5,      // s of improved acceleration after a split step
  splitBoost: 1.15,
  staminaDrain: 0.035,     // per second at full sprint
  staminaRecover: 0.03,    // per second standing
  staminaFloorSpeed: 0.88, // speed multiplier at zero stamina = 0.88 .. 1.0
  walkSpeed: 2.6,
  boundsSide: COURT.doublesHalfWidth + 3.0,
  boundsBack: COURT.halfLength + 5.2,
};

/** Archetype tunables (DESIGN §7.2): 'lanky' longer reach, 'elastic' longer lunge/slide and stronger braking. */
export const ARCHETYPES = {
  classic: { reachMul: 1.0, lungeMul: 1.0, brakeMul: 1.0, speedMul: 1.0 },
  lanky: { reachMul: 1.05, lungeMul: 1.0, brakeMul: 0.95, speedMul: 0.99 },
  elastic: { reachMul: 1.0, lungeMul: 1.3, brakeMul: 1.12, speedMul: 1.0 },
};

const PALETTES = [
  { skin: '#e8b48a', hair: '#2b1a10', shirt: '#f2f2f2', shorts: '#1c2a52', shoes: '#f5f5f5', headband: null },
  { skin: '#c68a5e', hair: '#111111', shirt: '#e63946', shorts: '#222222', shoes: '#dddddd', headband: '#ffffff' },
  { skin: '#f1c9a3', hair: '#b8862b', shirt: '#2a9d8f', shorts: '#f4f4f4', shoes: '#333333', headband: null },
  { skin: '#8d5a3b', hair: '#0b0b0b', shirt: '#ffd166', shorts: '#264653', shoes: '#ffffff', headband: '#e63946' },
  { skin: '#e0a47c', hair: '#5a3a22', shirt: '#6a4c93', shorts: '#f1f1f1', shoes: '#eeeeee', headband: null },
];

/** Pick a deterministic look from the palette set. */
export function pickLook(rng, avoid = null) {
  let i = rng.int(PALETTES.length);
  if (avoid && PALETTES[i].shirt === avoid.shirt) i = (i + 1) % PALETTES.length;
  return { ...PALETTES[i] };
}

export class Player {
  /**
   * @param {0|1} index
   * @param {{name:string, hand:'R'|'L', isHuman:boolean, autoMove:string, look:object}} o
   */
  constructor(index, o) {
    this.index = index;
    this.facing = index === 0 ? 1 : -1;          // +1 faces -z (near player looking at the net)
    this.hand = o.hand || 'R';
    this.isHuman = !!o.isHuman;
    this.autoMove = o.autoMove || 'off';
    this.name = o.name;
    this.look = o.look;
    const A = ARCHETYPES[(o.look && o.look.archetype) || 'classic'] || ARCHETYPES.classic;
    this.reachMul = A.reachMul; this.lungeMul = A.lungeMul; this.brakeMul = A.brakeMul; this.archSpeed = A.speedMul;
    this.pos = { x: 0, z: this.facing * (COURT.halfLength + 1) };
    this.vel = { x: 0, z: 0 };
    this.intent = { x: 0, z: 0 };               // final move intent used by kinematics, [-1,1]
    this.manual = { x: 0, z: 0 };               // raw intent from input
    this.stamina = 1;
    this.speedMul = 1;                           // AI skill scaling
    // timers
    this.splitT = 0; this.boostT = 0;
    this.swingT = -1;                            // >=0 while follow-through plays
    this.swingShot = null; this.swingSide = null;
    this.prepared = null;                        // {shot, t}
    this.buffered = null;                        // buffered swing {params, until, earlyMs}
    this.cooldown = 0;
    this.celebrateT = 0; this.dejectedT = 0;
    this.walkTarget = null;                      // {x,z} automatic walk between points
    this.serve = null;                           // serve state, managed by Simulation
    this.routine = null;                         // pre-serve ball-bounce routine, managed by Simulation
    this.moveScale = 1;
    this.anim = { name: 'ready', shot: null, side: null, phase: 0, dir: { x: 0, z: -this.facing }, speed: 0,
      gait: 0, strideLen: 0.9, face: { x: 0, z: -this.facing }, accel: 0, contact: null, variant: 'normal', reachT: 0 };
    this.contactInfo = null;                     // {contact:{lat,fwd,h}, variant, reachT}: planned or actual contact (§7.1)
    // locomotion: a target (move order) or a velocity intent drives the feet
    this.target = null;                          // {x,z} move order (AI / auto-move), hysteresis handled here
    this.loco = { state: 'set', mode: 'shuffle', modeT: 0, accAlong: 0 };
    this.racketHead = { x: 0, y: 1, z: 0 };
    this.sprintDist = 0;
  }

  get handX() { return (this.hand === 'R' ? 1 : -1) * this.facing; }

  maxSpeed() {
    const st = PLAYER.staminaFloorSpeed + (1 - PLAYER.staminaFloorSpeed) * this.stamina;
    let m = PLAYER.maxSpeed * st * this.speedMul * (this.archSpeed || 1);
    if (this.prepared) m *= PLAYER.prepSpeedMul;
    if (this.swingT >= 0 && this.swingT < PLAYER.swingDur) m *= PLAYER.swingSpeedMul;
    if (this.splitT > 0) m *= 0.25;
    return m;
  }

  /** Begin a split-step (opponent just hit). */
  splitStep() {
    if (this.swingT >= 0 && this.swingT < PLAYER.swingDur) return;
    this.splitT = PLAYER.splitDur;
    this.boostT = PLAYER.splitDur + PLAYER.splitBoostDur;
  }

  /** Start a swing (called when the contact happens or a whiff). */
  startSwing(shot, side, contactInfo = null) {
    this.swingT = 0; this.swingShot = shot; this.swingSide = side;
    if (contactInfo) this.contactInfo = contactInfo;
    this.prepared = null;
    this.cooldown = 0.32;
    this.stamina = Math.max(0, this.stamina - 0.004);
    this.syncAnim();
  }

  /** Recompute `anim` immediately (used right after an input-driven state change). */
  syncAnim() { this._animate(Math.hypot(this.vel.x, this.vel.z), this._ctx || {}); }

  /** Give a move order: walk/run/shuffle to (x,z) and stop there (hysteresis: small changes are ignored when set). */
  moveTo(x, z, timeLeft = null) {
    if (!this.target) this.target = { x, z, timeLeft }; else { this.target.x = x; this.target.z = z; this.target.timeLeft = timeLeft; }
  }
  /** Stop driving (no target, no intent): the player brakes to a standstill. */
  hold() { this.target = null; this.intent.x = 0; this.intent.z = 0; }

  /** Choose the footwork for a move of vector (dx,dz) (world). */
  _chooseMode(dx, dz, timeLeft = null) {
    const d = Math.hypot(dx, dz) || 1;
    const fwd = dz * -this.facing;                // + toward the net
    const lat = Math.abs(dx);
    // urgency: when the needed average speed is high, short moves are run (crossover / drop step) not shuffled
    const urgent = timeLeft != null && d / Math.max(0.05, timeLeft) > 1.7 && d > 1.0;
    if (fwd < -0.45 * d) return d <= PLAYER.backpedalMax && !urgent ? 'backpedal' : 'run';
    if (lat >= 0.6 * d) return d <= PLAYER.shuffleMax && !urgent ? 'shuffle' : 'crossover';
    return d <= 1.4 && !urgent ? 'shuffle' : 'run';
  }

  /**
   * Advance kinematics and animation.
   * Locomotion model: speed-dependent drive (explosive first step, ~0.65 s to top speed), bounded braking, footwork
   * modes with their own speed caps, move orders with start/stop hysteresis and planned braking steps.
   * @param {number} dt
   * @param {{inPoint:boolean, ready?:boolean}} ctx
   */
  update(dt, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.splitT > 0) this.splitT -= dt;
    if (this.boostT > 0) this.boostT -= dt;
    if (this.swingT >= 0) { this.swingT += dt; if (this.swingT > PLAYER.swingDur) this.swingT = -1; }
    if (this.celebrateT > 0) this.celebrateT -= dt;
    if (this.dejectedT > 0) this.dejectedT -= dt;
    if (this.prepared) this.prepared.t += dt;
    const L = this.loco;
    L.modeT += dt;

    const vx0 = this.vel.x, vz0 = this.vel.z;
    const sp0 = Math.hypot(vx0, vz0);
    const stam = PLAYER.staminaFloorSpeed + (1 - PLAYER.staminaFloorSpeed) * this.stamina;
    let vmax = this.maxSpeed();
    // ---- desired velocity
    let tx = 0, tz = 0;
    const order = this.walkTarget || this.target;
    if (this.walkTarget && L.state === 'moving' && L.mode !== 'walk') L.mode = 'walk';
    if (order) {
      const dx = order.x - this.pos.x, dz = order.z - this.pos.z, d = Math.hypot(dx, dz);
      if ((L.state === 'set' || L.state === 'free') && this.walkTarget && d <= 0.12) this.walkTarget = null;
      else if (L.state === 'set' || L.state === 'free') {
        if (d > (this.walkTarget ? 0.12 : PLAYER.startTol)) {
          L.state = 'moving'; L.mode = this.walkTarget ? 'walk' : this._chooseMode(dx, dz, order.timeLeft); L.modeT = 0;
        }
      } else if (d < PLAYER.stopTol && sp0 < 0.9) {
        L.state = 'set';
        if (this.walkTarget) this.walkTarget = null;
      }
      if (L.state === 'moving') {
        if (L.mode === 'crossover' && L.modeT > PLAYER.crossoverT) L.mode = 'run';
        // footwork may change mid-move (e.g. a shuffle that turned into a long chase)
        if (L.mode === 'shuffle' && (d > PLAYER.shuffleMax + 0.8 || (order.timeLeft != null && d > 1.0 && d / Math.max(0.05, order.timeLeft) > 2.2))) { L.mode = this._chooseMode(dx, dz, order.timeLeft); if (L.mode === 'shuffle') L.mode = 'run'; L.modeT = 0; }
        let cap = Math.min(vmax, PLAYER.modeCap[L.mode] * this.speedMul * stam);
        if (this.walkTarget) cap = PLAYER.walkSpeed * (this.walkFast ? 1.6 : 1);
        const vstop = Math.sqrt(2 * PLAYER.planBrake * Math.max(0, d - 0.03));
        const v = Math.min(cap, vstop) * (this.walkTarget ? 1 : this.moveScale);
        tx = dx / (d || 1) * v; tz = dz / (d || 1) * v;
      }
    } else {
      // velocity intent (manual control)
      const ix = this.intent.x, iz = this.intent.z;
      const m = Math.hypot(ix, iz);
      const k = m > 1 ? 1 / m : 1;
      if (m > 0.05) {
        const mode = this._chooseMode(ix, iz * 1.0);
        const fwd = iz * -this.facing;
        let want = fwd < -0.45 * m ? 'backpedal' : Math.abs(ix) >= 0.6 * m && m * vmax < PLAYER.modeCap.shuffle + 0.4 ? 'shuffle' : 'run';
        if (want === 'run' && L.mode !== 'run' && L.mode !== 'crossover' && Math.abs(ix) >= 0.6 * m && sp0 < 1.5) want = 'crossover';
        if (L.state !== 'free' || (want !== L.mode && !(L.mode === 'crossover' && want === 'run'))) { L.mode = want; L.modeT = 0; }
        if (L.mode === 'crossover' && L.modeT > PLAYER.crossoverT) L.mode = 'run';
        L.state = 'free';
        void mode;
        const cap = Math.min(vmax, PLAYER.modeCap[L.mode] * this.speedMul * stam);
        tx = ix * k * cap * this.moveScale; tz = iz * k * cap * this.moveScale;
      } else if (sp0 < 0.3) L.state = 'set';
    }
    // soft bounds: never run into the side/back limits or the net at full speed (brake before reaching them)
    {
      const fz = this.facing, bx = PLAYER.boundsSide;
      const lim = (dist, v) => Math.min(v, Math.sqrt(2 * PLAYER.planBrake * Math.max(0, dist)));
      if (tx > 0) tx = lim(bx - this.pos.x, tx); else if (tx < 0) tx = -lim(this.pos.x + bx, -tx);
      const zs = this.pos.z * fz, vzs = tz * fz;                 // along the player's own half (+ = away from the net)
      const vz2 = vzs > 0 ? lim(PLAYER.boundsBack - zs, vzs) : -lim(zs - 0.6, -vzs);
      tz = vz2 * fz;
    }
    // follow-through: the feet plant and load; recovery starts only after the swing
    if (this.swingT >= 0 && this.swingT < PLAYER.swingDur && !this.walkTarget) { tx = 0; tz = 0; }
    // ---- accelerate (drive falls off with speed; braking/turning bounded)
    const dvx = tx - vx0, dvz = tz - vz0;
    const dvm = Math.hypot(dvx, dvz);
    if (dvm > 1e-6) {
      const tsp = Math.hypot(tx, tz);
      const speedingUp = tsp > sp0 && (sp0 < 0.2 || (tx * vx0 + tz * vz0) > 0.5 * tsp * sp0);
      let a;
      if (speedingUp) {
        a = PLAYER.accel0 * Math.max(0, 1 - sp0 / (PLAYER.maxSpeed * 1.02)) + PLAYER.accelMin;
        if (this.boostT > 0 && this.splitT <= 0) a *= PLAYER.splitBoost;
        a *= stam;
      } else a = PLAYER.brake * (this.brakeMul || 1);
      const maxDv = a * dt;
      const sc = dvm <= maxDv ? 1 : maxDv / dvm;
      this.vel.x += dvx * sc; this.vel.z += dvz * sc;
    }
    if (Math.hypot(this.vel.x, this.vel.z) < 0.02 && !order && Math.hypot(this.intent.x, this.intent.z) < 0.05) { this.vel.x = 0; this.vel.z = 0; }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    // ---- bounds (never cross the net, stay near the court)
    const bx = PLAYER.boundsSide;
    if (this.pos.x > bx) { this.pos.x = bx; this.vel.x = Math.min(0, this.vel.x); }
    if (this.pos.x < -bx) { this.pos.x = -bx; this.vel.x = Math.max(0, this.vel.x); }
    const zNet = 0.6, zBack = PLAYER.boundsBack;
    const fz = this.facing;                      // near player: z in [zNet, zBack]
    const zs = this.pos.z * fz;
    if (zs < zNet) { this.pos.z = fz * zNet; if (this.vel.z * fz < 0) this.vel.z = 0; }
    if (zs > zBack) { this.pos.z = fz * zBack; if (this.vel.z * fz > 0) this.vel.z = 0; }

    // ---- signed acceleration along the travel direction (lean / braking cue)
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.05 || sp0 > 0.05) {
      const ux = sp > 0.05 ? this.vel.x / sp : vx0 / sp0, uz = sp > 0.05 ? this.vel.z / sp : vz0 / sp0;
      const along = ((this.vel.x - vx0) * ux + (this.vel.z - vz0) * uz) / dt;
      L.accAlong += (along - L.accAlong) * Math.min(1, dt * 20);
    } else L.accAlong *= 0.8;
    // ---- gait advances with distance travelled (feet never slide)
    const stepDist = sp * dt;
    this._advanceGait(stepDist, sp);

    // ---- stamina
    if (ctx.inPoint) {
      if (sp > 3) this.stamina -= PLAYER.staminaDrain * Math.pow(sp / 6, 2) * dt;
      else if (sp < 1.5) this.stamina += PLAYER.staminaRecover * 0.5 * dt;
    } else this.stamina += PLAYER.staminaRecover * (sp < 3 ? 1 : 0.4) * dt;
    this.stamina = Math.min(1, Math.max(0, this.stamina));
    this._ctx = ctx;
    this._animate(sp, ctx);
  }

  _locoName(sp) {
    const L = this.loco;
    if (this.walkTarget && sp > 0.15) return 'walk';
    if (sp < 0.35) return null;
    if (L.accAlong < -4.5 && sp > 0.6) return 'brake';
    if (L.state === 'set' && sp < 1.2) return 'brake';
    if (L.mode === 'walk') return 'walk';
    return L.mode;
  }

  _advanceGait(dist, sp) {
    const a = this.anim;
    const nm = this._locoName(sp) || 'ready';
    const st = PLAYER.stride[nm] || PLAYER.stride.run;
    a.strideLen = st[0] + st[1] * sp;
    a.gait = (a.gait + dist / a.strideLen) % 1;
  }

  _animate(sp, ctx) {
    const a = this.anim;
    const dir = a.dir;
    if (sp > 0.3) { dir.x = this.vel.x / sp; dir.z = this.vel.z / sp; }
    a.speed = Math.min(1, sp / PLAYER.maxSpeed);
    a.accel = Math.max(-1, Math.min(1, this.loco.accAlong / 12));
    // facing: the net, except when running (body turns with the run; crossover is half-turned)
    const nm = this._locoName(sp);
    const face = a.face;
    if (nm === 'run' && sp > 1.5) { face.x = dir.x; face.z = dir.z; }
    else if (nm === 'crossover') { const fx = dir.x * 0.6, fz = dir.z * 0.6 - this.facing * 0.4, m = Math.hypot(fx, fz) || 1; face.x = fx / m; face.z = fz / m; }
    else if (nm === 'walk' && sp > 0.3) { face.x = dir.x; face.z = dir.z; }
    else { face.x = 0; face.z = -this.facing; }
    if (this.serve) {                 // serve animation driven by Simulation (serve_choreo.js timeline)
      a.name = 'serve'; a.phase = this.serve.phase; a.shot = this.serve.type || 'flat'; a.side = null;
      return;
    }
    if (this.routine) {               // pre-serve ball bounce routine: phase = progress of the current bounce
      a.name = 'bounce'; a.phase = this.routine.mode === 'dribble' ? this.routine.u : 0; a.shot = null; a.side = null;
      return;
    }
    const ci = this.contactInfo;
    if (this.swingT >= 0 || this.prepared) {
      a.contact = ci ? ci.contact : null; a.variant = ci ? ci.variant : 'normal'; a.reachT = ci ? ci.reachT : 0;
    } else { a.contact = null; a.variant = 'normal'; a.reachT = 0; }
    if (this.swingT >= 0) {
      a.name = 'swing'; a.shot = this.swingShot; a.side = this.swingSide;
      a.phase = Math.min(1, 0.5 + 0.5 * this.swingT / PLAYER.swingDur);
      return;
    }
    if (this.prepared) {
      a.name = 'swing'; a.shot = this.prepared.shot; a.side = this.prepared.side || (ci && ci.side) || null;
      a.phase = Math.min(0.45, 0.05 + this.prepared.t * 1.6);
      return;
    }
    this.contactInfo = null;
    a.shot = null; a.side = null; a.phase = 0;
    if (this.celebrateT > 0) { a.name = 'celebrate'; return; }
    if (this.dejectedT > 0) { a.name = 'dejected'; return; }
    if (this.splitT > 0) { a.name = 'split'; a.phase = 1 - Math.max(0, this.splitT) / PLAYER.splitDur; return; }
    if (nm) { a.name = nm === 'walk' || ctx.inPoint || ctx.ready ? nm : 'walk'; return; }
    a.name = ctx.inPoint || ctx.ready ? 'ready' : 'idle';
  }

  /** Approximate racket head world position for the renderer. */
  updateRacket(ballPos = null) {
    const a = this.anim, hx = this.handX, f = -this.facing;       // f = forward z sign (toward net)
    const x = this.pos.x, z = this.pos.z;
    let rx, ry, rz;
    if (a.name === 'swing') {
      const p = a.phase;
      if (p < 0.5) {              // backswing -> contact
        const t = p / 0.5;
        rx = x + hx * (0.75 + 0.1 * t); ry = 0.9 + 0.2 * t; rz = z + f * (-0.45 + 0.95 * t);
      } else {
        const t = (p - 0.5) / 0.5;
        rx = x + hx * (0.85 - 1.1 * t); ry = 1.0 + 0.7 * t; rz = z + f * (0.5 + 0.1 * t);
      }
      if (ballPos && p >= 0.45 && p <= 0.55) { rx = ballPos.x; ry = ballPos.y; rz = ballPos.z; }
    } else if (a.name === 'serve') {
      const p = a.phase;
      ry = p < 0.5 ? 0.9 + 1.0 * (p / 0.5) : p < 0.65 ? 1.9 + 1.0 * ((p - 0.5) / 0.15) : 2.9 - 2.0 * ((p - 0.65) / 0.35);
      rx = x + hx * 0.3; rz = z + f * (0.2 + 0.4 * Math.min(1, p / 0.65));
    } else { rx = x + hx * 0.5; ry = 0.95; rz = z + f * 0.5; }
    this.racketHead.x = rx; this.racketHead.y = ry; this.racketHead.z = rz;
  }
}
