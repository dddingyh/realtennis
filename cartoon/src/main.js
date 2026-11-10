// App shell: renderer/stage boot, menu -> match -> end flow, sim/keyboard/phone/characters/audio wiring.
import { Sfx } from '../../src/audio/sfx.js';
import { createRemoteHost, drawQR } from '../../src/net/host.js';
import { Stage } from './view/scene.js';
import { PLACEHOLDER_LOOKS, createPlaceholderCharacter } from './view/placeholder_char.js';
import { createMenu, loadSettings, saveSettings, FORMATS, STYLES } from './ui/menu.js';
import { createHud, renderEnd, pointLabel } from './ui/hud.js';
import { TOURNEY } from './view/court_tex.js';
import { StubSim } from './ui/dev_stub_sim.js';

const Q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const canvas = $('#gl');
const dom = { loading: $('#loading'), nogl: $('#nogl'), menu: $('#menu'), hud: $('#hud'), pause: $('#pause'), end: $('#end'), perf: $('#perf') };

// ------------------------------------------------------------------ boot
let stage = null;
try { stage = new Stage(canvas); } catch (e) {
  console.error('WebGL init failed', e);
  dom.loading.classList.add('hidden'); dom.nogl.classList.remove('hidden');
  throw e;
}
const sfx = new Sfx();
const mods = { ArcadeSim: null, attachKeyboard: null, KEYBOARD_HELP: null, RemoteAdapter: null, createCharacter: null, DEFAULT_LOOKS: null };

async function loadMods() {
  const tryImport = async (p) => { try { return await import(p); } catch (e) { console.warn('optional module unavailable:', p, e && e.message); return null; } };
  const [simM, kbM, remM, chM] = await Promise.all([
    Q.get('stub') === '1' ? null : tryImport('./sim/arcade.js'), tryImport('./input/keyboard.js'), tryImport('./input/remote.js'), tryImport('./view/character/index.js'),
  ]);
  mods.ArcadeSim = simM && simM.ArcadeSim; mods.attachKeyboard = kbM && kbM.attachKeyboard; mods.KEYBOARD_HELP = kbM && kbM.KEYBOARD_HELP;
  mods.RemoteAdapter = remM && (remM.RemoteAdapter || remM.RemoteInput); mods.createCharacter = chM && chM.createCharacter; mods.DEFAULT_LOOKS = chM && chM.DEFAULT_LOOKS;
}

// ------------------------------------------------------------------ state
const S = loadSettings();
for (const [k, t] of [['surface', 's'], ['style', 's'], ['control', 's'], ['hand', 's'], ['format', 's'], ['level', 'n'], ['speed', 'n'], ['offset', 'n']]) {
  const v = Q.get(k); if (v != null && v !== '') S[k] = t === 'n' ? Number(v) : v;
}
if (S.level > 1) S.level = Math.min(1, S.level / 10);
if (Q.get('fmt')) S.format = Q.get('fmt');
if (Q.get('look0') != null) S.look0 = Number(Q.get('look0')); if (Q.get('look1') != null) S.look1 = Number(Q.get('look1'));
let looks = PLACEHOLDER_LOOKS;
let menu = null, hud = null;
let mode = 'loading';        // loading | menu | playing | ended
let sim = null, humanIdx = 0, detachKb = null, kbHandle = null, remote = null, host = null, phoneState = null;
let matchSettings = null, lastPaused = false, endTimer = 0, lastServeKmh = 0, lastPointWinner = 0, names = ['你', '对手'];
const slow = { t: 0 };
const tmp = { x: 0, y: 0, on: true };

const charFactory = (look, o) => (mods.createCharacter ? mods.createCharacter(look, o) : createPlaceholderCharacter(look));
const idleAnim = (z) => ({ name: 'ready', shot: null, side: null, phase: 0, gait: 0, strideLen: 0.5, dir: { x: 0, z: 0 }, face: { x: 0, z: z > 0 ? -1 : 1 }, speed: 0, accel: 0, contact: null, reachT: 0, emote: null });
function idleState() {
  return { time: 0, ball: { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, visible: false },
    players: [12.4, -12.4].map((z) => ({ pos: { x: 0, z }, vel: { x: 0, z: 0 }, y: 0, hand: 'R', zone: 'base', stamina: 1, set: 1, anim: idleAnim(z), racketTip: null })) };
}
function applyHandToIdle() { const st = stage.idleState; if (st) { st.players[0].hand = S.hand; } }

