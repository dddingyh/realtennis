// Core mechanics of the arcade sim: timing -> direction, windows, power, shot types, latency compensation, serve,
// timeScale consistency, determinism, NaN safety.   Run: node tests/arcade_core.mjs
import { ArcadeSim } from '../cartoon/src/sim/arcade.js';
import { RNG } from '../src/game/rng.js';
import {
  HALF, H, check, finish, mean, f1, f2, mkSim, stepOnce, stepTo, stepWhile, doServe, swingAt, flightInfo, heightAtZ, allFinite,
} from './arcade_util.mjs';

const T0 = Date.now();

/** Feed the receiver `i` a medium rally ball whose side is chosen by the target x, return the swing result. */
function feedAndSwing(i, targetX, offsetMs, o = {}) {
  const sim = mkSim({ seed: o.seed ?? 7, hand0: o.hand0, hand1: o.hand1, timeScale: o.timeScale ?? 1 });
  const hitter = 1 - i;
  const side = i === 0 ? 1 : -1;                                     // z sign of the receiver's half
  sim.debugFeed(hitter, { target: { x: targetX, z: side * (HALF - 3.2) }, speedKmh: 98, y: 1.0 });
  const r = swingAt(sim, i, offsetMs, o);
  return { sim, r };
}

// ------------------------------------------------------------------ 1. timing -> direction
console.log('timing -> direction (target x of the aimed landing; t<0 = early)');
{
  // explicit truth table: screen direction (sign of x) of an EARLY swing  [hand][side][near?]
  const earlySign = (hand, side, near) => (hand === 'R' ? 1 : -1) * (side === 'fh' ? 1 : -1) * (near ? 1 : -1) * -1;
  const offs = [-130, -91, -52, -26, 0, 26, 52, 91, 130];
  let allMono = true, allSign = true, combos = 0;
  const rows = [];
  for (const hand of ['R', 'L']) for (const recv of [0, 1]) for (const tx of [-2.6, 2.6]) {
    const xs = [];
    let side = null;
    for (const off of offs) {
      const { r } = feedAndSwing(recv, recv === 0 ? tx : -tx, off, { hand0: recv === 0 ? hand : 'R', hand1: recv === 1 ? hand : 'R' });
      if (!r || !r.hit) { xs.push(NaN); continue; }
      side = r.hit.side; xs.push(r.hit.target.x);
    }
    combos++;
    const exp = earlySign(hand, side, recv === 0);
    // x must be monotone in t with the expected orientation: early (t<0) -> exp sign
    const dirOK = xs.every((x, k) => Number.isFinite(x));
    let mono = dirOK;
    for (let k = 1; k < xs.length && mono; k++) mono = (xs[k] - xs[k - 1]) * -exp >= -1e-9;
    const signOK = dirOK && xs[0] * exp > 1 && xs[xs.length - 1] * exp < -1;
    if (!mono) allMono = false;
    if (!signOK) allSign = false;
    rows.push(`${hand} ${recv === 0 ? 'near' : 'far '} ${side}  x(t=-130..+130): ${xs.map((x) => f1(x).padStart(5)).join(' ')}  ${mono && signOK ? 'ok' : 'BAD'}`);
  }
  rows.forEach((r) => console.log('   ' + r));
  check('target x is monotone in timing for every hand/side/court-end combination', allMono, `${combos} combos`);
  check('early/late orientation mirrors correctly (hand x stroke side x near/far)', allSign);
}

