// The stadium: court, net, boards, stands, roof, props, LED ribbon, shot clocks, video boards, sky, crowd.
import * as THREE from 'three';
import { COURT } from '../../../src/config.js';
import { THEMES } from '../../../src/render/stage.js';
import { GeoBuilder, addPerson, toonMat, canvasTex, roundRect, gfxState } from './gfx.js';
import { VENUE, TOURNEY, SURF_LOOK, makeCourtTexture, makeNetTexture, makeWallTexture, makeSkyTexture } from './court_tex.js';
import { STANDS, roofHeightAt } from './stands.js';
import { Crowd } from './crowd.js';

export const SUN = new THREE.Vector3(0.62, 0.68, 0.38).normalize();   // direction towards the sun
const { BX, BZ } = VENUE;
const PLAYER_BENCH_X = -9.2, CHAIR_X = -7.9;

function darken(hex, f) { return '#' + new THREE.Color(hex).multiplyScalar(f).getHexString(); }

export class Venue {
  constructor(surface) {
    this.surface = surface; this.th = THEMES[surface]; this.look = SURF_LOOK[surface];
    this.group = new THREE.Group(); this.group.name = 'venue';
    this.disposables = [];
    this.led = { text: '', key: '' }; this.board = { key: '' };
    this.clock = { value: 25, shown: -1, phase: '' };
    this.marks = null;
    this._build();
    this.crowd = new Crowd(this.th, SUN);
    this.group.add(this.crowd.group);
  }

  _own(o) { this.disposables.push(o); return o; }
  _mesh(geo, mat, { cast = false, receive = false, name = '' } = {}) {
    const m = new THREE.Mesh(this._own(geo), this._own(mat)); m.castShadow = cast; m.receiveShadow = receive; m.name = name;
    this.group.add(m); return m;
  }

