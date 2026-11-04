// Footwork / locomotion realism (DESIGN §6.1). Run: node tests/sim_move.mjs
import { Simulation } from '../src/game/simulation.js';
import { PLAYER } from '../src/game/player.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 2) => (x == null || !isFinite(x) ? String(x) : x.toFixed(n));
const DT = 1 / 120;
const FAST = { pointOver: 0.3, changeover: 0.3, aiServeDelay: [0.1, 0.2], walkDelay: 0.05, faultHold: 0.2, matchOver: 0.2 };

// ------------------------------------------------------------------ scripted moves
function drill(dx, dz, opts = {}) {
  const sim = new Simulation({ aiPlayers: [false, false], autoMove: ['off', 'off'], seed: 2, timing: FAST });
  for (let i = 0; i < 600 && !sim.canServe(sim.match.server); i++) sim.step(DT);
  sim._setPhase('rally'); sim.ball.inPlay = false; sim.rally.lastHitTime = sim.time + 1e6;
  const p = sim.players[0]; p.walkTarget = null; p.routine = null; p.serve = null;
  p.pos.x = 0; p.pos.z = 12.4; p.vel.x = p.vel.z = 0;
  sim.ais[0] = null;
  // drive player 0 with a move order (as the AI / auto-move do)
  const tgt = { x: dx, z: 12.4 + dz };
  const names = new Set(), seq = [];
  let gaitDist = 0, dist = 0, lastG = p.anim.gait, maxA = 0, prevV = { x: 0, z: 0 }, faceNet = true, faceRun = true;
  for (let i = 0; i < 120 * 4; i++) {
    p.moveTo(tgt.x, tgt.z, opts.timeLeft != null ? opts.timeLeft - i * DT : null);
    const x0 = p.pos.x, z0 = p.pos.z;
    p.update(DT, { inPoint: true });
    const a = p.anim;
    names.add(a.name); if (seq[seq.length - 1] !== a.name) seq.push(a.name);
    const d = Math.hypot(p.pos.x - x0, p.pos.z - z0); dist += d;
    let dg = a.gait - lastG; if (dg < -0.5) dg += 1; lastG = a.gait; gaitDist += dg * a.strideLen;
    maxA = Math.max(maxA, Math.hypot(p.vel.x - prevV.x, p.vel.z - prevV.z) / DT); prevV = { x: p.vel.x, z: p.vel.z };
    if ((a.name === 'shuffle' || a.name === 'backpedal') && Math.abs(a.face.z - -1) > 1e-6) faceNet = false;
    if (a.name === 'run' && Math.hypot(p.vel.x, p.vel.z) > 2 && a.face.x * a.dir.x + a.face.z * a.dir.z < 0.95) faceRun = false;
  }
  return { names, seq, gaitDist, dist, maxA, faceNet, faceRun, end: { x: p.pos.x, z: p.pos.z }, v: Math.hypot(p.vel.x, p.vel.z), anim: p.anim };
}

console.log('footwork by situation');
{
  const short = drill(1.6, 0);
  check('short lateral adjustment (1.6 m) = side shuffle facing the net, no run', short.names.has('shuffle') && !short.names.has('run') && short.faceNet, short.seq.join('>'));
  const long = drill(5.0, 0);
  check('long lateral move (5 m) = crossover first step, then run', long.seq.indexOf('crossover') >= 0 && long.seq.indexOf('run') > long.seq.indexOf('crossover'), long.seq.join('>'));
  check('running faces the direction of travel', long.faceRun);
  const back = drill(0.3, 2.4);
  check('moving back 2.4 m = backpedal facing the net', back.names.has('backpedal') && back.faceNet && !back.names.has('run'), back.seq.join('>'));
  const fwd = drill(0.5, -6.0);
  check('moving forward to a short ball = run, then braking steps', fwd.names.has('run') && fwd.seq.indexOf('brake') > fwd.seq.indexOf('run'), fwd.seq.join('>'));
  const urgent = drill(2.0, 0, { timeLeft: 0.7 });
  check('a short move under time pressure becomes a crossover/run', urgent.names.has('crossover') || urgent.names.has('run'), urgent.seq.join('>'));
  for (const [n, r] of [['short', short], ['long', long], ['back', back], ['forward', fwd]]) {
    check(`${n}: ends exactly set at the target (no drift)`, r.v < 0.02 && Math.hypot(r.end.x - (n === 'short' ? 1.6 : n === 'long' ? 5 : n === 'back' ? 0.3 : 0.5), r.end.z - (12.4 + (n === 'back' ? 2.4 : n === 'forward' ? -6 : 0))) < 0.1 && r.anim.name === 'ready', `v ${f(r.v)}, anim ${r.anim.name}`);
    check(`${n}: gait advances with distance (no foot sliding)`, Math.abs(r.gaitDist - r.dist) < 0.02 * r.dist + 0.02, `gait ${f(r.gaitDist)} m vs ${f(r.dist)} m`);
    check(`${n}: acceleration bounded`, r.maxA <= Math.max(PLAYER.accel0 + PLAYER.accelMin, PLAYER.brake) * 1.02, `${f(r.maxA, 1)} m/s^2`);
  }
  const s = drill(0.2, 0);
  check('hysteresis: a target 0.2 m away does not start a move', s.dist < 0.01 && !s.names.has('shuffle'), f(s.dist, 3));
  check('anim exposes gait, strideLen, dir, face, speed, accel', ['gait', 'strideLen', 'dir', 'face', 'speed', 'accel'].every((k) => k in long.anim));
}

