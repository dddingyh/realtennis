// HTML/CSS overlay: score bug, timing meter, stamina, stance, popups, banners, pause + end screens.
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const SHOT_NAMES = { topspin: '上旋', flat: '平击', slice: '切削', lob: '高吊', volley: '截击', smash: '扣杀', drop: '放小球' };
export const ZONE_TEXT = { base: '底线', net: '网前', toNet: '上网中…', toBase: '回底线…' };
const PT = ['0', '15', '30', '40'];

export function pointLabel(m, i) {
  const p = m.points[i], o = m.points[1 - i];
  if (m.isTiebreak) return String(p);
  if (p >= 3 && o >= 3) {
    if (m.shortGames) return '40';
    if (p === o) return '40';
    return p > o ? 'AD' : '40';
  }
  return PT[Math.min(3, p)];
}

const STAT_ROWS = [
  ['得分', 'points'], ['Ace 发球直接得分', 'aces'], ['双误', 'doubleFaults'], ['制胜分', 'winners'],
  ['非受迫性失误', 'unforced'], ['受迫性失误', 'forced'], ['网前得分', 'netPointsWon'], ['发球得分', 'serviceWinners'],
];

export function createHud(root) {
  root.innerHTML = `
  <div id="bug" class="panel">
    <div class="brow" data-i="0"><span class="sdot"></span><span class="nm"></span><span class="sets"></span><span class="g"></span><span class="pt"></span><span class="stam"><i></i></span></div>
    <div class="brow" data-i="1"><span class="sdot"></span><span class="nm"></span><span class="sets"></span><span class="g"></span><span class="pt"></span><span class="stam"><i></i></span></div>
    <div class="bsub"><span id="serveSpeed"></span><span id="ptNote"></span></div>
  </div>
  <div id="topright">
    <div id="phoneChip" class="chip hidden"></div>
    <button id="btnSound" class="chip btn" title="声音">🔊</button>
    <button id="btnPause" class="chip btn" title="暂停 (Esc / P)">⏸ 暂停</button>
  </div>
  <div id="stance" class="panel"><div class="zone"><span class="ico">🎾</span><b id="zoneName">底线</b></div><div class="keys" id="stanceKeys"></div></div>
  <div id="hintText"></div>
  <div id="tmeter" class="panel">
    <div class="tm-lab"><b class="e">早</b><b class="g">准</b><b class="l">晚</b></div>
    <div class="tm-bar"><div class="tm-good"></div><div class="tm-tick t1"></div><div class="tm-tick t2"></div><div class="tm-mk"></div></div>
    <div class="tm-res"><span class="arr">·</span><span class="info"></span></div>
  </div>
  <div id="powerBar" class="panel hidden"><span class="pn"></span><div class="pbar"><i></i></div></div>
  <div id="rallyChip" class="hidden"></div>
  <div id="keyhelp" class="panel hidden"></div>`;
  const R = {
    bug: $('#bug', root), rows: [0, 1].map((i) => $(`.brow[data-i="${i}"]`, root)),
    serveSpeed: $('#serveSpeed', root), ptNote: $('#ptNote', root),
    phoneChip: $('#phoneChip', root), btnPause: $('#btnPause', root), btnSound: $('#btnSound', root),
    zoneName: $('#zoneName', root), stanceKeys: $('#stanceKeys', root), hintText: $('#hintText', root),
    tm: $('#tmeter', root), tmMk: $('.tm-mk', root), tmArr: $('.tm-res .arr', root), tmInfo: $('.tm-res .info', root), rally: $('#rallyChip', root), power: $('#powerBar', root), keyhelp: $('#keyhelp', root),
  };
  const cache = { names: '', sets: '', games: '', pts: '', server: -1, stam: [-1, -1], zone: '', hint: '', rally: -1 };
  let tmTimer = 0, tmLast = 0;
  const popLayer = $('#popups'), bannerLayer = $('#banners');

  function setKeyHelp(help) {
    let html = '';
    if (Array.isArray(help)) {
      html = help.map((h) => {
        if (typeof h === 'string') return `<div>${h}</div>`;
        if (Array.isArray(h)) return `<div><kbd>${h[0]}</kbd> ${h[1] || ''}</div>`;
        if (h && typeof h === 'object') return `<div><kbd>${h.keys || h.key || ''}</kbd> ${h.text || h.desc || h.label || ''}</div>`;
        return '';
      }).join('');
    } else if (typeof help === 'string') html = `<div>${help}</div>`;
    else if (help && typeof help === 'object') html = Object.entries(help).map(([k, v]) => `<div><kbd>${k}</kbd> ${v}</div>`).join('');
    R.keyhelp.innerHTML = '<b>键盘操作</b>' + html;
    R.stanceKeys.textContent = 'W / ↑ / Shift 上网·回底线';
  }

  const api = {
    root, setKeyHelp,
    show(v) { root.classList.toggle('hidden', !v); },
    showKeyHelp(v) { R.keyhelp.classList.toggle('hidden', !v); },
    setNames(names) { names.forEach((n, i) => { R.rows[i].querySelector('.nm').textContent = n; }); cache.names = names.join('|'); },
    setSoundIcon(on) { R.btnSound.textContent = on ? '🔊' : '🔇'; },
    setPhone(st) {
      const c = R.phoneChip;
      if (!st) { c.classList.add('hidden'); return; }
      c.classList.remove('hidden');
      const map = { connected: ['good', `📱 已连接${st.rttMs != null ? ' · ' + st.rttMs + 'ms' : ''}`], stale: ['warn', '📱 手机无响应'], waiting: ['wait', `📱 等待连接 · 房间 ${st.roomCode || ''}`], pairing: ['wait', '📱 正在配对…'], starting: ['wait', '📱 正在连接…'], error: ['bad', '📱 连接失败'] };
      const [cls, txt] = map[st.state] || ['wait', '📱 …'];
      c.className = 'chip ' + cls; c.textContent = txt;
    },
    setPower(p, name) {
      const b = R.power;
      if (!name) { if (!b.classList.contains('hidden')) b.classList.add('hidden'); return; }
      b.classList.remove('hidden');
      b.querySelector('.pn').textContent = SHOT_NAMES[name] || name;
      b.querySelector('i').style.width = Math.round(p * 100) + '%';
    },
    setStanceKeys(txt) { R.stanceKeys.textContent = txt; },

    /** per-frame: cheap diffed DOM writes */
    update(state, hi) {
      const m = state.match;
      const sets = m.sets.map((s) => s.join('-')).join('|'), games = m.games.join('-');
      const pts = pointLabel(m, 0) + '-' + pointLabel(m, 1);
      if (sets !== cache.sets || games !== cache.games || pts !== cache.pts || m.server !== cache.server) {
        cache.sets = sets; cache.games = games; cache.pts = pts; cache.server = m.server;
        for (let i = 0; i < 2; i++) {
          const r = R.rows[i];
          r.querySelector('.sets').innerHTML = m.sets.map((s) => `<i class="${s[i] > s[1 - i] ? 'w' : ''}">${s[i]}</i>`).join('');
          r.querySelector('.g').textContent = m.games[i];
          r.querySelector('.pt').textContent = pointLabel(m, i);
          r.classList.toggle('srv', m.server === i);
          r.classList.toggle('me', i === hi);
        }
        R.ptNote.textContent = m.isTiebreak ? '抢七' : '';
      }
      for (let i = 0; i < 2; i++) {
        const s = Math.round(state.players[i].stamina * 50) / 50;
        if (s !== cache.stam[i]) { cache.stam[i] = s; const bar = R.rows[i].querySelector('.stam i'); bar.style.width = (s * 100) + '%'; bar.className = s < 0.3 ? 'low' : s < 0.6 ? 'mid' : ''; }
      }
      const z = state.players[hi].zone;
      if (z !== cache.zone) { cache.zone = z; R.zoneName.textContent = ZONE_TEXT[z] || z; R.zoneName.parentElement.className = 'zone z-' + z; }
      const ht = (state.hint && state.hint.i === hi && state.hint.text) || '';
      if (ht !== cache.hint) { cache.hint = ht; R.hintText.textContent = ht; R.hintText.classList.toggle('on', !!ht); }
      const sh = state.rally ? state.rally.shots : 0;
      if (sh !== cache.rally) { cache.rally = sh; R.rally.textContent = sh >= 4 ? `回合 ${sh} 拍` : ''; R.rally.classList.toggle('hidden', sh < 4); }
      if (tmTimer > 0) { tmTimer -= 1 / 60; if (tmTimer <= 0) R.tm.classList.remove('on'); }
    },

    serveSpeed(kmh) { R.serveSpeed.textContent = `发球 ${Math.round(kmh)} km/h`; R.serveSpeed.classList.remove('flash'); void R.serveSpeed.offsetWidth; R.serveSpeed.classList.add('flash'); },

    /** timing meter after a human swing */
    timingResult(e, st, mePos) {
      const ms = e.timingMs || 0, lim = 240;
      const f = Math.max(-1, Math.min(1, ms / lim));
      R.tmMk.style.left = (50 + f * 50) + '%';
      R.tmMk.className = 'tm-mk ' + (e.timing === 'perfect' ? 'g' : e.timing === 'wide' ? 'x' : e.timing === 'early' ? 'e' : 'l');
      let arrow = '↑', txt = '直线';
      const tx = st.lastShot && st.lastShot.target ? st.lastShot.target.x : null;
      if (tx != null && mePos) { const d = tx - mePos.x; if (d < -1.0) { arrow = '⬅'; txt = '打向左侧'; } else if (d > 1.0) { arrow = '➡'; txt = '打向右侧'; } else { arrow = '⬆'; txt = '打向中路'; } }
      else if (e.dir != null) { arrow = e.dir < -0.25 ? '⬅' : e.dir > 0.25 ? '➡' : '⬆'; }
      R.tmArr.textContent = arrow;
      R.tmArr.className = 'arr ' + (arrow === '⬅' ? 'L' : arrow === '➡' ? 'R' : 'C');
      R.tmInfo.textContent = `${SHOT_NAMES[e.shot] || e.shot || ''} · ${Math.round(e.speedKmh || 0)} km/h · ${txt}`;
      R.tm.classList.add('on'); tmTimer = 3.2; void tmLast;
    },

    pop(text, kind, x, y, sub) {
      const d = el('div', 'pop ' + kind, `<span>${text}</span>${sub ? `<small>${sub}</small>` : ''}`);
      d.style.left = x + 'px'; d.style.top = y + 'px';
      popLayer.appendChild(d);
      d.addEventListener('animationend', () => d.remove());
      setTimeout(() => d.remove(), 2600);
      while (popLayer.children.length > 8) popLayer.firstChild.remove();
    },
    banner(text, sub, kind = '') {
      const d = el('div', 'banner ' + kind, `<b>${text}</b>${sub ? `<small>${sub}</small>` : ''}`);
      bannerLayer.appendChild(d);
      d.addEventListener('animationend', () => d.remove());
      setTimeout(() => d.remove(), 3600);
      while (bannerLayer.children.length > 2) bannerLayer.firstChild.remove();
    },
    clearFx() { popLayer.innerHTML = ''; bannerLayer.innerHTML = ''; R.tm.classList.remove('on'); R.serveSpeed.textContent = ''; cache.sets = cache.games = cache.pts = ''; cache.zone = ''; },
    hideTiming() { R.tm.classList.remove('on'); },
  };
  R.btnPause.addEventListener('click', () => api.onPause && api.onPause());
  R.btnSound.addEventListener('click', () => api.onSound && api.onSound());
  return api;
}

