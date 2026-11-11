// Procedural animation: pose library blending, foot planting, two-bone IK, strokes, locomotion, emotes.
// All maths run in the canonical body frame B (rig-local: +z forward, +x dominant side); no per-frame allocations.
import * as THREE from 'three';
import { BI, NB, PAR, makeBones, RACKET } from './dims.js';
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
const mA = new M4(), mB = new M4(), mC = new M4(), sV = new V3(), uQ = new Q();
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

export const LIMB = [BI.uaD, BI.faD, BI.handD, BI.uaN, BI.faN, BI.handN, BI.thighD, BI.shinD, BI.footD, BI.thighN, BI.shinN, BI.footN];
const SPRINGS = [ // secondary-motion chains: bones, gain, stiffness (rad/s), damping ratio, share of the free-hang angle, frame (0 head, 1 pelvis)
  { b: [BI.ponyA1, BI.ponyA2, BI.ponyA3], gain: 0.85, w: [15, 12, 10], z: 0.32, sh: [0.45, 0.4, 0.35], fr: 0 },
  { b: [BI.tailL1, BI.tailL2, BI.tailL3], gain: 0.8, w: [14, 11, 9], z: 0.32, sh: [0.4, 0.4, 0.35], fr: 0 },
  { b: [BI.tailR1, BI.tailR2, BI.tailR3], gain: 0.8, w: [14, 11, 9], z: 0.32, sh: [0.4, 0.4, 0.35], fr: 0 },
  { b: [BI.lng1, BI.lng2, BI.lng3], gain: 0.7, w: [13, 11, 9], z: 0.4, sh: [0.35, 0.35, 0.3], fr: 0 },
  { b: [BI.fringe], gain: 0.35, w: [26], z: 0.4, sh: [1], fr: 0 },
  { b: [BI.ahoge], gain: 1.3, w: [19], z: 0.14, sh: [1], fr: 0 },
  { b: [BI.band1, BI.band2], gain: 0.9, w: [18, 14], z: 0.3, sh: [0.5, 0.5], fr: 0 },
  { b: [BI.skirt], gain: 0.32, w: [17], z: 0.4, sh: [1], fr: 1 },
];

export class Animator {
  constructor(bones, racketNode, D) {
    this.bones = bones; this.racketNode = racketNode;
    this.bp = bones.map(() => new V3()); this.bq = bones.map(() => new Q());
    this.Dm = bones.map(() => new M4()); this.bsy = new Float32Array(bones.length).fill(1); this.manual = new Uint8Array(bones.length);
    for (const i of LIMB) { this.manual[i] = 1; bones[i].matrixAutoUpdate = false; }
    this.setDims(D);
    this.Pp = new Float32Array(NF); this.Pp = new Float32Array(NF); this.P = new Float32Array(NF); this.Pn = new Float32Array(NF); this.Pf = new Float32Array(NF); this.P5 = new Float32Array(NF);
    this.feet = [new Foot(), new Foot()];
    this.spot = [{ x: 0.27, z: 0, yaw: 0.1 }, { x: -0.27, z: 0.05, yaw: -0.1 }];
    this.mode = 'stance'; this.thr = 0.17;
    this.init = false; this.m = -1; this.yaw = 0; this.cosP = 1; this.sinP = 0;
    this.px = 0; this.pz = 0; this.vx = 0; this.vz = 0; this.vbx = 0; this.vbz = 0; this.speedW = 0;
    this.key = -1; this.stateT = 0; this.fadeT = 1; this.fadeDur = 0.15; this.t = 0;
    this.g = 0; this.gPrev = 0; this.gInit = false; this.Lc = 2.4; this.ux = 0; this.uz = 1; this.ownG = 0;
    this.bounce = 0; this.simY = 0; this.jumpLift = 0;
    this.ctDelta = new V3(); this.ctW = 0; this.def = null; this.cp = 0.5; this.phase = 0;
    this.headYaw = 0; this.headPitch = 0; this.hasBall = false; this.gazeX = 0; this.gazeY = 0;
    // outputs (B frame)
    this.gripB = new V3(); this.sweetB = new V3(); this.tipB = new V3(); this.tossB = new V3(); this.shaftB = new V3();
    this.qRack = new Q();
    this.blinkT = 2; this.blinkPhase = -1; this.blink = 0; this.squash = 0; this.hipPrev = this.D.hip0; this.sqPose = 0;
    this.sA = new Float32Array(bones.length * 2); this.sV = new Float32Array(bones.length * 2); // secondary springs (x, z)
    this.hPos = new V3(); this.hVel = new V3(); this.hAcc = new V3(); this.pPos = new V3(); this.pVel = new V3(); this.pAcc = new V3(); this.hairInit = false;
    this.ts = new Float32Array(10); this.tv = new Float32Array(10); this.tsInit = false; // torso springs (pYaw, cYaw, lean, side, tilt)
    this.ankleT = [new V3(), new V3()]; this.footQ = [new Q(), new Q()];
    this.reachFrac = 0; this.stretchD = 1; this.stretchN = 1; this.legS = [1, 1];
    this.stateName = 'ready';
    this.fp = { open: 1, kind: 0, browY: 0, browA: 0, mouth: 'smile', mo: 0, blush: 0.25, gx: 0, gy: 0, sweat: false };
    this.fpT = { open: 1, kind: 0, browY: 0, browA: 0, mouth: 'smile', mo: 0, blush: 0.25, sweat: false };
    this.exprName = 'neutral'; this.exprT = 0;
    this.breath = 0;
    this.P.set(BASE);
  }

