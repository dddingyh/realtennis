// Ball, ground shadow, trail, timing ring, landing prediction, impact particles.
import * as THREE from 'three';
import { toonMat, canvasTex } from './gfx.js';
import { simulateTrajectory } from '../../../src/physics/ball.js';

const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

function glowTex() {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }, { aniso: false });
}

// ------------------------------------------------------------------ particles
const PV = /* glsl */`
attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol;
void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.0, aSize * uScale / -mv.z); }`;
const PF = /* glsl */`
varying vec4 vCol;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, 0.55, r) * vCol.a; if (a < 0.01) discard; gl_FragColor = vec4(vCol.rgb, a);
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(N = 220) {
    this.N = N; this.n = 0; this.next = 0;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 4); this.size = new Float32Array(N);
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.size0 = new Float32Array(N); this.grav = new Float32Array(N); this.drag = new Float32Array(N); this.grow = new Float32Array(N);
    this.base = new Float32Array(N * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.uniforms = { uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: PV, fragmentShader: PF, uniforms: this.uniforms, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    for (let i = 0; i < N; i++) { this.pos[i * 3 + 1] = -100; }
  }
  emit(x, y, z, vx, vy, vz, size, life, r, g, b, a = 1, grav = 9, drag = 1.5, grow = 0) {
    const i = this.next; this.next = (this.next + 1) % this.N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size0[i] = size; this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
  }
  update(dt) {
    const { pos, vel, life, max, col, size, base } = this;
    for (let i = 0; i < this.N; i++) {
      if (life[i] <= 0) { size[i] = 0; col[i * 4 + 3] = 0; continue; }
      life[i] -= dt;
      const f = Math.max(0, life[i] / max[i]);
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= dr; vel[i * 3 + 1] = vel[i * 3 + 1] * dr - this.grav[i] * dt; vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.01 && this.grav[i] > 0) { pos[i * 3 + 1] = 0.01; vel[i * 3 + 1] *= -0.3; vel[i * 3] *= 0.7; vel[i * 3 + 2] *= 0.7; }
      size[i] = this.size0[i] * (this.grow[i] > 0 ? (1 + (1 - f) * this.grow[i]) : (0.4 + 0.6 * f));
      col[i * 4] = base[i * 4]; col[i * 4 + 1] = base[i * 4 + 1]; col[i * 4 + 2] = base[i * 4 + 2]; col[i * 4 + 3] = base[i * 4 + 3] * Math.min(1, f * 2.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aCol.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
  /** sparks + puff when the racket meets the ball. */
  hitBurst(p, vel, power, quality) {
    const n = 6 + Math.round(power * 12 + quality * 6);
    const sp = 2.5 + power * 7;
    const L = Math.hypot(vel.x, vel.y, vel.z) || 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = (Math.random() - 0.3) * 1.5, s = sp * (0.4 + Math.random() * 0.9);
      this.emit(p.x, p.y, p.z, Math.cos(a) * s * 0.7 + vel.x / L * s * 0.5, e * s * 0.7 + 1, Math.sin(a) * s * 0.7 + vel.z / L * s * 0.5, 0.07 + Math.random() * 0.06 + quality * 0.03, 0.3 + Math.random() * 0.25,
        1, 0.95 - Math.random() * 0.25, 0.5 + quality * 0.3, 1, 5, 2.2);
    }
    this.emit(p.x, p.y, p.z, 0, 0.2, 0, 0.5 + power * 0.6, 0.22, 1, 1, 0.9, 0.85, 0, 4, 2.4);
  }
  dust(x, z, color, amount, speed) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * 6.283, s = (0.4 + Math.random() * 1.6) * (0.5 + speed * 0.04);
      this.emit(x, 0.03, z, Math.cos(a) * s, 0.6 + Math.random() * 1.1, Math.sin(a) * s, 0.12 + Math.random() * 0.14, 0.45 + Math.random() * 0.5, color[0], color[1], color[2], 0.8, 2.5, 3.5, 1.8);
    }
  }
  confetti(x, y, z, n = 30) {
    const pal = [[1, 0.3, 0.3], [1, 0.85, 0.2], [0.3, 0.7, 1], [0.4, 0.9, 0.5], [1, 0.5, 0.9]];
    for (let i = 0; i < n; i++) {
      const c = pal[(Math.random() * pal.length) | 0], a = Math.random() * 6.283, s = 1.5 + Math.random() * 4.5;
      this.emit(x, y, z, Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s, 0.12 + Math.random() * 0.08, 1.3 + Math.random() * 0.9, c[0], c[1], c[2], 1, 6, 0.4, 0);
    }
  }
}

// ------------------------------------------------------------------ ball view
export class BallView {
  constructor() {
    this.group = new THREE.Group(); this.group.name = 'ball';
    const tex = canvasTex(256, 128, (g, W, H) => {
      g.fillStyle = '#dcf53a'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
      g.strokeStyle = '#ffffff'; g.lineWidth = 9; g.lineCap = 'round';
      for (const x0 of [W * 0.25, W * 0.75]) { g.beginPath(); g.moveTo(x0, -10); g.bezierCurveTo(x0 + 70, H * 0.3, x0 - 70, H * 0.7, x0, H + 10); g.stroke(); }
    }, { aniso: false });
    this.mat = toonMat('#ffffff', { map: tex, emissive: new THREE.Color('#6a7a10'), emissiveIntensity: 0.55 });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), this.mat); this.mesh.castShadow = true;
    this.pivot = new THREE.Object3D(); this.pivot.add(this.mesh); this.group.add(this.pivot);
    // glow
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xf4ff6a, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }));
    this.glow.renderOrder = 6; this.group.add(this.glow);
    // contact shadow decal
    const sh = canvasTex(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(8,10,24,1)'); gr.addColorStop(0.62, 'rgba(8,10,24,0.95)'); gr.addColorStop(0.85, 'rgba(8,10,24,0.4)'); gr.addColorStop(1, 'rgba(8,10,24,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }, { aniso: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sh, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.shadow.renderOrder = 2; this.group.add(this.shadow);
    // trail ribbon
    this.TN = 16; this.trailPts = new Float32Array(this.TN * 3); this.trailAcc = 0; this.trailValid = 0;
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(this.TN * 2 * 3); this.tCol = new Float32Array(this.TN * 2 * 4);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < this.TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    tg.setIndex(idx); tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.trail.frustumCulled = false; this.trail.renderOrder = 3; this.group.add(this.trail);
    // timing ring (screen-facing)
    const ringG = new THREE.RingGeometry(0.88, 1, 48);
    this.ringOuter = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, depthTest: false, depthWrite: false, opacity: 0.95 }));
    this.ringTarget = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, opacity: 0.9 }));
    this.ringFill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x9dff6a, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
    for (const r of [this.ringOuter, this.ringTarget, this.ringFill]) { r.renderOrder = 8; r.visible = false; this.group.add(r); }
    // landing ring
    this.landing = new THREE.Group();
    const lr = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const ld = new THREE.Mesh(new THREE.CircleGeometry(0.25, 20).rotateX(-Math.PI / 2), lr.material);
    this.landing.add(lr, ld); this.landing.visible = false; this.landing.renderOrder = 2; this.group.add(this.landing);
    this.landRing = lr;

    this.showTiming = true; this.showLanding = true;
    this.squash = 0; this.stretchT = 0; this.land = { x: 0, z: 0, ok: false, t: 0 }; this.lastPos = new THREE.Vector3(); this.hasLast = false;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._vel = new THREE.Vector3(); this._sp = new THREE.Vector3(); this._dq = new THREE.Quaternion();
    this.pulse = 0;
  }

  onBounce() { this.squash = 1; }
  onHit() { this.stretchT = 1; this.trailValid = 0; }

  resetTrail() { this.trailValid = 0; }

  update(dt, state, camera, surface) {
    const ball = state.ball;
    const vis = ball && ball.visible !== false;
    this.group.visible = !!vis;
    if (!vis) { this.hasLast = false; this.trailValid = 0; return; }
    const p = ball.pos, v = ball.vel;
    const cam = camera.position;
    const dist = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    const r = 0.07 + 0.0055 * dist;
    if (this.hasLast && this._v.set(p.x, p.y, p.z).distanceTo(this.lastPos) > 2.5) this.trailValid = 0;
    this.lastPos.set(p.x, p.y, p.z); this.hasLast = true;
    this.pivot.position.set(p.x, p.y, p.z);
    // squash & stretch
    this.squash = Math.max(0, this.squash - dt / 0.14); this.stretchT = Math.max(0, this.stretchT - dt / 0.12);
    const speed = Math.hypot(v.x, v.y, v.z);
    this._vel.set(v.x, v.y, v.z);
    if (this.squash > 0) {
      const q = this.squash;
      this.pivot.quaternion.identity();
      this.pivot.scale.set(r * (1 + 0.38 * q), r * (1 - 0.5 * q), r * (1 + 0.38 * q));
    } else {
      const sf = 1 + Math.min(0.7, speed * 0.012) + this.stretchT * 0.2;
      if (speed > 0.5) this.pivot.quaternion.setFromUnitVectors(Z, this._vel.multiplyScalar(1 / speed));
      const sc = r / Math.sqrt(sf);
      this.pivot.scale.set(sc, sc, sc * sf);
    }
    // spin
    const sp = ball.spin;
    if (sp) {
      const m = Math.hypot(sp.x, sp.y, sp.z);
      if (m > 1) { this._sp.set(sp.x, sp.y, sp.z).multiplyScalar(1 / m); this._dq.setFromAxisAngle(this._sp, Math.min(0.5, m * dt * 0.12)); this.mesh.quaternion.premultiply(this._dq); }
    }
    // glow
    this.glow.position.set(p.x, p.y, p.z); this.glow.scale.setScalar(r * 5.2);
    this.glow.material.opacity = ball.attach ? 0.12 : 0.55;   // held ball: no halo shining through the server's body
    // ground shadow decal
    const h = Math.max(0, p.y);
    const sr = (0.075 + 0.0046 * dist) * (1 + h * 0.05);
    this.shadow.position.set(p.x, 0.012, p.z); this.shadow.scale.set(sr * 2.4, 1, sr * 2.4);
    this.shadow.material.opacity = Math.max(0.45, 1 - h * 0.08);
    this._updateTrail(dt, p, camera, r, speed);
    this._updateRings(dt, state, camera, dist, p);
    this._updateLanding(dt, state, ball, surface);
  }

  _updateTrail(dt, p, camera, r, speed) {
    this.trailAcc += dt;
    const step = 1 / 90;
    const TN = this.TN, pts = this.trailPts;
    if (this.trailAcc >= step) {
      this.trailAcc = 0;
      pts.copyWithin(3, 0, (TN - 1) * 3);
      pts[0] = p.x; pts[1] = p.y; pts[2] = p.z; this.trailValid = Math.min(TN, this.trailValid + 1);
    } else if (this.trailValid > 0) { pts[0] = p.x; pts[1] = p.y; pts[2] = p.z; }
    const n = this.trailValid;
    const cam = camera.position;
    const a = Math.min(1, Math.max(0, (speed - 6) / 14));
    for (let i = 0; i < TN; i++) {
      const j = Math.min(i, Math.max(0, n - 1));
      const x = pts[j * 3], y = pts[j * 3 + 1], z = pts[j * 3 + 2];
      const jn = Math.min(j + 1, Math.max(0, n - 1)), jp = Math.max(0, j - 1);
      let tx = pts[jp * 3] - pts[jn * 3], ty = pts[jp * 3 + 1] - pts[jn * 3 + 1], tz = pts[jp * 3 + 2] - pts[jn * 3 + 2];
      const vx = x - cam.x, vy = y - cam.y, vz = z - cam.z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const f = 1 - i / (TN - 1);
      const w = r * 0.95 * f * (i < n ? 1 : 0);
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      const o = i * 6;
      this.tPos[o] = x + sx; this.tPos[o + 1] = y + sy; this.tPos[o + 2] = z + sz; this.tPos[o + 3] = x - sx; this.tPos[o + 4] = y - sy; this.tPos[o + 5] = z - sz;
      const al = i < n ? f * f * 0.7 * a : 0;
      const c = i * 8;
      this.tCol[c] = 1; this.tCol[c + 1] = 1; this.tCol[c + 2] = 0.75; this.tCol[c + 3] = al;
      this.tCol[c + 4] = 1; this.tCol[c + 5] = 1; this.tCol[c + 6] = 0.75; this.tCol[c + 7] = al;
    }
    this.trail.geometry.attributes.position.needsUpdate = true; this.trail.geometry.attributes.color.needsUpdate = true;
  }

  _updateRings(dt, state, camera, dist, p) {
    const hint = state.hint;
    const ci = hint && hint.contactIn;
    const on = this.showTiming && ci != null && ci > -0.12 && ci < 1.6 && state.ball.visible !== false;
    this.ringOuter.visible = this.ringTarget.visible = this.ringFill.visible = on;
    if (!on) return;
    const base = dist * 0.03;
    const k = Math.max(0, Math.min(1, ci / 1.0));
    const sc = base * (1 + 2.4 * k * k);
    for (const m of [this.ringOuter, this.ringTarget, this.ringFill]) { m.position.set(p.x, p.y, p.z); m.quaternion.copy(camera.quaternion); }
    this.ringOuter.scale.setScalar(sc); this.ringTarget.scale.setScalar(base);
    const near = Math.abs(ci) < 0.09;
    const c = this.ringOuter.material.color;
    if (near) c.setRGB(0.55, 1, 0.3); else if (ci < 0.3) c.setRGB(1, 0.9, 0.3); else c.setRGB(0.4, 0.88, 1);
    this.ringOuter.material.opacity = Math.min(1, 0.35 + (1 - k) * 0.75);
    this.ringFill.scale.setScalar(base * 0.95); this.ringFill.material.opacity = near ? 0.38 : 0;
    this.ringTarget.material.color.setRGB(1, 1, 1);
  }

  _updateLanding(dt, state, ball, surface) {
    const L = this.land; L.t -= dt;
    const want = this.showLanding && ball.inPlay !== false && (ball.bounces | 0) === 0 && ball.vel.z > 1 && ball.pos.y > 0.05 && !ball.attach;
    if (want && L.t <= 0) {
      L.t = 0.1;
      try {
        const r = simulateTrajectory({ pos: ball.pos, vel: ball.vel, spin: ball.spin || { x: 0, y: 0, z: 0 }, bounces: 0 }, { surface, dt: 1 / 90, maxTime: 3, stopAfterBounces: 1 });
        if (r.landing && !r.hitNet) { L.x = r.landing.x; L.z = r.landing.z; L.ok = true; } else L.ok = false;
      } catch (e) { L.ok = false; }
    }
    this.landing.visible = !!(want && L.ok);
    if (this.landing.visible) {
      this.pulse += dt * 6;
      const s = 0.42 + 0.06 * Math.sin(this.pulse);
      this.landing.position.set(L.x, 0.015, L.z); this.landing.scale.set(s * 1.3, 1, s);
    }
  }
}
