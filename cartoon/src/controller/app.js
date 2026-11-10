// Phone-as-racket controller for the cartoon arcade tennis (cartoon/controller.html).
//   ?room=ABC234   room code (otherwise typed in)      &local=1  BroadcastChannel transport (same-browser testing)
//   &sim=1         desktop sensor simulator (synthetic IMU through the REAL gesture pipeline)      &debug=1  debug panel
// Flow: secure-context check -> 开始 (sensor permission) -> 左手/右手 -> (optional 试挥) -> play.
import { createArcadeGesture, toSwingMessage } from './arcade_gesture.js';
import { PhoneSim } from '../../../src/controller/simtrace.js';
import { createRemoteClient } from '../../../src/net/client.js';
import { normalizeRoomCode } from '../../../src/net/protocol.js';
import { PROTOCOL_VERSION } from '../../../src/config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim') && params.get('sim') !== '0';
const LOCAL = params.get('local') === '1';
const STORE_KEY = 'realtennis.arcade.ctl.v1';
const SHOT_CN = { topspin: '上旋', flat: '平击', slice: '切削', lob: '挑高', volley: '截击', smash: '高压', serve: '发球' };
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const CAN_VIBRATE = typeof navigator.vibrate === 'function';

// ---------------------------------------------------------------- persistence (per-viewer conveniences only)
function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ hand: S.hand, vib: S.vib, snd: S.snd, adj: S.adj, accSign: S.accSign, warmed: S.warmed })); } catch (e) { /* private mode */ }
}
const saved = load();
const S = {
  hand: saved.hand === 'L' || saved.hand === 'R' ? saved.hand : null,
  vib: saved.vib !== false, snd: saved.snd !== false, adj: Number.isFinite(saved.adj) ? saved.adj : 0,
  accSign: saved.accSign || (IS_IOS ? -1 : 1), warmed: !!saved.warmed,
  room: normalizeRoomCode(params.get('room')) || null,
  override: null, held: new Set(), paused: false, demo: false,
  zone: 'base', zoneGuess: null, youServe: false, tossUp: false, phase: '', pointText: '',
  clockOffset: 0, samples: 0, swings: 0, sent: 0, warmCount: 0, mode: 'intro', timings: [],
  net: { state: 'connecting', message: '', rtt: null }, lastSwing: null,
};
let gesture = makeGesture();
function makeGesture() { return createArcadeGesture({ hand: S.hand || 'R', accSign: S.accSign }); }

// ---------------------------------------------------------------- small helpers
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
  S.mode = id.replace('s-', '');
  document.body.classList.toggle('playing', id === 's-play');
}
function vibrate(p) { if (S.vib && CAN_VIBRATE) { try { navigator.vibrate(p); } catch (e) { /* */ } } }
const stopBubble = (e) => e.preventDefault();

// ---------------------------------------------------------------- sound (tiny WebAudio blips, created after the first tap)
const snd = {
  ctx: null,
  init() { if (this.ctx || typeof AudioContext === 'undefined') return; try { this.ctx = new AudioContext(); } catch (e) { /* */ } },
  resume() { try { this.ctx && this.ctx.state !== 'running' && this.ctx.resume(); } catch (e) { /* */ } },
  tone(f, d = 0.09, type = 'triangle', vol = 0.18, when = 0, f2 = null) {
    if (!S.snd || !this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + d + 0.02);
  },
  swing() { this.tone(520, 0.07, 'sine', 0.1, 0, 220); },
  good() { this.tone(660, 0.1, 'triangle', 0.2); this.tone(990, 0.16, 'triangle', 0.2, 0.09); },
  ok() { this.tone(440, 0.09, 'triangle', 0.18); },
  bad() { this.tone(200, 0.16, 'sawtooth', 0.12, 0, 120); },
  net() { this.tone(330, 0.08, 'square', 0.08); this.tone(495, 0.1, 'square', 0.08, 0.07); },
};

