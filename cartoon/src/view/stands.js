// Shared description of the two-tier stand bowl + roof ring (all rectangular rings around the boards).
import { VENUE } from './court_tex.js';

const TREADS = [];
// lower tier
const LOW = { o0: 0.9, rows: 11, depth: 0.85, rise: 0.5, y0: 1.0 };
for (let k = 0; k < LOW.rows; k++) {
  TREADS.push({ tier: 0, row: k, o0: LOW.o0 + k * LOW.depth, o1: LOW.o0 + (k + 1) * LOW.depth, y: LOW.y0 + (k + 1) * LOW.rise, yPrev: k === 0 ? 0 : LOW.y0 + k * LOW.rise, seat: true });
}
const lowTopO = LOW.o0 + LOW.rows * LOW.depth, lowTopY = LOW.y0 + LOW.rows * LOW.rise;
TREADS.push({ tier: -1, row: 0, o0: lowTopO, o1: lowTopO + 1.6, y: lowTopY, yPrev: lowTopY, seat: false });
// upper tier
const UP = { o0: lowTopO + 1.6, rows: 10, depth: 0.85, rise: 0.62, yFirst: lowTopY + 1.2 };
for (let k = 0; k < UP.rows; k++) {
  TREADS.push({ tier: 1, row: k, o0: UP.o0 + k * UP.depth, o1: UP.o0 + (k + 1) * UP.depth, y: UP.yFirst + k * UP.rise, yPrev: k === 0 ? lowTopY : UP.yFirst + (k - 1) * UP.rise, seat: true });
}
const upTopO = UP.o0 + UP.rows * UP.depth, upTopY = UP.yFirst + (UP.rows - 1) * UP.rise;

export const STANDS = Object.freeze({
  BX: VENUE.BX, BZ: VENUE.BZ,
  treads: TREADS,
  lowTopO, lowTopY, upTopO, upTopY,
  // roof ring: opening starts `roofO` outside the boards at height roofH, rises outward with slope roofSlope
  roofO: 7.5, roofH: 14.6, roofSlope: 0.22, roofOuter: upTopO + 2.0,
  seatFrac: 0.68,
});

export function roofHeightAt(o) { return STANDS.roofH + Math.max(0, o - STANDS.roofO) * STANDS.roofSlope; }

/** Is world point p in the roof's cast shadow for sun direction s (unit vector towards the sun)? */
export function inRoofShade(px, py, pz, sx, sy, sz) {
  const { BX, BZ, roofO } = STANDS;
  let t = (STANDS.roofH - py) / sy;
  for (let i = 0; i < 3; i++) {
    const qx = px + sx * t, qz = pz + sz * t;
    const o = Math.max(Math.abs(qx) - BX, Math.abs(qz) - BZ);
    t = (roofHeightAt(Math.max(o, roofO)) - py) / sy;
  }
  const qx = px + sx * t, qz = pz + sz * t;
  const o = Math.max(Math.abs(qx) - BX, Math.abs(qz) - BZ);
  return o > roofO && o < STANDS.roofOuter;
}
