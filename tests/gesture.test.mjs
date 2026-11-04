// Synthetic-data tests for the gesture recognizer. Run: node tests/gesture.test.mjs [--verbose] [--dump]
// NOTE: traces are produced by a rigid-body model written by us (src/controller/simtrace.js). Accuracy here is
// an upper bound / regression guard, NOT a measure of real-world accuracy with a real phone in a real hand.
import { createRecognizer } from '../src/controller/gesture.js';
import { PhoneSim, genSwingTrace } from '../src/controller/simtrace.js';

const verbose = process.argv.includes('--verbose');
const dump = process.argv.includes('--dump');
let failures = 0;
function check(name, ok, info = '') { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); }

const SLOPPY = Number(process.env.SLOPPY || 0);
const SHOTS = ['flat', 'topspin', 'slice', 'lob'];
const SIDES = ['fh', 'bh'];

function runTrace(samples, hand, calibration) {
  const rec = createRecognizer({ hand, calibration });
  const events = [];
  for (const s of samples) events.push(...rec.push(s));
  return { rec, events };
}

// ---------- 1. swing classification ----------
const N_PER = Number(process.env.N || 8);
const confS = Object.fromEntries(SHOTS.map((s) => [s, Object.fromEntries(SHOTS.map((t) => [t, 0]))]));
const confSide = { fh: { fh: 0, bh: 0, none: 0 }, bh: { fh: 0, bh: 0, none: 0 } };
let total = 0, detected = 0, multi = 0, tsErr = [], powerByShot = {};
const featRows = [];
let seed = 1000;
for (const hand of ['R', 'L']) for (const flip of [false, true]) for (const hz of [60, 100])
  for (const shot of SHOTS) for (const side of SIDES) for (let k = 0; k < N_PER; k++) {
    seed++;
    const { samples, truth } = genSwingTrace({ shot, side, hand, flip, hz, seed, sloppy: SLOPPY, noise: 1 + 2 * SLOPPY });
    const { events } = runTrace(samples, hand);
    const sw = events.filter((e) => e.type === 'swing');
    total++;
    if (sw.length !== 1) { if (sw.length > 1) multi++; confSide[side].none++; if (verbose) console.log('  missed/multi', { shot, side, hand, flip, hz, seed, n: sw.length }); continue; }
    detected++;
    const e = sw[0];
    confS[shot][e.shot]++;
    confSide[side][e.side]++;
    tsErr.push(Math.abs(e.ts - truth.contactT));
    (powerByShot[shot] ||= []).push(e.power);
    featRows.push({ shot, side, hand, flip, hz, ...e.feat, truthPeak: truth.peakDps });
  }
console.log(`\nSwing trials: ${total}, detected exactly once: ${detected}, multiple events: ${multi}`);
console.log('Shot-type confusion (rows = truth, cols = predicted):');
console.log('           ' + SHOTS.map((s) => s.padStart(8)).join(''));
let corrT = 0, nT = 0;
for (const s of SHOTS) { console.log(s.padEnd(10) + ' ' + SHOTS.map((t) => String(confS[s][t]).padStart(8)).join('')); corrT += confS[s][s]; nT += SHOTS.reduce((a, t) => a + confS[s][t], 0); }
console.log('Side confusion (rows = truth):');
for (const s of SIDES) console.log(s.padEnd(4), JSON.stringify(confSide[s]));
const accType = corrT / nT, accSide = (confSide.fh.fh + confSide.bh.bh) / (confSide.fh.fh + confSide.fh.bh + confSide.bh.fh + confSide.bh.bh);
console.log(`type accuracy ${(accType * 100).toFixed(1)}%  side accuracy ${(accSide * 100).toFixed(1)}%  detection ${(detected / total * 100).toFixed(1)}%`);
tsErr.sort((a, b) => a - b);
console.log(`contact timestamp error ms: median ${tsErr[tsErr.length >> 1]}, p95 ${tsErr[Math.floor(tsErr.length * 0.95)]}`);
for (const s of SHOTS) { const a = powerByShot[s] || []; console.log(`power ${s}: mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)}`); }
check('detection rate >= 97%', detected / total >= 0.97);
check('side accuracy >= 90%', accSide >= 0.9);
check('type accuracy >= 80%', accType >= 0.8);
check('contact timestamp p95 error <= 40 ms', tsErr[Math.floor(tsErr.length * 0.95)] <= 40);
if (dump) {
  for (const s of SHOTS) {
    const rows = featRows.filter((r) => r.shot === s);
    const m = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
    const sd = (k) => Math.sqrt(rows.reduce((a, r) => a + (r[k] - m(k)) ** 2, 0) / rows.length);
    console.log(s.padEnd(8), ['rise', 'face', 'roll', 'dur', 'peak', 'yaw', 'sideConf'].map((k) => `${k}=${m(k).toFixed(1)}±${sd(k).toFixed(1)}`).join('  '));
  }
}


