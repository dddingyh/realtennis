// Node tests for protocol helpers, clock sync maths, the BroadcastChannel transport and RemoteInput.
// (PeerJS itself cannot be exercised offline; see docs/CONTROLLER.md.)  Run: node tests/net.test.mjs
import { makeRoomCode, normalizeRoomCode, ROOM_ALPHABET, sanitize, ClockSync } from '../src/net/protocol.js';
import { createRemoteHost, buildControllerUrl } from '../src/net/host.js';
import { createRemoteClient } from '../src/net/client.js';
import { RemoteInput } from '../src/input/remote.js';

let failures = 0;
const check = (name, ok, info = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// room codes
{
  const seen = new Set(); let bad = 0;
  for (let i = 0; i < 2000; i++) { const c = makeRoomCode(); seen.add(c); if (c.length !== 6 || [...c].some((ch) => !ROOM_ALPHABET.includes(ch))) bad++; }
  check('room codes: 6 chars from unambiguous alphabet', bad === 0 && !/[01OIL]/.test(ROOM_ALPHABET));
  check('room codes: diverse', seen.size > 1990);
  check('normalizeRoomCode', normalizeRoomCode(' ab2cd3 ') === 'AB2CD3' && normalizeRoomCode('AB2CD0') === null && normalizeRoomCode('ABC') === null);
}
// controller url
{
  check('controllerUrl', buildControllerUrl('ABC234', { base: 'https://x.github.io/rt/controller.html' }) === 'https://x.github.io/rt/controller.html?room=ABC234');
  check('controllerUrl local', buildControllerUrl('ABC234', { local: true, base: 'http://localhost:8000/controller.html?old=1#h' }) === 'http://localhost:8000/controller.html?room=ABC234&local=1');
}
// sanitize
{
  check('sanitize rejects junk', sanitize(null) === null && sanitize({}) === null && sanitize({ t: 'swing', shot: 'nope' }) === null);
  const s = sanitize({ t: 'swing', shot: 'lob', side: 'x', power: 7, conf: -1, ts: 5 });
  check('sanitize clamps swing', s && s.power === 1 && s.conf === 0 && s.side === 'auto');
  const t = sanitize({ t: 'tilt', x: 5, z: -9, ts: 1 });
  check('sanitize clamps tilt', t.x === 1 && t.z === -1);
}
// clock sync with a simulated phone clock offset and asymmetric jitter
{
  const OFFSET = 123456.7; // phone clock = host clock + OFFSET
  const cs = new ClockSync();
  let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let host = 1000;
  for (let i = 0; i < 12; i++) {
    const up = 15 + rnd() * (i % 3 === 0 ? 60 : 8), down = 15 + rnd() * 8;   // some samples with a slow uplink
    const sent = host; const phoneTs = sent + up + OFFSET; const recv = sent + up + down;
    cs.addSample(sent, recv, phoneTs); host += 500;
  }
  check('clock sync: offset within 8 ms', Math.abs(cs.offset - OFFSET) < 8, `(err ${(cs.offset - OFFSET).toFixed(1)} ms, rtt ${cs.rtt.toFixed(0)})`);
  const evPhone = 50000 + OFFSET;           // event stamped on the phone clock at host-time 50000
  check('clock sync: ageOf', Math.abs(cs.ageOf(evPhone, 50120) - 120) < 8, `(${cs.ageOf(evPhone, 50120).toFixed(1)})`);
  check('clock sync: implausible -> rtt/2 fallback', cs.ageOf(evPhone, 50000 + 99999) <= 400);
  check('clock sync: unsynced fallback', new ClockSync().ageOf(5, 100) === 30);
}
// full local pipeline: client <-> host through BroadcastChannel
{
  const room = makeRoomCode();
  const got = [], hstat = [], cstat = [], cmsgs = [];
  const host = createRemoteHost({ local: true, roomCode: room, controllerBase: 'http://localhost/controller.html', onMessage: (m) => got.push(m), onStatus: (s) => hstat.push(s.state) });
  const client = createRemoteClient({ room, local: true, makeHello: () => ({ t: 'hello', v: 1, hand: 'L', ua: 'node', calibrated: true }), onMessage: (m) => cmsgs.push(m), onStatus: (s) => cstat.push(s.state) });
  await sleep(1300);
  check('local: host connected', host.state === 'connected', JSON.stringify(hstat));
  check('local: hello delivered', got.some((m) => m.t === 'hello' && m.hand === 'L'));
  check('local: welcome received by client', cmsgs.some((m) => m.t === 'welcome' && m.player === 0));
  const ts = client.now() - 80;                       // swing happened 80 ms ago
  client.send({ t: 'swing', shot: 'topspin', side: 'bh', power: 0.7, conf: 0.9, ts });
  client.send({ t: 'tilt', x: 0.5, z: -0.25, ts: client.now() }, { unreliable: true });
  client.send({ t: 'btn', id: 'serve' });
  await sleep(1200);
  const sw = got.find((m) => m.t === 'swing');
  check('local: swing arrives with fields', sw && sw.shot === 'topspin' && sw.side === 'bh' && sw.power === 0.7, JSON.stringify(sw));
  check('local: ageMs ~ 80ms (same-clock, ~0 latency)', sw && sw.ageMs >= 75 && sw.ageMs <= 140, `(${sw && sw.ageMs.toFixed(1)})`);
  check('local: tilt + btn arrive', got.some((m) => m.t === 'tilt' && m.x === 0.5 && m.z === -0.25) && got.some((m) => m.t === 'btn' && m.id === 'serve'));
  check('local: rtt measured', host.rttMs !== null && host.rttMs < 50 && client.rttMs !== null, `(host ${host.rttMs && host.rttMs.toFixed(1)} ms, client ${client.rttMs && client.rttMs.toFixed(1)} ms)`);
  host.send({ t: 'haptic', pattern: [10, 20] });
  host.send({ t: 'state', phase: 'rally', pointText: '15-0', server: 0, youServe: true });
  await sleep(100);
  check('local: host -> phone haptic/state', cmsgs.some((m) => m.t === 'haptic' && m.pattern[1] === 20) && cmsgs.some((m) => m.t === 'state' && m.youServe === true));

  // RemoteInput against a mock sim
  const calls = [];
  const sim = { state: { match: { phase: 'rally', pointText: '0-0', server: 1 } }, setMove: (...a) => calls.push(['move', ...a]), swing: (...a) => calls.push(['swing', ...a]), pause: (b) => calls.push(['pause', b]) };
  const ri = new RemoteInput(sim, 0, host, { timingOffsetMs: 20 });
  ri.handle({ t: 'btn', id: 'shotOverride', value: 'slice' });
  ri.handle({ t: 'swing', shot: 'flat', side: 'fh', power: 0.6, ageMs: 70 });
  const sc = calls.find((c) => c[0] === 'swing');
  check('RemoteInput: swing mapped (override, ageMs+offset, source)', sc && sc[2].shot === 'slice' && sc[2].ageMs === 90 && sc[2].source === 'remote' && sc[2].side === 'fh' && sc[2].aimX === null, JSON.stringify(sc));
  ri.handle({ t: 'tilt', x: 0.3, z: 0.9 });
  check('RemoteInput: tilt -> setMove', calls.some((c) => c[0] === 'move' && c[2] === 0.3 && c[3] === 0.9));
  await sleep(600);
  check('RemoteInput: tilt watchdog zeroes movement', calls.filter((c) => c[0] === 'move').pop().slice(2).join() === '0,0');
  calls.length = 0; ri.handle({ t: 'btn', id: 'serve' });
  check('RemoteInput: serve button ignored outside serve phase', calls.length === 0);
  sim.state.match.phase = 'serve-prep'; sim.state.match.server = 0;
  ri.handle({ t: 'btn', id: 'shotOverride', value: null }); ri.handle({ t: 'btn', id: 'serve' });
  check('RemoteInput: serve button serves in serve phase', calls.length === 1 && calls[0][0] === 'swing');
  const before = cmsgs.length;
  ri.notify([{ type: 'point', winner: 1, reason: 'out' }], sim.state);
  await sleep(100);
  check('RemoteInput: notify -> haptic + state to phone', cmsgs.slice(before).some((m) => m.t === 'haptic') && cmsgs.slice(before).some((m) => m.t === 'state' && m.phase === 'serve-prep'));
  ri.destroy();
  new RemoteInput({}, 0, null).handle({ t: 'swing', shot: 'flat', side: 'fh', power: 1 });   // missing sim methods: must not throw
  check('RemoteInput: tolerates missing sim methods', true);

  // host restart -> client reconnects and resends hello
  host.close();
  const got2 = [];
  const host2 = createRemoteHost({ local: true, roomCode: room, controllerBase: 'http://localhost/controller.html', onMessage: (m) => got2.push(m) });
  await sleep(4800);
  check('local: client re-joins a restarted host and re-sends hello', got2.some((m) => m.t === 'hello'), JSON.stringify(cstat));
  host2.close(); client.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
