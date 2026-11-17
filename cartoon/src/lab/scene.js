// Minimal lab scene: court, net, capsules, ball + trail, camera presets / orbit, and all debug overlays.
import * as THREE from 'three';

export const SHOT_COL = { topspin: '#ff9f43', flat: '#ff6b6b', slice: '#54a0ff', lob: '#a29bfe', volley: '#1dd1a1', smash: '#ff6bd6', drop: '#feca57', serve: '#feca57' };
export const colOf = (s) => SHOT_COL[s] || '#dfe6e9';
const CT = { halfL: 11.885, dHW: 5.485, sHW: 4.115, svc: 6.40, netH: 0.914, postH: 1.07, postX: 5.029, runB: 6.4, runS: 3.66 };
const SURF = {
  hard: { inner: '#3b6ea8', outer: '#2e8b6a', line: '#f4f4f0' },
  clay: { inner: '#c4673b', outer: '#a9552f', line: '#f2eee6' },
  grass: { inner: '#4f9a3f', outer: '#3d8a35', line: '#f4f4f0' },
};
const CAMS = {
  behind: { t: [0, 0.3, 0], az: 0, el: 21, d: 31, fov: 46 },
  side: { t: [0, 1.2, 0], az: -90, el: 7, d: 32, fov: 38 },
  top: { t: [0, 0, 0], az: 0, el: 89, d: 37, fov: 42 },
};
const rad = (d) => d * Math.PI / 180;