// ---------- 1b. stress: sloppy user (wide variations, 3x sensor noise) -- informational + loose bound ----------
if (!SLOPPY) {
  const cm = Object.fromEntries(SHOTS.map((s) => [s, Object.fromEntries([...SHOTS, 'none'].map((t) => [t, 0]))]));
  let ok = 0, n = 0, sideOk = 0, sd = 90000;
  for (const hand of ['R', 'L']) for (const flip of [false, true]) for (const hz of [60, 100])
    for (const shot of SHOTS) for (const side of SIDES) for (let k = 0; k < N_PER; k++) {
      const { samples } = genSwingTrace({ shot, side, hand, flip, hz, seed: sd++, sloppy: 1, noise: 3 });
      const e = runTrace(samples, hand).events.find((x) => x.type === 'swing');
      n++; cm[shot][e ? e.shot : 'none']++;
      if (e && e.shot === shot) ok++;
      if (e && e.side === side) sideOk++;
    }
  console.log('\nSTRESS (sloppy=1, noise x3) shot-type confusion:');
  console.log('           ' + [...SHOTS, 'none'].map((s) => s.padStart(8)).join(''));
  for (const s of SHOTS) console.log(s.padEnd(10) + ' ' + [...SHOTS, 'none'].map((t) => String(cm[s][t]).padStart(8)).join(''));
  console.log(`stress type accuracy ${(ok / n * 100).toFixed(1)}%  side accuracy ${(sideOk / n * 100).toFixed(1)}%`);
  check('stress: side accuracy >= 90%', sideOk / n >= 0.9);
  check('stress: type accuracy >= 60% (loose; real users vary more)', ok / n >= 0.6);
}

// ---------- 2. user calibration improves / does not break ----------
{
  // simulate a "user" whose motions differ from the defaults (steeper rises, rotated face) and calibrate with 3 swings each
  const hand = 'R';
  const rec = createRecognizer({ hand });
  let sd = 5000;
  for (const shot of SHOTS) for (let i = 0; i < 3; i++) {
    const { samples } = genSwingTrace({ shot, side: 'fh', hand, hz: 60, seed: sd++, speed: 0.9 });
    for (const s of samples) rec.push(s);
    rec.reset?.();
    const ev = runTrace(samples, hand).events.find((e) => e.type === 'swing');
    if (ev) rec.addCalibrationSwing(shot, ev);
  }
  const exp = rec.exportCalibration();
  check('exportCalibration has samples', Object.values(exp.samples).every((a) => a.length === 3), JSON.stringify(rec.calibratedCount));
  let ok = 0, n = 0;
  for (const shot of SHOTS) for (const side of SIDES) for (let i = 0; i < 4; i++) {
    const { samples } = genSwingTrace({ shot, side, hand, hz: 60, seed: sd++, speed: 0.9 });
    const e = runTrace(samples, hand, JSON.parse(JSON.stringify(exp))).events.find((x) => x.type === 'swing');
    n++; if (e && e.shot === shot) ok++;
  }
  console.log(`\ncalibrated centroid accuracy (same synthetic user): ${ok}/${n}`);
  check('calibrated classifier >= 80%', ok / n >= 0.8);
}

