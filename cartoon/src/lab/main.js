// Physics lab: wires the engine (ArcadeSim2 if present, else ArcadeSim v1) to the lab scene + panels.
import { createLabScene, colOf } from './scene.js';
import { TUNE, buildTuning, buildOverlays, renderReadout, renderStats, drawMini, miniLegend, shotCN } from './panels.js';
import { attachKeyboard } from '../input/keyboard.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const store = {
  get(k, d) { try { const v = localStorage.getItem('lab.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('lab.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

// ------------------------------------------------------------------ settings
const cfg = Object.assign({
  mode: 'rally', surface: 'hard', cam: 'behind', aiLevel: 0.5, aiStyle: 'baseliner',
  machine: { pattern: 'alt', kmh: 85, topRpm: 2500, sideRpm: 0, depth: 9, interval: 3, auto: true },
  demo: { shot: 'topspin', offset: 0, power: 0.7, sweep: false, histN: 6 },
  ov: { predict: true, contact: true, timing: true, fan: true, last: true, hist: true },
  local: { trail: true, ring: true, mini: true },
}, store.get('settings', {}));
for (const k of ['mode', 'surface', 'cam']) if (Q.get(k)) cfg[k] = Q.get(k);
if (Q.get('style')) cfg.aiStyle = Q.get('style');
if (Q.get('level')) cfg.aiLevel = +Q.get('level');
const saveCfg = () => store.set('settings', cfg);
let tuningVals = store.get('tuning', {});

// ------------------------------------------------------------------ engine
const E = { v2: null, v1: null, name: '?', Cls: null };
async function loadEngines() {
  if (Q.get('engine') !== 'v1') { try { const m = await import('../engine/sim.js'); E.v2 = m.ArcadeSim2 || m.ArcadeSim; } catch (e) { console.warn('[lab] engine v2 unavailable:', e && e.message); } }
  try { const m = await import('../sim/arcade.js'); E.v1 = m.ArcadeSim; } catch (e) { console.warn('[lab] engine v1 unavailable', e); }
}

// ------------------------------------------------------------------ world
const scene = createLabScene($('gl'));
scene.overlays.predict = cfg.ov.predict; Object.assign(scene.overlays, cfg.ov);
let sim = null, detachKb = null, host = null, remote = null, phoneState = null;
let tuneUI = null, ro = null, rec = null, histN = cfg.demo.histN;
const landings = [], stats = { whiffs: 0 };
let slow = false, frameN = 0, feedTimer = 1, feedCount = 0, altSide = 1, demoSwung = false, sweepI = 2, lastActivity = 0;
let swingDemoOff = 0, toastT = 0;
let lastFan = null, lastPred = null, lastHintSide = null;
const SWEEP = [-100, -50, 0, 50, 100];
const NAMES = ['你', 'AI'];

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1600); }

function applyTuning(partial) {
  if (!sim) return;
  if (partial.timeScale != null) { sim.timeScale = partial.timeScale; if (sim.state) sim.state.timeScale = partial.timeScale; }
  if (typeof sim.setTuning === 'function') { try { sim.setTuning(partial); } catch (e) { console.warn('setTuning failed', e); } }
}

function newSim() {
  const base = {
    surface: cfg.surface, timeScale: tuningVals.timeScale ?? 0.8, seed: (Math.random() * 1e9) | 0, format: { sets: 1, gamesPerSet: 6, tiebreak: true },
    players: [{ human: true, hand: 'R', name: '你', remote: !!host }, { human: false, hand: 'R', name: 'AI', ai: { level: cfg.mode === 'rally' ? cfg.aiLevel : 0.2, style: cfg.aiStyle } }],
  };
  let s = null, name = 'v1';
  if (E.v2) { try { s = new E.v2({ ...base, tuning: { ...tuningVals } }); name = 'v2'; } catch (e) { console.warn('[lab] v2 constructor failed, falling back to v1', e); s = null; } }
  if (!s && E.v1) { s = new E.v1(base); name = 'v1'; }
  if (!s) throw new Error('no engine could be loaded');
  E.name = name;
  if (detachKb) { try { detachKb(); } catch (e) { /* */ } }
  if (remote) { try { remote.destroy(); } catch (e) { /* */ } remote = null; }
  sim = s;
  detachKb = attachKeyboard(sim, 0);
  if (host) attachRemote();
  applyTuning(tuningVals);
  rec = null; ro = null; landings.length = 0; feedTimer = 1; demoSwung = false; stats.whiffs = 0;
  scene.clearTrajectories(); scene.resetTrail();
  if (Q.get('autostart') === '0') sim.pause(true);
  const tag = $('engineTag'); tag.textContent = name === 'v2' ? '引擎 v2' : '引擎 v1 (无 v2 扩展)'; tag.classList.toggle('v1', name === 'v1');
  // tuning defaults from the engine when it can tell us
  if (typeof sim.getTuning === 'function') {
    try { const g = sim.getTuning(); for (const t of TUNE) if (t.k && g && g[t.k] != null && !(t.k in tuningVals)) { t.def = g[t.k]; if (g[t.k] > t.max) t.max = g[t.k] * 1.5; } } catch (e) { /* */ }
  }
  return sim;
}

// ------------------------------------------------------------------ recording of shots (path, landing, curve)
function startRec(by, shot, pos, vel, ls, extra) {
  finalizeRec();
  rec = { by, shot: shot || 'flat', pts: [{ x: pos.x, y: pos.y, z: pos.z }], v: vel ? { x: vel.x, y: vel.y, z: vel.z } : null, bounces: 0, landing: null, apex: 0, ls, ...extra };
}
function recordPoint(p) { if (!rec || rec.pts.length > 900) return; rec.pts.push({ x: p.x, y: p.y, z: p.z }); if (rec.bounces === 1 && p.y > rec.apex) rec.apex = p.y; }
function finalizeRec() {
  const r = rec; rec = null;
  if (!r || r.pts.length < 6) return;
  const a = r.pts[0];
  let dx = r.v ? r.v.x : r.pts[Math.min(4, r.pts.length - 1)].x - a.x, dz = r.v ? r.v.z : r.pts[Math.min(4, r.pts.length - 1)].z - a.z;
  const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
  const end = r.landing || r.pts[r.pts.length - 1];
  const along = (end.x - a.x) * dx + (end.z - a.z) * dz;
  const line = { a: { x: a.x, z: a.z }, b: { x: a.x + dx * along, z: a.z + dz * along } };
  let curve = 0, clear = null;
  for (let i = 1; i < r.pts.length; i++) {
    const p = r.pts[i], q = r.pts[i - 1];
    if (r.bounces === 0 || !r.landing || i <= r.landIdx) { const lat = -(p.x - a.x) * dz + (p.z - a.z) * dx; if (Math.abs(lat) > Math.abs(curve)) curve = lat; }
    if (clear == null && ((q.z > 0) !== (p.z > 0)) && Math.sign(q.z) !== 0) { const u = Math.abs(q.z) / (Math.abs(q.z) + Math.abs(p.z)); const y = q.y + (p.y - q.y) * u, x = q.x + (p.x - q.x) * u; clear = y - (0.914 + Math.min(1, Math.abs(x) / 5.029) * 0.156); }
  }
  const m = { curveM: curve, netClear: clear, bounceApex: r.landing ? r.apex : null };
  if (ro && ro.rec === r) ro.m = m;
  r.line = line; r.m = m;
  scene.addTrajectory({ shot: r.shot, pts: r.pts, line, landing: r.landing }, histN + 1);
}
function onLanding(e, byRec) {
  const sh = rec ? rec.shot : 'flat', by = rec ? rec.by : e.by;
  landings.push({ x: e.pos.x, z: e.pos.z, shot: sh, by, in: e.in }); if (landings.length > 30) landings.shift();
}

// ------------------------------------------------------------------ events
function onEvent(e, state) {
  lastActivity = performance.now();
  const type = e.type || e.t || e.name;
  if (type === 'hit') {
    const ls = { ...(state.lastShot || {}), by: e.by, ...Object.fromEntries(Object.entries(e).filter(([k]) => !['type', 'pos', 't'].includes(k))) };
    Object.assign(ls, state.lastShot || {});
    ls.by = e.by;
    startRec(e.by, e.shot, e.pos || state.ball.pos, state.ball.vel, ls);
    rec.ls = ls; ro = { ls, m: null, rec };
    if (cfg.mode === 'demo' && e.by === 0) { feedTimer = Math.max(1.4, cfg.machine.interval * 0.6); }
    if (cfg.mode !== 'rally' && e.by === 1) demoSwung = false;
  } else if (type === 'bounce') {
    onLanding(e);
    if (rec) { rec.bounces++; if (rec.bounces === 1) { rec.landing = { x: e.pos.x, z: e.pos.z }; rec.landIdx = rec.pts.length; } else if (rec.bounces >= 2) finalizeRec(); }
  } else if (type === 'net') { /* path continues */ }
  else if (type === 'whiff') { if (e.by === 0) stats.whiffs++; }
  else if (type === 'point') {
    finalizeRec(); if (cfg.mode !== 'rally') feedTimer = Math.min(feedTimer, Math.max(0.8, cfg.machine.interval * 0.5));
  } else if (type === 'phase') {
    if (cfg.mode !== 'rally' && state.match.phase === 'match-over') { newSim(); }
  }
}

// ------------------------------------------------------------------ ball machine
function doFeed() {
  const m = cfg.machine, d = cfg.demo;
  let tx = 0;
  if (m.pattern === 'alt') { altSide = -altSide; tx = 3.0 * altSide; } else if (m.pattern === 'rand') tx = (Math.random() * 2 - 1) * 3.6; else tx = 0;
  const fx = clamp(-tx * 0.15, -1.2, 1.2);
  if (cfg.mode === 'demo' && d.sweep) { sweepI = (sweepI + 1) % SWEEP.length; d.offset = SWEEP[sweepI]; swingDemoOff = d.offset; syncModePanel(); }
  const shot = m.topRpm > 800 ? 'topspin' : m.topRpm < -800 ? 'slice' : 'flat';
  const spec = { from: { x: fx, z: -11.5 }, target: { x: tx, z: m.depth }, kmh: m.kmh, topRpm: m.topRpm, sideRpm: m.sideRpm, shot };
  let ok = false;
  if (typeof sim.feed === 'function') { try { sim.feed(spec); ok = true; } catch (e) { console.warn('sim.feed failed, using debugFeed', e); } }
  if (!ok && typeof sim.debugFeed === 'function') { sim.debugFeed(1, { from: { x: fx, y: 1.0, z: -11.5 }, target: { x: tx, z: m.depth }, speedKmh: m.kmh, topRpm: m.topRpm }); }
  scene.resetTrail(); demoSwung = false; feedCount++; feedTimer = m.interval + 6; lastActivity = performance.now();
  const b = sim.state.ball;
  startRec(1, shot, b.pos, b.vel, { by: 1, shot, speedKmh: m.kmh, topRpm: m.topRpm, sideRpm: m.sideRpm, side: null, timing: null, quality: null, mishit: null, machine: true });
  ro = { ls: rec.ls, m: null, rec };
}

function modeTick(dtReal) {
  if (cfg.mode === 'rally') return;
  const st = sim.state;
  if (cfg.mode === 'demo' && !demoSwung && st.ball.inPlay && st.hint && st.hint.contactIn != null) {
    const ciMs = st.hint.contactIn * (st.timeScale || sim.timeScale || 0.8) * 1000;
    if (ciMs <= -swingDemoOff) { demoSwung = true; sim.swing(0, { shot: cfg.demo.shot, power: cfg.demo.power, ageMs: 0, source: 'keyboard' }); }
  }
  if (cfg.machine.auto || feedCount === 0) { feedTimer -= dtReal; if (feedTimer <= 0 && st.match.phase !== 'match-over') doFeed(); }
}

// ------------------------------------------------------------------ main step
function advance(dt) {
  const CH = 1 / 60; let left = dt;
  while (left > 1e-6) {
    const c = Math.min(CH, left); left -= c;
    if (!sim.paused) {
      sim.step(c * (slow ? 0.25 : 1)); const ev = sim.drainEvents(); const st = sim.state;
      for (const e of ev) { try { onEvent(e, st); } catch (er) { console.warn('event', er); } }
      if (remote) { try { remote.notify(ev, st); } catch (er) { /* phone link problems must not stop the lab */ } }
      recordPoint(st.ball.pos); scene.pushTrail(st.ball.pos);
      modeTick(c);
    }
  }
}

// ------------------------------------------------------------------ view data
const fwdOf = (i) => (i === 0 ? -1 : 1);
function contactWorld(i, state) {
  const p = state.players[i];
  let pr = null;
  if (typeof sim.predict === 'function') { try { pr = sim.predict(i); } catch (e) { pr = null; } }
  if (pr && pr.contact) return { pt: pr.contact, side: pr.contact.side || null, pr };
  const pl = p.plan;
  if (pl && pl.contact && pl.contact.x != null) return { pt: pl.contact, side: pl.side, pr };
  const c = p.anim && p.anim.contact;
  if (c && Number.isFinite(c.lat)) {
    const side = p.anim.side || 'fh', hx = (p.hand === 'L' ? -1 : 1) * (i === 0 ? 1 : -1);
    return { pt: { x: p.pos.x + (side === 'fh' ? 1 : -1) * hx * c.lat, y: c.h, z: p.pos.z + fwdOf(i) * c.fwd }, side, pr };
  }
  return { pt: null, side: null, pr };
}
function playerView(i, state) {
  const p = state.players[i], sp = Math.hypot(p.vel.x, p.vel.z), cw = contactWorld(i, state);
  let face = p.anim && p.anim.face && (p.anim.face.x || p.anim.face.z) ? p.anim.face : { x: 0, z: fwdOf(i) };
  const side = (i === 0 && state.hint && state.hint.side) || cw.side || (p.anim && p.anim.side) || (p.plan && p.plan.side) || 'fh';
  const hx = (p.hand === 'L' ? -1 : 1) * (i === 0 ? 1 : -1);
  const lat = (side === 'fh' ? 1 : -1) * hx;
  let pp = cw.pt && Math.hypot(cw.pt.x - p.pos.x, cw.pt.z - p.pos.z) < 2.6 ? cw.pt : { x: p.pos.x + lat * 0.75, y: 1.0, z: p.pos.z + fwdOf(i) * 0.5 };
  let dir = { x: 0, z: fwdOf(i) };
  const ls = state.lastShot;
  if (i === 0 && lastFan && lastFan.now && state.hint && state.hint.contactIn != null) dir = { x: lastFan.now.x - pp.x, z: lastFan.now.z - pp.z };
  else if (ls && ls.by === i && ls.target && state.time - (ro && ro.t0 || 0) < 99 && state.ball.lastHitBy === i && state.ball.bounces === 0) dir = { x: ls.target.x - pp.x, z: ls.target.z - pp.z };
  const dn = Math.hypot(dir.x, dir.z) || 1; dir = { x: dir.x / dn, z: dir.z / dn };
  let st = 'idle'; const reach = p.anim && p.anim.reachT;
  if (reach != null && reach > 0.85 && cw.pt) st = 'stretch'; else if (sp > 0.8) st = 'move'; else if ((p.set ?? 1) > 0.55 || sp <= 0.8) st = 'set';
  if (!cw.pt && sp <= 0.8) st = 'idle';
  return { pos: p.pos, face, state: st, contact: cw.pt, ringOn: cfg.local.ring, rside: side, paddlePos: pp, dir, jump: p.y || 0 };
}
function computeFan(state) {
  lastFan = null;
  if (!cfg.ov.fan) return null;
  const hint = state.hint; if (!hint || hint.contactIn == null || state.players[0].plan === undefined && !hint.side) { /* proceed anyway */ }
  if (!hint || hint.contactIn == null) return null;
  const ts = (state.timeScale || sim.timeScale || 0.8);
  const nowMs = clamp(-hint.contactIn * ts * 1000, -300, 300);
  const out = [];
  const has2 = typeof sim.aimPreview === 'function';
  let k1 = 0; if (!has2 && typeof sim.timingForAim === 'function') { try { k1 = sim.timingForAim(0, 1); } catch (e) { k1 = 0; } }
  const query = (ms) => {
    if (has2) { try { const r = sim.aimPreview(0, ms); if (r) { const t = r.target || r; if (Number.isFinite(t.x) && Number.isFinite(t.z)) return { x: t.x, z: t.z, ms }; } } catch (e) { /* */ } return null; }
    if (Math.abs(k1) > 1e-6) return { x: clamp(ms / k1, -5.2, 5.2), z: -9.2, ms };
    return null;
  };
  for (const ms of SWEEP) out.push(query(ms));
  const cur = query(Math.round(nowMs)); out.push(cur);
  if (cur) lastFan = { now: cur };
  return out;
}

// ------------------------------------------------------------------ HUD refresh
function refreshHud(state) {
  const h = state.hint || {}, sideEl = $('sideBig'), lockEl = $('sideLock');
  const pl0 = state.players[0].plan, incoming = h.contactIn != null || !!pl0;
  const side = h.side || (pl0 && pl0.side);
  if (incoming && side) {
    sideEl.textContent = side === 'fh' ? '正手' : '反手'; sideEl.className = 'side-big ' + side;
    const locked = h.sideLocked != null ? h.sideLocked : (pl0 && pl0.sideLocked);
    lockEl.textContent = locked == null ? '(v1：无锁定信息)' : locked ? '已锁定' : '判断中…';
    lockEl.style.color = locked ? '#66d98a' : '#ffc857';
  } else { sideEl.textContent = '—'; sideEl.className = 'side-big none'; lockEl.textContent = '无来球'; lockEl.style.color = ''; }
  renderReadout($('readout'), $('rdWho'), ro && ro.ls && !ro.ls.machine ? ro : (ro ? ro : null), NAMES);
  const ms = state.match.stats || {};
  renderStats($('stats'), { shots: state.rally ? state.rally.shots : 0, winners: ms.winners ? ms.winners[0] : 0, errors: ms.unforced ? ms.unforced[0] + (ms.forced ? ms.forced[0] : 0) : 0, whiffs: stats.whiffs, score: state.match.pointText, engine: E.name });
}

// ------------------------------------------------------------------ frame loop
let last = performance.now(), hudAcc = 0;
const mini = $('mini');
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; frameN++;
  if (!sim) return;
  try { advance(dt); drawFrame(dt); } catch (e) { if (!frame.warned) { frame.warned = true; console.error('[lab] frame error', e); } }
}
function drawFrame(dt) {
  const state = sim.state, pv = [playerView(0, state), playerView(1, state)];
  let pred = null;
  if (cfg.ov.predict && typeof sim.predict === 'function' && state.ball.inPlay) { try { pred = sim.predict(0); } catch (e) { pred = null; } }
  lastPred = pred;
  const fan = state.hint && state.hint.contactIn != null ? computeFan(state) : (lastFan = null);
  const origin = pv[0].contact ? { x: pv[0].contact.x, y: 0.05, z: pv[0].contact.z } : { x: state.players[0].pos.x, y: 0.05, z: state.players[0].pos.z };
  scene.update(dt, { ball: state.ball, trailOn: cfg.local.trail, trailPush: false, players: pv, predict: pred, hint: state.hint, fan, origin, timeScale: state.timeScale, tPerfect: tuningVals.T_PERFECT });
  scene.render();
  hudAcc += dt;
  if (hudAcc > 0.1) {
    hudAcc = 0; refreshHud(state);
    $('miniWrap').style.display = cfg.local.mini ? '' : 'none';
    if (cfg.local.mini) drawMini(mini, { landings, players: state.players.map((p) => p.pos), ball: state.ball.pos, predLand: pred && pred.landing });
    updatePhoneUi();
  }
}

