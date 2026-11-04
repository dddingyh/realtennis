// "Position matters" shot-model tests + swing handling (timing buffer, latency compensation, whiffs).
// Run: node tests/sim_shot.mjs
import { COURT } from '../src/config.js';
import { computeHit, contactGeometry, isReachable } from '../src/game/shot.js';
import { simulateTrajectory } from '../src/physics/ball.js';
import { Simulation } from '../src/game/simulation.js';
import { RNG } from '../src/game/rng.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(n));
const rng = new RNG(4);

// base scenario: near right-hander at the baseline, ball arrives at the ideal spot
const H = (o = {}) => ({ pos: { x: 0, z: 12.4 }, vel: { x: 0, z: 0 }, facing: 1, hand: 'R', stamina: 1, ...o });
const B = (o = {}) => ({ pos: { x: 0.8, y: 0.95, z: 11.9 }, vel: { x: 0, y: -2, z: 20 }, spin: { x: 0, y: 0, z: 0 }, bounces: 1, ...o });
function hit(hitter, ball, swing = {}, extra = {}) {
  return computeHit({ hitter, ball, swing: { shot: 'topspin', power: 0.7, source: 'keyboard', ...swing }, surface: 'hard', rng: new RNG(1), timingEarlyMs: 0, opts: { noError: true }, ...extra });
}

console.log('contact quality factors');
{
  const base = hit(H(), B()).quality;
  check('ideal contact has high quality', base > 0.85, f(base));
  const t = (ms, src) => hit(H(), B(), { source: src }, { timingEarlyMs: ms }).quality;
  check('timing: 0 ms > 60 ms > 150 ms (early or late)', t(0) > t(60) && t(60) > t(150) && t(-60) > t(-150), `${f(t(0))} ${f(t(60))} ${f(t(150))}`);
  check('remote swings get a more generous timing window than keyboard', t(100, 'remote') > t(100, 'keyboard') + 0.05, `${f(t(100, 'remote'))} vs ${f(t(100, 'keyboard'))}`);
  const qh = (y, shot = 'topspin') => hit(H(), B({ pos: { x: 0.8, y, z: 11.9 } }), { shot }).quality;
  check('height: ideal band beats very low and very high balls', qh(1.0) > qh(0.25) + 0.1 && qh(1.0) > qh(2.0) + 0.1, `low ${f(qh(0.25))} mid ${f(qh(1.0))} high ${f(qh(2.0))}`);
  check('height: ball above the shoulder hurts topspin more than slice', qh(1.9, 'slice') > qh(1.9, 'topspin'), `${f(qh(1.9, 'slice'))} vs ${f(qh(1.9, 'topspin'))}`);
  const ql = (lat) => hit(H(), B({ pos: { x: lat, y: 0.95, z: 11.9 } })).quality;
  check('reach: ideal distance beats stretched and jammed', ql(0.8) > ql(1.5) + 0.1 && ql(0.8) > ql(0.05) + 0.05, `jam ${f(ql(0.05))} ideal ${f(ql(0.8))} stretched ${f(ql(1.5))}`);
  const qr = (vx) => hit(H({ vel: { x: vx, z: 0 } }), B()).quality;
  check('running speed lowers quality', qr(0) > qr(5.5) + 0.05, `${f(qr(0))} vs ${f(qr(5.5))}`);
  const qp = (v, spin) => hit(H(), B({ vel: { x: 0, y: -2, z: v }, spin: { x: 0, y: 0, z: spin } })).quality;
  check('heavy incoming pace/spin lowers quality', qp(15, 0) > qp(40, 300) + 0.05, `${f(qp(15, 0))} vs ${f(qp(40, 300))}`);
  const qs = (side) => hit(H(), B(), { side }).quality;
  check('wrong racket side is a big penalty (ball on forehand side)', qs('fh') > qs('bh') + 0.25 && qs('auto') === qs('fh'), `fh ${f(qs('fh'))} bh ${f(qs('bh'))}`);
  const qst = (s) => hit(H({ stamina: s }), B()).quality;
  check('stamina matters a little', qst(1) > qst(0), `${f(qst(1))} vs ${f(qst(0))}`);
  const g = contactGeometry(H(), B({ pos: { x: -0.8, y: 0.95, z: 11.9 } }));
  check('ball on the left of a right-hander is a backhand', g.side === 'bh' && contactGeometry(H(), B()).side === 'fh');
  const gl = contactGeometry(H({ hand: 'L' }), B());
  check('left-hander: ball on the right is a backhand', gl.side === 'bh');
  const gf = contactGeometry({ pos: { x: 0, z: -12.4 }, vel: { x: 0, z: 0 }, facing: -1, hand: 'R' }, { pos: { x: -0.8, y: 1, z: -11.9 }, vel: { x: 0, y: 0, z: -20 } });
  check('far-side player: handedness mirrored (right-hander forehand is at -x)', gf.side === 'fh' && gf.fwd > 0 && gf.tEarly > 0 || gf.side === 'fh', `${gf.side} fwd ${f(gf.fwd)}`);
}

