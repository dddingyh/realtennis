// Procedural pixel crowd on the stand tiers; separate animated layer (drawn into a transparent buffer).
import { camera } from './camera.js';
import { STAGE, THEMES } from './stage.js';
import { PixBuf, hex, shade, mulberry32, rgba, mix } from './raster.js';

const { XW, ZB, BH, S, ROW, SEAT, TOPH } = STAGE;
const SHIRTS = ['#1f2a44', '#1f2a44', '#15161b', '#15161b', '#e6e3da', '#e6e3da', '#c9b89a', '#7d8696', '#2f3b57', '#8a4a4a', '#3c6a6a', '#b9b2a0', '#232831'].map(hex);
const HATS = ['#f2f2ea', '#f2f2ea', '#e9dcc0', '#1f2a44', '#c8a24a', '#7d8696'].map(hex);
export const PBOX = { x0: -6.6, x1: -2.4 };   // players' box seats (back tier, front rows)
const SKINS = ['#f1c9a5', '#e0a97c', '#c98a5b', '#9a6038', '#6e4228', '#f7dcc2'].map(hex);
const HAIR = ['#1a1410', '#3b2415', '#6b4423', '#c8a24a', '#8a8a8a', '#a33a1e', '#111111'].map(hex);

export class Crowd {
  constructor(seed = 99) {
    this.pb = new PixBuf(camera.W, camera.H);
    this.spec = [];
    this.excite = 0;      // 0..1 decays
    this.lastStep = -1;
    this.build(seed);
  }

  build(seed) {
    const rnd = mulberry32(seed);
    const shadowed = (x, z) => x - 0.45 * z - 7.0 > 0;
    const sun = (x, z, row) => !shadowed(x, z) && row < 5;
    const pbox = (x, z, kind, row) => kind === 1 && row <= 1 && x > PBOX.x0 && x < PBOX.x1;
    const list = [];
    const add = (x, y, z, kind, row) => {
      const p = camera.project(x, y, z);
      if (p.sx < -10 || p.sx > camera.W + 10 || p.sy < -14 || p.sy > camera.H) return;
      list.push({
        sx: Math.round(p.sx), sy: Math.round(p.sy), k: p.scale, depth: p.depth, kind,
        shirt: SHIRTS[(rnd() * SHIRTS.length) | 0], skin: SKINS[(rnd() * SKINS.length) | 0], hair: HAIR[(rnd() * HAIR.length) | 0],
        ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.4, thr: rnd(), big: rnd() < 0.18, sz: 0.88 + rnd() * 0.25, flash: 0,
        // caps / sun hats mostly in the sunlit section; players' box (behind the far baseline, left) is sparser and smarter
        hat: rnd() < (sun(x, z, row) ? 0.22 : 0.05) ? HATS[(rnd() * HATS.length) | 0] : 0,
        skipped: rnd() < (pbox(x, z, kind, row) ? 0.4 : 0.14),
        shades: rnd() < (sun(x, z, row) ? 0.2 : 0.05),
        dark: (row >= 5 ? 0.74 : 1) * (shadowed(x, z) ? 0.78 : 1),
        cloth: (rnd() * 5) | 0, hairStyle: (rnd() * 6) | 0, inner: SHIRTS[(rnd() * SHIRTS.length) | 0],
      });
    };
    const rows = Math.floor((TOPH - BH) / S / ROW);

    for (let r = 0; r < rows; r++) {
      if (r === 4) continue;
      const dist = (r + 0.5) * ROW, y = BH + S * dist;
      // back tier
      for (let col = -100 + 0; col < 100; col++) {
        const c = col + 100; if (c % 10 === 0) continue;
        add((col + 0.5) * SEAT, y, -ZB - dist, 1, r);
      }
      // side tiers
      for (let col = -100; col < 120; col++) {
        const c = col + 100; if (c % 10 === 0) continue;
        const z = (col + 0.5) * SEAT;
        if (z < -ZB - 1) continue;
        add(XW + dist, y, z, 2, r);
        add(-XW - dist, y, z, 3, r);
      }
    }
    list.sort((a, b) => b.depth - a.depth);
    this.spec = list.filter((s) => !s.skipped);
    for (const sp of this.spec) {      // pre-shaded palette per spectator
      const d = sp.dark;
      const sh = shade(sp.shirt, d), sk = shade(sp.skin, d), hr = shade(sp.hair, d), inn = shade(sp.inner, d);
      sp.c = { sh, shD: shade(sh, 0.74), shL: shade(sh, 1.14), sk, skD: shade(sk, 0.8), hr, hrL: shade(hr, 1.35), inn, hat: sp.hat ? shade(sp.hat, d) : 0, hatD: sp.hat ? shade(sp.hat, d * 0.7) : 0 };
    }
  }

