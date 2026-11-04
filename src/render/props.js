// Net layer (posts, mesh, tape, singles sticks, umpire chair) and static people (line judges, ball kids).
import { COURT } from '../config.js';
import { camera } from './camera.js';
import { PixBuf, hex, rgba, shade, mix } from './raster.js';
import { STAGE, THEMES } from './stage.js';

const W = camera.W, H = camera.H;
const POST_X = COURT.doublesHalfWidth + 0.914; // 6.399
const NET_TOP_C = COURT.netHeightCenter, NET_TOP_P = COURT.netHeightPost;

export function netTopAt(x) {
  const ax = Math.abs(x);
  if (ax >= COURT.netPostX) return NET_TOP_P;
  return NET_TOP_C + (NET_TOP_P - NET_TOP_C) * (ax / COURT.netPostX) ** 1.6; // slight sag curve
}

function fillPoly(pb, pts, c) { pb.poly(pts.map((p) => [p.sx, p.sy]), c); }
const P = (x, y, z) => camera.project(x, y, z);

export function renderNetLayer(surface = 'hard') {
  const TH = THEMES[surface] || THEMES.hard;
  const pb = new PixBuf(W, H);
  const left = P(-POST_X, 0, 0), right = P(POST_X, 0, 0);
  const x0 = Math.floor(left.sx) - 4, x1 = Math.ceil(right.sx) + 4;
  const WHITE = hex('#f6f6f0'), TAPE2 = hex('#c9ccd2');
  // mesh
  for (let sx = x0; sx <= x1; sx++) {
    // world x for this column (net plane z=0)
    const d = camera.rayDir(sx + 0.5, 200);
    const t = -camera.pos.z / d.z;
    const wx = t * d.x;
    if (Math.abs(wx) > POST_X) continue;
    const top = netTopAt(wx);
    const sTop = P(wx, top, 0).sy, sBot = P(wx, 0, 0).sy;
    const yTop = Math.round(sTop), yBot = Math.round(sBot);
    for (let sy = yTop; sy <= yBot; sy++) {
      let c;
      if (sy <= yTop + 1) c = sy === yTop ? WHITE : TAPE2;
      else if (sy >= yBot - 0) c = rgba(225, 228, 232, 235); // bottom cable/tape
      else {
        const m = ((sx & 1) === (sy & 1));
        c = m ? rgba(16, 24, 38, 120) : ((sx + sy) % 4 === 1 ? rgba(235, 240, 245, 55) : rgba(0, 0, 0, 0));
        if ((sx % 8) === 0) c = rgba(14, 20, 32, 150);
        if ((sy - yTop) % 5 === 3) c = rgba(14, 20, 32, 150); // horizontal knots
      }
      pb.set(sx, sy, c);
    }
    // strap
    if (Math.abs(wx) < 0.045) { for (let sy = yTop + 2; sy <= yBot; sy++) pb.set(sx, sy, WHITE); }
  }
  // singles sticks
  for (const sgn of [-1, 1]) {
    const gx = sgn * COURT.netPostX;
    const a = P(gx, 0, 0), b = P(gx, NET_TOP_P + 0.03, 0);
    const w = Math.max(1, Math.round(0.05 * a.scale));
    const xs = Math.round(a.sx - w / 2);
    for (let sy = Math.round(b.sy); sy <= Math.round(a.sy); sy++) {
      pb.rect(xs, sy, w, 1, ((sy >> 1) & 1) ? hex('#e8e4d0') : hex('#d4cfb8'));
    }
    pb.rect(xs, Math.round(b.sy), w, 1, hex('#ffffff'));
  }
  // posts
  for (const sgn of [-1, 1]) {
    const gx = sgn * POST_X;
    const a = P(gx, 0, 0), b = P(gx, NET_TOP_P + 0.04, 0);
    const w = Math.max(3, Math.round(0.13 * a.scale));
    const xs = Math.round(a.sx - w / 2);
    const ys = Math.round(b.sy), ye = Math.round(a.sy);
    pb.rect(xs, ys, w, ye - ys + 1, hex('#2c3240'));
    pb.rect(xs, ys, 1, ye - ys + 1, hex('#5d6a82'));
    pb.rect(xs + w - 1, ys, 1, ye - ys + 1, hex('#161a22'));
    pb.rect(xs, ys + 2, w, 2, hex(TH.wallLite));
    pb.rect(xs - 1, ys - 1, w + 2, 2, hex('#3b4354'));
    pb.rect(xs, ys - 1, w, 1, hex('#6f7c96'));
    // net strap anchor
    pb.rect(xs + (sgn > 0 ? -1 : w), Math.round(P(gx, NET_TOP_P - 0.03, 0).sy), 1, 2, hex('#f6f6f0'));
    // foot shadow on court
  }
  drawUmpireChair(pb, TH);
  return pb;
}

