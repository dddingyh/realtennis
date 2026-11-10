// Start menu (HTML overlay). Pure DOM; main.js supplies callbacks and optional data (looks, key help, phone link).
export const STYLES = [
  { id: 'baseliner', name: '底线相持', ico: '🧱', desc: '稳扎稳打，拉你满场跑，耐心等你失误。' },
  { id: 'attacker', name: '压迫进攻', ico: '🔥', desc: '抢先发力，压着你的短球和二发，节奏飞快。' },
  { id: 'netrusher', name: '上网型', ico: '🏃', desc: '发球上网、截击封网，逼你打穿越与高吊。' },
  { id: 'trickster', name: '变化型', ico: '🎭', desc: '放小球、挑高球、变线变速，让你摸不透。' },
];
export const LEVELS = [
  { v: 0.2, name: '休闲' }, { v: 0.35, name: '简单' }, { v: 0.5, name: '普通' }, { v: 0.7, name: '困难' }, { v: 0.9, name: '大师' },
];
export const SURFACE_LIST = [
  { id: 'hard', name: '硬地', c: '#2f6db4' }, { id: 'clay', name: '红土', c: '#cc6a41' }, { id: 'grass', name: '草地', c: '#5aa846' },
];
export const FORMATS = [
  { id: 'tb', name: '抢七', desc: '一局抢七定胜负', format: { sets: 1, gamesPerSet: 0, tiebreak: true, shortGames: false } },
  { id: 'set', name: '一盘', desc: '先赢6局，6-6抢七', format: { sets: 1, gamesPerSet: 6, tiebreak: true, shortGames: false } },
  { id: 'bo3', name: '三盘两胜短盘', desc: '每盘先赢4局，无占先', format: { sets: 3, gamesPerSet: 4, tiebreak: true, shortGames: true } },
];
export const DEFAULTS = {
  style: 'baseliner', level: 0.5, surface: 'hard', format: 'set', speed: 0.8, control: 'keyboard', hand: 'R', offset: 0,
  look0: 0, look1: 1, sound: true, timing: true, landing: true, speech: false,
};
const KEY = 'cartoon-tennis-settings-v1';

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function lookChip(look, active) {
  const b = el('button', 'look-chip' + (active ? ' on' : ''));
  b.type = 'button';
  const c = (k, d) => (look && look[k]) || d;
  b.innerHTML = `<span class="av"><i class="hd" style="background:${c('skin', '#e8b88f')}"></i><i class="hr" style="background:${c('hair', '#222')}"></i><i class="bd" style="background:${c('shirt', '#e44')}"></i><i class="sh" style="background:${c('shorts', '#236')}"></i></span>`;
  return b;
}

/**
 * opts: { settings, looks:[], keyHelp, onChange(settings, key), onStart(settings), phone:{ready:bool} }
 */
