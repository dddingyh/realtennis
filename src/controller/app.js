// Phone controller application (controller.html). Mobile-first UI around the gesture recognizer + network client.
//   ?room=ABC234      room code (also typed in manually)
//   &local=1          BroadcastChannel transport (host + controller in the same browser; testing)
//   &sim=1            desktop sensor simulator instead of real sensors
//   &debug=1          show debug in settings
import { createRecognizer } from './gesture.js';
import { PhoneSim } from './simtrace.js';
import { createRemoteClient } from '../net/client.js';
import { normalizeRoomCode } from '../net/protocol.js';
import { PROTOCOL_VERSION } from '../config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim') && params.get('sim') !== '0';
const LOCAL = params.get('local') === '1';
const STORE_KEY = 'realtennis.ctl.v1';
const SHOT_CN = { flat: '平击', topspin: '上旋', slice: '切削', lob: '挑高' };
const SIDE_CN = { fh: '正手', bh: '反手', auto: '' };
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------------------------------------------------------------- persistence
function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ hand: S.hand, calib: rec.exportCalibration(), vib: S.vib, touch: S.touch, accSign: S.accSign, adj: S.adj, room: S.room }));
  } catch (e) { /* private mode */ }
}
const saved = load();
const S = {
  hand: saved.hand || null, vib: saved.vib !== false, touch: !!saved.touch,
  accSign: saved.accSign || (IS_IOS ? -1 : 1), adj: saved.adj || 0,
  room: normalizeRoomCode(params.get('room')) || null,
  override: null, held: new Set(), paused: false, wizard: null, returnToPlay: false, samples: 0, lastSwing: null, tOffset: 0, connected: false,
  demo: false,
};
let rec = makeRec();
function makeRec() {
  const r = createRecognizer({ hand: S.hand || 'R', accSign: S.accSign, calibration: saved.calib && saved.calib.v === 1 ? { ...saved.calib, neutralUp: undefined } : undefined });
  return r;
}

// ---------------------------------------------------------------- UI helpers
function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
  document.body.classList.toggle('playing', id === 's-play');
  window.scrollTo(0, 0);
}
function vibrate(p) { if (S.vib && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* */ } } }
const hasSwingCal = () => Object.values(rec.calibratedCount).some((n) => n >= 2);

// ---------------------------------------------------------------- grip diagram
function gripSvg(hand) {
  const L = hand === 'L';
  return `<svg viewBox="0 0 360 180" role="img" aria-label="握拍示意图">
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#d6f24a"/></marker>
  <marker id="ar2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#5db7ff"/></marker></defs>
  <text x="8" y="16" class="dim">侧面：像握拍柄</text>
  <g transform="translate(40 136) rotate(-30)">
    <rect x="-6" y="-14" width="124" height="28" rx="7" fill="#223a2e" stroke="#d6f24a" stroke-width="2.5"/>
    <rect x="92" y="-9" width="20" height="18" rx="3" fill="none" stroke="#d6f24a" stroke-width="1.2" opacity=".7"/>
    <rect x="-20" y="-21" width="56" height="42" rx="16" fill="#e8b98e" stroke="#9c6e47" stroke-width="2"/>
    <line x1="-6" y1="-21" x2="-6" y2="21" stroke="#9c6e47" stroke-width="1.5" opacity=".55"/><line x1="10" y1="-21" x2="10" y2="21" stroke="#9c6e47" stroke-width="1.5" opacity=".55"/>
  </g>
  <path d="M8 160 L30 146" stroke="#e8b98e" stroke-width="18" stroke-linecap="round"/>
  <text x="64" y="40">拍头（手机顶端）</text>
  <path d="M150 46 L156 68" stroke="#d6f24a" stroke-width="2" marker-end="url(#ar)"/>
  <text x="104" y="136" class="dim">屏幕＝拍面</text>
  <text x="12" y="176" class="dim">握在手机下端</text>
  <text x="104" y="158" class="dim">抬高约30°</text>
  <g transform="translate(190 0)">
    <text x="0" y="16" class="dim">俯视：正手挥拍弧线</text>
    <text x="66" y="38" class="dim">↑ 球网方向</text>
    <g transform="${L ? 'translate(150 0) scale(-1 1)' : ''}">
      <circle cx="75" cy="118" r="17" fill="#2d4a3b" stroke="#6b8f7c" stroke-width="2"/>
      <path d="M118 150 C 134 96, 96 60, 40 70" fill="none" stroke="#d6f24a" stroke-width="3" marker-end="url(#ar)"/>
      <path d="M26 148 C 14 100, 44 82, 62 84" fill="none" stroke="#5db7ff" stroke-width="2.5" stroke-dasharray="5 4" marker-end="url(#ar2)"/>
    </g>
    <text x="75" y="122" text-anchor="middle" style="font-size:11px">你</text>
    <text x="${L ? 14 : 122}" y="170" style="fill:#d6f24a">正手</text>
    <text x="${L ? 122 : 14}" y="170" style="fill:#5db7ff">反手</text>
  </g></svg>`;
}