// ---------------------------------------------------------------- connection status (信令 / 找主机 / 点对点)
let client = null;
function stageOf(st) {
  if (st.state === 'connected') return 4;
  const m = st.message || '';
  if (/点对点/.test(m)) return 3;
  if (/寻找主机|找不到主机|主机无应答|房间号/.test(m)) return 2;
  if (LOCAL) return 2;
  return 1;
}
function renderNet() {
  const st = S.net, ok = st.state === 'connected';
  document.body.classList.toggle('connected', ok);
  const pill = $('conn-pill');
  const map = { connected: ['ok', '已连接'], connecting: ['', '连接中…'], reconnecting: ['', '重连中…'], stale: ['bad', '主机无响应'], error: ['bad', '连接出错'] };
  const [cls, txt] = S.demo ? ['', '离线试玩'] : S.room || client ? (map[st.state] || ['', st.state]) : ['', '未连接'];
  pill.className = 'pill ' + cls; $('conn-text').textContent = txt;
  const r = $('rtt');
  r.textContent = ok && st.rtt != null ? `延迟 ${st.rtt} ms` : S.demo ? '' : '— ms';
  r.className = 'rtt' + (ok && st.rtt != null ? (st.rtt < 60 ? ' good' : st.rtt < 130 ? ' mid' : ' slow') : '');
  const stage = stageOf(st);
  document.querySelectorAll('#conn-steps span').forEach((el, i) => { el.className = i + 1 < stage ? 'done' : i + 1 === stage ? 'now' : ''; });
  $('conn-msg').textContent = ok ? '' : (st.message || (client ? '' : '输入房间号后开始连接'));
  $('conn-steps').hidden = S.demo;
  // play-screen overlay while the link is down
  const off = S.mode === 'play' && !S.demo && !ok;
  $('offline-overlay').hidden = !off;
  if (off) { $('offline-title').textContent = st.state === 'stale' ? '主机无响应' : '连接中断'; $('offline-msg').textContent = st.message || '正在重连，挥拍暂时发不出去…'; }
  $('btn-net').classList.toggle('off', S.mode === 'play' && !S.demo && !ok);
}
function connect() {
  if (client || !S.room) return;
  client = createRemoteClient({
    room: S.room, local: LOCAL,
    makeHello: () => ({ t: 'hello', v: PROTOCOL_VERSION, hand: S.hand || 'R', ua: navigator.userAgent.slice(0, 120), calibrated: false }),
    onStatus: (st) => { S.net = { state: st.state, message: st.message || '', rtt: st.rttMs }; renderNet(); },
    onMessage: onNetMessage,
  });
  renderNet();
}
const send = (m, o) => (client ? client.send(m, o) : false);
function sendHello() { send({ t: 'hello', v: PROTOCOL_VERSION, hand: S.hand || 'R', ua: '', calibrated: false }); }