function refreshPreview(full) {
  stage.setSurface(S.surface);
  if (full || !stage.chars[0]) { stage.setCharacters(charFactory, [looks[S.look0] || looks[0], looks[S.look1] || looks[1] || looks[0]]); }
  stage.idleState = stage.idleState || idleState();
}

// ------------------------------------------------------------------ phone
async function ensureHost() {
  if (host) return;
  try {
    const controllerBase = new URL('controller.html', location.href).href;
    host = createRemoteHost({
      controllerBase, local: Q.get('local') === '1',
      onMessage: (m) => { if (remote) remote.handle(m); },
      onStatus: (st) => {
        phoneState = st; if (menu) menu.setPhone(st); if (hud) hud.setPhone(S.control === 'phone' ? st : null);
        if (st.controllerUrl && st.controllerUrl !== ensureHost.lastUrl) { ensureHost.lastUrl = st.controllerUrl; drawQR(menu.qrCanvas(), st.controllerUrl, 4, { quiet: 2 }).catch(() => menu.setPhoneError('二维码生成失败，请手动输入房间号')); }
      },
    });
  } catch (e) { console.warn('phone host failed', e); if (menu) menu.setPhoneError('手机连接不可用（可改用键盘）'); }
}
function closeHost() { if (host) { try { host.close(); } catch (e) { /* ignore */ } host = null; ensureHost.lastUrl = null; phoneState = null; if (hud) hud.setPhone(null); } }

// ------------------------------------------------------------------ match lifecycle
function buildSim(cfg) {
  if (mods.ArcadeSim) { try { return new mods.ArcadeSim(cfg); } catch (e) { console.warn('ArcadeSim failed, using stub', e); } }
  return new StubSim(cfg);
}

async function startMatch(settings) {
  matchSettings = { ...settings }; saveSettings(settings);
  const fmt = (FORMATS.find((f) => f.id === settings.format) || FORMATS[1]).format;
  const lk = [looks[settings.look0] || looks[0], looks[settings.look1] || looks[1] || looks[0]];
  const st = STYLES.find((s) => s.id === settings.style);
  names = ['你', st ? '对手' : '对手'];
  const cfg = {
    surface: settings.surface, timeScale: settings.speed, seed: (Math.random() * 1e9) | 0, format: { ...fmt },
    players: [{ human: true, hand: settings.hand, name: names[0], look: lk[0], remote: settings.control === 'phone' }, { human: false, hand: 'R', name: names[1], look: lk[1], ai: { level: settings.level, style: settings.style } }],
  };
  if (detachKb) { try { detachKb(); } catch (e) { /* ignore */ } detachKb = null; kbHandle = null; }
  if (remote) { try { remote.destroy(); } catch (e) { /* ignore */ } remote = null; }
  sim = buildSim(cfg);
  humanIdx = Math.max(0, sim.humanIdx != null ? sim.humanIdx : 0);
  stage.setSurface(settings.surface);
  stage.setCharacters(charFactory, lk);
  stage.ball.showTiming = settings.timing; stage.ball.showLanding = settings.landing;
  stage.ball.resetTrail(); stage.rig.snap();
  sfx.setSurface(settings.surface); sfx.speechOn = !!settings.speech; sfx.setMuted(!settings.sound);
  hud.setNames(names); hud.clearFx(); hud.setSoundIcon(settings.sound); hud.setPhone(settings.control === 'phone' ? phoneState : null);
  if (mods.attachKeyboard) { try { detachKb = mods.attachKeyboard(sim, humanIdx); kbHandle = detachKb; } catch (e) { console.warn('keyboard attach failed', e); } }
  if (settings.control === 'phone') {
    await ensureHost();
    if (mods.RemoteAdapter && host) { try { remote = new mods.RemoteAdapter(sim, humanIdx, host, { timingOffsetMs: settings.offset }); } catch (e) { console.warn('RemoteAdapter failed', e); } }
  }
  hud.showKeyHelp(settings.control === 'keyboard');
  clearTimeout(startMatch.kt); startMatch.kt = setTimeout(() => hud.showKeyHelp(false), 12000);
  lastPaused = false; endTimer = 0; lastServeKmh = 0; slow.t = 0;
  dom.menu.classList.add('hidden'); dom.end.classList.add('hidden'); dom.pause.classList.add('hidden'); dom.hud.classList.remove('hidden');
  mode = 'playing';
  refreshBoards();
  sfx.unlock();
}

