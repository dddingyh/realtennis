// Procedural pixel crowd on the stand tiers; separate animated layer (drawn into a transparent buffer).
import { camera } from './camera.js';
import { STAGE } from './stage.js';
import { PixBuf, hex, shade, mulberry32, rgba, mix } from './raster.js';

const { XW, ZB, BH, S, ROW, SEAT, TOPH } = STAGE;
const SHIRTS = ['#d8453b', '#2f6fd0', '#f0f0e6', '#2a2f3a', '#f2c230', '#2faa6a', '#8e44ad', '#ef7d2d', '#38b6d8', '#b8b8c0', '#e86aa0', '#7a3b2a'].map((c) => shade(mix(hex(c), hex('#8a93a8'), 0.28), 0.9));
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
    const list = [];
    const add = (x, y, z, kind) => {
      const p = camera.project(x, y, z);
      if (p.sx < -10 || p.sx > camera.W + 10 || p.sy < -14 || p.sy > camera.H) return;
      list.push({
        sx: Math.round(p.sx), sy: Math.round(p.sy), k: p.scale, depth: p.depth, kind,
        shirt: SHIRTS[(rnd() * SHIRTS.length) | 0], skin: SKINS[(rnd() * SKINS.length) | 0], hair: HAIR[(rnd() * HAIR.length) | 0],
        ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.4, thr: rnd(), big: rnd() < 0.18, sz: 0.88 + rnd() * 0.25, flash: 0,
        hat: rnd() < 0.12 ? SHIRTS[(rnd() * SHIRTS.length) | 0] : 0, skipped: rnd() < 0.1,
      });
    };
    const rows = Math.floor((TOPH - BH) / S / ROW);
    for (let r = 0; r < rows; r++) {
      const dist = (r + 0.5) * ROW, y = BH + S * dist;
      // back tier
      for (let col = -100 + 0; col < 100; col++) {
        const c = col + 100; if (c % 12 === 0) continue;
        add((col + 0.5) * SEAT, y, -ZB - dist, 1);
      }
      // side tiers
      for (let col = -100; col < 120; col++) {
        const c = col + 100; if (c % 12 === 0) continue;
        const z = (col + 0.5) * SEAT;
        if (z < -ZB - 1) continue;
        add(XW + dist, y, z, 2);
        add(-XW - dist, y, z, 3);
      }
    }
    list.sort((a, b) => b.depth - a.depth);
    this.spec = list.filter((s) => !s.skipped);
  }

  onPoint(strength = 1) { this.excite = Math.min(1, Math.max(this.excite, strength)); }

  update(dt, time) {
    this.excite = Math.max(0, this.excite - dt * 0.4);
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
      const s = this.spec[i];
      const k = s.k * s.sz;
      const bw = Math.max(4, Math.round(0.42 * k)), bh = Math.max(3, Math.round(0.48 * k));
      const hw = Math.max(3, Math.round(0.2 * k));
      let lift = 0;
      const bob = Math.sin(time * s.sp * 2 + s.ph);
      if (bob > 0.92) lift = 1;
      const up = ex > s.thr ? (ex > s.thr + 0.25 || s.big ? 2 : 1) : 0;
      const cheering = up > 0 && ((Math.floor(time * 6 + s.ph) & 1) === 0 || up === 2);
      if (cheering) lift += Math.round(0.14 * k) * (up === 2 ? 1 : 0.6) | 0;
      const x0 = s.sx - (bw >> 1), yBot = s.sy - lift + 1, yTop = yBot - bh;
      // torso with 2 tones
      pb.rect(x0, yTop, bw, bh, s.shirt);
      pb.rect(x0, yBot - 2, bw, 2, shade(s.shirt, 0.78));
      pb.rect(x0 + bw - 1, yTop, 1, bh, shade(s.shirt, 0.82));
      // head
      const hx = s.sx - (hw >> 1), hy = yTop - hw + 1;
      pb.rect(hx, hy, hw, hw, s.skin);
      pb.rect(hx, hy, hw, Math.max(1, (hw / 3) | 0), s.hair);
      if (s.hat) pb.rect(hx - 0, hy, hw, 1, s.hat);
      if (hw >= 4) pb.rect(hx, hy + 1, 1, 2, s.hair);
      // arms up when cheering
      if (cheering) {
        pb.rect(x0 - 1, yTop - Math.round(0.3 * k), 1, Math.round(0.3 * k) + 1, s.skin);
        pb.rect(x0 + bw, yTop - Math.round(0.3 * k) - ((s.ph * 7) & 1), 1, Math.round(0.3 * k) + 1, s.skin);
      }
    }
    // sporadic camera flashes
    const rnd = mulberry32(Math.floor(time * 6));
    for (let f = 0; f < 3; f++) {
      const s = this.spec[(rnd() * this.spec.length) | 0];
      if (s && s.k < 22) { pb.rect(s.sx, s.sy - Math.round(s.k * 0.5), 2, 2, rgba(255, 255, 240)); }
    }
    pb.flush();
  }
}