// ---------------------------------------------------------------- host -> phone
function onNetMessage(m) {
  if (m.t === 'haptic') vibrate(m.pattern);
  else if (m.t === 'fb') showFeedback(m);
  else if (m.t === 'state') applyState(m);
}
const ZONE_UI = {
  base: ['上网', '冲到网前截击', 'M32 4V16M26 10L32 4L38 10'],
  net: ['回底线', '退回底线防守', 'M32 16V4M26 10L32 16L38 10'],
  toNet: ['上网中…', '再点一下：撤回底线', 'M32 4V16M26 10L32 4L38 10'],
  toBase: ['回防中…', '再点一下：再次上网', 'M32 16V4M26 10L32 16L38 10'],
};
function renderZone() {
  const z = S.zoneGuess || S.zone;
  const btn = $('btn-net'), ui = ZONE_UI[z] || ZONE_UI.base;
  btn.dataset.zone = z; $('net-title').textContent = ui[0]; $('net-sub').textContent = ui[1]; $('net-arrow').setAttribute('d', ui[2]);
}
function applyState(m) {
  S.phase = m.phase; S.pointText = m.pointText; S.youServe = m.youServe; S.tossUp = m.tossUp;
  if (m.zone) { S.zone = m.zone; S.zoneGuess = null; clearTimeout(S.guessTimer); }
  renderZone();
  const srv = $('srv');
  if (m.phase === 'match-over') { srv.textContent = '比赛结束'; srv.className = 'srv'; }
  else { srv.textContent = m.youServe ? '你发球' : '对手发球'; srv.className = 'srv' + (m.youServe ? ' you' : ''); }
  $('pt').textContent = m.pointText || '—';
  const sp = $('serve-prompt');
  const serving = m.youServe && m.phase === 'serving' && !m.paused;          // the sim accepts the toss / serve swings only in 'serving'
  const prep = m.youServe && m.phase === 'serve-prep' && !m.paused;
  sp.hidden = !(serving || prep); $('s-play').classList.toggle('serving', serving || prep);
  if (prep) { sp.className = 'serve-prompt wait'; sp.innerHTML = '准备发球…<small>马上就轮到你抛球</small>'; }
  else if (serving) {
    sp.className = 'serve-prompt' + (m.tossUp ? '' : ' up');
    sp.innerHTML = m.tossUp ? '再挥拍：发球！<small>球到最高点时挥，越准越快</small>' : '挥拍抛球<small>抛起后再挥一次拍发球</small>';
  }
  if (m.paused !== S.paused) { S.paused = m.paused; renderPause(); }
}
function renderPause() { $('pause-overlay').hidden = !S.paused; $('btn-pause').textContent = S.paused ? '▶' : '⏸'; }

const WHIFF_WHY = { early: '挥早了，球还没到', late: '挥晚了，球已经过去', noball: '现在没有球可打', reach: '没够着球', toss: '没接到抛起的球', serve: '发球挥空了' };
const TIMING = {
  early: ['早', 't-early'], perfect: ['准！', 't-perfect'], late: ['晚', 't-late'], wide: ['', 't-wide'], whiff: ['挥空', 't-whiff'],
};
function showFeedback(m) {
  const card = $('fbcard');
  let [word, cls] = TIMING[m.timing] || ['', ''];
  if (m.timing === 'wide') word = m.timingMs < 0 ? '太早' : '太晚';
  card.className = 'fbcard ' + cls;
  $('fb-main').textContent = word || '—';
  const ms = Math.abs(Math.round(m.timingMs));
  let line = '';
  if (m.timing === 'whiff') line = WHIFF_WHY[m.mishit] || '没打到球';
  else if (m.timing === 'perfect') line = ms ? `${ms} ms · 完美` : '完美时机';
  else if (m.timing === 'early' || (m.timing === 'wide' && m.timingMs < 0)) line = `早了 ${ms} ms`;
  else if (m.timing === 'late' || m.timing === 'wide') line = `晚了 ${ms} ms`;
  if (m.mishit && m.timing !== 'whiff') line += '　手滑了';
  const sh = $('fb-shot'); sh.textContent = m.timing === 'whiff' ? '—' : (m.serve ? '发球' : SHOT_CN[m.shot] || m.shot || '—');
  // direction arrow: -1 = ball goes to the player's left, +1 = right
  const dir = m.timing === 'whiff' ? 0 : m.dir;
  $('fb-arrow-g').setAttribute('transform', `rotate(${(dir * 55).toFixed(0)})`);
  $('fb-arrow').style.opacity = m.timing === 'whiff' ? '.25' : '1';
  $('fb-arrow').setAttribute('aria-label', Math.abs(dir) < 0.2 ? '球打向中路' : dir < 0 ? '球打向左边' : '球打向右边');
  if (m.timing !== 'whiff' && Math.abs(dir) >= 0.2) line = line + (line ? '　' : '') + (dir < 0 ? '球去左边' : '球去右边'); else if (m.timing !== 'whiff') line = line + (line ? '　' : '') + '球去中路';
  $('fb-ms').textContent = line;
  const n = m.timing === 'whiff' ? 0 : Math.max(1, Math.round(m.quality * 5));
  $('fb-stars').innerHTML = [0, 1, 2, 3, 4].map((i) => (i < n ? '<b>★</b>' : '<i>★</i>')).join('');
  void card.offsetWidth; card.classList.add('flash');
  if (m.timing === 'perfect') snd.good(); else if (m.timing === 'whiff' || m.timing === 'wide') snd.bad(); else snd.ok();
  if (m.timing === 'early' || m.timing === 'late' || m.timing === 'perfect') { S.timings.push(m.timingMs); if (S.timings.length > 12) S.timings.shift(); }
}

