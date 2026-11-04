// Protocol helpers shared by host and controller (pure functions, Node-testable).
import { SHOT_TYPES, SIDES, PROTOCOL_VERSION } from '../config.js';

export { PROTOCOL_VERSION };
// 31 unambiguous characters (no 0 O 1 I L). 31^6 ~ 8.9e8 codes.
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 6;

export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  return s;
}
// Accepts user input / URL parameter; maps look-alikes (O->0 is not valid either, so just uppercase + strip).
export function normalizeRoomCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== ROOM_CODE_LEN) return null;
  for (const ch of c) if (!ROOM_ALPHABET.includes(ch)) return null;
  return c;
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

// Validate + normalize an incoming message from the untrusted other end. Returns null if unusable.
export function sanitize(m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello': return { t: 'hello', v: num(m.v, 1), hand: m.hand === 'L' ? 'L' : 'R', ua: String(m.ua || '').slice(0, 200), calibrated: !!m.calibrated };
    case 'tilt': return { t: 'tilt', x: clamp(num(m.x), -1, 1), z: clamp(num(m.z), -1, 1), ts: num(m.ts) };
    case 'swing':
      if (!SHOT_TYPES.includes(m.shot)) return null;
      return { t: 'swing', shot: m.shot, side: SIDES.includes(m.side) ? m.side : 'auto', power: clamp(num(m.power, 0.5), 0, 1),
        conf: clamp(num(m.conf, 1), 0, 1), ts: num(m.ts), feat: m.feat && typeof m.feat === 'object' ? m.feat : undefined };
    case 'btn': {
      const ids = ['serve', 'pause', 'resume', 'shotOverride'];
      if (!ids.includes(m.id)) return null;
      return { t: 'btn', id: m.id, value: m.value };
    }
    case 'ping': return { t: 'ping', id: num(m.id), ts: num(m.ts) };
    case 'pong': return { t: 'pong', id: num(m.id), ts: num(m.ts), phoneTs: m.phoneTs === undefined ? undefined : num(m.phoneTs), hostTs: m.hostTs === undefined ? undefined : num(m.hostTs) };
    case 'welcome': return { t: 'welcome', v: num(m.v, 1), player: num(m.player, 0) };
    case 'state': return { t: 'state', phase: String(m.phase || ''), pointText: String(m.pointText || ''), server: num(m.server, 0), youServe: !!m.youServe };
    case 'haptic': return { t: 'haptic', pattern: Array.isArray(m.pattern) ? m.pattern.slice(0, 12).map((x) => clamp(num(x), 0, 1000)) : [] };
    default: return null;
  }
}

// Round-trip clock estimator. A side sends {t:'ping', id, ts: localNow}; the peer answers with its own clock
// (phoneTs / hostTs). offset = remoteClock - localClock, taken from the lowest-RTT recent sample.
export class ClockSync {
  constructor(keep = 8) { this.samples = []; this.keep = keep; this.rtt = null; this.offset = null; }
  addSample(sentLocal, recvLocal, remoteClock) {
    const rtt = recvLocal - sentLocal;
    if (!(rtt >= 0) || rtt > 5000) return;
    this.samples.push({ rtt, offset: remoteClock - (sentLocal + rtt / 2) });
    if (this.samples.length > this.keep) this.samples.shift();
    const sorted = this.samples.slice().sort((a, b) => a.rtt - b.rtt);
    const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
    this.offset = best.reduce((a, s) => a + s.offset, 0) / best.length;
    this.rtt = sorted[Math.floor((sorted.length - 1) / 2)].rtt;   // median RTT for display
  }
  get ready() { return this.offset !== null; }
  // remote timestamp -> local timeline
  toLocal(remoteTs) { return remoteTs - (this.offset || 0); }
  // age (ms) of an event stamped on the remote clock, evaluated at localNow. Falls back to rtt/2 when unsynced or implausible.
  ageOf(remoteTs, localNow, fallback = 30) {
    const oneWay = this.rtt !== null ? this.rtt / 2 : fallback;
    if (this.offset === null || !Number.isFinite(remoteTs)) return clamp(oneWay, 0, 400);
    const age = localNow - this.toLocal(remoteTs);
    if (age < -20 || age > 1500) return clamp(oneWay, 0, 400);
    return clamp(age, 0, 400);
  }
}

export function ewma(prev, x, a = 0.2) { return prev === null || prev === undefined ? x : prev + (x - prev) * a; }
