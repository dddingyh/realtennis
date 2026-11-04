// Shared constants. World units are meters, seconds, radians, kg.
// Coordinate system (right-handed, camera sits behind the NEAR baseline):
//   x : lateral, +x = right as seen from the camera / near player
//   y : height, +y = up, court surface at y = 0
//   z : along court length, net at z = 0, NEAR baseline at z = +COURT.halfLength,
//       FAR baseline at z = -COURT.halfLength. Camera looks toward -z.
// Player index 0 = NEAR side (human by default), 1 = FAR side (AI by default).

export const COURT = Object.freeze({
  length: 23.77,
  halfLength: 11.885,
  singlesWidth: 8.23,
  singlesHalfWidth: 4.115,
  doublesWidth: 10.97,
  doublesHalfWidth: 5.485,
  serviceLineDist: 6.40,      // service line distance from the net
  centerMarkLength: 0.10,
  lineWidth: 0.05,            // lines are part of the court ("in")
  netHeightCenter: 0.914,
  netHeightPost: 1.07,        // at singles sticks (x = ±(singlesHalfWidth + 0.914))
  netPostX: 4.115 + 0.914,
  runoffBack: 6.40,           // free space behind baseline
  runoffSide: 3.66,           // free space beside doubles sideline
});

export const BALL = Object.freeze({
  mass: 0.0577,
  radius: 0.0335,
  dragCoeff: 0.55,
  airDensity: 1.21,
  inertiaFactor: 0.55,        // I = k m r^2 (hollow rubber shell, ~0.55)
  spinDecayPerSec: 0.03,      // fractional spin loss per second in flight
  maxSpin: 600,               // rad/s safety clamp (~5700 rpm)
});

export const PHYSICS = Object.freeze({
  gravity: 9.81,
  fixedDt: 1 / 240,           // physics substep
  simHz: 120,                 // game logic step (2 physics substeps per step)
});

// Surfaces: restitution (vertical COR) and sliding friction coefficient.
// Values chosen in the range reported for ITF court pace classifications.
export const SURFACES = Object.freeze({
  hard:  { name: '硬地', cor: 0.76, friction: 0.55, colors: 'hard'  },
  clay:  { name: '红土', cor: 0.80, friction: 0.75, colors: 'clay'  },
  grass: { name: '草地', cor: 0.70, friction: 0.42, colors: 'grass' },
});

export const RENDER = Object.freeze({
  width: 960,                 // internal pixel-art resolution (2x integer upscale -> 1920x1080)
  height: 540,
});

export const SHOT_TYPES = Object.freeze(['flat', 'topspin', 'slice', 'lob']);
export const SIDES = Object.freeze(['fh', 'bh']);

// Remote controller protocol version (see docs/DESIGN.md §5)
export const PROTOCOL_VERSION = 1;
export const PEER_ID_PREFIX = 'realtennis-v1-';