// ---------------------------------------------------------------- sensors
let sensorsOn = false, lastSampleAt = 0, rateEma = 0, phoneSim = null, simTimer = null, simLast = 0;
function onMotion(e) {
  const now = performance.now();
  const rot = e.rotationRate, accG = e.accelerationIncludingGravity;
  if (!accG || accG.x === null || accG.x === undefined) return;
  let t = e.timeStamp;
  if (!(t > 0) || Math.abs(t - now) > 500) t = now;      // epoch / odd timelines: use arrival time
  const acc = e.acceleration && e.acceleration.x !== null ? { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z } : null;
  if (lastSampleAt) rateEma = rateEma ? rateEma * 0.95 + (now - lastSampleAt) * 0.05 : now - lastSampleAt;
  lastSampleAt = now;
  S.clockOffset = 0;                                       // sample times are already on the performance.now() timeline
  feed({ t, acc, accG: { x: accG.x, y: accG.y, z: accG.z }, rot: rot ? { alpha: rot.alpha || 0, beta: rot.beta || 0, gamma: rot.gamma || 0 } : null });
}
function newPhoneSim(hz = 60) { return new PhoneSim({ hand: S.hand || 'R', hz, seed: (Math.random() * 1e6) | 0 }); }
function startSensors() {
  if (sensorsOn) return;
  sensorsOn = true;
  if (SIM) {
    phoneSim = newPhoneSim(60);
    simLast = performance.now();
    simTimer = setInterval(() => {
      const n = performance.now();
      const ms = Math.min(100, Math.max(1, Math.round(n - simLast))); simLast += ms;
      const batch = phoneSim.advance(ms);
      S.clockOffset = n - phoneSim.tick;                   // sample timeline (ms ticks) -> performance.now()
      for (const s of batch) { lastSampleAt = n; feed(s); }
    }, 16);
  } else {
    window.addEventListener('devicemotion', onMotion);
  }
}
function waitForSamples(ms) {
  return new Promise((res) => { const t0 = performance.now(); const iv = setInterval(() => { if (S.samples > 5 || performance.now() - t0 > ms) { clearInterval(iv); res(S.samples > 5); } }, 50); });
}

// ---------------------------------------------------------------- swing pipeline
function feed(s) {
  S.samples++;
  for (const ev of gesture.push(s)) onSwing(ev);
}
function onSwing(ev) {
  S.swings++; S.lastSwing = ev;
  if (S.mode === 'warm') { warmSwing(ev); return; }
  if (S.mode !== 'play') return;
  const msg = toSwingMessage(ev, { clockOffsetMs: S.clockOffset, adjustMs: S.adj, override: S.override });
  let delivered = false;
  if (!S.paused) delivered = send(msg);
  if (delivered) S.sent++;
  snd.swing();
  const loc = $('fb-local');
  loc.textContent = `${S.demo || delivered ? '' : '⚠ 未连接　'}识别：${SHOT_CN[msg.shot]}　力度 ${Math.round(msg.power * 100)}`;
  if ($('fbcard').classList.contains('idle')) { $('fb-main').textContent = '挥！'; }
  if (!delivered && !S.demo && !S.paused) toast('未连接到游戏，这一拍没有送出');
}

