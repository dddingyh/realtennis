// Body geometry: skinned, merged, palette-coloured. Torso, outfit (polo/tee, shorts, pleated skirt, vest), limbs, socks,
// chunky shoes, mitten hands, sculpted anime head with ears, hair and headwear; plus the face decal surface.
import * as THREE from 'three';
import { Merge, SLOT, tube, ellipsoid, sweep, prof, sst, lerp, clamp, blend2, makeHead, HEAD_T } from './sculpt.js';
import { BI, DIMS, makeBones, restPositions } from './dims.js';
import { buildHair } from './hair.js';

const V = THREE.Vector3;
const ring = (y, rx, rz, slot, o) => Object.assign({ y, rx, rz, slot }, o || {});

// piecewise-linear interpolation over [[x, a, b], ...]
function interp3(tabl, x) {
  if (x <= tabl[0][0]) return [tabl[0][1], tabl[0][2]];
  for (let i = 1; i < tabl.length; i++) if (x <= tabl[i][0]) {
    const p = tabl[i - 1], q = tabl[i], t = (x - p[0]) / (q[0] - p[0]);
    const s = t * t * (3 - 2 * t);
    return [lerp(p[1], q[1], s), lerp(p[2], q[2], s)];
  }
  const l = tabl[tabl.length - 1]; return [l[1], l[2]];
}

export const BUILDS = { slim: 0.94, athletic: 1.0, sturdy: 1.1 };