// ------------------------------------------------------------------ 2. timing windows
console.log('timing windows');
{
  const lab = (off, src, extra = {}) => {
    const { sim, r } = feedAndSwing(0, 1.5, off, { source: src, ...extra });
    const whiff = sim.log.find((e) => e.type === 'whiff');
    return { hit: r && r.hit, whiff };
  };
  const cases = [[0, 'perfect'], [20, 'perfect'], [-20, 'perfect'], [-70, 'early'], [-120, 'early'], [70, 'late'], [120, 'late'], [-170, 'wide'], [200, 'wide']];
  for (const [off, want] of cases) {
    const x = lab(off, 'keyboard');
    check(`t=${off} ms -> ${want}`, x.hit && x.hit.timing === want, x.hit ? `${x.hit.timing} ${x.hit.timingMs} ms` : 'no hit');
  }
  const w1 = lab(-300, 'keyboard'), w2 = lab(300, 'keyboard');
  check('|t| > 240 ms whiffs (early)', !w1.hit && w1.whiff && w1.whiff.reason === 'early');
  check('|t| > 240 ms whiffs (late)', !w2.hit && !!w2.whiff);
  const k = lab(258, 'keyboard'), rm = lab(258, 'remote');
  check('remote window is a little wider than keyboard (t=+258 ms)', !k.hit && rm.hit && rm.hit.timing === 'wide', rm.hit ? rm.hit.timing : 'no hit');
  const rp = lab(32, 'remote'), kp = lab(32, 'keyboard');
  check('remote "perfect" band is wider (t=+32 ms)', rp.hit && rp.hit.timing === 'perfect' && kp.hit && kp.hit.timing === 'late');
  // wide = weak mishit that usually goes out
  let outW = 0, nW = 0, qW = [], qP = [];
  for (let s = 0; s < 24; s++) {
    const { sim, r } = feedAndSwing(0, 1.5, 175 + (s % 5) * 10, { seed: 40 + s });
    if (r && r.hit) { qW.push(r.hit.quality); const f = flightInfo(sim); nW++; if (f.netHit || !f.landing || !f.landing.in) outW++; }
    const p = feedAndSwing(0, 1.5, 0, { seed: 40 + s }); if (p.r && p.r.hit) qP.push(p.r.hit.quality);
  }
  check('wide mishits are weak and usually error', outW / nW >= 0.55 && mean(qW) < mean(qP) - 0.2, `error ${(100 * outW / nW).toFixed(0)}%  q wide ${f2(mean(qW))} vs perfect ${f2(mean(qP))}`);
  // an early swing is buffered: connects at the contact moment, not at the key press
  const sim = mkSim({ seed: 9 });
  sim.debugFeed(1, { target: { x: 1, z: HALF - 3 }, speedKmh: 98 });
  stepWhile(sim, () => !sim.P[0].plan);
  stepTo(sim, sim.P[0].plan.tContact - 0.12);
  const before = sim.time;
  sim.swing(0, { shot: 'topspin', power: 0.6 });
  const hitEv0 = sim.log.find((e) => e.type === 'hit');
  stepWhile(sim, () => !sim.log.find((e) => e.type === 'hit'), 200);
  const hitEv = sim.log.find((e) => e.type === 'hit');
  check('early swing (-120 ms) is buffered and still connects, labelled early', !hitEv0 && hitEv && hitEv.timing === 'early' && sim.time - before > 0.09, hitEv ? `${hitEv.timingMs} ms after ${f2(sim.time - before)} s` : 'no hit');
}

