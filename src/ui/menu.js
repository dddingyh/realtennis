// Chinese start menu (HTML overlay) -> config object. Persists choices in localStorage.
const STYLES = [
  { id: 'grinder', name: '底线型', desc: '稳健底线对攻，重上旋深球，耐心等你失误。' },
  { id: 'aggressive', name: '进攻型', desc: '站位靠前抢攻压线，逮住短球就上网终结。' },
  { id: 'serveVolley', name: '发球上网', desc: '大力发球后立刻冲网，用截击和高压收分。' },
  { id: 'counter', name: '防守反击', desc: '退守深区什么球都能救，擅长挑高与穿越球。' },
];
const SURFACES = [{ id: 'hard', name: '硬地', c: '#2f62ab' }, { id: 'clay', name: '红土', c: '#c3592c' }, { id: 'grass', name: '草地', c: '#5ca64b' }];
const FORMATS = [
  { id: 'tb', name: '抢七', format: { sets: 1, gamesPerSet: 0, tiebreak: true, shortGames: false, tiebreakOnly: true } },
  { id: 'set', name: '一盘', format: { sets: 1, gamesPerSet: 6, tiebreak: true, shortGames: false } },
  { id: 'bo3', name: '三盘两胜短盘', format: { sets: 3, gamesPerSet: 4, tiebreak: true, shortGames: true } },
];
const CONTROLS = [{ id: 'keyboard', name: '键盘' }, { id: 'phone', name: '手机体感' }];
const HANDS = [{ id: 'R', name: '右手' }, { id: 'L', name: '左手' }];
const AUTOS = [{ id: 'off', name: '关' }, { id: 'assist', name: '辅助（推荐，需要自己控制大范围移动）' }, { id: 'full', name: '全自动（简单模式）' }];
const SPEEDS = [{ id: '0.7', name: '0.7' }, { id: '0.8', name: '0.8' }, { id: '0.85', name: '0.85（默认）' }, { id: '0.9', name: '0.9' }, { id: '1.0', name: '1.0' }];
const ARCHETYPES = [
  { id: 'elastic', name: '灵动防守型', desc: '瘦削柔韧，低重心滑步，双反稳定。' },
  { id: 'lanky', name: '高个进攻型', desc: '修长挺拔，早引拍，平击压迫。' },
  { id: 'classic', name: '经典', desc: '均衡的标准体型。' },
];
// Generic default kits per archetype (colours only; [main kit, alternate kit when both players pick the same build])
const KITS = {
  elastic: [{ skin: '#e0a97c', hair: '#2a1d12', shirt: '#1f8f8a', shorts: '#1d2433', shoes: '#f2f2f2', headband: null },
    { skin: '#c98a5b', hair: '#111111', shirt: '#e86a3a', shorts: '#22283a', shoes: '#f2f2f2', headband: null }],
  lanky: [{ skin: '#f1c9a5', hair: '#5a3a22', shirt: '#f2f2ee', shorts: '#2a3350', shoes: '#f2f2f2', headband: '#2a3350' },
    { skin: '#e0a97c', hair: '#3b2415', shirt: '#2c4f9e', shorts: '#f2f2ee', shoes: '#f2f2f2', headband: '#f2f2ee' }],
  classic: [{ skin: '#c98a5b', hair: '#2a1d12', shirt: '#d64545', shorts: '#26376b', shoes: '#f2f2f2', headband: null },
    { skin: '#f1c9a5', hair: '#6b4423', shirt: '#f2c230', shorts: '#1c2a46', shoes: '#f2f2f2', headband: '#ffffff' }],
};
export function looksFor(arch0, arch1) {
  const a0 = KITS[arch0] ? arch0 : 'classic', a1 = KITS[arch1] ? arch1 : 'classic';
  const l0 = { ...KITS[a0][0], archetype: a0 };
  const l1 = { ...KITS[a1][a0 === a1 ? 1 : 0], archetype: a1 };
  if (l1.shirt === l0.shirt) Object.assign(l1, { shirt: KITS[a1][1].shirt, shorts: KITS[a1][1].shorts });
  return [l0, l1];
}
const LEVEL_NAMES = ['新手', '新手', '业余', '业余', '进阶', '进阶', '高手', '高手', '职业', '大师'];
const DEFAULTS = { style: 'grinder', level: 5, surface: 'hard', format: 'set', control: 'keyboard', hand: 'R', auto: 'assist', offset: 0, sound: true, speech: false, speed: '0.85', arch0: 'classic', arch1: 'classic' };
const KEY = 'realtennis.settings.v1';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}
function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