// ------------------------------------------------------------------ UI: mode panels
function slider(label, key, obj, min, max, step, unit = '', onSet) {
  const id = 'sl_' + key;
  return { html: `<div class="row"><span class="n">${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${obj[key]}"><output id="${id}_o">${obj[key]}${unit}</output></div>`, bind() { const el = $(id); el.addEventListener('input', () => { obj[key] = +el.value; $(id + '_o').textContent = el.value + unit; if (onSet) onSet(); saveCfg(); }); } };
}
function selectBox(label, key, obj, opts, onSet) {
  const id = 'se_' + key;
  return { html: `<div class="row"><span class="n">${label}</span><select id="${id}" style="grid-column:2/4">${opts.map(([v, n]) => `<option value="${v}"${obj[key] === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`, bind() { $(id).addEventListener('change', (e) => { obj[key] = e.target.value; if (onSet) onSet(); saveCfg(); }); } };
}
function checkBox(label, key, obj, onSet) {
  const id = 'ck_' + key;
  return { html: `<label><input type="checkbox" id="${id}"${obj[key] ? ' checked' : ''}>${label}</label>`, bind() { $(id).addEventListener('change', (e) => { obj[key] = e.target.checked; if (onSet) onSet(); saveCfg(); }); } };
}
function syncModePanel() { const el = $('sl_offset'); if (el) { el.value = cfg.demo.offset; $('sl_offset_o').textContent = cfg.demo.offset + 'ms'; } }
function buildModePanel() {
  const root = $('modePanel'), parts = [], m = cfg.machine, d = cfg.demo;
  const note = (t) => ({ html: `<div class="muted small" style="margin:4px 0">${t}</div>`, bind() {} });
  if (cfg.mode === 'rally') {
    parts.push(slider('AI 等级', 'aiLevel', cfg, 0, 1, 0.05, '', () => {}), selectBox('AI 风格', 'aiStyle', cfg, [['baseliner', '底线相持'], ['attacker', '压迫进攻'], ['netrusher', '上网型'], ['trickster', '变化型']]),
      { html: '<div class="row"><button id="btnNew" style="grid-column:1/4">新对局 (应用 AI 设置)</button></div>', bind() { $('btnNew').onclick = () => newSim(); } },
      note('真实计分。发球：按挥拍键抛球，到最高点再按一次。'));
  } else {
    if (cfg.mode === 'demo') parts.push(selectBox('球种', 'shot', d, [['topspin', '上旋'], ['flat', '平击'], ['slice', '切削'], ['lob', '挑高']]),
      { html: `<div class="row"><span class="n">时机偏移</span><input type="range" id="sl_offset" min="-150" max="150" step="5" value="${d.offset}"><output id="sl_offset_o">${d.offset}ms</output></div>`, bind() { $('sl_offset').addEventListener('input', (e) => { d.offset = +e.target.value; swingDemoOff = d.offset; $('sl_offset_o').textContent = d.offset + 'ms'; saveCfg(); }); } },
      slider('力量', 'power', d, 0.2, 1, 0.05), checkBox('扫描时机 −100…+100', 'sweep', d),
      slider('保留轨迹数', 'histN', d, 1, 12, 1, '', () => { histN = d.histN; scene.setHistMax(histN + 1); }),
      { html: '<div class="row"><button id="btnClr" style="grid-column:1/4">清除轨迹</button></div>', bind() { $('btnClr').onclick = () => { scene.clearTrajectories(); landings.length = 0; }; } },
      note('玩家 0 自动击球；负偏移=早，正偏移=晚。'));
    parts.push(selectBox('模式', 'pattern', m, [['fixed', '固定'], ['alt', '左右调动'], ['rand', '随机']]),
      slider('球速', 'kmh', m, 40, 130, 1, 'km/h'), slider('上旋/下旋', 'topRpm', m, -3500, 4500, 100, 'rpm'), slider('侧旋', 'sideRpm', m, -3500, 3500, 100, 'rpm'),
      slider('落点深度', 'depth', m, 3, 11.3, 0.1, 'm'), slider('间隔', 'interval', m, 1, 8, 0.5, 's'), checkBox('自动连续发球', 'auto', m),
      { html: '<div class="row"><button id="btnFeed" style="grid-column:1/4">发一球 (F)</button></div>', bind() { $('btnFeed').onclick = () => { if (cfg.mode !== 'rally') doFeed(); }; } });
  }
  root.innerHTML = parts.map((p) => p.html).join(''); parts.forEach((p) => p.bind());
}
function setMode(mode) {
  cfg.mode = mode; saveCfg();
  document.querySelectorAll('#modeBtns button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  buildModePanel(); newSim(); toast({ rally: '对打：真实计分', machine: '发球机', demo: '击球演示' }[mode]);
}
function setCam(c) { cfg.cam = c; saveCfg(); scene.setCamera(c); document.querySelectorAll('#camBtns button').forEach((b) => b.classList.toggle('on', b.dataset.cam === c)); }
scene.onCamChange = (c) => { document.querySelectorAll('#camBtns button').forEach((b) => b.classList.toggle('on', b.dataset.cam === c)); };

// ------------------------------------------------------------------ phone
async function enablePhone() {
  if (host) return;
  $('phoneInfo').textContent = '正在连接…';
  try {
    const { createRemoteHost, drawQR } = await import('../../../src/net/host.js');
    const { RemoteAdapter } = await import('../input/remote.js');
    attachRemote.RA = RemoteAdapter;
    let lastUrl = null;
    host = createRemoteHost({
      controllerBase: new URL('controller.html', location.href).href, local: Q.get('local') === '1',
      onMessage: (m) => { if (remote) remote.handle(m); },
      onStatus: (st) => {
        phoneState = st;
        if (st.controllerUrl && st.controllerUrl !== lastUrl) { lastUrl = st.controllerUrl; drawQR($('qr'), st.controllerUrl, 4, { quiet: 2 }).catch(() => { $('phoneInfo').textContent = '二维码生成失败，请手动输入房间号'; }); $('phoneUrl').textContent = st.controllerUrl; }
        updatePhoneUi();
      },
    });
    attachRemote(); $('btnPhone').textContent = '关闭手机连接';
  } catch (e) { console.warn('phone host failed', e); $('phoneInfo').textContent = '手机连接不可用（可改用键盘）'; host = null; }
}
function attachRemote() {
  if (!host || !attachRemote.RA || !sim) return;
  try { remote = new attachRemote.RA(sim, 0, host, { timingOffsetMs: store.get('phoneOffset', 0) }); } catch (e) { console.warn('RemoteAdapter failed', e); }
}
function disablePhone() { if (host) { try { host.close(); } catch (e) { /* */ } } host = null; if (remote) { try { remote.destroy(); } catch (e) { /* */ } } remote = null; phoneState = null; $('qr').width = 10; $('phoneUrl').textContent = ''; $('phoneInfo').textContent = ''; $('btnPhone').textContent = '启用手机连接'; }
function updatePhoneUi() {
  if (!host || !phoneState) return;
  const st = phoneState, map = { connected: '已连接', stale: '手机无响应', waiting: '等待连接', pairing: '正在配对…', starting: '正在连接…', error: '连接失败' };
  $('phoneInfo').innerHTML = `房间号 <b style="font-size:18px;letter-spacing:.15em">${st.roomCode || ''}</b><br>${map[st.state] || st.state}${st.rttMs != null ? ' · ' + st.rttMs + 'ms' : ''}${st.hand ? ' · ' + (st.hand === 'L' ? '左手' : '右手') : ''}`;
}

// ------------------------------------------------------------------ boot
function copyJson() {
  const out = { engine: E.name, surface: cfg.surface, ai: { level: cfg.aiLevel, style: cfg.aiStyle }, tuning: { ...tuningVals } };
  const txt = JSON.stringify(out, null, 1);
  const done = () => { $('copyMsg').textContent = '已复制'; setTimeout(() => { $('copyMsg').textContent = ''; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => fallback());
  else fallback();
  function fallback() { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { $('copyMsg').textContent = '复制失败'; } ta.remove(); }
  console.log(txt);
}
async function boot() {
  await loadEngines();
  window.addEventListener('resize', scene.resize);
  $('surface').value = cfg.surface;
  $('surface').addEventListener('change', (e) => { cfg.surface = e.target.value; saveCfg(); scene.setSurface(cfg.surface); newSim(); });
  scene.setSurface(cfg.surface);
  document.querySelectorAll('#modeBtns button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#camBtns button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
  $('btnSlow').addEventListener('click', () => { slow = !slow; $('btnSlow').classList.toggle('on', slow); });
  $('btnPause').addEventListener('click', () => sim && sim.pause(!sim.paused));
  $('btnRestart').addEventListener('click', () => newSim());
  $('btnPhone').addEventListener('click', () => (host ? disablePhone() : enablePhone()));
  buildOverlays($('overlays'), scene.overlays, cfg.local, (k, v) => { if (k in cfg.ov) cfg.ov[k] = v; saveCfg(); scene.refreshHist(); });
  tuneUI = buildTuning($('tuning'), null, tuningVals, (k, v) => { tuningVals[k] = v; store.set('tuning', tuningVals); applyTuning({ [k]: v }); });
  $('btnReset').addEventListener('click', () => { tuningVals = {}; store.set('tuning', {}); for (const t of TUNE) if (t.k) tuneUI.set(t.k, t.def); applyTuning(Object.fromEntries(TUNE.filter((t) => t.k).map((t) => [t.k, t.def]))); toast('已重置默认'); });
  $('btnCopy').addEventListener('click', copyJson);
  miniLegend($('miniLegend'));
  window.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '') && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.code === 'Digit1') setCam('behind'); else if (e.code === 'Digit2') setCam('side'); else if (e.code === 'Digit3') setCam('top'); else if (e.code === 'Digit4') setCam('orbit');
    else if (e.code === 'KeyF' && cfg.mode !== 'rally') doFeed();
  });
  newSim();
  // after the engine exists, show its real defaults in the sliders
  tuneUI = buildTuning($('tuning'), sim, tuningVals, (k, v) => { tuningVals[k] = v; store.set('tuning', tuningVals); applyTuning({ [k]: v }); });
  document.querySelectorAll('#modeBtns button').forEach((b) => b.classList.toggle('on', b.dataset.mode === cfg.mode));
  buildModePanel(); setCam(cfg.cam); buildOverlays($('overlays'), scene.overlays, cfg.local, (k, v) => { if (k in cfg.ov) cfg.ov[k] = v; saveCfg(); scene.refreshHist(); });
  histN = cfg.demo.histN; swingDemoOff = cfg.demo.offset;
  if (Q.get('phone') === '1') enablePhone();
  requestAnimationFrame(frame);
  window.__lab = {
    get sim() { return sim; }, scene, cfg, E, stats, landings, setMode, setCam, doFeed, newSim, advance, drawFrame, enablePhone, disablePhone,
    get ro() { return ro; }, get engine() { return E.name; }, get host() { return host; }, get remote() { return remote; }, setSlow(v) { slow = !!v; },
    setTuning(k, v) { tuneUI.set(k, v); tuningVals[k] = v; store.set('tuning', tuningVals); applyTuning({ [k]: v }); },
    setDemo(o) { Object.assign(cfg.demo, o); swingDemoOff = cfg.demo.offset; histN = cfg.demo.histN; buildModePanel(); },
    setMachine(o) { Object.assign(cfg.machine, o); buildModePanel(); },
  };
}
boot().catch((e) => { console.error('[lab] boot failed', e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:60px;left:300px;color:#ff6b6b;z-index:9">${e && e.stack || e}</pre>`); });