function darken(pb, x, y, f) { const c = pb.get(x, y); if (c) pb.set(x, y, shade(c, f)); }

function drawUmpireChair(pb, TH) {
  const cx = 7.75;
  const k = P(cx, 0, 0).scale;
  const m = (v) => Math.round(v * k);
  const base = P(cx, 0, 0);
  const bx = Math.round(base.sx), by = Math.round(base.sy);
  const FRAME = hex(TH.wall), FR_L = hex(TH.wallLite), FR_D = shade(hex(TH.wall), 0.6);
  const seatY = m(1.75);
  // ground shadow
  for (let j = 0; j < 4; j++) pb.rect(bx - m(0.6) + j * 2, by + j - 1, m(1.3), 1, rgba(0, 0, 0, 70));
  // legs (A-frame) front pair + back pair offset up
  const leg = (x0, y0, x1, y1, c) => { pb.line(x0, y0, x1, y1, c); pb.line(x0 + 1, y0, x1 + 1, y1, shade(c, 0.7)); };
  leg(bx - m(0.45), by, bx - m(0.32), by - seatY, FRAME);
  leg(bx + m(0.45), by, bx + m(0.32), by - seatY, FRAME);
  // cross braces
  pb.line(bx - m(0.42), by - m(0.5), bx + m(0.38), by - m(1.2), FR_D);
  pb.line(bx + m(0.42), by - m(0.5), bx - m(0.38), by - m(1.2), FR_D);
  pb.rect(bx - m(0.44), by - m(0.55), m(0.88), 1, FR_L);
  // ladder at front-right
  const lx = bx + m(0.75);
  pb.line(lx, by, lx + m(0.12), by - seatY, FR_L); pb.line(lx + m(0.35), by, lx + m(0.4), by - seatY, FR_L);
  for (let r = 1; r <= 5; r++) { const yy = by - Math.round(seatY * r / 6); pb.rect(lx + 1, yy, m(0.36), 1, FR_L); }
  // seat platform
  pb.rect(bx - m(0.62), by - seatY - 1, m(1.34), 3, hex('#e2e6ee'));
  pb.rect(bx - m(0.62), by - seatY + 2, m(1.34), 1, FR_D);
  // backrest (right side, away from net)
  pb.rect(bx + m(0.46), by - seatY - m(0.8), m(0.18), m(0.8), hex(TH.wall));
  pb.rect(bx + m(0.46), by - seatY - m(0.8), 1, m(0.8), FR_L);
  // desk / scoreboard in front (left)
  pb.rect(bx - m(0.72), by - seatY - m(0.38), m(0.22), m(0.38), hex('#1d2742'));
  pb.rect(bx - m(0.72), by - seatY - m(0.38), m(0.22), 1, hex('#9fb0d0'));
  // umpire (profile, facing left)
  const ux = bx + m(0.05), uy = by - seatY;
  pb.rect(ux - m(0.12), uy - m(0.22), m(0.28), m(0.22), hex('#f4f4f0'));       // thighs/lap
  pb.rect(ux - m(0.18), uy - m(0.22), m(0.14), m(0.22) + 0, hex('#2a3140'));      // trousers knee
  pb.rect(ux - m(0.2), uy, m(0.13), m(0.4), hex('#2a3140'));      // lower leg
  pb.rect(ux - m(0.24), uy + m(0.37), m(0.16), 2, hex('#15151a'));
  pb.rect(ux - m(0.08), uy - m(0.62), m(0.26), m(0.42), hex('#f4f4f0'));       // torso
  pb.rect(ux - m(0.08), uy - m(0.62), 1, m(0.42), hex('#c9ccd2'));
  pb.rect(ux + m(0.1), uy - m(0.62), m(0.08), m(0.42), hex('#c9ccd2'));
  pb.rect(ux - m(0.17), uy - m(0.52), m(0.2), m(0.07), hex('#e3b48f'));        // arm forward
  const hs = Math.max(4, m(0.2));
  pb.rect(ux - m(0.06), uy - m(0.62) - hs, hs, hs, hex('#e3b48f'));              // head
  pb.rect(ux - m(0.06) + 1, uy - m(0.62) - hs, hs - 1, 2, hex('#4a3320'));
  pb.rect(ux - m(0.06) - 0, uy - m(0.62) - hs + 1, 1, 1, hex('#4a3320'));
  // sun hat
  pb.rect(ux - m(0.12), uy - m(0.62) - hs, hs + 4, 1, hex('#f4f4f0'));
}

