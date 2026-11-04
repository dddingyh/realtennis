// Static background: per-pixel raycast of the stadium (court plane, boards, stands) with a crisp pixel look.
import { COURT, RENDER } from '../config.js';
import { camera } from './camera.js';
import { PixBuf, hex, rgba, mix, shade, bayer, hash2, mulberry32, R, G, B } from './raster.js';
import { drawPixText, textWidth } from './font.js';
import { STAGE, THEMES } from './stage.js';

const W = RENDER.width, H = RENDER.height;
const { XW, ZB, BH, S, TOPH, ROW, SEAT, PANEL } = STAGE;

const LINE_W = 0.05;
const PAL = {
  hard: {
    inner: [hex('#3a6fc1'), hex('#3568b8'), hex('#4177ca')],
    outer: [hex('#6e90bd'), hex('#6788b5'), hex('#7799c5')],
    line: hex('#f3f3ee'),
  },
  clay: {
    inner: [hex('#c75f30'), hex('#bc582b'), hex('#d06a3a')],
    outer: [hex('#b4532a'), hex('#aa4c25'), hex('#bd5b31')],
    line: hex('#efe9d8'),
  },
  grass: {
    inner: [hex('#5fa04b'), hex('#579744'), hex('#69aa54')],
    outer: [hex('#4c8a3f'), hex('#458238'), hex('#55964a')],
    line: hex('#f1f1e6'),
    stripeB: [hex('#518f40'), hex('#4a883a'), hex('#5a9c49')],
    worn: [hex('#a39656'), hex('#948a4b'), hex('#b0a465')],
  },
};
let TH = THEMES.hard;
// Back-wall texture is authored at the wall's on-screen pixel density so 1 texel == 1 screen pixel
// (no dropped columns -> crisp lettering at any RENDER size).
const TEXD = camera.project(0, 0, -ZB).scale;                                   // texels per metre (horizontal)
const BTEX_W = Math.ceil(2 * XW * TEXD);
const BTEX_H = Math.max(17, Math.round(camera.project(0, 0, -ZB).sy - camera.project(0, BH, -ZB).sy));
const BIGWALL = BTEX_H >= 26;
function makeBackWall(theme) {
  const pb = new PixBuf(BTEX_W, BTEX_H);
  const wall = hex(theme.wall), lite = hex(theme.wallLite), tx = hex(theme.text), led = hex(theme.led);
  pb.clear(wall);
  const ledH = BIGWALL ? 11 : 9;
  // LED ribbon: dark panel with dim pixel grid, warm digits, thin bezel
  pb.rect(0, 0, BTEX_W, ledH, hex('#07090e'));
  for (let y = 1; y < ledH - 1; y++) for (let x = (y & 1); x < BTEX_W; x += 2) pb.set(x, y, hex('#10141c'));
  pb.rect(0, 0, BTEX_W, 1, hex('#2a3140'));
  pb.rect(0, ledH, BTEX_W, 1, lite);
  if (BIGWALL) pb.rect(0, ledH + 1, BTEX_W, 1, shade(wall, 0.75));
  const msgs = ['SERVE 187 KM/H', 'ACES 5', '1ST SERVE 64%', 'SERVE 187 KM/H'];
  let x0 = 10, mi = 0;
  const ty = Math.floor((ledH - 7) / 2);
  while (x0 < BTEX_W) {
    const m = msgs[mi++ % msgs.length];
    drawPixText(pb, m, x0, ty, led, 1);
    x0 += textWidth(m) + Math.round(TEXD * 2.4);
  }
  pb.rect(0, BTEX_H - 2, BTEX_W, 2, shade(wall, 0.6));
  // brands: symmetric about centre, lots of empty wall
  const pw = PANEL * TEXD, c = BTEX_W / 2;
  const font = BIGWALL ? 'big' : 'small';
  const top = ledH + (BIGWALL ? 2 : 1), room = BTEX_H - 2 - top;
  const fh = BIGWALL ? 14 : 7;
  // three logos only (title partner centred, two partners mirrored) with generous empty wall between
  // logos sit between the seated line judges (x = 0, +-7.3 m) so they are never hidden
  for (const [xm, bi] of [[-3.65, 0], [3.65, 1]]) {
    const brand = theme.brands[bi];
    const cx = c + xm * TEXD;
    const w = textWidth(brand, 1, font);
    const yy = top + Math.floor((room - fh) / 2);
    drawPixText(pb, brand, Math.round(cx - w / 2), yy, tx, 1, { font, shadow: shade(wall, 0.55) });
    if (BIGWALL && yy + fh + 1 < BTEX_H - 2) pb.rect(Math.round(cx - w / 2), yy + fh + 1, Math.round(w * 0.3), 1, hex(theme.accent));
  }
  return { px: pb.px, w: BTEX_W, h: BTEX_H };
}

