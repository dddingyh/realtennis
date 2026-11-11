// Anime face painted on a CanvasTexture and mapped onto the front of the head (decal mesh).
// Parameters (all continuous, quantised for redraw): open (0 closed .. 1 normal .. 1.2 wide), kind (0 normal, 1 happy ^^, 2 effort > <),
// browY (-1 low .. 1 high), browA (-1 sad .. 1 angry), mouth (name), mo (mouth openness 0..1), blush 0..1, gx/gy gaze -1..1, sweat.
import * as THREE from 'three';
import { faceLayout, buildFaceGeometry } from './body.js';
import { hairShade } from './shade.js';

export const MOUTHS = ['smile', 'neutral', 'open', 'effort', 'shout', 'frown', 'grin', 'pant', 'o', 'cat'];
export const CW = 640, CHH = 512;
const INK = '#2a1f2e';

const _c = new THREE.Color();
function rgb(hex, mul = 1, add = 0) {
  _c.set(hex);
  const r = Math.min(255, Math.round(_c.getStyle ? 0 : 0));
  void r;
  const c = new THREE.Color(hex);
  const s = c.getHex(THREE.SRGBColorSpace);
  const R = Math.max(0, Math.min(255, ((s >> 16) & 255) * mul + add)), G = Math.max(0, Math.min(255, ((s >> 8) & 255) * mul + add)), B = Math.max(0, Math.min(255, (s & 255) * mul + add));
  return `rgb(${R | 0},${G | 0},${B | 0})`;
}

let _geoCache = {};
export function faceGeometryFor(D) { return _geoCache[D.id] || (_geoCache[D.id] = buildFaceGeometry(D)); }

export class Face {
  constructor(D, look) {
    this.D = D;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW; this.canvas.height = CHH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.L = faceLayout(D);
    const H = this.L.H;
    this.kx = CW / (2 * this.L.xHalf);
    this.ky = CHH / (H.y(this.L.tTop) - H.y(this.L.tBot));
    this.sig = -1;
    this.setLook(look);
  }
  setLook(look) {
    this.eyes = look.eyes || '#4a8f6e';
    this.browCol = hairShade(look.hair, 0.5, 1.0, 0);
    this.skin = look.skin;
    this.sig = -1;
  }
  setStyle(D) { this.D = D; this.L = faceLayout(D); const H = this.L.H; this.kx = CW / (2 * this.L.xHalf); this.ky = CHH / (H.y(this.L.tTop) - H.y(this.L.tBot)); this.sig = -1; }

  draw(f) {
    const q = (v, k) => Math.round(v * k);
    const sig = ((((((q(f.open, 6) * 3 + f.kind) * 10 + Math.max(0, MOUTHS.indexOf(f.mouth))) * 5 + q(f.browY + 1, 2)) * 5 + q(f.browA + 1, 2)) * 5 + q(f.gx + 1, 2)) * 5 + q(f.gy + 1, 2)) * 64 + q(f.mo, 3) * 8 + q(f.blush, 3) + (f.sweat ? 1000000000 : 0);
    if (sig === this.sig) return false;
    this.sig = sig;
    const c = this.ctx, D = this.D, H = this.L.H, kx = this.kx, ky = this.ky;
    const chibi = D.id === 'chibi';
    c.clearRect(0, 0, CW, CHH);
    c.lineCap = 'round'; c.lineJoin = 'round';
    const X = (x) => this.L.px(x, CW), Y = (y) => this.L.py(y, CHH);
    const W = D.headW;
    const ew = chibi ? W * 0.255 : W * 0.31, eh = chibi ? D.headH * 0.135 : D.headH * 0.098;
    const eX = chibi ? W * 0.47 : W * 0.44, eY = H.y(chibi ? 0.455 : 0.47);
    const open = f.open;

    // ---- blush
    if (f.blush > 0.02) {
      for (const s of [-1, 1]) {
        const cx = X(s * W * 0.66), cy = Y(H.y(chibi ? 0.285 : 0.3));
        const rx = W * 0.17 * kx, ry = D.headH * 0.05 * ky;
        c.save(); c.translate(cx, cy); c.scale(1, ry / rx);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
        const a = 0.22 + 0.4 * f.blush;
        g.addColorStop(0, `rgba(255,96,112,${a})`); g.addColorStop(0.6, `rgba(255,110,125,${a * 0.7})`); g.addColorStop(1, 'rgba(255,120,130,0)');
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, 7); c.fill(); c.restore();
      }
    }