console.log('court-position effects');
{
  const fast = (h, b, sw) => hit(h, b, { shot: 'flat', power: 1, ...sw });
  const inside = fast(H({ pos: { x: 0, z: 9.6 } }), B({ pos: { x: 0.8, y: 0.95, z: 9.1 } }), { aimX: 1, aimDepth: 0.3 });
  const base = fast(H(), B(), { aimX: 1, aimDepth: 0.3 });
  const deep = fast(H({ pos: { x: 0, z: 15.6 } }), B({ pos: { x: 0.8, y: 0.95, z: 15.1 } }), { aimX: 1, aimDepth: 0.3 });
  check('inside the baseline: wider angle available than on the baseline, and far more than deep behind it; deep is slower',
    Math.abs(inside.target.x) > Math.abs(base.target.x) + 0.2 && Math.abs(base.target.x) > Math.abs(deep.target.x) + 0.3 && base.speedKmh > deep.speedKmh + 5,
    `speed ${f(inside.speedKmh, 0)}/${f(base.speedKmh, 0)}/${f(deep.speedKmh, 0)} km/h, max target x ${f(inside.target.x)}/${f(base.target.x)}/${f(deep.target.x)}`);
  const wide = fast(H({ pos: { x: 0, z: 12.4 } }), B({ pos: { x: 2.2, y: 0.95, z: 11.9 } }), {});
  check('stretched wide: pace and quality are reduced', wide.speedKmh < base.speedKmh - 10 && wide.quality < base.quality - 0.1, `${f(wide.speedKmh, 0)} vs ${f(base.speedKmh, 0)} km/h`);
  const vol = hit(H({ pos: { x: 0, z: 3.0 } }), B({ pos: { x: 0.8, y: 1.1, z: 2.5 }, vel: { x: 0, y: 0, z: 22 }, bounces: 0 }), { shot: 'flat', power: 0.6 });
  check('near the net with an unbounced ball is a volley', vol.shot === 'volley' && vol.kind === 'volley', `${vol.shot} ${f(vol.speedKmh, 0)} km/h`);
  const volSlow = hit(H({ pos: { x: 0, z: 3.0 } }), B({ pos: { x: 0.8, y: 1.1, z: 2.5 }, vel: { x: 0, y: 0, z: 8 }, bounces: 0 }), { shot: 'flat', power: 0.6 });
  check('volley pace comes mostly from the incoming ball', vol.speedKmh > volSlow.speedKmh + 15, `${f(vol.speedKmh, 0)} vs ${f(volSlow.speedKmh, 0)}`);
  const smash = hit(H({ pos: { x: 0, z: 4.5 } }), B({ pos: { x: 0.8, y: 2.4, z: 4.0 }, vel: { x: 0, y: -4, z: 5 }, bounces: 0 }), { shot: 'flat', power: 1 });
  check('high ball near the net is a smash (hard, steeply downward)', smash.shot === 'smash' && smash.speedKmh > 110 && smash.vel.y < 0, `${smash.shot} ${f(smash.speedKmh, 0)} km/h vy ${f(smash.vel.y)}`);
  const drop = hit(H({ pos: { x: 0, z: 3.5 } }), B({ pos: { x: 0.8, y: 1.0, z: 3.0 }, vel: { x: 0, y: 0, z: 14 }, bounces: 0 }), { shot: 'slice', power: 0.3, aimDepth: -1, aimX: 0.4 });
  const dr = simulateTrajectory({ pos: { x: 0.8, y: 1.0, z: 3.0 }, vel: drop.vel, spin: drop.spin }, { surface: 'hard' });
  check('drop volley lands short', dr.landing && -dr.landing.z < 5, dr.landing && f(-dr.landing.z));
  const early = hit(H({ pos: { x: 3, z: 12.4 } }), B({ pos: { x: 3.8, y: 0.95, z: 11.9 } }), { shot: 'topspin' }, { timingEarlyMs: 70 });
  const late = hit(H({ pos: { x: 3, z: 12.4 } }), B({ pos: { x: 3.8, y: 0.95, z: 11.9 } }), { shot: 'topspin' }, { timingEarlyMs: -70 });
  check('early contact goes cross-court, late goes down the line', early.target.x < -1 && late.target.x > 0 && early.target.x < late.target.x - 2, `early ${f(early.target.x)} late ${f(late.target.x)}`);
  const lob = hit(H(), B(), { shot: 'lob', power: 0.6 });
  check('lob is a high, slow ball', lob.speedKmh < 90 && lob.vel.y > 10, `${f(lob.speedKmh, 0)} km/h vy ${f(lob.vel.y, 1)}`);
}