function makeClayMarks(seed) {
  const rnd = mulberry32(seed);
  const marks = [];
  for (let i = 0; i < 46; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    marks.push({
      t: 0, x: (rnd() - 0.5) * 9.5, z: side * (6 + rnd() * 8), rx: 0.05 + rnd() * 0.05, rz: 0.04 + rnd() * 0.04,
    });
  }
  for (let i = 0; i < 16; i++) { // slide streaks
    const side = rnd() < 0.5 ? -1 : 1;
    const x = (rnd() - 0.5) * 8, z = side * (9.5 + rnd() * 4);
    const a = rnd() * Math.PI, len = 0.5 + rnd() * 1.1;
    marks.push({ t: 1, x, z, x2: x + Math.cos(a) * len, z2: z + Math.sin(a) * len * 0.6 });
  }
  return marks;
}

export function lineHit(gx, gz, kx, mz) {
  const ax = Math.abs(gx), az = Math.abs(gz);
  const hx = Math.max(LINE_W / 2, 0.52 / kx);
  const hz = Math.max(LINE_W / 2, 0.52 * mz);
  const hzb = Math.max(0.05, 0.52 * mz); // baseline 10cm
  const L = COURT.halfLength;
  if ((Math.abs(ax - COURT.doublesHalfWidth) <= hx || Math.abs(ax - COURT.singlesHalfWidth) <= hx) && az <= L + hzb) {
    // doubles alleys only exist between baselines; singles line likewise
    return true;
  }
  if (Math.abs(az - L) <= hzb && ax <= COURT.doublesHalfWidth + hx) return true;
  if (Math.abs(az - COURT.serviceLineDist) <= hz && ax <= COURT.singlesHalfWidth + hx) return true;
  if (ax <= hx && az <= COURT.serviceLineDist) return true;
  if (ax <= hx && az >= L - COURT.centerMarkLength - hz && az <= L) return true;
  return false;
}

export function renderBackground(surface = 'hard', seed = 7) {
  const key = SURFACE_KEY(surface);
  const pal = PAL[key];
  const pb = new PixBuf(W, H);
  const px = pb.px;
  TH = THEMES[key]; const boards = makeBackWall(TH);
  const marks = key === 'clay' ? makeClayMarks(seed) : [];
  const cam = camera.pos;
  const cy = cam.y, cz = cam.z;

  // per-row ground z (centre column) for metres-per-pixel in z
  const rowZ = new Float32Array(H + 2);
  for (let y = 0; y < H + 2; y++) {
    const d = camera.rayDir(W / 2, y + 0.5);
    rowZ[y] = d.y < 0 ? cz + (-cy / d.y) * d.z : -1e3;
  }

  for (let py = 0; py < H; py++) {
    const mz = Math.abs(rowZ[py + 1] - rowZ[py]) || 0.05;
    for (let pxx = 0; pxx < W; pxx++) {
      const d = camera.rayDir(pxx + 0.5, py + 0.5);
      let col = 0;
      let tg = Infinity, gx = 0, gz = 0;
      if (d.y < 0) { tg = -cy / d.y; gx = tg * d.x; gz = cz + tg * d.z; }
      if (tg < Infinity && Math.abs(gx) <= XW && gz >= -ZB) {
        col = groundColor(key, pal, gx, gz, tg, mz, pxx, py, marks);
      } else {
        col = backdropColor(d, pxx, py, boards);
      }
      px[py * W + pxx] = col;
    }
  }
  paintNetShadow(pb, key);
  return pb;
}
function SURFACE_KEY(s) { return s === 'clay' ? 'clay' : s === 'grass' ? 'grass' : 'hard'; }