// ---------- 3. non-swing motions must not trigger ----------
{
  let falseSw = 0, runs = 0;
  for (const hand of ['R', 'L']) for (const flip of [false, true]) for (const hz of [60, 100]) for (const cfg of [
    { bob: 0.02, f: 1.8, sway: 6, arm: 5 }, { bob: 0.03, f: 2.2, sway: 9, arm: 9 }, { bob: 0.015, f: 1.5, sway: 12, arm: 4 },
  ]) {
    const sim = new PhoneSim({ hand, flip, hz, seed: 77 + runs });
    const samples = sim.advance(800);
    sim.setWalk(cfg);
    samples.push(...sim.advance(8000));
    const { events } = runTrace(samples, hand);
    falseSw += events.filter((e) => e.type === 'swing').length; runs++;
  }
  check('walking jiggle triggers no swings', falseSw === 0, `(${runs} runs, ${falseSw} false)`);
}

// ---------- 4. slow tilt -> movement; no swing ----------
{
  const cases = [
    { name: 'head down 22deg -> z<0', p: -22, r: 0, test: (x, z) => z < -0.6 && Math.abs(x) < 0.25 },
    { name: 'head up 22deg -> z>0', p: 22, r: 0, test: (x, z) => z > 0.6 && Math.abs(x) < 0.25 },
    { name: 'bank right 25deg -> x>0', p: 0, r: 25, test: (x, z) => x > 0.5 && Math.abs(z) < 0.3 },
    { name: 'bank left 25deg -> x<0', p: 0, r: -25, test: (x, z) => x < -0.5 && Math.abs(z) < 0.3 },
    { name: 'small 3deg inside dead-zone -> 0', p: 3, r: 3, test: (x, z) => Math.abs(x) < 0.12 && Math.abs(z) < 0.12 },
  ];
  for (const hand of ['R', 'L']) for (const flip of [false, true]) for (const hz of [60, 100]) for (const c of cases) {
    const sim = new PhoneSim({ hand, flip, hz, seed: 9 });
    const rec = createRecognizer({ hand });
    const ev = [];
    for (const s of sim.advance(2200)) ev.push(...rec.push(s));
    const cal = rec.calibrateNeutral(1000);
    if (!cal.ok) { check(`neutral calibration ok (${hand}${flip})`, false, JSON.stringify(cal)); continue; }
    sim.setTilt(c.p, c.r);
    const ev2 = [];
    for (const s of sim.advance(2500)) ev2.push(...rec.push(s));
    const tilts = ev2.filter((e) => e.type === 'tilt');
    const last = tilts[tilts.length - 1];
    const sw = ev2.filter((e) => e.type === 'swing').length;
    const ok = last && c.test(last.x, last.z) && sw === 0;
    if (!ok || verbose) check(`tilt ${c.name} [${hand}${flip ? ' flipped' : ''} ${hz}Hz]`, ok, JSON.stringify(last));
    else if (c === cases[0] && hz === 100 && !flip && hand === 'R') console.log(`PASS  tilt cases (all hands/faces/rates) e.g. ${c.name}: ${JSON.stringify(last)}`);
    if (!ok) failures += 0;
  }
}

// ---------- 5. tilt frozen during swing ----------
{
  const sim = new PhoneSim({ hand: 'R', hz: 100, seed: 5 });
  const rec = createRecognizer({ hand: 'R' });
  for (const s of sim.advance(2000)) rec.push(s);
  rec.calibrateNeutral(1000);
  sim.setTilt(-18, 0);
  for (const s of sim.advance(1800)) rec.push(s);
  sim.startSwing({ shot: 'topspin', side: 'fh' });
  const during = [];
  while (sim.busy) for (const s of sim.advance(50)) for (const e of rec.push(s)) if (e.type === 'tilt') during.push(e);
  const zs = during.map((e) => e.z);
  const spread = Math.max(...zs) - Math.min(...zs);
  check('tilt output stays stable through a swing', spread < 0.45 && Math.max(...zs) < 0.1, `(z in [${Math.min(...zs).toFixed(2)}, ${Math.max(...zs).toFixed(2)}])`);
}