  setDims(D) {
    this.D = D;
    const B = makeBones(D);
    this.RO = B.map((b) => new V3(b[2], b[3], b[4]));
    this.par = PAR;
    this.kR = D.racketK; this.kY = D.kY; this.kXZ = D.kXZ;
    this.chain0 = true;
    for (let i = 0; i < this.bones.length; i++) { this.bq[i].identity(); this.bsy[i] = 1; }
    this.feetInit = false;
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
    this.breath = Math.sin(this.t * 2.4) * (1 - 0.9 * spd01);
    this.evalState(this.Pn, name, shot, a, ps, spd01, dt, ctx);

    // crossfade
    const P = this.P;
    if (this.fadeT < this.fadeDur) {
      const u = this.fadeT / this.fadeDur, e = u * u * (3 - 2 * u);
      for (let i = 0; i < NF; i++) P[i] = this.Pf[i] + (this.Pn[i] - this.Pf[i]) * e;
    } else P.set(this.Pn);
    this.smoothTorso(dt);

    // feet
    if (tele || !this.feetInit) this.resetFeet();
    this.updateFeet(dt, name, spd01);

    // body, IK, head, face
    this.jumpLift = this.simY + P[F.jmp] * this.D.jmpK;
    this.solve(ps, dt, ctx, name, a);
    this.updateFace(ps, a, name, dt);
  }

  // ------------------------------------------------------------ gait phase
  updateGait(a, name, stepDist, dt) {
    const loco = name === 'run' || name === 'walk' || name === 'shuffle' || name === 'backpedal';
    const simG = typeof a.gait === 'number';
    const k = this.D.gaitK;
    if (loco) {
      const def = name === 'run' ? 2.5 : name === 'walk' ? 1.5 : name === 'shuffle' ? 1.35 : 1.6;
      if (simG) {
        let dg = 0;
        if (this.gInit) {
          dg = a.gait - this.gPrev; if (dg < -0.5) dg += 1; if (dg > 0.5) dg -= 1;
          if (dg > 1e-4 && stepDist > 1e-4) { const est = clamp(stepDist / dg, 0.8, 4); this.Lc += (est - this.Lc) * 0.08; }
        }
        this.gPrev = a.gait; this.gInit = true;
        this.ownG += Math.max(0, dg) * k; this.g = frac(this.ownG);
        if (a.strideLen > 0.2 && this.Lc === 2.4) this.Lc = clamp(a.strideLen * 2, 0.8, 4);
      } else {
        this.ownG += stepDist / def * k; this.g = frac(this.ownG); this.Lc = def;
      }
      this.LcE = this.Lc / k;
    } else { this.gInit = false; this.LcE = this.Lc / k; }
  }

