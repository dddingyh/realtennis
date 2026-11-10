// Cartoon tennis athletes: procedural skinned rig, toon material + inverted-hull outline, IK animation.
// Public API (see docs/ARCADE.md section 4):
//   createCharacter(look, opts) -> { object3d, update(playerState, dtReal, ctx), setLook(look), dispose() }
//   DEFAULT_LOOKS                 -> 8 original designs
//   getHandWorldPosition(character, 'toss'|'racket'|'sweet'|'grip'|'tip', targetVec3) -> targetVec3
import * as THREE from 'three';
import { BONES, BI, DIM, makePalette, fillPalette, makeToon, outlineMaterial, getBodyGeometry, getRacketGeometry, Face, faceGeometry } from './build.js';
import { Animator, GRIP_Q } from './anim.js';

export const DEFAULT_LOOKS = [
  { id: 'ember', name: '炽焰', skin: '#f1c19a', hair: '#6a3f22', shirt: '#e8473b', shorts: '#2b3252', shoes: '#fafafa', accent: '#ffd23f', hairStyle: 'short', build: 'athletic', headwear: 'headband' },
  { id: 'mint', name: '薄荷', skin: '#e6b08a', hair: '#3a4062', shirt: '#2fb8a4', shorts: '#f4f1e8', shoes: '#2b6f9e', accent: '#ff7f6b', hairStyle: 'ponytail', build: 'slim', skirt: true, headwear: 'visor' },
  { id: 'bolt', name: '闪电', skin: '#8d5a3c', hair: '#3b3430', shirt: '#ffd23f', shorts: '#262b45', shoes: '#ef4e4e', accent: '#262b45', hairStyle: 'curly', build: 'sturdy', sleeveless: true },
  { id: 'frost', name: '霜刃', skin: '#f6d6bd', hair: '#bfe3ff', shirt: '#4a6cf0', shorts: '#e9eefc', shoes: '#ffffff', accent: '#6fe0ff', hairStyle: 'spiky', build: 'slim' },
  { id: 'grove', name: '青松', skin: '#d6a07a', hair: '#5a4630', shirt: '#3e9b4f', shorts: '#fff1cf', shoes: '#8b5a2b', accent: '#f0c24b', hairStyle: 'buzz', build: 'sturdy', headwear: 'cap' },
  { id: 'plum', name: '紫霞', skin: '#c88f68', hair: '#7a35a0', shirt: '#8a4fd6', shorts: '#2b2140', shoes: '#f6e7ff', accent: '#ff8fd0', hairStyle: 'bun', build: 'athletic', skirt: true, headwear: 'headband' },
  { id: 'sunny', name: '朝阳', skin: '#f0b98d', hair: '#e0a030', shirt: '#ff8f2e', shorts: '#ffffff', shoes: '#2d3350', accent: '#2d3350', hairStyle: 'bob', build: 'athletic', skirt: true },
  { id: 'night', name: '夜行', skin: '#7a4d34', hair: '#2a2a3e', shirt: '#2c2f3f', shorts: '#1d1f2b', shoes: '#ffd23f', accent: '#ff4f7a', hairStyle: 'mohawk', build: 'athletic', headwear: 'bandana', sleeveless: true },
];

function fullLook(look) {
  const d = DEFAULT_LOOKS[0];
  const l = Object.assign({}, d, look || {});
  if (look && look.hairStyle == null) l.hairStyle = d.hairStyle;
  return l;
}

export function createCharacter(look, opts = {}) {
  let L = fullLook(look);
  const object3d = new THREE.Group();
  object3d.name = 'Character';
  const rig = new THREE.Group();
  object3d.add(rig);

  const bones = BONES.map((b) => { const bn = new THREE.Bone(); bn.name = b[0]; bn.position.set(b[2], b[3], b[4]); return bn; });
  BONES.forEach((b, i) => { if (b[1] >= 0) bones[b[1]].add(bones[i]); else rig.add(bones[i]); });
  rig.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  const palette = makePalette();
  fillPalette(palette, L);
  const toon = makeToon(palette);
  const outMat = outlineMaterial();

  const geo = getBodyGeometry(L);
  const body = new THREE.SkinnedMesh(geo, toon);
  body.castShadow = true; body.receiveShadow = false; body.frustumCulled = false; body.name = 'body';
  const outline = new THREE.SkinnedMesh(geo, outMat);
  outline.castShadow = false; outline.receiveShadow = false; outline.frustumCulled = false; outline.name = 'outline';
  rig.add(body); rig.add(outline);
  body.bind(skeleton, new THREE.Matrix4());
  outline.bind(skeleton, new THREE.Matrix4());

  // racket in the dominant hand
  const rk = getRacketGeometry();
  const racketNode = new THREE.Group();
  racketNode.name = 'racket';
  racketNode.position.set(0, -DIM.palm, 0);
  racketNode.quaternion.copy(GRIP_Q);
  const frame = new THREE.Mesh(rk.geo, toon); frame.castShadow = true;
  const frameOutline = new THREE.Mesh(rk.geo, outMat);
  const strings = new THREE.Mesh(rk.sgeo, rk.smat);
  racketNode.add(frame, frameOutline, strings);
  bones[BI.handD].add(racketNode);

  // face decal on the head
  const face = new Face();
  const faceMesh = new THREE.Mesh(faceGeometry(), face.material);
  faceMesh.name = 'face';
  bones[BI.head].add(faceMesh);

  const an = new Animator(bones, racketNode);
  if (opts.facing) an.defaultFacing = opts.facing;
  else if (opts.side === 'far') an.defaultFacing = { x: 0, z: 1 };

  let curGeoKey = geo.userData.cacheKey;

  const api = {
    object3d,
    update(ps, dtReal, ctx) {
      an.update(ps, dtReal, ctx);
      object3d.position.set(an.px, 0, an.pz);
      object3d.rotation.y = an.yaw;
      const sq = an.squash;
      rig.scale.set(an.m * (1 - sq * 0.5), 1 + sq, 1 - sq * 0.5);
      const f = an.face;
      face.draw(f.blink, f.mouth, f.brow, f.gx, f.gy);
      object3d.updateMatrixWorld(true);
    },
    setLook(next) {
      L = fullLook(next);
      fillPalette(palette, L);
      const g = getBodyGeometry(L);
      if (g.userData.cacheKey !== curGeoKey) {
        curGeoKey = g.userData.cacheKey;
        body.geometry = g; outline.geometry = g;
      }
    },
    dispose() {
      palette.dispose(); toon.dispose(); face.dispose();
      object3d.removeFromParent();
    },
    // debugging / integration access
    _an: an, _rig: rig, _bones: bones, _body: body,
    get look() { return L; },
  };
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
    case 'toss': out.set(0.078, -0.07, 0); character._bones[BI.handN].localToWorld(out); break;
    case 'grip': out.set(0, 0, 0); rn.localToWorld(out); break;
    case 'tip': out.set(0, DIM.racketLen - DIM.gripY, 0); rn.localToWorld(out); break;
    default: out.set(0, DIM.headCY, 0); rn.localToWorld(out);
  }
  return out;
}
export { _v as _scratch };
