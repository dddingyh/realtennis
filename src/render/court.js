// Static background: per-pixel raycast of the stadium (court plane, boards, stands) with a crisp pixel look.
import { COURT, RENDER } from '../config.js';
import { camera } from './camera.js';
import { PixBuf, hex, rgba, mix, shade, bayer, hash2, mulberry32, R, G, B } from './raster.js';
import { drawPixText, textWidth } from './font.js';
import { STAGE, SPONSORS } from './stage.js';

const W = RENDER.width, H = RENDER.height;
const { XW, ZB, BH, S, TOPH, ROW, SEAT, PANEL } = STAGE;

const LINE_W = 0.05;
const PAL = {
  hard: {
    inner: [hex('#2f62ab'), hex('#2a579b'), hex('#356bb8')],
    outer: [hex('#3a8a66'), hex('#33805e'), hex('#43936f')],
    line: hex('#f3f3ec'),
  },
  clay: {
    inner: [hex('#c3592c'), hex('#b34e25'), hex('#d0693a')],
    outer: [hex('#b9532a'), hex('#a94a23'), hex('#c5603a')],
    line: hex('#ece6d4'),
  },
  grass: {
    inner: [hex('#5ca64b'), hex('#52993f'), hex('#68b255')],
    outer: [hex('#4b923f'), hex('#438738'), hex('#559c47')],
    line: hex('#f1f1e6'),
    stripeB: [hex('#4f9a42'), hex('#478f3a'), hex('#59a64a')],
    worn: [hex('#a39656'), hex('#948a4b'), hex('#b0a465')],
  },
};

function makeBoardTextures() {
  const tw = Math.round(PANEL * 16), th = Math.round(BH * 16);
  return SPONSORS.map((sp) => {
    const pb = new PixBuf(tw, th);
    const bg = hex(sp.bg), fg = hex(sp.fg), ac = hex(sp.ac);
    pb.clear(bg);
    pb.rect(0, 0, tw, 1, shade(bg, 1.25));
    pb.rect(0, th - 3, tw, 3, shade(bg, 0.72));
    pb.rect(0, 2, tw, 1, ac);
    pb.rect(0, th - 5, tw, 1, ac);
    const text = sp.text;
    const w = textWidth(text, 1);
    drawPixText(pb, text, Math.round((tw - w) / 2), 5, fg, 1, { shadow: shade(bg, 0.55) });
    pb.rect(0, 0, 1, th, shade(bg, 0.7));
    return { px: pb.px, w: tw, h: th };
  });
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
  const boards = makeBoardTextures();
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
    const inner = ax <= 6.9 && az <= 14.9;
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
    const w = Math.max(wb, wt, wm);
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
  base = shade(base, bq);
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
const SEAT_COLS = [hex('#2b4a8f'), hex('#8c2f3d'), hex('#2f6f6a'), hex('#c9a13a'), hex('#4a3f86')];
const CONCRETE = hex('#8d929c');

function backdropColor(d, x, y, boards) {
  const cy = camera.pos.y, cz = camera.pos.z;
  // exit from the stadium box
  let tBack = d.z < 0 ? (-ZB - cz) / d.z : Infinity;
  let tSide = Infinity, side = 0;
  if (d.x > 1e-6) { tSide = XW / d.x; side = 1; } else if (d.x < -1e-6) { tSide = -XW / d.x; side = -1; }
  const tExit = Math.min(tBack, tSide);
  const yExit = cy + tExit * d.y;
  if (yExit <= BH) {
    if (tBack <= tSide) {
      const bx = tBack * d.x, by = yExit;
      return boardColor(boards, (bx + XW) / PANEL, by, 0, tBack, x, y, 1.0);
    }
    const bz = cz + tSide * d.z;
    if (bz > -ZB) return sideBoardColor((bz + 20) / PANEL, yExit, tSide, x, y);
  }
  // stands planes
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
  return seatColor(r, u, kind, bestT, x, y, hy);
}

function boardColor(boards, u, v, side, t, x, y, lit) {
  const ti = Math.floor(u);
  const tex = boards[((ti % boards.length) + boards.length) % boards.length];
  let fu = u - ti;
  const tx = Math.min(tex.w - 1, Math.max(0, Math.floor(fu * tex.w)));
  const ty = Math.min(tex.h - 1, Math.max(0, Math.floor((BH - v) / BH * tex.h)));
  let c = tex.px[ty * tex.w + tx];
  // darken lower and with distance
  c = shade(c, lit * (v < 0.12 ? 0.8 : 1));
  const hz = Math.floor(Math.max(0, Math.min(0.15, (t - 38) / 100)) * 8 + bayer(x, y)) / 8;
  if (hz > 0) c = mix(c, hex('#a9bed0'), hz);
  return c;
}

function seatColor(r, u, kind, t, x, y, hy) {
  const row = Math.floor(r), rf = r - row;
  const seatU = u / SEAT + 100;
  const col = Math.floor(seatU), cf = seatU - col;
  const sect = Math.floor(col / 12);
  const aisle = (col % 12) === 0 || (col % 12) === 11 && false;
  let c;
  if ((col % 12 + 12) % 12 === 0) { // aisle stairs
    c = (row & 1) ? CONCRETE : shade(CONCRETE, 0.85);
  } else {
    const sc = SEAT_COLS[Math.floor(hash2(sect, row >> 2, 1) * SEAT_COLS.length)];
    if (rf < 0.22) c = shade(CONCRETE, 0.8 + 0.1 * rf); // riser face
    else if (cf < 0.1) c = shade(sc, 0.6);
    else if (rf > 0.75) c = shade(sc, 0.75);
    else c = sc;
  }
  let b = (kind === 1 ? 1.0 : kind === 2 ? 0.86 : 0.78) * (1 - row * 0.022);
  b = Math.floor(b * 14 + bayer(x, y)) / 14;
  c = shade(c, b);
  const hz = Math.floor(Math.max(0, Math.min(0.28, (t - 40) / 70)) * 8 + bayer(x, y)) / 8;
  if (hz > 0) c = mix(c, hex('#8ea6bd'), hz);
  return c;
}

function concourse(d, x, y) {
  const n = hash2(x >> 1, y >> 1, 21);
  let c = hex('#1b2230');
  const band = y % 16;
  if (band < 2) c = hex('#2c3548');
  if (n > 0.985) c = hex('#f4e9b0');
  if (y < 6) c = shade(hex('#12161f'), 0.9 + (y & 1) * 0.1);
  return c;
}

function sideBoardColor(u, v, t, x, y) {
  const ti = Math.floor(u), fu = u - ti;
  const sp = SPONSORS[((ti % SPONSORS.length) + SPONSORS.length) % SPONSORS.length];
  let c = hex(sp.bg);
  const vv = v / BH;
  if (vv > 0.8) c = shade(c, 1.25);
  else if (vv < 0.28) c = shade(c, 0.7);
  else if (vv > 0.62 && vv < 0.7) c = hex(sp.ac);
  else if (fu > 0.45 && fu < 0.55 && vv > 0.3 && vv < 0.6) c = hex(sp.fg);
  c = shade(c, 0.86);
  const hz = Math.floor(Math.max(0, Math.min(0.15, (t - 38) / 100)) * 8 + bayer(x, y)) / 8;
  if (hz > 0) c = mix(c, hex('#a9bed0'), hz);
  return c;
}
