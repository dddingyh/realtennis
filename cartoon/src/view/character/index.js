// Anime-style cartoon tennis athletes: procedural skinned rig (two proportion styles), sculpted hair, painted anime faces,
// cel shading + outline, IK animation with secondary motion. Public API (see docs/ARCADE.md section 4):
//   createCharacter(look, opts) -> { object3d, update(playerState, dtReal, ctx), setLook(look), dispose() }
//   DEFAULT_LOOKS, STYLES ('chibi' | 'anime'), getHandWorldPosition(character, 'toss'|'racket'|'sweet'|'grip'|'tip', target)
// The proportion style comes from look.style; a `?charstyle=anime|chibi` URL parameter overrides it (testing / fallback).
import * as THREE from 'three';
import { DIMS, STYLES, makeBones, BI, RACKET } from './dims.js';
import { makePalette, fillPalette, makeToon, makeOutlineMaterial } from './shade.js';
import { getBody } from './body.js';
import { Face, faceGeometryFor } from './face.js';
import { getRacketGeometry } from './gear.js';
import { Animator, GRIP_Q, LIMB } from './anim.js';
import { HAIR_STYLES } from './hair.js';

export { STYLES, HAIR_STYLES };

export const DEFAULT_LOOKS = [
  { id: 'ember', name: '炽焰', style: 'chibi', skin: '#f4c9a6', hair: '#e5562a', eyes: '#e8a23a', shirt: '#e94b3c', sleeve: '#e94b3c', shorts: '#2f3b6e', shoes: '#fafafa', accent: '#ffd23f', hairStyle: 'spiky', headwear: 'headband', build: 'athletic', block: true },
  { id: 'mint', name: '薄荷', style: 'chibi', skin: '#f2c7a8', hair: '#2f4a8f', eyes: '#35b8a4', shirt: '#38c2ae', shorts: '#fbf8ee', shoes: '#2e7fb0', accent: '#ff7f6b', hairStyle: 'ponytail', headwear: 'visor', skirt: true, build: 'slim' },
  { id: 'bolt', name: '闪电', style: 'chibi', skin: '#c68a5e', hair: '#f2c52f', eyes: '#6b4a2b', shirt: '#ffd23f', shorts: '#2c3269', shoes: '#ef4e4e', accent: '#262b45', trim: '#262b45', hairStyle: 'tousled', ahoge: true, build: 'athletic', sleeveless: true },
  { id: 'frost', name: '霜刃', style: 'chibi', skin: '#f7dcc6', hair: '#9ed3f5', eyes: '#5aa6ff', shirt: '#f4f6ff', shorts: '#4663e8', shoes: '#ffffff', accent: '#4cd4ff', vest: '#3e58d8', hairStyle: 'short', jacket: true, build: 'slim' },
  { id: 'grove', name: '青松', style: 'chibi', skin: '#e2ad86', hair: '#4a3a2c', eyes: '#5e8b3a', shirt: '#43a35a', sleeve: '#43a35a', shorts: '#fff0c9', shoes: '#8b5a2b', accent: '#f0c24b', hairStyle: 'bun', headwear: 'headband', build: 'sturdy', block: true },
  { id: 'plum', name: '紫霞', style: 'chibi', skin: '#f0c4a2', hair: '#8a4bc0', eyes: '#c26aff', shirt: '#9a5ae0', shorts: '#40306e', shoes: '#f6e7ff', accent: '#ff8fd0', hairStyle: 'twin', skirt: true, build: 'slim' },
  { id: 'sunny', name: '朝阳', style: 'chibi', skin: '#f0bf98', hair: '#e9a23b', eyes: '#3f9f5e', shirt: '#ff8f2e', shorts: '#ffffff', shoes: '#2d3350', accent: '#2d3350', trim: '#ffffff', hairStyle: 'bob', headwear: 'visor', skirt: true, build: 'athletic' },
  { id: 'night', name: '夜行', style: 'chibi', skin: '#d29a70', hair: '#262a52', eyes: '#d9487a', shirt: '#4a4f86', shorts: '#2a2d52', shoes: '#ffd23f', accent: '#ff4f7a', hairStyle: 'long', skirt: true, build: 'slim', block: true },
];

const BASE_LOOK = { skin: '#f4c9a6', hair: '#4a3a2c', eyes: '#4a8f6e', shirt: '#e94b3c', shorts: '#2f3b6e', shoes: '#fafafa', accent: '#ffd23f', hairStyle: 'short', build: 'athletic', headwear: 'none', skirt: false, sleeveless: false, block: false, jacket: false, ahoge: false, style: 'chibi' };
let _urlStyle;
function urlStyle() {
  if (_urlStyle === undefined) {
    _urlStyle = null;
    try { const v = new URLSearchParams(location.search).get('charstyle'); if (v && STYLES.includes(v)) _urlStyle = v; } catch (e) { /* ignore */ }
  }
  return _urlStyle;
}
function fullLook(look) {
  const L = Object.assign({}, BASE_LOOK, look || {});
  const u = urlStyle();
  if (u) L.style = u;
  if (!STYLES.includes(L.style)) L.style = 'chibi';
  return L;
}

