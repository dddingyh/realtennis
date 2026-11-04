// v4: game speed (timeScale) and contact-dependent stroke variants (DESIGN §7.1, §7.3). Run: node tests/sim_v4.mjs
import { Simulation, DEFAULT_TIME_SCALE } from '../src/game/simulation.js';
import { computeHit, classifyContact, contactGeometry } from '../src/game/shot.js';
import { simulateTrajectory } from '../src/physics/ball.js';
import { attachKeyboard } from '../src/input/keyboard.js';
import { RNG } from '../src/game/rng.js';
import { COURT } from '../src/config.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 2) => (x == null ? 'n/a' : x.toFixed(n));
const T = { pointOver: 0.3, changeover: 0.3, aiServeDelay: [0.1, 0.2], walkDelay: 0.05, faultHold: 0.2, matchOver: 0.2 };

console.log('timeScale (game speed)');
{
  check('default game speed is 0.85', DEFAULT_TIME_SCALE === 0.85 && new Simulation({}).timeScale === 0.85 && new Simulation({}).state.timeScale === 0.85);
  const s = new Simulation({ timeScale: 0.7, seed: 1, timing: T });
  for (let i = 0; i < 120; i++) s.step(1 / 120);
  check('step(realDt) advances realDt x timeScale', Math.abs(s.time - 0.7) < 1e-9, f(s.time, 4));
  s.setTimeScale(5); check('setTimeScale clamps', s.timeScale === 1.0);
  s.setTimeScale(0.8); check('setTimeScale applies', s.timeScale === 0.8 && s.state.timeScale === 0.8);
  // the same serve at different game speeds: same km/h, longer real flight
  const serve = (ts) => {
    const sim = new Simulation({ timeScale: ts, seed: 4, timing: T, firstServer: 0, autoMove: ['off', 'off'] });
    let g = 0; while (!sim.serverReady(0) && g++ < 5000) sim.step(1 / 120);
    sim.swing(0, { shot: 'flat', power: 0.85, source: 'remote' });
    let ev = null, hitStep = 0, bounceStep = 0;
    for (let k = 0; k < 2000; k++) {
      sim.step(1 / 120);
      for (const e of sim.drainEvents()) { if (e.type === 'serve' && !ev) { ev = e; hitStep = k; } if (e.type === 'bounce' && ev && !bounceStep && !e.dribble) bounceStep = k; }
      if (bounceStep) break;
    }
    return { kmh: ev.speedKmh, realFlight: (bounceStep - hitStep) / 120 };
  };
  const a = serve(1.0), b = serve(0.7);
  check('displayed serve speed stays real-world (km/h unchanged)', Math.abs(a.kmh - b.kmh) / a.kmh < 0.02, `${f(a.kmh, 0)} vs ${f(b.kmh, 0)} km/h`);
  check('the ball takes 1/timeScale longer in real time', Math.abs(b.realFlight / a.realFlight - 1 / 0.7) < 0.12, `${f(a.realFlight, 3)} s -> ${f(b.realFlight, 3)} s`);
  // remote ageMs is real time
  const sim = new Simulation({ timeScale: 0.8, seed: 2, timing: T });
  check('remote ageMs (real ms) is converted to sim ms', Math.abs(sim._normSwing({ ageMs: 100, source: 'remote' }, sim.players[0]).ageMs - 80) < 1e-9);
  // keyboard hold time stays real
  const sk = new Simulation({ timeScale: 0.7, seed: 3, timing: T, autoMove: ['off', 'off'] });
  const tgt = new EventTarget(); let clock = 0;
  attachKeyboard(sk, 0, tgt, { now: () => clock });
  for (let i = 0; i < 1200 && !sk.canServe(sk.match.server); i++) sk.step(1 / 120);
  sk._setPhase('rally'); sk.rally.shots = 5; sk.rally.lastHitTime = sk.time;
  for (const p of sk.players) p.walkTarget = null;
  const p0 = sk.players[0]; p0.pos.x = 0; p0.pos.z = 12.4;
  const bl = sk.ball; Object.assign(bl.pos, { x: 0.8, y: 1.55, z: 8 }); Object.assign(bl.vel, { x: 0, y: 0, z: 20 }); Object.assign(bl.spin, { x: 0, y: 0, z: 0 }); bl.inPlay = true; bl.lastHitBy = 1; bl.bounces = 1;
  const key = (type, code) => { const e = new Event(type); e.code = code; e.repeat = false; tgt.dispatchEvent(e); };
  key('keydown', 'KeyK');
  while (contactGeometry(p0, bl).tEarly > 0.004) sk.step(1 / 120);
  clock = 0.5; key('keyup', 'KeyK');
  const h = sk.drainEvents().find((e) => e.type === 'hit');
  check('keyboard hold-time power uses real time (0.5 s hold => 0.875 regardless of game speed)', h && Math.abs(h.power - 0.875) < 1e-6, h && f(h.power, 3));
  // whole matches at both ends of the range
  for (const ts of [0.7, 1.0]) {
    const m = new Simulation({ timeScale: ts, aiPlayers: [true, true], aiStyles: ['grinder', 'aggressive'], seed: 9, timing: T, format: { sets: 1, gamesPerSet: 3, tiebreak: true } });
    let n = 0; while (m.state.match.phase !== 'match-over' && n++ < 120 * 3000) m.step(1 / 120);
    const st = m.state.match.stats;
    check(`AI vs AI match completes at timeScale ${ts}`, m.state.match.phase === 'match-over', `${st.totalPoints} pts, avg rally ${f(st.rallyShotsTotal / st.totalPoints, 1)}`);
  }
}