  // ------------------------------------------------------------ pose evaluation per state
  setSpots(dx, dz, dy, nx, nz, ny) {
    const s = this.spot;
    const k = this.kXZ;
    s[0].x = dx * k; s[0].z = dz * k; s[0].yaw = dy; s[1].x = nx * k; s[1].z = nz * k; s[1].yaw = ny;
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
        // alive idle: toe-bounce, weight shifting from foot to foot, racket sway, slow breathing
        const b = Math.sin(t * 4.4), sw = Math.sin(t * 1.35), sw2 = Math.sin(t * 0.7 + 1.3);
        P[F.hip] += 0.016 * b + 0.01 * Math.max(0, sw2); P[F.hy] += 0.014 * Math.sin(t * 4.4 + 1) + 0.01 * sw;
        P[F.sx] = 0.022 * sw; P[F.side] = 0.05 * sw; P[F.tilt] += 0.015 * sw2; P[F.pYaw] = 0.05 * sw2; P[F.cYaw] = -0.04 * sw2;
        P[F.hx] += 0.02 * Math.sin(t * 1.9); P[F.hz] += 0.012 * Math.sin(t * 2.3 + 0.5); P[F.lz] += 0.015 * Math.sin(t * 2.1);
        P[F.lean] += 0.01 * b; this.bounce = 0.012 * b;
        this.breath = Math.sin(t * 2.6);
        const pr = a.prep || 0;
        if (pr > 0.01) this.applyPrep(P, pr, a.nextSide || a.side);
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
        const u = frac(st / 1.0);
        const jumpN = st < 3.2 ? Math.abs(Math.sin(u * Math.PI)) : 0;
        this.setSpots(0.22, 0, 0.1, -0.22, 0, -0.1);
        // crouch before each jump, big stretch in the air
        const crouch = st < 3.2 ? Math.max(0, Math.sin((u - 0.82) * Math.PI / 0.18 * 0.5) * (u > 0.82 ? 1 : 0)) : 0;
        P[F.jmp] = 0.17 * jumpN; P[F.hip] = 0.06 + 0.1 * (1 - jumpN) + 0.06 * crouch; P[F.lean] = -0.1 + 0.08 * (1 - jumpN);
        const pump = Math.sin(st * 9.5) * 0.5 + 0.5;
        P[F.hx] = 0.30; P[F.hy] = 1.72 + 0.12 * pump; P[F.hz] = 0.1; P[F.ax] = 0.15; P[F.ay] = 0.85; P[F.az] = 0.2; P[F.eD] = 0.95;
        P[F.lw] = 0; P[F.lx] = -0.3; P[F.ly] = 1.52 + 0.2 * (1 - pump); P[F.lz] = 0.22; P[F.eN] = 0.95;
        P[F.pYaw] = 0.22 * Math.sin(st * 4.7); P[F.cYaw] = -0.14 * Math.sin(st * 4.7); P[F.hPitch] = -0.32; P[F.track] = 0.2; P[F.eff] = 1;
        P[F.side] = 0.08 * Math.sin(st * 4.7); P[F.tilt] = -0.08;
        this.sqPose = 0.03 * crouch - 0.04 * jumpN;
        this.thr = 0.3;
        break;
      }
      case 'dejected': {
        const br = Math.sin(t * 2.0), sigh = Math.exp(-Math.pow((st - 0.6) / 0.35, 2));
        this.setSpots(0.19, 0, 0.05, -0.19, 0.04, -0.05);
        const slump = 1 - Math.exp(-st * 3.0);
        P[F.hip] = 0.05 + 0.04 * slump; P[F.lean] = (0.3 + 0.12 * sigh) * slump + 0.02 * br; P[F.tilt] = 0.14 * slump; P[F.hPitch] = 0.6 * slump; P[F.track] = 0;
        P[F.hYaw] = 0.25 * Math.sin(st * 2.6) * Math.exp(-st * 0.4);
        P[F.hx] = 0.28; P[F.hy] = 0.62; P[F.hz] = 0.08; P[F.ax] = 0.15; P[F.ay] = -1; P[F.az] = 0.2; P[F.nx] = 1; P[F.eD] = 0.1;
        P[F.lw] = 0; P[F.lx] = -0.27; P[F.ly] = 0.62; P[F.lz] = 0.06; P[F.eN] = 0.1; P[F.side] = 0.05; this.bounce = 0.006 * br - 0.02 * sigh;
        P[F.pYaw] = 0.12; P[F.cYaw] = 0.06; this.thr = 0.3;
        this.breath = sigh * 2;
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
    v[22].copy(v[20]).addScaledVector(v[21], RACKET.headCY * this.kR);
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

  // racket frame from a pose array: grip (B), orientation (B) and shaft (B). Tables are authored for a 1.75 m human and
  // retargeted to the style's proportions (kXZ / kY); the contact correction then pulls the racket to the real ball.
  sweetOf(P, grip, qOut, shaft) {
    grip.set(P[F.hx] * this.kXZ + P[F.sx], (P[F.hy] - 0.75 * P[F.hip]) * this.kY, P[F.hz] * this.kXZ + P[F.sz]);
    v[18].set(P[F.ax], P[F.ay], P[F.az]); v[19].set(P[F.nx], P[F.ny], P[F.nz]);
    basisQuat(qOut, v[18], v[19]);
    shaft.set(0, 1, 0).applyQuaternion(qOut);
  }

  // anticipation: blend the racket-back (take-back) pose in while the ball approaches
  applyPrep(P, pr, side) {
    const def = strokeFor('topspin', side === 'bh' ? 'bh' : 'fh');
    evalTable(def.tbl, 0.2, this.Pp);
    const w = Math.min(1, pr) * 0.85, w2 = w * 0.7;
    for (const k of ['pYaw', 'cYaw', 'hx', 'hy', 'hz', 'ax', 'ay', 'az', 'nx', 'ny', 'nz', 'lw', 'lg', 'lx', 'ly', 'lz', 'eD', 'eN']) P[F[k]] = lerp(P[F[k]], this.Pp[F[k]], w);
    P[F.lean] = lerp(P[F.lean], this.Pp[F.lean], w2); P[F.hip] = lerp(P[F.hip], this.Pp[F.hip], w2);
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
          const q4 = this.LcE * 0.25, rem = this.LcE * 0.5 * (1 - su);
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
    const ft = this.feet[f], D = this.D;
    const dx = ft.x - this.px, dz = ft.z - this.pz;
    const xo = dx * this.cosP - dz * this.sinP, zc = dx * this.sinP + dz * this.cosP;
    const yawB = this.m * wrap(ft.yaw - this.yaw);
    const out = this.ankleT[f];
    const h = ft.pitch;
    let ay = D.ankleH + ft.y;
    let fz = 0;
    if (h > 0) { const L = 0.17 * D.shoeK; ay += L * Math.sin(h); fz = L * (1 - Math.cos(h)); }
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
  setLocal(i, qw) { // auto bone i so its B orientation is qw
    const p = this.par[i];
    this.bones[i].quaternion.copy(this.bq[p]).invert().multiply(qw);
    this.chain(i);
  }
  // limb bones are driven by explicit matrices so they can stretch along their own axis without shearing children
  placeLimb(i, pos, qw, sy) {
    const bp = this.bp[i];
    if (bp !== pos) bp.copy(pos);
    this.bq[i].copy(qw); this.bsy[i] = sy;
    const k = sy > 1 ? 1 / Math.sqrt(sy) : 1;
    this.Dm[i].compose(bp, qw, sV.set(k, sy, k));
    const p = this.par[i];
    if (this.manual[p]) mB.copy(this.Dm[p]); else mB.compose(this.bp[p], this.bq[p], sV.set(1, 1, 1));
    mC.copy(mB).invert().multiply(this.Dm[i]);
    const b = this.bones[i];
    b.matrix.copy(mC); b.matrixWorldNeedsUpdate = true;
  }

  torso(P, cx, cz, cy, hipTarget) {
    const bones = this.bones, D = this.D;
    eu.set(P[F.tilt], P[F.pYaw], 0, 'YXZ');
    this.bq[0].setFromEuler(eu);
    const sx = P[F.sx] + P[F.px] + cx, sz = P[F.sz] + P[F.pz] + cz;
    let y = hipTarget + cy;
    const R = (D.thigh + D.shin) * D.legStretch * 0.975;
    for (let f = 0; f < 2; f++) {
      v[0].set(f ? -D.legX : D.legX, -D.hipOff, 0).applyQuaternion(this.bq[0]);
      const hx = sx + v[0].x, hz = sz + v[0].z;
      const at = this.ankleT[f];
      const dh2 = (at.x - hx) * (at.x - hx) + (at.z - hz) * (at.z - hz);
      const lim = at.y + 0.02 + Math.sqrt(Math.max(R * R - dh2, 0.01));
      if (y + v[0].y > lim) y = lim - v[0].y;
    }
    this.pelvisY = y;
    this.bp[0].set(sx, y, sz);
    bones[0].position.copy(this.bp[0]); bones[0].quaternion.copy(this.bq[0]);
    const lean = P[F.lean], side = -P[F.side], cyaw = P[F.cYaw];
    eu.set(lean * 0.4, cyaw * 0.45, side * 0.4, 'YXZ'); bones[1].quaternion.setFromEuler(eu); this.chain(1);
    eu.set(lean * 0.6, cyaw * 0.55, side * 0.6, 'YXZ'); bones[2].quaternion.setFromEuler(eu); this.chain(2);
    this.chain(5); this.chain(9);
    this.chain(6); this.chain(10);
  }

  solve(ps, dt, ctx, name, a) {
    const P = this.P, bones = this.bones, bp = this.bp, bq = this.bq, D = this.D;
    const kXZ = this.kXZ, kY = this.kY, kR = this.kR;
    this.footTarget(0); this.footTarget(1);
    const qT = q[0].setFromAxisAngle(AY, P[F.pYaw] + P[F.cYaw]);
    const grip = this.gripB;
    this.sweetOf(P, grip, this.qRack, this.shaftB);
    grip.addScaledVector(this.ctDelta, 1);
    const qHD = q[1].copy(this.qRack).multiply(MqD_inv);
    const lw = P[F.lw];
    v[1].set(P[F.lx] * kXZ + P[F.sx], (P[F.ly] - 0.75 * P[F.hip]) * kY, P[F.lz] * kXZ + P[F.sz]); // free N hand
    v[2].copy(grip).addScaledVector(this.shaftB, P[F.lg] * kR);                                       // grip point on handle
    const nTarget = v[3].copy(v[1]).lerp(v[2], lw);
    const poleD = v[4].set(0.6, -1 + 1.8 * P[F.eD], -0.35).applyQuaternion(qT);
    const poleN = v[5].set(-0.6, -1 + 1.8 * P[F.eN], -0.35).applyQuaternion(qT);

    const hipTarget = D.hip0 - (P[F.hip] + P[F.hipX]) * kY + this.bounce + this.jumpLift;
    // clavicle shrug for raised hands + breathing
    const hsh = D.shoulderY;
    const shrD = clamp((grip.y - hsh * 1.1) / 0.9, 0, 1), shrN = clamp((nTarget.y - hsh * 1.1) / 0.9, 0, 1);
    bones[5].quaternion.setFromAxisAngle(v[6].set(0, 0, 1), 0.5 * shrD); bones[9].quaternion.setFromAxisAngle(v[6], -0.5 * shrN);
    const br = 0.0035 * this.breath;
    this.RO[5].y = this.RO[9].y = D.clavUp + br; bones[5].position.y = bones[9].position.y = D.clavUp + br;

    // reach compensation (pelvis shift / crouch)
    let cx = 0, cz = 0, cy = 0;
    const lim = (D.ua + D.fa) * 0.93;
    for (let it = 0; it < 3; it++) {
      this.torso(P, cx, cz, cy, hipTarget);
      v[7].set(0, D.palm, 0).applyQuaternion(qHD).add(grip);
      v[8].subVectors(v[7], bp[6]);
      const d = v[8].length();
      let moved = false;
      if (d > lim) {
        const ex = d - lim; v[8].multiplyScalar(1 / d);
        cx += v[8].x * ex; cz += v[8].z * ex;
        cy = clamp(cy + clamp(v[8].y * ex * 0.8, -0.3, 0.08 * (D.ua + D.fa) / 0.7), -0.4, 0.09);
        cx = clamp(cx, -0.5, 0.5); cz = clamp(cz, -0.4, 0.5);
        moved = true;
      }
      if (!moved) break;
    }
    this.torso(P, cx, cz, cy, hipTarget);

    // dominant arm (may stretch a little: squash & stretch cartoon reach)
    v[7].set(0, D.palm, 0).applyQuaternion(qHD).add(grip);
    let L = D.ua + D.fa;
    let sD = clamp(v[7].distanceTo(bp[6]) / (L * 0.985), 1, D.stretchMax);
    solve2(bp[6], v[7], D.ua * sD, D.fa * sD, poleD, v[9], v[10]);
    this.armLimb(6, 7, 8, v[9], v[10], qHD, sD);
    this.stretchD = sD;

    // non dominant arm
    const qGN = q[2].copy(this.qRack).multiply(MqN_inv);
    v[11].set(0, 1, 0); v[12].set(0, 0, -1);
    basisQuatXY(q[4], v[11], v[12]);                     // palm-up
    q[5].copy(q[4]).slerp(qGN, lw);
    v[13].set(0, D.palm, 0).applyQuaternion(q[5]).add(nTarget);
    let sN = clamp(v[13].distanceTo(bp[10]) / (L * 0.985), 1, D.stretchMax);
    solve2(bp[10], v[13], D.ua * sN, D.fa * sN, poleN, v[14], v[15]);
    v[16].subVectors(v[15], v[14]).normalize();
    q[6].setFromUnitVectors(DOWN, v[16]);
    q[7].copy(q[6]).slerp(qGN, lw).slerp(q[4], clamp(P[F.palm], 0, 1) * (1 - lw * 0.7));
    this.armLimb(10, 11, 12, v[14], v[15], q[7], sN);
    this.stretchN = sN;

    // legs
    for (let f = 0; f < 2; f++) {
      const th = 13 + f * 3, sh = th + 1, ft = th + 2;
      const at = this.ankleT[f];
      const yawB = this.m * wrap(this.feet[f].yaw - this.yaw);
      v[17].set(Math.sin(yawB) + (f ? -0.25 : 0.25), 0.0, Math.cos(yawB));
      this.chain(th);
      const lL = D.thigh + D.shin;
      const sl = clamp(bp[th].distanceTo(at) / (lL * 0.985), 1, D.legStretch);
      this.legS[f] = sl;
      solve2(bp[th], at, D.thigh * sl, D.shin * sl, v[17], v[18], v[19]);
      v[20].subVectors(v[18], bp[th]).normalize();
      q[8].setFromUnitVectors(DOWN, v[20]); this.placeLimb(th, bp[th], q[8], sl);
      v[20].subVectors(v[19], v[18]).normalize();
      q[8].setFromUnitVectors(DOWN, v[20]); this.placeLimb(sh, v[18], q[8], sl);
      this.placeLimb(ft, v[19], this.footQ[f], 1);
    }

    this.headLook(P, dt, ctx);
    this.hairSim(dt);

    // outputs: racket pos
    this.sweetB.copy(grip).addScaledVector(this.shaftB, RACKET.headCY * kR);
    this.tipB.copy(grip).addScaledVector(this.shaftB, (RACKET.len - RACKET.gripY) * kR);
    v[21].set(0.078 * D.handK, -0.07, 0).applyQuaternion(bq[12]).add(bp[12]);
    this.tossB.copy(v[21]);
    // pelvis squash from vertical velocity (not while the racket must hit the ball)
    const hvy = (this.pelvisY - this.hipPrev) / dt; this.hipPrev = this.pelvisY;
    this.squash += (clamp(-hvy * 0.012, -0.05, 0.06) * D.sqK * (1 - this.ctW) - this.squash) * (1 - Math.exp(-dt * 18));
  }

  armLimb(ua, fa, hd, mid, end, qHand, s) {
    const bp = this.bp;
    v[16].subVectors(mid, bp[ua]).normalize();
    q[9].setFromUnitVectors(DOWN, v[16]); this.placeLimb(ua, bp[ua], q[9], s);
    v[16].subVectors(end, mid).normalize();
    q[9].setFromUnitVectors(DOWN, v[16]); this.placeLimb(fa, mid, q[9], s);
    this.placeLimb(hd, end, qHand, 1);
  }

  headLook(P, dt, ctx) {
    const bp = this.bp, bones = this.bones, D = this.D;
    let yawT = 0, pitchT = 0, wt = 0;
    const bpos = ctx && ctx.ballPos;
    if (bpos && P[F.track] > 0) {
      const dx = bpos.x - this.px, dz = bpos.z - this.pz;
      const xo = dx * this.cosP - dz * this.sinP, zc = dx * this.sinP + dz * this.cosP;
      const xc = this.m * xo;
      const hy = bp[4].y + D.headH * 0.45;
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
    const HF = 0.72; // share of the look direction taken by the head (eyes do the rest)
    const k = 1 - Math.exp(-dt * 11);
    this.headYaw += (yawT * wt * HF + P[F.hYaw] - this.headYaw) * k;
    this.headPitch += (pitchT * wt * HF + P[F.hPitch] - this.headPitch) * k;
    const kg = 1 - Math.exp(-dt * 26);
    this.gazeX += (clamp(yawT * wt * (1 - HF) / 0.4, -1, 1) - this.gazeX) * kg;
    this.gazeY += (clamp(pitchT * wt * (1 - HF) / 0.25 + (P[F.hPitch] > 0.3 ? 0.6 : 0), -1, 1) - this.gazeY) * kg;
    const lean = P[F.lean] + P[F.tilt];
    const pr = this.headPitch - lean * 0.85;
    // head leads the movement: extra tilt into the turn
    eu.set(pr * 0.4, this.headYaw * 0.4, -P[F.side] * 0.15, 'YXZ'); bones[3].quaternion.setFromEuler(eu); this.chain(3);
    eu.set(pr * 0.6, this.headYaw * 0.6, -P[F.side] * 0.2, 'YXZ'); bones[4].quaternion.setFromEuler(eu); this.chain(4);
  }

  // ------------------------------------------------------------ secondary motion (hair, ahoge, headband tails, skirt)
  hairSim(dt) {
    const bp = this.bp, bq = this.bq, bones = this.bones, m = this.m;
    const c = this.cosP, s = this.sinP;
    const upd = (idx, pos, vel, acc, out) => {
      // world position of a B-frame point
      const wx = this.px + m * bp[idx].x * c + bp[idx].z * s, wz = this.pz - m * bp[idx].x * s + bp[idx].z * c, wy = bp[idx].y;
      if (!this.hairInit) { pos.set(wx, wy, wz); vel.set(0, 0, 0); acc.set(0, 0, 0); return; }
      const vx = (wx - pos.x) / dt, vy = (wy - pos.y) / dt, vz = (wz - pos.z) / dt;
      let ax = (vx - vel.x) / dt, ay = (vy - vel.y) / dt, az = (vz - vel.z) / dt;
      const am = Math.hypot(ax, ay, az);
      if (am > 60) { const k = 60 / am; ax *= k; ay *= k; az *= k; }
      const kf = 1 - Math.exp(-dt * 30);
      acc.x += (ax - acc.x) * kf; acc.y += (ay - acc.y) * kf; acc.z += (az - acc.z) * kf;
      pos.set(wx, wy, wz); vel.set(vx, vy, vz);
      void out;
    };
    upd(4, this.hPos, this.hVel, this.hAcc);
    upd(0, this.pPos, this.pVel, this.pAcc);
    this.hairInit = true;
    const sub = Math.max(1, Math.ceil(dt / 0.009)), h = dt / sub;
    for (let fr = 0; fr < 2; fr++) {
      const ac = fr ? this.pAcc : this.hAcc, qb = fr ? bq[0] : bq[4];
      // acceleration world -> B frame -> local frame of the anchor bone
      const axB = m * (ac.x * c - ac.z * s), azB = ac.x * s + ac.z * c;
      uQ.copy(qb).invert();
      v[0].set(axB, ac.y, azB).applyQuaternion(uQ);
      v[1].set(0, -9.81, 0).applyQuaternion(uQ);
      v[1].sub(v[0]);                                          // effective gravity in the local frame
      const tx = Math.atan2(-v[1].z, -v[1].y), tz = Math.atan2(v[1].x, -v[1].y);
      const hy = Math.max(-v[1].y, 0.5);
      void hy;
      for (let ci = 0; ci < SPRINGS.length; ci++) {
        const S = SPRINGS[ci];
        if (S.fr !== fr) continue;
        for (let j = 0; j < S.b.length; j++) {
          const bi = S.b[j], w = S.w[j], z = S.z;
          const gx = clamp(tx * S.gain * S.sh[j], -1.0, 1.0) + 0.02 * Math.sin(this.t * 1.7 + bi);
          const gz = clamp(tz * S.gain * S.sh[j], -1.0, 1.0) + 0.02 * Math.sin(this.t * 1.3 + bi * 2);
          for (let n = 0; n < sub; n++) {
            this.sV[bi * 2] += ((gx - this.sA[bi * 2]) * w * w - 2 * z * w * this.sV[bi * 2]) * h; this.sA[bi * 2] += this.sV[bi * 2] * h;
            this.sV[bi * 2 + 1] += ((gz - this.sA[bi * 2 + 1]) * w * w - 2 * z * w * this.sV[bi * 2 + 1]) * h; this.sA[bi * 2 + 1] += this.sV[bi * 2 + 1] * h;
          }
          eu.set(clamp(this.sA[bi * 2], -1.3, 1.3), 0, clamp(this.sA[bi * 2 + 1], -1.3, 1.3), 'XYZ');
          bones[bi].quaternion.setFromEuler(eu);
        }
      }
    }
  }

  // smoothed (underdamped) torso fields give overshoot and follow-through on twists and leans
  smoothTorso(dt) {
    const P = this.P, ids = [F.pYaw, F.cYaw, F.lean, F.side, F.tilt];
    if (!this.tsInit) { for (let i = 0; i < 5; i++) { this.ts[i] = P[ids[i]]; this.tv[i] = 0; } this.tsInit = true; }
    const w = 30, z = 0.58, sub = Math.max(1, Math.ceil(dt / 0.008)), h = dt / sub;
    for (let i = 0; i < 5; i++) {
      for (let n = 0; n < sub; n++) { this.tv[i] += ((P[ids[i]] - this.ts[i]) * w * w - 2 * z * w * this.tv[i]) * h; this.ts[i] += this.tv[i] * h; }
      P[ids[i]] = this.ts[i];
    }
  }

  // ------------------------------------------------------------ face / expression
  updateFace(ps, a, name, dt) {
    const f = this.fp, T = this.fpT, P = this.P;
    // blink (with the occasional double blink)
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blinkPhase < 0) this.blinkPhase = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      const u = this.blinkPhase / 0.16;
      this.blink = u >= 1 ? 0 : Math.sin(u * Math.PI);
      if (u >= 1) {
        this.blinkPhase = -1; this.blink = 0;
        const r = frac(Math.sin(this.t * 12.9898 + 3.1) * 43758.5453);
        this.blinkT = r < 0.18 ? 0.12 : 1.8 + 3.4 * frac(r * 7.3);
      }
    }
    let ex = 'neutral';
    const emote = a.emote, ph = this.phase, st = this.stateT;
    const stamina = ps.stamina != null ? ps.stamina : 1;
    if (name === 'celebrate') ex = Math.sin(st * 8.5) > 0.2 ? 'cheer' : 'happy';
    else if (name === 'dejected') ex = 'sad';
    else if (name === 'swing' && ph > this.cp - 0.2 && ph < this.cp + 0.16) ex = (a.shot === 'flat' || a.shot === 'smash' || P[F.eff] > 0.5) ? 'shout' : 'effort';
    else if ((name === 'serve') && ph > 0.55 && ph < 0.8) ex = 'shout';
    else if (name === 'toss' || (name === 'serve' && ph < 0.55)) ex = 'focus';
    else if (name === 'swing') ex = 'focus';
    else if (emote === 'happy') ex = 'happy';
    else if (emote === 'frustrated') ex = 'frustrated';
    else if (emote === 'focused') ex = 'focus';
    else if (stamina < 0.22) ex = 'pant';
    else if (name === 'run' && this.spd01 > 0.55) ex = 'run';
    else if (name === 'brake') ex = 'effort';
    else if (name === 'ready' || name === 'split' || name === 'shuffle') ex = (a.prep || 0) > 0.3 ? 'focus' : 'neutral';
    else if (name === 'walk') ex = 'neutral';
    if (this.forceExpr) ex = this.forceExpr;
    if (ex !== this.exprName) { this.exprName = ex; this.exprT = 0; }
    this.exprT += dt;
    const E = EXPR[ex];
    T.open = E.open; T.kind = E.kind; T.browY = E.browY; T.browA = E.browA; T.mouth = E.mouth; T.mo = E.mo; T.blush = E.blush; T.sweat = !!E.sweat;
    const k = 1 - Math.exp(-dt * 20);
    f.open += (T.open - f.open) * k; f.browY += (T.browY - f.browY) * k; f.browA += (T.browA - f.browA) * k; f.mo += (T.mo - f.mo) * k; f.blush += (T.blush - f.blush) * k;
    f.kind = T.kind; f.mouth = T.mouth; f.sweat = T.sweat;
    f.gx = this.gazeX; f.gy = this.gazeY;
    this.fx = f;
    this.blinkOpen = 1 - this.blink;
  }
}

const EXPR = {
  neutral: { open: 1, kind: 0, browY: 0, browA: 0, mouth: 'smile', mo: 0, blush: 0.25 },
  focus: { open: 0.8, kind: 0, browY: -0.2, browA: 0.55, mouth: 'neutral', mo: 0, blush: 0.15 },
  effort: { open: 1, kind: 2, browY: 0, browA: 0.8, mouth: 'effort', mo: 0.2, blush: 0.5 },
  shout: { open: 1, kind: 2, browY: 0, browA: 0.9, mouth: 'shout', mo: 1, blush: 0.55 },
  happy: { open: 1, kind: 1, browY: 0.6, browA: -0.1, mouth: 'grin', mo: 0.6, blush: 1 },
  cheer: { open: 1, kind: 1, browY: 0.8, browA: -0.1, mouth: 'shout', mo: 0.9, blush: 1 },
  frustrated: { open: 0.82, kind: 0, browY: -0.3, browA: 0.75, mouth: 'frown', mo: 0, blush: 0.1, sweat: true },
  sad: { open: 0.62, kind: 0, browY: -0.4, browA: -0.9, mouth: 'frown', mo: 0, blush: 0.05, sweat: true },
  surprised: { open: 1.15, kind: 0, browY: 1, browA: 0, mouth: 'o', mo: 0.8, blush: 0.2 },
  run: { open: 0.92, kind: 0, browY: 0, browA: 0.35, mouth: 'open', mo: 0.35, blush: 0.4 },
  pant: { open: 0.7, kind: 0, browY: -0.2, browA: -0.4, mouth: 'pant', mo: 0.7, blush: 0.5, sweat: true },
};
