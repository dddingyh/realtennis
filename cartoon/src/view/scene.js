// Stage: owns the three.js renderer, scene graph, lights, venue, characters, ball view, particles and camera rig.
import * as THREE from 'three';
import { gfxState, toonMat, canvasTex } from './gfx.js';
import { Venue, SUN } from './venue.js';
import { SURF_LOOK } from './court_tex.js';
import { BallView, Particles } from './ball.js';
import { CameraRig } from './camera.js';
import { createPlaceholderCharacter, PLACEHOLDER_LOOKS } from './placeholder_char.js';

const hex3 = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

export class Stage {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    gfxState.maxAniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#9ccbf0');
    this.camera = new THREE.PerspectiveCamera(47, 16 / 9, 0.3, 900);
    this.rig = new CameraRig(this.camera);

    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x9a9680, 1.95); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d6, 2.75);
    sun.position.copy(SUN).multiplyScalar(70); sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -27; sc.right = 27; sc.top = 27; sc.bottom = -27; sc.near = 15; sc.far = 190;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3.2; sun.shadow.blurSamples = 12;
    this.scene.add(sun, sun.target);

    this.ball = new BallView(); this.scene.add(this.ball.group);
    this.fx = new Particles(); this.scene.add(this.fx.points);
    this.venue = null; this.chars = [null, null]; this.charGroup = new THREE.Group(); this.scene.add(this.charGroup);
    // player contact shadows
    const blobTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(10,15,30,0.55)'); gr.addColorStop(0.7, 'rgba(10,15,30,0.25)'); gr.addColorStop(1, 'rgba(10,15,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, { aniso: false });
    this.blobs = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); m.position.y = 0.014; m.renderOrder = 2; this.scene.add(m); return m; });
    this.surface = null;
    this.size = { w: 1, h: 1 };
    this.humanIdx = 0;
    this._v = new THREE.Vector3();
    this.idleState = null;
  }

  resize(w, h) {
    this.size.w = w; this.size.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.rig.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setSurface(surface) {
    if (this.surface === surface && this.venue) return;
    if (this.venue) { this.scene.remove(this.venue.group); this.venue.dispose(); }
    this.surface = surface;
    this.venue = new Venue(surface);
    this.scene.add(this.venue.group);
    const L = SURF_LOOK[surface];
    this.dustColor = hex3(L.dust);
    this.hemi.groundColor.set(surface === 'clay' ? '#a8745a' : surface === 'grass' ? '#7f9a63' : '#8d94a0');
  }

  /** factory(look, opts) -> character; falls back to the placeholder if it throws. */
  setCharacters(factory, looks) {
    for (let i = 0; i < 2; i++) {
      const old = this.chars[i];
      if (old) { this.charGroup.remove(old.object3d); try { old.dispose(); } catch (e) { /* ignore */ } }
      let ch = null;
      const look = looks[i] || PLACEHOLDER_LOOKS[i];
      try { ch = factory(look, { index: i }); } catch (e) { console.warn('createCharacter failed, using placeholder', e); }
      if (!ch || !ch.object3d) ch = createPlaceholderCharacter(look);
      this.charGroup.add(ch.object3d);
      this.chars[i] = ch;
    }
  }

  onEvent(e, state) {
    const v = this.venue, fx = this.fx;
    switch (e.type) {
      case 'hit': {
        this.ball.onHit();
        const vel = state.ball.vel;
        if (e.pos) fx.hitBurst(e.pos, vel, e.power || 0.5, e.quality == null ? 0.6 : e.quality);
        const big = e.shot === 'smash' || (e.serve && (e.speedKmh || 0) > 175);
        if (big) this.rig.shake(0.55 + (e.power || 0) * 0.3);
        else if ((e.power || 0) > 0.85) this.rig.shake(0.18);
        break;
      }
      case 'bounce': {
        this.ball.onBounce();
        if (e.pos) {
          const sp = Math.hypot(state.ball.vel.x, state.ball.vel.z);
          if (v && e.in !== false || true) v && v.addMark(e.pos.x, e.pos.z, sp);
          const amt = this.surface === 'clay' ? 9 : this.surface === 'grass' ? 5 : 3;
          fx.dust(e.pos.x, e.pos.z, this.dustColor, amt, sp);
        }
        break;
      }
      case 'net': this.rig.shake(0.12); break;
      case 'point': if (v) { v.crowd.applause(e.winner === this.humanIdx ? 1 : 0.6, 3.2); if (e.shots >= 8) v.crowd.applause(1, 4); } break;
      case 'big':
        if (!v) break;
        if (e.kind === 'ace') { v.crowd.ovation(0.55); this.rig.shake(0.35); }
        else if (e.kind === 'winner') v.crowd.ovation(0.45);
        else if (e.kind === 'longrally') { v.crowd.ovation(0.35); v.crowd.startWave(); }
        else if (e.kind === 'break') v.crowd.ovation(0.7);
        else if (e.kind === 'set') { v.crowd.ovation(0.9); fx.confetti(0, 5, -6, 30); }
        else if (e.kind === 'match') { v.crowd.ovation(1); v.crowd.startWave(); fx.confetti(0, 6, 0, 80); fx.confetti(0, 6, -8, 60); fx.confetti(4, 6, 6, 50); }
        break;
      default: break;
    }
  }

  worldToScreen(x, y, z, out) {
    this._v.set(x, y, z).project(this.camera);
    out.x = (this._v.x * 0.5 + 0.5) * this.size.w; out.y = (-this._v.y * 0.5 + 0.5) * this.size.h; out.on = this._v.z < 1;
    return out;
  }

  /** state: ArcadeSim state, or null for the menu preview. */
  update(dt, state, humanIdx = 0) {
    this.humanIdx = humanIdx;
    const st = state || this.idleState;
    if (this.venue) this.venue.update(dt, state);
    if (st) {
      for (let i = 0; i < 2; i++) {
        const ch = this.chars[i], p = st.players[i];
        if (!ch || !p) continue;
        ch.object3d.position.set(p.pos.x, 0, p.pos.z);
        ch.update(p, dt, { ballPos: st.ball.pos });
        this.blobs[i].position.x = p.pos.x; this.blobs[i].position.z = p.pos.z;
        const j = Math.max(0, p.y || 0); this.blobs[i].scale.setScalar(1 - Math.min(0.5, j * 0.3));
      }
      this.ball.update(dt, st, this.camera, this.surface || 'hard');
    }
    this.fx.update(dt);
    this.rig.mode = state ? 'play' : 'menu';
    this.rig.update(dt, state, humanIdx);
    this.fx.uniforms.uScale.value = this.renderer.domElement.height / (2 * Math.tan(this.camera.fov * Math.PI / 360));
  }

  render() { this.renderer.render(this.scene, this.camera); }
  info() { const i = this.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries, tex: i.memory.textures }; }
}