// ---------------------------------------------------------------- sensors
let sensorsOn = false, lastSampleAt = 0, rateEma = 0, phoneSim = null, simTimer = null, simLast = 0;
function onMotion(e) {
  const now = performance.now();
  const rot = e.rotationRate;
  const accG = e.accelerationIncludingGravity;
  if (!accG || accG.x === null || accG.x === undefined) return;
  let t = e.timeStamp;
  if (!(t > 0) || Math.abs(t - now) > 500) t = now;
  const acc = e.acceleration && e.acceleration.x !== null ? { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z } : null;
  if (lastSampleAt) rateEma = rateEma ? rateEma * 0.95 + (now - lastSampleAt) * 0.05 : now - lastSampleAt;
  lastSampleAt = now;
  feed({ t, acc, accG: { x: accG.x, y: accG.y, z: accG.z }, rot: rot ? { alpha: rot.alpha || 0, beta: rot.beta || 0, gamma: rot.gamma || 0 } : null });
}
function startSensors() {
  if (sensorsOn) return;
  sensorsOn = true;
  if (SIM) {
    phoneSim = new PhoneSim({ hand: S.hand || 'R', hz: 100, seed: 7 });
    simLast = performance.now();
    simTimer = setInterval(() => {
      const n = performance.now();
      const ms = Math.min(100, Math.max(1, Math.round(n - simLast))); simLast += ms;
      for (const s of phoneSim.advance(ms)) { lastSampleAt = n; feed(s); }
    }, 16);
  } else {
    window.addEventListener('devicemotion', onMotion);
  }
}
function waitForSamples(ms) {
  return new Promise((res) => { const t0 = performance.now(); const iv = setInterval(() => { if (S.samples > 5 || performance.now() - t0 > ms) { clearInterval(iv); res(S.samples > 5); } }, 50); });
}