function groundColor(key, pal, gx, gz, t, mz, x, y, marks) {
  const kx = camera.F / t;
  const ax = Math.abs(gx), az = Math.abs(gz);
  const n = hash2(x, y, 3);
  let base;
  if (key === 'hard') {
    const inner = ax <= 7.3 && az <= 15.4;
    const set = inner ? pal.inner : pal.outer;
    base = n < 0.05 ? set[1] : n > 0.96 ? set[2] : set[0];
    // service boxes marginally lighter for readability
    if (inner && az <= 6.4 && ax <= 4.115 && n > 0.5 && n < 0.53) base = set[2];
  } else if (key === 'clay') {
    const inner = ax <= 7.4 && az <= 15.2;
    const set = inner ? pal.inner : pal.outer;
    const band = hash2(Math.floor(gz / 0.32), 11, 5); // drag-brush bands
    base = set[0];
    if (n < 0.10) base = set[1]; else if (n > 0.92) base = set[2];
    if (band < 0.25 && n < 0.45) base = set[1]; else if (band > 0.8 && n > 0.55) base = set[2];
    // marks and streaks
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (m.t === 0) {
        const dx = (gx - m.x) / m.rx, dz = (gz - m.z) / m.rz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.0) base = d2 < 0.45 ? shade(pal.inner[1], 0.9) : mix(base, pal.inner[2], 0.5);
      } else {
        const vx = m.x2 - m.x, vz = m.z2 - m.z;
        const u = Math.max(0, Math.min(1, ((gx - m.x) * vx + (gz - m.z) * vz) / (vx * vx + vz * vz)));
        const ex = m.x + vx * u - gx, ez = m.z + vz * u - gz;
        if (ex * ex + ez * ez < 0.0016 + 0.4 / (kx * kx)) base = n > 0.35 ? pal.inner[2] : base;
      }
    }
  } else {
    const inner = ax <= 7.2 && az <= 15.0;
    const band = Math.floor((gx + 40) / 1.37) & 1;
    const set = band ? pal.stripeB : (inner ? pal.inner : pal.outer);
    const set2 = band ? (inner ? pal.stripeB : pal.stripeB.map((c) => shade(c, 0.9))) : set;
    base = set2[0];
    if (n < 0.14) base = set2[1]; else if (n > 0.9) base = set2[2];
    // worn patches near baselines / service T
    const wb = Math.exp(-Math.pow((az - 11.7) / 1.25, 2)) * Math.exp(-Math.pow(gx / 3.4, 2));
    const wt = Math.exp(-Math.pow((az - 6.1) / 0.7, 2)) * Math.exp(-Math.pow((ax - 0.0) / 1.0, 2)) * 0.6;
    const wm = Math.exp(-Math.pow((az - 0.0) / 1.1, 2)) * Math.exp(-Math.pow(gx / 2.5, 2)) * 0.5;
    const w = Math.max(wb, wt);
    if (w > 0.12) {
      const th = w + (hash2(x >> 1, y, 9) - 0.5) * 0.6;
      if (th > 0.42) base = n > 0.5 ? pal.worn[1] : pal.worn[0];
      else if (th > 0.3 && n > 0.55) base = pal.worn[2];
    }
  }
  // lines
  if (lineHit(gx, gz, kx, mz)) base = pal.line;
  else if (key === 'clay' && lineHit(gx, gz - mz, kx, mz)) base = shade(base, 0.72); // tape shadow edge
  // wall contact shadow
  const dw = Math.min(gz + ZB, XW - ax);
  if (dw < 0.7) base = shade(base, 0.82 + 0.18 * (dw / 0.7));
  // atmospheric haze + vignette brightness (ordered dither -> limited palette feel)
  let hz = Math.max(0, Math.min(0.20, (t - 38) / 90));
  hz = Math.floor(hz * 8 + bayer(x, y)) / 8;
  if (hz > 0) base = mix(base, hex('#a9bed0'), hz);
  const bright = 1.04 - 0.1 * Math.max(0, (ax - 6) / 4);
  const bq = Math.floor((bright) * 16 + bayer(x, y)) / 16;
  base = shade(base, bq * shadowMul(gx, gz, x, y));
  return base;
}

function paintNetShadow(pb, key) {
  // soft shadow strip cast by the net on the court (sun from upper-left-back)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = camera.rayDir(x + 0.5, y + 0.5);
      if (d.y >= 0) continue;
      const t = -camera.pos.y / d.y;
      const gx = t * d.x + 0.0, gz = camera.pos.z + t * d.z;
      const sx = gx - 0.38 * (gz > 0 ? 0 : 0);
      if (gz > 0.05 && gz < 0.30 && Math.abs(gx - 0.35) < 6.2 && bayer(x, y) < 0.55) {
        const c = pb.px[y * W + x];
        if (c) pb.px[y * W + x] = shade(c, 0.8);
      }
    }
  }
}

// ---- off-court shading: boards / stands ----
const shadowF = (x, z) => x - 0.45 * z - 7.0;   // >0 => in stadium shadow (right/far wedge)
function shadowMul(x, z, px, py) {
  const d = shadowF(x, z);
  if (d <= 0) return 1;
  const t = Math.min(1, d / 1.6);
  return bayer(px, py) < t ? 0.74 : 1;
}