export function renderEnd(root, { state, humanIdx, names, onAgain, onMenu }) {
  const m = state.match, st = m.stats || {};
  const won = m.winner === humanIdx;
  const setsLine = m.sets.map((s) => `<span class="sc"><b>${s[humanIdx]}</b>-<b>${s[1 - humanIdx]}</b></span>`).join('');
  const val = (key, i) => (st[key] && st[key][i] != null ? st[key][i] : null);
  let rows = '';
  for (const [label, key] of STAT_ROWS) {
    const a = val(key, humanIdx), b = val(key, 1 - humanIdx);
    if (a == null || b == null) continue;
    const tot = a + b || 1;
    rows += `<div class="srow"><span class="v l">${a}</span><span class="bar"><i style="width:${(a / tot) * 100}%"></i></span><span class="lbl">${label}</span><span class="bar r"><i style="width:${(b / tot) * 100}%"></i></span><span class="v r">${b}</span></div>`;
  }
  const fs = (i) => (val('firstServesTotal', i) != null ? val('firstServesTotal', i) : val('firstServes', i));
  if (fs(0) != null && val('firstServesIn', 0) != null) {
    const pct = (i) => (fs(i) ? Math.round((val('firstServesIn', i) / fs(i)) * 100) + '%' : '—');
    rows += `<div class="srow plain"><span class="v l">${pct(humanIdx)}</span><span class="lbl">一发进球率</span><span class="v r">${pct(1 - humanIdx)}</span></div>`;
  }
  if (val('maxServeKmh', 0) != null) rows += `<div class="srow plain"><span class="v l">${val('maxServeKmh', humanIdx)}</span><span class="lbl">最快发球 km/h</span><span class="v r">${val('maxServeKmh', 1 - humanIdx)}</span></div>`;
  if (Array.isArray(st.rallies) && st.rallies.length) rows += `<div class="srow plain"><span class="v l"></span><span class="lbl">最长回合 ${Math.max(...st.rallies)} 拍 · 平均 ${(st.rallies.reduce((a, b) => a + b, 0) / st.rallies.length).toFixed(1)} 拍</span><span class="v r"></span></div>`;
  root.innerHTML = `<div class="end-card ${won ? 'win' : 'lose'}">
    <div class="end-title">${won ? '🏆 你赢了！' : '😵 惜败…'}</div>
    <div class="end-sub">${won ? '漂亮的比赛，球迷为你起立鼓掌！' : '再来一局，找回节奏！'}</div>
    <div class="end-score"><div class="en"><b>${names[humanIdx]}</b><b>${names[1 - humanIdx]}</b></div>${setsLine || '<span class="sc"><b>' + m.games[humanIdx] + '</b>-<b>' + m.games[1 - humanIdx] + '</b></span>'}</div>
    <div class="stats">${rows || '<div class="srow plain"><span class="lbl">暂无统计</span></div>'}</div>
    <div class="end-btns"><button class="big-btn" id="endAgain">再来一局</button><button class="big-btn alt" id="endMenu">返回菜单</button></div></div>`;
  $('#endAgain', root).onclick = onAgain; $('#endMenu', root).onclick = onMenu;
}