function toMenu() {
  if (sim) { try { sim.pause(true); } catch (e) { /* ignore */ } }
  if (detachKb) { try { detachKb(); } catch (e) { /* ignore */ } detachKb = null; kbHandle = null; }
  if (remote) { try { remote.destroy(); } catch (e) { /* ignore */ } remote = null; }
  sim = null; mode = 'menu';
  dom.hud.classList.add('hidden'); dom.pause.classList.add('hidden'); dom.end.classList.add('hidden'); dom.menu.classList.remove('hidden');
  hud.clearFx(); stage.idleState = idleState(); stage.setSurface(S.surface); stage.setCharacters(charFactory, [looks[S.look0] || looks[0], looks[S.look1] || looks[1] || looks[0]]);
  stage.ball.resetTrail();
}

function refreshBoards() {
  if (!sim || !stage.venue) return;
  const m = sim.state.match;
  const msg = m.winner != null ? `${names[m.winner]} 获胜` : (m.isTiebreak ? '抢七' : (lastServeKmh ? `上一发 ${Math.round(lastServeKmh)} km/h` : TOURNEY[S.surface === matchSettings?.surface ? S.surface : matchSettings.surface].sub));
  stage.venue.setBoard({ names, sets: m.sets.map((s) => s.slice()), games: m.games.slice(), points: [pointLabel(m, 0), pointLabel(m, 1)], server: m.server, msg });
  const g = m.sets.map((s) => `${s[0]}-${s[1]}`).concat([`${m.games[0]}-${m.games[1]}`]).join('  ');
  stage.venue.setLed(`${names[0]} ${g} ${names[1]}  ·  ${pointLabel(m, 0)}:${pointLabel(m, 1)}${lastServeKmh ? `  ·  发球 ${Math.round(lastServeKmh)} km/h` : ''}`);
}

// ------------------------------------------------------------------ event fan-out
function popAtPlayer(i, text, kind, sub, dy = 2.55) {
  const p = sim.state.players[i];
  stage.worldToScreen(p.pos.x, dy, p.pos.z, tmp);
  const x = Math.max(110, Math.min(stage.size.w - 110, tmp.x)), y = Math.max(120, Math.min(stage.size.h - 160, tmp.y));
  hud.pop(text, kind, x, y, sub);
}
function popCenter(text, kind, sub, fy = 0.34) { hud.pop(text, kind, stage.size.w / 2, stage.size.h * fy, sub); }