  onPoint(strength = 1) { this.excite = Math.min(1, Math.max(this.excite, strength)); }
  // standing ovation (big points): fraction of the crowd on its feet, decays over a few seconds
  ovation(strength = 1) { this.ov = Math.min(1, Math.max(this.ov || 0, strength)); }
  // Mexican wave sweeping across the stands (left -> right)
  wave() { this.waveT = 0; }

  update(dt, time) {
    this.excite = Math.max(0, this.excite - dt * 0.4);
    this.ov = Math.max(0, (this.ov || 0) - dt * 0.16);
    if (this.waveT != null) { this.waveT += dt; if (this.waveT > 4.2) this.waveT = null; }
    const step = Math.floor(time * 10);
    if (step === this.lastStep) return false;
    this.lastStep = step;
    this.draw(time);
    return true;
  }

  draw(time) {
    const pb = this.pb; pb.clear(0);
    const ex = this.excite;
    for (let i = 0; i < this.spec.length; i++) {
      const s = this.spec[i], C = s.c;
      const k = s.k * s.sz;
      const bw = Math.max(4, Math.round(0.44 * k)), bh = Math.max(3, Math.round(0.5 * k));
      const hw = Math.max(3, Math.round(0.21 * k));
      const detail = bw >= 7;                     // enough pixels for shoulders/arms/hair styles
      let lift = 0;
      if (Math.sin(time * s.sp * 2 + s.ph) > 0.92) lift = 1;
      let up = ex > s.thr ? (ex > s.thr + 0.25 || s.big ? 2 : 1) : 0;
      if (this.ov > s.thr * 0.9) up = 2;
      if (this.waveT != null) { const crest = -120 + this.waveT * (camera.W + 240) / 3.6; if (Math.abs(s.sx - crest) < 34) up = 2; }
      const cheering = up > 0 && ((Math.floor(time * 6 + s.ph) & 1) === 0 || up === 2);
      if (cheering) lift += Math.round(0.14 * k) * (up === 2 ? 1 : 0.6) | 0;
      const x0 = s.sx - (bw >> 1), yBot = s.sy - lift + 1, yTop = yBot - bh;
      // ---- torso: rounded shoulders, side shading, clothing variants
      if (detail) {
        pb.rect(x0 + 1, yTop, bw - 2, 1, C.sh);
        pb.rect(x0, yTop + 1, bw, bh - 1, C.sh);
        pb.rect(x0 + 1, yTop, Math.max(1, (bw >> 2)), 1, C.shL);          // lit shoulder
        pb.rect(x0 + bw - 1, yTop + 1, 1, bh - 1, C.shD);
        const cx0 = s.sx - 1;
        switch (s.cloth) {
          case 1: pb.rect(cx0, yTop, 2, bh, C.inn); pb.rect(cx0 - 1, yTop, 1, 2, C.inn); pb.rect(cx0 + 2, yTop, 1, 2, C.inn); break; // open jacket
          case 2: pb.rect(x0, yTop + (bh >> 1), bw, Math.max(1, bh >> 3), C.inn); break;                           // stripe
          case 3: pb.rect(cx0 - 1, yTop, 4, 1, C.inn); break;                                                       // collar
          default: pb.rect(cx0, yTop, 2, 1, C.skD); break;                                                           // tee neckline
        }
        pb.rect(x0, yBot - 1, bw, 1, C.shD);
        // arms resting at the sides (sleeve then hand)
        if (!cheering) {
          pb.rect(x0 - 1, yTop + 1, 1, bh - 2, C.shD);
          pb.rect(x0 + bw, yTop + 1, 1, bh - 2, C.shD);
          pb.rect(x0 - 1, yBot - 2, 1, 1, C.skD); pb.rect(x0 + bw, yBot - 2, 1, 1, C.skD);
        }
      } else {
        pb.rect(x0, yTop, bw, bh, C.sh);
        pb.rect(x0, yBot - 1, bw, 1, C.shD);
        pb.rect(x0 + bw - 1, yTop, 1, bh, C.shD);
      }
      // ---- head: rounded when big enough, hair styles, caps, sunglasses
      const hx = s.sx - (hw >> 1), hy = yTop - hw + (detail ? 0 : 1);
      if (hw >= 5) {
        pb.rect(hx + 1, hy, hw - 2, hw, C.sk); pb.rect(hx, hy + 1, hw, hw - 2, C.sk);
        pb.rect(hx + hw - 1, hy + 1, 1, hw - 2, C.skD);
        if (detail) pb.rect(s.sx - 1, hy + hw, 2, 1, C.skD);                // neck
      } else {
        pb.rect(hx, hy, hw, hw, C.sk);
      }
      const hrow = Math.max(1, (hw / 3) | 0);
      if (s.hat) {
        pb.rect(hx, hy - (hw >= 5 ? 1 : 0), hw, hrow + (hw >= 5 ? 1 : 0), C.hat);
        pb.rect(hx - 1, hy + hrow - (hw >= 5 ? 0 : 1), hw + 2, 1, C.hatD);   // brim
      } else {
        switch (s.hairStyle) {
          case 0: break;                                                       // bald / very short
          case 1: case 2:                                                      // short
            pb.rect(hx + (hw >= 5 ? 1 : 0), hy, hw - (hw >= 5 ? 2 : 0), hrow, C.hr);
            if (hw >= 4) { pb.rect(hx, hy + 1, 1, hrow, C.hr); }
            break;
          case 3:                                                              // long hair framing the face
            pb.rect(hx, hy, hw, hrow, C.hr);
            pb.rect(hx - (hw >= 5 ? 1 : 0), hy + 1, 1, hw + 1, C.hr);
            pb.rect(hx + hw - (hw >= 5 ? 0 : 1), hy + 1, 1, hw + 1, C.hr);
            break;
          case 4:                                                              // volume / curls
            pb.rect(hx - 1, hy - 1, hw + 2, hrow + 1, C.hr);
            if (hw >= 5) pb.set(hx + 1, hy - 1, C.hrL);
            break;
          default:                                                             // side parting
            pb.rect(hx, hy, hw, hrow, C.hr); pb.set(hx + (hw >> 1), hy, C.hrL);
        }
      }
      if (s.shades && hw >= 5) pb.rect(hx + 1, hy + (hw >> 1) - 1, hw - 2, 1, 0xff1a1a1a);
      // ---- arms up when cheering
      if (cheering) {
        const al = Math.round(0.32 * k);
        pb.rect(x0 - 1, yTop - al, detail ? 2 : 1, al + 2, C.sh);
        pb.rect(x0 - 1, yTop - al, detail ? 2 : 1, 2, C.sk);
        const wv = (s.ph * 7) & 1;
        pb.rect(x0 + bw - (detail ? 1 : 0), yTop - al - wv, detail ? 2 : 1, al + 2, C.sh);
        pb.rect(x0 + bw - (detail ? 1 : 0), yTop - al - wv, detail ? 2 : 1, 2, C.sk);
      }
    }
    // sporadic camera flashes
    const rnd = mulberry32(Math.floor(time * 6));
    for (let f = 0; f < 3; f++) {
      const s = this.spec[(rnd() * this.spec.length) | 0];
      if (s && s.k < 30) { const fx = s.sx, fy = s.sy - Math.round(s.k * 0.55); pb.rect(fx, fy, 2, 2, rgba(255, 255, 240)); pb.set(fx - 1, fy, rgba(255, 255, 200)); pb.set(fx + 2, fy + 1, rgba(255, 255, 200)); }
    }
    pb.flush();
  }
}
