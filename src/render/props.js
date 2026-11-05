// Net layer (posts, mesh, tape, singles sticks, umpire chair) and static people (line judges, ball kids).
import { COURT } from '../config.js';
import { camera } from './camera.js';
import { PixBuf, hex, rgba, shade, mix } from './raster.js';
import { STAGE, THEMES } from './stage.js';
import { drawPixText, textWidth } from './font.js';

const W = camera.W, H = camera.H;
const POST_X = COURT.doublesHalfWidth + 0.914; // 6.399
const NET_TOP_C = COURT.netHeightCenter, NET_TOP_P = COURT.netHeightPost;
const NET_ROW = camera.project(0, 0.5, 0).sy;
const UMP_X = 7.15;            // umpire chair right beside the umpire-side (right) net post
// Player benches: one per player either side of the umpire chair, outside the doubles sideline, facing the court.
// Long axis runs along z (parallel to the sideline). 1.8 m long, 0.5 m seat depth, seat 0.45 m, low back to 0.95 m.
const BENCH = { x0: 7.95, len: 2.0, depth: 0.5, seatH: 0.45, backH: 0.92, backT: 0.1, zc: 3.1 };

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
  // made-up wordmark bands printed on the net near each end (between centre strap and singles sticks)
  for (const sg of [-1, 1]) {
    const xa = sg * 2.15, xb = sg * 4.75;
    const ya = (x) => netTopAt(x) - 0.05, yb = (x) => netTopAt(x) - 0.29;
    const pts = [[xa, ya(xa)], [xb, ya(xb)], [xb, yb(xb)], [xa, yb(xa)]].map(([x, y]) => { const q = P(x, y, 0); return [q.sx, q.sy]; });
    pb.poly(pts, rgba(...[0, 0, 0].map((v, i) => [hex(TH.wall) & 255, (hex(TH.wall) >>> 8) & 255, (hex(TH.wall) >>> 16) & 255][i]), 225));
    const word = TH.brands[2];
    const cx = P((xa + xb) / 2, 0, 0).sx, cy = P((xa + xb) / 2, (ya((xa + xb) / 2) + yb((xa + xb) / 2)) / 2, 0).sy;
    drawPixText(pb, word, Math.round(cx - textWidth(word) / 2), Math.round(cy - 3.5), hex(TH.text), 1);
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
    // padded post cover in the theme colour with a light band
    pb.rect(xs, ys, w, ye - ys + 1, hex(TH.wall));
    pb.rect(xs, ys, 1, ye - ys + 1, hex(TH.wallLite));
    pb.rect(xs + w - 1, ys, 1, ye - ys + 1, shade(hex(TH.wall), 0.6));
    pb.rect(xs, ys + 2, w, 2, hex(TH.text));
    pb.rect(xs, ye - 3, w, 1, hex(TH.accent));
    pb.rect(xs - 1, ys - 1, w + 2, 2, hex('#3b4354'));
    pb.rect(xs, ys - 1, w, 1, hex('#6f7c96'));
    // net strap anchor
    pb.rect(xs + (sgn > 0 ? -1 : w), Math.round(P(gx, NET_TOP_P - 0.03, 0).sy), 1, 2, hex('#f6f6f0'));
    // foot shadow on court
  }
  drawUmpireChair(pb, TH);
  // near-side (z > 0) courtside items live in the net layer so they draw in front of the net/umpire chair
  playerBench(pb, +1, TH);
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