console.log('contact classification (§7.1)');
{
  const H = (o = {}) => ({ pos: { x: 0, z: 12.4 }, vel: { x: 0, z: 0 }, facing: 1, hand: 'R', ...o });
  const ball = (x, y, z = 11.9, v = 20) => ({ pos: { x, y, z }, vel: { x: 0, y: 0, z: v } });
  const c = (h, b, side) => classifyContact(h, b, side);
  check('comfortable ball = normal', c(H(), ball(0.8, 1.0)).variant === 'normal' && c(H(), ball(0.8, 1.0)).reachT === 0);
  const st = c(H(), ball(1.75, 0.9));
  check('ball at the edge of reach = stretch, reachT high', st.variant === 'stretch' && st.reachT > 0.6, `reachT ${f(st.reachT)}`);
  check('ball into the body = jammed', c(H(), ball(0.15, 1.0)).variant === 'jammed' && c(H(), ball(0.8, 1.0, 12.9)).variant === 'jammed');
  check('backhand side: lat measured toward the backhand', c(H(), ball(-0.8, 1.0)).side === 'bh' && c(H(), ball(-0.8, 1.0)).contact.lat > 0.7);
  check('hitting on the move = run', c(H({ vel: { x: 4, z: 0 } }), ball(0.8, 1.0)).variant === 'run');
  check('shoulder-high ball = high, very low ball = low', c(H(), ball(0.8, 1.7)).variant === 'high' && c(H(), ball(0.8, 0.3)).variant === 'low');
  check('deep behind the baseline vs a heavy ball = defensive', c(H({ pos: { x: 0, z: 15 } }), ball(0.8, 1.0, 14.5, 32)).variant === 'defensive');
  const lc = c(H({ hand: 'L' }), ball(-0.8, 1.0));
  check('left-hander: forehand is on the left', lc.side === 'fh' && lc.contact.lat > 0.7);
  const fc = c({ pos: { x: 0, z: -12.4 }, vel: { x: 0, z: 0 }, facing: -1, hand: 'R' }, ball(-0.8, 1.0, -11.9, -20));
  check('far player: local frame mirrored (fwd > 0 toward the net)', fc.side === 'fh' && fc.contact.fwd > 0.3, `fwd ${f(fc.contact.fwd)}`);
}

