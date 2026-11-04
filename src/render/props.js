// Net layer (posts, mesh, tape, singles sticks, umpire chair) and static people (line judges, ball kids).
import { COURT } from '../config.js';
import { camera } from './camera.js';
import { PixBuf, hex, rgba, shade, mix } from './raster.js';
import { STAGE, THEMES } from './stage.js';

const W = camera.W, H = camera.H;
const POST_X = COURT.doublesHalfWidth + 0.914; // 6.399
const NET_TOP_C = COURT.netHeightCenter, NET_TOP_P = COURT.netHeightPost;
const NET_ROW = camera.project(0, 0.5, 0).sy;
const UMP_X = 7.15;            // umpire chair right beside the umpire-side (right) net post
const CHAIR_X = 9.3, CHAIR_Z = 3.0; // players' chairs either side of the umpire chair, facing the court   // screen row through the net plane (mid height)

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
    const d = camera.rayDir(sx + 0.5, NET_ROW);
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
  // near-side (z > 0) courtside items live in the net layer so they draw in front of the net/umpire chair
  playerChair(pb, CHAIR_X, CHAIR_Z, TH);
  person(pb, -6.0, 0.45, { ...ballKid(TH), skin: '#f1c9a5', hair: '#c8a24a', crouch: true });
  return pb;
}

function darken(pb, x, y, f) { const c = pb.get(x, y); if (c) pb.set(x, y, shade(c, f)); }

function drawUmpireChair(pb, TH) {
  const cx = UMP_X;
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
    if (k >= 26) personDetail(pb, x, sy0 - m(0.55), hs, m, sh, sk, hat, y, true);
  } else {
    if (k >= 24) { ballKidFigure(pb, x, y, k, sh, tr, sk, hr, crouch); return; }
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
    if (k >= 26) personDetail(pb, x, top, hs, m, sh, sk, hat, y, false);
  }
}

// Ball kid at decent size: rounded head with hair, short-sleeved shirt with shading, shorts, white socks, dark shoes.
// Standing: upright, arms behind the back (elbows just visible). Crouching: knees bent, hands on knees, leaning in.
function ballKidFigure(pb, x, y, k, sh, tr, sk, hr, crouch) {
  const m = (v) => Math.max(1, Math.round(v * k));
  const shD = shade(sh, 0.72), shL = shade(sh, 1.18), skD = shade(sk, 0.8), trD = shade(tr, 0.7);
  const shoe = hex('#23262e'), sock = hex('#f2f2ea');
  const legH = crouch ? m(0.32) : m(0.66), torsoH = m(0.44), hs = Math.max(4, m(0.2));
  const hipY = y - legH, shY = hipY - torsoH + (crouch ? m(0.06) : 0);
  const lean = crouch ? m(0.1) : 0;            // crouch: upper body shifts forward (screen left/right is neutral)
  // legs
  const lw = Math.max(2, m(0.1)), gap = Math.max(1, m(0.04));
  for (const sx of [-1, 1]) {
    const lx = sx < 0 ? x - gap - lw : x + gap;
    if (crouch) {
      // thigh (foreshortened, pointing at camera) + shin
      pb.rect(lx - (sx < 0 ? m(0.05) : 0), hipY, lw + m(0.05), m(0.12), tr);
      pb.rect(lx, hipY + m(0.12), lw, legH - m(0.12) - 2, sk);
      pb.rect(lx + lw - 1, hipY + m(0.12), 1, legH - m(0.12) - 2, skD);
    } else {
      pb.rect(lx, hipY, lw, legH - 2, sk);
      pb.rect(lx + lw - 1, hipY, 1, legH - 2, skD);
      pb.rect(lx, y - Math.max(3, m(0.12)), lw, Math.max(2, m(0.08)), sock);
    }
    pb.rect(lx - (sx < 0 ? 1 : 0), y - 2, lw + 1, 2, shoe);
  }
  // shorts
  const sw = m(0.34);
  pb.rect(x - (sw >> 1), hipY - m(0.06), sw, m(crouch ? 0.14 : 0.2), tr);
  pb.rect(x - (sw >> 1) + sw - 1, hipY - m(0.06), 1, m(crouch ? 0.14 : 0.2), trD);
  if (!crouch) pb.rect(x, hipY + m(0.05), 1, m(0.09), trD);
  // torso with rounded shoulders
  const tw = m(0.38), tx = x - (tw >> 1) - lean;
  pb.rect(tx + 1, shY, tw - 2, 1, sh);
  pb.rect(tx, shY + 1, tw, torsoH - 1, sh);
  pb.rect(tx + 1, shY + 1, Math.max(1, tw >> 3), torsoH - 3, shL);
  pb.rect(tx + tw - 2, shY + 1, 2, torsoH - 1, shD);
  pb.rect(tx, shY + torsoH - 2, tw, 2, shD);                       // tucked hem shadow
  pb.rect(x - 1 - lean, shY, 3, 1, shade(sh, 0.55));              // collar
  // arms
  const aw = Math.max(2, m(0.07));
  if (crouch) {
    for (const sx of [-1, 1]) {
      const ax = sx < 0 ? tx - aw + 1 : tx + tw - 1;
      pb.rect(ax, shY + 1, aw, m(0.12), sh);                          // sleeve
      pb.rect(ax + (sx < 0 ? 1 : -1) * 0, shY + 1 + m(0.12), aw, m(0.2), sk); // forearm down to the knee
      pb.rect(ax, shY + 1 + m(0.32), aw + 1, Math.max(2, m(0.06)), sk);    // hand on knee
    }
  } else {
    // arms behind the back: only sleeves and a sliver of upper arm
    pb.rect(tx - 1, shY + 1, aw, m(0.13), sh); pb.rect(tx + tw - aw + 1, shY + 1, aw, m(0.13), shD);
    pb.rect(tx - 1, shY + 1 + m(0.13), aw - 1, m(0.14), skD); pb.rect(tx + tw - aw + 2, shY + 1 + m(0.13), aw - 1, m(0.14), skD);
  }
  // head
  const hx = x - (hs >> 1) - lean, hy = shY - hs - 1;
  pb.rect(x - 1 - lean, shY - 1, 2, 2, skD);                      // neck
  pb.rect(hx + 1, hy, hs - 2, hs, sk); pb.rect(hx, hy + 1, hs, hs - 2, sk);
  pb.rect(hx + hs - 1, hy + 1, 1, hs - 2, skD);
  pb.rect(hx + 1, hy - 1, hs - 2, Math.max(2, hs >> 2) + 1, hr);   // hair
  pb.rect(hx, hy, 1, Math.max(2, hs >> 1), hr); pb.rect(hx + hs - 1, hy, 1, Math.max(1, hs >> 2) + 1, hr);
  if (hs >= 6) { pb.set(hx + (hs >> 1) - 2, hy + (hs >> 1), hex('#1c1c24')); pb.set(hx + (hs >> 1) + 1, hy + (hs >> 1), hex('#1c1c24')); }
}