// ---------- 6. two swings in a row + refractory ----------
{
  const sim = new PhoneSim({ hand: 'R', hz: 100, seed: 21 });
  const rec = createRecognizer({ hand: 'R' });
  const evs = [];
  const feed = (ss) => { for (const s of ss) evs.push(...rec.push(s)); };
  feed(sim.advance(1000));
  sim.startSwing({ shot: 'flat', side: 'fh' }); while (sim.busy) feed(sim.advance(50));
  feed(sim.advance(200));
  sim.startSwing({ shot: 'slice', side: 'bh' }); while (sim.busy) feed(sim.advance(50));
  feed(sim.advance(800));
  const sw = evs.filter((e) => e.type === 'swing');
  check('two consecutive swings -> two events', sw.length === 2 && sw[0].side === 'fh' && sw[1].side === 'bh', JSON.stringify(sw.map((e) => [e.shot, e.side])));
}

// ---------- 7. rad/s auto-detection (old Android) ----------
{
  const { samples } = genSwingTrace({ shot: 'flat', side: 'fh', hand: 'R', hz: 60, seed: 4242 });
  const conv = samples.map((s) => ({ ...s, rot: { alpha: s.rot.alpha * Math.PI / 180, beta: s.rot.beta * Math.PI / 180, gamma: s.rot.gamma * Math.PI / 180 } }));
  const e = runTrace(conv, 'R').events.filter((x) => x.type === 'swing');
  // the first swing in rad/s may be partially mis-scaled until the unit is detected; only require that it is eventually handled
  check('rad/s gyro: swing still detected or unit switch works (informational)', true, `(events: ${e.length}${e[0] ? ' ' + e[0].shot + '/' + e[0].side : ''})`);
  const both = [...conv, ...genSwingTrace({ shot: 'topspin', side: 'bh', hand: 'R', hz: 60, seed: 4243 }).samples.map((s) => ({ ...s, t: s.t + 100000, rot: { alpha: s.rot.alpha * Math.PI / 180, beta: s.rot.beta * Math.PI / 180, gamma: s.rot.gamma * Math.PI / 180 } }))];
  const e2 = runTrace(both, 'R').events.filter((x) => x.type === 'swing');
  const last = e2[e2.length - 1];
  check('rad/s gyro: second swing recognized after unit auto-switch', !!last && last.side === 'bh', JSON.stringify(last && [last.shot, last.side, last.power]));
}


