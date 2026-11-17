// Engine v2 shot model: contact point -> face angle (psi) -> direction, sidespin per stroke/hand, direction-change risk,
// graceful mistimes, quality factors, side hint.   Run: node tests/engine_shot.mjs
import { ArcadeSim } from '../cartoon/src/engine/sim.js';
import { HALF, check, finish, mean, f1, f2, mkSim, stepWhile, swingAt, flightInfo } from './engine_util.mjs';

const T0 = Date.now();
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** Feed the receiver `i` a rally ball landing at x = bx, swing with timing offset offMs; returns {sim, r, h}. */
function go(i, bx, offMs, o = {}) {
  const sim = mkSim({ seed: o.seed ?? 7, hand0: o.hand0, hand1: o.hand1, timeScale: 1 });
  sim.setLag(i, 0); sim.P[i].perceive = 0; sim.debugPlace(i, 0, (i === 0 ? 1 : -1) * 12.65);
  const side = i === 0 ? 1 : -1;
  sim.debugFeed(1 - i, { target: { x: bx, z: side * (HALF - (o.depth ?? 3.2)) }, speedKmh: o.kmh ?? 98, topRpm: o.topRpm, y: 1.0, from: o.from || { x: 0, y: 1.0, z: (i === 0 ? -1 : 1) * 12.4 } });
  const r = swingAt(sim, i, offMs, { shot: o.shot || 'topspin', power: o.power ?? 0.6 });
  return { sim, r, h: r && r.hit };
}

console.log('--- psi (face yaw) from timing / depth / lateral position; direction from the actual contact point');
{
  // psi monotone in timing, via aimPreview on the live plan
  const sim = mkSim({ seed: 3, timeScale: 1 });
  sim.debugFeed(1, { target: { x: 1.0, z: HALF - 3.2 }, speedKmh: 98 });
  const p = sim.aimPreview(0, 0);
  const rows = [-150, -100, -50, -25, 0, 25, 50, 100, 150].map((t) => sim.aimPreview(0, t));
  console.log('  t(ms) -> psi(deg), target x:  ' + [-150, -100, -50, -25, 0, 25, 50, 100, 150].map((t, k) => `${t}:${f1(rows[k].psi)}/${f1(rows[k].x)}`).join('  '));
  let mono = true; for (let k = 1; k < rows.length; k++) if (!(rows[k].psi < rows[k - 1].psi && rows[k].x * (p.side === 'fh' ? 1 : 1) !== undefined)) mono = false;
  check('psi strictly decreases with t (early = pulled = larger psi)', mono);
  check('target x monotone in t (R near fh: early -> -x, late -> +x)', rows.every((r, k) => k === 0 || (p.side === 'fh' ? r.x > rows[k - 1].x : r.x < rows[k - 1].x)), p.side);
  const K = sim.K;
  const loc = { fwd: K.IDEAL_FWD, lat: K.IDEAL_LAT.fh };
  const base = sim._psiParts(sim.P[0], 'fh', loc, 0, { x: 0, z: 11 }, -9).psi;
  const front = sim._psiParts(sim.P[0], 'fh', { ...loc, fwd: loc.fwd + 0.5 }, 0, { x: 0, z: 11 }, -9).psi;
  const behind = sim._psiParts(sim.P[0], 'fh', { ...loc, fwd: loc.fwd - 0.5 }, 0, { x: 0, z: 11 }, -9).psi;
  const jam = sim._psiParts(sim.P[0], 'fh', { ...loc, lat: loc.lat - 0.3 }, 0, { x: 0, z: 11 }, -9).psi;
  const str = sim._psiParts(sim.P[0], 'fh', { ...loc, lat: loc.lat + 0.3 }, 0, { x: 0, z: 11 }, -9).psi;
  check('psi grows with contact.fwd (further in front = pulled, behind = pushed)', front > base && base > behind, `${f1(behind)} < ${f1(base)} < ${f1(front)}`);
  check('psi grows with contact.lat (jammed = pushed, stretched = closes)', jam < base && base < str, `${f1(jam)} < ${f1(base)} < ${f1(str)}`);
  // the inverse (timingForAim) puts the ball where asked
  let worst = 0;
  for (const ax of [-3, -1.5, 0, 1.5, 3]) {
    const t = sim.timingForAim(0, ax);
    const a = sim.aimPreview(0, t);
    worst = Math.max(worst, Math.abs(a.x - ax));
  }
  check('timingForAim inverts aimPreview (within 0.25 m)', worst < 0.25, f2(worst) + ' m');
}