function renderKeyboardHelp(box, help) {
  const row = (k, d) => `<span class="row"><kbd>${k}</kbd>${d}</span>`;
  let html = '';
  try {
    if (Array.isArray(help)) {
      html = help.map((h) => {
        if (Array.isArray(h)) return row(h[0], h[1]);
        if (h && typeof h === 'object') return row(h.keys || h.key || '', h.desc || h.label || h.text || '');
        return `<span class="row">${h}</span>`;
      }).join('');
    } else if (help && typeof help === 'object') html = Object.entries(help).map(([k, v]) => row(k, v)).join('');
    else if (typeof help === 'string') html = help.split('\n').map((l) => `<span class="row">${l}</span>`).join('<br>');
  } catch (e) { html = ''; }
  if (!html) html = row('WASD/方向键', '移动') + row('J', '上旋') + row('K', '平击') + row('L', '切削') + row('I', '挑高') + row('空格', '发球') + row('P/Esc', '暂停');
  box.innerHTML = '<div style="color:#fff;font-weight:700;margin-bottom:2px">键盘操作</div>' + html;
}

export function createMenu({ phone, getKeyboardHelp, onStart }) {
  const s = loadSettings();
  const menu = $('menu');
  const seg = (id, items, key, render) => {
    const box = $(id); box.innerHTML = '';
    for (const it of items) {
      const b = el('button', s[key] === it.id ? 'on' : '', render ? render(it) : it.name);
      b.type = 'button'; b.dataset.id = it.id;
      b.onclick = () => { s[key] = it.id; [...box.children].forEach((c) => c.classList.toggle('on', c.dataset.id === it.id)); saveSettings(s); if (key === 'control') updatePhone(); };
      box.appendChild(b);
    }
  };
  // style cards
  const sbox = $('opt-style'); sbox.innerHTML = '';
  for (const st of STYLES) {
    const b = el('button', 'card' + (s.style === st.id ? ' on' : ''), `<b>${st.name}</b><i>${st.desc}</i>`);
    b.type = 'button'; b.dataset.id = st.id;
    b.onclick = () => { s.style = st.id; [...sbox.children].forEach((c) => c.classList.toggle('on', c.dataset.id === st.id)); saveSettings(s); };
    sbox.appendChild(b);
  }
  seg('opt-surface', SURFACES, 'surface', (it) => `<span class="surface-sw" style="background:${it.c}"></span>${it.name}`);
  seg('opt-format', FORMATS, 'format');
  seg('opt-control', CONTROLS, 'control');
  seg('opt-hand', HANDS, 'hand');
  seg('opt-auto', AUTOS, 'auto');
  seg('opt-speed', SPEEDS, 'speed');
  const archCards = (id, key) => {
    const box = $(id); box.innerHTML = '';
    for (const a of ARCHETYPES) {
      const b = el('button', 'card' + (s[key] === a.id ? ' on' : ''), `<b>${a.name}</b><i>${a.desc}</i>`);
      b.type = 'button'; b.dataset.id = a.id;
      b.onclick = () => { s[key] = a.id; [...box.children].forEach((c) => c.classList.toggle('on', c.dataset.id === a.id)); saveSettings(s); };
      box.appendChild(b);
    }
  };
  archCards('opt-arch0', 'arch0'); archCards('opt-arch1', 'arch1');

  const lv = $('opt-level'); lv.value = s.level;
  const updLv = () => { s.level = +lv.value; $('lv-val').textContent = lv.value; $('lv-label').textContent = LEVEL_NAMES[s.level - 1]; saveSettings(s); };
  lv.oninput = updLv; updLv();
  const off = $('opt-offset'); off.value = s.offset;
  const updOff = () => { s.offset = +off.value; $('off-val').textContent = `${s.offset > 0 ? '+' : ''}${s.offset} ms`; phone?.setOffset(s.offset); saveSettings(s); };
  off.oninput = updOff; updOff();
  $('off-reset').onclick = () => { off.value = 0; updOff(); };

  const snd = $('opt-sound'), spc = $('opt-speech');
  const updSnd = () => { snd.textContent = `音效 ${s.sound ? '开' : '关'}`; snd.classList.toggle('on', s.sound); spc.textContent = `裁判报分 (英文) ${s.speech ? '开' : '关'}`; spc.classList.toggle('on', s.speech); saveSettings(s); api.onAudio?.(s); };
  snd.onclick = () => { s.sound = !s.sound; updSnd(); }; spc.onclick = () => { s.speech = !s.speech; updSnd(); };

  renderKeyboardHelp($('kb-help'), getKeyboardHelp());
  getKeyboardHelp.async?.().then((h) => h && renderKeyboardHelp($('kb-help'), h)).catch(() => {});

  // phone panel
  const panel = $('phone-panel');
  const paint = () => {
    const st = phone?.status || 'idle';
    $('room-code').textContent = phone?.roomCode || '------';
    $('phone-url').textContent = phone?.url || '';
    const stEl = $('phone-status');
    stEl.className = 'status ' + (st === 'connected' ? 'connected' : st === 'lost' || st === 'unavailable' ? 'lost' : 'waiting');
    stEl.style.whiteSpace = 'pre-line';
    const base = st === 'connected' ? '手机已连接' : st === 'lost' ? '连接异常，自动重试中…' : st === 'unavailable' ? '手机连接不可用（请用键盘）' : st === 'connecting' ? '正在连接信令服务器…' : st === 'pairing' ? '发现手机，正在建立连接…' : '已就绪，等待手机扫码并点“开始”';
    stEl.querySelector('span').textContent = phone?.message && st !== 'connected' ? base + '\n' + phone.message : base;
    const qr = $('qr'), fb = $('qr-fallback');
    let ok = false;
    if (phone?.url && phone.drawQR) {
      try { qr.getContext('2d').clearRect(0, 0, qr.width, qr.height); phone.drawQR(qr, phone.url, 4); ok = true; } catch (e) { ok = false; }
    }
    qr.classList.toggle('hidden', !ok); fb.classList.toggle('hidden', ok);
  };
  const updatePhone = () => {
    const on = s.control === 'phone';
    panel.classList.toggle('hidden', !on);
    if (on && phone) { phone.start().then(paint); paint(); }
  };
  phone?.onChange(() => { if (s.control === 'phone') paint(); });
  updatePhone();

  $('btn-start').onclick = () => {
    const fmt = FORMATS.find((f) => f.id === s.format) || FORMATS[1];
    const cfg = {
      surface: s.surface, aiStyle: s.style, aiLevel: Math.round((0.1 + (s.level - 1) / 9 * 0.9) * 100) / 100,
      format: { ...fmt.format }, humanHand: s.hand, autoMove: [s.auto, 'off'], playerNames: ['你', 'AI'],
      control: s.control, timingOffsetMs: s.offset, sound: s.sound, speech: s.speech,
      timeScale: parseFloat(s.speed) || 0.85, looks: looksFor(s.arch0, s.arch1),
    };
    onStart(cfg);
  };
  const api = {
    settings: s, el: menu,
    show() { menu.classList.remove('hidden'); updatePhone(); },
    hide() { menu.classList.add('hidden'); },
    onAudio: null,
  };
  return api;
}
