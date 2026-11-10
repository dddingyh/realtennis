// Fallback character (capsules + sphere head + racket) with the same interface as view/character/index.js.
import * as THREE from 'three';
import { toonMat } from './gfx.js';

export const PLACEHOLDER_LOOKS = [
  { skin: '#e8b88f', hair: '#2b1c12', shirt: '#e84a4a', shorts: '#26376b', shoes: '#ffffff', accent: '#ffd23f', hairStyle: 0, build: 1 },
  { skin: '#c68d5e', hair: '#101010', shirt: '#3fa0e0', shorts: '#f2f2f2', shoes: '#ffd23f', accent: '#ffffff', hairStyle: 1, build: 1 },
  { skin: '#f6d3b8', hair: '#d6b25e', shirt: '#47b86a', shorts: '#1c2a46', shoes: '#ffffff', accent: '#ffffff', hairStyle: 0, build: 1 },
  { skin: '#8c5a36', hair: '#1b1410', shirt: '#9b6ad8', shorts: '#f2f2f2', shoes: '#ffffff', accent: '#ffd23f', hairStyle: 1, build: 1 },
];

export function createPlaceholderCharacter(look = PLACEHOLDER_LOOKS[0]) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const mats = {};
  const mk = (k, c) => (mats[k] = toonMat(c));
  const l = look;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.45, 4, 10), mk('shirt', l.shirt)); torso.position.y = 1.15; body.add(torso);
  const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.27, 0.3, 12), mk('shorts', l.shorts)); shorts.position.y = 0.78; body.add(shorts);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), mk('skin', l.skin)); head.position.y = 1.72; body.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.235, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mk('hair', l.hair)); hair.position.y = 1.74; hair.rotation.x = -0.25; body.add(hair);
  const legs = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * 0.11, 0.66, 0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.62, 8), mk('skin2', l.skin)); m.position.y = -0.32; g.add(m);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.3), mk('shoes', l.shoes)); sh.position.set(0, -0.64, 0.05); g.add(sh);
    root.add(g); return g; });
  const armL = new THREE.Group(); armL.position.set(-0.3, 1.38, 0); body.add(armL);
  const armLm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.36, 3, 6), mats.skin); armLm.position.y = -0.22; armL.add(armLm);
  const armR = new THREE.Group(); armR.position.set(0.3, 1.38, 0); body.add(armR);
  const armRm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.36, 3, 6), mats.skin); armRm.position.y = -0.22; armR.add(armRm);
  const racket = new THREE.Group(); racket.position.set(0, -0.46, 0.05); armR.add(racket);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 6), mk('rh', '#2a2d36')); handle.position.y = 0.16; racket.add(handle);
  const rhead = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 6, 20), mk('rk', l.accent || '#ffd23f')); rhead.scale.set(0.8, 1, 1); rhead.position.y = 0.48; racket.add(rhead);
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); strings.scale.set(0.8, 1, 1); strings.position.y = 0.48; racket.add(strings);
  racket.rotation.set(0.2, 0, 0);
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  racket.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  legs.forEach((g) => g.traverse((o) => { if (o.isMesh) o.castShadow = true; }));

  let yaw = 0;
  return {
    object3d: root,
    update(st, dt) {
      const a = st.anim || {};
      const f = a.face || { x: 0, z: -1 };
      const target = Math.atan2(f.x, f.z);
      let d = target - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw += d * Math.min(1, dt * 14);
      root.rotation.y = yaw;
      const sp = a.speed || 0, gait = a.gait || 0;
      const ph = gait * Math.PI * 2;
      body.position.y = Math.abs(Math.sin(ph)) * 0.05 * sp;
      body.rotation.x = 0.25 * sp + (a.name === 'brake' ? -0.2 : 0);
      legs[0].rotation.x = Math.sin(ph) * 0.8 * sp; legs[1].rotation.x = -Math.sin(ph) * 0.8 * sp;
      armL.rotation.x = -Math.sin(ph) * 0.7 * sp;
      const hs = st.hand === 'L' ? -1 : 1;
      armR.position.x = 0.3 * hs; armL.position.x = -0.3 * hs;
      const p = a.phase || 0;
      if (a.name === 'swing') {
        const side = a.side === 'bh' ? -1 : 1;
        const k = p < 0.5 ? -1.6 + (p / 0.5) * 1.6 : (p - 0.5) / 0.5 * 1.8;
        armR.rotation.set(-1.2 + 0.0, side * k * hs * 0.9, side * (-0.6) * hs); body.rotation.y = -side * k * 0.5 * hs;
      } else if (a.name === 'serve' || a.name === 'toss') {
        const up = a.name === 'toss' ? Math.min(1, p * 3) : (p < 0.65 ? 0.5 + p : 1.0 + Math.min(0.5, (p - 0.65) * 3));
        armL.rotation.x = -Math.PI * 0.9 * Math.min(1, p * 2.5); armR.rotation.set(-Math.PI * up * 0.75, 0, 0); body.rotation.y = 0;
      } else if (a.name === 'celebrate') {
        armR.rotation.set(-3.0, 0, 0); armL.rotation.set(-3.0, 0, 0); body.position.y = Math.abs(Math.sin(performance.now() * 0.01)) * 0.12;
      } else { armR.rotation.set(-0.8 + Math.sin(ph) * 0.2, 0, -0.2); body.rotation.y = 0; }
      root.position.y = st.y || 0;
    },
    setLook(lk) { for (const [k, key] of [['shirt', 'shirt'], ['shorts', 'shorts'], ['skin', 'skin'], ['skin2', 'skin'], ['hair', 'hair'], ['shoes', 'shoes']]) if (lk[key] && mats[k]) mats[k].color.set(lk[key]); },
    dispose() { root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } }); },
  };
}