// ---------------------------------------------------------------- flow
async function onStart() {
  const btn = $('btn-start'); btn.disabled = true;
  snd.init(); snd.resume();
  let pm = null, po = null;
  if (!SIM) {   // permission requests must be issued synchronously inside the tap (iOS)
    try { if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') pm = DeviceMotionEvent.requestPermission(); } catch (e) { pm = Promise.reject(e); }
    try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') po = DeviceOrientationEvent.requestPermission(); } catch (e) { po = Promise.resolve('skipped'); }
  }
  if (!S.room && !S.demo) {
    const code = normalizeRoomCode($('room-input').value);
    if (!code) { toast('请输入游戏画面上的 6 位房间号'); btn.disabled = false; return; }
    S.room = code; connect();
  }
  try {
    if (pm) { const r = await pm; if (r !== 'granted') throw new Error('denied'); }
    if (po) { try { await po; } catch (e) { /* orientation permission is optional for us */ } }
  } catch (e) {
    $('intro-hint').innerHTML = '没有获得“动作与方向”权限。请到 <b>设置 → Safari → 动作与方向访问</b> 打开，然后关闭本页重新扫码；或清除网站数据后重试。';
    btn.disabled = false; return;
  }
  startSensors();
  const ok = await waitForSamples(SIM ? 400 : 1800);
  if (!ok) { $('intro-hint').textContent = '没有收到传感器数据。请确认用的是 HTTPS 页面、手机有陀螺仪，并在浏览器设置里允许“动作与方向”。'; btn.disabled = false; return; }
  btn.disabled = false;
  if (!S.hand) show('s-hand'); else afterHand();
}
function afterHand() { if (S.warmed) enterPlay(); else enterWarm(); }
function setHand(h) {
  S.hand = h; gesture.setHand(h); save(); sendHello();   // (the simulator's pose model keeps its initial handedness: swapping it mid-run would teleport the virtual phone)
}

function enterWarm() {
  S.warmCount = 0; show('s-warm');
  document.querySelectorAll('#warm-dots b').forEach((b) => b.classList.remove('on'));
  $('warm-shot').textContent = '?'; $('warm-meta').textContent = '等你挥拍…'; $('warm-power').style.width = '0';
  $('btn-warm-go').classList.remove('ready');
}
function warmSwing(ev) {
  S.warmCount++;
  const sh = $('warm-shot'); sh.textContent = SHOT_CN[ev.shot]; sh.classList.remove('pop'); void sh.offsetWidth; sh.classList.add('pop');
  $('warm-meta').textContent = `力度 ${Math.round(ev.power * 100)}`;
  $('warm-power').style.width = Math.round(ev.power * 100) + '%';
  document.querySelectorAll('#warm-dots b').forEach((b, i) => b.classList.toggle('on', i < S.warmCount));
  snd.swing(); vibrate(25);
  if (S.warmCount >= 2) { $('btn-warm-go').classList.add('ready'); $('warm-meta').textContent += '　太棒了，可以开打！'; }
}

let wakeLock = null;
async function requestWake() { try { if (navigator.wakeLock && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* denied / unsupported */ } }
function enterPlay() {
  S.warmed = true; save();
  show('s-play'); requestWake(); renderZone(); renderNet();
  if (!S.demo && !client) connect();
  try { screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(() => {}); } catch (e) { /* */ }
  const idle = $('fbcard'); idle.className = 'fbcard idle'; $('fb-main').textContent = '挥拍！';
  $('fb-stars').innerHTML = '<i>★</i><i>★</i><i>★</i><i>★</i><i>★</i>';
  $('fb-arrow-g').setAttribute('transform', 'rotate(0)');
  if (S.demo) { $('srv').textContent = '离线试玩'; $('pt').textContent = '—'; }
}

// ---------------------------------------------------------------- play controls
function bindPlay() {
  const net = $('btn-net');
  const toggleNet = (e) => {
    e && e.preventDefault();
    if (S.paused) return;
    const cur = S.zoneGuess || S.zone;
    const goingToNet = cur === 'base' || cur === 'toBase';
    S.zoneGuess = goingToNet ? 'toNet' : 'toBase';          // optimistic; the host's state corrects it
    clearTimeout(S.guessTimer); S.guessTimer = setTimeout(() => { S.zoneGuess = null; renderZone(); }, 900);
    renderZone();
    const ok = send({ t: 'btn', id: 'net', value: 'toggle' });
    if (!ok && !S.demo) { net.classList.remove('nudge'); void net.offsetWidth; net.classList.add('nudge'); toast('未连接到游戏'); }
    vibrate(18); snd.net();
  };
  net.addEventListener('pointerdown', (e) => { net.classList.add('pressed'); toggleNet(e); });
  const rel = () => net.classList.remove('pressed');
  net.addEventListener('pointerup', rel); net.addEventListener('pointercancel', rel); net.addEventListener('pointerleave', rel);
  net.addEventListener('click', (e) => e.preventDefault());

  // hold-to-force chips
  document.querySelectorAll('.chip.hold').forEach((b) => {
    const shot = b.dataset.shot;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      S.held.add(shot); S.override = shot; b.classList.add('held'); clearTimeout(S.ovTimer);
      send({ t: 'btn', id: 'shotOverride', value: shot }); vibrate(10);
    });
    const up = () => {
      if (!S.held.has(shot)) return; S.held.delete(shot); b.classList.remove('held'); clearTimeout(S.ovTimer);
      S.ovTimer = setTimeout(() => { if (!S.held.size) { S.override = null; send({ t: 'btn', id: 'shotOverride', value: null }); } }, 700);   // keep for the swing that follows the release
    };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  const tog = (id, key, label) => {
    const el = $(id);
    const paint = () => { el.setAttribute('aria-pressed', String(S[key])); };
    paint();
    el.addEventListener('click', () => { S[key] = !S[key]; paint(); save(); if (key === 'vib' && S.vib) vibrate(30); if (key === 'snd') snd.ok(); toast(`${label}${S[key] ? '开' : '关'}${key === 'vib' && !CAN_VIBRATE ? '（此设备不支持震动）' : ''}`, 1200); });
  };
  tog('tog-snd', 'snd', '声音'); tog('tog-vib', 'vib', '震动');

  const setPause = (p) => { S.paused = p; renderPause(); send({ t: 'btn', id: p ? 'pause' : 'resume' }); vibrate(15); };
  $('btn-pause').addEventListener('click', () => setPause(!S.paused));
  $('btn-resume').addEventListener('click', () => setPause(false));
}

// ---------------------------------------------------------------- settings
const segSet = (id, val) => document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', String(b.dataset.v) === String(val)));
function avgTiming() { return S.timings.length >= 4 ? S.timings.reduce((a, b) => a + b, 0) / S.timings.length : null; }
function refreshSettings() {
  segSet('set-hand', S.hand || 'R'); segSet('set-vib', S.vib ? 1 : 0); segSet('set-snd', S.snd ? 1 : 0); segSet('set-sign', S.accSign);
  $('set-adj').value = S.adj; $('adj-val').textContent = S.adj === 0 ? '0 ms' : S.adj > 0 ? `提前 ${S.adj} ms` : `延后 ${-S.adj} ms`;
  const a = avgTiming();
  $('adj-stat').textContent = a === null ? '最近还没有足够的击球数据（需要 4 次以上）' : `最近 ${S.timings.length} 次平均：${a >= 0 ? '晚' : '早'} ${Math.abs(Math.round(a))} ms（如果你没有故意拉斜线/直线，可以按它校正）`;
  $('btn-adj-auto').disabled = a === null;
  $('vib-note').textContent = CAN_VIBRATE ? '击球时手机震一下' : '此设备 / 浏览器不支持震动（iPhone 一律不支持）';
}
function bindSettings() {
  const open = () => { refreshSettings(); $('sheet').hidden = false; };
  $('btn-settings').addEventListener('click', open);
  $('btn-sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });
  const seg = (id, fn) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => { fn(b.dataset.v); refreshSettings(); save(); }));
  seg('set-hand', (v) => setHand(v));
  seg('set-vib', (v) => { S.vib = v === '1'; $('tog-vib').setAttribute('aria-pressed', String(S.vib)); if (S.vib) vibrate(30); });
  seg('set-snd', (v) => { S.snd = v === '1'; $('tog-snd').setAttribute('aria-pressed', String(S.snd)); snd.ok(); });
  seg('set-sign', (v) => { S.accSign = Number(v); gesture = makeGesture(); toast('已切换重力方向'); });
  $('set-adj').addEventListener('input', (e) => { S.adj = Number(e.target.value); refreshSettings(); save(); });
  $('btn-adj-zero').addEventListener('click', () => { S.adj = 0; refreshSettings(); save(); });
  $('btn-adj-auto').addEventListener('click', () => { const a = avgTiming(); if (a === null) return; S.adj = Math.max(-150, Math.min(150, Math.round(S.adj + a))); S.timings = []; refreshSettings(); save(); toast(`已校正：${S.adj > 0 ? '提前' : '延后'} ${Math.abs(S.adj)} ms`); });
  $('btn-rewarm').addEventListener('click', () => { $('sheet').hidden = true; enterWarm(); });
  setInterval(() => {
    if ($('sheet').hidden && params.get('debug') !== '1') return;
    const st = gesture.stats, d = st.delays, l = S.lastSwing;
    const avg = d.length ? (d.reduce((a, b) => a + b, 0) / d.length).toFixed(0) : '-';
    $('debug').textContent = `samples ${S.samples}  interval ${rateEma.toFixed(1)} ms  swings ${S.swings} sent ${S.sent}  shake-rejected ${st.shakeRejected}\nIOS ${IS_IOS} accSign ${S.accSign}  peak->emit avg ${avg} ms  rtt ${S.net.rtt}\n` + (l ? `last: ${l.shot} p${l.power} c${l.conf} rise ${l.rise} face ${l.face} v ${l.speedDps} unsure ${l.unsure}` : '');
  }, 300);
}

// ---------------------------------------------------------------- desktop simulator
function bindSim() {
  const panel = $('simpanel'); panel.hidden = false; document.body.classList.add('sim');
  if (innerWidth < 700) panel.classList.add('collapsed');
  $('sim-title').addEventListener('click', () => { panel.classList.toggle('collapsed'); $('sim-title').textContent = '传感器模拟器 ' + (panel.classList.contains('collapsed') ? '▸' : '▾'); });
  let shot = 'topspin', speed = 1;
  const mark = () => {
    document.querySelectorAll('#sim-shots button').forEach((b) => b.classList.toggle('on', b.dataset.shot === shot));
    document.querySelectorAll('#sim-speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === speed));
  };
  mark();
  // o: {shot, speed, side, sloppy, ...generator knobs}
  const swing = (o = {}) => {
    if (!phoneSim || phoneSim.busy) return false;
    phoneSim.startSwing({ sloppy: 0.3, speed, side: $('sim-bh').checked ? 'bh' : 'fh', ...o, shot: o.shot || shot });
    return true;
  };
  document.querySelectorAll('#sim-shots button').forEach((b) => b.addEventListener('click', () => { shot = b.dataset.shot; mark(); swing(); }));
  document.querySelectorAll('#sim-speed button').forEach((b) => b.addEventListener('click', () => { speed = Number(b.dataset.v); mark(); }));
  $('sim-swing').addEventListener('click', () => swing());
  $('sim-net').addEventListener('click', () => $('btn-net').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })));
  $('sim-walk').addEventListener('change', (e) => phoneSim && phoneSim.setWalk(e.target.checked ? { bob: 0.02, f: 1.9, sway: 6, arm: 5 } : null));
  $('sim-hz').addEventListener('change', (e) => {
    if (phoneSim.busy) { e.target.checked = !e.target.checked; return; }
    phoneSim = newPhoneSim(e.target.checked ? 100 : 60); gesture.reset();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    const map = { 1: 'topspin', 2: 'flat', 3: 'slice', 4: 'lob' };
    if (map[k]) { shot = map[k]; mark(); swing(); }
    else if (k === ' ' || k === 'enter') { if (e.target.tagName !== 'BUTTON') { e.preventDefault(); swing(); } }
    else if (k === 'n' && S.mode === 'play') $('sim-net').click();
    else if (k === 'p' && S.mode === 'play') $('btn-pause').click();
  });
  window.__ctl.swing = swing;
  Object.defineProperty(window.__ctl, 'phoneSim', { get: () => phoneSim });
}

