// Keyboard input + movement/assist tests. Run: node tests/sim_input.mjs
import { Simulation } from '../src/game/simulation.js';
import { attachKeyboard, KEYBOARD_HELP, powerFromHold } from '../src/input/keyboard.js';
import { contactGeometry } from '../src/game/shot.js';
import { PLAYER } from '../src/game/player.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 2) => x.toFixed(n);
const T = { pointOver: 0.2, changeover: 0.2, aiServeDelay: [0.1, 0.1], walkDelay: 0.02, faultHold: 0.1 };
const mk = (o = {}) => new Simulation({ autoMove: ['off', 'off'], aiStyle: 'grinder', seed: 6, timing: T, ...o });
const run = (sim, secs) => { for (let i = 0; i < secs * 120; i++) { sim.step(1 / 120); } };
function key(target, type, code, extra = {}) { const e = new Event(type); e.code = code; e.repeat = false; Object.assign(e, extra); target.dispatchEvent(e); }

console.log('keyboard');
{
  check('KEYBOARD_HELP lists the keys in Chinese', Array.isArray(KEYBOARD_HELP) && KEYBOARD_HELP.length >= 6 && KEYBOARD_HELP.every((h) => h.key && /[一-鿿]/.test(h.desc)));
  check('power from hold time is capped', powerFromHold(0) < 0.4 && powerFromHold(0.6) === 1 && powerFromHold(5) === 1);
  const sim = mk(); const tgt = new EventTarget(); let clock = 0;
  const detach = attachKeyboard(sim, 0, tgt, { now: () => clock });
  run(sim, 4);                                   // players walk to serve positions
  key(tgt, 'keydown', 'KeyD'); key(tgt, 'keydown', 'KeyW');
  check('WASD sets move intent (right, toward net)', sim.players[0].manual.x === 1 && sim.players[0].manual.z === -1);
  key(tgt, 'keyup', 'KeyD'); key(tgt, 'keyup', 'KeyW'); key(tgt, 'keydown', 'ArrowLeft'); key(tgt, 'keydown', 'ArrowDown');
  check('arrow keys move too (left, toward camera)', sim.players[0].manual.x === -1 && sim.players[0].manual.z === 1);
  key(tgt, 'keyup', 'ArrowLeft'); key(tgt, 'keyup', 'ArrowDown');
  check('keys released -> zero intent', sim.players[0].manual.x === 0 && sim.players[0].manual.z === 0);
  detach();
  key(tgt, 'keydown', 'KeyD');
  check('detach removes the listeners', sim.players[0].manual.x === 0);

  // serve with space: down = toss, up = hit
  const sim2 = new Simulation({ autoMove: ['off', 'off'], aiStyle: 'grinder', seed: 6, timing: T, firstServer: 0 });
  const t2 = new EventTarget(); let c2 = 0;
  attachKeyboard(sim2, 0, t2, { now: () => c2 });
  for (let i = 0; i < 1200 && !sim2.canServe(0); i++) sim2.step(1 / 120);
  check('human server is ready', sim2.canServe(0) && sim2.state.hint.canServe === true && /发球/.test(sim2.state.hint.text), sim2.state.hint.text);
  key(t2, 'keydown', 'Space');
  check('Space keydown tosses the ball', sim2.state.match.phase === 'serving' && sim2.state.ball.pos.y > 1);
  run(sim2, 0.62);
  check('hint shows toss timing', sim2.state.hint.contactIn !== null && sim2.state.hint.contactIn < 0.1, String(sim2.state.hint.contactIn));
  key(t2, 'keyup', 'Space');
  const ev = sim2.drainEvents();
  const sv = ev.find((e) => e.type === 'serve');
  check('Space keyup hits the serve', !!sv && sim2.state.ball.lastHitBy === 0 && sv.speedKmh > 100, sv && f(sv.speedKmh, 0) + ' km/h');
  check('serve animation runs', sim2.state.players[0].anim.name === 'serve' && sim2.state.players[0].anim.phase >= 0.65);
  run(sim2, 3);
  for (let i = 0; i < 2400 && !(sim2.state.match.phase === 'serve-prep' && sim2.canServe(sim2.state.match.server)); i++) sim2.step(1 / 120);
  if (sim2.state.match.server === 0) {
    key(t2, 'keydown', 'KeyJ'); run(sim2, 0.62); key(t2, 'keyup', 'KeyJ');
    const e2 = sim2.drainEvents().find((e) => e.type === 'serve');
    check('shot key also serves (kick serve with J)', !!e2 && sim2.lastShot.serveType === 'topspin', e2 && f(e2.speedKmh, 0) + ' km/h');
  } else check('(second serve scenario skipped: receiver now serving)', true);
}
{
  // rally: K down prepares (backswing), K up swings; direction keys override aim; hold time = power
  const sim = mk(); const tgt = new EventTarget(); let clock = 0;
  attachKeyboard(sim, 0, tgt, { now: () => clock });
  for (let i = 0; i < 1200 && !sim.canServe(sim.match.server); i++) sim.step(1 / 120);
  sim._setPhase('rally'); sim.rally.shots = 5; sim.rally.lastHitTime = sim.time;
  for (const p of sim.players) p.walkTarget = null;
  const p0 = sim.players[0]; p0.pos.x = 0; p0.pos.z = 12.4;
  const b = sim.ball; b.pos.x = 0.8; b.pos.y = 1.55; b.pos.z = 7.5; b.vel.x = 0; b.vel.y = 0; b.vel.z = 20; b.spin.x = b.spin.y = b.spin.z = 0;
  b.inPlay = true; b.lastHitBy = 1; b.bounces = 1; b.rolling = false;
  key(tgt, 'keydown', 'KeyK'); clock = 0;
  sim.step(1 / 120);
  check('shot key keydown starts the backswing (prepared, swing anim, slower movement)', p0.prepared && p0.prepared.shot === 'flat' && sim.state.players[0].anim.name === 'swing' && sim.state.players[0].anim.phase < 0.5);
  key(tgt, 'keydown', 'ArrowLeft');                 // aim left
  while (contactGeometry(p0, sim.ball).tEarly > 0.004) sim.step(1 / 120);
  clock = 0.5;
  key(tgt, 'keyup', 'KeyK');
  const h = sim.drainEvents().find((e) => e.type === 'hit');
  check('keyup swings: flat hit', h && h.shot === 'flat' && sim.ball.lastHitBy === 0, h && `power ${f(h.power)} q ${f(h.quality)}`);
  check('hold time -> power (0.5 s hold ~ 0.9)', h && h.power > 0.85 && h.power < 0.95);
  check('left key held at contact aims to the left half of the court', sim.lastShot.target.x < -1.5, f(sim.lastShot.target.x));
  key(tgt, 'keydown', 'Escape');
  const t0 = sim.time; sim.step(1 / 120);
  check('Esc pauses the simulation', sim.paused && sim.time === t0);
  key(tgt, 'keydown', 'KeyP');
  check('P resumes', !sim.paused);
}