    // ---- eyes
    for (const s of [-1, 1]) {
      const cx = X(s * eX), cy = Y(eY);
      const a = ew * kx, b = eh * ky;       // half extents in px
      const o = s;                           // outward direction (+x for the right eye)
      c.save(); c.translate(cx, cy);
      if (f.kind === 1) { // happy ^ ^
        c.strokeStyle = INK; c.lineWidth = a * 0.2;
        c.beginPath(); c.moveTo(-a * 0.9, b * 0.28); c.quadraticCurveTo(0, -b * 0.95, a * 0.9, b * 0.28); c.stroke();
        c.lineWidth = a * 0.08; c.beginPath(); c.moveTo(o * a * 0.88, b * 0.24); c.lineTo(o * a * 1.12, b * 0.02); c.stroke();
      } else if (f.kind === 2) { // effort > <
        c.strokeStyle = INK; c.lineWidth = a * 0.2;
        c.beginPath(); c.moveTo(o * a * 0.95, -b * 0.62); c.lineTo(-o * a * 0.72, 0); c.lineTo(o * a * 0.95, b * 0.62); c.stroke();
      } else if (open < 0.16) { // closed (blink / sleepy)
        c.strokeStyle = INK; c.lineWidth = a * 0.2;
        c.beginPath(); c.moveTo(-a * 0.92, -b * 0.05); c.quadraticCurveTo(0, b * 0.42, a * 0.92, -b * 0.05); c.stroke();
        c.lineWidth = a * 0.09; c.beginPath(); c.moveTo(o * a * 0.9, -b * 0.03); c.lineTo(o * a * 1.14, -b * 0.2); c.stroke();
      } else {
        const hh = b * Math.min(open, 1.12);
        // eye opening clip: soft almond (flatter top, rounder bottom, pointed outer corner)
        c.beginPath();
        c.moveTo(-o * a * 0.98, hh * 0.12);
        c.bezierCurveTo(-o * a * 0.9, -hh * 0.95, o * a * 0.3, -hh * 1.12, o * a * 1.0, -hh * 0.16);
        c.bezierCurveTo(o * a * 0.82, hh * 0.85, -o * a * 0.5, hh * 1.0, -o * a * 0.98, hh * 0.12);
        c.closePath();
        c.save(); c.clip();
        // sclera
        const sg = c.createLinearGradient(0, -hh, 0, hh);
        sg.addColorStop(0, '#d9d6ec'); sg.addColorStop(0.35, '#ffffff'); sg.addColorStop(1, '#fbf6fb');
        c.fillStyle = sg; c.fillRect(-a * 1.3, -hh * 1.3, a * 2.6, hh * 2.6);
        // iris
        const ix = f.gx * a * 0.17 + (o > 0 ? -a * 0.02 : a * 0.02), iy = f.gy * hh * 0.1 + hh * 0.03;
        const rxI = a * 0.66, ryI = hh * 1.02;
        const ig = c.createLinearGradient(0, iy - ryI, 0, iy + ryI);
        ig.addColorStop(0, rgb(this.eyes, 0.42)); ig.addColorStop(0.38, rgb(this.eyes, 0.9)); ig.addColorStop(0.75, rgb(this.eyes, 1.12, 8)); ig.addColorStop(1, rgb(this.eyes, 1.35, 55));
        c.fillStyle = ig; c.beginPath(); c.ellipse(ix, iy, rxI, ryI, 0, 0, 7); c.fill();
        // lower glow arc
        c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.ellipse(ix, iy + ryI * 0.52, rxI * 0.72, ryI * 0.3, 0, 0, 7); c.fill();
        // pupil
        const pr = f.open > 1.05 ? 0.2 : 0.3;
        c.fillStyle = '#1b1624'; c.beginPath(); c.ellipse(ix, iy - ryI * 0.02, rxI * pr * 1.25, ryI * pr * 1.9, 0, 0, 7); c.fill();
        // upper lid shadow on the iris
        const lg = c.createLinearGradient(0, -hh, 0, -hh * 0.25);
        lg.addColorStop(0, 'rgba(30,20,50,0.55)'); lg.addColorStop(1, 'rgba(30,20,50,0)');
        c.fillStyle = lg; c.fillRect(-a * 1.3, -hh * 1.2, a * 2.6, hh * 1.0);
        // highlights
        c.fillStyle = '#fff';
        c.beginPath(); c.ellipse(ix - a * 0.2, iy - ryI * 0.42, rxI * 0.28, ryI * 0.24, 0, 0, 7); c.fill();
        c.beginPath(); c.ellipse(ix + a * 0.24, iy + ryI * 0.45, rxI * 0.11, ryI * 0.1, 0, 0, 7); c.fill();
        c.restore();
        // thick upper lash line with outer flick
        c.strokeStyle = INK; c.lineWidth = a * 0.19;
        c.beginPath();
        c.moveTo(-o * a * 0.98, hh * 0.12);
        c.bezierCurveTo(-o * a * 0.9, -hh * 0.95, o * a * 0.3, -hh * 1.12, o * a * 1.0, -hh * 0.16);
        c.stroke();
        c.lineWidth = a * 0.11;
        c.beginPath(); c.moveTo(o * a * 0.94, -hh * 0.14); c.quadraticCurveTo(o * a * 1.12, -hh * 0.3, o * a * 1.24, -hh * 0.55); c.stroke();
        // thin lower line
        c.lineWidth = a * 0.045; c.strokeStyle = 'rgba(42,31,46,0.8)';
        c.beginPath(); c.moveTo(-o * a * 0.7, hh * 0.78); c.bezierCurveTo(-o * a * 0.3, hh * 1.02, o * a * 0.4, hh * 0.95, o * a * 0.85, hh * 0.4); c.stroke();
        // eyelid crease
        c.lineWidth = a * 0.04; c.strokeStyle = 'rgba(70,40,50,0.5)';
        c.beginPath(); c.moveTo(-o * a * 0.7, -hh * 1.25 - b * 0.1); c.quadraticCurveTo(o * a * 0.1, -hh * 1.48 - b * 0.1, o * a * 0.85, -hh * 0.98 - b * 0.1); c.stroke();
      }
      c.restore();

      // ---- brow
      const by = Y(eY + eh * (1.78 + 0.35 * f.browY + (open > 1.05 ? 0.2 : 0)));
      const ang = f.browA * 0.5;          // + angry: inner end lower
      const bw = ew * 0.95 * kx;
      c.save(); c.translate(cx + 0, by);
      const inner = -o * bw * 0.85, outer = o * bw * 0.95;
      const yi = b * 0.34 * ang * 1.8 + b * 0.0, yo = -b * 0.34 * ang * 1.8;
      c.strokeStyle = this.browCol; c.lineCap = 'round';
      c.lineWidth = a * 0.12;
      c.beginPath(); c.moveTo(inner, yi); c.quadraticCurveTo((inner + outer) / 2, Math.min(yi, yo) - b * 0.16, outer, yo + b * 0.04); c.stroke();
      c.lineWidth = a * 0.07;
      c.beginPath(); c.moveTo(inner * 1.08, yi + b * 0.02); c.lineTo(inner * 0.7, yi - b * 0.04); c.stroke();
      c.restore();
    }

