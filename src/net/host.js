// Game-side remote host: owns the room, accepts one phone, does clock sync, hands decoded messages to the game.
//   const host = createRemoteHost({ onMessage, onStatus, local });
//   host.roomCode / host.controllerUrl / host.send(msg) / host.close()
// onMessage(msg): msg is a sanitized protocol message; swing/tilt/btn messages carry msg.ageMs (how long ago on the
//   host's clock the phone event physically happened, = latency compensation for sim.swing).
// onStatus(st): { state: 'starting'|'waiting'|'connected'|'stale'|'error', connected, rttMs, offsetMs, roomCode, controllerUrl, message?, hand? }
import { PROTOCOL_VERSION } from '../config.js';
import { createLink, loadQrCode } from './transport.js';
import { ClockSync, makeRoomCode, sanitize } from './protocol.js';

export { makeRoomCode, loadQrCode };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function buildControllerUrl(room, { local = false, base } = {}) {
  const u = new URL(base || 'controller.html', base ? undefined : (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
  u.search = ''; u.hash = '';
  u.searchParams.set('room', room);
  if (local) u.searchParams.set('local', '1');
  return u.href;
}

export function createRemoteHost({ onMessage = () => {}, onStatus = () => {}, local = false, controllerBase, peerOptions, roomCode } = {}) {
  let room = roomCode || makeRoomCode();
  let link = null, closed = false, tries = 0;
  const clock = new ClockSync();
  let state = 'starting', hello = null, lastRx = 0, pingId = 0, lastMsg = null;
  const pending = new Map();
  let pingTimer = null, watchTimer = null, burst = 0;

  const api = {
    get roomCode() { return room; },
    get controllerUrl() { return buildControllerUrl(room, { local, base: controllerBase }); },
    get state() { return state; },
    get rttMs() { return clock.rtt; },
    get offsetMs() { return clock.offset; },
    get hello() { return hello; },
    send(msg) { return link ? link.send(msg) : false; },
    close() { closed = true; clearInterval(pingTimer); clearInterval(watchTimer); link && link.close(); },
  };

  function status(extra = {}) {
    const st = { state, connected: state === 'connected', rttMs: clock.rtt === null ? null : Math.round(clock.rtt), offsetMs: clock.offset, roomCode: room, controllerUrl: api.controllerUrl, hand: hello && hello.hand, ...extra };
    onStatus(st);
  }
  function setState(s, extra) { state = s; status(extra); }

  function sendPing() {
    const id = ++pingId, ts = now();
    pending.set(id, ts);
    if (pending.size > 20) pending.delete(pending.keys().next().value);
    link && link.send({ t: 'ping', id, ts });
  }

  function onLinkStatus(s, detail) {
    if (closed) return;
    if (s === 'idTaken') {
      if (++tries > 6) { setState('error', { message: '无法注册房间号' }); return; }
      link.close(); room = makeRoomCode(); status({ note: 'roomCodeChanged' }); start(); return;
    }
    if (s === 'connected') { lastRx = Date.now(); burst = 5; setState('connected'); return; }
    if (s === 'waiting') { hello = null; setState('waiting', detail); return; }
    if (s === 'starting') { setState('starting'); return; }
    if (s === 'error') { setState('error', detail); return; }
  }

  function onLinkMessage(raw) {
    const m = sanitize(raw);
    if (!m) return;
    lastRx = Date.now();
    if (state === 'stale') setState('connected');
    const t2 = now();
    switch (m.t) {
      case 'hello':
        hello = m; link.send({ t: 'welcome', v: PROTOCOL_VERSION, player: 0 });
        burst = 5; setState('connected'); onMessage(m); return;
      case 'ping': link.send({ t: 'pong', id: m.id, ts: m.ts, hostTs: t2 }); return;
      case 'pong': {
        const sent = pending.get(m.id);
        if (sent !== undefined && m.phoneTs !== undefined) {
          pending.delete(m.id);
          const before = Math.round(clock.rtt || 0);
          clock.addSample(sent, t2, m.phoneTs);
          if (Math.round(clock.rtt) !== before) status();
        }
        return;
      }
      case 'tilt': case 'swing': case 'btn':
        m.ageMs = clock.ageOf(m.ts, t2);
        if (m.t === 'btn') m.ageMs = Math.min(m.ageMs, 400);
        lastMsg = m; onMessage(m); return;
      default: onMessage(m);
    }
  }

  function start() {
    link = createLink({ role: 'host', room, local, onMessage: onLinkMessage, onStatus: onLinkStatus, peerOptions });
    link.start();
  }
  start();
  let slow = 0;
  pingTimer = setInterval(() => { if (state === 'connected' || state === 'stale') { if (burst > 0) { burst--; sendPing(); } else if (++slow % 8 === 0) sendPing(); } }, 250);
  watchTimer = setInterval(() => { if (state === 'connected' && Date.now() - lastRx > 6000) setState('stale', { message: '手机无响应' }); }, 1000);
  return api;
}

// QR code rendering. Returns a Promise (the qrcode library is loaded on demand).
export async function drawQR(canvas, text, scale = 4, { dark = '#000', light = '#fff', quiet = 2 } = {}) {
  await loadQrCode();
  const qr = globalThis.qrcode(0, 'M');
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), size = (n + quiet * 2) * scale;
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = light; g.fillRect(0, 0, size, size);
  g.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  return { modules: n, size };
}
