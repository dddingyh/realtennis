// Arcade swing detector for the cartoon-version phone controller. DOM-free (runs in Node for tests).
//
// Wraps the proven recognizer in src/controller/gesture.js (orientation fusion, swing window, peak, features) and
// adapts it to the arcade game, where the phone only has to report WHEN a swing happened, HOW HARD and its SHAPE:
//   * lower, casual-friendly thresholds (+ a "shake guard" so waving / fidgeting / walking does not count),
//   * short refractory period,
//   * emits as soon as the peak is confirmed (decisionMs ~30 ms after the peak, i.e. 2 samples at 60 Hz),
//   * contact timestamp = parabolically interpolated peak of |angular velocity| (`ts`, phone clock, ms),
//   * power from the peak angular speed with a generous mapping,
//   * shape (topspin / flat / slice / lob) from the swing-path elevation ("rise"), deterministic thresholds, no hysteresis;
//     whenever the features are unreliable the shot defaults to topspin.
// No calibration is needed. Output events: {type:'swing', shot, side, power, conf, ts, speedDps, lift, spin, ...diagnostics}.
import { createRecognizer } from '../../../src/controller/gesture.js';

export const ARCADE = Object.freeze({
  // recognizer options (see gesture.js DEFAULTS)
  startDps: 150, endDps: 90, minPeakDps: 320, decisionMs: 20, refractoryMs: 420, preRollMs: 120, quietAbortMs: 220,
  // power mapping: peak |omega| (deg/s) -> 0..1, generous for casual swings
  powerLoDps: 280, powerHiDps: 950, powerGamma: 0.75, powerMin: 0.12,
  // shape thresholds (hand-path elevation `rise`, deg; `face` = hitting-face elevation, deg)
  sliceRise: -6,        // rise below this: downward swing = slice
  levelRise: 8.5,       // rise below this (and >= sliceRise): level swing = flat if fast enough, else topspin
  flatMinDps: 520,      // "level + fast"
  lobScore: 26,         // rise + 0.3*face above this = lob (steep and open-faced)
  lobFaceW: 0.3,
  minVh: 0.45,          // m/s of horizontal hand speed needed for a trustworthy path elevation
  unsurePeakDps: 340,   // weaker swings: features are noise-dominated -> topspin
  // shake guard: >= shakeCount local maxima of |omega| above shakeDps within the shakeWindow before the peak = waving
  shakeDps: 200, shakeCount: 3, shakeFromMs: 1400, shakeToMs: 300,
});

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const r2 = (x) => Math.round(x * 100) / 100;

// peak angular speed (deg/s) -> power 0..1. 320 dps (lazy wrist swing) ~0.20, 500 ~0.45, 700 ~0.70, 950+ = 1.
export function powerFromPeak(peakDps, c = ARCADE) {
  const u = clamp((peakDps - c.powerLoDps) / (c.powerHiDps - c.powerLoDps), 0, 1);
  return r2(clamp(Math.pow(u, c.powerGamma), c.powerMin, 1));
}

// Deterministic shape rule from the swing features. Returns {shot, unsure, margin} (margin = distance in deg to the
// nearest decision boundary; small margin = low confidence).
export function classifyShape({ rise, face = 0, peak, vH }, c = ARCADE) {
  if (![rise, peak].every(Number.isFinite) || peak < c.unsurePeakDps || !(vH >= c.minVh)) return { shot: 'topspin', unsure: true, margin: 0 };
  const lob = rise + c.lobFaceW * (Number.isFinite(face) ? face : 0);
  if (lob >= c.lobScore) return { shot: 'lob', unsure: false, margin: lob - c.lobScore };
  if (rise < c.sliceRise) return { shot: 'slice', unsure: false, margin: c.sliceRise - rise };
  if (rise < c.levelRise) {
    if (peak >= c.flatMinDps) return { shot: 'flat', unsure: false, margin: Math.min(rise - c.sliceRise, c.levelRise - rise) };
    return { shot: 'topspin', unsure: true, margin: c.levelRise - rise };      // level but gentle: default drive
  }
  return { shot: 'topspin', unsure: false, margin: Math.min(rise - c.levelRise, c.lobScore - lob) };
}