// ------------------------------------------------------------------ match-level checks
function rallyStats(opts, secs = 400) {
  const sim = new Simulation({ timing: FAST, seed: 17, format: { sets: 1, gamesPerSet: 3, tiebreak: true }, ...opts });
  const st = [0, 1].map(() => ({ flips: 0, movingT: 0, chatter: 0, maxA: 0, prev: null, lastState: null, lastStateT: 0, splitAfterOpp: 0, oppHits: 0 }));
  const contact = [];      // settledness of human hits
  const human = sim.players.findIndex((p) => p.isHuman);
  const recent = [[], []];
  let swings = 0;
  for (let n = 0; n < secs * 120 && sim.state.match.phase !== 'match-over'; n++) {
    // bot for a human in 'full': serve, and swing at the right moment
    if (human >= 0) {
      const h = sim.state.hint;
      if (sim.phase === 'serve-prep' && sim.match.server === human && sim.serverReady(human)) sim.swing(human, { shot: 'flat', power: 0.8, source: 'remote' });
      else if (sim.phase === 'rally' && sim.ball.lastHitBy !== human && h.reachable && h.contactIn !== null && h.contactIn < 0.02) sim.swing(human, { shot: ['topspin', 'flat', 'slice'][swings++ % 3], power: 0.7 });
    }
    sim.step(DT);
    const inRally = sim.phase === 'rally' || sim.phase === 'serving';
    for (let i = 0; i < 2; i++) {
      const p = sim.players[i], s = st[i];
      const v = { x: p.vel.x, z: p.vel.z }, sp = Math.hypot(v.x, v.z);
      recent[i].push(sp); if (recent[i].length > 24) recent[i].shift();
      if (inRally && !p.serve && !p.walkTarget) {
        if (s.prev) {
          const a = Math.hypot(v.x - s.prev.x, v.z - s.prev.z) / DT;
          s.maxA = Math.max(s.maxA, a);
        }
        if (sp > 0.3) s.movingT += DT;
        // reversal: heading flips by > 120 deg within 0.15 s while moving clearly
        if (!s.hist) s.hist = [];
        s.hist.push(v); if (s.hist.length > 18) s.hist.shift();
        const o = s.hist[0], so = Math.hypot(o.x, o.z);
        if (sp > 1.0 && so > 1.0 && (o.x * v.x + o.z * v.z) / (sp * so) < -0.5) { s.flips++; s.hist.length = 0; }
        const state = p.loco.state === 'moving' ? 'm' : 's';
        if (state !== s.lastState) {
          s.toggles = (s.toggles || []).filter((t) => sim.time - t < 0.6); s.toggles.push(sim.time);
          if (s.toggles.length >= 4) { s.chatter++; s.toggles.length = 0; }       // move/stop/move/stop within 0.6 s
          s.lastState = state; s.lastStateT = sim.time;
        }
      }
      s.prev = v;
    }
    for (const e of sim.drainEvents()) {
      if (e.type === 'hit' && !e.serve) {
        const o = 1 - e.by; st[o].oppHits++;
        st[o].pendingSplit = sim.time;
        if (e.by === human) {
          const r = recent[human];
          contact.push({ speed: r[r.length - 1], maxLast: Math.max(...r.slice(-18)), anim: sim.players[human].loco.state });
        }
      }
    }
    for (let i = 0; i < 2; i++) if (st[i].pendingSplit != null && sim.players[i].anim.name === 'split') { st[i].splitAfterOpp++; st[i].pendingSplit = null; }
    for (let i = 0; i < 2; i++) if (st[i].pendingSplit != null && sim.time - st[i].pendingSplit > 0.1) st[i].pendingSplit = null;
  }
  return { sim, st, contact };
}

console.log('AI vs AI movement');
{
  const pairs = [['grinder', 'aggressive'], ['serveVolley', 'counter']];
  for (const [a, b] of pairs) {
    const { st } = rallyStats({ aiPlayers: [true, true], aiStyles: [a, b], aiLevels: [0.7, 0.7] }, 300);
    for (let i = 0; i < 2; i++) {
      const s = st[i];
      const flipsPerMin = s.flips / Math.max(1e-6, s.movingT / 60);
      check(`${[a, b][i]}: no direction flip-flopping (< 6 reversals per minute of movement)`, flipsPerMin < 6, `${s.flips} reversals in ${f(s.movingT, 0)} s moving`);
      check(`${[a, b][i]}: no move/stop chatter`, s.chatter / Math.max(1, s.movingT / 60) < 6, `${s.chatter} quick toggles`);
      check(`${[a, b][i]}: acceleration bounded`, s.maxA <= Math.max((PLAYER.accel0 + PLAYER.accelMin) * PLAYER.splitBoost, PLAYER.brake) * 1.02, `${f(s.maxA, 1)} m/s^2`);
      check(`${[a, b][i]}: split step after (almost) every opponent contact`, s.splitAfterOpp >= 0.8 * s.oppHits, `${s.splitAfterOpp}/${s.oppHits}`);
    }
  }
}

console.log("auto-move 'full' (human with perfect swing timing) vs AI");
{
  let set = 0, n = 0, chatter = 0, flips = 0, movingT = 0;
  for (const seed of [17, 18]) {
    const { st, contact, sim } = rallyStats({ aiPlayers: [false, true], autoMove: ['full', 'off'], aiStyle: 'grinder', aiLevel: 0.6, seed }, 300);
    for (const c of contact) { n++; if (c.speed < 1.0) set++; }
    chatter += st[0].chatter; flips += st[0].flips; movingT += st[0].movingT;
  }
  check('player is settled at contact on >= 80% of the balls it reaches', n > 20 && set / n >= 0.8, `${set}/${n} (${f(100 * set / n, 0)}%)`);
  check("'full' auto-move: no flip-flopping, no chatter", flips / (movingT / 60) < 6 && chatter / (movingT / 60) < 6, `${flips} reversals, ${chatter} toggles in ${f(movingT, 0)} s moving`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