function backdropColor(d, x, y, boardTex) {
  const cy = camera.pos.y, cz = camera.pos.z;
  let tBack = d.z < 0 ? (-ZB - cz) / d.z : Infinity;
  let tSide = Infinity, side = 0;
  if (d.x > 1e-6) { tSide = XW / d.x; side = 1; } else if (d.x < -1e-6) { tSide = -XW / d.x; side = -1; }
  const tExit = Math.min(tBack, tSide);
  const yExit = cy + tExit * d.y;
  if (yExit <= BH) {
    if (tBack <= tSide) return backWallColor(boardTex, tBack * d.x, yExit, tBack, x, y);
    const bz = cz + tSide * d.z;
    if (bz > -ZB) return sideWallColor(bz, yExit, tSide, x, y, side);
  }
  let bestT = Infinity, kind = 0;
  const denB = d.y + S * d.z;
  if (denB < 0) {
    const t = (BH + S * (-ZB - cz) - cy) / denB;
    const zz = cz + t * d.z;
    if (t > 0 && zz < -ZB && cy + t * d.y <= TOPH && t < bestT) { bestT = t; kind = 1; }
  }
  for (const sd of [1, -1]) {
    const den = d.y - S * sd * d.x;
    if (den < 0) {
      const t = (BH - S * XW - cy) / den;
      const xx = t * d.x;
      if (t > 0 && xx * sd > XW && cy + t * d.y <= TOPH && t < bestT) { bestT = t; kind = sd === 1 ? 2 : 3; }
    }
  }
  if (kind === 0) return concourse(d, x, y);
  const hx = bestT * d.x, hy = cy + bestT * d.y, hz = cz + bestT * d.z;
  let r, u;
  if (kind === 1) { r = (-ZB - hz) / ROW; u = hx; } else { r = (Math.abs(hx) - XW) / ROW; u = hz; }
  return seatColor(r, u, kind, bestT, x, y, hx, hz);
}

function haze(c, t, x, y, amt = 0.15) {
  const hz = Math.floor(Math.max(0, Math.min(amt, (t - 38) / 100)) * 8 + bayer(x, y)) / 8;
  return hz > 0 ? mix(c, hex('#9fb2c6'), hz) : c;
}

function backWallColor(tex, bx, by, t, x, y) {
  const tx = Math.min(tex.w - 1, Math.max(0, Math.floor((bx + XW) * TEXD)));
  const ty = Math.min(tex.h - 1, Math.max(0, Math.floor((BH - by) / BH * tex.h)));
  let c = tex.px[ty * tex.w + tx];
  c = shade(c, shadowMul(bx, -ZB, x, y));
  return haze(c, t, x, y);
}

function sideWallColor(bz, v, t, x, y, side) {
  const wall = hex(TH.wall), lite = hex(TH.wallLite);
  const vv = v / BH;
  let c = wall;
  if (vv > 0.93) c = lite;
  else if (vv < 0.1) c = shade(wall, 0.6);
  else if (vv < 0.14) c = shade(wall, 1.25);
  else {
    // understated brand mark: a short light bar on every 4th panel, centred
    const u = (bz + 30) / PANEL, pi = Math.floor(u), fu = u - pi;
    if ((((pi % 4) + 4) % 4) === 2 && fu > 0.3 && fu < 0.7 && vv > 0.42 && vv < 0.58) c = hex(TH.text);
    else if ((((pi % 4) + 4) % 4) === 2 && fu > 0.3 && fu < 0.7 && vv > 0.62 && vv < 0.67) c = hex(TH.accent);
  }
  c = shade(c, 0.88 * shadowMul(side * XW, bz, x, y));
  return haze(c, t, x, y);
}

function seatColor(r, u, kind, t, x, y, hx, hz) {
  const row = Math.floor(r), rf = r - row;
  const seatU = u / SEAT + 100;
  const col = Math.floor(seatU), cf = seatU - col;
  const conc = hex(TH.concrete);
  let c;
  const upper = row >= 5;
  const aisle = (((col % 10) + 10) % 10) === 0;
  if (row === 4) {                                   // walkway between tiers
    c = rf < 0.5 ? shade(conc, 1.05) : shade(conc, 0.82);
  } else if (aisle) {                                // aisle stairs
    c = rf < 0.25 ? shade(conc, 1.1) : shade(conc, 0.78);
  } else {
    const sc = hex(row < 4 ? TH.seat2 : TH.seat);
    if (rf < 0.2) c = shade(conc, 0.78);             // riser
    else if (cf < 0.12) c = shade(sc, 0.62);
    else if (rf > 0.72) c = shade(sc, 0.8);
    else c = sc;
    // a few empty/lighter seats are visible where the crowd skips
  }
  let b = (kind === 1 ? 1.0 : kind === 2 ? 0.9 : 0.8) * (upper ? 0.72 : 1);
  b *= shadowMul(hx, hz, x, y);
  b = Math.floor(b * 14 + bayer(x, y)) / 14;
  c = shade(c, b);
  return haze(c, t, x, y, 0.28);
}

function concourse(d, x, y) {
  const n = hash2(x >> 1, y >> 1, 21);
  let c = hex('#12161f');
  if (y % 18 < 2) c = hex('#222a38');
  if (y < 5) c = hex('#0b0d12');
  if (y >= 5 && y < 7) c = hex('#2c3547');   // roof rim highlight
  if (n > 0.992 && y > 8) c = hex('#e8dfb8');
  return c;
}