// ---------------------------------------------------------------- pipeline
let client = null;
function feed(s) {
  S.samples++;
  S.tOffset = performance.now() - s.t;
  const evs = rec.push(s);
  for (const ev of evs) {
    if (ev.type === 'tilt') onTilt(ev);
    else if (ev.type === 'swing') onSwing(ev);
  }
}
function onTilt(ev) {
  if (S.wizard || $('s-play').hidden) { return; }
  if (client) client.send({ t: 'tilt', x: ev.x, z: ev.z, ts: performance.now() }, { unreliable: true });
  const ring = $('tilt-ring'), r = ring.clientWidth / 2 * 0.78;
  $('tilt-dot').style.transform = `translate(${ev.x * r}px, ${ev.z * r}px)`;
}
function onSwing(ev) {
  if (S.wizard) { wizardSwing(ev); return; }
  if ($('s-play').hidden) return;
  const shot = S.override || ev.shot;
  const msg = { t: 'swing', shot, side: ev.side, power: ev.power, conf: S.override ? 1 : ev.conf, ts: ev.ts + S.tOffset - S.adj, feat: compactFeat(ev.feat) };
  if (client && !S.paused) client.send(msg);
  S.lastSwing = { ...ev, shot };
  showSwing(shot, ev.side, ev.power, S.override ? null : ev.conf);
  vibrate(28);
}
const compactFeat = (f) => ({ rise: f.rise, face: f.face, roll: f.roll, dur: f.dur, peak: f.peak, yaw: f.yaw });
function showSwing(shot, side, power, conf) {
  const box = $('last-swing');
  $('last-shot').textContent = SHOT_CN[shot] || shot;
  $('last-side').textContent = SIDE_CN[side] || '';
  $('last-power').textContent = `力度 ${Math.round(power * 100)}`;
  $('last-conf').textContent = conf == null ? '手动' : `把握 ${Math.round(conf * 100)}%`;
  $('last-power-bar').style.width = Math.round(power * 100) + '%';
  box.className = 'last shot-' + shot;
  void box.offsetWidth; box.classList.add('flash');
}

// ---------------------------------------------------------------- networking
function connect() {
  if (client || !S.room) return;
  client = createRemoteClient({
    room: S.room, local: LOCAL,
    makeHello: () => ({ t: 'hello', v: PROTOCOL_VERSION, hand: S.hand || 'R', ua: navigator.userAgent.slice(0, 120), calibrated: hasSwingCal() }),
    onStatus: onNetStatus,
    onMessage: onNetMessage,
  });
}
function onNetStatus(st) {
  const pill = $('conn-pill'); S.connected = st.state === 'connected';
  const map = { connected: ['ok', '已连接'], connecting: ['', '连接中…'], reconnecting: ['', '重连中…'], stale: ['bad', '主机无响应'], error: ['bad', '连接错误'] };
  const [cls, txt] = map[st.state] || ['', st.state];
  pill.className = 'pill ' + cls; $('conn-text').textContent = txt;
  $('rtt').textContent = st.message && st.state !== 'connected' ? st.message : (st.rttMs != null ? `延迟 ${st.rttMs} ms` : '— ms');
  if (st.state === 'connected') send_hello_ack();
}
function send_hello_ack() { /* hello is sent by the client on connect */ }
function onNetMessage(m) {
  if (m.t === 'welcome') toast('已连接到游戏');
  else if (m.t === 'haptic') vibrate(m.pattern);
  else if (m.t === 'state') {
    $('match-banner').innerHTML = m.phase === 'match-over' ? '比赛结束' : `${m.youServe ? '<b>你发球</b>' : '对手发球'}　${m.pointText || ''}`;
  }
}

