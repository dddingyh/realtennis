// Keyboard control for the arcade sim (ARCADE.md 3.3).
//   Space / J = topspin swing, K = flat, L = slice, I = lob. Power = hold time; the swing happens on release
//   (a quick tap = medium power). W / ArrowUp / Shift = toggle net rush. Esc / P = pause.
// attachKeyboard(sim, i, target?) -> detach()  (detach.power() = current hold power 0..1 for a HUD power bar,
// detach.holding() = shot name being held or null). `target` defaults to window/document; any EventTarget works (tests).

export const KEYBOARD_HELP = [
  { keys: '空格 / J', text: '上旋击球（按住蓄力，松开挥拍）' },
  { keys: 'K', text: '平击（更快，更难控）' },
  { keys: 'L', text: '切削（轻按 = 放小球）' },
  { keys: 'I', text: '挑高球' },
  { keys: 'W / ↑ / Shift', text: '上网 / 回底线' },
  { keys: 'Esc / P', text: '暂停' },
  { keys: '时机', text: '早按 = 斜线拉开，晚按 = 直线推出；发球先抛球再在最高点击球' },
];

export const HOLD_FULL = 0.6;       // seconds of holding for full power
export const TAP_POWER = 0.55;      // a quick tap
export const TAP_TIME = 0.12;

const SWING_KEYS = { Space: 'topspin', KeyJ: 'topspin', KeyK: 'flat', KeyL: 'slice', KeyI: 'lob' };
const NET_KEYS = new Set(['KeyW', 'ArrowUp', 'ShiftLeft', 'ShiftRight']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export function powerFromHold(seconds) {
  if (seconds <= TAP_TIME) return TAP_POWER;
  const u = Math.min(1, (seconds - TAP_TIME) / (HOLD_FULL - TAP_TIME));
  return TAP_POWER + (1 - TAP_POWER) * u;
}

export function attachKeyboard(sim, i, target) {
  const tgt = target || (typeof window !== 'undefined' ? window : null);
  if (!tgt) return () => {};
  const down = new Map();            // code -> press time
  let held = null;
  const onDown = (e) => {
    const code = e.code;
    if (SWING_KEYS[code]) {
      if (e.repeat || down.has(code)) { if (e.preventDefault) e.preventDefault(); return; }
      down.set(code, now()); held = SWING_KEYS[code];
      if (e.preventDefault) e.preventDefault();
    } else if (NET_KEYS.has(code)) {
      if (!e.repeat) sim.toggleNet(i);
      if (e.preventDefault) e.preventDefault();
    } else if (PAUSE_KEYS.has(code)) {
      if (!e.repeat) sim.pause(!sim.paused);
      if (e.preventDefault) e.preventDefault();
    }
  };
  const onUp = (e) => {
    const code = e.code;
    if (!SWING_KEYS[code] || !down.has(code)) return;
    const t0 = down.get(code);
    down.delete(code);
    held = null;
    for (const c of down.keys()) held = SWING_KEYS[c];
    sim.swing(i, { shot: SWING_KEYS[code], power: powerFromHold(now() - t0), ageMs: 0, source: 'keyboard' });
    if (e.preventDefault) e.preventDefault();
  };
  const onBlur = () => { down.clear(); held = null; };
  tgt.addEventListener('keydown', onDown);
  tgt.addEventListener('keyup', onUp);
  if (tgt.addEventListener && typeof window !== 'undefined' && tgt === window) window.addEventListener('blur', onBlur);
  const detach = () => {
    tgt.removeEventListener('keydown', onDown);
    tgt.removeEventListener('keyup', onUp);
    if (typeof window !== 'undefined') window.removeEventListener('blur', onBlur);
    down.clear();
  };
  detach.power = () => {
    let best = 0;
    for (const t0 of down.values()) best = Math.max(best, now() - t0 <= TAP_TIME ? 0 : powerFromHold(now() - t0));
    return best;
  };
  detach.holding = () => held;
  return detach;
}
