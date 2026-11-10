// Procedural animation: pose library blending, foot planting, two-bone IK, strokes, locomotion, emotes.
// All maths run in the canonical body frame B (rig-local: +z forward, +x dominant side); no per-frame allocations.
import * as THREE from 'three';
import { BONES, BI, DIM } from './build.js';
import { F, NF, BASE, evalTable, strokeFor, STROKES } from './strokes.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4, E = THREE.Euler;
const AY = new V3(0, 1, 0), DOWN = new V3(0, -1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const frac = (x) => x - Math.floor(x);
const TAU = Math.PI * 2;

export const NAMES = ['ready', 'split', 'shuffle', 'run', 'backpedal', 'brake', 'swing', 'serve', 'toss', 'celebrate', 'dejected', 'walk'];
const SHOTS = ['topspin', 'flat', 'slice', 'lob', 'volley', 'smash'];
const EMPTY = Object.freeze({});

// ------------------------------------------------------------------ scratch
const v = Array.from({ length: 24 }, () => new V3());
const q = Array.from({ length: 14 }, () => new Q());
const eu = new E();
const bm = new M4();
const bx = new V3(), by = new V3(), bz = new V3();

function basisQuat(out, shaft, nHint) {
  by.copy(shaft).normalize();
  bz.copy(nHint); bz.addScaledVector(by, -bz.dot(by));
  if (bz.lengthSq() < 1e-5) { bz.set(0, 0, 1); bz.addScaledVector(by, -bz.dot(by)); if (bz.lengthSq() < 1e-5) bz.set(1, 0, 0); }
  bz.normalize();
  bx.crossVectors(by, bz);
  bm.makeBasis(bx, by, bz);
  return out.setFromRotationMatrix(bm);
}
function basisQuatXY(out, xa, ya) { // x and y axes given (orthonormalised), z = x cross y
  bx.copy(xa).normalize(); by.copy(ya); by.addScaledVector(bx, -by.dot(bx)).normalize();
  bz.crossVectors(bx, by);
  bm.makeBasis(bx, by, bz);
  return out.setFromRotationMatrix(bm);
}

// grip: racket local (x,y,z) -> hand local. Dominant hand: palm faces -x, shaft along +z.
const MqD = new Q().setFromRotationMatrix(new M4().makeBasis(new V3(0, -1, 0), new V3(0, 0, 1), new V3(-1, 0, 0)));
const MqN = new Q().setFromRotationMatrix(new M4().makeBasis(new V3(0, 1, 0), new V3(0, 0, 1), new V3(1, 0, 0)));
export const GRIP_Q = MqD;
const MqD_inv = MqD.clone().invert(), MqN_inv = MqN.clone().invert();

// two-bone IK. Returns clamped end in `end`, joint in `mid`.
const s2d = new V3(), s2p = new V3();
function solve2(root, target, l1, l2, pole, mid, end) {
  s2d.subVectors(target, root);
  let dist = s2d.length();
  const maxD = (l1 + l2) * 0.9995, minD = Math.abs(l1 - l2) + 0.02;
  dist = clamp(dist, minD, maxD);
  if (s2d.lengthSq() < 1e-8) s2d.set(0, -1, 0); else s2d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  s2p.copy(pole).addScaledVector(s2d, -pole.dot(s2d));
  if (s2p.lengthSq() < 1e-6) { s2p.set(0, 0, 1).addScaledVector(s2d, -s2d.z); if (s2p.lengthSq() < 1e-6) s2p.set(1, 0, 0); }
  s2p.normalize();
  mid.copy(root).addScaledVector(s2d, a).addScaledVector(s2p, h);
  end.copy(root).addScaledVector(s2d, dist);
}

class Foot {
  constructor() {
    this.x = 0; this.z = 0; this.yaw = 0; this.y = 0; this.pitch = 0;
    this.step = false; this.t = 0; this.dur = 0.2; this.H = 0.07;
    this.sx = 0; this.sz = 0; this.syaw = 0; this.swinging = false;
  }
}

export class Animator {
  constructor(bones, racketNode) {
    this.bones = bones; this.racketNode = racketNode;
    this.bp = BONES.map(() => new V3()); this.bq = BONES.map(() => new Q());
    this.RO = BONES.map((b) => new V3(b[2], b[3], b[4]));
    this.par = BONES.map((b) => b[1]);
    this.P = new Float32Array(NF); this.Pn = new Float32Array(NF); this.Pf = new Float32Array(NF); this.P5 = new Float32Array(NF);
    this.feet = [new Foot(), new Foot()];
    this.spot = [{ x: 0.27, z: 0, yaw: 0.1 }, { x: -0.27, z: 0.05, yaw: -0.1 }];
    this.mode = 'stance'; this.thr = 0.17;
    this.init = false; this.m = -1; this.yaw = 0; this.cosP = 1; this.sinP = 0;
    this.px = 0; this.pz = 0; this.vx = 0; this.vz = 0; this.vbx = 0; this.vbz = 0; this.speedW = 0;
    this.key = -1; this.stateT = 0; this.fadeT = 1; this.fadeDur = 0.15; this.t = 0;
    this.g = 0; this.gPrev = 0; this.gInit = false; this.Lc = 2.4; this.ux = 0; this.uz = 1; this.ownG = 0;
    this.bounce = 0; this.simY = 0; this.jumpLift = 0;
    this.ctDelta = new V3(); this.ctW = 0; this.def = null; this.cp = 0.5; this.phase = 0;
    this.headYaw = 0; this.headPitch = 0; this.hasBall = false;
    this.poniA = 0; this.poniB = 0; this.poniVA = 0; this.poniVB = 0;
    // outputs (B frame)
    this.gripB = new V3(); this.sweetB = new V3(); this.tipB = new V3(); this.tossB = new V3(); this.shaftB = new V3();
    this.qRack = new Q();
    this.face = { mouth: 'neutral', brow: 'neutral', blink: 0, gx: 0, gy: 0 };
    this.blinkT = 2; this.blinkPhase = -1; this.squash = 0; this.hipPrev = 0.86; this.sqPose = 0;
    this.celebT = 0;
    for (let i = 0; i < BONES.length; i++) this.bq[i].identity();
    this.P.set(BASE);
    this.ankleT = [new V3(), new V3()]; this.footQ = [new Q(), new Q()];
    this.reachFrac = 0;
    this.stateName = 'ready';
  }

  // ------------------------------------------------------------ frame conversions
  worldToB(dx, dz, out) {
    const xo = dx * this.cosP - dz * this.sinP, zc = dx * this.sinP + dz * this.cosP;
    return out.set(this.m * xo, 0, zc);
  }

  // ------------------------------------------------------------ main update
  update(ps, dtReal, ctx) {
    const dt = clamp(dtReal || 0.016, 0.001, 0.1);
    const a = ps.anim || EMPTY;
    this.t = (ctx && ctx.time != null) ? ctx.time : this.t + dt;
    const px = ps.pos ? ps.pos.x : 0, pz = ps.pos ? ps.pos.z : 0;
    this.m = ps.hand === 'L' ? 1 : -1;
    this.simY = ps.y > 0 ? ps.y : 0;

    // facing
    let fx = a.face ? a.face.x : 0, fz = a.face ? a.face.z : 0;
    if (!(fx * fx + fz * fz > 1e-6)) { fx = 0; fz = pz >= 0 ? -1 : 1; if (this.defaultFacing) { fx = this.defaultFacing.x; fz = this.defaultFacing.z; } }
    const tyaw = Math.atan2(fx, fz);
    if (!this.init) { this.yaw = tyaw; this.lpx = px; this.lpz = pz; }
    this.yaw += wrap(tyaw - this.yaw) * (1 - Math.exp(-dt * 16));
    this.cosP = Math.cos(this.yaw); this.sinP = Math.sin(this.yaw);

    // velocity
    if (this.init) {
      const ivx = (px - this.lpx) / dt, ivz = (pz - this.lpz) / dt;
      const k = 1 - Math.exp(-dt * 14);
      this.vx += (ivx - this.vx) * k; this.vz += (ivz - this.vz) * k;
    }
    const tele = this.init && Math.hypot(px - this.lpx, pz - this.lpz) > 2.5;
    const stepDist = this.init ? Math.hypot(px - this.lpx, pz - this.lpz) : 0;
    this.lpx = px; this.lpz = pz;
    this.px = px; this.pz = pz;
    this.speedW = Math.hypot(this.vx, this.vz);
    if (this.speedW > 0.25) { this.ux = this.vx / this.speedW; this.uz = this.vz / this.speedW; }
    this.vbx = this.m * (this.vx * this.cosP - this.vz * this.sinP);
    this.vbz = this.vx * this.sinP + this.vz * this.cosP;

    // state key + crossfade
    let name = a.name; let ni = NAMES.indexOf(name); if (ni < 0) { ni = 0; name = 'ready'; }
    const shot = a.shot || (name === 'swing' ? 'topspin' : null);
    const si = shot ? SHOTS.indexOf(shot) + 1 : 0;
    const sideI = a.side === 'bh' ? 2 : a.side === 'fh' ? 1 : 0;
    const key = ni * 64 + si * 4 + sideI;
    if (key !== this.key) {
      if (this.init) {
        this.Pf.set(this.P); this.fadeT = 0;
        const prevName = this.stateName;
        this.fadeDur = name === 'swing' ? 0.09 : (prevName === 'swing' || prevName === 'serve') ? 0.24 : name === 'dejected' || name === 'celebrate' ? 0.25 : 0.17;
      } else { this.fadeT = 1; }
      this.key = key; this.stateT = 0; this.stateName = name;
    }
    this.stateT += dt;
    this.fadeT += dt;
    this.init = true;

    // gait
    const spd01 = a.speed != null ? clamp(a.speed, 0, 1) : clamp(this.speedW / 6.5, 0, 1);
    this.spd01 = spd01;
    this.updateGait(a, name, stepDist, dt);

    // evaluate target pose + stance
    this.evalState(this.Pn, name, shot, a, ps, spd01, dt, ctx);

    // crossfade
    const P = this.P;
    if (this.fadeT < this.fadeDur) {
      const u = this.fadeT / this.fadeDur, e = u * u * (3 - 2 * u);
      for (let i = 0; i < NF; i++) P[i] = this.Pf[i] + (this.Pn[i] - this.Pf[i]) * e;
    } else P.set(this.Pn);

    // feet
    if (tele || !this.feetInit) this.resetFeet();
    this.updateFeet(dt, name, spd01);

    // body, IK, head, face
    this.jumpLift = this.simY + P[F.jmp];
    this.solve(ps, dt, ctx, name, a);
    this.updateFace(ps, a, name, dt);
  }

  // ------------------------------------------------------------ gait phase
  updateGait(a, name, stepDist, dt) {
    const loco = name === 'run' || name === 'walk' || name === 'shuffle' || name === 'backpedal';
    const simG = typeof a.gait === 'number';
    if (loco) {
      const def = name === 'run' ? 2.5 : name === 'walk' ? 1.5 : name === 'shuffle' ? 1.35 : 1.6;
      if (simG) {
        if (this.gInit) {
          let dg = a.gait - this.gPrev; if (dg < -0.5) dg += 1; if (dg > 0.5) dg -= 1;
          if (dg > 1e-4 && stepDist > 1e-4) { const est = clamp(stepDist / dg, 0.8, 4); this.Lc += (est - this.Lc) * 0.08; }
        }
        this.gPrev = a.gait; this.gInit = true; this.g = a.gait;
        if (a.strideLen > 0.2 && this.Lc === 2.4) this.Lc = clamp(a.strideLen * 2, 0.8, 4);
      } else {
        this.ownG += stepDist / def; this.g = frac(this.ownG); this.Lc = def;
      }
    } else { this.gInit = false; }
  }

  // ------------------------------------------------------------ pose evaluation per state
  setSpots(dx, dz, dy, nx, nz, ny) {
    const s = this.spot;
    s[0].x = dx; s[0].z = dz; s[0].yaw = dy; s[1].x = nx; s[1].z = nz; s[1].yaw = ny;
  }

  evalState(P, name, shot, a, ps, s, dt, ctx) {
    P.set(BASE);
    this.ctW = 0; this.ctDelta.set(0, 0, 0); this.def = null; this.sqPose = 0;
    this.mode = 'stance'; this.thr = 0.17; this.bounce = 0;
    const t = this.t, st = this.stateT;
    const accel = a.accel != null ? clamp(a.accel, -1, 1) : 0;
    switch (name) {
      case 'swing': case 'serve': case 'toss': this.evalStroke(P, name, shot, a, ps, dt); break;
      case 'ready': {
        this.setSpots(0.27, -0.03, 0.12, -0.27, 0.05, -0.12);
        const b = Math.sin(t * 4.4);
        P[F.hip] += 0.016 * b; P[F.hy] += 0.012 * Math.sin(t * 4.4 + 1); P[F.sx] = 0.018 * Math.sin(t * 2.2);
        P[F.lean] += 0.01 * b; this.bounce = 0.01 * b;
        break;
      }
      case 'split': {
        // hop: airborne 0..0.4, land into wide crouch
        let u = a.phase != null ? a.phase : (st / 0.34) % 1.6;
        u = clamp(u, 0, 1.6);
        const air = u < 0.45 ? Math.sin(u / 0.45 * Math.PI) : 0;
        const land = u >= 0.45 ? Math.exp(-(u - 0.45) * 3) : 0;
        this.setSpots(0.37, 0.0, 0.2, -0.37, 0.0, -0.2);
        P[F.hip] = 0.2 + 0.06 * land; P[F.jmp] = 0.07 * air; P[F.lean] = 0.22; P[F.hy] = 1.0; P[F.hx] = 0.16;
        this.thr = 0.1; this.hopAir = air;
        break;
      }
      case 'celebrate': {
        const u = frac(st / 1.1);
        const jumpN = st < 3.3 ? Math.abs(Math.sin(u * Math.PI)) : 0;
        this.setSpots(0.22, 0, 0.1, -0.22, 0, -0.1);
        P[F.jmp] = 0.16 * jumpN; P[F.hip] = 0.08 + 0.1 * (1 - jumpN); P[F.lean] = -0.05;
        const pump = Math.sin(st * 9) * 0.5 + 0.5;
        // racket arm up in a fist pump, free fist pumping
        P[F.hx] = 0.34; P[F.hy] = 1.7 + 0.1 * pump; P[F.hz] = 0.12; P[F.ax] = 0.2; P[F.ay] = 0.8; P[F.az] = 0.3; P[F.eD] = 0.9;
        P[F.lw] = 0; P[F.lx] = -0.28; P[F.ly] = 1.5 + 0.2 * (1 - pump); P[F.lz] = 0.24; P[F.eN] = 0.9;
        P[F.pYaw] = 0.2 * Math.sin(st * 4.5); P[F.cYaw] = -0.1; P[F.hPitch] = -0.25; P[F.track] = 0.3; P[F.eff] = 1;
        this.thr = 0.3;
        break;
      }
      case 'dejected': {
        const br = Math.sin(t * 2.2);
        this.setSpots(0.19, 0, 0.05, -0.19, 0.04, -0.05);
        P[F.hip] = 0.07; P[F.lean] = 0.38 + 0.02 * br; P[F.tilt] = 0.12; P[F.hPitch] = 0.62; P[F.track] = 0; P[F.hYaw] = 0.2 * Math.sin(st * 2.6) * Math.exp(-st * 0.4);
        P[F.hx] = 0.30; P[F.hy] = 0.68; P[F.hz] = 0.1; P[F.ax] = 0.15; P[F.ay] = -1; P[F.az] = 0.2; P[F.nx] = 1; P[F.eD] = 0.15;
        P[F.lw] = 0; P[F.lx] = -0.27; P[F.ly] = 0.7; P[F.lz] = 0.08; P[F.eN] = 0.15; P[F.side] = 0.04; this.bounce = 0.006 * br;
        P[F.pYaw] = 0.12; P[F.cYaw] = 0.06; this.thr = 0.3;
        break;
      }
      case 'brake': {
        this.setSpots(0.30, -0.08, 0.3, -0.26, 0.20, -0.2);
        P[F.hip] = 0.2; P[F.lean] = clamp(-0.05 + this.vbz * 0.02, -0.15, 0.2); P[F.tilt] = 0.05;
        P[F.hx] = 0.46; P[F.hy] = 1.02; P[F.hz] = 0.25; P[F.lw] = 0; P[F.lx] = -0.52; P[F.ly] = 1.1; P[F.lz] = 0.15; P[F.eD] = 0.8; P[F.eN] = 0.8;
        P[F.side] = clamp(this.vbx * 0.05, -0.25, 0.25); P[F.sx] = clamp(this.vbx * 0.03, -0.12, 0.12); P[F.sz] = clamp(this.vbz * 0.02, -0.1, 0.1);
        this.thr = 0.28;
        break;
      }
      case 'run': case 'walk': case 'shuffle': case 'backpedal': this.evalLoco(P, name, s, accel); break;
    }
  }

  evalLoco(P, name, s, accel) {
    this.mode = 'gait'; this.thr = 0.2;
    const g = this.g, ph = TAU * g;
    const cs = Math.cos(ph), sn = Math.sin(ph);
    const fwdLean = clamp(this.vbz * 0.045, -0.12, 0.34);
    const sideLean = clamp(this.vbx * 0.035, -0.28, 0.28);
    if (name === 'run') {
      this.setSpots(0.115, 0, 0.0, -0.115, 0, 0.0);
      P[F.lean] = 0.1 + fwdLean + 0.22 * accel; P[F.side] = sideLean; P[F.hip] = 0.07 + 0.05 * s; P[F.tilt] = 0.12;
      P[F.pYaw] = 0.26 * s * sn; P[F.cYaw] = -0.55 * P[F.pYaw];
      P[F.hx] = 0.26; P[F.hy] = 1.0 + 0.03 * Math.sin(2 * ph); P[F.hz] = 0.38 - 0.1 * s * cs; P[F.ax] = 0.15; P[F.ay] = 0.7; P[F.az] = 0.75; P[F.nx] = 1; P[F.ny] = 0; P[F.nz] = 0.1;
      P[F.lw] = 0; P[F.lx] = -0.24; P[F.ly] = 1.0 + 0.08 * s * cs; P[F.lz] = 0.28 + 0.3 * s * cs; P[F.eD] = 0.5; P[F.eN] = 0.55;
      P[F.pz] = 0.0;
      this.bounce = -0.05 * s * (1 + Math.cos(4 * (ph - Math.PI / 2))) * 0.5;
    } else if (name === 'walk') {
      this.setSpots(0.1, 0, 0.0, -0.1, 0, 0.0);
      P[F.lean] = 0.04 + fwdLean * 0.5; P[F.hip] = 0.02; P[F.tilt] = 0.04; P[F.track] = 0.6;
      P[F.pYaw] = 0.12 * sn; P[F.cYaw] = -0.5 * P[F.pYaw];
      P[F.hx] = 0.27; P[F.hy] = 0.76; P[F.hz] = 0.14 - 0.06 * cs; P[F.ax] = 0.15; P[F.ay] = -0.8; P[F.az] = 0.5; P[F.nx] = 1; P[F.ny] = 0; P[F.nz] = 0.3; P[F.eD] = 0.2;
      P[F.lw] = 0; P[F.lx] = -0.27; P[F.ly] = 0.78; P[F.lz] = 0.1 + 0.2 * cs; P[F.eN] = 0.2;
      this.bounce = 0.012 * (1 + Math.cos(4 * (ph - Math.PI / 2))) * 0.5;
    } else if (name === 'shuffle') {
      this.setSpots(0.2, 0.0, 0.1, -0.2, 0.02, -0.1);
      P[F.lean] = 0.2; P[F.side] = sideLean * 0.6; P[F.hip] = 0.17; P[F.sx] = clamp(this.vbx * 0.02, -0.08, 0.08);
      P[F.pYaw] = 0.05 * sn;
      P[F.hz] = 0.42 + 0.01 * sn; P[F.hy] = 0.98 + 0.012 * cs;
      this.bounce = -0.018 * (1 + Math.cos(4 * (ph - Math.PI / 2))) * 0.5;
    } else { // backpedal
      this.setSpots(0.14, 0, 0.0, -0.14, 0, 0.0);
      P[F.lean] = 0.14 + clamp(-this.vbz * 0.01, 0, 0.1); P[F.hip] = 0.12; P[F.tilt] = 0.08;
      P[F.pYaw] = 0.15 * sn; P[F.cYaw] = -0.4 * P[F.pYaw];
      P[F.hx] = 0.2; P[F.hy] = 1.0; P[F.hz] = 0.4; P[F.lw] = 0.5; P[F.lx] = -0.25; P[F.ly] = 1.0; P[F.lz] = 0.35 - 0.1 * cs;
      this.bounce = -0.03 * s * (1 + Math.cos(4 * (ph - Math.PI / 2))) * 0.5;
    }
  }

  evalStroke(P, name, shot, a, ps, dt) {
    const isServe = name === 'serve' || name === 'toss' || shot === 'serve';
    const def = isServe ? STROKES.serve : strokeFor(shot || 'topspin', a.side);
    this.def = def;
    const cp = isServe ? 0.65 : (shot === 'smash' ? 0.52 : 0.5);
    this.cp = cp;
    let ph;
    if (a.phase != null) ph = a.phase; else ph = this.stateT / def.dur;
    if (name === 'toss') {
      // toss: lift + release at 0.3, then settle into the trophy position (serve time 0.3..0.4)
      const u = clamp(a.phase != null ? a.phase : this.stateT / 0.9, 0, 1);
      ph = u < 0.3 ? u : 0.3 + (u - 0.3) / 0.7 * 0.1;
    }
    ph = clamp(ph, 0, 1);
    this.phase = ph;
    evalTable(def.tbl, ph, P);
    // baked squash & stretch: compress into the load, stretch through contact
    this.sqPose = 0.045 * (Math.exp(-Math.pow((ph - (cp - 0.16)) / 0.08, 2)) * -1 + 1.2 * Math.exp(-Math.pow((ph - (cp + 0.12)) / 0.06, 2)));
    // stance
    const sp = def.stance;
    const c = a.contact;
    const m = this.m;
    let cx = def.nom.lat, cz = def.nom.fwd, cy = def.nom.h;
    // sim convention (docs/ARCADE.md): contact.lat > 0 = toward the stroke's hitting side (fh: racket-arm side, bh: the other
    // side), already hand-relative; the rig works in racket-arm-side space, so only the stroke side flips the sign.
    if (c && c.h != null) { cx = (a.side === 'bh' ? -1 : 1) * c.lat; cz = c.fwd; cy = c.h; }
    else { cx = def.nom.lat; }
    // nominal sweet spot (table at contact phase)
    evalTable(def.tbl, cp, this.P5);
    this.sweetOf(this.P5, v[20], q[10], v[21]); // v[20] = grip, v[21] = shaft
    v[22].copy(v[20]).addScaledVector(v[21], DIM.headCY);
    let dx = 0, dz = 0, dy = 0;
    if (c && c.h != null) { v[23].set(cx, cy, cz); this.ctDelta.copy(v[23]).sub(v[22]); dx = this.ctDelta.x; dz = this.ctDelta.z; dy = this.ctDelta.y; }
    // weight of the contact correction over phase
    let w;
    if (ph < cp) w = sstep(cp - 0.26, cp, ph); else w = ph < cp + 0.12 ? lerp(1, 0.35, sstep(cp, cp + 0.12, ph)) : 0.35 * (1 - sstep(cp + 0.12, cp + 0.4, ph));
    if (!c) w = 0;
    this.ctW = w; this.ctDelta.multiplyScalar(w);
    // body adaptation (reach / height)
    const R = a.reachT != null ? clamp(a.reachT, 0, 1) : clamp(Math.hypot(dx, dz) / 0.6, 0, 1);
    this.reachFrac = R;
    const wb = c ? w : 0;
    P[F.px] += clamp(dx * 0.4, -0.35, 0.35) * wb;
    P[F.pz] += clamp(dz * 0.45, -0.3, 0.4) * wb;
    P[F.lean] += R * 0.2 * wb;
    P[F.side] += clamp(dx * 0.2, -0.2, 0.2) * wb;
    if (def.lowAdapt) {
      const low = clamp((def.nom.h - cy) * 0.6, -0.1, 0.36);
      P[F.hipX] += low * wb + R * 0.08 * wb;
    } else if (c) {
      P[F.heel] = clamp(P[F.heel] + clamp(dy, -0.3, 0.3), 0, 1);
      P[F.jmp] += clamp(dy * 1.3 + 0.02, 0, 0.4) * wb;
    }
    // feet: widen with reach
    const wide = 1 + R * 0.45;
    this.setSpots(sp.D[0] * wide, sp.D[1], sp.D[2], sp.N[0] * wide, sp.N[1], sp.N[2]);
    if (name === 'toss' || isServe) {
      if (!(ph < 0.5 && this.fadeT < 0.05)) { /* spots are fixed */ }
    }
    this.thr = isServe ? 0.28 : 0.2;
  }

  // racket frame from a pose array: grip (B), orientation (B) and shaft (B)
  sweetOf(P, grip, qOut, shaft) {
    // racket keys are authored in the (un-yawed) body frame B
    grip.set(P[F.hx] + P[F.sx], P[F.hy] - 0.75 * P[F.hip], P[F.hz] + P[F.sz]);
    v[18].set(P[F.ax], P[F.ay], P[F.az]); v[19].set(P[F.nx], P[F.ny], P[F.nz]);
    basisQuat(qOut, v[18], v[19]);
    shaft.set(0, 1, 0).applyQuaternion(qOut);
  }

  // ------------------------------------------------------------ feet
  resetFeet() {
    this.feetInit = true;
    for (let f = 0; f < 2; f++) {
      const ft = this.feet[f], sp = this.spot[f];
      const xo = this.m * sp.x;
      ft.x = this.px + xo * this.cosP + sp.z * this.sinP; ft.z = this.pz - xo * this.sinP + sp.z * this.cosP;
      ft.yaw = this.yaw + this.m * sp.yaw; ft.y = 0; ft.pitch = 0; ft.step = false; ft.swinging = false;
    }
  }

  updateFeet(dt, name, s) {
    const m = this.m, c = this.cosP, sn = this.sinP;
    for (let f = 0; f < 2; f++) {
      const ft = this.feet[f], ot = this.feet[1 - f], sp = this.spot[f];
      const xo = m * sp.x;
      let tx = this.px + xo * c + sp.z * sn, tz = this.pz - xo * sn + sp.z * c;
      const tyaw = this.yaw + m * sp.yaw;
      if (this.mode === 'gait') {
        const fr = frac(this.g + (f ? 0.5 : 0));
        const swing = fr >= 0.5;
        if (swing) {
          const su = (fr - 0.5) * 2;
          if (!ft.swinging) { ft.swinging = true; ft.sx = ft.x; ft.sz = ft.z; ft.syaw = ft.yaw; ft.step = false; }
          const q4 = this.Lc * 0.25, rem = this.Lc * 0.5 * (1 - su);
          const trav = name === 'shuffle' ? 0.8 : 1;
          tx += this.ux * (q4 + rem) * trav * Math.min(1, this.speedW * 0.8); tz += this.uz * (q4 + rem) * trav * Math.min(1, this.speedW * 0.8);
          const e = su * su * (3 - 2 * su);
          ft.x = lerp(ft.sx, tx, e); ft.z = lerp(ft.sz, tz, e);
          ft.yaw = ft.syaw + wrap(tyaw - ft.syaw) * e;
          const H = name === 'run' ? 0.12 + 0.22 * s : name === 'walk' ? 0.06 : name === 'shuffle' ? 0.05 : 0.07;
          ft.y = H * Math.sin(Math.PI * su);
          ft.pitch = lerp(0.55, -0.3, su) * (name === 'run' ? 1 : 0.5);
        } else {
          ft.swinging = false;
          const su = fr * 2;
          ft.y = 0;
          ft.pitch = (name === 'run' ? 0.7 : 0.35) * sstep(0.62, 1, su);
          // keep yaw following the body slowly
        }
        ft.step = false;
      } else {
        if (ft.swinging) { ft.swinging = false; ft.step = true; ft.t = 0; ft.dur = 0.14; ft.H = 0.05; ft.sx = ft.x; ft.sz = ft.z; ft.syaw = ft.yaw; }
        if (ft.step) {
          ft.t += dt;
          const su = Math.min(1, ft.t / ft.dur), e = su * su * (3 - 2 * su);
          ft.x = lerp(ft.sx, tx, e); ft.z = lerp(ft.sz, tz, e); ft.yaw = ft.syaw + wrap(tyaw - ft.syaw) * e;
          ft.y = ft.H * Math.sin(Math.PI * su);
          ft.pitch = 0.3 * Math.sin(Math.PI * su);
          if (su >= 1) { ft.step = false; ft.y = 0; ft.pitch = 0; }
        } else {
          const dist = Math.hypot(tx - ft.x, tz - ft.z), yd = Math.abs(wrap(tyaw - ft.yaw));
          if ((dist > this.thr || yd > 1.1) && (!ot.step || dist > 0.55)) {
            ft.step = true; ft.t = 0; ft.dur = clamp(0.12 + 0.2 * dist, 0.12, 0.3); ft.H = 0.035 + 0.1 * Math.min(dist, 0.8);
            ft.sx = ft.x; ft.sz = ft.z; ft.syaw = ft.yaw;
          } else { ft.y = 0; ft.pitch = 0; }
        }
      }
    }
  }

  footTarget(f) {
    const ft = this.feet[f];
    const dx = ft.x - this.px, dz = ft.z - this.pz;
    const xo = dx * this.cosP - dz * this.sinP, zc = dx * this.sinP + dz * this.cosP;
    const yawB = this.m * wrap(ft.yaw - this.yaw);
    const out = this.ankleT[f];
    const h = ft.pitch;
    let ay = DIM.ankleH + ft.y;
    let fz = 0;
    if (h > 0) { const L = 0.17; ay += L * Math.sin(h) - 0.0; fz = L * (1 - Math.cos(h)); }
    const lift = this.jumpLift * 0.9;
    out.set(this.m * xo + Math.sin(yawB) * fz, ay + lift, zc + Math.cos(yawB) * fz);
    eu.set(h, yawB, 0, 'YXZ');
    this.footQ[f].setFromEuler(eu);
  }

  // ------------------------------------------------------------ skeleton helpers
  chain(i) {
    const p = this.par[i];
    this.bp[i].copy(this.RO[i]).applyQuaternion(this.bq[p]).add(this.bp[p]);
    this.bq[i].multiplyQuaternions(this.bq[p], this.bones[i].quaternion);
  }
  setLocal(i, qw) { // set bone i so its B orientation is qw
    const p = this.par[i];
    this.bones[i].quaternion.copy(this.bq[p]).invert().multiply(qw);
    this.chain(i);
  }

  torso(P, cx, cz, cy, hipTarget) {
    const bones = this.bones;
    // pelvis
    eu.set(P[F.tilt] + 0.0, P[F.pYaw], 0, 'YXZ');
    this.bq[0].setFromEuler(eu);
    const sx = P[F.sx] + P[F.px] + cx, sz = P[F.sz] + P[F.pz] + cz;
    let y = hipTarget + cy;
    // leg reach limit
    const R = 0.745;
    for (let f = 0; f < 2; f++) {
      v[0].set(f ? -0.10 : 0.10, -0.02, 0).applyQuaternion(this.bq[0]);
      const hx = sx + v[0].x, hz = sz + v[0].z;
      const at = this.ankleT[f];
      const dh2 = (at.x - hx) * (at.x - hx) + (at.z - hz) * (at.z - hz);
      const lim = at.y + 0.02 + Math.sqrt(Math.max(R * R - dh2, 0.01));
      if (y + v[0].y > lim) y = lim - v[0].y;
    }
    this.pelvisY = y;
    this.bp[0].set(sx, y, sz);
    bones[0].position.copy(this.bp[0]); bones[0].quaternion.copy(this.bq[0]);
    // spine, chest
    const lean = P[F.lean], side = -P[F.side], cyaw = P[F.cYaw];
    eu.set(lean * 0.4, cyaw * 0.45, side * 0.4, 'YXZ'); bones[1].quaternion.setFromEuler(eu); this.chain(1);
    eu.set(lean * 0.6, cyaw * 0.55, side * 0.6, 'YXZ'); bones[2].quaternion.setFromEuler(eu); this.chain(2);
    // clavicles (shrug with hand height handled by caller via bones quaternion set earlier)
    this.chain(5); this.chain(9);
    this.chain(6); this.chain(10);
  }

  solve(ps, dt, ctx, name, a) {
    const P = this.P, bones = this.bones, bp = this.bp, bq = this.bq;
    const m = this.m;
    // foot targets
    this.footTarget(0); this.footTarget(1);
    // racket target in B
    const qT = q[0].setFromAxisAngle(AY, P[F.pYaw] + P[F.cYaw]);
    const grip = this.gripB;
    this.sweetOf(P, grip, this.qRack, this.shaftB);
    grip.addScaledVector(this.ctDelta, 1);
    // hand orientation D
    const qHD = q[1].copy(this.qRack).multiply(MqD_inv);
    // N hand target
    const lw = P[F.lw];
    v[1].set(P[F.lx] + P[F.sx], P[F.ly] - 0.75 * P[F.hip], P[F.lz] + P[F.sz]); // free N hand
    v[2].copy(grip).addScaledVector(this.shaftB, P[F.lg]); // grip point on handle
    const nTarget = v[3].copy(v[1]).lerp(v[2], lw);
    // elbow poles
    const poleD = v[4].set(0.6, -1 + 1.8 * P[F.eD], -0.35).applyQuaternion(qT);
    const poleN = v[5].set(-0.6, -1 + 1.8 * P[F.eN], -0.35).applyQuaternion(qT);

    const hipTarget = 0.86 - P[F.hip] - P[F.hipX] + this.bounce + this.jumpLift;
    // clavicle shrug for raised hands
    const shrD = clamp((grip.y - 1.45) / 0.9, 0, 1), shrN = clamp((nTarget.y - 1.45) / 0.9, 0, 1);
    bones[5].quaternion.setFromAxisAngle(v[6].set(0, 0, 1), 0.5 * shrD); bones[9].quaternion.setFromAxisAngle(v[6], -0.5 * shrN);

    // reach compensation (pelvis shift / crouch)
    let cx = 0, cz = 0, cy = 0;
    for (let it = 0; it < 3; it++) {
      this.torso(P, cx, cz, cy, hipTarget);
      v[7].set(0, DIM.palm, 0).applyQuaternion(qHD).add(grip); // wrist target D
      v[8].subVectors(v[7], bp[6]);
      const d = v[8].length();
      const lim = 0.64;
      let moved = false;
      if (d > lim) {
        const ex = d - lim; v[8].multiplyScalar(1 / d);
        cx += v[8].x * ex; cz += v[8].z * ex;
        cy = clamp(cy + clamp(v[8].y * ex * 0.8, -0.3, 0.08), -0.4, 0.09);
        cx = clamp(cx, -0.5, 0.5); cz = clamp(cz, -0.4, 0.5);
        moved = true;
      }
      if (!moved) break;
    }
    this.torso(P, cx, cz, cy, hipTarget);

    // dominant arm
    v[7].set(0, DIM.palm, 0).applyQuaternion(qHD).add(grip);
    solve2(bp[6], v[7], DIM.upperArm, DIM.foreArm, poleD, v[9], v[10]);
    this.armBones(6, 7, 8, v[9], v[10], qHD);

    // non dominant arm
    // orientation: forearm aligned (free) -> grip -> palm up
    const qGN = q[2].copy(this.qRack).multiply(MqN_inv);
    // palm-up basis in T
    q[3].setFromAxisAngle(AY, 0); v[11].set(0, 1, 0); v[12].set(0, 0, -1);
    basisQuatXY(q[4], v[11], v[12]);
    // free orientation: same as forearm direction (decided after IK); approximate with dominant-side shape
    v[13].set(0, DIM.palm, 0).applyQuaternion(lw > 0.5 ? qGN : q[4]).add(nTarget); // wrist
    // use blended orientation for wrist offset
    q[5].copy(q[4]).slerp(qGN, lw); // approx orientation for offset only
    v[13].set(0, DIM.palm, 0).applyQuaternion(q[5]).add(nTarget);
    solve2(bp[10], v[13], DIM.upperArm, DIM.foreArm, poleN, v[14], v[15]);
    // final N hand orientation
    v[16].subVectors(v[15], v[14]).normalize();
    q[6].setFromUnitVectors(DOWN, v[16]); // forearm-aligned
    q[7].copy(q[6]).slerp(qGN, lw).slerp(q[4], clamp(P[F.palm], 0, 1) * (1 - lw * 0.7));
    this.armBones(10, 11, 12, v[14], v[15], q[7]);

    // legs
    for (let f = 0; f < 2; f++) {
      const th = 13 + f * 3, sh = th + 1, ft = th + 2;
      const at = this.ankleT[f];
      // knee pole: forward along foot yaw, slightly out
      const yawB = this.m * wrap(this.feet[f].yaw - this.yaw);
      v[17].set(Math.sin(yawB) + (f ? -0.25 : 0.25), 0.0, Math.cos(yawB));
      this.chain(th);
      solve2(bp[th], at, DIM.thigh, DIM.shin, v[17], v[18], v[19]);
      v[20].subVectors(v[18], bp[th]).normalize();
      q[8].setFromUnitVectors(DOWN, v[20]); this.setLocal(th, q[8]);
      v[20].subVectors(v[19], v[18]).normalize();
      q[8].setFromUnitVectors(DOWN, v[20]); this.setLocal(sh, q[8]);
      this.chain(ft);
      // foot orientation from target (compensate clamped end: use planted target)
      this.setLocal(ft, this.footQ[f]);
    }

    // head / neck
    this.headLook(P, dt, ctx);

    // ponytail spring (cheap)
    this.pony(dt);

    // outputs: racket pos
    this.sweetB.copy(grip).addScaledVector(this.shaftB, DIM.headCY);
    this.tipB.copy(grip).addScaledVector(this.shaftB, DIM.racketLen - DIM.gripY);
    // toss anchor: palm top of N hand
    v[21].set(0.078, -0.07, 0).applyQuaternion(bq[12]).add(bp[12]);
    this.tossB.copy(v[21]);
    // pelvis squash from vertical velocity
    const hvy = (this.pelvisY - this.hipPrev) / dt; this.hipPrev = this.pelvisY;
    this.squash += (clamp(-hvy * 0.012, -0.05, 0.06) - this.squash) * (1 - Math.exp(-dt * 18));
  }

  armBones(ua, fa, hd, mid, end, qHand) {
    const bp = this.bp, bq = this.bq;
    v[16].subVectors(mid, bp[ua]).normalize();
    q[9].setFromUnitVectors(DOWN, v[16]); this.setLocal(ua, q[9]);
    v[16].subVectors(end, mid).normalize();
    q[9].setFromUnitVectors(DOWN, v[16]); this.setLocal(fa, q[9]);
    this.setLocal(hd, qHand);
  }

  headLook(P, dt, ctx) {
    const bp = this.bp, bq = this.bq, bones = this.bones;
    let yawT = 0, pitchT = 0, wt = 0;
    const bpos = ctx && ctx.ballPos;
    if (bpos && P[F.track] > 0) {
      const dx = bpos.x - this.px, dz = bpos.z - this.pz;
      const xo = dx * this.cosP - dz * this.sinP, zc = dx * this.sinP + dz * this.cosP;
      const xc = this.m * xo;
      const hy = 1.58;
      const yw = Math.atan2(xc - bp[4].x, zc - bp[4].z);
      const dh = Math.hypot(xc - bp[4].x, zc - bp[4].z);
      if (dh > 0.4) {
        yawT = wrap(yw - (P[F.pYaw] + P[F.cYaw]));
        pitchT = Math.atan2(-(bpos.y - hy), dh);
        wt = P[F.track] * (1 - sstep(1.9, 2.6, Math.abs(yawT)));
        yawT = clamp(yawT, -1.15, 1.15); pitchT = clamp(pitchT, -0.7, 0.3) * 0.8;
        this.hasBall = true;
      }
    }
    const k = 1 - Math.exp(-dt * 11);
    this.headYaw += (yawT * wt + P[F.hYaw] - this.headYaw) * k;
    this.headPitch += (pitchT * wt + P[F.hPitch] - this.headPitch) * k;
    const lean = P[F.lean] + P[F.tilt];
    const pr = this.headPitch - lean * 0.85;
    eu.set(pr * 0.4, this.headYaw * 0.4, -P[F.side] * -0.0, 'YXZ'); bones[3].quaternion.setFromEuler(eu); this.chain(3);
    eu.set(pr * 0.6, this.headYaw * 0.6, 0, 'YXZ'); bones[4].quaternion.setFromEuler(eu); this.chain(4);
    this.gazeYaw = this.headYaw;
  }

  pony(dt) {
    // lag behind head motion: spring on x-rotation (swing) and z
    const tgtA = clamp(-this.vbz * 0.045 - this.headPitch * 0.3, -0.5, 0.5) + Math.sin(this.t * 3.1) * 0.03;
    const tgtB = clamp(this.vbx * 0.05, -0.4, 0.4);
    const kk = 90, cc = 11;
    this.poniVA += ((tgtA - this.poniA) * kk - this.poniVA * cc) * dt; this.poniA += this.poniVA * dt;
    this.poniVB += ((tgtB - this.poniB) * kk - this.poniVB * cc) * dt; this.poniB += this.poniVB * dt;
    eu.set(this.poniA * 0.7, 0, this.poniB * 0.7, 'YXZ'); this.bones[19].quaternion.setFromEuler(eu); this.chain(19);
    eu.set(this.poniA * 0.5, 0, this.poniB * 0.5, 'YXZ'); this.bones[20].quaternion.setFromEuler(eu); this.chain(20);
  }

  // ------------------------------------------------------------ face
  updateFace(ps, a, name, dt) {
    const f = this.face, P = this.P;
    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blinkPhase < 0) { this.blinkPhase = 0; }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      f.blink = this.blinkPhase < 0.045 ? 1 : this.blinkPhase < 0.1 ? 2 : this.blinkPhase < 0.15 ? 1 : 0;
      if (this.blinkPhase >= 0.15) { this.blinkPhase = -1; this.blinkT = 1.6 + 3.2 * frac(Math.sin(this.t * 12.9898 + 3.1) * 43758.5453); f.blink = 0; }
    }
    let mouth = 'neutral', brow = 'neutral';
    const emote = a.emote;
    const ph = this.phase;
    const stamina = ps.stamina != null ? ps.stamina : 1;
    if (name === 'celebrate') { mouth = Math.sin(this.stateT * 9) > 0 ? 'shout' : 'grin'; brow = 'up'; }
    else if (name === 'dejected') { mouth = 'frown'; brow = 'sad'; }
    else if ((name === 'swing' && ph > 0.3 && ph < 0.72) || ((name === 'serve') && ph > 0.5 && ph < 0.78)) { mouth = P[F.eff] > 0.5 || name === 'serve' ? 'shout' : 'effort'; brow = 'angry'; }
    else if (emote === 'happy') { mouth = 'grin'; brow = 'up'; }
    else if (emote === 'frustrated') { mouth = 'frown'; brow = 'angry'; }
    else if (emote === 'focused') { mouth = 'neutral'; brow = 'angry'; }
    else if (name === 'run' && this.spd01 > 0.55) { mouth = 'open'; brow = 'angry'; }
    else if (name === 'brake') { mouth = 'effort'; brow = 'angry'; }
    else if (stamina < 0.25) { mouth = 'pant'; brow = 'sad'; }
    else if (name === 'ready' || name === 'split' || name === 'shuffle') { mouth = 'neutral'; brow = 'angry'; if (this.stateT > 0) { mouth = 'smile'; brow = 'neutral'; } }
    else if (name === 'walk') { mouth = 'smile'; }
    f.mouth = mouth; f.brow = brow;
    f.gx = clamp(Math.round((this.hasBall ? 0 : 0) + 0), -1, 1);
    f.gy = 0;
    if (name === 'dejected') f.gy = 1;
    else if (this.headPitch < -0.25) f.gy = -1;
  }
}