// ---------------------------------------------------------------- flow: intro
async function onStart() {
  const btn = $('btn-start'); btn.disabled = true;
  let pm = null, po = null;
  if (!SIM) {   // permission requests must be issued synchronously inside the click handler (iOS)
    try { if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') pm = DeviceMotionEvent.requestPermission(); } catch (e) { pm = Promise.reject(e); }
    try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') po = DeviceOrientationEvent.requestPermission(); } catch (e) { po = Promise.resolve('skipped'); }
  }
  if (!S.room && !S.demo) {
    const code = normalizeRoomCode($('room-input').value);
    if (!code) { toast('请输入游戏画面上的 6 位房间号'); btn.disabled = false; return; }
    S.room = code;
  }
  try {
    if (pm) { const r = await pm; if (r !== 'granted') throw new Error('denied'); }
    if (po) { try { await po; } catch (e) { /* orientation permission is optional for us */ } }
  } catch (e) {
    $('intro-hint').innerHTML = '没有获得“动作与方向”权限。请在 <b>设置 → Safari → 动作与方向访问</b> 中开启，然后关闭本页重新扫码；或清除网站数据后重试。';
    btn.disabled = false; return;
  }
  startSensors();
  const ok = await waitForSamples(SIM ? 300 : 1800);
  if (!ok) { $('intro-hint').textContent = '没有收到传感器数据。请确认使用 HTTPS 页面、手机支持陀螺仪，并在浏览器设置中允许“动作与方向”。'; btn.disabled = false; return; }
  if (!S.demo) connect();
  btn.disabled = false;
  if (!S.hand) show('s-hand'); else gotoNeutral();
}

// ---------------------------------------------------------------- flow: neutral calibration
let neutralTimer = null;
function gotoNeutral() {
  $('grip-diagram').innerHTML = gripSvg(S.hand || 'R');
  $('neutral-bar').style.width = '0%'; $('neutral-msg').textContent = '准备好后按下按钮，然后保持不动。';
  $('btn-neutral').disabled = false; $('btn-neutral').textContent = '开始校准';
  show('s-neutral');
}
function runNeutral() {
  $('btn-neutral').disabled = true; $('btn-neutral').textContent = '保持不动…';
  let holdStart = null, tries = 0;
  clearInterval(neutralTimer);
  neutralTimer = setInterval(() => {
    const st = rec.stillness(500), now = performance.now();
    if (st.still) {
      if (holdStart === null) holdStart = now;
      const p = Math.min(1, (now - holdStart) / 2000);
      $('neutral-bar').style.width = (p * 100) + '%'; $('neutral-msg').textContent = '保持不动…';
      if (p >= 1) {
        const r = rec.calibrateNeutral(1200);
        if (r.ok) { clearInterval(neutralTimer); $('neutral-msg').textContent = '中立位已记录 ✓'; vibrate(40); save(); setTimeout(afterNeutral, 500); }
        else { holdStart = null; if (++tries > 3) $('neutral-msg').textContent = '还是有晃动，请把手臂靠在身体上稳住再试'; }
      }
    } else { holdStart = null; $('neutral-bar').style.width = '0%'; $('neutral-msg').textContent = '检测到晃动 —— 请保持不动'; }
  }, 50);
}
function afterNeutral() {
  if (S.returnToPlay) { S.returnToPlay = false; enterPlay(); return; }
  if (hasSwingCal()) enterPlay(); else gotoSwingCal();
}

// ---------------------------------------------------------------- flow: swing calibration
const CAL_ORDER = ['flat', 'topspin', 'slice', 'lob'];
const CAL_HOWTO = {
  flat: '水平、干脆地向前挥，拍面正对前方，像直线抽击。',
  topspin: '从低到高向上“刷”过球，手腕顺势翻过，拍面略向下压。',
  slice: '从高到低向下“切”，拍面略微朝上打开，动作较轻。',
  lob: '从下往上大幅度“捞”，速度较慢，拍面朝上。',
};
function gotoSwingCal() {
  rec.clearCalibration();
  S.wizard = { idx: 0, counts: { flat: 0, topspin: 0, slice: 0, lob: 0 } };
  renderWizard(); show('s-swing');
}
function renderWizard() {
  const w = S.wizard; if (!w) return;
  $('cal-types').innerHTML = CAL_ORDER.map((k, i) => `<div class="cal-type${i === w.idx ? ' active' : ''}">${SHOT_CN[k]}<div class="dots">${[0, 1, 2].map((j) => `<i class="${j < w.counts[k] ? 'on' : ''}"></i>`).join('')}</div></div>`).join('');
  const done = w.idx >= CAL_ORDER.length;
  $('btn-cal-done').hidden = !done; $('btn-cal-skip').hidden = done;
  if (done) { $('cal-prompt').textContent = '全部完成 ✓'; $('cal-howto').textContent = '识别已按你的动作个性化。'; }
  else { const k = CAL_ORDER[w.idx]; $('cal-prompt').textContent = `请挥 ${SHOT_CN[k]}（${w.counts[k] + 1}/3）`; $('cal-howto').textContent = CAL_HOWTO[k] + ' 正手反手交替更好。'; }
}
function wizardSwing(ev) {
  const w = S.wizard; if (!w || w.idx >= CAL_ORDER.length) return;
  const k = CAL_ORDER[w.idx];
  rec.addCalibrationSwing(k, ev);
  w.counts[k]++; w.last = k;
  const f = ev.feat;
  $('cal-feat').textContent = `识别：${SIDE_CN[ev.side]} ${SHOT_CN[ev.shot]}　力度 ${Math.round(ev.power * 100)}\n上扬角 ${f.rise.toFixed(0)}°  拍面 ${f.face.toFixed(0)}°  翻转 ${f.roll.toFixed(0)}°/s  峰值 ${f.peak.toFixed(0)}°/s`;
  vibrate(30);
  if (w.counts[k] >= 3) w.idx++;
  renderWizard();
}
function wizardUndo() {
  const w = S.wizard; if (!w) return;
  let k = w.idx >= CAL_ORDER.length ? CAL_ORDER[CAL_ORDER.length - 1] : CAL_ORDER[w.idx];
  if (w.counts[k] === 0 && w.idx > 0) { w.idx--; k = CAL_ORDER[w.idx]; }
  if (w.counts[k] === 0) return;
  const c = rec.exportCalibration(); c.samples[k].pop(); rec.loadCalibration(c); w.counts[k]--;
  renderWizard();
}
function finishWizard() { S.wizard = null; save(); S.returnToPlay = false; enterPlay(); if (client) client.send({ t: 'hello', v: PROTOCOL_VERSION, hand: S.hand, ua: '', calibrated: hasSwingCal() }); }

// ---------------------------------------------------------------- flow: play
let wakeLock = null;
async function requestWake() { try { if (navigator.wakeLock && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* denied */ } }
function enterPlay() {
  S.wizard = null;
  show('s-play'); requestWake();
  try { screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(() => {}); } catch (e) { /* */ }
  if (!S.demo && !client) connect();
  if (S.demo) { $('conn-text').textContent = '离线测试'; $('conn-pill').className = 'pill'; $('rtt').textContent = '未连接游戏'; }
  $('pad-hint').textContent = S.touch ? '触屏模式：点按钮 = 直接击球（正反手自动）' : '按住上面的按钮，同时挥拍，可强制本次击球类型';
  save();
}
function bindPads() {
  document.querySelectorAll('.pad').forEach((b) => {
    const shot = b.dataset.shot; let down = 0;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } down = performance.now();
      S.held.add(shot); S.override = shot; b.classList.add('held'); clearTimeout(S.ovTimer);
      client && client.send({ t: 'btn', id: 'shotOverride', value: shot }); vibrate(10);
    });
    const up = () => {
      if (!S.held.has(shot)) return; S.held.delete(shot); b.classList.remove('held');
      if (S.touch && performance.now() - down < 500 && !S.paused) {
        const msg = { t: 'swing', shot, side: 'auto', power: 0.7, conf: 1, ts: performance.now() - S.adj };
        client && client.send(msg); showSwing(shot, 'auto', 0.7, null); vibrate(25);
      }
      clearTimeout(S.ovTimer);
      S.ovTimer = setTimeout(() => { if (!S.held.size) { S.override = null; client && client.send({ t: 'btn', id: 'shotOverride', value: null }); } }, S.touch ? 50 : 700);
    };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  $('btn-serve').addEventListener('click', () => { client && client.send({ t: 'btn', id: 'serve' }); vibrate(20); });
  $('btn-pause').addEventListener('click', () => {
    S.paused = !S.paused; $('btn-pause').textContent = S.paused ? '继续' : '暂停';
    client && client.send({ t: 'btn', id: S.paused ? 'pause' : 'resume' });
  });
}

// ---------------------------------------------------------------- settings
function segSet(id, val) { document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', String(b.dataset.v) === String(val))); }
function refreshSettings() {
  segSet('set-hand', S.hand || 'R'); segSet('set-vib', S.vib ? 1 : 0); segSet('set-touch', S.touch ? 1 : 0); segSet('set-sign', S.accSign);
  $('set-adj').value = S.adj; $('adj-val').textContent = `${S.adj} ms（击球偏晚就减小）`;
}
function bindSettings() {
  $('btn-settings').addEventListener('click', () => { refreshSettings(); $('sheet').hidden = false; document.body.classList.remove('playing'); });
  $('btn-sheet-close').addEventListener('click', () => { $('sheet').hidden = true; document.body.classList.toggle('playing', !$('s-play').hidden); });
  const seg = (id, fn) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => { fn(b.dataset.v); refreshSettings(); save(); }));
  seg('set-hand', (v) => { S.hand = v; rec.setHand(v); if (phoneSim) phoneSim.hand = v; client && client.send({ t: 'hello', v: PROTOCOL_VERSION, hand: v, ua: '', calibrated: hasSwingCal() }); });
  seg('set-vib', (v) => { S.vib = v === '1'; if (S.vib) vibrate(30); });
  seg('set-touch', (v) => { S.touch = v === '1'; $('pad-hint').textContent = S.touch ? '触屏模式：点按钮 = 直接击球（正反手自动）' : '按住上面的按钮，同时挥拍，可强制本次击球类型'; });
  seg('set-sign', (v) => { S.accSign = Number(v); const c = rec.exportCalibration(); rec = createRecognizer({ hand: S.hand || 'R', accSign: S.accSign, calibration: c }); toast('已切换，请重新校准中立位'); });
  $('set-adj').addEventListener('input', (e) => { S.adj = Number(e.target.value); refreshSettings(); save(); });
  const leave = (fn) => { $('sheet').hidden = true; fn(); };
  $('btn-recal-neutral').addEventListener('click', () => leave(() => { S.returnToPlay = true; gotoNeutral(); }));
  $('btn-recal-swing').addEventListener('click', () => leave(() => { S.returnToPlay = true; gotoSwingCal(); }));
  $('btn-reset-cal').addEventListener('click', () => { rec.clearCalibration(); save(); toast('已清除挥拍校准，使用默认判定'); });
  setInterval(() => {
    if ($('sheet').hidden) return;
    const d = rec.debug(), l = S.lastSwing;
    $('debug').textContent = `samples ${S.samples}  interval ${rateEma.toFixed(1)} ms  gyroUnit ${d.rotUnit}  state ${d.state}\n|w| ${d.w.toFixed(0)} deg/s  tilt roll ${d.tiltDeg[0].toFixed(1)} pitch ${d.tiltDeg[1].toFixed(1)}\nIOS ${IS_IOS} accSign ${S.accSign}  calib ${JSON.stringify(rec.calibratedCount)}\n` + (l ? `last: ${l.side} ${l.shot} p${l.power} c${l.conf}\n${JSON.stringify(l.feat.vec)}` : '');
  }, 250);
}