console.log('movement');
{
  const sim = mk(); run(sim, 4);
  const p = sim.players[0]; p.walkTarget = null; p.pos.x = 0; p.pos.z = 12.4; p.vel.x = p.vel.z = 0;
  sim._setPhase('rally'); sim.ball.inPlay = false; sim.rally.lastHitTime = sim.time + 1000;
  sim.setMove(0, 1, 0);
  let vmax = 0, a = 0;
  for (let i = 0; i < 120 * 2; i++) { sim.step(1 / 120); vmax = Math.max(vmax, Math.hypot(p.vel.x, p.vel.z)); if (i === 11) a = p.vel.x / (12 / 120); }
  check('max speed ~6 m/s (not more)', vmax > 5.0 && vmax <= PLAYER.maxSpeed + 1e-6, f(vmax));
  check('acceleration ~9 m/s^2', a > 6 && a < 11, f(a, 1));
  sim.setMove(0, 0, 0); run(sim, 1);
  check('player stops when input released', Math.hypot(p.vel.x, p.vel.z) < 0.01);
  p.pos.x = 0; p.pos.z = 12.4; sim.setMove(0, 1, 0); run(sim, 0.5);
  check('run animation while moving', sim.state.players[0].anim.name === 'run' && sim.state.players[0].anim.speed > 0.5 && sim.state.players[0].anim.dir.x > 0.9);
  sim.setMove(0, 0, -1); run(sim, 4);
  check('cannot run through the net', p.pos.z >= 0.5 && p.pos.z < 1.2, f(p.pos.z));
  sim.setMove(0, 1, 1); run(sim, 6);
  check('stays within bounds', Math.abs(p.pos.x) <= PLAYER.boundsSide + 0.01 && p.pos.z <= PLAYER.boundsBack + 0.01);
  p.pos.x = 0; p.pos.z = 12;
  const before = p.stamina;
  for (let i = 0; i < 600; i++) { sim.setMove(0, i % 240 < 120 ? 1 : -1, 0); sim.step(1 / 120); }
  check('sprinting drains stamina', p.stamina < before - 0.015, `${f(before)} -> ${f(p.stamina)}`);
  const lowSt = p.stamina; sim.setMove(0, 0, 0); sim._setPhase('point-over'); run(sim, 1);
  check('stamina recovers when standing', p.stamina > lowSt);
}
{
  const sim = mk(); run(sim, 4);
  sim._setPhase('rally');
  sim.players[0].walkTarget = null; sim.players[0].splitStep();
  sim.step(1 / 120);
  check('split step animation after opponent contact', sim.state.players[0].anim.name === 'split');
  run(sim, 0.3);
  check('split step ends', sim.state.players[0].anim.name !== 'split');
}