console.log('outcome follows the variant');
{
  const H = (o = {}) => ({ pos: { x: 0, z: 12.4 }, vel: { x: 0, z: 0 }, facing: 1, hand: 'R', stamina: 1, ...o });
  const B = (x, y, z = 11.9) => ({ pos: { x, y, z }, vel: { x: 0, y: -2, z: 20 }, spin: { x: 0, y: 0, z: 0 }, bounces: 1 });
  const run = (h, b, sw, n = 250) => {
    const rng = new RNG(77);
    const out = { kmh: 0, rpm: 0, mis: 0, frame: 0, err: 0, net: 0, xs: [], variant: null, width: 0 };
    for (let k = 0; k < n; k++) {
      const r = computeHit({ hitter: h, ball: b, swing: { power: 0.8, spin: 0.5, lift: 0.5, exec: 1, aimX: 0.9, source: 'remote', ...sw }, surface: 'hard', rng, timingEarlyMs: 0 });
      out.variant = r.variant; out.kmh += r.speedKmh / n; out.rpm += r.spinRpm / n; out.width += Math.abs(r.target.x) / n;
      if (r.mishit) { out.mis++; if (r.mishit === 'frame') out.frame++; }
      const t = simulateTrajectory({ pos: b.pos, vel: r.vel, spin: r.spin }, { surface: 'hard' });
      if (t.hitNet || (t.netClear !== null && t.netClear < 0)) { out.err++; out.net++; }
      else if (!t.landing || Math.abs(t.landing.x) > COURT.singlesHalfWidth || -t.landing.z > COURT.halfLength || t.landing.z > 0) out.err++;
      else out.xs.push(t.landing.x);
    }
    const m = out.xs.reduce((a, b2) => a + b2, 0) / out.xs.length;
    out.sd = Math.sqrt(out.xs.reduce((a, b2) => a + (b2 - m) ** 2, 0) / out.xs.length);
    return out;
  };
  const N = run(H(), B(0.8, 1.0));
  const S = run(H(), B(1.75, 1.0));
  check('stretch: less pace, less angle, more errors', S.variant === 'stretch' && S.kmh < N.kmh - 15 && S.width < N.width - 0.5 && S.err > N.err, `${f(S.kmh, 0)} vs ${f(N.kmh, 0)} km/h, width ${f(S.width)} vs ${f(N.width)}, errors ${S.err} vs ${N.err}`);
  check('stretch: less topspin (more defensive)', S.rpm < N.rpm - 300, `${f(S.rpm, 0)} vs ${f(N.rpm, 0)} rpm`);
  const J = run(H(), B(0.15, 1.0));
  check('jammed: little pace, mishit risk (frame shots)', J.variant === 'jammed' && J.kmh < N.kmh - 15 && J.mis > N.mis + 10 && J.frame > 0, `${f(J.kmh, 0)} km/h, mishits ${J.mis} (frame ${J.frame}) vs ${N.mis}`);
  const R = run(H({ vel: { x: 4.2, z: 0 } }), B(0.8, 1.0));
  check('run: less accurate (more scatter/errors) but pace kept when not retreating', R.variant === 'run' && (R.sd > N.sd || R.err > N.err) && R.kmh > N.kmh * 0.8, `sd ${f(R.sd)} vs ${f(N.sd)}, errors ${R.err} vs ${N.err}, ${f(R.kmh, 0)} km/h`);
  const Hi = run(H(), B(0.8, 1.85)), HiIn = run(H({ pos: { x: 0, z: 10.4 } }), B(0.8, 1.85, 9.9));
  check('high ball at the baseline: flatter / weaker (topspin & pace reduced)', Hi.variant === 'high' && Hi.kmh < N.kmh - 8 && Hi.rpm < N.rpm - 200, `${f(Hi.kmh, 0)} km/h ${f(Hi.rpm, 0)} rpm vs ${f(N.kmh, 0)} / ${f(N.rpm, 0)}`);
  check('...unless the player steps in (inside the baseline)', HiIn.kmh > Hi.kmh + 5, `${f(HiIn.kmh, 0)} vs ${f(Hi.kmh, 0)} km/h`);
  const LoTop = run(H(), B(0.8, 0.3), { spin: 0.8, lift: 0.15 }), LoSl = run(H(), B(0.8, 0.3), { spin: -0.8, lift: 0.15 }), LoLift = run(H(), B(0.8, 0.3), { spin: 0.8, lift: 0.8 });
  check('low ball: flat-path topspin goes into the net; slice copes; lift fixes it', LoTop.variant === 'low' && LoTop.net > LoSl.net && LoTop.net > LoLift.net, `net: topspin/low-lift ${LoTop.net}, slice ${LoSl.net}, topspin/high-lift ${LoLift.net}`);
  const D = run(H({ pos: { x: 0, z: 15 } }), { pos: { x: 0.8, y: 1.0, z: 14.5 }, vel: { x: 0, y: -2, z: 32 }, spin: { x: 0, y: 0, z: 0 }, bounces: 1 });
  check('defensive: safer, slower reset ball', D.variant === 'defensive' && D.kmh < N.kmh, `${f(D.kmh, 0)} km/h`);
}

console.log('animation contract');
{
  const sim = new Simulation({ aiPlayers: [true, true], aiStyles: ['grinder', 'aggressive'], seed: 21, timing: T, format: { sets: 1, gamesPerSet: 2, tiebreak: true } });
  let planned = 0, plannedWithContact = 0, hits = 0, hitsWithContact = 0, agree = 0, compare = 0;
  const lastPlanned = [null, null];
  const variants = {};
  for (let n = 0; n < 120 * 600 && sim.state.match.phase !== 'match-over'; n++) {
    sim.step(1 / 120);
    for (let i = 0; i < 2; i++) {
      const a = sim.players[i].anim;
      if (a.name === 'swing' && a.phase < 0.5) { planned++; if (a.contact && typeof a.contact.lat === 'number' && a.variant) { plannedWithContact++; lastPlanned[i] = a.variant; } }
    }
    for (const e of sim.drainEvents()) if (e.type === 'hit' && !e.serve) {
      hits++; const a = sim.players[e.by].anim;
      if (a.contact && a.variant === e.variant && typeof a.reachT === 'number') hitsWithContact++;
      variants[e.variant] = (variants[e.variant] || 0) + 1;
      if (lastPlanned[e.by]) { compare++; if (lastPlanned[e.by] === e.variant) agree++; lastPlanned[e.by] = null; }
    }
  }
  check('AI shows a backswing with the PLANNED contact before hitting', planned > 50 && plannedWithContact / planned > 0.9, `${plannedWithContact}/${planned} frames`);
  check('at contact anim.contact / variant / reachT match the hit', hits > 20 && hitsWithContact === hits, `${hitsWithContact}/${hits}`);
  check('planned variant usually matches the actual one', compare > 20 && agree / compare > 0.6, `${agree}/${compare}`);
  check('several variants occur in real rallies', Object.keys(variants).length >= 4, JSON.stringify(variants));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