// extra pixels when the figure is large enough (540p+): collar, sleeves, belt, shoes, face shading, cap brim
function personDetail(pb, x, torsoTop, hs, m, sh, sk, hat, footY, seated) {
  const dark = shade(sh, 0.62);
  pb.rect(x - 1, torsoTop, 3, 1, dark); pb.set(x, torsoTop + 1, dark);                 // collar V
  pb.rect(x - m(0.2) - (seated ? m(0.07) : 0), torsoTop + 1, m(0.08), m(0.12), sh);     // sleeves
  pb.rect(x + m(0.19) - (seated ? 0 : 1), torsoTop + 1, m(0.08), m(0.12), shade(sh, 0.85));
  if (!seated) pb.rect(x - m(0.15), torsoTop + m(0.38), m(0.31), 1, hex('#20242e'));      // belt
  pb.rect(x - m(0.17), footY - 1, m(0.14), 2, hex('#2a2f3a')); pb.rect(x + m(0.03), footY - 1, m(0.14), 2, hex('#2a2f3a')); // shoes
  const hx = x - (hs >> 1), hy = torsoTop - hs;
  pb.rect(hx + hs - 1, hy + 1, 1, hs - 1, shade(sk, 0.8));                              // face shading
  pb.set(hx, hy + hs - 1, shade(sk, 0.9));
  if (hat) { pb.rect(hx - 2, hy + 1, hs + 4, 1, shade(hex(hat), 0.82)); }                 // brim
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
const ballKid = (TH) => ({ shirt: TH.wallLite, shorts: '#1c2236', skin: '#e0a97c', hair: '#3b2415' });

// Courtside player chair seen side-on, facing the court (screen left), with drinks cooler, towel box and racket bag.
function playerChair(pb, x, z, TH) {
  const wall = hex(TH.wall), lite = hex(TH.wallLite), white = hex('#f2f2ea');
  const at = (dx, dz) => { const q = P(x + dx, 0, z + dz); return { x: Math.round(q.sx), y: Math.round(q.sy), k: q.scale }; };
  const k = at(0, 0).k, m = (v) => Math.max(1, Math.round(v * k));
  // shadow under the whole group
  const g = at(0.1, 0);
  pb.ellipse(g.x + m(0.15), g.y, m(0.9), Math.max(2, m(0.16)), rgba(0, 0, 0, 70), true);
  // drinks cooler / small table (wall side of the chair)
  {
    const c = at(0.85, -0.15), w = m(0.46), h = m(0.6);
    pb.rect(c.x - (w >> 1), c.y - h, w, h, hex('#e9ecf1'));
    pb.rect(c.x - (w >> 1), c.y - h, w, m(0.08), lite);
    pb.rect(c.x - (w >> 1) + w - 1, c.y - h, 1, h, hex('#b9bec8'));
    pb.rect(c.x - (w >> 1), c.y - 2, w, 2, hex('#9aa0ab'));
    pb.rect(c.x - (w >> 1) + 2, c.y - Math.round(h * 0.55), w - 4, 1, hex('#c9ced6'));
    // bottles
    const bw = Math.max(2, m(0.07)), bh = m(0.24);
    [[-0.12, '#cfe6f5'], [0.0, '#f2c230'], [0.12, '#cfe6f5']].forEach(([ox, col]) => {
      const bx = c.x + m(ox) - (bw >> 1);
      pb.rect(bx, c.y - h - bh, bw, bh, hex(col)); pb.rect(bx, c.y - h - bh, bw, 1, shade(hex(col), 0.6));
      pb.rect(bx + bw - 1, c.y - h - bh + 1, 1, bh - 1, shade(hex(col), 0.8));
    });
  }
  // chair
  {
    const c = at(0, 0);
    const seatH = m(0.48), legC = hex('#2a2f3a');
    const fx = c.x - m(0.28), bx = c.x + m(0.22);
    pb.rect(fx, c.y - seatH, 2, seatH, legC); pb.rect(bx, c.y - seatH, 2, seatH, legC);
    pb.rect(fx + 1, c.y - Math.round(seatH * 0.35), bx - fx, 1, shade(legC, 1.3));          // stretcher
    // padded seat cushion
    const sw = m(0.6), sh = Math.max(3, m(0.11));
    pb.rect(fx - 2, c.y - seatH - sh, sw + 2, sh, wall);
    pb.rect(fx - 1, c.y - seatH - sh, sw, 1, lite);
    pb.rect(fx - 2, c.y - seatH - sh + 1, 1, sh - 2, shade(lite, 0.9));
    pb.rect(fx - 2, c.y - seatH - 1, sw + 2, 1, shade(wall, 0.6));
    // padded backrest (away from the court)
    const bh = m(0.72), bwid = Math.max(4, m(0.14)), bTop = c.y - seatH - sh - bh;
    pb.rect(bx - 1, bTop, bwid, bh + 1, wall);
    pb.rect(bx - 1, bTop, 1, bh, lite);
    pb.rect(bx - 1 + bwid - 1, bTop, 1, bh, shade(wall, 0.65));
    pb.rect(bx - 1, bTop, bwid, 1, lite);
    // white piping + towel over the backrest
    pb.rect(bx - 2, bTop + 1, Math.max(2, m(0.1)), Math.round(bh * 0.45), white);
    pb.rect(bx - 2, bTop + 1, 1, Math.round(bh * 0.45), hex('#c9ccd2'));
  }
  // racket bag lying on the court side of the chair
  {
    const c = at(-0.75, 0.25), w = m(0.85), h = Math.max(3, m(0.2));
    pb.rect(c.x - (w >> 1), c.y - h, w, h, hex('#1b1e26'));
    pb.rect(c.x - (w >> 1) + 1, c.y - h, w - 2, 1, hex('#3a404e'));
    pb.rect(c.x - (w >> 1) + Math.round(w * 0.2), c.y - h + Math.round(h / 2), Math.round(w * 0.6), 1, hex(TH.accent));
    pb.rect(c.x - 2, c.y - h - 1, 4, 1, white);
  }
  // towel box (in front of the chair)
  {
    const c = at(-0.1, 0.8), w = m(0.36), h = m(0.42);
    pb.rect(c.x - (w >> 1), c.y - h, w, h, shade(wall, 0.85));
    pb.rect(c.x - (w >> 1), c.y - h, w, 1, lite);
    pb.rect(c.x - (w >> 1) + w - 1, c.y - h, 1, h, shade(wall, 0.6));
    pb.rect(c.x - (w >> 1) + 1, c.y - h - Math.max(2, m(0.07)), w - 2, Math.max(2, m(0.07)), white);
    pb.rect(c.x - (w >> 1) + 1, c.y - h - Math.max(2, m(0.07)), w - 2, 1, hex('#ffffff'));
  }
}

// Background-layer people/props (everything behind the net plane or never overlapping it).
// No line judges: electronic line calling.
export function drawStaticPeople(pb, surface = 'hard') {
  const TH = THEMES[surface] || THEMES.hard;
  const K = ballKid(TH);
  const { ZB } = STAGE;
  // far-side player chair (other side of the umpire chair)
  playerChair(pb, CHAIR_X, -CHAIR_Z, TH);
  // net-cord sensor box clipped to the umpire-side post
  box(pb, 6.5, 0, -0.05, 0.24, 0.2, 0.2, hex('#2a303c'));
  // net ball kid on the far side of the net at the umpire-side post (seen through the mesh)
  person(pb, 6.0, -0.45, { ...K, skin: '#9a6038', hair: '#111', crouch: true });
  // back-corner ball kids: two behind each baseline, near the back wall, outside the doubles sidelines
  person(pb, -7.4, -ZB + 0.9, { ...K });
  person(pb, 7.4, -ZB + 0.9, { ...K, skin: '#c98a5b' });
  person(pb, -7.9, 16.2, { ...K, skin: '#f1c9a5', hair: '#6b4423' });
  person(pb, 7.9, 16.2, { ...K, skin: '#e0a97c', hair: '#c8a24a' });
}