// The wire message for a detected swing. `clockOffsetMs` = (phone performance.now()) - (sensor sample timeline).
export function toSwingMessage(ev, { clockOffsetMs = 0, adjustMs = 0, override = null } = {}) {
  const forced = !!override && override !== ev.shot;
  return {
    t: 'swing', shot: override || ev.shot, side: ev.side, power: ev.power, conf: override ? 1 : ev.conf,
    ts: ev.ts + clockOffsetMs - adjustMs, speedDps: ev.speedDps,
    // a forced shot type: let the game use that type's own lift / spin instead of the measured ones
    lift: forced ? undefined : ev.lift, spin: forced ? undefined : ev.spin,
  };
}

export function createArcadeGesture(opts = {}) {
  const c = { ...ARCADE, ...opts };
  const ro = {
    startDps: c.startDps, endDps: c.endDps, minPeakDps: c.minPeakDps, decisionMs: c.decisionMs,
    refractoryMs: c.refractoryMs, preRollMs: c.preRollMs, quietAbortMs: c.quietAbortMs,
  };
  for (const k of ['hand', 'accSign', 'rotUnit', 'calibration']) if (opts[k] !== undefined) ro[k] = opts[k];   // undefined would override the recogniser defaults
  const rec = createRecognizer(ro);
  const maxima = [];                       // {t, w}: peaks of |omega| above shakeDps that were followed by a drop to 60 %
  let pk = { w: 0, t: 0 };                 // candidate peak being tracked
  let lastT = 0;
  const stats = { swings: 0, shakeRejected: 0, delays: [] };

  function trackMaxima(s) {
    if (!s.rot) return;
    const w = Math.hypot(s.rot.alpha || 0, s.rot.beta || 0, s.rot.gamma || 0);   // deg/s (rad/s devices simply never trip this)
    if (w >= pk.w) { pk.w = w; pk.t = s.t; }
    else if (w < 0.6 * pk.w) {                                    // dropped enough: the candidate is a real, separate peak
      if (pk.w >= c.shakeDps) maxima.push({ t: pk.t, w: pk.w });
      pk = { w, t: s.t };
    }
    while (maxima.length && s.t - maxima[0].t > 3000) maxima.shift();
  }

  function push(s) {
    lastT = s.t;
    trackMaxima(s);
    const out = [];
    for (const ev of rec.push(s)) {
      if (ev.type !== 'swing') continue;
      // shake guard
      const n = maxima.filter((m) => m.t >= ev.ts - c.shakeFromMs && m.t <= ev.ts - c.shakeToMs).length;
      if (n >= c.shakeCount) { stats.shakeRejected++; continue; }
      const f = ev.feat || {};
      const cl = classifyShape(f, c);
      const sideConf = clamp(Math.abs(f.yaw || 0) / ((f.peak || 1) + 1e-9), 0, 1);
      const conf = r2(cl.unsure ? 0.35 : clamp(0.55 + cl.margin / 12, 0.55, 1) * Math.sqrt(Math.max(sideConf, 0.25)));
      const swing = {
        type: 'swing', shot: cl.shot, side: ev.side, power: powerFromPeak(ev.speedDps, c), conf, ts: ev.ts,
        speedDps: ev.speedDps, lift: ev.lift, spin: ev.spin,
        // diagnostics (not sent): path elevation, face elevation, recogniser's own opinion, delay between peak and emit
        rise: f.rise, face: f.face, unsure: cl.unsure, rawShot: ev.shot, emitDelayMs: Math.max(0, r2(s.t - ev.ts)),
      };
      stats.swings++; stats.delays.push(swing.emitDelayMs);
      out.push(swing);
    }
    return out;
  }

  return {
    push, rec, stats,
    setHand(h) { rec.setHand(h); },
    reset() { rec.reset(); maxima.length = 0; pk = { w: 0, t: 0 }; },
    config: c,
    get lastSampleT() { return lastT; },
  };
}
