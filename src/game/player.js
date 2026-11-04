// Player kinematics, stamina, animation state. DOM-free.

import { COURT } from '../config.js';

// ---------------------------------------------------------------- tunables
export const PLAYER = {
  maxSpeed: 6.0,           // m/s
  accel: 9.0,              // m/s^2
  brake: 12.0,             // m/s^2 when slowing down
  prepSpeedMul: 0.8,       // while holding a backswing
  swingSpeedMul: 0.5,      // during the swing
  swingDur: 0.30,          // s, follow-through length
  splitDur: 0.2,           // s
  splitBoostDur: 0.5,      // s of improved acceleration after a split step
  splitBoost: 1.3,
  staminaDrain: 0.035,     // per second at full sprint
  staminaRecover: 0.03,    // per second standing
  staminaFloorSpeed: 0.88, // speed multiplier at zero stamina = 0.88 .. 1.0
  walkSpeed: 2.6,
  boundsSide: COURT.doublesHalfWidth + 3.0,
  boundsBack: COURT.halfLength + 5.2,
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
    this.moveScale = 1;
    this.anim = { name: 'ready', shot: null, side: null, phase: 0, dir: { x: 0, z: 0 }, speed: 0 };
    this.racketHead = { x: 0, y: 1, z: 0 };
    this.sprintDist = 0;
  }

  get handX() { return (this.hand === 'R' ? 1 : -1) * this.facing; }

  maxSpeed() {
    const st = PLAYER.staminaFloorSpeed + (1 - PLAYER.staminaFloorSpeed) * this.stamina;
    let m = PLAYER.maxSpeed * st * this.speedMul;
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
  startSwing(shot, side) {
    this.swingT = 0; this.swingShot = shot; this.swingSide = side;
    this.prepared = null;
    this.cooldown = 0.32;
    this.stamina = Math.max(0, this.stamina - 0.004);
    this.syncAnim();
  }

  /** Recompute `anim` immediately (used right after an input-driven state change). */
  syncAnim() { this._animate(Math.hypot(this.vel.x, this.vel.z), this._ctx || {}); }

  /**
   * Advance kinematics and animation.
   * @param {number} dt
   * @param {{inPoint:boolean, idle:boolean}} ctx
   */
  update(dt, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.splitT > 0) this.splitT -= dt;
    if (this.boostT > 0) this.boostT -= dt;
    if (this.swingT >= 0) { this.swingT += dt; if (this.swingT > PLAYER.swingDur) this.swingT = -1; }
    if (this.celebrateT > 0) this.celebrateT -= dt;
    if (this.dejectedT > 0) this.dejectedT -= dt;
    if (this.prepared) this.prepared.t += dt;

    // ---- target velocity
    let tx = 0, tz = 0, vmax = this.maxSpeed();
    if (this.walkTarget) {
      const dx = this.walkTarget.x - this.pos.x, dz = this.walkTarget.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) { this.walkTarget = null; }
      else {
        const s = Math.min(PLAYER.walkSpeed * (this.walkFast ? 1.6 : 1), d * 3);
        tx = dx / d * s; tz = dz / d * s;
      }
    } else {
      const ix = this.intent.x, iz = this.intent.z;
      const m = Math.hypot(ix, iz);
      const k = m > 1 ? 1 / m : 1;
      tx = ix * k * vmax * this.moveScale; tz = iz * k * vmax * this.moveScale;
    }
    // ---- accelerate
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dvm = Math.hypot(dvx, dvz);
    if (dvm > 1e-6) {
      const speed = Math.hypot(this.vel.x, this.vel.z), tspeed = Math.hypot(tx, tz);
      let a = tspeed < speed ? PLAYER.brake : PLAYER.accel;
      if (this.boostT > 0 && this.splitT <= 0) a *= PLAYER.splitBoost;
      a *= PLAYER.staminaFloorSpeed + (1 - PLAYER.staminaFloorSpeed) * this.stamina;
      const maxDv = a * dt;
      const s = dvm <= maxDv ? 1 : maxDv / dvm;
      this.vel.x += dvx * s; this.vel.z += dvz * s;
    }
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

    // ---- stamina
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (ctx.inPoint) {
      if (sp > 3) this.stamina -= PLAYER.staminaDrain * Math.pow(sp / 6, 2) * dt;
      else if (sp < 1.5) this.stamina += PLAYER.staminaRecover * 0.5 * dt;
    } else this.stamina += PLAYER.staminaRecover * (sp < 3 ? 1 : 0.4) * dt;
    this.stamina = Math.min(1, Math.max(0, this.stamina));
    this._ctx = ctx;
    this._animate(sp, ctx);
  }

  _animate(sp, ctx) {
    const a = this.anim;
    const dir = a.dir;
    if (sp > 0.3) { dir.x = this.vel.x / sp; dir.z = this.vel.z / sp; }
    a.speed = Math.min(1, sp / PLAYER.maxSpeed);
    if (this.serve) {                 // serve animation driven by Simulation
      a.name = 'serve'; a.phase = this.serve.phase; a.shot = null; a.side = null;
      return;
    }
    if (this.swingT >= 0) {
      a.name = 'swing'; a.shot = this.swingShot; a.side = this.swingSide;
      a.phase = Math.min(1, 0.5 + 0.5 * this.swingT / PLAYER.swingDur);
      return;
    }
    if (this.prepared) {
      a.name = 'swing'; a.shot = this.prepared.shot; a.side = this.prepared.side || null;
      a.phase = Math.min(0.45, 0.05 + this.prepared.t * 1.6);
      return;
    }
    a.shot = null; a.side = null; a.phase = 0;
    if (this.celebrateT > 0) { a.name = 'celebrate'; return; }
    if (this.dejectedT > 0) { a.name = 'dejected'; return; }
    if (this.splitT > 0) { a.name = 'split'; return; }
    if (this.walkTarget || (!ctx.inPoint && sp > 0.4)) { a.name = sp > 0.3 ? 'walk' : 'idle'; return; }
    if (sp > 1.0) { a.name = 'run'; return; }
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