export function createCharacter(look, opts = {}) {
  let L = fullLook(look);
  const object3d = new THREE.Group();
  object3d.name = 'Character';
  const palette = makePalette();
  const toon = makeToon(palette);
  const outMat = makeOutlineMaterial(palette);
  let rig = null, bones = null, body = null, outline = null, faceMesh = null, racketNode = null, an = null, face = null, curKey = '', D = null;
  const rk = getRacketGeometry();
  const fxTmp = { open: 1, kind: 0, browY: 0, browA: 0, mouth: 'smile', mo: 0, blush: 0, gx: 0, gy: 0, sweat: false };
  let lastState = null;

  function assemble() {
    if (rig) { object3d.remove(rig); }
    D = DIMS[L.style];
    rig = new THREE.Group();
    object3d.add(rig);
    const def = makeBones(D);
    bones = def.map((b) => { const bn = new THREE.Bone(); bn.name = b[0]; bn.position.set(b[2], b[3], b[4]); return bn; });
    def.forEach((b, i) => { if (b[1] >= 0) bones[b[1]].add(bones[i]); else rig.add(bones[i]); });
    rig.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    fillPalette(palette, L);
    const { geo, key } = getBodyKey();
    curKey = key;
    body = new THREE.SkinnedMesh(geo, toon);
    body.castShadow = true; body.receiveShadow = false; body.frustumCulled = false; body.name = 'body';
    outline = new THREE.SkinnedMesh(geo, outMat);
    outline.castShadow = false; outline.receiveShadow = false; outline.frustumCulled = false; outline.name = 'outline';
    rig.add(body); rig.add(outline);
    body.bind(skeleton, new THREE.Matrix4()); outline.bind(skeleton, new THREE.Matrix4());

    racketNode = new THREE.Group(); racketNode.name = 'racket';
    racketNode.position.set(0, -D.palm, 0); racketNode.quaternion.copy(GRIP_Q); racketNode.scale.setScalar(D.racketK);
    const frame = new THREE.Mesh(rk.geo, toon); frame.castShadow = true;
    const frameOutline = new THREE.Mesh(rk.geo, outMat);
    const strings = new THREE.Mesh(rk.sgeo, rk.smat);
    racketNode.add(frame, frameOutline, strings);
    bones[BI.handD].add(racketNode);

    if (face) face.dispose();
    face = new Face(D, L);
    faceMesh = new THREE.Mesh(faceGeometryFor(D), face.material);
    faceMesh.name = 'face'; faceMesh.renderOrder = 2;
    bones[BI.head].add(faceMesh);
    // limb bones are matrix driven; give them a valid initial matrix
    for (const i of LIMB) { bones[i].matrixAutoUpdate = false; }
    an = new Animator(bones, racketNode, D);
    if (opts.facing) an.defaultFacing = opts.facing; else if (opts.side === 'far') an.defaultFacing = { x: 0, z: 1 };
    api._an = an; api._rig = rig; api._bones = bones; api._body = body; api._D = D; api._face = face;
  }
  function getBodyKey() { const e = getBody(L, DIMS[L.style]); return { geo: e.geo, key: e.key }; }

  const api = {
    object3d,
    update(ps, dtReal, ctx) {
      lastState = ps;
      an.update(ps, dtReal, ctx);
      object3d.position.set(an.px, 0, an.pz);
      object3d.rotation.y = an.yaw;
      const sq2 = an.squash + an.sqPose * D.sqK * (1 - an.ctW);
      rig.scale.set(an.m * (1 - sq2 * 0.5), 1 + sq2, 1 - sq2 * 0.5);
      const f = an.fx;
      fxTmp.open = f.open * an.blinkOpen; fxTmp.kind = f.kind; fxTmp.browY = f.browY; fxTmp.browA = f.browA; fxTmp.mouth = f.mouth; fxTmp.mo = f.mo; fxTmp.blush = f.blush; fxTmp.gx = f.gx; fxTmp.gy = f.gy; fxTmp.sweat = f.sweat;
      face.draw(fxTmp);
      object3d.updateMatrixWorld(true);
    },
    setLook(next) {
      const prevStyle = L.style;
      L = fullLook(next);
      if (L.style !== prevStyle) { const kept = lastState; assemble(); void kept; return; }
      fillPalette(palette, L);
      face.setLook(L);
      const { geo, key } = getBodyKey();
      if (key !== curKey) { curKey = key; body.geometry = geo; outline.geometry = geo; }
    },
    dispose() {
      palette.dispose(); toon.dispose(); outMat.dispose(); if (face) face.dispose();
      object3d.removeFromParent();
    },
    get look() { return L; },
    get style() { return L.style; },
  };
  assemble();
  return api;
}

const _v = new THREE.Vector3();
// World position of a hand-held anchor, taken from the real posed scene graph (what you see is what you get):
//   'toss'   - where the ball sits in the non-dominant (toss) hand's palm
//   'racket' - the racket sweet spot (centre of the string bed);  'sweet' is an alias
//   'grip'   - palm centre on the handle;  'tip' - top of the racket head
export function getHandWorldPosition(character, kind, target) {
  const out = target || new THREE.Vector3();
  const rn = character._an.racketNode;
  character.object3d.updateWorldMatrix(true, true);
  switch (kind) {
    case 'toss': out.set(0.078 * character._D.handK, -character._D.palm, 0); character._bones[BI.handN].localToWorld(out); break;
    case 'grip': out.set(0, 0, 0); rn.localToWorld(out); break;
    case 'tip': out.set(0, RACKET.len - RACKET.gripY, 0); rn.localToWorld(out); break;
    default: out.set(0, RACKET.headCY, 0); rn.localToWorld(out);
  }
  return out;
}
export { _v as _scratch };
