// Boot, menu, fixed-step game loop (sim.step(1/120)), rendering, input wiring, audio, phone link.
import { RENDER, PHYSICS } from './config.js';
import { Renderer } from './render/renderer.js';
import { Hud } from './render/hud.js';
import { Sfx } from './audio/sfx.js';
import { PhoneLink } from './ui/phone.js';
import { createMenu, loadSettings } from './ui/menu.js';
import { createScreens } from './ui/screens.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const STEP = 1 / PHYSICS.simHz;

const screen = $('screen');
screen.width = RENDER.width; screen.height = RENDER.height;
const sctx = screen.getContext('2d');
sctx.imageSmoothingEnabled = false;

const renderer = new Renderer();
const hud = new Hud();
const sfx = new Sfx();
const phone = new PhoneLink();

let SimClass = null, usedStub = false;
let StubClass = null;
let sim = null, cfg = null, kbDetach = null, kbMod = null;
let mode = 'loading';          // loading | menu | playing | ended
let paused = false, acc = 0, last = 0, endTimer = 0, matchOverSince = 0;
let attract = null;
let prevAnim0 = '';

// ---------------------------------------------------------------- layout
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const sd = Math.floor(Math.min(vw * dpr / RENDER.width, vh * dpr / RENDER.height));
  let cw, ch;
  if (sd >= 1) { cw = RENDER.width * sd / dpr; ch = RENDER.height * sd / dpr; }
  else { const k = Math.min(vw / RENDER.width, vh / RENDER.height); cw = RENDER.width * k; ch = RENDER.height * k; }
  screen.style.width = `${cw}px`; screen.style.height = `${ch}px`;
}
window.addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- modules
async function loadSimClass() {
  if (!params.has('stub')) {
    try {
      const mod = await import('./game/simulation.js');
      if (mod.Simulation) { SimClass = mod.Simulation; return; }
    } catch (e) { console.warn('Real simulation unavailable, using dev stub:', e.message); }
  }
  usedStub = true;
  StubClass = (await import('./ui/dev_stub_sim.js')).Simulation;
  SimClass = StubClass;
}
let kbTried = false;
async function loadKeyboard() {
  if (kbTried) return; kbTried = true;
  try { kbMod = await import('./input/keyboard.js'); } catch (e) { kbMod = null; console.warn('keyboard.js unavailable', e.message); }
}
const getKeyboardHelp = () => kbMod?.KEYBOARD_HELP || null;
getKeyboardHelp.async = async () => { await loadKeyboard(); return kbMod?.KEYBOARD_HELP || null; };

// ---------------------------------------------------------------- game lifecycle
async function startGame(c) {
  cfg = c;
  sfx.unlock(); sfx.setSurface(c.surface); sfx.setMuted(!c.sound); sfx.speechOn = !!c.speech;
  if (!SimClass) await loadSimClass();
  if (!kbMod) await loadKeyboard();
  renderer.setSurface(c.surface);
  if (kbDetach) { try { kbDetach(); } catch (e) { /* ignore */ } kbDetach = null; }
  const opts = { surface: c.surface, aiStyle: c.aiStyle, aiLevel: c.aiLevel, format: c.format, playerNames: c.playerNames, autoMove: c.autoMove, humanHand: c.humanHand, seed: (Math.random() * 1e9) | 0 };
  try { sim = new SimClass(opts); } catch (e) {
    console.error('Simulation failed, falling back to stub:', e);
    if (!StubClass) StubClass = (await import('./ui/dev_stub_sim.js')).Simulation;
    usedStub = true; sim = new StubClass(opts);
  }
  // pause hook: whatever toggles pause (keyboard.js, our buttons) ends up here
  const origPause = sim.pause?.bind(sim);
  sim.pause = (b) => { origPause?.(b); setPaused(!!b); };
  if (sim.state?.match?.phase === 'menu') { (sim.startMatch || sim.start || sim.beginMatch)?.call(sim); }
  try { if (kbMod?.attachKeyboard) { const r = kbMod.attachKeyboard(sim, 0); kbDetach = typeof r === 'function' ? r : (r?.detach || r?.dispose || null); } } catch (e) { console.warn('attachKeyboard failed', e); }
  if (c.control === 'phone') { await phone.start(); await phone.attach(sim); phone.setOffset(c.timingOffsetMs || 0); }
  else phone.remote = null;
  hud.calls.length = 0; hud.serveInfo = null;
  acc = 0; last = performance.now(); matchOverSince = 0; prevAnim0 = '';
  paused = false; screensUI.showPause(false); screensUI.hideEnd();
  menuUI.hide(); mode = 'playing';
  document.body.dataset.mode = 'playing';
  window.__rt.sim = sim;
}
function toMenu() {
  mode = 'menu'; paused = false; sim = null; window.__rt.sim = null;
  screensUI.showPause(false); screensUI.hideEnd();
  menuUI.show();
  document.body.dataset.mode = 'menu';
}
function setPaused(p) {
  if (mode !== 'playing') return;
  if (p === paused) return;
  paused = p; screensUI.showPause(p);
}
function togglePause() {
  if (mode !== 'playing' || !sim) return;
  if (sim.pause) sim.pause(!paused); else setPaused(!paused);
}

const screensUI = createScreens({
  onResume: () => togglePause(),
  onRestart: () => { const c = cfg; screensUI.showPause(false); startGame(c); },
  onMenu: () => toMenu(),
  onAgain: () => startGame(cfg),
});
const menuUI = createMenu({ phone, getKeyboardHelp, onStart: (c) => startGame(c) });
menuUI.onAudio = (s) => { sfx.setMuted(!s.sound); sfx.speechOn = !!s.speech; };

