// Transports: PeerJS data channels (internet / LAN, via the public PeerJS signalling server) and a
// BroadcastChannel transport (same browser, ?local=1) used for development and automated tests.
// Link interface (both roles):  new XLink({...,onMessage(obj), onStatus(state, detail)})  .start()  .send(obj,{unreliable})  .close()
//   host states:   'starting' | 'waiting' | 'connected' | 'idTaken' | 'error'
//   client states: 'connecting' | 'connected' | 'reconnecting' | 'error'
import { PEER_ID_PREFIX } from '../config.js';

const scriptCache = new Map();
export function loadScript(url, globalName) {
  if (globalName && typeof globalThis !== 'undefined' && globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (scriptCache.has(url)) return scriptCache.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => (globalName && !globalThis[globalName] ? reject(new Error(globalName + ' missing after load')) : resolve(globalName ? globalThis[globalName] : true));
    s.onerror = () => { scriptCache.delete(url); reject(new Error('failed to load ' + url)); };
    document.head.appendChild(s);
  });
  scriptCache.set(url, p);
  return p;
}
export const loadPeerJs = () => loadScript(new URL('../../vendor/peerjs.min.js', import.meta.url).href, 'Peer');
export const loadQrCode = () => loadScript(new URL('../../vendor/qrcode.js', import.meta.url).href, 'qrcode');

export const peerIdFor = (room) => PEER_ID_PREFIX + room;

// ICE servers. PeerJS's default list only has Google STUN, which is unreachable from mainland China;
// without a reachable STUN server the peers can only use mDNS host candidates, which many routers block.
// Order: STUN servers reachable in mainland China first, then global ones, then the PeerJS public TURN relay.
export const ICE_SERVERS = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
const peerOpts = (extra = {}) => ({ debug: 1, ...extra, config: { iceServers: ICE_SERVERS, ...(extra.config || {}) } });
const ICE_CN = { new: '准备中', checking: '正在打洞', connected: '已连通', completed: '已连通', disconnected: '中断', failed: '失败', closed: '已关闭' };
// Watch a DataConnection's ICE state (peerConnection is created lazily, so poll for it briefly).
function watchIce(conn, cb) {
  let tries = 0;
  const attach = () => {
    const pc = conn.peerConnection;
    if (!pc) { if (++tries < 40) setTimeout(attach, 100); return; }
    const report = () => cb(pc.iceConnectionState, ICE_CN[pc.iceConnectionState] || pc.iceConnectionState);
    pc.addEventListener('iceconnectionstatechange', report); report();
  };
  attach();
}
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- BroadcastChannel
export class LocalLink {
  constructor({ role, room, onMessage, onStatus }) {
    this.role = role; this.room = room; this.onMessage = onMessage; this.onStatus = onStatus;
    this.id = uid(); this.peerId = null; this.lastRx = 0; this.state = null; this.timers = [];
  }
  start() {
    this.bc = new BroadcastChannel('realtennis-local-' + this.room);
    this.bc.onmessage = (ev) => this._rx(ev.data);
    this._set(this.role === 'host' ? 'waiting' : 'connecting');
    const tick = () => {
      const now = Date.now();
      if (this.role === 'client') {
        if (this.state !== 'connected' || now - this.lastRx > 3500) {
          if (this.state === 'connected') this._set('reconnecting');
          this._post({ k: 'join' });
        } else this._post({ k: 'hb' });
      } else {
        if (this.state === 'connected') { if (now - this.lastRx > 3500) { this.peerId = null; this._set('waiting'); } else this._post({ k: 'hb' }); }
      }
    };
    this.timers.push(setInterval(tick, 1000));
    tick();
    return Promise.resolve();
  }
  _set(s, d) { if (this.state !== s) { this.state = s; this.onStatus && this.onStatus(s, d); } }
  _post(o) { try { this.bc.postMessage({ ...o, from: this.role, id: this.id, to: this.peerId }); } catch (e) { /* closed */ } }
  _rx(m) {
    if (!m || m.from === this.role || m.id === this.id) return;
    if (this.role === 'host') {
      if (m.k === 'join') { this.peerId = m.id; this.lastRx = Date.now(); this._post({ k: 'joined' }); this._set('connected'); return; }
      if (m.id !== this.peerId) return;
    } else {
      if (m.to && m.to !== this.id) return;
      if (this.peerId && m.id !== this.peerId) { this.peerId = null; this._set('reconnecting'); this._post({ k: 'join' }); return; } // host restarted
      if (m.k === 'joined' || m.k === 'hb' || m.k === 'data') { this.peerId = m.id; this._set('connected'); }
    }
    this.lastRx = Date.now();
    if (m.k === 'data') this.onMessage(m.d);
  }
  send(obj) { if (this.state !== 'connected') return false; this._post({ k: 'data', d: obj }); return true; }
  close() { this.timers.forEach(clearInterval); this.timers = []; try { this.bc.close(); } catch (e) { /* */ } this._set('closed'); }
}