// ---------------------------------------------------------------- init
function gripSvg(hand) {
  const L = hand === 'L', tx = L ? 18 : 186, anchor = 'start';
  const phone = `<g transform="translate(62 100) rotate(-34)"><rect x="0" y="-15" width="120" height="30" rx="9" fill="#fff" stroke="#1c2340" stroke-width="4"/>
    <rect x="92" y="-9" width="22" height="18" rx="4" fill="#8fe0ff" stroke="#1c2340" stroke-width="2.5"/>
    <rect x="-16" y="-23" width="54" height="46" rx="17" fill="#ffd2a6" stroke="#1c2340" stroke-width="4"/></g>`;
  const body = L ? `<g transform="translate(300 0) scale(-1 1)">${phone}</g>` : phone;
  const t = (y, s) => `<text x="${tx}" y="${y}" text-anchor="${anchor}" font-size="14" font-weight="800" fill="#1c2340">${s}</text>`;
  return body + t(34, '拍头 = 手机顶端') + t(62, '屏幕 = 拍面') + t(90, '握在手机下端');
}
function init() {
  window.__ctl = { S, get gesture() { return gesture; }, get client() { return client; }, snd };
  document.addEventListener('touchmove', (e) => { if (document.body.classList.contains('playing') && !e.target.closest('.sheet')) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'dblclick'].forEach((n) => document.addEventListener(n, stopBubble));
  document.addEventListener('contextmenu', stopBubble);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { snd.resume(); if (S.mode === 'play') requestWake(); } });

  const secure = window.isSecureContext || SIM;
  $('secure-bad').hidden = secure; $('secure-ok').hidden = !secure;
  if (secure) $('secure-ok').innerHTML = SIM ? '<b>模拟器模式</b>：用按钮 / 键盘生成传感器数据，走与真机相同的识别流程。' : '<b>环境正常</b>（HTTPS）。点“开始”会请求<b>动作与方向</b>权限。';
  if (!secure) $('btn-start').disabled = true;
  if (!S.room) { $('room-field').hidden = false; $('btn-demo').hidden = false; }
  else { $('intro-hint').textContent = `房间号 ${S.room}${LOCAL ? '（本机测试通道）' : ''}`; connect(); }   // networking starts right away so its status is visible
  if (!SIM && typeof DeviceMotionEvent === 'undefined') $('intro-hint').textContent = '此浏览器不支持动作传感器。';
  $('grip-svg').innerHTML = gripSvg('R');

  $('btn-start').addEventListener('click', onStart);
  $('btn-demo').addEventListener('click', () => { S.demo = true; renderNet(); onStart(); });
  document.querySelectorAll('#s-hand .choice').forEach((b) => {
    b.addEventListener('mouseenter', () => { $('grip-svg').innerHTML = gripSvg(b.dataset.hand); });
    b.addEventListener('click', () => { setHand(b.dataset.hand); afterHand(); });
  });
  $('btn-warm-go').addEventListener('click', enterPlay);
  $('btn-warm-skip').addEventListener('click', enterPlay);
  bindPlay(); bindSettings();
  if (SIM) bindSim();
  renderNet();
  if (params.get('debug') === '1') $('debug').hidden = false;
  window.addEventListener('pagehide', () => { try { client && client.close(); } catch (e) { /* */ } });
}
init();