export function buildBody(look, D) {
  const M = new Merge();
  const bones = makeBones(D);
  const R = restPositions(bones);
  const bw = BUILDS[look.build] || 1;
  const hip0 = D.hip0, yS = D.shoulderY, Lt = yS - hip0;
  const SK = SLOT.skin, SH = SLOT.shirt, SHO = SLOT.shorts, TR = SLOT.trim, AC = SLOT.band, WH = SLOT.white;
  const chibi = D.id === 'chibi';
  const skirt = !!look.skirt, sleeveless = !!look.sleeveless;
  const spineY = R[BI.spine].y, chestY = R[BI.chest].y, neckY = R[BI.neck].y, headY = R[BI.head].y;
  const P = BI.pelvis, SP = BI.spine, CH = BI.chest;

  // ------------------------------------------------------------------ torso
  const wTorso = (y) => {
    const a = sst(hip0 - 0.01, spineY + 0.02, y), b = sst(spineY, chestY + 0.04, y);
    return [P, 1 - a, SP, a * (1 - b), CH, a * b];
  };
  const crotch = chibi ? 0.07 : 0.09;
  const tt = [ // frac of torso length (0 = pelvis bone, 1 = shoulder line), half width, half depth
    [-crotch / Lt, D.hipW * 0.7 * bw, D.hipD * 0.7],
    [-crotch * 0.45 / Lt, D.hipW * bw, D.hipD],
    [0.1, D.hipW * 0.99 * bw, D.hipD * 0.98],
    [0.3, D.waistW * bw, D.waistD],
    [0.6, lerp(D.waistW, D.chestW, 0.65) * bw, lerp(D.waistD, D.chestD, 0.65)],
    [0.82, D.chestW * bw, D.chestD],
    [0.97, D.chestW * 0.9 * bw, D.chestD * 0.8],
    [1.07, D.neckR * 1.9, D.neckR * 1.7],
  ];
  const fAt = (f) => hip0 + f * Lt;
  const rg = (f, slot, o) => { const [rx, rz] = interp3(tt, f); return ring(fAt(f), rx, rz, slot, o); };
  const splitF = 0.2;
  const blockOn = !!look.block;
  const rings = [];
  rings.push(ring(fAt(-crotch / Lt) - 0.0, 0, 0, SHO));
  for (const f of [-crotch * 0.7 / Lt, -crotch * 0.2 / Lt, 0.1, splitF - 0.02]) rings.push(rg(f, SHO));
  {
    const [rx, rz] = interp3(tt, splitF);
    rings.push(ring(fAt(splitF), rx, rz, SHO));
    rings.push(ring(fAt(splitF), rx + 0.007, rz + 0.007, SH));
  }
  const upper = [0.3, 0.45, 0.6, 0.72, 0.82, 0.9, 0.97, 1.07];
  for (const f of upper) {
    const slot = blockOn && f >= 0.58 && f <= 0.83 ? AC : SH;
    if (blockOn && (f === 0.6 || f === 0.72 || f === 0.82)) { /* band rings handled below */ }
    rings.push(rg(f, slot, { ao: f > 1.0 ? 1 : 0 }));
  }
  rings.push(ring(fAt(1.1), 0, 0, SH));
  // block-colour chest band: hard splits at fixed heights
  if (blockOn) {
    const splitAt = (f) => { const i = rings.findIndex((r) => Math.abs(r.y - fAt(f)) < 1e-6); return i; };
    void splitAt;
  }
  tube(M, bandify(rings, blockOn ? [[fAt(0.6), fAt(0.8)]] : [], AC, tt, fAt), { N: 18, wt: wTorso });

  // trim ring at the shirt hem (white band)
  // collar (polo) ring around the neck base
  {
    const nb = yS + 0.005;
    const c = [ring(nb - 0.02, D.neckR + 0.05, D.neckR + 0.04, TR), ring(nb + 0.012, D.neckR + 0.034, D.neckR + 0.028, TR), ring(nb + 0.04, D.neckR + 0.016, D.neckR + 0.014, TR)];
    if (look.collar !== false) tube(M, c, { N: 14, wt: CH });
    // front flaps
    for (const s of [-1, 1]) {
      sweep(M, { pts: [[s * 0.012, nb + 0.035, D.neckR + 0.018], [s * (D.neckR + 0.03), nb + 0.0, D.neckR + 0.034], [s * (D.neckR + 0.062), nb - 0.026, D.neckR * 0.8 + 0.02]], rings: 5, segs: 4, slot: TR, w: (t) => 0.022 * (1 - 0.5 * t), th: () => 0.005, hint: () => new V(0, 0, 1), wt: CH, noHl: true });
    }
  }

  // ------------------------------------------------------------------ vest / jacket
  if (look.jacket) {
    const VS = SLOT.hair3;
    const vr = [];
    for (const f of [-0.02, 0.1, 0.3, 0.6, 0.82, 0.97]) { const [rx, rz] = interp3(tt, f); vr.push(ring(fAt(f), rx * bw + 0.012, rz + 0.012, VS)); }
    tube(M, vr, { N: 22, arc: [0.5, Math.PI * 2 - 0.5], wt: wTorso });
  }

  // ------------------------------------------------------------------ skirt
  if (skirt) {
    const top = fAt(0.17), hem = hip0 - (chibi ? 0.17 : 0.215);
    const rt = interp3(tt, 0.17);
    const flare = chibi ? 0.235 : 0.205;
    const mk = (y, k) => {
      const v = (top - y) / (top - hem);
      const rx = lerp(rt[0] + 0.012, flare, Math.pow(v, 0.8)), rz = lerp(rt[1] + 0.012, flare * 0.92, Math.pow(v, 0.8));
      return ring(y, rx, rz, SHO, { mod: [0.05 + 0.07 * v, 9, 0.2], ao: 0 });
    };
    const sr = [mk(top, 0), mk(lerp(top, hem, 0.35)), mk(lerp(top, hem, 0.7)), mk(hem + 0.03)];
    const hr = mk(hem + 0.03); // trim band split
    const band = Object.assign({}, hr, { y: hem + 0.03, slot: AC });
    const hemRing = Object.assign({}, mk(hem), { slot: AC });
    const hemRing2 = Object.assign({}, mk(hem), { slot: SHO, rx: hemRing.rx, rz: hemRing.rz });
    void hemRing2;
    sr.push(band, hemRing);
    const wSk = (y, x) => {
      const v = clamp((top - y) / (top - hem), 0, 1);
      const th = x > 0 ? BI.thighD : BI.thighN;
      return [P, 1 - 0.85 * v, BI.skirt, 0.5 * v, th, 0.35 * v * Math.min(1, Math.abs(x) / 0.06)];
    };
    tube(M, sr, { N: 36, wt: wSk });
  }

  // ------------------------------------------------------------------ neck
  {
    const yTop = headY + D.chinY + 0.03, yBot = neckY - 0.05;
    const wN = (y) => { const a = sst(neckY - 0.05, neckY, y), b = sst(neckY, headY + 0.03, y); return [CH, 1 - a, BI.neck, a * (1 - b), BI.head, a * b]; };
    const nr = [ring(yBot, D.neckR * 1.15, D.neckR * 1.1, SK, { soft: 1 }), ring(lerp(yBot, yTop, 0.5), D.neckR, D.neckR * 0.95, SK, { soft: 1, ao: 1 }), ring(yTop, D.neckR * 0.95, D.neckR * 0.9, SK, { soft: 1, ao: 1 })];
    tube(M, nr, { N: 10, wt: wN });
  }

  // ------------------------------------------------------------------ arms + hands
  const jointBlend = (b0, b1, yJ, w) => blend2(b1, b0, yJ - w, yJ + w); // b0 above the joint
  for (const s of ['D', 'N']) {
    const sg = s === 'D' ? 1 : -1;
    const ua = BI['ua' + s], fa = BI['fa' + s], hd = BI['hand' + s], cl = BI['clav' + s];
    const cx = sg * (D.clavX + D.uaX);
    const yE = yS - D.ua, yW = yS - D.ua - D.fa;
    const ar = D.armR * bw;
    const jb = jointBlend(ua, fa, yE, chibi ? 0.045 : 0.05);
    const wArm = (y) => (y > yS - 0.015 ? [ua, 0.72, cl, 0.28] : jb(y));
    const sl = sleeveless ? SK : SLOT.sleeve;
    const sleeveEnd = yS - D.ua * (chibi ? 0.55 : 0.5);
    const rr = [];
    rr.push(ring(yS + 0.03, 0, 0, sl));
    rr.push(ring(yS + 0.022, ar * 0.72, ar * 0.72, sl));
    rr.push(ring(yS + 0.002, ar * 1.12, ar * 1.12, sl));
    rr.push(ring(yS - 0.04, ar * 1.08, ar * 1.08, sl));
    if (sleeveless) {
      rr.push(ring(yS - D.ua * 0.5, ar * 0.95, ar * 0.95, SK));
    } else {
      rr.push(ring(sleeveEnd + 0.028, ar * 1.06, ar * 1.06, sl));
      rr.push(ring(sleeveEnd + 0.028, ar * 1.08, ar * 1.08, TR));
      rr.push(ring(sleeveEnd - 0.012, ar * 1.08, ar * 1.08, TR));
      rr.push(ring(sleeveEnd - 0.012, ar * 0.9, ar * 0.9, SK));
    }
    rr.push(ring(yE + 0.03, ar * 0.84, ar * 0.84, SK));
    rr.push(ring(yE - 0.01, D.wristR * 1.55, D.wristR * 1.5, SK));
    rr.push(ring(yE - D.fa * 0.5, D.wristR * 1.3, D.wristR * 1.25, SK));
    rr.push(ring(yW + 0.095, D.wristR * 1.12, D.wristR * 1.1, SK));
    // wristband
    rr.push(ring(yW + 0.075, D.wristR * 1.15, D.wristR * 1.12, SK));
    rr.push(ring(yW + 0.075, D.wristR * 1.35, D.wristR * 1.32, AC));
    rr.push(ring(yW + 0.03, D.wristR * 1.35, D.wristR * 1.32, AC));
    rr.push(ring(yW + 0.03, D.wristR * 1.1, D.wristR * 1.08, SK));
    rr.push(ring(yW - 0.005, D.wristR * 1.0, D.wristR * 0.95, SK));
    rr.push(ring(yW - 0.012, 0, 0, SK));
    tube(M, rr, { N: 10, wt: wArm, hlTop: true, cx });
    // fix cx: tube uses ring.cx, so shift via origin trick below
    // (cx handled by translating the last-added vertices)
    shiftLast(M, rr.length * 10, cx);
    // fist + thumb + finger curl
    const hk = D.handK, hy = -D.palm;
    const hx = (x) => sg * x;
    const hp = R[hd];
    const place = (c) => [hp.x + hx(c[0]), hp.y + c[1], hp.z + c[2]];
    ellipsoid(M, place([0, hy * 0.98, 0]), [0.047 * hk, 0.062 * hk, 0.058 * hk], { lat: 7, lon: 10, slot: SK, wt: hd });
    ellipsoid(M, place([-0.036 * hk * 1, hy * 0.62, 0.03 * hk]), [0.022 * hk, 0.03 * hk, 0.02 * hk], { lat: 5, lon: 8, slot: SK, wt: hd, rot: [0.3, 0, hx(-0.5)] }); // thumb
    for (let k = 0; k < 4; k++) ellipsoid(M, place([-0.03 * hk, hy * 1.18, (-0.039 + k * 0.026) * hk]), [0.021 * hk, 0.02 * hk, 0.0145 * hk], { lat: 4, lon: 7, slot: SK, wt: hd, ao: (nx, ny) => (ny < -0.2 ? 1 : 0) });
  }

  // ------------------------------------------------------------------ legs + shoes
  for (const s of ['D', 'N']) {
    const sg = s === 'D' ? 1 : -1;
    const th = BI['thigh' + s], sh = BI['shin' + s], ft = BI['foot' + s];
    const cx = sg * D.legX;
    const kneeY = hip0 - D.hipOff - D.thigh, ankleY = D.ankleH;
    const jb = jointBlend(th, sh, kneeY, chibi ? 0.05 : 0.055);
    const wLeg = (y) => (y > hip0 - 0.045 ? [th, 0.78, P, 0.22] : jb(y));
    const tr = D.thighR * bw;
    const hem = skirt ? 0 : hip0 - (chibi ? 0.165 : 0.26);
    const sockTop = ankleY + (kneeY - ankleY) * (chibi ? 0.55 : 0.45);
    const lg = [];
    lg.push(ring(hip0 + 0.01, tr * 0.95, tr * 0.95, SHO));
    lg.push(ring(hip0 - 0.07, tr * 1.04, tr * 1.04, SHO));
    if (!skirt) {
      lg.push(ring(hem + 0.02, tr * 1.1, tr * 1.1, SHO));
      lg.push(ring(hem, tr * 1.14, tr * 1.14, SHO));
      lg.push(ring(hem, tr * 0.93, tr * 0.93, SK));
    } else {
      lg.push(ring(hip0 - 0.11, tr * 0.98, tr * 0.98, SK));
    }
    lg.push(ring(lerp(hem || hip0 - 0.12, kneeY, 0.5), tr * 0.86, tr * 0.86, SK));
    lg.push(ring(kneeY + 0.02, D.calfR * 1.12, D.calfR * 1.1, SK));
    lg.push(ring(kneeY - 0.045, D.calfR * 1.12, D.calfR * 1.12, SK));
    lg.push(ring(kneeY - (kneeY - ankleY) * 0.35, D.calfR * 1.1, D.calfR * 1.08, SK));
    lg.push(ring(sockTop + 0.045, D.calfR * 0.98, D.calfR * 0.96, SK));
    lg.push(ring(sockTop + 0.03, D.calfR * 1.0, D.calfR * 0.98, SK));
    lg.push(ring(sockTop + 0.03, D.calfR * 1.12, D.calfR * 1.1, AC));
    lg.push(ring(sockTop, D.calfR * 1.12, D.calfR * 1.1, AC));
    lg.push(ring(sockTop, D.calfR * 1.06, D.calfR * 1.04, WH));
    lg.push(ring(ankleY + 0.03, D.ankleR * 1.15, D.ankleR * 1.12, WH));
    lg.push(ring(ankleY - 0.01, D.ankleR * 1.1, D.ankleR * 1.08, WH));
    lg.push(ring(ankleY - 0.02, 0, 0, WH));
    const n0 = M.count;
    tube(M, lg.map((r) => Object.assign(r, { cx })), { N: 10, wt: wLeg });
    void n0;
    // chunky shoe (foot bone local, +z toe)
    const k = D.shoeK, fp = R[ft];
    const at = (x, y, z) => [fp.x + sg * x * 0 + x, fp.y + y, fp.z + z];
    const aH = D.ankleH;
    const SHOE = SLOT.shoes;
    ellipsoid(M, at(0, -aH + 0.016, 0.07 * k), [0.066 * k, 0.017 * k + 0.005, 0.155 * k], { lat: 6, lon: 12, slot: SLOT.sole, wt: ft });
    ellipsoid(M, at(0, -aH * 0.5 + 0.012, 0.055 * k), [0.058 * k, aH * 0.62 + 0.012, 0.125 * k], { lat: 7, lon: 12, slot: SHOE, wt: ft, ao: (nx, ny, nz) => (ny < -0.45 ? 1 : 0), hl: (nx, ny, nz) => (ny > 0.55 && nz > -0.1 ? 1 : 0) });
    ellipsoid(M, at(0, -aH * 0.62 + 0.01, 0.15 * k), [0.054 * k, aH * 0.5 + 0.01, 0.07 * k], { lat: 6, lon: 10, slot: SHOE, wt: ft });
    ellipsoid(M, at(0, aH * 0.02, 0.07 * k), [0.04 * k, 0.014 * k, 0.05 * k], { lat: 4, lon: 8, slot: AC, wt: ft }); // tongue / lace panel
    ellipsoid(M, at(0, -aH * 0.45, -0.045 * k), [0.04 * k, 0.04 * k, 0.014 * k], { lat: 4, lon: 8, slot: AC, wt: ft }); // heel tab
    ellipsoid(M, at(sg * 0.055 * k * 0.0, -aH * 0.35, 0.11 * k), [0.06 * k, 0.012 * k, 0.05 * k], { lat: 4, lon: 8, slot: SLOT.white, wt: ft }); // side swoosh-less stripe
  }

  // ------------------------------------------------------------------ head
  const H = makeHead(D);
  M.origin(R[BI.head]);
  {
    const skull = H.rings(SK);
    // shade under the fringe line
    skull.forEach((r, i) => { r.ao = HEAD_T[i] >= 0.86 ? 1 : 0; });
    tube(M, skull, { N: 28, wt: BI.head });
    // ears
    const ear = chibi ? [0.022, 0.038, 0.024] : [0.014, 0.027, 0.017];
    for (const s of [-1, 1]) {
      ellipsoid(M, [s * (H.rx(0.5) * 0.995 + 0.002), H.y(0.46), H.cz(0.5) - 0.002], ear, { lat: 5, lon: 8, slot: SK, wt: BI.head, soft: 1, rot: [0, 0, s * 0.25] });
    }
    buildHair(M, D, look, H);
  }
  M.origin(null);
  return { geo: M.build(), head: H, rest: R };
}