// ---------------------------------------------------------------- PeerJS host
export class PeerHostLink {
  constructor({ room, onMessage, onStatus, peerOptions = {} }) {
    this.room = room; this.onMessage = onMessage; this.onStatus = onStatus; this.peerOptions = peerOptions;
    this.main = null; this.tilt = null; this.closed = false; this.retryTimer = null; this.retries = 0;
  }
  async start() {
    this.onStatus('starting');
    try { await loadPeerJs(); } catch (e) { this.onStatus('error', { message: '无法加载 PeerJS 库' }); return; }
    this._open();
  }
  _open() {
    if (this.closed) return;
    const Peer = globalThis.Peer;
    const peer = this.peer = new Peer(peerIdFor(this.room), peerOpts(this.peerOptions));
    peer.on('open', () => { this.retries = 0; this.onStatus(this.main ? 'connected' : 'waiting'); });
    peer.on('connection', (conn) => this._adopt(conn));
    peer.on('disconnected', () => { if (!this.closed) { this.onStatus('error', { message: '与信令服务器断开，重连中…', transient: true }); this._later(() => { try { peer.reconnect(); } catch (e) { this._recreate(); } }); } });
    peer.on('error', (err) => {
      if (this.closed) return;
      if (err.type === 'unavailable-id') { this.onStatus('idTaken'); return; }
      this.onStatus('error', { message: '信令错误: ' + err.type, type: err.type, transient: true });
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) this._later(() => (peer.disconnected && !peer.destroyed ? peer.reconnect() : this._recreate()));
    });
  }
  _later(fn) { clearTimeout(this.retryTimer); const d = Math.min(8000, 1000 * ++this.retries); this.retryTimer = setTimeout(() => { if (!this.closed) fn(); }, d); }
  _recreate() { try { this.peer.destroy(); } catch (e) { /* */ } this._open(); }
  _adopt(conn) {
    const ch = conn.metadata && conn.metadata.ch;
    if (ch !== 'tilt' && !this.main) {
      this.onStatus('pairing', { message: '发现手机，正在建立点对点连接…' });
      watchIce(conn, (st, cn) => {
        if (this.main) return;
        if (st === 'failed') this.onStatus('waiting', { message: '点对点连接失败（网络限制），请确认手机与电脑在同一 Wi‑Fi，或换用手机热点', iceFailed: true });
        else if (st !== 'connected' && st !== 'completed') this.onStatus('pairing', { message: '发现手机，点对点连接：' + cn });
      });
    }
    conn.on('open', () => {
      if (ch === 'tilt') { this.tilt = conn; }
      else { if (this.main && this.main !== conn) { try { this.main.close(); } catch (e) { /* */ } } this.main = conn; this.onStatus('connected'); }
    });
    conn.on('data', (d) => { try { this.onMessage(typeof d === 'string' ? JSON.parse(d) : d); } catch (e) { /* ignore */ } });
    conn.on('close', () => {
      if (conn === this.tilt) this.tilt = null;
      if (conn === this.main) { this.main = null; this.onStatus('waiting', { reason: 'closed' }); }
    });
    conn.on('error', () => { /* close follows */ });
  }
  send(obj) { if (this.main && this.main.open) { this.main.send(obj); return true; } return false; }
  close() { this.closed = true; clearTimeout(this.retryTimer); try { this.peer && this.peer.destroy(); } catch (e) { /* */ } }
}