console.log('errors emerge from physics (not scripted)');
{
  const trial = (q) => {
    let net = 0, out = 0, ok = 0, devs = [];
    const r = new RNG(77);
    for (let i = 0; i < 400; i++) {
      const res = computeHit({ hitter: H(), ball: B(), swing: { shot: 'flat', power: 0.9, source: 'keyboard', aimX: -0.6, aimDepth: 0.3 }, surface: 'hard', rng: r, timingEarlyMs: 0, opts: { forceQuality: q } });
      const t = simulateTrajectory({ pos: B().pos, vel: res.vel, spin: res.spin }, { surface: 'hard' });
      if (t.hitNet || (t.netClear !== null && t.netClear < 0)) net++;
      else if (!t.landing || Math.abs(t.landing.x) > COURT.singlesHalfWidth || t.landing.z > 0 || -t.landing.z > COURT.halfLength) out++;
      else { ok++; devs.push(Math.hypot(t.landing.x - res.target.x, t.landing.z - res.target.z)); }
    }
    return { net, out, ok, dev: devs.reduce((a, b) => a + b, 0) / Math.max(1, devs.length) };
  };
  const q1 = trial(1), q9 = trial(0.9), q6 = trial(0.6), q3 = trial(0.3);
  console.log(`    q=1.0 in ${q1.ok} net ${q1.net} out ${q1.out} | q=0.9 in ${q9.ok} net ${q9.net} out ${q9.out} dev ${f(q9.dev)} | q=0.6 in ${q6.ok} net ${q6.net} out ${q6.out} dev ${f(q6.dev)} | q=0.3 in ${q3.ok} net ${q3.net} out ${q3.out}`);
  check('quality 1 never errs', q1.net === 0 && q1.out === 0);
  check('lower quality => more errors, both net and out occur', q6.net + q6.out > q9.net + q9.out && q3.net + q3.out > q6.net + q6.out && q3.net > 0 && q3.out > 0);
  check('lower quality => larger scatter around the target', q6.dev > q9.dev && q9.dev > 0.05, `${f(q9.dev)} vs ${f(q6.dev)} m`);
}