// ---------- small 3D helpers (flat-shaded boxes, planar text) ----------
const CAM = camera.pos;
const proj2 = (x, y, z) => { const q = P(x, y, z); return [q.sx, q.sy]; };
export function quad3(pb, pts, c) { pb.poly(pts.map((q) => proj2(q[0], q[1], q[2])), c); }
// axis-aligned box; draws only the faces the camera can see, far faces first
export function box3(pb, x0, x1, y0, y1, z0, z1, col, opt = {}) {
  const c = hex(col);
  const side = opt.side != null ? hex(opt.side) : shade(c, 0.82), end = opt.end != null ? hex(opt.end) : shade(c, 0.68), top = opt.top != null ? hex(opt.top) : shade(c, 1.18);
  if (CAM.x < x0) quad3(pb, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], side);
  else if (CAM.x > x1) quad3(pb, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], side);
  if (CAM.z > z1) quad3(pb, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], end);
  if (CAM.y > y1) quad3(pb, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], top);
}
const maskCache = new Map();
export function textMask(str, font = 'small', pad = 1) {
  const key = str + '|' + font + '|' + pad;
  let m = maskCache.get(key); if (m) return m;
  const fh = font === 'big' ? 14 : 7;
  const w = textWidth(str, 1, font) + pad * 2, h = fh + pad * 2;
  const pb = new PixBuf(w, h);
  drawPixText(pb, str, pad, pad, 0xffffffff, 1, { font });
  m = { w, h, on: (u, v) => pb.px[v * w + u] !== 0 };
  maskCache.set(key, m); return m;
}
// paint text onto the vertical plane x = xc (reads left->right with +z, i.e. as seen from the court side x < xc)
export function textOnPlaneX(pb, xc, z0, z1, y0, y1, str, col, font = 'small', flip = false) {
  const m = textMask(str, font, 1), c = hex(col);
  const pts = [proj2(xc, y0, z0), proj2(xc, y0, z1), proj2(xc, y1, z1), proj2(xc, y1, z0)];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  for (let py = Math.floor(Math.min(...ys)); py <= Math.ceil(Math.max(...ys)); py++) {
    for (let px = Math.floor(Math.min(...xs)); px <= Math.ceil(Math.max(...xs)); px++) {
      const d = camera.rayDir(px + 0.5, py + 0.5);
      if (Math.abs(d.x) < 1e-6) continue;
      const t = (xc - CAM.x) / d.x; if (t <= 0) continue;
      const y = CAM.y + t * d.y, z = CAM.z + t * d.z;
      if (y < y0 || y > y1 || z < z0 || z > z1) continue;
      let u = (z - z0) / (z1 - z0); if (flip) u = 1 - u;
      const tu = Math.floor(u * m.w), tv = Math.floor((y1 - y) / (y1 - y0) * m.h);
      if (tu >= 0 && tv >= 0 && tu < m.w && tv < m.h && m.on(tu, tv)) pb.set(px, py, c);
    }
  }
}