// ---- static people drawn into the background buffer ----
function person(pb, wx, wz, opts) {
  const p = P(wx, 0, wz), k = p.scale;
  const m = (v) => Math.max(1, Math.round(v * k));
  const x = Math.round(p.sx), y = Math.round(p.sy);
  const { shirt, shorts, skin, hair, seated, hat, front = true, crouch } = opts;
  const sh = hex(shirt), tr = hex(shorts), sk = hex(skin), hr = hex(hair);
  // shadow
  pb.ellipse(x + m(0.1), y, m(0.38), Math.max(1, m(0.1)), rgba(0, 0, 0, 70), true);
  if (seated) {
    const sy0 = y - m(0.45);
    pb.rect(x - m(0.2), sy0 - m(0.05), m(0.4), m(0.08), shade(sh, 0.5)); // stool seat
    pb.rect(x - 1, sy0, 2, m(0.4), hex('#3a3f4c'));
    pb.rect(x - m(0.17), sy0 - m(0.1), m(0.34), m(0.1), tr);                  // thighs
    pb.rect(x - m(0.15), sy0, m(0.09), m(0.4), sk); pb.rect(x + m(0.06), sy0, m(0.09), m(0.4), sk); // legs
    pb.rect(x - m(0.16), y - 1, m(0.12), 2, hex('#eeeeee')); pb.rect(x + m(0.04), y - 1, m(0.12), 2, hex('#eeeeee'));
    pb.rect(x - m(0.2), sy0 - m(0.55), m(0.4), m(0.46), sh);
    pb.rect(x - m(0.2), sy0 - m(0.55), 1, m(0.46), shade(sh, 1.15));
    pb.rect(x + m(0.2) - 1, sy0 - m(0.55), 1, m(0.46), shade(sh, 0.72));
    pb.rect(x - m(0.27), sy0 - m(0.5), m(0.08), m(0.3), sk); pb.rect(x + m(0.19), sy0 - m(0.5), m(0.08), m(0.3), sk);
    const hs = Math.max(3, m(0.2));
    pb.rect(x - (hs >> 1), sy0 - m(0.55) - hs, hs, hs, sk);
    pb.rect(x - (hs >> 1), sy0 - m(0.55) - hs, hs, Math.max(1, hs >> 2), hr);
    if (hat) pb.rect(x - (hs >> 1) - 1, sy0 - m(0.55) - hs, hs + 2, 1, hex(hat));
  } else {
    const kneel = crouch ? 0.45 : 0;
    const top = y - m(1.0 - kneel);
    pb.rect(x - m(0.14), top + m(0.5), m(0.12), m(0.5 - kneel * 0.2) , sk);
    pb.rect(x + m(0.03), top + m(0.5), m(0.12), m(0.5 - kneel * 0.2), sk);
    pb.rect(x - m(0.15), top + m(0.38), m(0.31), m(0.18), tr);
    pb.rect(x - m(0.17), top, m(0.35), m(0.42), sh);
    pb.rect(x - m(0.17), top, 1, m(0.42), shade(sh, 1.15)); pb.rect(x + m(0.17), top, 1, m(0.42), shade(sh, 0.72));
    pb.rect(x - m(0.24), top + m(0.04), m(0.07), m(0.3), sk); pb.rect(x + m(0.18), top + m(0.04), m(0.07), m(0.3), sk);
    const hs = Math.max(3, m(0.19));
    pb.rect(x - (hs >> 1), top - hs, hs, hs, sk);
    pb.rect(x - (hs >> 1), top - hs, hs, Math.max(1, hs >> 2), hr);
    if (hat) pb.rect(x - (hs >> 1) - 1, top - hs, hs + 2, 1, hex(hat));
  }
}