// ---------------------------------------------------------------- simulator panel
function bindSim() {
  const panel = $('simpanel'); panel.hidden = false; document.body.classList.add('sim');
  panel.querySelector('.sim-title').addEventListener('click', () => panel.classList.toggle('collapsed'));
  let shot = 'topspin', side = 'fh';
  const mark = () => { document.querySelectorAll('#sim-shots button').forEach((b) => b.classList.toggle('on', b.dataset.shot === shot)); document.querySelectorAll('#sim-sides button').forEach((b) => b.classList.toggle('on', b.dataset.side === side)); };
  mark();
  document.querySelectorAll('#sim-shots button').forEach((b) => b.addEventListener('click', () => { shot = b.dataset.shot; mark(); }));
  document.querySelectorAll('#sim-sides button').forEach((b) => b.addEventListener('click', () => { side = b.dataset.side; mark(); }));
  const swing = (o = {}) => { if (phoneSim && !phoneSim.busy) phoneSim.startSwing({ shot: o.shot || shot, side: o.side || side, speed: o.speed || 1, sloppy: 0.3 }); };
  $('sim-swing').addEventListener('click', () => swing());
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if ('1234'.includes(k) && k) { shot = CAL_ORDER[Number(k) - 1]; mark(); }
    else if (k === 'f') { side = 'fh'; mark(); } else if (k === 'b') { side = 'bh'; mark(); }
    else if (k === ' ' || k === 'enter') { if (e.target.tagName !== 'BUTTON') { e.preventDefault(); swing(); } }
  });
  const pad = $('sim-pad'), dot = $('sim-dot');
  let dragging = false;
  const tiltFrom = (e) => {
    const r = pad.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)), y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    dot.style.left = (50 + x * 50) + '%'; dot.style.top = (50 + y * 50) + '%';
    phoneSim.setTilt(y * 32, x * 32);
  };
  pad.addEventListener('pointerdown', (e) => { dragging = true; try { pad.setPointerCapture(e.pointerId); } catch (err) { /* */ } tiltFrom(e); });
  pad.addEventListener('pointermove', (e) => { if (dragging) tiltFrom(e); });
  const end = () => { dragging = false; dot.style.left = dot.style.top = '50%'; phoneSim && phoneSim.setTilt(0, 0); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  $('sim-flip').addEventListener('change', (e) => { phoneSim.flip = e.target.checked; });
  $('sim-walk').addEventListener('change', (e) => phoneSim.setWalk(e.target.checked ? { bob: 0.02, f: 1.9, sway: 6, arm: 5 } : null));
  window.__ctl = { get rec() { return rec; }, get phoneSim() { return phoneSim; }, S, swing, get client() { return client; } };
}