console.log('--- mirrored for backhand / left-handers / far player (same geometry, mirrored world)');
{
  let ok = true; const rows = [];
  for (const [hand, bx] of [['R', 1.2], ['R', -1.2], ['R', 3.0], ['R', -3.0], ['R', 0.1], ['R', -0.1]]) {
    for (const off of [-60, 0, 60]) {
      const a = go(0, bx, off, { hand0: hand }), b = go(0, -bx, off, { hand0: hand === 'R' ? 'L' : 'R' });
      if (!a.h || !b.h) { ok = false; continue; }
      const mir = Math.abs(a.h.target.x + b.h.target.x) < 0.4 && a.h.side === b.h.side && Math.abs(a.h.face - b.h.face) < 1.2;
      if (!mir) ok = false;
      if (off === 0) rows.push(`${hand} ball x=${bx}: ${a.h.side} target ${f2(a.h.target.x)} | mirror ${f2(b.h.target.x)}`);
    }
  }
  console.log('  ' + rows.join('\n  '));
  check('right-hander vs left-hander in the mirrored world: same face angle (+-1.2 deg), mirrored targets (+-0.4 m; the contact point is sampled at 1/60 s)', ok);
  // far player (index 1) vs near player: 180 degree rotation
  let ok2 = true;
  for (const bx of [1.2, -2.5]) for (const off of [-60, 60]) {
    const n = go(0, bx, off), f = go(1, -bx, off);
    if (!n.h || !f.h) { ok2 = false; continue; }
    if (!(Math.abs(n.h.target.x + f.h.target.x) < 0.4 && Math.abs(n.h.face - f.h.face) < 1.2 && n.h.side === f.h.side)) ok2 = false;
  }
  check('far player = near player rotated 180 degrees (same face angle, x mirrored)', ok2);
}

console.log('--- geometry: the ray starts at the real contact point');
{
  const ang = (h) => Math.atan2(h.target.x - h.pos.x, Math.abs(h.target.z - h.pos.z)) * 180 / Math.PI;     // + = toward +x
  const rows = [];
  for (const bx of [-3.0, 0, 3.0]) { const a = go(0, bx, -60); rows.push([bx, a.h]); }
  console.log('  early swing (t = -60) from ball x: ' + rows.map(([bx, h]) => `${bx}: contact x ${f2(h.pos.x)} -> target ${f2(h.target.x)} (${f1(ang(h))} deg, face ${f1(h.face)})`).join('   '));
  const [c, m, w] = [rows[1][1], rows[0][1], rows[2][1]];
  // a right-hander's forehand pulled (early) goes to -x; from the wide forehand corner (+x) it is a sharper angle than from the middle
  check('pulled forehand from the wide forehand corner is a sharper cross-court angle than from the middle', Math.abs(ang(w)) > Math.abs(ang(c)) + 1.5, `${f1(ang(w))} vs ${f1(ang(c))} deg`);
  const n0 = go(0, 3.0, 0).h, p0 = go(0, -3.0, 0).h;
  check('a neutral swing from the forehand corner heads back into the court (cross-court)', n0.target.x < n0.pos.x - 1.5, `${f2(n0.pos.x)} -> ${f2(n0.target.x)}`);
  check('a neutral swing from the backhand corner is inside-out/inside-in (toward the middle)', Math.abs(p0.target.x) < Math.abs(p0.pos.x) - 1.0, `${f2(p0.pos.x)} -> ${f2(p0.target.x)} (${p0.side})`);
  const late = go(0, 3.0, 70).h, early = go(0, 3.0, -70).h;
  check('late (pushed) from the same corner goes down the line, early (pulled) crosses', late.target.x > early.target.x + 2.5, `${f2(late.target.x)} vs ${f2(early.target.x)}`);
}