// ---------------------------------------------------------------- PeerJS client (phone)
export class PeerClientLink {
  constructor({ room, onMessage, onStatus, peerOptions = {} }) {
    this.room = room; this.onMessage = onMessage; this.onStatus = onStatus; this.peerOptions = peerOptions;
    this.main = null; this.tilt = null; this.closed = false; this.timer = null; this.attempt = 0; this.openTimer = null;
  }
  async start() {
    this.onStatus('connecting');
    try { await loadPeerJs(); } catch (e) { this.onStatus('error', { message: '无法加载 PeerJS 库' }); return; }
    this._peer();
  }
  _peer() {
    if (this.closed) return;
    const peer = this.peer = new globalThis.Peer(undefined, peerOpts(this.peerOptions));
    peer.on('open', () => { this.onStatus('connecting', { message: '已连上信令服务器，正在寻找主机…' }); this._connect(); });
    peer.on('disconnected', () => { if (!this.closed && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* */ } } });
    peer.on('error', (err) => {
      if (this.closed) return;
      this.onStatus(err.type === 'peer-unavailable' ? 'reconnecting' : 'error', { message: err.type === 'peer-unavailable' ? '找不到主机，房间号可能不对或游戏页未打开' : '网络错误: ' + err.type, type: err.type, transient: true });
      if (err.type === 'peer-unavailable') this._retry(() => this._connect());
      else if (['network', 'server-error', 'socket-error', 'socket-closed', 'webrtc', 'unavailable-id'].includes(err.type)) this._retry(() => { try { peer.destroy(); } catch (e) { /* */ } this._peer(); });
    });
  }
  _retry(fn) { clearTimeout(this.timer); const d = Math.min(6000, 800 + 800 * this.attempt++); this.timer = setTimeout(() => { if (!this.closed) fn(); }, d); }
  _connect() {
    if (this.closed || !this.peer || this.peer.destroyed || !this.peer.open) return;
    const hostId = peerIdFor(this.room);
    try { this.main && this.main.close(); this.tilt && this.tilt.close(); } catch (e) { /* */ }
    const main = this.main = this.peer.connect(hostId, { reliable: true, serialization: 'json', metadata: { ch: 'main' } });
    clearTimeout(this.openTimer);
    let ice = 'new';
    watchIce(main, (st, cn) => { ice = st; if (main === this.main && !main.open) this.onStatus('connecting', { message: '点对点连接：' + cn + (st === 'failed' ? '（网络限制，见说明文档）' : '') }); });
    this.openTimer = setTimeout(() => { if (main === this.main && !main.open) { this.onStatus('reconnecting', { message: ice === 'new' ? '主机无应答，重试中…（确认电脑端游戏页已打开且房间号一致）' : '点对点连接超时（' + (ICE_CN[ice] || ice) + '），重试中…', transient: true }); this._retry(() => this._connect()); } }, 15000);
    main.on('open', () => {
      clearTimeout(this.openTimer); this.attempt = 0;
      this.onStatus('connected');
      const t = this.tilt = this.peer.connect(hostId, { reliable: false, serialization: 'json', metadata: { ch: 'tilt' } });
      t.on('close', () => { if (this.tilt === t) this.tilt = null; });
    });
    main.on('data', (d) => { try { this.onMessage(typeof d === 'string' ? JSON.parse(d) : d); } catch (e) { /* */ } });
    main.on('close', () => { if (main === this.main && !this.closed) { this.onStatus('reconnecting', { message: '连接断开，重连中…', transient: true }); this._retry(() => this._connect()); } });
    main.on('error', () => { /* close follows */ });
  }
  send(obj, { unreliable = false } = {}) {
    const c = unreliable && this.tilt && this.tilt.open ? this.tilt : this.main;
    if (c && c.open) { c.send(obj); return true; }
    return false;
  }
  close() { this.closed = true; clearTimeout(this.timer); clearTimeout(this.openTimer); try { this.peer && this.peer.destroy(); } catch (e) { /* */ } }
}

export function createLink({ role, room, local, onMessage, onStatus, peerOptions }) {
  const C = local ? LocalLink : role === 'host' ? PeerHostLink : PeerClientLink;
  return new C({ role, room, onMessage, onStatus, peerOptions });
}
