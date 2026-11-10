// Arcade phone controller tests (Node, no browser). Run: node tests/arcade_ctl.test.mjs [--verbose]
//  1. arcade gesture layer on synthetic IMU traces: detection, false positives, shape confusion, timestamp error, emit latency
//  2. RemoteAdapter against a mock sim (swing/net/pause/fb/state/haptic)
//  3. protocol sanitize: new fields kept, old messages unchanged
// NOTE: traces come from our own rigid-body model (src/controller/simtrace.js). Numbers are an upper bound / regression
// guard, NOT real-world accuracy with a real phone in a real hand.
import { createArcadeGesture, classifyShape, powerFromPeak, toSwingMessage, ARCADE } from '../cartoon/src/controller/arcade_gesture.js';
import { PhoneSim, genSwingTrace } from '../src/controller/simtrace.js';
import { RemoteAdapter } from '../cartoon/src/input/remote.js';
import { sanitize } from '../src/net/protocol.js';

const verbose = process.argv.includes('--verbose');
let failures = 0;
function check(name, ok, info = '') { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); }
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : NaN; };

const SHOTS = ['topspin', 'flat', 'slice', 'lob'];
function run(samples, hand = 'R', opts = {}) {
  const g = createArcadeGesture({ hand, ...opts });
  const ev = [];
  for (const s of samples) ev.push(...g.push(s));
  return { g, ev };
}

// ------------------------------------------------------------------ 1. swing detection, shape, timestamp, latency
{
  const conf = Object.fromEntries(SHOTS.map((s) => [s, Object.fromEntries([...SHOTS, 'none'].map((t) => [t, 0]))]));
  const tsErr = [], delays = { 60: [], 100: [] }, powerBy = {};
  let total = 0, once = 0, multi = 0, seed = 4000;
  // user styles: tidy (sloppy 0, speed ~1), casual (sloppy 0.6, slower), lazy-casual (speed 0.7)
  const styles = [{ name: 'tidy', sloppy: 0, speed: 1, noise: 1 }, { name: 'casual', sloppy: 0.6, speed: 0.85, noise: 2 }];
  const perStyle = {};
  for (const st of styles) {
    perStyle[st.name] = { n: 0, ok: 0, typeOk: 0 };
    for (const hand of ['R', 'L']) for (const flip of [false, true]) for (const hz of [60, 100])
      for (const shot of SHOTS) for (const side of ['fh', 'bh']) for (let k = 0; k < 6; k++) {
        const { samples, truth } = genSwingTrace({ shot, side, hand, flip, hz, seed: ++seed, speed: st.speed, sloppy: st.sloppy, noise: st.noise });
        const { ev } = run(samples, hand);
        total++; perStyle[st.name].n++;
        if (ev.length > 1) multi++;
        if (ev.length !== 1) { conf[shot].none++; if (verbose) console.log('  miss', st.name, { shot, side, hand, flip, hz, seed, n: ev.length, peak: Math.round(truth.peakDps) }); continue; }
        once++; perStyle[st.name].ok++;
        const e = ev[0];
        conf[shot][e.shot]++;
        if (e.shot === shot) perStyle[st.name].typeOk++;
        tsErr.push(Math.abs(e.ts - truth.contactT));
        delays[hz].push(e.emitDelayMs);
        (powerBy[shot] ||= []).push(e.power);
      }
  }
  console.log(`\nSwing trials: ${total}, detected exactly once: ${once}, multiple events: ${multi}`);
  console.log('Shape confusion (rows = truth, cols = predicted):');
  console.log('           ' + [...SHOTS, 'none'].map((s) => s.padStart(8)).join(''));
  let corr = 0, nn = 0;
  for (const s of SHOTS) {
    console.log(s.padEnd(10) + ' ' + [...SHOTS, 'none'].map((t) => String(conf[s][t]).padStart(8)).join(''));
    corr += conf[s][s]; nn += SHOTS.reduce((a, t) => a + conf[s][t], 0);
  }
  for (const st of styles) { const p = perStyle[st.name]; console.log(`  style ${st.name}: detected ${p.ok}/${p.n} (${(p.ok / p.n * 100).toFixed(1)}%), shape correct ${p.typeOk}/${p.ok} (${(p.typeOk / p.ok * 100).toFixed(1)}%)`); }
  console.log(`contact timestamp error ms: median ${pct(tsErr, 0.5).toFixed(2)}, p95 ${pct(tsErr, 0.95).toFixed(2)}, max ${Math.max(...tsErr).toFixed(1)}`);
  for (const hz of [60, 100]) console.log(`peak->emit delay @${hz} Hz ms: median ${pct(delays[hz], 0.5).toFixed(1)}, p95 ${pct(delays[hz], 0.95).toFixed(1)}, max ${Math.max(...delays[hz]).toFixed(1)}`);
  for (const s of SHOTS) { const a = powerBy[s] || []; console.log(`power ${s}: mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)} (p10 ${pct(a, 0.1)}, p90 ${pct(a, 0.9)})`); }
  check('tidy swings: detected exactly once >= 98%', perStyle.tidy.ok / perStyle.tidy.n >= 0.98, `(${(perStyle.tidy.ok / perStyle.tidy.n * 100).toFixed(1)}%)`);
  check('casual swings (slower, sloppier, 2x noise): detected exactly once >= 90%', perStyle.casual.ok / perStyle.casual.n >= 0.9, `(${(perStyle.casual.ok / perStyle.casual.n * 100).toFixed(1)}%)`);
  check('no swing produced more than one event', multi === 0, `(${multi})`);
  check('shape accuracy (tidy) >= 85%', perStyle.tidy.typeOk / perStyle.tidy.ok >= 0.85, `(${(perStyle.tidy.typeOk / perStyle.tidy.ok * 100).toFixed(1)}%)`);
  check('shape accuracy (casual) >= 65%', perStyle.casual.typeOk / perStyle.casual.ok >= 0.65, `(${(perStyle.casual.typeOk / perStyle.casual.ok * 100).toFixed(1)}%)`);
  check('contact timestamp p95 error <= 25 ms', pct(tsErr, 0.95) <= 25);
  check('peak->emit delay p95 <= 60 ms @60 Hz', pct(delays[60], 0.95) <= 60);
  check('peak->emit delay p95 <= 60 ms @100 Hz', pct(delays[100], 0.95) <= 60);
  const pm = (s) => powerBy[s].reduce((x, y) => x + y, 0) / powerBy[s].length;
  check('power: harder shapes (flat) > gentler (lob)', pm('flat') > pm('lob'), `(${pm('flat').toFixed(2)} vs ${pm('lob').toFixed(2)})`);
}