console.log('--- sidespin per stroke and hand (curveM > 0 bends toward +x)');
{
  const bends = [];
  const t = (hand, recv, shot) => { const r = go(recv, recv === 0 ? 0.5 : -0.5, -30, { hand0: hand, hand1: hand, shot }).h; return r; };
  let okTop = true, okSlice = true;
  for (const [hand, recv] of [['R', 0], ['L', 0], ['R', 1], ['L', 1]]) {
    const hx = (hand === 'R' ? 1 : -1) * (recv === 0 ? 1 : -1);
    const a = t(hand, recv, 'topspin'), b = t(hand, recv, 'slice');
    if (!a || !b) { okTop = false; continue; }
    bends.push(`${hand}${recv === 0 ? 'near' : 'far'} ${a.side}: top ${f2(a.curveM)} slice ${f2(b.curveM)}`);
    if (!(Math.sign(a.curveM) === -hx && Math.abs(a.curveM) > 0.2)) okTop = false;
    if (!(Math.sign(b.curveM) === hx && Math.abs(b.curveM) > 0.1)) okSlice = false;
  }
  console.log('  ' + bends.join('   '));
  check('topspin hooks toward the non-hitting side of the forehand / hitting side of the backhand (world -handX)', okTop);
  check('slice carves the opposite way', okSlice);
  // visible bananas: sharp angles produce >= 0.8 m of bend
  const sharp = go(0, 3.3, -90).h, flat = go(0, 0, 0, { shot: 'flat' }).h;
  check('a sharp angled topspin shot has a visible banana (>= 0.8 m)', Math.abs(sharp.curveM) >= 0.8, `${f2(sharp.curveM)} m, sideRpm ${Math.round(sharp.sideRpm)}`);
  check('a flat shot curves much less than a topspin angle', Math.abs(flat.curveM) < Math.abs(sharp.curveM) * 0.6, `${f2(flat.curveM)} m`);
  check('ball lands near its aimed target despite the curve', (() => { const s = go(0, 3.3, -90); const fi = flightInfo(s.sim); return fi.landing && Math.hypot(fi.landing.x - s.h.target.x, fi.landing.z - s.h.target.z) < 1.6; })());
}

console.log('--- direction-change risk');
{
  // a fast cross-court ball from the far side landing in the near deuce corner; reply back along its line (cross) vs down the line
  const spread = (replyX, n = 40) => {
    const xs = [], dk = [], dc = [], miss = [];
    for (let s = 0; s < n; s++) {
      const sim = mkSim({ seed: 100 + s, timeScale: 1 });
      sim.setLag(0, 0);
      sim.debugFeed(1, { from: { x: -3.2, y: 1, z: -12.4 }, target: { x: 3.0, z: HALF - 2.6 }, speedKmh: 128, topRpm: 1500 });
      stepWhile(sim, () => !sim.P[0].plan);
      const t = sim.timingForAim(0, replyX);
      const r = swingAt(sim, 0, t, { power: 0.6 });
      if (!r || !r.hit) { miss.push(1); continue; }
      const fi = flightInfo(sim.sim || sim);
      dk.push(r.hit.dirK); dc.push(r.hit.dirChange);
      if (fi.landing) xs.push(fi.landing.x - r.hit.target.x);
    }
    return { dk: mean(dk), dc: mean(dc), sd: sd(xs), n: xs.length, miss: miss.length };
  };
  const cc = spread(-2.6), dtl = spread(3.4);
  console.log(`  cross-court reply: dirChange ${f1(cc.dc)} deg, scatter factor x${f2(cc.dk)}, landing sd ${f2(cc.sd)} m (n=${cc.n})   down the line: ${f1(dtl.dc)} deg, x${f2(dtl.dk)}, sd ${f2(dtl.sd)} m (n=${dtl.n})`);
  check('changing direction (down the line off a fast cross-court ball) has a larger angle change', dtl.dc > cc.dc + 10);
  check('...and a larger scatter multiplier (>= x1.25 vs <= x1.1 for the neutral reply)', dtl.dk >= 1.25 && cc.dk <= 1.1, `x${f2(dtl.dk)} vs x${f2(cc.dk)}`);
  const slow = (() => { const sim = mkSim({ seed: 5, timeScale: 1 }); sim.setLag(0, 0); sim.debugFeed(1, { from: { x: -3.2, y: 1, z: -12.4 }, target: { x: 3.0, z: HALF - 2.6 }, speedKmh: 70, topRpm: 1500 }); stepWhile(sim, () => !sim.P[0].plan); return swingAt(sim, 0, sim.timingForAim(0, 3.4), { power: 0.6 }).hit; })();
  check('the penalty scales with the incoming pace (slow ball: smaller multiplier)', slow && slow.dirK < dtl.dk, `x${slow ? f2(slow.dirK) : '-'}`);
}