console.log('auto-move');
{
  const scenario = (mode) => {
    const sim = mk({ autoMove: [mode, 'off'] }); run(sim, 4);
    sim._setPhase('rally'); sim.rally.shots = 5; sim.rally.lastHitTime = sim.time;
    for (const pl of sim.players) pl.walkTarget = null;
    const p = sim.players[0]; p.pos.x = 0; p.pos.z = 12.6; p.vel.x = p.vel.z = 0;
    const b = sim.ball; b.pos.x = 3.2; b.pos.y = 2.6; b.pos.z = -3; b.vel.x = 0.5; b.vel.y = 0.5; b.vel.z = 16; b.spin.x = b.spin.y = b.spin.z = 0;
    b.inPlay = true; b.lastHitBy = 1; b.bounces = 0; b.rolling = false; b.visible = true;
    return sim;
  };
  for (const mode of ['full', 'assist']) {
    const sim = scenario(mode);
    let reachableAt = null;
    for (let i = 0; i < 120 * 3 && !reachableAt; i++) {
      sim.step(1 / 120);
      const g = contactGeometry(sim.players[0], sim.ball);
      if (sim.ball.bounces >= 1 && g.fwd < 1.6 && g.fwd > -0.5 && g.tEarly < 0.01) reachableAt = g;
    }
    check(`${mode}: player moves to the predicted contact point without any input`, reachableAt && reachableAt.latAbs < 1.4, reachableAt && `lateral distance at contact ${f(reachableAt.latAbs)} m`);
  }
  const off = scenario('off'); run(off, 0.45);
  check('off: player does not move by itself', Math.abs(off.players[0].pos.x) < 0.01);
  const as = scenario('assist'); as.setMove(0, 0, -1); run(as, 0.4);
  check('assist: manual steering is blended on top', as.players[0].vel.z < -1, f(as.players[0].vel.z));
  const hs = scenario('full');
  let sawContact = false, sawReachable = false;
  for (let i = 0; i < 120 * 2; i++) { hs.step(1 / 120); const h = hs.state.hint; if (h.contactIn !== null && h.contactIn < 0.5) sawContact = true; if (h.reachable) sawReachable = true; }
  check('hint.contactIn and hint.reachable are produced for the HUD', sawContact && sawReachable);
}

console.log('misc API');
{
  const sim = mk({ humanHand: 'L', playerNames: ['甲', '乙'], surface: 'clay' });
  const s = sim.state;
  check('state shape', s.surface === 'clay' && s.players.length === 2 && s.players[0].hand === 'L' && s.players[0].isHuman && !s.players[1].isHuman && s.players[0].name === '甲'
    && ['skin', 'hair', 'shirt', 'shorts', 'shoes'].every((k) => typeof s.players[0].look[k] === 'string') && s.players[0].facing === 1 && s.players[1].facing === -1);
  check('state.match shape', ['phase', 'server', 'serveCourt', 'faultCount', 'points', 'games', 'sets', 'setsWon', 'isTiebreak', 'pointText', 'winner', 'stats'].every((k) => k in s.match));
  check('ball shape', ['pos', 'vel', 'spin', 'visible', 'inPlay', 'bounces', 'lastHitBy', 'marks'].every((k) => k in s.ball));
  check('anim shape', ['name', 'shot', 'side', 'phase', 'dir', 'speed'].every((k) => k in s.players[0].anim) && 'racketHead' in s.players[0] && 'stamina' in s.players[0]);
  const a = new Simulation({ seed: 1 });
  check('default options construct; drainEvents returns array and clears', Array.isArray(a.drainEvents()) && a.drainEvents().length === 0);
  check('pause(true) freezes time', (() => { a.pause(true); const t = a.time; a.step(0.1); return a.time === t; })());
  check('humanHand R default', new Simulation({}).state.players[0].hand === 'R');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