export function createMenu(root, opts) {
  const S = opts.settings;
  const looks = opts.looks;
  root.innerHTML = '';
  const card = el('div', 'menu-card');
  card.innerHTML = `
    <header class="mhead"><div class="logo"><b>卡通网球</b><small>ARCADE TENNIS</small></div>
      <div class="tagline">挥拍时机决定球路 · 早打拉向对角，晚打推向直线</div>
      <a class="pixel-link" href="../index.html">← 像素复古版</a></header>
    <div class="mgrid"><section class="mcol" id="colL"></section><section class="mcol" id="colR"></section></div>
    <footer class="mfoot"><div class="khelp" id="mKeyHelp"></div><button class="start-btn" id="mStart">开始比赛 ▶</button></footer>`;
  root.appendChild(card);
  const L = card.querySelector('#colL'), Rr = card.querySelector('#colR');
  const refs = {};

  const section = (parent, title, extra) => { const s = el('div', 'msec'); s.innerHTML = `<h3>${title}${extra ? `<span class="hv" id="${extra}"></span>` : ''}</h3>`; parent.appendChild(s); return s; };
  const seg = (parent, items, key, { fmt, num } = {}) => {
    const w = el('div', 'seg');
    items.forEach((it) => {
      const b = el('button', 'segb', (it.c ? `<i class="sw" style="background:${it.c}"></i>` : '') + it.name); b.type = 'button';
      b.dataset.v = it.id != null ? it.id : it.v;
      if (String(S[key]) === String(b.dataset.v)) b.classList.add('on');
      b.addEventListener('click', () => {
        S[key] = num ? Number(b.dataset.v) : b.dataset.v;
        w.querySelectorAll('.segb').forEach((x) => x.classList.toggle('on', x === b)); opts.onChange(S, key);
      });
      w.appendChild(b);
    });
    parent.appendChild(w); return w;
  };
  const slider = (parent, key, min, max, step, show) => {
    const r = el('input', 'range'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = S[key];
    const hv = parent.querySelector('.hv');
    const upd = () => { if (hv) hv.textContent = show(Number(r.value)); };
    r.addEventListener('input', () => { S[key] = Number(r.value); upd(); opts.onChange(S, key); });
    upd(); parent.appendChild(r); return r;
  };

  // ---- left column
  const sStyle = section(L, '对手风格');
  const grid = el('div', 'styles');
  STYLES.forEach((st) => {
    const b = el('button', 'style-card' + (S.style === st.id ? ' on' : ''), `<span class="si">${st.ico}</span><b>${st.name}</b><small>${st.desc}</small>`); b.type = 'button';
    b.addEventListener('click', () => { S.style = st.id; grid.querySelectorAll('.style-card').forEach((x) => x.classList.toggle('on', x === b)); opts.onChange(S, 'style'); });
    grid.appendChild(b);
  });
  sStyle.appendChild(grid);
  const sLvl = section(L, '难度'); seg(sLvl, LEVELS.map((l) => ({ id: l.v, name: l.name })), 'level', { num: true });
  const row1 = el('div', 'two'); L.appendChild(row1);
  const sSurf = section(row1, '场地'); seg(sSurf, SURFACE_LIST, 'surface');
  const sFmt = section(row1, '赛制'); const fw = seg(sFmt, FORMATS, 'format');
  fw.querySelectorAll('.segb').forEach((b, i) => { b.title = FORMATS[i].desc; });
  const sSpd = section(L, '比赛速度', 'hvSpeed'); slider(sSpd, 'speed', 0.7, 1.0, 0.05, (v) => `${v.toFixed(2)}x`);
  const sSnd = section(L, '选项');
  const tg = el('div', 'toggles'); sSnd.appendChild(tg);
  const toggle = (key, label) => {
    const b = el('button', 'tog' + (S[key] ? ' on' : ''), `<i></i>${label}`); b.type = 'button';
    b.addEventListener('click', () => { S[key] = !S[key]; b.classList.toggle('on', S[key]); opts.onChange(S, key); });
    tg.appendChild(b);
  };
  toggle('sound', '音效'); toggle('timing', '计时圈'); toggle('landing', '落点提示'); toggle('speech', '裁判报分');

  // ---- right column
  const sCtl = section(Rr, '控制方式');
  seg(sCtl, [{ id: 'keyboard', name: '⌨ 键盘' }, { id: 'phone', name: '📱 手机体感' }], 'control');
  const phone = el('div', 'phone-panel hidden');
  phone.innerHTML = `<canvas id="qr" width="132" height="132"></canvas><div class="pinfo"><div class="room">房间号 <b id="roomCode">----</b></div><div class="pstat wait" id="phoneStatus">正在创建房间…</div><small id="phoneUrl"></small><small>用手机扫码，打开后点“开始”并允许动作传感器；像挥拍一样挥动手机。</small></div>`;
  sCtl.appendChild(phone);
  refs.phone = phone;
  const row2 = el('div', 'two'); Rr.appendChild(row2);
  const sHand = section(row2, '惯用手'); seg(sHand, [{ id: 'R', name: '右手' }, { id: 'L', name: '左手' }], 'hand');
  const sOff = section(row2, '时序偏移', 'hvOff'); slider(sOff, 'offset', -150, 150, 5, (v) => `${v > 0 ? '+' : ''}${v} ms`);
  sOff.title = '手机延迟补偿：打球总偏晚就往负方向调';
  const lookRow = (title, key) => {
    const s = section(Rr, title); const w = el('div', 'looks'); s.appendChild(w);
    const build = () => { w.innerHTML = ''; looks.forEach((lk, i) => { const c = lookChip(lk, S[key] === i); c.addEventListener('click', () => { S[key] = i; opts.onChange(S, key); build(); }); w.appendChild(c); }); };
    build(); return s;
  };
  lookRow('你的形象', 'look0'); lookRow('对手形象', 'look1');

  const kh = card.querySelector('#mKeyHelp');
  refs.keyHelp = kh;
  card.querySelector('#mStart').addEventListener('click', () => opts.onStart(S));

  const api = {
    root, settings: S,
    setKeyHelp(help) {
      let t = '';
      if (Array.isArray(help)) t = help.map((h) => (typeof h === 'string' ? h : Array.isArray(h) ? `${h[0]} ${h[1] || ''}` : `${h.keys || h.key || ''} ${h.text || h.desc || ''}`)).join('　·　');
      else if (typeof help === 'string') t = help; else if (help && typeof help === 'object') t = Object.entries(help).map(([k, v]) => `${k} ${v}`).join('　·　');
      kh.innerHTML = t ? `<b>键盘</b> ${t}` : '';
    },
    showPhone(v) { phone.classList.toggle('hidden', !v); },
    setPhone(st) {
      if (!st) return;
      const room = card.querySelector('#roomCode'); if (room) room.textContent = st.roomCode || '----';
      const url = card.querySelector('#phoneUrl'); if (url) url.textContent = st.controllerUrl || '';
      const stat = card.querySelector('#phoneStatus');
      const map = { connected: ['good', `已连接 ✔${st.rttMs != null ? ' · 延迟 ' + st.rttMs + 'ms' : ''}${st.hand ? ' · ' + (st.hand === 'L' ? '左手' : '右手') : ''}`], stale: ['warn', '手机无响应…'], waiting: ['wait', '等待手机扫码…'], pairing: ['wait', '正在配对…'], starting: ['wait', '正在创建房间…'], error: ['bad', st.message || '连接失败（可改用键盘）'] };
      const [cls, txt] = map[st.state] || ['wait', st.state || '…'];
      stat.className = 'pstat ' + cls; stat.textContent = txt;
    },
    qrCanvas() { return card.querySelector('#qr'); },
    setPhoneError(msg) { const stat = card.querySelector('#phoneStatus'); stat.className = 'pstat bad'; stat.textContent = msg; },
    show(v) { root.classList.toggle('hidden', !v); },
  };
  return api;
}