function box(pb, x, y, z, w, h, d, c) {
  // simple shaded block standing on the court: front face + top
  const f = P(x, y, z), g = P(x + w, y + h, z), t = P(x, y + h, z - d);
  const x0 = Math.round(f.sx), x1 = Math.round(P(x + w, 0, z).sx), yb = Math.round(f.sy), yt = Math.round(g.sy);
  pb.rect(x0, yt, x1 - x0, yb - yt, c);
  pb.rect(x0, yt, x1 - x0, 1, shade(c, 1.3));
  pb.rect(x1 - 1, yt, 1, yb - yt, shade(c, 0.7));
  pb.rect(x0, yb - 1, x1 - x0, 1, shade(c, 0.6));
}
function bench(pb, x, z, TH) {
  const wall = hex(TH.wall);
  const q = P(x, 0, z), k = q.scale, m = (v) => Math.max(1, Math.round(v * k));
  pb.ellipse(Math.round(q.sx + m(0.4)), Math.round(q.sy), m(1.0), Math.max(1, m(0.1)), rgba(0, 0, 0, 70), true);
  const bx = Math.round(q.sx - m(0.8)), by = Math.round(q.sy);
  pb.rect(bx, by - m(0.45), m(1.6), m(0.1), hex('#d8dce4'));            // seat
  pb.rect(bx + 1, by - m(0.35), 2, m(0.35), hex('#2a2f3a')); pb.rect(bx + m(1.6) - 3, by - m(0.35), 2, m(0.35), hex('#2a2f3a'));
  pb.rect(bx, by - m(0.95), m(1.6), m(0.5), wall);                       // back
  pb.rect(bx, by - m(0.95), m(1.6), 1, hex(TH.wallLite));
  // towel box
  const tb = bx + m(1.75);
  pb.rect(tb, by - m(0.5), m(0.45), m(0.5), shade(wall, 0.8)); pb.rect(tb, by - m(0.5), m(0.45), 1, hex(TH.wallLite));
  pb.rect(tb + 1, by - m(0.62), m(0.45) - 2, m(0.12), hex('#f2f2ea'));
}
export function drawStaticPeople(pb, surface = 'hard') {
  const TH = THEMES[surface] || THEMES.hard;
  const J = { shirt: '#f2f2ea', shorts: '#1b2438', skin: '#e0a97c', hair: '#2a1d12', seated: true, hat: '#f2f2ea' };
  const { ZB } = STAGE;
  person(pb, 0.0, -ZB + 1.0, { ...J, skin: '#f1c9a5' });
  person(pb, -7.3, -ZB + 1.0, { ...J, skin: '#c98a5b', hair: '#111' });
  person(pb, 7.3, -ZB + 1.0, { ...J, skin: '#e0a97c' });
  person(pb, -7.2, -4.2, { ...J, skin: '#9a6038', hair: '#111' });
  person(pb, 7.2, -4.0, { ...J, skin: '#f1c9a5', hair: '#6b4423' });
  person(pb, -10.3, 7.0, { ...J, skin: '#e0a97c' });
  person(pb, 10.3, 7.0, { ...J, skin: '#f7dcc2', hair: '#a33a1e' });
  const K = { shirt: TH.wallLite, shorts: '#1c2236', skin: '#e0a97c', hair: '#3b2415', crouch: true };
  person(pb, -7.0, -17.2, { ...K });
  person(pb, 7.0, -17.2, { ...K, skin: '#c98a5b' });
  person(pb, -6.6, -0.8, { ...K, skin: '#f1c9a5', hair: '#c8a24a' });
  person(pb, 6.6, -1.2, { ...K, skin: '#9a6038', hair: '#111' });
  // benches with towel boxes on the umpire-opposite side, net-cord sensor
  bench(pb, -8.6, 3.2, TH); bench(pb, -8.6, 7.4, TH);
  box(pb, 6.25, 0, 0.35, 0.22, 0.18, 0.2, hex('#2a303c'));
}
