// Aggregator: the character builders live in dims.js (proportion tables + rig), sculpt.js (geometry toolkit), body.js,
// hair.js, face.js, shade.js (materials) and gear.js (racket).
export { DIMS, STYLES, BONE_NAMES, BI, makeBones, restPositions, RACKET } from './dims.js';
export { makePalette, fillPalette, makeToon, makeOutlineMaterial } from './shade.js';
export { getBody, buildBody, buildFaceGeometry, faceLayout } from './body.js';
export { Face } from './face.js';
export { getRacketGeometry } from './gear.js';
export { HAIR_STYLES } from './hair.js';