function shiftLast(M, nVerts, cx) {
  // the tube was built around x = 0; move its vertices by cx
  const start = M.count - nVerts;
  for (let i = start; i < M.count; i++) M.p[i * 3] += cx;
}

// insert hard colour splits for the block-colour chest band
function bandify(rings, bands, slot, tt, fAt) {
  if (!bands.length) return rings;
  const out = [];
  for (const r of rings) out.push(r);
  // convert: rings inside band get band slot (already set by caller), add duplicates at the band edges for clean splits
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    const prev = out[i - 1];
    if (prev && prev.slot !== r.slot && Math.abs(prev.y - r.y) > 1e-6) {
      res.push(Object.assign({}, prev, { y: (prev.y + r.y) / 2, slot: prev.slot }));
      res.push(Object.assign({}, r, { y: (prev.y + r.y) / 2, slot: r.slot }));
    }
    res.push(r);
  }
  void slot; void tt; void fAt;
  return res;
}

// ------------------------------------------------------------------ face decal surface (head-local; child of the head bone)
export const FACE_T = [0.06, 0.12, 0.2, 0.3, 0.42, 0.52, 0.64, 0.76, 0.86];
export function faceLayout(D) {
  const H = makeHead(D);
  const tTop = 0.86, tBot = 0.06;
  const xHalf = D.headW * 0.98;
  return { H, tTop, tBot, xHalf, px: (x, CW) => (0.5 + x / (2 * xHalf)) * CW, py: (y, CH) => ((H.y(tTop) - y) / (H.y(tTop) - H.y(tBot))) * CH };
}
export function buildFaceGeometry(D) {
  const L = faceLayout(D), H = L.H;
  const N = 28, J = 6;
  const pos = [], uv = [], idx = [];
  const rows = FACE_T;
  const tmp = new V();
  for (let r = 0; r < rows.length; r++) {
    const t = rows[r];
    for (let j = -J; j <= J; j++) {
      const th = (j / N) * Math.PI * 2;
      H.surf(t, th, 0.0035, tmp);
      pos.push(tmp.x, tmp.y, tmp.z);
      uv.push(0.5 + tmp.x / (2 * L.xHalf), 1 - (H.y(L.tTop) - tmp.y) / (H.y(L.tTop) - H.y(L.tBot)) * 1);
    }
  }
  const C = J * 2 + 1;
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < C - 1; c++) {
    const a = r * C + c, b = a + 1, d = a + C, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ geometry cache
const _cache = new Map();
export function getBody(look, D) {
  const key = [D.id, look.build, look.hairStyle, look.headwear, look.skirt ? 1 : 0, look.sleeveless ? 1 : 0, look.jacket ? 1 : 0, look.ahoge ? 1 : 0, look.block ? 1 : 0].join('|');
  let e = _cache.get(key);
  if (!e) { e = buildBody(look, D); e.key = key; _cache.set(key, e); }
  return e;
}
export { DIMS };
