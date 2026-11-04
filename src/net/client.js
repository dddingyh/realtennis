// Phone-side network client: connects to a host room, answers/sends pings, reports RTT.
//   const c = createRemoteClient({ room, local, onMessage, onStatus, makeHello });
//   c.send(msg, {unreliable}) / c.close() / c.rttMs / c.now()
// onStatus({state:'connecting'|'connected'|'reconnecting'|'stale'|'error', rttMs, message})
import { createLink } from './transport.js';
import { ClockSync, sanitize } from './protocol.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createRemoteClient({ room, local = false, onMessage = () => {}, onStatus = () => {}, makeHello, peerOptions } = {}) {
  let link = null, closed = false, state = 'connecting', lastRx = 0, pingId = 0;
  const clock = new ClockSync();
  const pending = new Map();
  let timer = null;
  const st = (extra) => onStatus({ state, connected: state === 'connected', rttMs: clock.rtt === null ? null : Math.round(clock.rtt), ...extra });
  const api = {
    send(msg, opts) { return link ? link.send(msg, opts) : false; },
    close() { closed = true; clearInterval(timer); link && link.close(); },
    get rttMs() { return clock.rtt; },
    get state() { return state; },
    now,
  };
  function ping() {
    const id = ++pingId, ts = now();
    pending.set(id, ts); if (pending.size > 20) pending.delete(pending.keys().next().value);
    link.send({ t: 'ping', id, ts });
  }
  link = createLink({
    role: 'client', room, local, peerOptions,
    onStatus: (s, d) => {
      if (closed) return;
      if (s === 'connected') { state = 'connected'; lastRx = now(); link.send(makeHello ? makeHello() : { t: 'hello', v: 1, hand: 'R', ua: '', calibrated: false }); st(); ping(); }
      else { state = s === 'closed' ? 'error' : s; st(d); }
    },
    onMessage: (raw) => {
      const m = sanitize(raw); if (!m) return;
      lastRx = now(); if (state === 'stale') { state = 'connected'; st(); }
      if (m.t === 'ping') { link.send({ t: 'pong', id: m.id, ts: m.ts, phoneTs: now() }); return; }
      if (m.t === 'pong') {
        const sent = pending.get(m.id);
        if (sent !== undefined) { pending.delete(m.id); const before = Math.round(clock.rtt || 0); clock.addSample(sent, now(), m.hostTs); if (Math.round(clock.rtt) !== before) st(); }
        return;
      }
      onMessage(m);
    },
  });
  link.start();
  timer = setInterval(() => {
    if (state === 'connected') { ping(); if (now() - lastRx > 6000) { state = 'stale'; st({ message: '主机无响应' }); } }
  }, 1500);
  return api;
}