console.log('--- graceful mistimes');
{
  const hits = [-240, -200, -160, 130, 175].map((off) => { const g = go(0, 1.5, off, { seed: 11 }); return [off, g.h, g.sim.log.find((e) => e.type === 'whiff')]; });
  console.log('  ' + hits.map(([off, h]) => `${off}: ${h ? h.timing + ' q=' + f2(h.quality) : 'whiff'}`).join('   '));
  check('mistimed balls beyond T_FULL are still struck (weak and wide), not whiffed (early to 240 ms, late to 175 ms = T_MISS_LATE)', hits.every(([, h]) => !!h));
  const good = go(0, 1.5, 0, { seed: 11 }).h;
  check('...weaker than a good hit', hits.every(([, h]) => h.quality < good.quality - 0.05), `q good ${f2(good.quality)}`);
  const w = [-300, 200].map((off) => go(0, 1.5, off, { seed: 11 }));
  check('whiffs only beyond T_MISS / T_MISS_LATE (-300 / +200 ms)', w.every((g) => !g.h));
  // quality factors
  const q = (o) => { const g = go(0, o.bx ?? 1.0, 0, o); return g.h ? g.h.quality : 0; };
  const qSet = q({ seed: 4 }), qFast = q({ seed: 4, kmh: 150 }), qWide = q({ seed: 4, bx: 3.6 });
  console.log(`  quality: set ${f2(qSet)}, fast ball ${f2(qFast)}, wide (stretched) ${f2(qWide)}`);
  check('quality falls with incoming pace', qFast < qSet - 0.03);
  check('quality falls when stretched wide', qWide < qSet - 0.05);
  const heavy = (shot) => { const g = go(0, 1.0, 0, { seed: 4, topRpm: 4200, kmh: 90, shot, depth: 3.2 }); return g.h ? g.h : null; };
  const hT = heavy('topspin'), hS = heavy('slice');
  const light = go(0, 1.0, 0, { seed: 4, topRpm: 300, kmh: 90 }).h;
  console.log(`  heavy topspin incoming: topspin reply q=${hT ? f2(hT.quality) : '-'} (contact h ${hT ? f2(hT.contact.h) : '-'}), slice reply q=${hS ? f2(hS.quality) : '-'}, light incoming q=${light ? f2(light.quality) : '-'}`);
  check('heavy incoming topspin lowers the quality of a topspin reply vs a light ball', hT && light && hT.quality <= light.quality + 0.001);
}

