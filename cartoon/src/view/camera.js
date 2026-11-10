// Broadcast-style chase camera behind the near baseline with gentle follow, net zoom, serve framing, shake.
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.cfg = { z: 18.7, y: 6.1, fov: 52, lookZ: 5.0, lookY: 0.0 };
    this.s = { x: 0, y: this.cfg.y, z: this.cfg.z, fov: this.cfg.fov, lx: 0, ly: this.cfg.lookY, lz: this.cfg.lookZ, shake: 0, t: 0 };
    this.target = new THREE.Vector3();
    this.mode = 'menu';
    this.aspect = 16 / 9;
  }
  shake(a) { this.s.shake = Math.max(this.s.shake, a); }
  snap() { this.snapNext = true; }

  update(dt, state, humanIdx = 0) {
    const s = this.s, c = this.cfg; s.t += dt;
    let tx = 0, ty = c.y, tz = c.z, tf = c.fov, lx = 0, ly = c.lookY, lz = c.lookZ;
    if (this.mode === 'menu' || !state) {
      const t = s.t;
      tx = Math.sin(t * 0.17) * 4.5; ty = 8.2 + Math.sin(t * 0.11) * 0.5; tz = 21.5; lx = tx * 0.3; lz = -2; ly = 1.2; tf = 50;
    } else {
      const me = state.players[humanIdx];
      const ball = state.ball;
      const ballOn = ball && ball.visible !== false;
      const px = me ? me.pos.x : 0, pz = me ? me.pos.z : c.z;
      const bx = ballOn ? ball.pos.x : px;
      const netK = sstep(10.5, 4.5, pz);
      const focus = 0.5 * px + 0.22 * bx;
      tx = clamp(focus * 0.62, -3.3, 3.3);
      lx = clamp(focus * 0.5, -3.6, 3.6) * 0.8;
      tz = c.z - netK * 3.0; ty = c.y - netK * 0.4; tf = c.fov - netK * 6; lz = c.lookZ - netK * 5.5;
      const ph = state.match && state.match.phase;
      if (ph === 'serve-prep' || ph === 'serving' || ph === 'changeover') {
        const mine = state.match.server === humanIdx;
        const k = ph === 'changeover' ? 0 : 1;
        if (mine) { tz -= 0.5 * k; ty -= 0.25 * k; tf -= 1.5 * k; lx = lx * 0.6; tx = tx * 0.7; }
        else { ty += 0.5 * k; tf += 0 * k; }
      }
      if (ph === 'match-over') { tx = Math.sin(s.t * 0.3) * 3.5; ty = c.y + 1.5; tf = c.fov + 3; }
    }
    // widen for narrow aspect ratios
    const asp = this.aspect;
    if (asp < 1.7) tf = (2 * Math.atan(Math.tan(tf * Math.PI / 360) * Math.pow(1.78 / Math.max(asp, 0.7), 0.75))) * 180 / Math.PI;
    const k = this.snapNext ? 1000 : 1; this.snapNext = false;
    s.x = damp(s.x, tx, 2.2 * k, dt); s.y = damp(s.y, ty, 1.5 * k, dt); s.z = damp(s.z, tz, 1.5 * k, dt);
    s.fov = damp(s.fov, tf, 2.0 * k, dt);
    s.lx = damp(s.lx, lx, 2.6 * k, dt); s.ly = damp(s.ly, ly, 2.0 * k, dt); s.lz = damp(s.lz, lz, 1.5 * k, dt);
    s.shake = Math.max(0, s.shake - dt * 2.4);
    const a = s.shake * s.shake, t = s.t;
    const cam = this.cam;
    cam.position.set(s.x + Math.sin(t * 61) * 0.06 * a, s.y + Math.sin(t * 73 + 1.3) * 0.05 * a, s.z + Math.sin(t * 53 + 2.1) * 0.05 * a);
    this.target.set(s.lx + Math.sin(t * 47) * 0.12 * a, s.ly, s.lz);
    cam.lookAt(this.target);
    if (Math.abs(cam.fov - s.fov) > 0.01) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
  }
}