// ------------------------------------------------------------------ 3. power -> pace
console.log('power -> pace');
{
  const sp = [];
  for (const pw of [0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
    const v = [];
    for (let s = 0; s < 6; s++) { const { r } = feedAndSwing(0, (s - 2.5) * 0.8, 0, { power: pw, seed: 60 + s }); if (r && r.hit) v.push(r.hit.speedKmh); }
    sp.push(mean(v));
  }
  console.log('   power .1 .3 .5 .7 .9 1.0 -> km/h: ' + sp.map(f1).join(' '));
  check('pace increases monotonically with power', sp.every((x, k) => k === 0 || x > sp[k - 1]));
  check('rally pace within the arcade range (70..135 km/h for topspin)', sp[0] >= 65 && sp[5] <= 140, `${f1(sp[0])}..${f1(sp[5])}`);
}

// ------------------------------------------------------------------ 4. shot types
console.log('shot types (perfect timing, set position)');
const table = {};
{
  const runType = (kind, nTrials, setup) => {
    const rows = [];
    for (let s = 0; s < nTrials; s++) {
      const sim = mkSim({ seed: 200 + s });
      setup(sim, s);
      const r = swingAt(sim, 0, 0, { shot: kind.shot, power: kind.power, seed: 200 + s });
      if (!r || !r.hit) continue;
      const hit = r.hit;
      const f = flightInfo(sim);
      rows.push({ hit, f, depth: f.landing ? Math.abs(f.landing.z) : NaN });
    }
    return rows;
  };
  const baselineFeed = (sim, s) => sim.debugFeed(1, { target: { x: -2.0 + (s % 5) * 1.0, z: HALF - 2.8 }, speedKmh: 92 + (s % 4) * 3, y: 1.0 });
  const defs = [
    ['topspin', { shot: 'topspin', power: 0.6 }, baselineFeed],
    ['flat', { shot: 'flat', power: 0.6 }, baselineFeed],
    ['slice', { shot: 'slice', power: 0.6 }, baselineFeed],
    ['lob', { shot: 'lob', power: 0.5 }, baselineFeed],
    ['drop', { shot: 'slice', power: 0.08 }, baselineFeed],
  ];
  for (const [name, kind, setup] of defs) {
    const rows = runType(kind, 20, setup);
    const inn = rows.filter((x) => x.f.landing && x.f.landing.in && !x.f.netHit).length;
    table[name] = {
      n: rows.length, kmh: mean(rows.map((x) => x.hit.speedKmh)), rpm: mean(rows.map((x) => x.hit.spinRpm)),
      netClear: mean(rows.filter((x) => x.f.netClear != null).map((x) => x.f.netClear)), depth: mean(rows.map((x) => x.depth)),
      apex: mean(rows.filter((x) => x.f.apexAfter != null).map((x) => x.f.apexAfter)), inPct: 100 * inn / rows.length,
      hAfter: mean(rows.filter((x) => x.f.hAfter != null).map((x) => x.f.hAfter)), netPeak: mean(rows.filter((x) => x.f.netY != null).map((x) => x.f.netY)),
    };
  }
  console.log('   shot     n  km/h   rpm  netClear  netY  depth(from net)  apex after bounce  in%');
  for (const [k, v] of Object.entries(table)) console.log(`   ${k.padEnd(8)} ${String(v.n).padStart(2)} ${f1(v.kmh).padStart(5)} ${String(Math.round(v.rpm)).padStart(5)} ${f2(v.netClear).padStart(8)} ${f2(v.netPeak).padStart(5)} ${f1(v.depth).padStart(8)} ${f2(v.apex).padStart(14)} ${v.inPct.toFixed(0).padStart(8)}`);
  const T = table;
  check('topspin: lands in most of the time with a safe net margin', T.topspin.inPct >= 70 && T.topspin.netClear > 0.4, `${T.topspin.inPct.toFixed(0)}% in, clear ${f2(T.topspin.netClear)}`);
  check('flat is faster and skims the net more than topspin', T.flat.kmh > T.topspin.kmh * 1.05 && T.flat.netClear < T.topspin.netClear);
  check('slice is slower than topspin, has backspin and bounces lower', T.slice.kmh < T.topspin.kmh && T.slice.apex < T.topspin.apex * 0.8, `apex ${f2(T.slice.apex)} vs ${f2(T.topspin.apex)}`);
  check('shots land deep (6.5..11.8 m from the net) for rally shots', [T.topspin, T.flat, T.slice].every((x) => x.depth > 6.5 && x.depth < 11.9));
  check('lob goes high and lands deep', T.lob.netPeak > 4.5 && T.lob.depth > 9, `peak at net ${f2(T.lob.netPeak)} m, depth ${f1(T.lob.depth)}`);
  check('drop shot lands short and is mostly in', T.drop.depth < 6.0 && T.drop.inPct >= 55, `depth ${f1(T.drop.depth)} m, ${T.drop.inPct.toFixed(0)}% in`);
  check('drop shot dies after the bounce (little forward speed left)', T.drop.hAfter < 0.4 * T.topspin.hAfter, `${f1(T.drop.hAfter)} vs ${f1(T.topspin.hAfter)} m/s`);
}

// ------------------------------------------------------------------ 5. lob vs net player
console.log('lob clears a net player');
{
  const res = [];
  for (const pw of [0.3, 0.5, 0.7]) for (let s = 0; s < 14; s++) {
    const sim = mkSim({ seed: 300 + s });
    sim.debugFeed(1, { target: { x: -1.5 + (s % 5) * 0.8, z: HALF - 2.8 }, speedKmh: 92, y: 1.0 });
    sim.debugPlace(1, 0.5, -2.6, 'net');
    const r = swingAt(sim, 0, 0, { shot: 'lob', power: pw, seed: 300 + s });
    if (!r || !r.hit) continue;
    const hz = heightAtZ(sim, -2.6);
    const f = flightInfo(sim);
    res.push({ pw, hz, in: f.landing && f.landing.in && !f.netHit, depth: f.landing ? Math.abs(f.landing.z) : NaN });
  }
  const ok = res.filter((x) => x.hz != null && x.hz >= 3.2).length;
  const inn = res.filter((x) => x.in).length;
  console.log(`   ${res.length} lobs: ${ok} cleared 3.2 m at the net player (min ${f2(Math.min(...res.map((x) => x.hz)))} m), ${inn} landed in`);
  check('lobs clear the net player by >= 3.2 m', ok / res.length >= 0.9);
  check('lobs land in (perfect timing)', inn / res.length >= 0.75, `${(100 * inn / res.length).toFixed(0)}%`);
}

// ------------------------------------------------------------------ 6. volley / smash derivation
console.log('volley / smash derivation');
{
  let vol = 0, nv = 0, sm = 0, ns = 0, smIn = 0;
  for (let s = 0; s < 10; s++) {
    const sim = mkSim({ seed: 400 + s });
    sim.debugPlace(0, 0.5, 2.6, 'net');
    sim.debugFeed(1, { target: { x: 1.0, z: 9.5 }, speedKmh: 112, y: 1.0, topRpm: 500, clear: 0.12 });
    const r = swingAt(sim, 0, 0, { shot: 'topspin', power: 0.6 });
    if (r && r.hit) { nv++; if (r.hit.shot === 'volley') vol++; }
  }
  for (let s = 0; s < 10; s++) {
    const sim = mkSim({ seed: 500 + s });
    sim.debugPlace(0, 0.5, 4.2, 'net');
    sim.debugFeed(1, { target: { x: 0.8, z: 6.8 }, speedKmh: 60, y: 1.0, el: 62 * Math.PI / 180 });
    const r = swingAt(sim, 0, 0, { shot: 'topspin', power: 0.8 });
    if (r && r.hit) { ns++; if (r.hit.shot === 'smash') { sm++; const f = flightInfo(sim); if (f.landing && f.landing.in) smIn++; } }
  }
  check('balls hit out of the air near the net become volleys', nv >= 8 && vol === nv, `${vol}/${nv}`);
  check('high balls near the net become smashes (fast, mostly in)', ns >= 8 && sm >= ns - 1 && smIn >= sm * 0.6, `${sm}/${ns} smash, ${smIn} in`);
}

// ------------------------------------------------------------------ 7. latency compensation
console.log('latency compensation (ageMs)');
{
  const run = (lateMs, ageMs, ts) => {
    const sim = mkSim({ seed: 21, timeScale: ts });
    sim.debugFeed(1, { target: { x: 0.5, z: HALF - 3 }, speedKmh: 98 });
    stepWhile(sim, () => !sim.P[0].plan);
    const swingT = sim.P[0].plan.tContact + lateMs / 1000;
    const arriveT = swingT + ageMs / 1000 * ts;
    stepTo(sim, Math.round(arriveT * 120) / 120);
    sim.swing(0, { shot: 'topspin', power: 0.6, ageMs, source: 'remote' });
    stepTo(sim, Math.round((swingT + 0.5) * 120) / 120);
    return sim;
  };
  for (const [late, ts] of [[60, 1], [90, 0.8], [-30, 0.8]]) {
    const a = run(late, 0, ts), b = run(late, 125, ts);
    const la = a.lastShot, lb = b.lastShot;
    const same = la && lb && la.timing === lb.timing && Math.abs(la.timingMs - lb.timingMs) <= 9 && Math.abs(la.target.x - lb.target.x) < 0.2 && Math.abs(la.speedKmh - lb.speedKmh) < 2;
    const dBall = Math.hypot(a.b.pos.x - b.b.pos.x, a.b.pos.y - b.b.pos.y, a.b.pos.z - b.b.pos.z);
    check(`late ${late} ms @timeScale ${ts}: swing delivered 125 ms (real) late with ageMs=125 gives the same result`, same && dBall < 0.35,
      `${la ? la.timingMs : '-'} vs ${lb ? lb.timingMs : '-'} ms, target x ${la ? f2(la.target.x) : '-'} vs ${lb ? f2(lb.target.x) : '-'}, ball diff ${f2(dBall)} m`);
  }
  // without compensation the same delayed swing would read as 100 ms later
  const c = (() => { const sim = mkSim({ seed: 21 }); sim.debugFeed(1, { target: { x: 0.5, z: HALF - 3 }, speedKmh: 98 }); stepWhile(sim, () => !sim.P[0].plan); stepTo(sim, Math.round((sim.P[0].plan.tContact + 0.06 + 0.1) * 120) / 120); sim.swing(0, { shot: 'topspin', power: 0.6, ageMs: 0, source: 'remote' }); return sim.lastShot; })();
  const d = run(60, 100, 1).lastShot;
  check('without ageMs the delayed swing reads ~100 ms later', c && d && c.timingMs - d.timingMs > 80, `${c ? c.timingMs : '-'} vs ${d ? d.timingMs : '-'}`);
}

// ------------------------------------------------------------------ 8. serve
console.log('serve');
{
  // toss: ball attached to the tossing hand until release
  const sim = mkSim({ seed: 5 });
  stepWhile(sim, () => sim.phase !== 'serving');
  const srv = sim.match.server, P = sim.P[srv];
  check('before the toss the ball is in the hand', sim.state.ball.attach && sim.state.ball.attach.player === srv && sim.state.ball.attach.hand === 'toss');
  sim.swing(srv, { source: 'keyboard' });
  let attachedOK = true, maxDist = 0, maxY = 0, released = false;
  for (let k = 0; k < 400; k++) {
    stepOnce(sim);
    const at = sim.state.ball.attach;
    const b = sim.b;
    if (at) { maxDist = Math.max(maxDist, Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z)); if (b.pos.y < 0.8 || b.pos.y > 2.2) attachedOK = false; }
    else { released = true; maxY = Math.max(maxY, b.pos.y); if (sim.sv.stage === 'flight' && sim.time > sim.sv.tApex) break; }
  }
  check('the ball stays near the tossing hand while attached, then is released and rises to the apex', attachedOK && released && maxDist < 1.0 && Math.abs(maxY - 3.05) < 0.1, `apex ${f2(maxY)} m, max hand offset ${f2(maxDist)} m`);
  const toss = sim.log.find((e) => e.type === 'toss');
  check('toss event emitted; hint reports tossUp', !!toss);

  // apex timing -> pace / faults
  const rows = [];
  for (const off of [-200, -140, -90, -40, 0, 40, 90, 140, 200]) {
    const sp = [];
    let faults = 0, n = 0, aceLike = 0;
    for (let s = 0; s < 14; s++) {
      const sm = mkSim({ seed: 600 + s });
      const srv = doServe(sm, { offsetMs: off, power: 1 });
      const hit = sm.lastShot;
      n++; sp.push(hit.speedKmh);
      stepWhile(sm, () => sm.faultCount === 0 && sm.phase === 'rally' && sm.rl.live && !sm.log.some((e) => e.type === 'bounce'), 600);
      const b = sm.log.find((e) => e.type === 'bounce');
      if (sm.faultCount > 0 || (b && !b.in)) faults++;
    }
    rows.push({ off, kmh: mean(sp), fault: 100 * faults / n });
  }
  console.log('   apex offset ms:  ' + rows.map((r) => String(r.off).padStart(5)).join(' '));
  console.log('   first-serve km/h:' + rows.map((r) => f1(r.kmh).padStart(5)).join(' '));
  console.log('   fault %:         ' + rows.map((r) => r.fault.toFixed(0).padStart(5)).join(' '));
  const mid = rows[4];
  check('contact at the toss apex gives the fastest serve', rows.every((r) => r.kmh <= mid.kmh + 0.01), `${f1(mid.kmh)} km/h`);
  check('pace falls off monotonically with |apex offset|', rows[3].kmh >= rows[2].kmh && rows[2].kmh >= rows[1].kmh && rows[5].kmh >= rows[6].kmh && rows[6].kmh >= rows[7].kmh);
  check('first serves reach the contract speed (<= 170 km/h, perfect >= 140)', mid.kmh >= 140 && Math.max(...rows.map((r) => r.kmh)) <= 170);
  check('well-timed serves are mostly in; badly timed serves fault much more', mid.fault <= 30 && rows[0].fault >= 55 && rows[8].fault >= 55, `perfect ${mid.fault.toFixed(0)}%, -200 ms ${rows[0].fault.toFixed(0)}%, +200 ms ${rows[8].fault.toFixed(0)}%`);
  // serve direction: early/late picks wide/T (target x along the box)
  const xs = [-100, -50, 0, 50, 100].map((off) => { const sm = mkSim({ seed: 3 }); doServe(sm, { offsetMs: off, power: 0.8 }); return sm.lastShot.target.x; });
  console.log('   serve target x for apex offset -100..+100 ms: ' + xs.map(f2).join(' '));
  check('serve direction is monotone in timing', xs.every((x, k) => k === 0 || x < xs[k - 1]) || xs.every((x, k) => k === 0 || x > xs[k - 1]));
  // second serve
  const sm = mkSim({ seed: 4 });
  doServe(sm, { offsetMs: 400 });                                    // air ball -> fault
  stepWhile(sm, () => sm.phase !== 'serving');
  check('a bad first serve is a fault and the second serve is offered', sm.faultCount === 1 && sm.log.some((e) => e.type === 'call' && e.text === 'FAULT'));
  const first = []; const second = [];
  for (let s = 0; s < 8; s++) {
    const a = mkSim({ seed: 700 + s }); doServe(a, { offsetMs: 0, power: 1 }); first.push(a.lastShot.speedKmh);
    const b = mkSim({ seed: 700 + s }); doServe(b, { offsetMs: 400 }); stepWhile(b, () => b.phase !== 'serving'); doServe(b, { offsetMs: 0, power: 1 }); second.push(b.lastShot.speedKmh);
  }
  check('the second serve is automatically safer (slower, more spin)', mean(second) < mean(first) * 0.8, `${f1(mean(second))} vs ${f1(mean(first))} km/h`);
  // double fault
  const df = mkSim({ seed: 4 });
  doServe(df, { offsetMs: 400 }); stepWhile(df, () => df.phase !== 'serving'); doServe(df, { offsetMs: 400 });
  stepWhile(df, () => df.phase === 'rally');
  check('double fault gives the point to the receiver', df.log.some((e) => e.type === 'call' && e.text === 'DOUBLE FAULT') && df.stats.doubleFaults[0] + df.stats.doubleFaults[1] === 1 && df.stats.points[1] === 1 && df.stats.points[0] === 0);
}