console.log('--- timing -> target x is symmetric in effect (aimPreview, 95 km/h topspin ball; x in m, x = out of the singles lines)');
{
  const TS = [-200, -150, -140, -100, -50, 0, 50, 100, 130, 150];
  const rows = {};
  for (const [name, bx, hand] of [['middle fh', 0.2, 'R'], ['wide fh', 2.8, 'R'], ['wide bh', -2.6, 'R'], ['left-hander middle fh', -0.2, 'L']]) {
    const sim = mkSim({ seed: 7, timeScale: 1, hand0: hand }); sim.setLag(0, 0); sim.P[0].perceive = 0; sim.debugPlace(0, 0, 12.65);
    sim.debugFeed(1, { from: { x: 0, y: 1, z: -12.4 }, target: { x: bx, z: HALF - 3.2 }, speedKmh: 95, topRpm: 2500 });
    const pl = sim.P[0].plan;
    const out = TS.map((t) => sim.aimPreview(0, t));
    rows[name] = { pl, out };
    console.log(`  ${name.padEnd(22)} ${pl.side} pos ${f2(pl.P.x).padStart(5)} | ` + TS.map((t, k) => `${t}:${f1(out[k].x)}${out[k].inCourt ? '' : '\u2717'}`).join(' '));
  }
  const K = new ArcadeSim().K, iE = TS.indexOf(-140), iL = TS.indexOf(100);
  for (const [name, r] of Object.entries(rows)) {
    const early = r.out[iE], late = r.out[iL];
    const mirrored = name.startsWith('wide bh') ? -1 : 1;     // the backhand mirrors: pull = +x
    const pull = early.x * -mirrored * (name.startsWith('left') ? -1 : 1), push = late.x * mirrored * (name.startsWith('left') ? -1 : 1);
    check(`${name}: both full windows land in the singles court`, early.inCourt && late.inCourt, `${f2(early.x)} / ${f2(late.x)}`);
    if (name.endsWith('middle fh')) {
      check(`${name}: |x| >= 3.0 at t = -T_FULL_EARLY and +T_FULL_LATE`, Math.abs(early.x) >= 3.0 && Math.abs(late.x) >= 3.0, `${f2(early.x)} / ${f2(late.x)}`);
      check(`${name}: mirrored reach within 20 %`, Math.abs(Math.abs(early.x) - Math.abs(late.x)) <= 0.2 * Math.max(Math.abs(early.x), Math.abs(late.x)), `${f2(Math.abs(early.x))} vs ${f2(Math.abs(late.x))}`);
      const neutral = r.out[TS.indexOf(0)];
      check(`${name}: neutral timing aims at the middle (|x| <= 0.8)`, Math.abs(neutral.x) <= 0.8, f2(neutral.x));
    } else {
      check(`${name}: cross-court pull and down-the-line push both reach >= 2.8 m from the middle`, Math.abs(early.x) >= 2.8 && Math.abs(late.x) >= 2.8, `${f2(early.x)} / ${f2(late.x)}`);
    }
  }
  const a = rows['middle fh'].out, b = rows['left-hander middle fh'].out;
  check('left-hander is the exact mirror image of the right-hander', a.every((o, k) => Math.abs(o.x + b[k].x) < 0.25));
  check('beyond the full windows the ball is dragged wide (out)', !rows['middle fh'].out[TS.indexOf(150)].inCourt && !rows['middle fh'].out[TS.indexOf(130)].inCourt);
  const g = go(0, 0.2, 100, { seed: 11 }).h, g2 = go(0, 0.2, 0, { seed: 11 }).h;
  check('a +100 ms late swing is a clean hit with the same direction the preview promised (+-0.7 m)', g && g.timing !== 'wide' && g.mishit !== 'frame' && Math.abs(g.target.x - rows['middle fh'].out[TS.indexOf(100)].x) < 0.7, g ? `${g.timing}, target ${f2(g.target.x)}, q ${f2(g.quality)}` : 'no hit');
}
console.log('--- first-bounce apex of rally shots (solver-simulated apex of the ball centre after the first bounce, AI vs AI, all styles, level 0.6)');
{
  const by = {}, all = [];
  const styles = ['baseliner', 'attacker', 'netrusher', 'trickster'];
  for (let m = 0; m < 8; m++) {
    const sim = new ArcadeSim({ seed: 400 + m, timeScale: 0.8, format: { sets: 1, gamesPerSet: 2, tiebreak: true }, players: [{ human: false, ai: { level: 0.6, style: styles[m % 4] } }, { human: false, hand: m % 2 ? 'L' : 'R', ai: { level: 0.6, style: styles[(m + 1) % 4] } }] });
    let g = 0;
    while (sim.phase !== 'match-over' && g++ < 60 * 1500) {
      sim.step(1 / 60);
      for (const e of sim.drainEvents()) if (e.type === 'hit' && !e.serve && e.bounceApex != null && e.bounceApex > 0.1) { (by[e.shot] = by[e.shot] || []).push(e.bounceApex); all.push(e.bounceApex); }
    }
  }
  const pc = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const row = (n, a) => `  ${n.padEnd(8)} n=${String(a.length).padStart(4)}  p10 ${f2(pc(a, 0.1))}  p50 ${f2(pc(a, 0.5))}  p90 ${f2(pc(a, 0.9))}  p95 ${f2(pc(a, 0.95))}  max ${f2(Math.max(...a))}`;
  console.log(row('all', all)); for (const [k, a] of Object.entries(by)) if (a.length > 8) console.log(row(k, a));
  check('bounce apex p50 in 1.1-1.6 m, p95 <= 2.2 m', pc(all, 0.5) >= 1.1 && pc(all, 0.5) <= 1.6 && pc(all, 0.95) <= 2.2, `p50 ${f2(pc(all, 0.5))}, p95 ${f2(pc(all, 0.95))}`);
  check('topspin keeps a clear contrast with slice (median apex higher)', pc(by.topspin, 0.5) > pc(by.slice || [0], 0.5) + 0.3);
  const nl = Object.entries(by).filter(([k]) => k !== 'lob').flatMap(([, a]) => a);
  check('no groundstroke bounce above 2.3 m; lobs / moonballs <= 2.4 m', Math.max(...nl) <= 2.3 && Math.max(...(by.lob || [0])) <= 2.4, `${f2(Math.max(...nl))} / ${f2(Math.max(...(by.lob || [0])))}`);
}
console.log('--- hint.side / plan');
{
  const sim = mkSim({ seed: 3, timeScale: 1 });
  sim.debugFeed(1, { target: { x: -2.5, z: HALF - 3 }, speedKmh: 98 });
  sim.step(0.01);
  const pl = sim.state.players[0].plan;
  check('state.players[i].plan exposes side/sideLocked/kind/tContact/contact', pl && pl.side && pl.sideLocked === false && pl.kind && Number.isFinite(pl.tContact) && Number.isFinite(pl.contact.x), pl ? `${pl.side} locked=${pl.sideLocked}` : 'null');
  check('hint.side is available immediately, hint.sideLocked starts false', sim.state.hint.side === pl.side && sim.state.hint.sideLocked === false);
}
console.log('--- lab API: setTuning / getTuning / feed / predict / aimPreview');
{
  const sim = new ArcadeSim({ seed: 2, timeScale: 1, players: [{ human: true, name: 'lab' }, { human: true, name: 'machine' }] }); sim.log = [];
  const scoreBefore = JSON.stringify(sim.state.match.points);
  sim.setTuning({ liftGain: 2.2, T_FULL: 0.2, G_T: 11, timeScale: 1 });
  const g = sim.getTuning();
  check('getTuning reflects setTuning (gains, windows, remote window follows)', g.liftGain === 2.2 && g.T_FULL === 0.2 && g.G_T === 11 && sim.ft.liftGain === 2.2 && Math.abs(g.REMOTE.T_MISS - (g.T_MISS + 0.035)) < 1e-9 && g.timeScale === 1);
  sim.setTuning({ liftGain: 1.8, T_FULL: 0.15, G_T: 9 });
  const info = sim.feed({ from: { x: -1, z: -12.4 }, target: { x: 2, z: 9.5 }, kmh: 105, topRpm: 2800, sideRpm: -900, shot: 'topspin' });
  check('feed launches a ball into the human half and returns the solved landing', info.ok && Math.hypot(info.landing.x - 2, info.landing.z - 9.5) < 0.4 && Math.abs(info.curveM) > 0.3, `curve ${f2(info.curveM)} m`);
  const pr = sim.predict(0);
  check('predict(0) gives the path, landing and the planned contact (side, kind)', pr.path.length > 30 && pr.landing && pr.contact && pr.contact.side && pr.contact.kind === 'ground' && Number.isFinite(pr.contact.t), pr.contact ? `${pr.contact.side} t=${f2(pr.contact.t)}` : 'null');
  check('predict is cached per plan (same object until re-planned)', sim.predict(0) === pr);
  const ap = sim.aimPreview(0, -60);
  check('aimPreview returns target x/z, psi, curve sign, no side effects', ap && Number.isFinite(ap.x) && ap.z < 0 && Number.isFinite(ap.psi) && (ap.curveSign === 1 || ap.curveSign === -1) && sim.state.players[0].plan.sideLocked !== undefined);
  const r = swingAt(sim, 0, 0, { power: 0.6 });
  check('the human plays the fed ball like a rally ball', r && r.hit && r.hit.by === 0);
  let g2 = 0; while (sim.rl.live && g2++ < 900) sim.step(1 / 120);
  const ev = sim.drainEvents();
  check('the point ends without scoring (event point{lab:true, winner:null}, score untouched)', ev.some((e) => e.type === 'point' && e.lab) && JSON.stringify(sim.state.match.points) === scoreBefore);
  const again = sim.feed({ target: { x: -2, z: 9 }, kmh: 90, shot: 'slice' });
  check('feed can be repeated right away (slice and lob variants too)', again.ok && sim.feed({ kmh: 80, shot: 'lob', target: { x: 0, z: 9 } }).landing !== null);
}
console.log(`\n(shot tests took ${((Date.now() - T0) / 1000).toFixed(1)} s)`);
finish();
