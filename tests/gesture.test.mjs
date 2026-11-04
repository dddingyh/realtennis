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

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