function dispatch(events, state) {
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    stage.onEvent(e, state);
    switch (e.type) {
      case 'hit': {
        sfx.hit({ ...e, type: e.serve ? 'serve' : undefined, shot: e.serve ? 'smash' : e.shot });
        if (e.serve) { lastServeKmh = e.speedKmh || 0; hud.serveSpeed(lastServeKmh); refreshBoards(); }
        if (state.players[e.by] && state.players[e.by].isHuman) {
          const ms = Math.round(e.timingMs || 0), sgn = ms > 0 ? '+' : ms < 0 ? '−' : '';
          const sub = `${sgn}${Math.abs(ms)}ms`;
          if (e.timing === 'perfect') popAtPlayer(e.by, '准！', 'perfect', sub);
          else if (e.timing === 'early') popAtPlayer(e.by, '早', 'early', sub);
          else if (e.timing === 'late') popAtPlayer(e.by, '晚', 'late', sub);
          else popAtPlayer(e.by, ms < 0 ? '太早!' : '太晚!', 'wide', sub);
          hud.timingResult(e, state, state.players[e.by].pos);
        }
        break;
      }
      case 'bounce': sfx.bounce(e); break;
      case 'net': sfx.net(e); sfx.ooh(); break;
      case 'whiff': sfx.handleEvents([e], state); if (state.players[e.by] && state.players[e.by].isHuman) popAtPlayer(e.by, '挥空', 'wide', ''); break;
      case 'call': {
        sfx.handleEvents([e], state);
        const map = { OUT: ['OUT', 'call'], FAULT: ['FAULT', 'call'], 'DOUBLE FAULT': ['双误', 'call'], LET: ['LET', 'let'] };
        const m = map[e.text]; if (m) popCenter(m[0], m[1], '', 0.3);
        break;
      }
      case 'point': {
        lastPointWinner = e.winner; hud.showKeyHelp(false); sfx.applause(e.winner === humanIdx ? 1 : 0.65);
        if (e.shots >= 9) sfx.applause(0.8);
        refreshBoards();
        break;
      }
      case 'score': {
        sfx.handleEvents([e], state);
        if (e.setWon) hud.banner(`${names[lastPointWinner]} 拿下一盘`, state.match.sets.map((s) => s.join('-')).join('  '), 'set');
        else if (e.gameWon) hud.banner(`${names[lastPointWinner]} 赢下本局`, `${state.match.games[0]} - ${state.match.games[1]}`);
        refreshBoards();
        break;
      }
      case 'big': {
        if (e.kind === 'ace') { popCenter('ACE', 'ace', '', 0.34); sfx.applause(1); slow.t = 1.0; }
        else if (e.kind === 'winner') { popCenter('好球!', 'big', '', 0.34); sfx.applause(0.9); slow.t = 1.0; }
        else if (e.kind === 'longrally') popCenter('精彩回合!', 'good', '', 0.42);
        else if (e.kind === 'break') hud.banner('破发成功!', '', '');
        else if (e.kind === 'match') { hud.banner('比赛结束', `${names[state.match.winner != null ? state.match.winner : lastPointWinner]} 获胜`, 'match'); sfx.applause(1); sfx.applause(1); }
        break;
      }
      case 'phase': refreshBoards(); break;
      default: break;
    }
  }
}

// ------------------------------------------------------------------ pause / end UI
function syncPause() {
  const p = !!(sim && sim.paused);
  if (p === lastPaused) return;
  lastPaused = p;
  if (mode === 'playing') dom.pause.classList.toggle('hidden', !p);
}
function setPaused(v) { if (sim && mode === 'playing') { sim.pause(v); syncPause(); } }

function showEnd() {
  mode = 'ended';
  dom.hud.classList.add('hidden');
  renderEnd(dom.end, { state: sim.state, humanIdx, names, onAgain: () => startMatch(matchSettings), onMenu: toMenu });
  dom.end.classList.remove('hidden');
}

// ------------------------------------------------------------------ loop
let last = performance.now(), fAvg = 16.7, fMax = 0, fCount = 0, perfOn = Q.get('perf') === '1';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.1, (now - last) / 1000); last = now;
  const dt = Math.min(raw, 1 / 20);
  fAvg += (raw * 1000 - fAvg) * 0.05; fMax = Math.max(fMax * 0.99, raw * 1000);
  if (mode === 'playing' || mode === 'ended') {
    syncPause();
    let events = null;
    if (!sim.paused) {
      let scale = 1;
      if (slow.t > 0) { slow.t -= dt; const k = clamp(slow.t / 0.8, 0, 1); scale = 1 - 0.62 * k * k * (3 - 2 * k); }
      sim.step(dt * scale);
      events = sim.drainEvents();
    }
    const state = sim.state;
    if (events && events.length) dispatch(events, state);
    if (remote) { try { remote.notify(events || [], state); } catch (e) { /* phone link problems must not stop the game */ } }
    stage.update(sim.paused ? 0 : dt, state, humanIdx);
    if (mode === 'playing') {
      hud.update(state, humanIdx);
      if (kbHandle && kbHandle.holding) hud.setPower(kbHandle.power ? kbHandle.power() : 0, kbHandle.holding());
      if (state.match.phase === 'match-over') { endTimer += dt; if (endTimer > 3.4) showEnd(); }
    }
  } else if (mode === 'menu') {
    stage.update(dt, null, 0);
  }
  stage.render();
  if (perfOn && ++fCount % 20 === 0) { const i = stage.info(); dom.perf.textContent = `${fAvg.toFixed(1)}ms (max ${fMax.toFixed(0)})  calls ${i.calls}  tris ${(i.tris / 1000).toFixed(0)}k  geo ${i.geoms} tex ${i.tex}`; }
}

function onResize() { stage.resize(window.innerWidth, window.innerHeight); }