    // ---- nose (tiny shadow mark)
    {
      const nx = X(0), ny = Y(H.y(chibi ? 0.335 : 0.355));
      c.strokeStyle = 'rgba(150,84,76,0.7)'; c.lineWidth = ew * kx * 0.07;
      c.beginPath(); c.moveTo(nx - ew * kx * 0.06, ny - eh * ky * 0.1); c.quadraticCurveTo(nx - ew * kx * 0.08, ny + eh * ky * 0.08, nx + ew * kx * 0.1, ny + eh * ky * 0.08); c.stroke();
    }

    // ---- mouth
    {
      const mx = X(0), my = Y(H.y(chibi ? 0.2 : 0.205));
      const ms = (chibi ? 0.55 : 0.62) * ew * kx;
      const mo = f.mo;
      c.save(); c.translate(mx, my);
      c.strokeStyle = INK; c.lineWidth = ms * 0.17; c.fillStyle = '#9c2c3c';
      const tooth = '#fffaf5';
      switch (f.mouth) {
        case 'smile': c.beginPath(); c.moveTo(-ms * 0.9, -ms * 0.1); c.quadraticCurveTo(0, ms * 0.85, ms * 0.9, -ms * 0.1); c.stroke(); break;
        case 'cat': c.beginPath(); c.moveTo(-ms * 0.9, -ms * 0.1); c.quadraticCurveTo(-ms * 0.45, ms * 0.65, 0, ms * 0.05); c.quadraticCurveTo(ms * 0.45, ms * 0.65, ms * 0.9, -ms * 0.1); c.stroke(); break;
        case 'neutral': c.beginPath(); c.moveTo(-ms * 0.6, ms * 0.1); c.quadraticCurveTo(0, ms * 0.28, ms * 0.6, ms * 0.1); c.stroke(); break;
        case 'frown': {
          c.beginPath(); c.moveTo(-ms * 0.95, ms * 0.35);
          c.bezierCurveTo(-ms * 0.6, -ms * 0.15, -ms * 0.3, ms * 0.5, 0, 0.1 * ms);
          c.bezierCurveTo(ms * 0.3, -ms * 0.3, ms * 0.6, ms * 0.4, ms * 0.95, ms * 0.0); c.stroke(); break;
        }
        case 'open': case 'pant': case 'o': {
          const rx = ms * (f.mouth === 'o' ? 0.42 : 0.6), ry = ms * (0.25 + 0.5 * mo + (f.mouth === 'o' ? 0.2 : 0));
          c.beginPath(); c.ellipse(0, ry * 0.35, rx, ry, 0, 0, 7); c.fill(); c.stroke();
          c.save(); c.beginPath(); c.ellipse(0, ry * 0.35, rx, ry, 0, 0, 7); c.clip(); c.fillStyle = '#f07a86'; c.beginPath(); c.ellipse(0, ry * 0.95, rx * 0.7, ry * 0.5, 0, 0, 7); c.fill(); c.restore();
          break;
        }
        case 'effort': {
          c.beginPath(); c.roundRect(-ms * 0.9, -ms * 0.3, ms * 1.8, ms * 0.8, ms * 0.28); c.fillStyle = tooth; c.fill(); c.stroke();
          c.lineWidth = ms * 0.08; c.beginPath(); c.moveTo(-ms * 0.9, ms * 0.1); c.lineTo(ms * 0.9, ms * 0.1); c.moveTo(0, -ms * 0.3); c.lineTo(0, ms * 0.5); c.stroke(); break;
        }
        case 'shout': {
          const rx = ms * 1.0, ry = ms * (0.8 + 0.5 * mo);
          c.beginPath(); c.moveTo(-rx, -ms * 0.15); c.quadraticCurveTo(0, -ms * 0.4, rx, -ms * 0.15); c.bezierCurveTo(rx * 0.95, ry * 1.35, -rx * 0.95, ry * 1.35, -rx, -ms * 0.15); c.closePath();
          c.fill(); c.stroke();
          c.save(); c.clip(); c.fillStyle = '#f07a86'; c.beginPath(); c.ellipse(0, ry * 1.15, rx * 0.75, ry * 0.55, 0, 0, 7); c.fill();
          c.fillStyle = tooth; c.fillRect(-rx, -ms * 0.3, rx * 2, ms * 0.34); c.restore();
          break;
        }
        case 'grin': {
          const rx = ms * 1.1, ry = ms * (0.75 + 0.25 * mo);
          c.beginPath(); c.moveTo(-rx, -ms * 0.15); c.quadraticCurveTo(0, ms * 0.2, rx, -ms * 0.15); c.bezierCurveTo(rx * 0.8, ry * 1.4, -rx * 0.8, ry * 1.4, -rx, -ms * 0.15); c.closePath();
          c.fill(); c.stroke();
          c.save(); c.clip(); c.fillStyle = '#f07a86'; c.beginPath(); c.ellipse(0, ry * 1.1, rx * 0.65, ry * 0.5, 0, 0, 7); c.fill();
          c.fillStyle = tooth; c.beginPath(); c.moveTo(-rx, -ms * 0.2); c.quadraticCurveTo(0, ms * 0.15, rx, -ms * 0.2); c.lineTo(rx * 0.8, ms * 0.22); c.quadraticCurveTo(0, ms * 0.5, -rx * 0.8, ms * 0.22); c.fill(); c.restore();
          break;
        }
        default: break;
      }
      c.restore();
    }

    // ---- sweat drop
    if (f.sweat) {
      const sx = X(W * 0.82), sy = Y(H.y(0.66));
      const r = ew * kx * 0.18;
      c.fillStyle = 'rgba(150,215,255,0.95)'; c.strokeStyle = 'rgba(70,130,190,0.9)'; c.lineWidth = r * 0.22;
      c.beginPath(); c.moveTo(sx, sy - r * 1.9); c.bezierCurveTo(sx + r * 1.1, sy - r * 0.2, sx + r * 1.0, sy + r * 1.0, sx, sy + r * 1.0); c.bezierCurveTo(sx - r * 1.0, sy + r * 1.0, sx - r * 1.1, sy - r * 0.2, sx, sy - r * 1.9); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.arc(sx - r * 0.35, sy + r * 0.1, r * 0.22, 0, 7); c.fill();
    }
    this.texture.needsUpdate = true;
    return true;
  }
  dispose() { this.texture.dispose(); this.material.dispose(); }
}