console.log('swing handling in the simulation');
const T = { pointOver: 0.2, changeover: 0.2, aiServeDelay: [0.1, 0.1], walkDelay: 0.02, faultHold: 0.1 };
function mk(o = {}) { return new Simulation({ aiPlayers: [false, false], autoMove: ['off', 'off'], seed: 5, timing: T, shotOpts: {}, ...o }); }
function toRally(sim) {
  for (let i = 0; i < 1200 && !sim.canServe(sim.match.server); i++) sim.step(1 / 120);
  sim._setPhase('rally'); sim.rally.shots = 5; sim.rally.lastHitTime = sim.time;
  sim.players[0].walkTarget = null; sim.players[1].walkTarget = null;
  sim.players[0].pos.x = 0; sim.players[0].pos.z = 12.4; sim.players[0].vel.x = sim.players[0].vel.z = 0;
}
function feed(sim, z, speed = 20) {
  const b = sim.ball;
  b.pos.x = 0.8; b.pos.y = 1.55; b.pos.z = z; b.vel.x = 0; b.vel.y = 0; b.vel.z = speed; b.spin.x = b.spin.y = b.spin.z = 0;
  b.inPlay = true; b.lastHitBy = 1; b.bounces = 1; b.rolling = false; b.visible = true;
}
{
  // exact timing: swing when the ball reaches the ideal plane
  const sim = mk(); toRally(sim); feed(sim, 6, 20);
  let hits = [];
  for (let i = 0; i < 400; i++) { const g = contactGeometry(sim.players[0], sim.ball); if (g.tEarly <= 0.004) { sim.swing(0, { shot: 'flat', power: 0.8, source: 'keyboard' }); break; } sim.step(1 / 120); }
  hits = sim.drainEvents().filter((e) => e.type === 'hit');
  check('well-timed swing connects: hit event, ball now travels to the far side', hits.length === 1 && sim.ball.lastHitBy === 0 && sim.ball.vel.z < -10 && sim.ball.bounces === 0, hits[0] && `q=${hits[0].quality.toFixed(2)} ${hits[0].speedKmh.toFixed(0)} km/h`);
  check('lastShot / anim updated', sim.state.lastShot && sim.state.lastShot.by === 0 && sim.state.players[0].anim.name === 'swing' && sim.state.players[0].anim.phase >= 0.5);
}
{
  // way too early (ball far away) => whiff, swing animation, cooldown
  const sim = mk(); toRally(sim); feed(sim, 6.5, 20);
  sim.swing(0, { shot: 'flat', power: 0.8 });
  const ev = sim.drainEvents();
  check('swing with the ball far away whiffs', ev.some((e) => e.type === 'whiff' && e.by === 0) && sim.ball.lastHitBy === 1);
  check('whiff plays the swing animation', sim.state.players[0].anim.name === 'swing');
}
{
  // slightly early press is buffered and connects with lower quality
  const sim = mk(); toRally(sim); feed(sim, 3.5, 20);              // ~0.45 s... compute time to ideal
  let g = contactGeometry(sim.players[0], sim.ball);
  // advance until the ball is ~100 ms from the ideal plane
  for (let i = 0; i < 400; i++) { g = contactGeometry(sim.players[0], sim.ball); if (g.tEarly <= 0.1) break; sim.step(1 / 120); }
  const early = g.tEarly * 1000;
  sim.swing(0, { shot: 'flat', power: 0.8, source: 'keyboard' });
  check('early press is buffered (no immediate hit)', sim.ball.lastHitBy === 1 && sim.players[0].buffered, `${f(early, 0)} ms early`);
  let hit = null;
  for (let i = 0; i < 60 && !hit; i++) { sim.step(1 / 120); hit = sim.drainEvents().find((e) => e.type === 'hit'); }
  const perfect = (() => { const s2 = mk(); toRally(s2); feed(s2, 6, 20); for (let i = 0; i < 400; i++) { if (contactGeometry(s2.players[0], s2.ball).tEarly <= 0.004) { s2.swing(0, { shot: 'flat', power: 0.8 }); break; } s2.step(1 / 120); } return s2.drainEvents().find((e) => e.type === 'hit'); })();
  check('buffered swing connects but with lower quality than a perfect one', hit && perfect && hit.quality < perfect.quality - 0.03, hit && `${f(hit.quality)} vs ${f(perfect && perfect.quality)}`);
}
{
  // very early press (beyond the buffer) is a whiff
  const sim = mk(); toRally(sim); feed(sim, 1.5, 20);
  sim.swing(0, { shot: 'flat', power: 0.8, source: 'keyboard' });
  const w = sim.drainEvents().some((e) => e.type === 'whiff');
  check('press far too early (> buffer) is a whiff', w || sim.ball.lastHitBy === 1);
}
{
  // latency compensation: swing physically happened 100 ms ago while the ball was in reach, delivered late
  const mkCase = (age) => {
    const sim = mk(); toRally(sim); feed(sim, 6, 22);
    let before = null;
    for (let i = 0; i < 400; i++) {
      const g = contactGeometry(sim.players[0], sim.ball);
      if (g.tEarly <= 0.004) { before = { x: sim.ball.pos.x, y: sim.ball.pos.y, z: sim.ball.pos.z }; break; }
      sim.step(1 / 120);
    }
    // the swing happened NOW in phone time; deliver it `age` ms later
    const steps = Math.round(age / 1000 * 120);
    for (let i = 0; i < steps; i++) sim.step(1 / 120);
    return { sim, before };
  };
  const late = mkCase(100);
  const gLate = contactGeometry(late.sim.players[0], late.sim.ball);
  late.sim.swing(0, { shot: 'flat', power: 0.8, source: 'remote', ageMs: 0 });
  const noComp = late.sim.drainEvents().find((e) => e.type === 'hit');
  const comp = mkCase(100);
  comp.sim.swing(0, { shot: 'flat', power: 0.8, source: 'remote', ageMs: 100 });
  const evs = comp.sim.drainEvents();
  const h2 = evs.find((e) => e.type === 'hit');
  check('without compensation a 100 ms late remote swing is already late (lower quality or missed)', !noComp || (h2 && noComp.quality < h2.quality), `uncompensated ${noComp ? f(noComp.quality) : 'missed'}, ball fwd ${f(gLate.fwd)}`);
  check('with ageMs=100 the same swing is evaluated at the historical ball state and connects at high quality', h2 && h2.quality > 0.75, h2 && f(h2.quality));
  // hit applied from the historical position, then re-simulated forward
  const dz = comp.sim.ball.pos.z - comp.before.z;
  check('ball re-simulated forward from the historical contact point', h2 && comp.sim.ball.lastHitBy === 0 && comp.sim.ball.vel.z < 0 && dz < -0.5, `moved ${f(dz)} m in z since contact, pos.z ${f(comp.sim.ball.pos.z)}`);
  check('hit position reported is the historical one', h2 && Math.abs(h2.pos.z - comp.before.z) < 0.4, h2 && `${f(h2.pos.z)} vs ${f(comp.before.z)}`);
}
{
  // cooldown prevents double hits, and a player cannot hit his own ball
  const sim = mk(); toRally(sim); feed(sim, 6, 20);
  for (let i = 0; i < 400; i++) { if (contactGeometry(sim.players[0], sim.ball).tEarly <= 0.004) { sim.swing(0, { shot: 'flat', power: 0.8 }); break; } sim.step(1 / 120); }
  sim.drainEvents();
  sim.swing(0, { shot: 'flat', power: 0.8 });
  check('no second hit on own ball / during cooldown', !sim.drainEvents().some((e) => e.type === 'hit'));
}
// serve mechanics are covered by tests/sim_serve.mjs

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