// Player bench seen from the camera: fitted cover in the theme colour, sponsor wordmark on the low backrest,
// racket bag + towels on the seat, drinks fridge with bottles at the end away from the umpire chair.
function playerBench(pb, side, TH) {   // side: +1 near-side bench (z>0), -1 far-side bench
  // Reads as "long padded seat + low back" even foreshortened: light seat-top plane, open gap under the seat
  // (short legs + floor shadow), a visible gap between seat and backrest, a white towel and a black racket bag
  // breaking the silhouette. Small dark drinks fridge tucked on the wall side at the far end.
  const { x0, len, depth, seatH, backH, backT } = BENCH;
  const zc = side * BENCH.zc, z0 = zc - len / 2, z1 = zc + len / 2;
  const wall = hex(TH.wall), lite = hex(TH.wallLite);
  const xb = x0 + depth + 0.04;                   // backrest front plane (small gap behind the seat)
  const umpEnd = side > 0 ? z0 : z1;
  const cushT = 0.1, legC = '#22262f';
  const seatTop = mix(lite, hex('#ffffff'), 0.22);  // clearly lighter seat-top plane
  const fridge = () => {
    // small, dark, on the wall side beyond the bench end (never between the bench and the camera)
    const fx0 = xb + backT + 0.12, fx1 = fx0 + 0.42;
    const fz0 = side > 0 ? z1 - 0.5 : z0 + 0.08, fz1 = fz0 + 0.42;
    box3(pb, fx0, fx1, 0, 0.62, fz0, fz1, '#2a2f3a', { side: '#20242d', end: '#191c23', top: '#3d4452' });
    // small glass door on the court-facing side with a few bottles
    quad3(pb, [[fx0 - 0.001, 0.14, fz0 + 0.07], [fx0 - 0.001, 0.14, fz1 - 0.07], [fx0 - 0.001, 0.5, fz1 - 0.07], [fx0 - 0.001, 0.5, fz0 + 0.07]], hex('#14202c'));
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
      const yy = 0.18 + r * 0.17, zz = fz0 + 0.1 + k * 0.08;
      quad3(pb, [[fx0 - 0.002, yy, zz], [fx0 - 0.002, yy, zz + 0.04], [fx0 - 0.002, yy + 0.11, zz + 0.04], [fx0 - 0.002, yy + 0.11, zz]], hex(['#9cc8e6', '#f2c230', '#9cc8e6'][k]));
    }
    quad3(pb, [[fx0 - 0.002, 0.52, fz0], [fx0 - 0.002, 0.52, fz1], [fx0 - 0.002, 0.56, fz1], [fx0 - 0.002, 0.56, fz0]], lite);
  };
  // floor shadow under the whole bench (dark band visible through the open legs)
  quad3(pb, [[x0 + 0.02, 0.002, z0 + 0.05], [xb + backT + 0.18, 0.002, z0 + 0.05], [xb + backT + 0.18, 0.002, z1 + 0.18], [x0 + 0.02, 0.002, z1 + 0.18]], rgba(0, 0, 0, 95));
  if (side < 0) fridge();
  // short legs (4 under the seat, 2 posts carrying the backrest)
  const legH = seatH - cushT;
  for (const zz of [z0 + 0.08, z1 - 0.12]) {
    box3(pb, x0 + 0.06, x0 + 0.1, 0, legH, zz, zz + 0.04, legC);
    box3(pb, xb - 0.08, xb - 0.04, 0, legH, zz, zz + 0.04, legC);
    box3(pb, xb + 0.02, xb + 0.06, legH, backH - 0.1, zz, zz + 0.04, legC);
  }
  // seat cushion: theme-colour sides, light top, accent piping on the front edge
  box3(pb, x0, xb - 0.02, legH, seatH, z0, z1, TH.wall, { side: shade(wall, 0.95), end: shade(wall, 0.7), top: seatTop });
  quad3(pb, [[x0 - 0.001, seatH - 0.022, z0], [x0 - 0.001, seatH - 0.022, z1], [x0 - 0.001, seatH, z1], [x0 - 0.001, seatH, z0]], hex(TH.accent));
  // low padded backrest floating above the seat (gap shows the shadowed rail behind)
  const by0 = seatH + 0.12;
  box3(pb, xb, xb + backT, by0, backH, z0, z1, TH.wall, { side: wall, end: shade(wall, 0.7), top: seatTop });
  quad3(pb, [[xb - 0.001, backH - 0.025, z0], [xb - 0.001, backH - 0.025, z1], [xb - 0.001, backH, z1], [xb - 0.001, backH, z0]], hex(TH.accent));
  textOnPlaneX(pb, xb - 0.002, z0 + 0.25, z1 - 0.25, by0 + 0.04, backH - 0.05, TH.brands[1], TH.text, 'small');
  // racket bag lying on the seat at the umpire end
  const bz0 = side > 0 ? umpEnd + 0.08 : umpEnd - 0.88, bz1 = bz0 + 0.8;
  box3(pb, x0 + 0.08, x0 + 0.36, seatH, seatH + 0.14, bz0, bz1, '#16181e', { top: '#343a47', side: '#1f222a' });
  quad3(pb, [[x0 + 0.079, seatH + 0.055, bz0 + 0.1], [x0 + 0.079, seatH + 0.055, bz1 - 0.1], [x0 + 0.079, seatH + 0.085, bz1 - 0.1], [x0 + 0.079, seatH + 0.085, bz0 + 0.1]], hex(TH.accent));
  // white towel draped over the backrest (hangs down the front, over the top)
  const tz = side > 0 ? zc + 0.2 : zc - 0.55;
  box3(pb, xb - 0.03, xb + backT + 0.02, seatH + 0.16, backH + 0.03, tz, tz + 0.34, '#f2f2ea', { side: '#ecece5', end: '#c9ccd2', top: '#ffffff' });
  if (side > 0) fridge();
}

// Background-layer people/props (everything behind the net plane or never overlapping it).
// No line judges: electronic line calling.
export function drawStaticPeople(pb, surface = 'hard') {
  const TH = THEMES[surface] || THEMES.hard;
  const K = ballKid(TH);
  const { ZB } = STAGE;
  // far-side player bench (other side of the umpire chair)
  playerBench(pb, -1, TH);
  // net-cord sensor box clipped to the umpire-side post
  box(pb, 6.5, 0, -0.05, 0.24, 0.2, 0.2, hex('#2a303c'));
  // net ball kid on the far side of the net at the umpire-side post (seen through the mesh)
  person(pb, 6.0, -0.45, { ...K, skin: '#9a6038', hair: '#111', crouch: true });
}