// ---------------------------------------------------------------- init
function init() {
  // anti scroll / zoom
  document.addEventListener('touchmove', (e) => { if (document.body.classList.contains('playing') && !e.target.closest('.sheet')) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'dblclick'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('s-play').hidden) requestWake(); });

  // environment check
  const secure = window.isSecureContext || SIM;
  const bad = $('secure-bad'), ok = $('secure-ok');
  bad.hidden = secure; ok.hidden = !secure;
  if (secure) ok.innerHTML = SIM ? '<b>模拟器模式</b>：用鼠标 / 键盘生成传感器数据，走与真机相同的识别流程。' : '<b>环境正常</b>（HTTPS 安全上下文）。点击“开始”将请求 <b>动作与方向</b> 权限。';
  if (!secure) $('btn-start').disabled = true;
  if (!S.room) { $('room-field').hidden = false; $('btn-demo').hidden = false; }
  else $('intro-hint').textContent = `房间号 ${S.room}${LOCAL ? '（本机测试通道）' : ''}`;
  if (!SIM && typeof DeviceMotionEvent === 'undefined') $('intro-hint').textContent = '此浏览器不支持动作传感器，可使用触屏模式。';

  $('btn-start').addEventListener('click', onStart);
  $('btn-demo').addEventListener('click', () => { S.demo = true; onStart(); });
  document.querySelectorAll('#s-hand .choice').forEach((b) => b.addEventListener('click', () => { S.hand = b.dataset.hand; rec.setHand(S.hand); if (phoneSim) phoneSim.hand = S.hand; save(); client && client.send({ t: 'hello', v: PROTOCOL_VERSION, hand: S.hand, ua: '', calibrated: hasSwingCal() }); gotoNeutral(); }));
  $('btn-neutral').addEventListener('click', runNeutral);
  $('btn-cal-undo').addEventListener('click', wizardUndo);
  $('btn-cal-skip').addEventListener('click', () => { rec.clearCalibration(); S.wizard = null; S.returnToPlay = false; save(); enterPlay(); });
  $('btn-cal-done').addEventListener('click', finishWizard);
  bindPads(); bindSettings();
  if (SIM) bindSim();
  if (params.get('debug') === '1') $('debug').hidden = false;
  window.__app = { S, get rec() { return rec; } };
}
init();