// ------------------------------------------------------------------ init
async function init() {
  onResize(); window.addEventListener('resize', onResize);
  await loadMods();
  looks = (mods.DEFAULT_LOOKS && mods.DEFAULT_LOOKS.length ? mods.DEFAULT_LOOKS : PLACEHOLDER_LOOKS);
  S.look0 = Math.min(S.look0, looks.length - 1); S.look1 = Math.min(S.look1, looks.length - 1);
  if (S.look0 === S.look1 && looks.length > 1) S.look1 = (S.look0 + 1) % looks.length;
  hud = createHud(dom.hud);
  hud.onPause = () => setPaused(!(sim && sim.paused));
  hud.onSound = () => { S.sound = !S.sound; sfx.setMuted(!S.sound); hud.setSoundIcon(S.sound); saveSettings(S); menu && menu.settings && (menu.settings.sound = S.sound); };
  if (mods.KEYBOARD_HELP) { hud.setKeyHelp(mods.KEYBOARD_HELP); }
  let previewTimer = 0;
  menu = createMenu(dom.menu, {
    settings: S, looks,
    onChange: (s, key) => {
      saveSettings(s);
      if (key === 'surface') { clearTimeout(previewTimer); previewTimer = setTimeout(() => stage.setSurface(S.surface), 60); }
      else if (key === 'look0' || key === 'look1') { stage.setCharacters(charFactory, [looks[S.look0] || looks[0], looks[S.look1] || looks[1] || looks[0]]); }
      else if (key === 'control') { menu.showPhone(S.control === 'phone'); if (S.control === 'phone') ensureHost(); else closeHost(); }
      else if (key === 'offset' && remote) remote.setTimingOffset(S.offset);
      else if (key === 'sound') { sfx.unlock(); sfx.setMuted(!S.sound); }
      else if (key === 'speech') sfx.speechOn = !!S.speech;
      else if (key === 'timing') stage.ball.showTiming = !!S.timing; else if (key === 'landing') stage.ball.showLanding = !!S.landing;
    },
    onStart: (s) => startMatch(s),
  });
  menu.setKeyHelp(mods.KEYBOARD_HELP || '空格/J 击球 · W/↑ 上网 · Esc 暂停');
  menu.showPhone(S.control === 'phone');
  if (S.control === 'phone') ensureHost();
  $('#pResume').onclick = () => setPaused(false);
  $('#pRestart').onclick = () => startMatch(matchSettings);
  $('#pMenu').onclick = toMenu;
  const unlock = () => sfx.unlock();
  window.addEventListener('pointerdown', unlock, { passive: true }); window.addEventListener('keydown', unlock);
  window.addEventListener('keydown', (e) => { if (mode === 'playing' && !e.repeat && /^(Space|Key[JKLIWP]|Arrow|Shift)/.test(e.code)) hud.showKeyHelp(false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing' && sim && !sim.paused) setPaused(true); });
  window.addEventListener('keydown', (e) => { if (e.code === 'F3') { perfOn = !perfOn; dom.perf.classList.toggle('hidden', !perfOn); } });
  document.addEventListener('contextmenu', (e) => { if (mode === 'playing') e.preventDefault(); });
  dom.perf.classList.toggle('hidden', !perfOn);
  const ph = $('#pHelp'); if (ph && mods.KEYBOARD_HELP) ph.innerHTML = mods.KEYBOARD_HELP.map((h) => (typeof h === 'string' ? h : `<div><kbd>${h.keys || ''}</kbd> ${h.text || ''}</div>`)).join('');

  stage.idleState = idleState();
  refreshPreview(true);
  dom.loading.classList.add('hidden');
  mode = 'menu';
  requestAnimationFrame(frame);
  window.__arcade = {
    get sim() { return sim; }, stage, renderer: stage.renderer, get hud() { return hud; }, get menu() { return menu; }, sfx, settings: S, mods, startMatch, toMenu, setPaused,
    info: () => stage.info(), get mode() { return mode; }, dispatch, slow, get kb() { return kbHandle; },
  };
  if (Q.get('autostart') === '1') startMatch(S);
}
init().catch((e) => { console.error(e); dom.loading.innerHTML = `<b>启动失败</b><small>${(e && e.message) || e}</small>`; });
