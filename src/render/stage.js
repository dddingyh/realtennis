// Stadium geometry shared by background renderer, crowd and props.
export const STAGE = Object.freeze({
  XW: 11.0,        // side wall |x|
  ZB: 18.4,       // back wall z = -ZB
  BH: 1.3,       // advertising board height
  S: 0.62,        // stand slope (rise per metre)
  TOPH: 5.5,      // top of stands
  ROW: 0.85,      // row depth (m, horizontal)
  SEAT: 0.52,     // seat width (m)
  PANEL: 2.375,   // sponsor panel width (m)
});

export const SPONSORS = [
  { text: 'KORVA', bg: '#1b3f8b', fg: '#ffffff', ac: '#f2c230' },
  { text: 'ZEPHYRA', bg: '#c8362d', fg: '#ffffff', ac: '#ffffff' },
  { text: 'BLUMO', bg: '#f2f2ea', fg: '#1b3f8b', ac: '#c8362d' },
  { text: 'TANDEL', bg: '#1f7a4a', fg: '#ffffff', ac: '#f2c230' },
  { text: 'SOLIVO', bg: '#f2c230', fg: '#2a2a33', ac: '#c8362d' },
  { text: 'NIMBLO', bg: '#2a2a33', fg: '#ffffff', ac: '#3fc1d8' },
  { text: 'AEROLY', bg: '#3a9ad9', fg: '#ffffff', ac: '#ffffff' },
  { text: 'PRIMAX', bg: '#6a2f8f', fg: '#ffffff', ac: '#f2c230' },
];

// One coherent "tournament theme" per surface (colours only, no real names).
export const THEMES = {
  hard: { wall: '#14275a', wallLite: '#2a428a', text: '#f2f5fb', accent: '#f2c230', seat: '#1e2742', seat2: '#1e2742', brands: ['KORVA', 'NIMBLO', 'AEROLY'], concrete: '#8d95a3', led: '#ffb347' },
  clay: { wall: '#10402e', wallLite: '#1f6048', text: '#f4f1e6', accent: '#e9e2c8', seat: '#1b2b25', seat2: '#1b2b25', brands: ['KORVA', 'SOLIVO', 'TANDEL'], concrete: '#9a9a94', led: '#ffd27a' },
  grass: { flowers: true, wall: '#16391f', wallLite: '#26583a', text: '#f1f4ea', accent: '#b9a3d6', seat: '#202e28', seat2: '#43375e', brands: ['BLUMO', 'KORVA', 'PRIMAX'], concrete: '#9a9d98', led: '#e8f2c0' },
};
