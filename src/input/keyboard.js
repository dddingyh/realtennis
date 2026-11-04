// Keyboard input for the Simulation (DESIGN.md §2.6).
//   WASD / arrows : move (also aim direction at contact: left/right -> aimX, up/down -> aimDepth)
//   J topspin, K flat, L slice, I lob : keydown = backswing (prepare), keyup = swing (power = hold time, cap ~0.6 s)
//   Space : serve (toss on keydown, hit on keyup); during rallies acts as a flat shot
//   Esc / P : pause

/** Help text for the UI. */
export const KEYBOARD_HELP = [
  { key: 'W A S D / 方向键', desc: '移动（击球时按住方向键可控制落点：左右 = 线路，上 = 打深，下 = 打短/放小球）' },
  { key: 'J', desc: '上旋球（按下引拍，松开击球，按住越久力量越大）' },
  { key: 'K', desc: '平击球（速度快，风险高）' },
  { key: 'L', desc: '切削球（低平、慢，防守/过渡）' },
  { key: 'I', desc: '挑高球（越过网前对手）' },
  { key: '空格', desc: '发球：按下抛球，在球最高点松开击球；第二发请用 J 上旋 / L 切削更稳' },
  { key: 'Esc / P', desc: '暂停 / 继续' },
];

const SHOT_KEYS = { KeyJ: 'topspin', KeyK: 'flat', KeyL: 'slice', KeyI: 'lob' };
const MAX_HOLD = 0.6;

function nowSeconds() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/**
 * Attach keyboard controls to a Simulation.
 * @param {import('../game/simulation.js').Simulation} sim
 * @param {number} playerIndex
 * @param {EventTarget} [target=window]
 * @param {{now?:()=>number}} [opts]
 * @returns {() => void} detach function
 */
export function attachKeyboard(sim, playerIndex = 0, target = (typeof window !== 'undefined' ? window : globalThis), opts = {}) {
  const now = opts.now || nowSeconds;
  const down = new Set();          // currently held movement keys (by e.code)
  const shotDown = new Map();      // shot key code -> {t0, shot}
  let spaceDown = null;

  const LEFT = ['KeyA', 'ArrowLeft'], RIGHT = ['KeyD', 'ArrowRight'], UP = ['KeyW', 'ArrowUp'], DOWN = ['KeyS', 'ArrowDown'];
  const held = (arr) => arr.some((k) => down.has(k));

  function pushMove() {
    sim.setMove(playerIndex, (held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0), (held(DOWN) ? 1 : 0) - (held(UP) ? 1 : 0));
  }
  function aim() {
    const ax = (held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0);
    // up = toward the net = deep shot request; down = short
    const ad = (held(UP) ? 1 : 0) - (held(DOWN) ? 1 : 0);
    return { aimX: ax === 0 ? null : ax, aimDepth: ad === 0 ? null : ad };
  }
  function isServing() {
    const m = sim.state.match;
    return (m.phase === 'serve-prep' || m.phase === 'serving') && m.server === playerIndex;
  }
  function releaseAll() {
    down.clear(); shotDown.clear(); spaceDown = null;
    sim.setMove(playerIndex, 0, 0);
  }

  function onKeyDown(e) {
    const c = e.code;
    if (c === 'Escape' || c === 'KeyP') {
      if (!e.repeat) sim.pause(!sim.paused);
      if (e.preventDefault) e.preventDefault();
      return;
    }
    if (c === 'Space' || c in SHOT_KEYS) { if (e.preventDefault) e.preventDefault(); }
    if (e.repeat) return;
    if (LEFT.includes(c) || RIGHT.includes(c) || UP.includes(c) || DOWN.includes(c)) {
      if (e.preventDefault && c.startsWith('Arrow')) e.preventDefault();
      down.add(c); pushMove(); return;
    }
    if (c === 'Space') {
      spaceDown = now();
      if (isServing()) sim.serveToss(playerIndex);
      else sim.prepare(playerIndex, { shot: 'flat' });
      return;
    }
    if (c in SHOT_KEYS) {
      const shot = SHOT_KEYS[c];
      shotDown.set(c, { t0: now(), shot });
      if (isServing()) sim.serveToss(playerIndex);
      else sim.prepare(playerIndex, { shot });
    }
  }

  function onKeyUp(e) {
    const c = e.code;
    if (LEFT.includes(c) || RIGHT.includes(c) || UP.includes(c) || DOWN.includes(c)) { down.delete(c); pushMove(); return; }
    if (c === 'Space' && spaceDown !== null) {
      const hold = now() - spaceDown; spaceDown = null;
      const serving = isServing();
      const second = sim.state.match.faultCount > 0;
      const a = aim();
      sim.swing(playerIndex, {
        shot: serving ? (second ? 'topspin' : 'flat') : 'flat', side: 'auto', power: serving ? (second ? 0.7 : 0.9) : powerFromHold(hold),
        aimX: a.aimX, aimDepth: a.aimDepth, ageMs: 0, source: 'keyboard',
      });
      return;
    }
    if (c in SHOT_KEYS && shotDown.has(c)) {
      const { t0, shot } = shotDown.get(c); shotDown.delete(c);
      const hold = now() - t0;
      const serving = isServing();
      const a = aim();
      sim.swing(playerIndex, {
        shot, side: 'auto', power: serving ? (shot === 'flat' ? 0.92 : 0.75) : powerFromHold(hold),
        aimX: a.aimX, aimDepth: a.aimDepth, ageMs: 0, source: 'keyboard',
      });
    }
  }
  const onBlur = () => releaseAll();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  if (target.addEventListener && typeof window !== 'undefined' && target === window) window.addEventListener('blur', onBlur);

  return function detach() {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    if (typeof window !== 'undefined' && target === window) window.removeEventListener('blur', onBlur);
    releaseAll();
  };
}

/** Hold time (s) -> swing power in [0.25, 1]. */
export function powerFromHold(hold) {
  return Math.min(1, 0.25 + 0.75 * Math.min(hold, MAX_HOLD) / MAX_HOLD);
}