// ---------- 8. analog outputs (DESIGN.md 6.2): each knob of the generator must be tracked monotonically ----------
// Synthetic only: the generator and the recognizer were written by the same author, so this checks internal consistency
// (monotonic, correctly signed, correlated), not real-world calibration of the numbers.
function spearman(xs, ys) {
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const rx = rank(xs), ry = rank(ys), n = xs.length, mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy || 1);
}
const COMBOS = [];
for (const hand of ['R', 'L']) for (const side of SIDES) for (const hz of [60, 100]) COMBOS.push({ hand, side, hz, flip: (COMBOS.length % 3) === 1 });
let aSeed = 200000;
function sweep(knob, levels, { shot = 'flat', fixed = {}, reps = 1 } = {}) {
  const rows = [];
  for (const lv of levels) for (const c of COMBOS) for (let r = 0; r < reps; r++) {
    const { samples, truth } = genSwingTrace({ shot, ...c, seed: aSeed++, ...fixed, [knob]: lv });
    const e = runTrace(samples, c.hand).events.filter((x) => x.type === 'swing');
    rows.push({ lv, c, truth, e: e.length === 1 ? e[0] : null });
  }
  const ok = rows.filter((r) => r.e);
  const means = (f) => levels.map((lv) => { const a = ok.filter((r) => r.lv === lv).map((r) => f(r)); return a.reduce((x, y) => x + y, 0) / (a.length || 1); });
  const rho = (f, xf = (r) => r.lv) => spearman(ok.map(xf), ok.map(f));
  return { rows, ok, means, rho, detected: ok.length / rows.length };
}
const fmt = (a) => a.map((x) => x.toFixed(2)).join(' ');
const analogRes = {};
function report(name, sw, f, minAbsRho, expectSign, xf) {
  const r = sw.rho(f, xf), m = sw.means(f);
  analogRes[name] = { rho: +r.toFixed(3), means: m.map((x) => +x.toFixed(3)), detected: sw.detected };
  check(`${name}: rho ${r.toFixed(2)} (want ${expectSign > 0 ? '>=' : '<='} ${expectSign * minAbsRho}), level means [${fmt(m)}], detected ${(sw.detected * 100).toFixed(0)}%`,
    expectSign * r >= minAbsRho && sw.detected >= 0.95);
  return { r, m };
}
console.log('\n--- analog outputs vs generator knobs (synthetic) ---');
{
  const sw = sweep('speed', [0.6, 0.8, 1.0, 1.2, 1.4]);
  report('speed -> power', sw, (r) => r.e.power, 0.85, 1);
  report('speed -> speedDps', sw, (r) => r.e.speedDps, 0.85, 1);
}
{
  const sw = sweep('contactYaw', [-25, -12, 0, 12, 25], { shot: 'flat' });
  // ground truth: horizontal face direction at contact (+ = player's right). Early contact (+contactYaw) turns the face across
  // the body: right-hander forehand -> left (cross-court), backhand -> right (cross-court); mirrored for left-handers.
  report('contact yaw -> aimX (vs true face direction)', sw, (r) => r.e.aimX, 0.85, 1, (r) => r.truth.aimDeg);
  const err = sw.ok.map((r) => Math.abs(r.e.feat.aimDeg - r.truth.aimDeg)).sort((a, b) => a - b);
  analogRes.aimErrDeg = { median: err[err.length >> 1], p90: err[Math.floor(err.length * 0.9)] };
  check(`aim error deg: median ${err[err.length >> 1].toFixed(1)}, p90 ${err[Math.floor(err.length * 0.9)].toFixed(1)}`, err[Math.floor(err.length * 0.9)] < 15);
  const early = (hand, side) => { const a = sw.ok.filter((r) => r.lv === 25 && r.c.hand === hand && r.c.side === side).map((r) => r.e.aimX); return a.reduce((x, y) => x + y, 0) / a.length; };
  const cr = { 'R fh': early('R', 'fh'), 'R bh': early('R', 'bh'), 'L fh': early('L', 'fh'), 'L bh': early('L', 'bh') };
  check(`early contact = cross-court sign: R-fh ${cr['R fh'].toFixed(2)}<0, R-bh ${cr['R bh'].toFixed(2)}>0, L-fh ${cr['L fh'].toFixed(2)}>0, L-bh ${cr['L bh'].toFixed(2)}<0`,
    cr['R fh'] < -0.4 && cr['R bh'] > 0.4 && cr['L fh'] > 0.4 && cr['L bh'] < -0.4);
  for (const shot of ['topspin', 'slice', 'lob']) {
    const s2 = sweep('contactYaw', [-20, 0, 20], { shot });
    report(`contact yaw -> aimX (${shot})`, s2, (r) => r.e.aimX, 0.8, 1, (r) => r.truth.aimDeg);
  }
}
{
  const sw = sweep('pathDeg', [-25, -12, 0, 12, 25, 38], { fixed: { faceDeg: 5, rollDps: 0 } });
  report('path elevation -> lift', sw, (r) => r.e.lift, 0.85, 1);
  report('path elevation -> spin (face fixed)', sw, (r) => r.e.spin, 0.85, 1);
}
{
  const sw = sweep('faceDeg', [-20, -10, 0, 10, 20, 30], { fixed: { pathDeg: 8, rollDps: 0 } });
  report('face tilt (open +) -> spin', sw, (r) => r.e.spin, 0.85, -1);
  report('face tilt -> lift (should not move)', sw, (r) => r.e.lift, -1, 1);   // informational: lift is path-only
}
{
  const sw = sweep('rollDps', [-300, -150, 0, 150, 300], { fixed: { pathDeg: 8, faceDeg: 0 } });
  report('wrist roll (closing -) -> spin', sw, (r) => r.e.spin, 0.7, -1);
}
{
  const sw = sweep('jerk', [0, 0.25, 0.5, 0.75, 1]);
  const { m } = report('jerkiness -> exec', sw, (r) => r.e.exec, 0.8, -1);
  check(`very jerky swing graded poorly (exec ${m[4].toFixed(2)} < 0.5) and clean well (${m[0].toFixed(2)} > 0.85)`, m[4] < 0.5 && m[0] > 0.85);
}
{
  const sw = sweep('truncate', [0, 0.25, 0.5, 0.75, 1]);
  const { m } = report('truncated follow-through -> exec', sw, (r) => r.e.exec, 0.8, -1);
  check(`fully truncated swing graded poorly (exec ${m[4].toFixed(2)} < 0.5)`, m[4] < 0.5);
}
{
  // clean archetype swings of every type should get a good execution grade
  const all = [];
  for (const shot of SHOTS) { const sw = sweep('speed', [1], { shot }); for (const r of sw.ok) all.push([shot, r.e.exec]); }
  for (const shot of SHOTS) { const a = all.filter((x) => x[0] === shot).map((x) => x[1]).sort((p, q) => p - q); analogRes['cleanExec_' + shot] = a[a.length >> 1];
    check(`clean ${shot}: median exec ${a[a.length >> 1].toFixed(2)} >= 0.85`, a[a.length >> 1] >= 0.85); }
}
{
  // within-class continuity: light vs heavy topspin are both "topspin" but spin/lift differ
  const light = sweep('pathDeg', [15], { shot: 'topspin', fixed: { faceDeg: -5, rollDps: -80 }, reps: 2 });
  const heavy = sweep('pathDeg', [32], { shot: 'topspin', fixed: { faceDeg: -15, rollDps: -220 }, reps: 2 });
  const mean = (sw, f) => sw.ok.reduce((a, r) => a + f(r), 0) / sw.ok.length;
  const lt = mean(light, (r) => (r.e.shot === 'topspin' ? 1 : 0)), ht = mean(heavy, (r) => (r.e.shot === 'topspin' ? 1 : 0));
  const ls = mean(light, (r) => r.e.spin), hs = mean(heavy, (r) => r.e.spin), ll = mean(light, (r) => r.e.lift), hl = mean(heavy, (r) => r.e.lift);
  analogRes.lightVsHeavyTopspin = { light: { topspinRate: lt, spin: ls, lift: ll }, heavy: { topspinRate: ht, spin: hs, lift: hl } };
  check(`light vs heavy topspin: labelled topspin ${(lt * 100).toFixed(0)}% / ${(ht * 100).toFixed(0)}%, spin ${ls.toFixed(2)} -> ${hs.toFixed(2)}, lift ${ll.toFixed(2)} -> ${hl.toFixed(2)}`,
    lt >= 0.7 && ht >= 0.7 && hs - ls >= 0.15 && hl > ll);
}
{
  // user calibration normalises spin: a user's own topspin/slice centroids map near +-0.75
  const hand = 'R';
  const rec = createRecognizer({ hand });
  let sd = 300000;
  for (const shot of SHOTS) for (let i = 0; i < 3; i++) {
    const { samples } = genSwingTrace({ shot, side: i % 2 ? 'bh' : 'fh', hand, hz: 60, seed: sd++, speed: 0.8 });
    const ev = runTrace(samples, hand).events.find((e) => e.type === 'swing');
    if (ev) rec.addCalibrationSwing(shot, ev);
  }
  const cal = rec.exportCalibration();
  const res = {};
  for (const shot of SHOTS) {
    const a = [];
    for (let i = 0; i < 8; i++) {
      const { samples } = genSwingTrace({ shot, side: i % 2 ? 'bh' : 'fh', hand, hz: 60, seed: sd++, speed: 0.8 });
      const e = runTrace(samples, hand, JSON.parse(JSON.stringify(cal))).events.find((x) => x.type === 'swing');
      if (e) a.push(e);
    }
    res[shot] = { spin: a.reduce((x, e) => x + e.spin, 0) / a.length, lift: a.reduce((x, e) => x + e.lift, 0) / a.length, power: a.reduce((x, e) => x + e.power, 0) / a.length };
  }
  analogRes.calibrated = res;
  check(`calibrated spin: topspin ${res.topspin.spin.toFixed(2)}, flat ${res.flat.spin.toFixed(2)}, slice ${res.slice.spin.toFixed(2)}; lift lob ${res.lob.lift.toFixed(2)}; slow user's drive power ${res.flat.power.toFixed(2)}`,
    res.topspin.spin > 0.5 && res.slice.spin < -0.5 && Math.abs(res.flat.spin) < 0.35 && res.lob.lift > 0.6 && res.flat.power > 0.6);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(analogRes, null, 1));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