  _build() {
    const th = this.th, surface = this.surface;
    // ----- floors
    const apron = this._mesh(new THREE.PlaneGeometry(240, 260).rotateX(-Math.PI / 2), toonMat(darken(th.concrete, 0.8)), { receive: true, name: 'apron' });
    apron.position.y = -0.04;
    const courtTex = this._own(makeCourtTexture(surface));
    const court = this._mesh(new THREE.PlaneGeometry(BX * 2, BZ * 2).rotateX(-Math.PI / 2), toonMat('#ffffff', { map: courtTex }), { receive: true, name: 'court' });
    this.courtMat = court.material;

    this._buildNet();
    this._buildBoards();
    this._buildStands();
    this._buildProps();
    this._buildRoof();
    this._buildClocks();
    this._buildMarks();

    // sky
    const skyTex = this._own(makeSkyTexture());
    const sky = this._mesh(new THREE.SphereGeometry(600, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }), { name: 'sky' });
    sky.renderOrder = -10;
  }

  // ---------------------------------------------------------------- net
  _buildNet() {
    const surface = this.surface;
    const segs = 48, hw = COURT.netPostX + 0.914 + 0.0 > 6.4 ? 6.4 : 6.4;
    const pos = [], uv = [], nor = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, x = -hw + 2 * hw * u, t = x / hw;
      const top = COURT.netHeightCenter + (COURT.netHeightPost - COURT.netHeightCenter) * t * t;
      pos.push(x, 0.02, 0, x, top, 0); uv.push(u, 0, u, 1); nor.push(0, 0, 1, 0, 0, 1);
      if (i < segs) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const tex = this._own(makeNetTexture(surface));
    const m = this._mesh(g, toonMat('#ffffff', { map: tex, alphaTest: 0.35, transparent: false, side: THREE.DoubleSide }), { cast: true, receive: true, name: 'net' });
    m.frustumCulled = false;
  }

  // ---------------------------------------------------------------- boards (walls with sponsor panels, LED ribbons)
  _buildBoards() {
    const th = this.th, surface = this.surface;
    const b = new GeoBuilder();
    // wall bodies
    b.box(0, 1.225, -BZ - 0.15, BX * 2 + 0.6, 2.45, 0.3, th.wall); b.box(0, 1.225, BZ + 0.15, BX * 2 + 0.6, 2.45, 0.3, th.wall);
    b.box(-BX - 0.15, 0.65, 0, 0.3, 1.3, BZ * 2, th.wall); b.box(BX + 0.15, 0.65, 0, 0.3, 1.3, BZ * 2, th.wall);
    for (const s of [-1, 1]) { b.box(0, 2.48, s * (BZ + 0.15), BX * 2 + 0.6, 0.06, 0.34, th.accent); b.box(s * (BX + 0.15), 1.33, 0, 0.34, 0.06, BZ * 2, th.accent); }
    // hedge + flowers on grass
    if (th.flowers) {
      for (const s of [-1, 1]) b.box(s * (BX + 0.15), 1.5, 0, 0.5, 0.34, BZ * 2, '#1f5a2a');
      const cols = ['#e8d8f5', '#b9a3d6', '#ffffff', '#f4a6c8'];
      for (const s of [-1, 1]) for (let z = -BZ + 0.3; z < BZ; z += 0.42) b.sph(s * (BX + 0.12 + ((z * 7) % 1) * 0.1), 1.7, z, 0.1, cols[(Math.abs(Math.round(z * 10)) + (s > 0 ? 1 : 0)) % cols.length], { w: 5, h: 4 });
    }
    this._mesh(b.build(), toonMat('#ffffff', { vertexColors: true }), { cast: true, receive: true, name: 'boards' });

    // sponsor panel planes
    const endTex = this._own(makeWallTexture(surface, BX * 2, 2.0, 'end'));
    const sideTex = this._own(makeWallTexture(surface, BZ * 2, 1.2, 'side'));
    const mkPlane = (w, h, tex, x, y, z, ry) => {
      const m = this._mesh(new THREE.PlaneGeometry(w, h), toonMat('#ffffff', { map: tex }), { receive: true, name: 'panel' });
      m.position.set(x, y, z); m.rotation.y = ry; return m;
    };
    mkPlane(BX * 2, 2.0, endTex, 0, 1.0, -BZ + 0.005, 0);
    mkPlane(BX * 2, 2.0, endTex, 0, 1.0, BZ - 0.005, Math.PI);
    mkPlane(BZ * 2, 1.2, sideTex, -BX + 0.005, 0.62, 0, Math.PI / 2);
    mkPlane(BZ * 2, 1.2, sideTex, BX - 0.005, 0.62, 0, -Math.PI / 2);

    // LED ribbons (scrolling, pixelated)
    this.ledCanvas = document.createElement('canvas'); this.ledCanvas.width = 2048; this.ledCanvas.height = 44;
    this.ledTex = this._own(new THREE.CanvasTexture(this.ledCanvas));
    this.ledTex.colorSpace = THREE.SRGBColorSpace; this.ledTex.wrapS = THREE.RepeatWrapping;
    this.ledTex.minFilter = THREE.LinearFilter; this.ledTex.magFilter = THREE.NearestFilter; this.ledTex.generateMipmaps = false;
    const ledMat = this._own(new THREE.MeshBasicMaterial({ map: this.ledTex, toneMapped: false }));
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(this._own(new THREE.PlaneGeometry(BX * 2, 0.44)), ledMat);
      m.position.set(0, 2.23, s * (BZ - 0.008)); m.rotation.y = s < 0 ? 0 : Math.PI; this.group.add(m);
    }
    this.setLed('', true);
  }

  setLed(text, force) {
    if (!force && text === this.led.key) return;
    this.led.key = text;
    const g = this.ledCanvas.getContext('2d'), W = 2048, H = 44, th = this.th;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    g.font = '800 30px Arial Black, Arial, sans-serif'; g.textBaseline = 'middle';
    const unit = text || `${TOURNEY[this.surface].name}  ·  ${TOURNEY[this.surface].sub}`;
    const parts = [unit, 'KORVA', 'BLUMO', unit, 'NIMBLO', 'AEROLY'];
    let x = 14, i = 0;
    const cols = [th.led, '#ffffff', th.led, '#ffffff'];
    while (x < W - 200) {
      const s = parts[i % parts.length]; const w = g.measureText(s).width;
      if (x + w > W - 40) break;
      g.fillStyle = i % parts.length === 0 || i % parts.length === 3 ? th.led : '#dfe8ff'; g.fillText(s, x, H / 2 + 1);
      x += w + 70; i++;
    }
    // dot-matrix darkening
    g.fillStyle = 'rgba(0,0,0,0.38)';
    for (let yy = 0; yy < H; yy += 4) g.fillRect(0, yy + 3, W, 1);
    for (let xx = 0; xx < W; xx += 4) g.fillRect(xx + 3, 0, 1, H);
    this.ledTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- stands
  _buildStands() {
    const th = this.th;
    const b = new GeoBuilder();
    const { treads, lowTopO, upTopO, upTopY } = STANDS;
    const ringTop = (oa, ob, y, col) => {
      const xa = BX + oa, xb = BX + ob, za = BZ + oa, zb = BZ + ob;
      for (const s of [1, -1]) b.quadF([s * xa, y, -zb], [s * xa, y, zb], [s * xb, y, zb], [s * xb, y, -zb], col, 0, 1, 0);
      for (const s of [1, -1]) b.quadF([-xa, y, s * za], [-xa, y, s * zb], [xa, y, s * zb], [xa, y, s * za], col, 0, 1, 0);
    };
    const riser = (o, y0, y1, col) => {
      if (y1 - y0 < 1e-3) return;
      const x = BX + o, z = BZ + o;
      for (const s of [1, -1]) b.quadF([s * x, y0, -z], [s * x, y1, -z], [s * x, y1, z], [s * x, y0, z], col, -s, 0, 0);
      for (const s of [1, -1]) b.quadF([-x, y0, s * z], [-x, y1, s * z], [x, y1, s * z], [x, y0, s * z], col, 0, 0, -s);
    };
    ringTop(0.3, 0.9, 0.02, th.concrete);
    for (const t of treads) {
      const d = t.o1 - t.o0, seat = darken(t.tier === 1 ? th.seat2 : th.seat, 1.8);
      if (t.seat) {
        riser(t.o0, t.yPrev, t.y, t.tier === 1 ? darken(th.seat2, 1.3) : darken(th.seat, 1.3));
        ringTop(t.o0, t.o0 + d * 0.3, t.y, th.concrete);
        ringTop(t.o0 + d * 0.3, t.o1, t.y, ((t.row & 1) ? darken(seat, 1.12) : seat));
      } else { riser(t.o0, t.yPrev, t.y, th.concrete); ringTop(t.o0, t.o1, t.y, th.concrete); }
    }
    // fascia under the upper tier + rear wall + back railing
    const upFirst = treads.find((t) => t.tier === 1);
    riser(upFirst.o0, STANDS.lowTopY, upFirst.y, th.wallLite);
    const roofY = roofHeightAt(upTopO);
    riser(upTopO, upTopY, roofY, th.wall);
    for (const y of [upTopY + 1.6, upTopY + 2.9]) riser(upTopO - 0.01, y, y + 0.28, th.wallLite);
    // dark vomitory openings in the rear wall
    for (let i = -6; i <= 6; i++) {
      const x = i * 5.3;
      b.quadF([x - 1.0, upTopY, -(BZ + upTopO) + 0.02], [x - 1.0, upTopY + 1.6, -(BZ + upTopO) + 0.02], [x + 1.0, upTopY + 1.6, -(BZ + upTopO) + 0.02], [x + 1.0, upTopY, -(BZ + upTopO) + 0.02], '#10131c', 0, 0, 1);
    }
    this._mesh(b.build(), toonMat('#ffffff', { vertexColors: true }), { cast: true, receive: true, name: 'stands' });
    // textured fascia band (tournament/sponsor repeat)
    const tex = this._own(makeWallTexture(this.surface, 12, 1.2, 'fascia')); tex.wrapS = THREE.RepeatWrapping;
    const o = upFirst.o0, h = upFirst.y - STANDS.lowTopY, yc = STANDS.lowTopY + h / 2;
    const planes = [[2 * (BZ + o), BX + o + 0.01, 0, -Math.PI / 2], [2 * (BZ + o), -(BX + o + 0.01), 0, Math.PI / 2], [2 * (BX + o), 0, -(BZ + o + 0.01), 0], [2 * (BX + o), 0, BZ + o + 0.01, Math.PI]];
    for (const [len, x, z, ry] of planes) {
      const t = tex.clone(); t.repeat.x = len / 12; t.needsUpdate = true; this._own(t);
      const m = this._mesh(new THREE.PlaneGeometry(len, h), toonMat('#ffffff', { map: t }), { receive: true, name: 'fascia' });
      m.position.set(x, yc, z); m.rotation.y = ry;
      if (ry === -Math.PI / 2) m.position.x = x; // facing -x towards the court
    }
  }

  // ---------------------------------------------------------------- roof ring, floodlights, video boards
  _buildRoof() {
    const th = this.th;
    const { roofO, roofH, roofOuter, upTopO } = STANDS;
    const ho = roofHeightAt(roofOuter);
    const b = new GeoBuilder();
    const xi = BX + roofO, zi = BZ + roofO, xo = BX + roofOuter, zo = BZ + roofOuter;
    const under = '#d8dce4', top = '#f1f3f6';
    for (const s of [1, -1]) {
      b.quadF([s * xi, roofH, -zi], [s * xo, ho, -zo], [s * xo, ho, zo], [s * xi, roofH, zi], under, 0, -1, 0);
      b.quadF([s * xi, roofH + 0.15, -zi], [s * xo, ho + 0.15, -zo], [s * xo, ho + 0.15, zo], [s * xi, roofH + 0.15, zi], top, 0, 1, 0);
      b.quadF([-xi, roofH, s * zi], [-xo, ho, s * zo], [xo, ho, s * zo], [xi, roofH, s * zi], under, 0, -1, 0);
      b.quadF([-xi, roofH + 0.15, s * zi], [-xo, ho + 0.15, s * zo], [xo, ho + 0.15, s * zo], [xi, roofH + 0.15, s * zi], top, 0, 1, 0);
      // front fascia
      b.quadF([s * xi, roofH, -zi], [s * xi, roofH + 0.9, -zi], [s * xi, roofH + 0.9, zi], [s * xi, roofH, zi], th.wall, -s, 0, 0);
      b.quadF([-xi, roofH, s * zi], [-xi, roofH + 0.9, s * zi], [xi, roofH + 0.9, s * zi], [xi, roofH, s * zi], th.wall, 0, 0, -s);
      b.quadF([s * xi, roofH - 0.02, -zi], [s * xi, roofH + 0.06, -zi], [s * xi, roofH + 0.06, zi], [s * xi, roofH - 0.02, zi], th.accent, -s, 0, 0);
      b.quadF([-xi, roofH - 0.02, s * zi], [-xi, roofH + 0.06, s * zi], [xi, roofH + 0.06, s * zi], [xi, roofH - 0.02, s * zi], th.accent, 0, 0, -s);
    }
    // corner fascia gaps are closed by the four sides meeting at the mitre; add truss struts on the underside
    for (let z = -zi; z <= zi + 0.1; z += 7) for (const s of [1, -1]) b.box(s * (xi + 3.5), roofH + 0.3, z, 7, 0.35, 0.3, '#aab0bd');
    for (let x = -xi; x <= xi + 0.1; x += 7) for (const s of [1, -1]) b.box(x, roofH + 0.3, s * (zi + 3.5), 0.3, 0.35, 7, '#aab0bd');
    this._mesh(b.build(), toonMat('#ffffff', { vertexColors: true, side: THREE.DoubleSide }), { cast: true, receive: false, name: 'roof' });

    // floodlight banks (instanced emissive panels)
    const lampTex = this._own(canvasTex(128, 96, (g, W, H) => {
      g.fillStyle = '#2a2d36'; g.fillRect(0, 0, W, H);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { g.fillStyle = '#fffbe8'; g.beginPath(); g.arc(18 + c * 30.5, 16 + r * 31, 11, 0, 7); g.fill(); }
    }, { aniso: false }));
    const lamps = [];
    for (let z = -zi + 3; z < zi - 2; z += 6.3) for (const s of [1, -1]) lamps.push([s * (xi - 0.8), roofH - 0.5, z, s > 0 ? -Math.PI / 2 : Math.PI / 2]);
    for (let x = -xi + 5; x < xi - 4; x += 6.3) for (const s of [1, -1]) lamps.push([x, roofH - 0.5, s * (zi - 0.8), s > 0 ? Math.PI : 0]);
    const im = new THREE.InstancedMesh(this._own(new THREE.PlaneGeometry(2.6, 1.9)), this._own(new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false })), lamps.length);
    const dummy = new THREE.Object3D();
    lamps.forEach((l, i) => { dummy.position.set(l[0], l[1], l[2]); dummy.rotation.set(0.45, l[3], 0, 'YXZ'); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    this.group.add(im);

    // video boards
    this.boardCanvas = document.createElement('canvas'); this.boardCanvas.width = 1024; this.boardCanvas.height = 512;
    this.boardTex = this._own(new THREE.CanvasTexture(this.boardCanvas)); this.boardTex.colorSpace = THREE.SRGBColorSpace; this.boardTex.anisotropy = gfxState.maxAniso;
    const bMat = this._own(new THREE.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }));
    const fr = new GeoBuilder();
    const boards = [[0, roofH - 5.4, -zi + 0.9, 0, 10, 5], [-xi + 0.9, roofH - 5.0, 0, Math.PI / 2, 9, 4.5], [xi - 0.9, roofH - 5.0, 0, -Math.PI / 2, 9, 4.5]];
    for (const [x, y, z, ry, w, h] of boards) {
      const m = new THREE.Mesh(this._own(new THREE.PlaneGeometry(w, h)), bMat);
      m.position.set(x, y + h / 2, z); m.rotation.y = ry; this.group.add(m);
      fr.pushT(x, y + h / 2, z, ry); fr.box(0, 0, -0.12, w + 0.5, h + 0.5, 0.2, '#191c24'); fr.box(0, h / 2 + 0.55, -0.1, 0.12, 1.2, 0.12, '#444'); fr.pop();
      for (const sx of [-1, 1]) { fr.pushT(x, y + h / 2, z, ry); fr.box(sx * (w / 2 - 0.3), h / 2 + 0.6, -0.1, 0.15, 1.2, 0.15, '#444'); fr.pop(); }
    }
    this._mesh(fr.build(), toonMat('#ffffff', { vertexColors: true }), { name: 'boardFrames' });
    this.setBoard({ names: ['你', 'AI'], sets: [], games: [0, 0], points: ['0', '0'], server: 0, msg: TOURNEY[this.surface].name }, true);
  }

  setBoard(d, force) {
    const key = JSON.stringify(d);
    if (!force && key === this.board.key) return;
    this.board.key = key;
    const g = this.boardCanvas.getContext('2d'), W = 1024, H = 512, th = this.th;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, th.wallLite); gr.addColorStop(1, th.wall);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = th.accent; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = th.text;
    g.font = '800 44px Arial Black, Arial, sans-serif'; g.fillText(TOURNEY[this.surface].name, W / 2, 52);
    const rows = [0, 1];
    const nsets = Math.max(d.sets.length, 0);
    g.font = '800 70px Arial Black, "PingFang SC", "Microsoft YaHei", sans-serif';
    rows.forEach((i) => {
      const y = 170 + i * 112;
      g.fillStyle = 'rgba(0,0,0,0.3)'; roundRect(g, 60, y - 48, W - 120, 98, 20); g.fill();
      g.textAlign = 'left'; g.fillStyle = th.text; g.fillText(d.names[i], 130, y + 2);
      if (d.server === i) { g.fillStyle = '#ffe14a'; g.beginPath(); g.arc(98, y + 2, 14, 0, 7); g.fill(); }
      g.textAlign = 'center';
      let x = 520;
      for (const s of d.sets) { g.fillStyle = th.text; g.fillText(String(s[i]), x, y + 2); x += 90; }
      g.fillStyle = th.accent; g.fillText(String(d.games[i]), x, y + 2); x += 110;
      g.fillStyle = '#ffffff'; roundRect(g, x - 10, y - 40, 150, 82, 16); g.fill(); g.fillStyle = '#10204a'; g.fillText(String(d.points[i]), x + 65, y + 2);
    });
    g.fillStyle = th.text; g.font = '700 44px "PingFang SC","Microsoft YaHei",sans-serif'; g.textAlign = 'center';
    g.fillText(d.msg || '', W / 2, 440);
    this.boardTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- shot clocks
  _buildClocks() {
    this.clockCanvas = document.createElement('canvas'); this.clockCanvas.width = 160; this.clockCanvas.height = 80;
    this.clockTex = this._own(new THREE.CanvasTexture(this.clockCanvas)); this.clockTex.colorSpace = THREE.SRGBColorSpace; this.clockTex.minFilter = THREE.LinearFilter; this.clockTex.generateMipmaps = false;
    const mat = this._own(new THREE.MeshBasicMaterial({ map: this.clockTex, toneMapped: false }));
    const pb = new GeoBuilder();
    for (const [x, z, face] of [[-8.9, -BZ + 0.7, 0], [8.9, -BZ + 0.7, 0], [-8.9, BZ - 0.7, Math.PI], [8.9, BZ - 0.7, Math.PI]]) {
      pb.cyl(x, 1.4, z, 0.06, 0.07, 2.8, '#2b2f38');
      pb.box(x, 3.15, z, 1.9, 0.95, 0.2, '#14161b');
      const m = new THREE.Mesh(this._own(new THREE.PlaneGeometry(1.76, 0.8)), mat);
      m.position.set(x, 3.15, z + (face ? -0.105 : 0.105)); m.rotation.y = face; this.group.add(m);
    }
    this._mesh(pb.build(), toonMat('#ffffff', { vertexColors: true }), { cast: true, name: 'clockPosts' });
    this.drawClock(-1);
  }
  drawClock(v) {
    if (v === this.clock.shown) return;
    this.clock.shown = v;
    const g = this.clockCanvas.getContext('2d');
    g.fillStyle = '#0a0b0e'; g.fillRect(0, 0, 160, 80);
    g.font = '800 52px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = v < 0 ? '#3a1d10' : (v <= 5 ? '#ff4d3a' : '#ffb347');
    g.fillText(v < 0 ? '--' : String(v).padStart(2, '0'), 80, 44);
    g.fillStyle = '#9aa4b8'; g.font = '700 12px sans-serif'; g.fillText('SERVE CLOCK', 80, 11);
    this.clockTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- props: posts, chair, benches, people, cameras
  _buildProps() {
    const th = this.th, b = new GeoBuilder();
    const dark = '#272b35', navy = th.wall;
    // net posts + singles sticks + band cap
    for (const s of [-1, 1]) {
      b.cyl(s * 6.4, 0.58, 0, 0.055, 0.065, 1.16, '#30343e', { seg: 10 }); b.sph(s * 6.4, 1.17, 0, 0.07, '#30343e', { w: 8, h: 6 });
      b.cyl(s * COURT.netPostX, 0.54, 0, 0.026, 0.026, 1.08, '#e9ecef', { seg: 6 });
      b.box(s * 6.4, 0.02, 0, 0.3, 0.04, 0.3, '#30343e');
    }
    // umpire chair (faces +x)
    b.pushT(CHAIR_X, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.42, 1.1, sz * 0.4, 0.04, 0.05, 2.2, dark, { seg: 6 });
    for (const y of [0.5, 1.2, 1.9]) { b.box(0, y, 0.4, 0.84, 0.04, 0.04, dark); b.box(0, y, -0.4, 0.84, 0.04, 0.04, dark); b.box(0.42, y, 0, 0.04, 0.04, 0.8, dark); b.box(-0.42, y, 0, 0.04, 0.04, 0.8, dark); }
    b.box(0, 2.2, 0, 1.0, 0.1, 0.96, navy); b.box(0, 2.25, 0.0, 0.62, 0.1, 0.56, th.accent);
    b.box(0, 2.62, -0.28, 0.6, 0.7, 0.08, th.accent); b.box(0, 2.62, -0.33, 0.66, 0.76, 0.05, navy);
    b.box(0, 2.6, 0.62, 1.1, 0.06, 0.34, '#f1f3f6'); b.box(0.0, 2.95, 0.68, 0.03, 0.34, 0.03, '#999');
    b.box(-0.5, 2.8, 0.0, 0.05, 0.62, 0.9, dark); b.box(0.5, 2.8, 0.0, 0.05, 0.62, 0.9, dark);   // arm rails
    // steps on the back
    for (let i = 0; i < 4; i++) b.box(0, 0.35 + i * 0.5, -0.78 - 0.08 * (3 - i) * 0 - i * 0.0, 0.7, 0.05, 0.3, '#c9ccd4');
    b.cyl(0, 3.55, 0.0, 0.03, 0.03, 1.5, '#bbb', { seg: 6 });
    b.cyl(0, 4.3, 0, 0.02, 1.35, 0.5, '#f3f3ef', { seg: 12 }); b.cyl(0, 4.1, 0, 1.35, 1.35, 0.04, th.accent, { seg: 12 });
    addPerson(b, { x: 0, y: 2.33, z: 0.05, yaw: 0, pose: 'sit', shirt: '#f4f4f1', shorts: '#27304f', cap: '#f4f4f1', skin: '#d9a074', tie: null });
    b.pop();
    // player benches (face +x) with towel / bag / cooler
    for (const sz of [-1, 1]) {
      b.pushT(PLAYER_BENCH_X, 0, sz * 4.6, Math.PI / 2);
      b.box(0, 0.46, 0, 2.3, 0.1, 0.56, '#e7e9ee'); b.box(0, 0.4, 0, 2.3, 0.04, 0.6, th.accent);
      b.box(0, 0.86, -0.27, 2.3, 0.62, 0.07, navy); b.box(0, 0.86, -0.3, 2.3, 0.18, 0.05, th.accent);
      for (const lx of [-1.05, 1.05]) { b.box(lx, 0.22, -0.2, 0.07, 0.44, 0.07, dark); b.box(lx, 0.22, 0.2, 0.07, 0.44, 0.07, dark); b.box(lx, 0.8, -0.27, 0.07, 0.8, 0.07, dark); }
      // towel on the bench, folded; sports bag on the floor; shoes
      b.box(0.55, 0.54, 0.0, 0.5, 0.06, 0.36, '#ffffff'); b.box(0.55, 0.575, 0.0, 0.5, 0.01, 0.1, th.accent);
      b.box(-0.5, 0.58, 0.05, 0.5, 0.14, 0.32, sz > 0 ? '#e84a4a' : '#3fa0e0');
      b.box(-0.95, 0.2, 0.62, 0.95, 0.38, 0.4, sz > 0 ? '#e84a4a' : '#3fa0e0'); b.box(-0.95, 0.2, 0.62, 0.96, 0.08, 0.42, '#f4f4f4'); b.box(-0.95, 0.4, 0.62, 0.3, 0.03, 0.08, '#222');
      b.box(0.6, 0.08, 0.7, 0.3, 0.16, 0.3, '#efefef');   // spare shoe box
      // racket sticking out of the bag
      b.cyl(-1.25, 0.6, 0.62, 0.012, 0.012, 0.7, '#ccc', { seg: 4, rz: 0.4 }); b.sph(-1.45, 0.98, 0.62, 0.15, '#ddd', { w: 8, h: 6, sz: 0.16 });
      b.pop();
      // cooler + drinks table between chair and bench
      b.box(PLAYER_BENCH_X - 0.2, 0.28, sz * 2.0, 0.62, 0.56, 0.42, '#f4f6f8'); b.box(PLAYER_BENCH_X - 0.2, 0.58, sz * 2.0, 0.66, 0.06, 0.46, '#2f6db4');
      b.cyl(PLAYER_BENCH_X - 0.2, 0.7, sz * 2.0 + 0.1, 0.05, 0.04, 0.16, '#f2c230', { seg: 6 }); b.cyl(PLAYER_BENCH_X - 0.1, 0.7, sz * 2.0 - 0.1, 0.05, 0.04, 0.16, '#ffffff', { seg: 6 });
    }
    // towel boxes at the four back corners + near the net on the right
    for (const [x, z] of [[-9.6, -15.6], [9.6, -15.6], [-9.6, 15.6], [9.6, 15.6], [7.5, 2.4], [7.5, -2.4]]) { b.box(x, 0.3, z, 0.5, 0.6, 0.42, navy); b.box(x, 0.62, z, 0.5, 0.05, 0.44, th.accent); b.box(x, 0.68, z, 0.4, 0.06, 0.3, '#fff'); }
    // ball kids (crouched at the net posts + back corners)
    const kidShirt = th.accent, kidShorts = darken(th.wall, 0.8);
    for (const [x, z, yaw] of [[6.95, 0.7, -Math.PI / 2], [6.95, -0.7, -Math.PI / 2], [-6.95, 0.8, Math.PI / 2], [-6.95, -0.8, Math.PI / 2], [4.2, -17.4, 0], [-4.2, 17.4, Math.PI]]) {
      addPerson(b, { x, y: 0, z, yaw, s: 0.78, pose: 'crouch', shirt: kidShirt, shorts: kidShorts, cap: th.wall, skin: ['#e8b88f', '#c68d5e', '#f2cdb0'][Math.abs((x * 7 + z * 3) | 0) % 3] });
    }
    // line judges (seated) on small folding stools
    const judges = [[-3.4, -BZ + 0.9, 0], [3.4, -BZ + 0.9, 0], [-3.4, BZ - 0.9, Math.PI], [3.4, BZ - 0.9, Math.PI],
      [BX - 0.9, -12.6, -Math.PI / 2], [BX - 0.9, 12.6, -Math.PI / 2], [BX - 0.9, -6.6, -Math.PI / 2], [BX - 0.9, 6.6, -Math.PI / 2], [-BX + 0.9, -12.6, Math.PI / 2], [-BX + 0.9, 12.6, Math.PI / 2]];
    judges.forEach(([x, z, yaw], i) => {
      b.pushT(x, 0, z, yaw);
      b.box(0, 0.24, 0, 0.4, 0.04, 0.4, '#30343e'); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.17, 0.11, sz * 0.17, 0.015, 0.015, 0.24, '#30343e', { seg: 4 });
      addPerson(b, { x: 0, y: 0.34, z: -0.02, pose: 'sit', shirt: '#1e2f5a', shorts: '#d9d9d2', cap: i % 2 ? '#1e2f5a' : null, hair: '#3b2616', skin: ['#e8b88f', '#c68d5e', '#f2cdb0'][i % 3] });
      b.pop();
    });
    // photographers kneeling behind the baselines
    [[6.2, -17.35, 0], [8.0, -17.35, 0], [-8.2, -17.35, 0], [-6.4, -17.35, 0], [6.4, 17.35, Math.PI], [8.2, 17.35, Math.PI], [-8.0, 17.35, Math.PI], [-6.2, 17.35, Math.PI]].forEach(([x, z, yaw], i) => {
      addPerson(b, { x, y: 0, z, yaw, s: 0.95, pose: 'kneel', shirt: ['#3a3f4c', '#7a8aa0', '#8c4a3a', '#3f6a58'][i % 4], shorts: '#2a2d36', cap: i % 3 === 0 ? '#2a2d36' : null, hair: '#2b1c12' });
    });
    // TV camera on a tripod behind the far baseline, operator beside it
    b.pushT(-3.0, 0, -17.0, 0);
    for (const a of [0, 2.1, 4.2]) b.cyl(Math.sin(a) * 0.3, 0.6, Math.cos(a) * 0.3, 0.015, 0.02, 1.25, '#222', { seg: 4, rz: Math.sin(a) * 0.2, rx: Math.cos(a) * 0.2 });
    b.box(0, 1.35, 0.05, 0.28, 0.26, 0.55, '#d9dde4'); b.cyl(0, 1.38, 0.5, 0.07, 0.1, 0.35, '#1b1d22', { seg: 8, rx: Math.PI / 2 }); b.sph(0, 1.38, 0.7, 0.08, '#2a3550', { w: 8, h: 6 });
    addPerson(b, { x: 0.65, y: 0, z: -0.1, yaw: -0.4, pose: 'stand', shirt: '#e84a4a', shorts: '#2a2d36', cap: '#2a2d36' });
    b.pop();
    this.props = this._mesh(b.build(), toonMat('#ffffff', { vertexColors: true }), { cast: true, receive: true, name: 'props' });
  }

  // ---------------------------------------------------------------- ball marks on the surface (pooled)
  _buildMarks() {
    const N = 40;
    const g = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const im = new THREE.InstancedMesh(this._own(g), this._own(mat), N);
    im.frustumCulled = false; im.count = N; im.renderOrder = 1;
    const m = new THREE.Matrix4(); m.makeScale(0, 0, 0);
    const col = new THREE.Color(0, 0, 0);
    for (let i = 0; i < N; i++) { im.setMatrixAt(i, m); im.setColorAt(i, col); }
    this.group.add(im);
    this.marks = { im, N, next: 0, age: new Float32Array(N).fill(99), data: new Float32Array(N * 4), life: this.surface === 'clay' ? 30 : this.surface === 'grass' ? 14 : 6, base: new THREE.Color(this.look.mark) };
    this.marks.fade = new THREE.Color(this.surface === 'clay' ? this.look.court : this.look.court);
    this._tmpM = new THREE.Matrix4(); this._tmpC = new THREE.Color(); this._tmpV = new THREE.Vector3(); this._tmpQ = new THREE.Quaternion(); this._tmpS = new THREE.Vector3();
  }
  addMark(x, z, speed) {
    const mk = this.marks; const i = mk.next; mk.next = (mk.next + 1) % mk.N;
    mk.age[i] = 0; mk.data[i * 4] = x; mk.data[i * 4 + 1] = z; mk.data[i * 4 + 2] = 0.05 + Math.min(0.06, speed * 0.0012); mk.data[i * 4 + 3] = Math.random() * 6;
  }
  _updateMarks(dt) {
    const mk = this.marks; let dirty = false;
    for (let i = 0; i < mk.N; i++) {
      if (mk.age[i] > mk.life + 1) continue;
      mk.age[i] += dt; dirty = true;
      const a = mk.age[i], f = Math.min(1, a / mk.life);
      const r = mk.data[i * 4 + 2] * (1 + Math.min(a, 0.2) * 2);
      this._tmpV.set(mk.data[i * 4], 0.006, mk.data[i * 4 + 1]);
      this._tmpS.set(a > mk.life ? 0 : r * 1.5, 1, a > mk.life ? 0 : r);
      this._tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, mk.data[i * 4 + 3] * 0.2);
      mk.im.setMatrixAt(i, this._tmpM.compose(this._tmpV, this._tmpQ, this._tmpS));
      this._tmpC.copy(this.surface === 'clay' ? new THREE.Color(this.look.bounce) : mk.base).lerp(mk.fade, f);
      mk.im.setColorAt(i, this._tmpC);
    }
    if (dirty) { mk.im.instanceMatrix.needsUpdate = true; if (mk.im.instanceColor) mk.im.instanceColor.needsUpdate = true; }
  }

  // ---------------------------------------------------------------- per-frame
  update(dt, state) {
    this.crowd.update(dt);
    this.ledTex.offset.x = (this.ledTex.offset.x + dt * 0.012) % 1;
    this._updateMarks(dt);
    if (state && state.match) {
      const m = state.match;
      if (m.phase === 'serve-prep') { if (this.clock.phase !== 'serve-prep') this.clock.value = 25; this.clock.value = Math.max(0, this.clock.value - dt * (state.timeScale || 1)); this.drawClock(Math.ceil(this.clock.value)); }
      else if (m.phase === 'serving') this.drawClock(Math.ceil(this.clock.value));
      else this.drawClock(-1);
      this.clock.phase = m.phase;
    }
  }

  dispose() {
    for (const d of this.disposables) { if (d.map) d.map.dispose?.(); d.dispose?.(); }
    this.crowd.dispose();
  }
}