// ------------------------------------------------------------------ 9. timeScale consistency / determinism / NaN
console.log('timeScale consistency, determinism, NaN safety');
{
  const mk = (ts, seed = 11) => new ArcadeSim({
    seed, timeScale: ts, format: { sets: 1, gamesPerSet: 2, tiebreak: true },
    players: [{ human: false, hand: 'R', ai: { level: 0.6, style: 'attacker' } }, { human: false, hand: 'L', ai: { level: 0.6, style: 'trickster' } }],
  });
  const snaps = {};
  for (const ts of [0.5, 0.8, 1.0, 1.5]) {
    const s = mk(ts);
    for (let k = 0; k < 120 * 30; k++) { s.step(H / ts); }
    snaps[ts] = { t: s.time, b: { ...s.b.pos }, p0: { ...s.P[0].pos }, p1: { ...s.P[1].pos }, pts: s.match.points.join('-') + '/' + s.match.games.join('-'), shots: s.rl.shots };
  }
  const ref = snaps[1.0];
  let maxD = 0;
  for (const k of Object.keys(snaps)) { const q = snaps[k]; maxD = Math.max(maxD, Math.hypot(q.b.x - ref.b.x, q.b.y - ref.b.y, q.b.z - ref.b.z), Math.hypot(q.p0.x - ref.p0.x, q.p0.z - ref.p0.z), Math.hypot(q.p1.x - ref.p1.x, q.p1.z - ref.p1.z)); }
  check('the world evolves identically for any timeScale (same sim-time inputs)', maxD < 1e-6 && Object.values(snaps).every((q) => q.pts === ref.pts), `max diff ${maxD.toExponential(1)}, score ${ref.pts}`);
  // also: coarse real-time frames (1/30 s) reproduce the same world as fine frames at the same sim time
  const a = mk(0.8), b = mk(0.8);
  for (let k = 0; k < 600; k++) a.step(1 / 60);
  for (let k = 0; k < 300; k++) b.step(1 / 30);
  check('frame size does not matter', Math.hypot(a.b.pos.x - b.b.pos.x, a.b.pos.z - b.b.pos.z, a.b.pos.y - b.b.pos.y) < 1e-6 && Math.abs(a.time - b.time) < 1e-9);

  // determinism with scripted human input
  const script = (seed) => {
    const s = new ArcadeSim({ seed, timeScale: 0.8, players: [{ human: true, hand: 'R' }, { human: false, hand: 'L', ai: { level: 0.5, style: 'netrusher' } }] });
    const r = new RNG(seed + 1000);
    const evs = [];
    let bad = null;
    for (let k = 0; k < 60 * 70; k++) {
      if (r.chance(0.04)) s.swing(0, { shot: r.pick(['topspin', 'flat', 'slice', 'lob']), power: r.next(), ageMs: r.chance(0.3) ? r.range(0, 120) : 0, source: r.pick(['keyboard', 'remote']) });
      if (r.chance(0.01)) s.toggleNet(0);
      if (r.chance(0.002)) s.pause(true); else if (s.paused && r.chance(0.2)) s.pause(false);
      s.step(1 / 60);
      for (const e of s.drainEvents()) evs.push(e);
      if (!bad) bad = allFinite(s.state);
    }
    return { evs, bad, st: JSON.stringify(s.state.match.stats) };
  };
  const r1 = script(5), r2 = script(5), r3 = script(6);
  check('deterministic for a given seed and input script', JSON.stringify(r1.evs) === JSON.stringify(r2.evs) && r1.st === r2.st && r1.evs.length > 20, `${r1.evs.length} events`);
  check('different seed gives a different match', JSON.stringify(r1.evs) !== JSON.stringify(r3.evs));
  check('no NaN / Infinity anywhere in state under random inputs (swings, remote ages, net toggles, pause)', !r1.bad && !r3.bad, r1.bad || r3.bad || '');
}

console.log(`\n(core tests took ${((Date.now() - T0) / 1000).toFixed(1)} s)`);
finish();