// ------------------------------------------------------------------ 1b. power is monotonic in swing speed
{
  const pw = new Map();
  let seed = 900;
  for (const speed of [0.6, 0.8, 1.0, 1.25, 1.5]) {
    const a = [];
    for (let k = 0; k < 8; k++) { const { samples } = genSwingTrace({ shot: 'topspin', side: 'fh', hz: 60, seed: ++seed, speed }); const { ev } = run(samples); if (ev[0]) a.push(ev[0].power); }
    pw.set(speed, a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  }
  console.log('power vs speed:', JSON.stringify([...pw].map(([k, v]) => [k, +v.toFixed(2)])));
  const v = [...pw.values()];
  check('power increases with swing speed', v.every((x, i) => i === 0 || x > v[i - 1]), '');
  check('power mapping is generous: lazy swing (0.8x) >= 0.3, normal >= 0.6', pw.get(0.8) >= 0.3 && pw.get(1.0) >= 0.6);
  check('powerFromPeak endpoints', powerFromPeak(100) === ARCADE.powerMin && powerFromPeak(2000) === 1);
}

// ------------------------------------------------------------------ 1c. deterministic rule table
{
  const t = (f) => classifyShape({ face: 0, peak: 700, vH: 3, ...f }).shot;
  check('rule: steep upward = lob', t({ rise: 28 }) === 'lob' && t({ rise: 18, face: 35 }) === 'lob');
  check('rule: upward = topspin', t({ rise: 15 }) === 'topspin' && t({ rise: 20, face: -10 }) === 'topspin');
  check('rule: level + fast = flat', t({ rise: 1, peak: 800 }) === 'flat');
  check('rule: level + gentle = topspin (default)', t({ rise: 1, peak: 450 }) === 'topspin');
  check('rule: downward = slice', t({ rise: -12 }) === 'slice');
  check('rule: unsure (weak / no horizontal speed / NaN) = topspin',
    t({ rise: -20, peak: 300 }) === 'topspin' && t({ rise: -20, vH: 0.1 }) === 'topspin' && t({ rise: NaN }) === 'topspin');
}

// ------------------------------------------------------------------ 2. false positives
{
  let falseSw = 0, runs = 0, rejected = 0;
  const detail = [];
  // walking with the phone in the hand
  for (const hand of ['R', 'L']) for (const flip of [false, true]) for (const hz of [60, 100]) for (const cfg of [
    { bob: 0.02, f: 1.8, sway: 6, arm: 5 }, { bob: 0.03, f: 2.2, sway: 9, arm: 9 }, { bob: 0.015, f: 1.5, sway: 12, arm: 4 }]) {
    const sim = new PhoneSim({ hand, flip, hz, seed: 77 + runs, noise: 2 });
    const samples = sim.advance(800); sim.setWalk(cfg); samples.push(...sim.advance(9000));
    const { ev, g } = run(samples, hand); falseSw += ev.length; rejected += g.stats.shakeRejected; runs++;
    if (ev.length) detail.push(['walk', JSON.stringify(cfg), ev.length]);
  }
  check('walking triggers no swings', falseSw === 0, `(${runs} runs, ${falseSw} false)`);
  // small / medium wrist motion and fidgeting: sinusoidal wrist waggle of amplitude A deg at f Hz (peak speed 2*pi*f*A)
  let wr = 0, wf = 0;
  for (const hz of [60, 100]) for (const [arm, f] of [[6, 2], [10, 2.5], [14, 2.5], [16, 2.5], [17, 2]]) {
    const sim = new PhoneSim({ hand: 'R', hz, seed: 500 + wr, noise: 2 });
    const samples = sim.advance(800); sim.setWalk({ bob: 0.004, f, sway: arm * 0.6, swayF: f * 0.9, arm }); samples.push(...sim.advance(8000));
    const { ev, g } = run(samples); wf += ev.length; rejected += g.stats.shakeRejected; wr++;
    if (ev.length) detail.push(['wrist', arm, f, hz, ev.length]);
  }
  check('wrist waggle (peak <= ~260 deg/s) triggers no swings', wf === 0, `(${wr} runs, ${wf} false) ${JSON.stringify(detail)}`);
  // vigorous continuous waving at 2.5 Hz, 25 deg amplitude (peak ~390 deg/s): the shake guard must suppress most events
  let waveEv = 0, waveRuns = 0, waveRej = 0;
  for (const hz of [60, 100]) for (const [arm, f] of [[20, 2.5], [25, 2.5], [30, 2.2], [35, 2]]) {
    const sim = new PhoneSim({ hand: 'R', hz, seed: 700 + waveRuns, noise: 2 });
    const samples = sim.advance(800); sim.setWalk({ bob: 0.004, f, sway: arm * 0.5, swayF: f * 0.9, arm }); samples.push(...sim.advance(8000));
    const { ev, g } = run(samples); waveEv += ev.length; waveRej += g.stats.shakeRejected; waveRuns++;
  }
  console.log(`vigorous waving: ${waveRuns} runs of 8 s, ${waveEv} swing events, ${waveRej} suppressed by the shake guard`);
  check('vigorous waving: <= 1 false swing per 8 s run on average', waveEv <= waveRuns, `(${waveEv} in ${waveRuns} runs)`);
  // slow tilting (hand re-grips): head down 30 deg over 1 s, then up
  let tf = 0;
  for (const hz of [60, 100]) for (const [p, r] of [[-30, 0], [30, 0], [0, 35], [0, -35]]) {
    const sim = new PhoneSim({ hand: 'R', hz, seed: 31 });
    const samples = sim.advance(1500); sim.setTilt(p, r); samples.push(...sim.advance(2500)); sim.setTilt(0, 0); samples.push(...sim.advance(2500));
    tf += run(samples).ev.length;
  }
  check('slow tilting / re-gripping triggers no swings', tf === 0, `(${tf} false)`);
}

// ------------------------------------------------------------------ 3. refractory + sequences
{
  const sim = new PhoneSim({ hand: 'R', hz: 60, seed: 21 });
  const g = createArcadeGesture({ hand: 'R' });
  const evs = [];
  const feed = (ss) => { for (const s of ss) evs.push(...g.push(s)); };
  feed(sim.advance(1000));
  for (const [shot, side] of [['topspin', 'fh'], ['slice', 'bh'], ['flat', 'fh'], ['lob', 'fh']]) {
    sim.startSwing({ shot, side }); while (sim.busy) feed(sim.advance(50));
    feed(sim.advance(500));
  }
  feed(sim.advance(800));
  check('four consecutive swings (~2 s apart) -> four events', evs.length === 4, `(${evs.map((e) => e.shot + '/' + e.side).join(' ')})`);
  // a single swing never yields two events even with a long follow-through, and a second swing 300 ms later is swallowed
  const sim2 = new PhoneSim({ hand: 'R', hz: 60, seed: 22 });
  const g2 = createArcadeGesture({ hand: 'R' }); const e2 = [];
  const feed2 = (ss) => { for (const s of ss) e2.push(...g2.push(s)); };
  feed2(sim2.advance(1000)); sim2.startSwing({ shot: 'flat', side: 'fh', speed: 1.3 }); while (sim2.busy) feed2(sim2.advance(50)); feed2(sim2.advance(1500));
  check('one hard swing -> exactly one event', e2.length === 1, `(${e2.length})`);
}

// ------------------------------------------------------------------ 4. message shape
{
  const { samples } = genSwingTrace({ shot: 'topspin', side: 'fh', hz: 60, seed: 5 });
  const { ev } = run(samples);
  const m = toSwingMessage(ev[0], { clockOffsetMs: 1000, adjustMs: 10 });
  const wire = sanitize(JSON.parse(JSON.stringify(m)));
  check('swing message survives JSON + sanitize with all fields', wire && wire.t === 'swing' && wire.shot === m.shot && wire.power === m.power && wire.speedDps === m.speedDps && wire.lift === m.lift && wire.spin === m.spin && Math.abs(wire.ts - (ev[0].ts + 990)) < 1e-6, JSON.stringify(wire));
  const forced = toSwingMessage(ev[0], { override: 'lob' });
  check('forced shot type drops measured lift/spin and sets conf 1', forced.shot === 'lob' && forced.conf === 1 && forced.lift === undefined && forced.spin === undefined);
}

// ------------------------------------------------------------------ 5. RemoteAdapter vs mock sim
function mockSim(over = {}) {
  const calls = [];
  const sim = {
    calls,
    state: { match: { phase: 'rally', pointText: '15-0', server: 0 }, players: [{ zone: 'base', hand: 'R' }, { zone: 'base', hand: 'R' }], hint: { tossUp: false } },
    swing: (...a) => calls.push(['swing', ...a]),
    setNet: (...a) => { calls.push(['setNet', ...a]); sim.state.players[a[0]].zone = a[1] ? 'toNet' : 'toBase'; },
    toggleNet: (...a) => calls.push(['toggleNet', ...a]),
    pause: (...a) => calls.push(['pause', ...a]),
    ...over,
  };
  return sim;
}
{
  const sent = [];
  const host = { send: (m) => { sent.push(m); return true; } };
  const sim = mockSim();
  const ra = new RemoteAdapter(sim, 0, host, { timingOffsetMs: 12 });
  ra.handle({ t: 'swing', shot: 'lob', side: 'fh', power: 0.7, conf: 0.9, ts: 1, ageMs: 40 });
  const c = sim.calls.find((x) => x[0] === 'swing');
  check('adapter: swing -> sim.swing(i,{shot,power,ageMs,source})', c && c[1] === 0 && c[2].shot === 'lob' && c[2].power === 0.7 && c[2].ageMs === 52 && c[2].source === 'remote', JSON.stringify(c));
  ra.handle({ t: 'swing', shot: 'flat', power: 0.5, ageMs: 900 });
  check('adapter: ageMs clamped to [0, 250]', sim.calls.filter((x) => x[0] === 'swing')[1][2].ageMs === 250);
  ra.setTimingOffset(-100); ra.handle({ t: 'swing', shot: 'flat', power: 0.5, ageMs: 40 });
  check('adapter: negative timing offset clamps at 0', sim.calls.filter((x) => x[0] === 'swing')[2][2].ageMs === 0);
  ra.setTimingOffset(0);
  sim.calls.length = 0;
  ra.handle({ t: 'btn', id: 'net', value: 'toggle' }); ra.handle({ t: 'btn', id: 'net', value: true }); ra.handle({ t: 'btn', id: 'net', value: false });
  check('adapter: btn net toggle/true/false -> toggleNet/setNet', JSON.stringify(sim.calls) === JSON.stringify([['toggleNet', 0], ['setNet', 0, true], ['setNet', 0, false]]), JSON.stringify(sim.calls));
  sim.calls.length = 0;
  ra.handle({ t: 'btn', id: 'pause' }); ra.handle({ t: 'btn', id: 'resume' });
  check('adapter: pause / resume', JSON.stringify(sim.calls) === JSON.stringify([['pause', true], ['pause', false]]));
  sim.calls.length = 0;
  ra.handle({ t: 'btn', id: 'shotOverride', value: 'slice' }); ra.handle({ t: 'swing', shot: 'topspin', power: 0.5, ageMs: 10 });
  check('adapter: shotOverride forces the shot', sim.calls[0][2].shot === 'slice');
  ra.handle({ t: 'btn', id: 'shotOverride', value: null });

  // host -> phone: fb for the human's hit / whiff only
  sent.length = 0;
  ra.notify([
    { type: 'hit', by: 0, shot: 'topspin', side: 'fh', timing: 'early', timingMs: -62, dir: -0.44, power: 0.8, quality: 0.83, target: { x: -2.2, z: -9 } },
    { type: 'hit', by: 1, shot: 'flat', side: 'fh', timing: 'perfect', timingMs: 0, dir: 0, quality: 0.9 },
    { type: 'whiff', by: 0, reason: 'early' },
  ], sim.state);
  const fbs = sent.filter((m) => m.t === 'fb');
  check('adapter: fb after human hit and whiff only (2)', fbs.length === 2, JSON.stringify(fbs));
  check('adapter: fb fields (timing, timingMs, shot, quality, dir, side)', fbs[0].timing === 'early' && fbs[0].timingMs === -62 && fbs[0].shot === 'topspin' && fbs[0].quality === 0.83 && fbs[0].side === 'fh' && fbs[0].dir < 0, JSON.stringify(fbs[0]));
  check('adapter: whiff fb carries the reason', fbs[1].timing === 'whiff' && fbs[1].mishit === 'early');
  check('adapter: haptic sent for the hit', sent.some((m) => m.t === 'haptic'));
  const dirOf = (e, hand = 'R') => { const s = []; const r = new RemoteAdapter(mockSim({ state: { match: { phase: 'rally', pointText: '', server: 0 }, players: [{ zone: 'base', hand }] } }), 0, { send: (m) => s.push(m) }); r.notify([{ type: 'hit', by: 0, shot: 'flat', timing: 'early', timingMs: -50, quality: 0.5, ...e }]); return s.find((m) => m.t === 'fb').dir; };
  check('adapter: fb.dir = screen direction, R forehand early -> left, R backhand early -> right, L forehand early -> right',
    dirOf({ side: 'fh', dir: -0.5 }) < 0 && dirOf({ side: 'bh', dir: -0.5 }) > 0 && dirOf({ side: 'fh', dir: -0.5 }, 'L') > 0, '');
  check('adapter: fb.dir prefers sim `aim` / target.x when present', dirOf({ side: 'fh', dir: -0.5, target: { x: 3, z: -9 } }) > 0.5 && dirOf({ side: 'bh', dir: -0.5, aim: -0.7 }) === -0.7 && dirOf({ side: 'fh', dirX: 0.2, aim: -0.9, target: { x: -3, z: -9 } }) === 0.2);

  // state messages
  sent.length = 0;
  sim.state.match = { phase: 'serve-prep', pointText: '30-15', server: 0 };
  sim.state.players[0].zone = 'net'; sim.state.hint = { tossUp: true };
  ra.notify([], sim.state);
  const st = sent.find((m) => m.t === 'state');
  check('adapter: state {phase, pointText, youServe, zone, tossUp}', st && st.phase === 'serve-prep' && st.pointText === '30-15' && st.youServe === true && st.zone === 'net' && st.tossUp === true, JSON.stringify(st));
  sent.length = 0; ra.notify([], sim.state);
  check('adapter: unchanged state is not re-sent', !sent.some((m) => m.t === 'state'));
  sim.state.players[0].zone = 'toBase'; ra.notify([], sim.state);
  check('adapter: zone change re-sends state', sent.some((m) => m.t === 'state' && m.zone === 'toBase'));
  sent.length = 0; sim.state.hint = { tossUp: false }; ra.notify([], sim.state);
  check('adapter: tossUp change re-sends state', sent.some((m) => m.t === 'state' && m.tossUp === false));
  sent.length = 0;
  ra.notify([{ type: 'point', winner: 1, reason: 'out' }], sim.state);
  check('adapter: point lost -> long buzz', sent.some((m) => m.t === 'haptic' && m.pattern.length === 1 && m.pattern[0] >= 200));
  // hello re-sends state immediately
  sent.length = 0; ra.handle({ t: 'hello', v: 1, hand: 'L' });
  check('adapter: hello -> state pushed', sent.some((m) => m.t === 'state'));
  // robust to a missing sim API
  const bare = new RemoteAdapter({ state: null }, 0, { send: () => true });
  let threw = false;
  try { bare.handle({ t: 'swing', shot: 'flat', power: 1, ageMs: 5 }); bare.handle({ t: 'btn', id: 'net', value: 'toggle' }); bare.handle({ t: 'btn', id: 'pause' }); bare.notify([{ type: 'hit', by: 0 }, { type: 'whiff', by: 0 }], null); bare.destroy(); } catch (e) { threw = e; }
  check('adapter: robust when sim methods / state are missing', !threw, String(threw));
  const noToggle = mockSim({ toggleNet: undefined });
  const r3 = new RemoteAdapter(noToggle, 0, { send: () => true });
  r3.handle({ t: 'btn', id: 'net', value: 'toggle' });
  check('adapter: toggle falls back to setNet when toggleNet is missing', noToggle.calls.some((x) => x[0] === 'setNet' && x[2] === true));
}

// ------------------------------------------------------------------ 6. protocol
{
  const b = sanitize({ t: 'btn', id: 'net', value: 'toggle' });
  check('protocol: btn net toggle/true/false', b.id === 'net' && b.value === 'toggle' && sanitize({ t: 'btn', id: 'net', value: true }).value === true && sanitize({ t: 'btn', id: 'net', value: false }).value === false && sanitize({ t: 'btn', id: 'net', value: 'x' }).value === 'toggle');
  check('protocol: old btn ids unchanged', sanitize({ t: 'btn', id: 'serve' }).id === 'serve' && sanitize({ t: 'btn', id: 'shotOverride', value: 'lob' }).value === 'lob' && sanitize({ t: 'btn', id: 'bogus' }) === null);
  const fb = sanitize({ t: 'fb', timing: 'early', timingMs: -48.5, shot: 'topspin', quality: 0.7, dir: -2, side: 'fh', serve: 1, mishit: 'frame' });
  check('protocol: fb fields kept / clamped', fb && fb.timing === 'early' && fb.timingMs === -48.5 && fb.shot === 'topspin' && fb.quality === 0.7 && fb.dir === -1 && fb.side === 'fh' && fb.serve === true && fb.mishit === 'frame', JSON.stringify(fb));
  check('protocol: fb with junk is neutralised', sanitize({ t: 'fb', timing: 'banana', shot: {}, quality: 'x' }).timing === '');
  const stt = sanitize({ t: 'state', phase: 'serving', pointText: '40-30', server: 0, youServe: true, zone: 'toNet', tossUp: true });
  check('protocol: state keeps zone + tossUp', stt.zone === 'toNet' && stt.tossUp === true && stt.youServe === true && stt.pointText === '40-30');
  const old = sanitize({ t: 'state', phase: 'rally', pointText: '0-0', server: 1, youServe: false });
  check('protocol: old state message still passes', old.phase === 'rally' && old.server === 1 && old.youServe === false && old.zone === '' && old.tossUp === false);
  check('protocol: swing/hello/haptic/ping unchanged',
    sanitize({ t: 'swing', shot: 'lob', power: 2 }).power === 1 && sanitize({ t: 'hello', hand: 'L' }).hand === 'L' && sanitize({ t: 'haptic', pattern: [10, 20] }).pattern.length === 2 && sanitize({ t: 'ping', id: 3, ts: 4 }).id === 3);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