export function createLabScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10151c);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5a46, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(-8, 22, 10); scene.add(sun);

  // ---------------- court
  const ppm = 40, GW = 2 * (CT.dHW + CT.runS), GL = 2 * (CT.halfL + CT.runB);
  const gcv = document.createElement('canvas'); gcv.width = Math.round(GW * ppm); gcv.height = Math.round(GL * ppm);
  const gtex = new THREE.CanvasTexture(gcv); gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GL), new THREE.MeshLambertMaterial({ map: gtex }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  function paintCourt(key) {
    const s = SURF[key] || SURF.hard, g = gcv.getContext('2d');
    const X = (x) => (x + GW / 2) * ppm, Z = (z) => (z + GL / 2) * ppm;
    g.fillStyle = s.outer; g.fillRect(0, 0, gcv.width, gcv.height);
    g.fillStyle = s.inner; g.fillRect(X(-CT.dHW - 3.0), Z(-CT.halfL - 5.5), 2 * (CT.dHW + 3.0) * ppm, 2 * (CT.halfL + 5.5) * ppm);
    if (key === 'grass') { g.fillStyle = 'rgba(255,255,255,.05)'; for (let z = -GL / 2; z < GL / 2; z += 2) g.fillRect(0, Z(z), gcv.width, ppm); }
    g.strokeStyle = s.line; g.lineWidth = 0.06 * ppm; g.lineCap = 'butt';
    const L = (x1, z1, x2, z2) => { g.beginPath(); g.moveTo(X(x1), Z(z1)); g.lineTo(X(x2), Z(z2)); g.stroke(); };
    const H = CT.halfL;
    L(-CT.dHW, -H, CT.dHW, -H); L(-CT.dHW, H, CT.dHW, H);
    L(-CT.dHW, -H, -CT.dHW, H); L(CT.dHW, -H, CT.dHW, H);
    L(-CT.sHW, -H, -CT.sHW, H); L(CT.sHW, -H, CT.sHW, H);
    L(-CT.sHW, -CT.svc, CT.sHW, -CT.svc); L(-CT.sHW, CT.svc, CT.sHW, CT.svc);
    L(0, -CT.svc, 0, CT.svc); L(0, -H, 0, -H + 0.2); L(0, H, 0, H - 0.2);
    gtex.needsUpdate = true;
  }
  // surround walls
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x1c3a2f });
  for (const z of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(GW, 0.9, 0.2), wallMat); w.position.set(0, 0.45, z * (CT.halfL + CT.runB)); scene.add(w); }
  for (const x of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, GL), wallMat); w.position.set(x * (CT.dHW + CT.runS), 0.45, 0); scene.add(w); }
  // net
  const ncv = document.createElement('canvas'); ncv.width = 256; ncv.height = 32;
  { const g = ncv.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 32); g.strokeStyle = 'rgba(235,235,235,.75)'; g.lineWidth = 1;
    for (let i = 0; i <= 256; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 32); g.stroke(); }
    for (let j = 0; j <= 32; j += 8) { g.beginPath(); g.moveTo(0, j); g.lineTo(256, j); g.stroke(); } }
  const ntex = new THREE.CanvasTexture(ncv); ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping;
  const nshape = new THREE.Shape(); nshape.moveTo(-CT.postX, 0); nshape.lineTo(CT.postX, 0); nshape.lineTo(CT.postX, CT.postH); nshape.lineTo(0, CT.netH); nshape.lineTo(-CT.postX, CT.postH);
  const ngeo = new THREE.ShapeGeometry(nshape); { const p = ngeo.attributes.position, uv = ngeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.0762 / 8 * 0.5, p.getY(i) / 0.0762 / 8 * 0.5); }
  const net = new THREE.Mesh(ngeo, new THREE.MeshBasicMaterial({ map: ntex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(net);
  const bandMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  for (const sgn of [-1, 1]) {
    const len = Math.hypot(CT.postX, CT.postH - CT.netH), b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.03), bandMat);
    b.position.set(sgn * CT.postX / 2, (CT.postH + CT.netH) / 2, 0); b.rotation.z = sgn * -Math.atan2(CT.postH - CT.netH, CT.postX) * -1; scene.add(b);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, CT.postH + 0.05, 10), new THREE.MeshLambertMaterial({ color: 0x333a42 })); p.position.set(sgn * CT.postX, (CT.postH + 0.05) / 2, 0); scene.add(p);
  }

  // ---------------- ball, shadow, trail
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0335 * 1.7, 14, 10), new THREE.MeshLambertMaterial({ color: 0xe8ff3c, emissive: 0x556600 }));
  scene.add(ball);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; scene.add(shadow);
  const TN = 320;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 3), 3));
  trailGeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(TN), 1));
  const trailMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { col: { value: new THREE.Color(0xeaff5a) } },
    vertexShader: 'attribute float alpha; varying float a; void main(){a=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 col; varying float a; void main(){gl_FragColor=vec4(col,a);}' });
  const trail = new THREE.Line(trailGeo, trailMat); trail.frustumCulled = false; scene.add(trail);
  const trailPts = [];
  function pushTrail(p) {
    const l = trailPts[trailPts.length - 1];
    if (l && Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) > 4) trailPts.length = 0;
    trailPts.push({ x: p.x, y: p.y, z: p.z }); if (trailPts.length > TN) trailPts.shift();
  }
  function flushTrail(on) {
    trail.visible = on;
    const pa = trailGeo.attributes.position.array, aa = trailGeo.attributes.alpha.array, n = trailPts.length;
    for (let i = 0; i < n; i++) { const p = trailPts[i]; pa[i * 3] = p.x; pa[i * 3 + 1] = p.y; pa[i * 3 + 2] = p.z; aa[i] = Math.pow(i / Math.max(1, n - 1), 1.6); }
    trailGeo.setDrawRange(0, n); trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.alpha.needsUpdate = true;
  }

  // ---------------- players
  const stateCol = { move: 0xffc857, set: 0x66d98a, stretch: 0xff6b6b, idle: 0x9aa7b4 };
  function mkPlayer(base) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 1.05, 4, 12), new THREE.MeshLambertMaterial({ color: base })); body.position.y = 0.8; g.add(body);
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff })); shaft.position.z = 0.55;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })); head.rotation.x = Math.PI / 2; head.position.z = 0.9;
    arrow.add(shaft, head); arrow.position.y = 0.04; g.add(arrow);
    const paddle = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), new THREE.MeshBasicMaterial({ color: 0xff9f43, side: THREE.DoubleSide })); disc.scale.set(0.82, 1, 1);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff })); hl.position.z = 0.45;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.02), new THREE.MeshBasicMaterial({ color: 0x555555 })); handle.position.y = -0.3;
    paddle.add(disc, hl, handle); scene.add(paddle);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 36), new THREE.MeshBasicMaterial({ color: 0x66d98a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035; scene.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })); scene.add(pole);
    scene.add(g);
    return { g, body, arrow, paddle, disc, hl, ring, pole };
  }
  const pls = [mkPlayer(0x4a90d9), mkPlayer(0xd9644a)];
  function updatePlayer(i, d) {   // d: {pos,face:{x,z},state,contact:{x,y,z}|null,side,dir:{x,z},ringOn}
    const p = pls[i];
    p.g.position.set(d.pos.x, d.jump || 0, d.pos.z);
    p.body.material.color.setHex(stateCol[d.state] || stateCol.idle);
    p.arrow.rotation.y = Math.atan2(d.face.x, d.face.z);
    p.ring.visible = p.pole.visible = !!(d.contact && d.ringOn);
    if (d.contact) {
      p.ring.position.set(d.contact.x, 0.035, d.contact.z); p.ring.material.color.setHex(stateCol[d.state] || stateCol.set);
      p.pole.scale.y = Math.max(0.05, d.contact.y); p.pole.position.set(d.contact.x, d.contact.y / 2, d.contact.z);
    }
    const s = d.rside, px = d.paddlePos || { x: d.pos.x + 0.6, y: 1, z: d.pos.z };
    p.paddle.position.set(px.x, px.y, px.z);
    p.paddle.rotation.y = Math.atan2(d.dir.x, d.dir.z);
    p.disc.material.color.set(s === 'bh' ? '#54a0ff' : '#ff9f43');
    p.paddle.visible = true;
  }

  // ---------------- overlays
  const ov = { predict: true, timing: true, fan: true, last: true, hist: true, contact: true };
  const overlayGroup = new THREE.Group(); scene.add(overlayGroup);
  const lineMat = (c, dashed) => (dashed ? new THREE.LineDashedMaterial({ color: c, dashSize: 0.35, gapSize: 0.2 }) : new THREE.LineBasicMaterial({ color: c }));
  const mkLine = (c, n, dashed) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); const l = new THREE.Line(geo, lineMat(c, dashed)); l.frustumCulled = false; l.visible = false; overlayGroup.add(l); return l; };
  function setLine(l, pts, n, dashed) {
    n = Math.min(n, pts.length, l.geometry.attributes.position.count); const a = l.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) { const p = pts[i]; a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z; }
    l.geometry.setDrawRange(0, n); l.geometry.attributes.position.needsUpdate = true; l.visible = n > 1;
    if (dashed && n > 1) l.computeLineDistances();
  }
  const mkRing = (r0, r1, c, flat = true) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })); if (flat) m.rotation.x = -Math.PI / 2; m.visible = false; overlayGroup.add(m); return m; };
  const predLine = mkLine(0x7ee7ff, 300, true), predLand = mkRing(0.18, 0.3, 0x7ee7ff), predLand2 = mkRing(0.04, 0.12, 0x7ee7ff);
  const predContact = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); predContact.visible = false; overlayGroup.add(predContact);
  const tring = mkRing(0.92, 1.0, 0xffffff, false), tcore = mkRing(0.11, 0.14, 0xffffff, false);
  const FAN = [-100, -50, 0, 50, 100, 'now'];
  const fanDots = FAN.map((k) => { const m = new THREE.Mesh(new THREE.CircleGeometry(k === 'now' ? 0.26 : 0.18, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.visible = false; overlayGroup.add(m); return m; });
  const fanLines = FAN.map(() => mkLine(0xffffff, 2, false));
  const fanLabels = FAN.map((k) => { const c = document.createElement('canvas'); c.width = 96; c.height = 40; const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(1.5, 0.62, 1); s.visible = false; s._cv = c; s._tex = t; s._txt = ''; overlayGroup.add(s); return s; });
  function setLabel(s, txt, col) { if (s._txt === txt + col) return; s._txt = txt + col; const g = s._cv.getContext('2d'); g.clearRect(0, 0, 96, 40); g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(8, 6, 80, 30); g.fillStyle = col; g.fillText(txt, 48, 30); s._tex.needsUpdate = true; }
  const fanCol = (ms) => { const u = Math.max(-1, Math.min(1, ms / 100)); return u < 0 ? new THREE.Color().setHSL(0.55, 0.9, 0.62 - 0.1 * (-u)) : new THREE.Color().setHSL(0.02 + 0.1 * (1 - u), 0.9, 0.6); };
  function updateFan(d) {
    for (let k = 0; k < FAN.length; k++) {
      const f = d && d.fan && d.fan[k], dot = fanDots[k], ln = fanLines[k], lb = fanLabels[k];
      if (!ov.fan || !f) { dot.visible = ln.visible = lb.visible = false; continue; }
      const ms = FAN[k] === 'now' ? f.ms : FAN[k], c = FAN[k] === 'now' ? new THREE.Color(0xffffff) : fanCol(ms);
      dot.position.set(f.x, 0.05, f.z); dot.material.color.copy(c); dot.visible = true;
      ln.material.color.copy(c); setLine(ln, [d.origin, { x: f.x, y: 0.05, z: f.z }], 2); ln.material.opacity = 0.5;
      lb.position.set(f.x, 0.7, f.z); setLabel(lb, FAN[k] === 'now' ? '现在' : (ms > 0 ? '+' + ms : String(ms)), '#' + c.getHexString()); lb.visible = true;
    }
  }
  // last shot + history
  let lastObj = null; const hist = [];
  function disposeObj(o) { if (!o) return; o.group.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); scene.remove(o.group); }
  function buildTraj(rec) {
    const grp = new THREE.Group(), col = new THREE.Color(colOf(rec.shot));
    const pts = rec.pts.map((p) => new THREE.Vector3(p.x, Math.max(p.y, 0.03), p.z));
    if (pts.length > 3) {
      const curve = new THREE.CatmullRomCurve3(pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-4), false, 'centripetal');
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(220, pts.length * 2), 0.028, 5, false), new THREE.MeshBasicMaterial({ color: col, transparent: true }));
      tube.userData.main = true; grp.add(tube);
    }
    if (rec.line) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(rec.line.a.x, 0.03, rec.line.a.z), new THREE.Vector3(rec.line.b.x, 0.03, rec.line.b.z)]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })); l.userData.straight = true; grp.add(l); }
    if (rec.landing) { const r = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.28, 24), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true })); r.rotation.x = -Math.PI / 2; r.position.set(rec.landing.x, 0.05, rec.landing.z); grp.add(r); }
    // ground shadow of the path (shows the bend from above)
    if (pts.length > 3) { const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, 0.025, p.z))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.5 })); grp.add(l); }
    scene.add(grp); return { group: grp };
  }
  function addTrajectory(rec, keepN) {
    disposeObj(lastObj); lastObj = buildTraj(rec);
    hist.unshift(buildTraj(rec));
    while (hist.length > keepN) disposeObj(hist.pop());
    refreshHist();
  }
  function refreshHist() {
    hist.forEach((h, i) => { h.group.visible = ov.hist && i > 0; h.group.traverse((m) => { if (m.material && m.material.transparent) m.material.opacity = Math.max(0.15, 1 - i * 0.07); }); });
    if (lastObj) lastObj.group.visible = ov.last;
  }
  function setHistMax(n) { while (hist.length > n) disposeObj(hist.pop()); }
  function clearTrajectories() { disposeObj(lastObj); lastObj = null; while (hist.length) disposeObj(hist.pop()); }

  // ---------------- camera
  const cam = { t: new THREE.Vector3(0, 0.6, -3), az: 0, el: rad(12.5), d: 23, fov: 48, to: null, name: 'behind' };
  function setCamera(name) {
    cam.name = name; const c = CAMS[name];
    cam.to = c ? { t: new THREE.Vector3(...c.t), az: rad(c.az), el: rad(c.el), d: c.d, fov: c.fov } : null;
    if (c) { let da = cam.to.az - cam.az; da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI; cam.to.az = cam.az + da; }
  }
  function applyCam(dt) {
    if (cam.to) {
      const k = 1 - Math.exp(-dt * 9), o = cam.to;
      cam.t.lerp(o.t, k); cam.az += (o.az - cam.az) * k; cam.el += (o.el - cam.el) * k; cam.d += (o.d - cam.d) * k; cam.fov += (o.fov - cam.fov) * k;
      if (cam.t.distanceTo(o.t) < 1e-3 && Math.abs(o.az - cam.az) < 1e-3 && Math.abs(o.el - cam.el) < 1e-3 && Math.abs(o.d - cam.d) < 1e-2) { cam.to = null; }
    }
    const ce = Math.cos(cam.el);
    camera.position.set(cam.t.x + cam.d * ce * Math.sin(cam.az), cam.t.y + cam.d * Math.sin(cam.el), cam.t.z + cam.d * ce * Math.cos(cam.az));
    camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.lookAt(cam.t);
  }
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, btn: e.button, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 0) { drag.moved = true; if (cam.name !== 'orbit') { cam.name = 'orbit'; cam.to = null; api.onCamChange && api.onCamChange('orbit'); } }
    if (drag.btn === 2 || e.shiftKey) { const s = cam.d * 0.0016; cam.t.x -= dx * s * Math.cos(cam.az); cam.t.z += dx * s * Math.sin(cam.az); cam.t.y = Math.max(0, cam.t.y + dy * s); }
    else { cam.az -= dx * 0.006; cam.el = Math.max(rad(1), Math.min(rad(89.5), cam.el + dy * 0.006)); }
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.to = null; if (cam.name !== 'orbit') { cam.name = 'orbit'; api.onCamChange && api.onCamChange('orbit'); } cam.d = Math.max(4, Math.min(80, cam.d * Math.exp(e.deltaY * 0.001))); }, { passive: false });

  function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  // per-frame update.  d = { ball:{pos}, show:{trail}, players:[...], predict, predictOn, hint, fan, tuning }
  function update(dt, d) {
    const b = d.ball.pos;
    ball.position.set(b.x, Math.max(b.y, 0.0335), b.z);
    shadow.position.set(b.x, 0.02, b.z); const s = 1 + Math.min(1, b.y / 6) * 0.9; shadow.scale.set(s, s, 1); shadow.material.opacity = Math.max(0.12, 0.45 - b.y * 0.05);
    if (d.trailPush) pushTrail(b);
    flushTrail(d.trailOn);
    for (let i = 0; i < 2; i++) updatePlayer(i, d.players[i]);
    // predicted path
    const P = d.predict;
    if (ov.predict && P && P.path && P.path.length > 1) {
      setLine(predLine, P.path, 300, true);
      if (P.landing) { predLand.position.set(P.landing.x, 0.05, P.landing.z); predLand2.position.copy(predLand.position); predLand.visible = predLand2.visible = true; } else predLand.visible = predLand2.visible = false;
      if (P.contact && ov.contact) { predContact.position.set(P.contact.x, P.contact.y, P.contact.z); predContact.visible = true; } else predContact.visible = false;
    } else { predLine.visible = predLand.visible = predLand2.visible = predContact.visible = false; }
    // timing ring around the ball
    const ci = d.hint && d.hint.contactIn;
    if (ov.timing && ci != null && ci > -0.25 && ci < 1.6) {
      const r = 0.1 + Math.max(0, ci) * 0.9, perfect = Math.abs(ci * (d.timeScale || 1)) < (d.tPerfect || 0.035);
      const col = ci < 0 ? 0xff6b6b : perfect ? 0x66d98a : ci < 0.25 ? 0xffc857 : 0xffffff;
      tring.position.copy(ball.position); tring.scale.set(r, r, 1); tring.material.color.setHex(col); tring.lookAt(camera.position); tring.visible = true;
      tcore.position.copy(ball.position); tcore.scale.set(1.0, 1.0, 1); tcore.material.color.setHex(col); tcore.lookAt(camera.position); tcore.visible = true;
    } else tring.visible = tcore.visible = false;
    updateFan(d);
    applyCam(dt);
  }
  function render() { renderer.render(scene, camera); }

  const api = { renderer, scene, camera, update, render, resize, setCamera, setSurface: paintCourt, overlays: ov, addTrajectory, refreshHist, setHistMax, clearTrajectories, resetTrail: () => { trailPts.length = 0; }, pushTrail, cam, onCamChange: null };
  paintCourt('hard'); setCamera('behind'); applyCam(1); resize();
  return api;
}
