// Pinhole perspective camera, world metres -> RENDER.width x RENDER.height screen pixels.
// World: x right, y up, z toward camera (net at z=0, near baseline z=+11.885).
import { RENDER } from '../config.js';

const W = RENDER.width, H = RENDER.height;
const CAM = { x: 0, y: 10, z: 34, pitchDeg: 19, fovDeg: 24.5 }; // lower broadcast angle (~27° to the near player); a player 4.6 m behind the near baseline stays in frame
const pitch = CAM.pitchDeg * Math.PI / 180;
const sinA = Math.sin(pitch), cosA = Math.cos(pitch);
const F = (H / 2) / Math.tan(CAM.fovDeg * Math.PI / 360);
const CX = W / 2, CY = H / 2;

// forward (0,-sinA,-cosA), up (0,cosA,-sinA), right (1,0,0)
export function project(x, y, z) {
  const rx = x - CAM.x, ry = y - CAM.y, rz = z - CAM.z;
  const depth = -sinA * ry - cosA * rz;
  const up = cosA * ry - sinA * rz;
  const k = F / depth;
  return { sx: CX + rx * k, sy: CY - up * k, scale: k, depth };
}

// direction of the ray through pixel centre (px,py): world-space unit-ish vector
export function rayDir(px, py) {
  const a = (px - CX) / F, b = -(py - CY) / F; // right, up (camera units)
  // dir = fwd + a*right + b*up
  const dx = a;
  const dy = -sinA + b * cosA;
  const dz = -cosA - b * sinA;
  return { x: dx, y: dy, z: dz };
}

export const camera = {
  W, H, F, pos: CAM, project, rayDir,
  // pixels per metre (lateral) at world depth of a ground point z
  scaleAtZ(z, y = 0) { return project(0, y, z).scale; },
  // screen px for a ground point
  ground(x, z) { return project(x, 0, z); },
};
export default camera;