// Esc / P: capture so keyboard.js doesn't double-toggle
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (mode === 'playing') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) togglePause(); }
  }
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing' && !paused) togglePause(); });
window.addEventListener('blur', () => { if (mode === 'playing' && !paused) togglePause(); });
// audio unlock on first gesture
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => sfx.unlock(), { once: false, passive: true });

// ---------------------------------------------------------------- perf
const PERF = { n: 0, sum: 0, max: 0, samples: [], dts: [] };
function perfRec(ms, dt) {
  PERF.n++; PERF.sum += ms; PERF.max = Math.max(PERF.max, ms);
  PERF.samples.push(ms); if (PERF.samples.length > 600) PERF.samples.shift();
  PERF.dts.push(dt * 1000); if (PERF.dts.length > 600) PERF.dts.shift();
}
function perfReport() {
  const a = [...PERF.samples].sort((x, y) => x - y), d = PERF.dts;
  const pct = (q) => a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0;
  return { frames: PERF.n, renderAvgMs: +(PERF.sum / Math.max(1, PERF.n)).toFixed(2), renderP50: +pct(0.5).toFixed(2), renderP95: +pct(0.95).toFixed(2), renderMax: +PERF.max.toFixed(2),
    fps: d.length ? +(1000 / (d.reduce((x, y) => x + y, 0) / d.length)).toFixed(1) : 0 };
}

// ---------------------------------------------------------------- frame loop
function processEvents(events, state) {
  if (!events.length) return;
  renderer.onEvents(events, state);
  hud.onEvents(events, state);
  sfx.handleEvents(events, state);
  if (phone.remote) phone.notify(events, state);
  for (const e of events) {
    if (e.type === 'point') { /* crowd handled in renderer */ }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  let state = null, time = now / 1000;
  const ui = { phoneMode: cfg?.control === 'phone', phoneStatus: phone.status, timingRing: true };
  if (mode === 'playing' && sim) {
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 40) { sim.step(STEP); acc -= STEP; n++; }
      if (n === 40) acc = 0;
      const events = sim.drainEvents?.() || [];
      processEvents(events, sim.state);
      if (phone.remote && !events.length) phone.notify([], sim.state);
    }
    state = sim.state; time = state.time ?? time;
    const a0 = state.players[0]?.anim?.name;
    if (a0 !== prevAnim0) { if (a0 === 'split') sfx.squeak(); prevAnim0 = a0; }
    if (state.match?.phase === 'match-over') {
      matchOverSince += dt;
      if (matchOverSince > 2.6 && mode === 'playing') { mode = 'ended'; screensUI.showEnd(state); }
    }
  } else if (mode === 'ended' && sim) {
    state = sim.state; if (!paused) { acc += dt; while (acc >= STEP) { sim.step(STEP); acc -= STEP; } sim.drainEvents?.(); }
    time = state.time;
  } else if (attract) {
    acc += dt; while (acc >= STEP) { attract.step(STEP); acc -= STEP; }
    attract.drainEvents().forEach((e) => { if (e.type === 'point') renderer.crowd.onPoint(0.6); if (e.type === 'bounce') renderer.onEvents([e], attract.state); });
    state = attract.state; time = state.time;
  }
  if (state) {
    const t0 = performance.now();
    const canvas = renderer.draw(state, paused ? 0 : dt, time);
    if (mode !== 'menu') hud.draw(renderer.ctx, state, paused ? 0 : dt, ui);
    sctx.drawImage(canvas, 0, 0);
    perfRec(performance.now() - t0, dt);
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  const bar = document.querySelector('#loadbar i');
  const prog = (p) => { if (bar) bar.style.width = `${Math.round(p * 100)}%`; };
  prog(0.1);
  await new Promise((r) => setTimeout(r, 20));
  const s0 = loadSettings();
  renderer.setSurface(params.get('surface') || s0.surface || 'hard');
  prog(0.5);
  await loadSimClass();
  prog(0.7);
  loadKeyboard();
  // attract-mode scene behind the menu (always the lightweight stub)
  try { const S = StubClass || (await import('./ui/dev_stub_sim.js')).Simulation; attract = new S({ surface: renderer.surface }); } catch (e) { attract = null; }
  prog(1);
  $('loading').classList.add('hidden');
  window.__rt = { perf: perfReport, perfReset: () => { PERF.n = 0; PERF.sum = 0; PERF.max = 0; PERF.samples.length = 0; PERF.dts.length = 0; }, screensUI, renderer, hud, sfx, phone, get sim() { return sim; }, set sim(v) { sim = v; }, startGame, toMenu, togglePause, usedStub: () => usedStub, get mode() { return mode; }, get attract() { return attract; } };
  mode = 'menu'; document.body.dataset.mode = 'menu';
  last = performance.now();
  requestAnimationFrame(frame);
  if (params.has('autostart')) {
    const c = { ...menuUI.settings };
    await startGame({
      surface: params.get('surface') || c.surface, aiStyle: params.get('style') || c.style, aiLevel: +(params.get('level') || 0.5),
      format: params.get('format') === 'bo3' ? { sets: 3, gamesPerSet: 4, tiebreak: true, shortGames: true } : { sets: 1, gamesPerSet: 6, tiebreak: true, shortGames: false },
      humanHand: params.get('hand') || c.hand, autoMove: [params.get('auto') || c.auto, 'off'], playerNames: ['你', 'AI'], control: params.get('control') || 'keyboard', timingOffsetMs: 0, sound: false, speech: false,
    });
  } else menuUI.show();
}
boot().catch((e) => { console.error(e); const l = $('loading'); if (l) l.querySelector('.loading-box').textContent = '加载失败：' + e.message; });
