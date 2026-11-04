// Serve mechanics: pre-serve ball bounce routine, toss, contact, landing, mirrored for the far AI and left-handers.
// Run: node tests/sim_serve.mjs
import { Simulation } from '../src/game/simulation.js';
import { COURT } from '../src/config.js';
import * as SC from '../src/game/serve_choreo.js';
import { poseFor, solve } from '../src/render/pose.js';

let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${info ? '  (' + info + ')' : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? '  (' + info + ')' : ''}`); }
}
const f = (x, n = 2) => (x == null ? 'n/a' : x.toFixed(n));
const T = { pointOver: 0.3, changeover: 0.3, aiServeDelay: [0.1, 0.2], walkDelay: 0.05, faultHold: 0.3 };
const DT = 1 / 120;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** world position of the rig's tossing-hand ball point for player pl's current anim */
function rigHand(pl) {
  const a = pl.anim;
  const P = poseFor(a.name === 'bounce' ? { name: 'serve', shot: 'bounce', phase: a.phase } : a);
  const J = solve(P, pl.hand);
  const h = J.handLc;
  return { x: pl.pos.x + pl.facing * h[0], y: h[1] + SC.PALM_BELOW_BALL, z: pl.pos.z - pl.facing * h[2] };
}
function rigRacketHead(pl) {
  const J = solve(poseFor(pl.anim), pl.hand);
  const c = J.racket.butt.map((v, k) => v + J.racket.axis[k] * 0.4925);
  return { x: pl.pos.x + pl.facing * c[0], y: c[1], z: pl.pos.z - pl.facing * c[2] };
}

/**
 * Run one serve for `server` and record a trace.
 * how: 'auto' (swing in serve-prep => toss+hit at the ideal time) | 'toss' (serveToss + swing at offsetMs)
 */
function traceServe(opts, how = 'auto', shot = 'flat', offsetMs = 0) {
  const sim = new Simulation({ seed: 21, timing: T, autoMove: ['off', 'off'], shotOpts: {}, ...opts });
  const s = sim.match.server, pl = sim.players[s];
  const tr = { sim, s, heldErr: 0, rigErr: 0, rigN: 0, dribbleGround: 0, dribbleEvents: 0, planted: true, maxBallY: 0, anims: new Set() };
  // routine (AI servers serve by themselves; for humans we wait for the hold)
  let guard = 0;
  while (!(sim.phase === 'serving') && guard++ < 120 * 12) {
    if (pl.isHuman && sim.serverReady(s)) {
      if (how === 'auto') sim.swing(s, { shot, power: 0.9, source: 'remote' }); else sim.serveToss(s, { shot });
    }
    sim.step(DT);
    for (const e of sim.drainEvents()) if (e.type === 'bounce' && e.dribble) tr.dribbleEvents++;
    const b = sim.ball;
    if (pl.routine) {
      tr.anims.add(pl.anim.name);
      if (b.y < SC.BALL_R + 0.01 || b.pos.y < SC.BALL_R + 0.01) tr.dribbleGround++;
      if (b.attach && b.attach.held) {
        const d = SC.dribble(pl.anim.phase);
        const hw = SC.toWorld(pl, pl.routine.O, d.hand);
        tr.heldErr = Math.max(tr.heldErr, dist(b.pos, hw));
        tr.rigErr = Math.max(tr.rigErr, dist(b.pos, rigHand(pl))); tr.rigN++;
      }
    }
  }
  const t = sim.toss;
  tr.type = t.type;
  tr.O = { ...t.O };
  let released = null, contact = null, land = null, prev = null, hitT = null, served = null, splitSeen = false, phaseTrace = [];
  const opp = sim.players[1 - s];
  for (let k = 0; k < 120 * 4; k++) {
    if (how === 'toss' && pl.isHuman && !sim.toss?.hit && sim.toss && sim.toss.t >= SC.SERVE_T.contact + offsetMs / 1000 - 1e-9) {
      sim.swing(s, { shot, power: 0.9, source: 'keyboard' });
    }
    const b = sim.ball;
    if (sim.toss && !sim.toss.hit) {
      if (b.attach && b.attach.held) {
        tr.heldErr = Math.max(tr.heldErr, dist(b.pos, SC.toWorld(pl, t.O, SC.tossHand(t.type, sim.toss.t))));
        tr.rigErr = Math.max(tr.rigErr, dist(b.pos, rigHand(pl))); tr.rigN++;
      } else if (!released && prev) released = { ...prev, t: sim.toss.t };
      tr.maxBallY = Math.max(tr.maxBallY, b.pos.y);
      if (sim.toss.t < SC.SERVE_T.jumpStart && (Math.abs(pl.pos.x - t.O.x) > 1e-9 || Math.abs(pl.pos.z - t.O.z) > 1e-9)) tr.planted = false;
      prev = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    }
    sim.step(DT);
    if (pl.anim.name === 'serve') phaseTrace.push(pl.anim.phase);
    for (const e of sim.drainEvents()) {
      if (e.type === 'serve' && !contact) {
        contact = { ...e.pos, t: sim.toss.t, kmh: e.speedKmh, q: sim.lastShot.quality };
        hitT = sim.time; served = e;
        tr.racketErr = dist(e.pos, rigRacketHead(pl));
      }
    }
    if (contact && opp.anim.name === 'split') splitSeen = true;
    if (hitT !== null && !land && sim.time - hitT >= SC.SERVE_T.land - SC.SERVE_T.contact) land = { x: pl.pos.x, z: pl.pos.z, anim: pl.anim.name, phase: pl.anim.phase };
    if (hitT !== null && sim.time - hitT > 1.2) break;
  }
  Object.assign(tr, { released, contact, land, splitSeen, phaseTrace, after: { x: pl.pos.x, z: pl.pos.z, anim: pl.anim.name } });
  return tr;
}

function local(tr, p) { return SC.toLocal(tr.sim.players[tr.s], tr.O, p); }

function serveChecks(label, opts, shot = 'flat') {
  console.log(label);
  const tr = traceServe(opts, 'auto', shot);
  const pl = tr.sim.players[tr.s];
  check('pre-serve routine: ball bounced 2-4 times by the hand (anim "bounce")', tr.dribbleEvents >= 1 && tr.dribbleEvents <= 4 && tr.anims.has('bounce'), `${tr.dribbleEvents} bounces`);
  check('held ball is exactly at the choreographed hand (< 1 mm)', tr.heldErr < 0.001, `${f(tr.heldErr * 100, 2)} cm`);
  check('held ball is within 5 cm of the posed rig hand (IK) at every step', tr.rigN > 50 && tr.rigErr < 0.05, `${f(tr.rigErr * 100, 1)} cm max over ${tr.rigN} steps`);
  check('feet stay planted during the toss', tr.planted);
  const R = tr.released;
  check('toss released at full arm extension (1.7-1.9 m)', R && R.y > 1.7 && R.y < 1.9, R && `${f(R.y)} m`);
  const flight = tr.contact && R ? tr.contact.t - R.t : null;
  check('release-to-contact 0.7-0.9 s', flight > 0.7 && flight < 0.9, `${f(flight)} s`);
  const C = tr.contact;
  check('contact height 2.7-2.9 m (~1.5 x player height)', C && C.y > 2.7 && C.y < 2.9, C && `${f(C.y)} m`);
  const apexAbove = tr.maxBallY - (C ? C.y : 0);
  check('toss apex 0.3-0.5 m above contact', apexAbove > 0.3 && apexAbove < 0.5, `${f(apexAbove)} m`);
  const inside = C ? COURT.halfLength - Math.abs(C.z) : null;
  const lc = C ? local(tr, C) : null;
  if (shot === 'flat') check('flat toss contact 0.2-0.5 m inside the baseline, slightly to the hitting side', inside > 0.2 && inside < 0.5 && lc[0] > 0.05, `${f(inside)} m inside, ${f(lc[0])} m to the racket side`);
  check('racket string bed meets the ball at contact (rig, < 6 cm)', tr.racketErr < 0.06, `${f(tr.racketErr * 100, 1)} cm`);
  const L = tr.land;
  const landIn = L ? COURT.halfLength - Math.abs(L.z) : null;
  check('server lands inside the baseline (0.4-1.1 m in) at the landing phase', landIn > 0.4 && landIn < 1.1 && L.anim === 'serve', L && `${f(landIn)} m inside, anim ${L.anim} ${f(L.phase)}`);
  const mono = tr.phaseTrace.every((v, k) => k === 0 || v >= tr.phaseTrace[k - 1] - 1e-9);
  check('serve animation runs through landing/finish to the end (no snap to ready)', mono && Math.max(...tr.phaseTrace) > 0.94, `max phase ${f(Math.max(...tr.phaseTrace))}`);
  check('receiver split-steps at the server\'s contact', tr.splitSeen);
  return tr;
}

// ------------------------------------------------------------------ near human server (deuce + ad), toss types
const nearDeuce = serveChecks('near server (human, right-handed), deuce court', { firstServer: 0, aiStyle: 'grinder' });
check('deuce: server stands right of the centre mark, behind the baseline', nearDeuce.O.x > 0.3 && nearDeuce.O.z > COURT.halfLength);
{
  console.log('near server, ad court');
  const sim = new Simulation({ seed: 3, timing: T, firstServer: 0, aiStyle: 'grinder', autoMove: ['off', 'off'] });
  sim.match.points = [1, 0]; sim._beginServePrep(true);
  const pl = sim.players[0];
  let guard = 0;
  while (sim.phase !== 'serving' && guard++ < 2000) { if (sim.serverReady(0)) sim.swing(0, { shot: 'flat', power: 0.9, source: 'remote' }); sim.step(DT); }
  check('ad court: server left of the centre mark', sim.toss && sim.toss.O.x < -0.3, sim.toss && f(sim.toss.O.x));
  let served = null;
  for (let k = 0; k < 400 && !served; k++) { sim.step(DT); served = sim.drainEvents().find((e) => e.type === 'serve'); }
  const lc = SC.toLocal(pl, sim.toss.O, served.pos);
  check('ad court contact uses the same body-relative toss', Math.abs(lc[0] - SC.TOSS.flat.C[0]) < 0.05 && Math.abs(lc[1] - SC.TOSS.flat.C[1]) < 0.05, `local ${lc.map((v) => f(v)).join(',')}`);
}
{
  console.log('toss placement by serve type');
  const fl = traceServe({ firstServer: 0, aiStyle: 'grinder' }, 'auto', 'flat');
  const kk = traceServe({ firstServer: 0, aiStyle: 'grinder' }, 'auto', 'topspin');
  const sl = traceServe({ firstServer: 0, aiStyle: 'grinder' }, 'auto', 'slice');
  const L = (tr) => local(tr, tr.contact);
  check('kick serve contact is further back (over the head) than flat', L(kk)[2] < L(fl)[2] - 0.15, `${f(L(kk)[2])} vs ${f(L(fl)[2])}`);
  check('slice serve contact is further to the hitting side than flat', L(sl)[0] > L(fl)[0] + 0.1, `${f(L(sl)[0])} vs ${f(L(fl)[0])}`);
  for (const tr of [fl, kk, sl]) check(`${tr.type}: contact 2.7-2.9 m, racket on the ball`, tr.contact.y > 2.7 && tr.contact.y < 2.9 && tr.racketErr < 0.06, `${f(tr.contact.y)} m, racket ${f(tr.racketErr * 100, 1)} cm`);
}

// ------------------------------------------------------------------ far AI server and left-hander
const far = serveChecks('far AI server (mirrored)', { firstServer: 1, aiStyle: 'grinder', aiLevel: 1 }, 'any');
check('far server lands inside the far baseline (z < 0)', far.land && far.land.z < 0 && far.land.z > -COURT.halfLength);
serveChecks('near server, LEFT-handed human', { firstServer: 0, humanHand: 'L', aiStyle: 'grinder' });
{
  const tr = traceServe({ firstServer: 0, humanHand: 'L', aiStyle: 'grinder' }, 'auto', 'flat');
  check('left-hander: flat contact is to the LEFT of the body (racket side)', tr.contact.x < tr.O.x, `contact x ${f(tr.contact.x)} vs stand ${f(tr.O.x)}`);
}

// ------------------------------------------------------------------ after the serve
{
  console.log('after the serve');
  // z of the server 1.25 s after each of its serves (only serves whose point is still running), with netMode
  const sv = (style) => {
    const sim = new Simulation({ seed: 9, timing: T, aiPlayers: [true, true], aiStyles: [style, 'grinder'], aiLevels: [0.9, 0.9], firstServer: 0 });
    const out = [];
    let hitT = null, net = false;
    for (let k = 0; k < 120 * 90 && out.length < 6; k++) {
      sim.step(DT);
      for (const e of sim.drainEvents()) if (e.type === 'serve' && e.by === 0) { hitT = sim.time; net = false; }
      if (hitT !== null && sim.time - hitT > 0.3 && sim.time - hitT < 0.31) net = sim.ais[0].netMode;
      if (hitT !== null && sim.time - hitT > 1.25) {
        if (sim.phase === 'rally' || sim.phase === 'serving') out.push({ z: Math.abs(sim.players[0].pos.z), net });
        hitT = null;
      }
    }
    return out;
  };
  const svv = sv('serveVolley').filter((r) => r.net), gr = sv('grinder');
  check('serve & volley keeps running forward after landing', svv.length > 0 && svv.every((r) => r.z < COURT.halfLength - 2.5), svv.map((r) => f(r.z)).join(' '));
  check('baseliner recovers back behind the baseline', gr.length > 0 && gr.every((r) => r.z > COURT.halfLength - 0.2), gr.map((r) => f(r.z)).join(' '));
}

// ------------------------------------------------------------------ timing and speeds
{
  console.log('timing and serve speed');
  const ok = traceServe({ firstServer: 0, aiStyle: 'grinder' }, 'toss', 'flat', 0);
  const early = traceServe({ firstServer: 0, aiStyle: 'grinder' }, 'toss', 'flat', -150);
  const late = traceServe({ firstServer: 0, aiStyle: 'grinder' }, 'toss', 'flat', 150);
  check('swing at the choreographed contact time is a high-quality serve', ok.contact.q > 0.9, f(ok.contact.q));
  check('early / late swings hit a worse ball', early.contact.q < ok.contact.q - 0.1 && late.contact.q < ok.contact.q - 0.1, `early ${f(early.contact.q)} late ${f(late.contact.q)}`);
  // speeds unchanged: flat 110 + 80 p, kick 90 + 45 p, slice 105 + 55 p, scaled by (0.8 + 0.2 q^0.7)
  // reference speeds measured with the previous serve implementation (same power, q = 1)
  for (const [shot, exp] of [['flat', 182], ['topspin', 130], ['slice', 142]]) {
    const tr = traceServe({ firstServer: 0, aiStyle: 'grinder' }, 'auto', shot);
    check(`${shot} serve speed unchanged by the new mechanics (power 0.9)`, Math.abs(tr.contact.kmh - exp) / exp < 0.04, `${f(tr.contact.kmh, 0)} km/h vs ${exp} before, q ${f(tr.contact.q)}`);
  }
  // a late toss with no swing is let drop: no fault, the server re-tosses
  const sim = new Simulation({ seed: 4, timing: T, firstServer: 0, aiStyle: 'grinder', autoMove: ['off', 'off'] });
  let g = 0; while (!sim.serverReady(0) && g++ < 3000) sim.step(DT);
  sim.serveToss(0, { shot: 'flat' });
  const ev = [];
  for (let k = 0; k < 120 * 3; k++) { sim.step(DT); ev.push(...sim.drainEvents()); }
  check('toss that is never hit is let drop: no fault, back to serve-prep', !ev.some((e) => e.type === 'call') && sim.phase === 'serve-prep' && sim.state.match.faultCount === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
