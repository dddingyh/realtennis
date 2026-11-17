// DOM panels for the lab: tuning sliders, readout, stats, overlay toggles, minimap.
import { colOf, SHOT_COL } from './scene.js';

export const TUNE = [
  { g: '物理 (弧线 / 旋转)' },
  { k: 'liftGain', n: '升力 Magnus', min: 0, max: 4, step: 0.05, def: 1.8 },
  { k: 'kickGain', n: '上旋弹跳', min: 0, max: 4, step: 0.05, def: 1.6 },
  { k: 'skidGain', n: '下旋滑行', min: 0, max: 4, step: 0.05, def: 1.4 },
  { k: 'sideKick', n: '侧旋落地偏', min: 0, max: 2, step: 0.02, def: 0.5 },
  { k: 'sideScale', n: '侧旋量', min: 0, max: 3, step: 0.05, def: 1.0 },
  { k: 'spinScale', n: '总旋转量', min: 0, max: 3, step: 0.05, def: 1.0 },
  { k: 'ballSpeedScale', n: '球速倍率', min: 0.5, max: 1.6, step: 0.02, def: 1.0 },
  { g: '时机窗口 (秒)' },
  { k: 'T_PERFECT', n: '完美窗', min: 0.01, max: 0.12, step: 0.005, def: 0.035 },
  { k: 'T_FULL', n: '满偏窗', min: 0.06, max: 0.4, step: 0.005, def: 0.15 },
  { k: 'T_MISS', n: '挥空窗', min: 0.12, max: 0.6, step: 0.005, def: 0.26 },
  { g: '拍面方向 (°)' },
  { k: 'G_T', n: '时机→角度', min: 0, max: 60, step: 0.5, def: 26 },
  { k: 'G_F', n: '前后→角度/m', min: 0, max: 50, step: 0.5, def: 18 },
  { k: 'G_L', n: '侧距→角度/m', min: 0, max: 40, step: 0.5, def: 12 },
  { k: 'PSI_MAX', n: '最大角度', min: 20, max: 80, step: 1, def: 55 },
  { g: '移动 / 速度' },
  { k: 'VMAX', n: '最高跑速', min: 2, max: 8, step: 0.1, def: 4.2 },
  { k: 'ACC', n: '加速度', min: 2, max: 20, step: 0.5, def: 8 },
  { k: 'timeScale', n: '时间缩放', min: 0.15, max: 1.5, step: 0.01, def: 0.8 },
];

const SHOT_CN = { topspin: '上旋', flat: '平击', slice: '切削', lob: '挑高', volley: '截击', smash: '扣杀', drop: '放小球' };
const TIM_CN = { early: '偏早', perfect: '完美', late: '偏晚', wide: '过大' };
export const shotCN = (s) => SHOT_CN[s] || s || '—';

export function buildTuning(root, sim, saved, onChange) {
  root.innerHTML = '';
  const vals = {}, rows = {};
  for (const t of TUNE) {
    if (t.g) { const h = document.createElement('div'); h.className = 'tune-group'; h.textContent = t.g; root.appendChild(h); continue; }
    const v = saved[t.k] != null ? saved[t.k] : t.def; vals[t.k] = v;
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span class="n">${t.n}</span><input type="range" min="${t.min}" max="${t.max}" step="${t.step}" value="${v}"><output></output>`;
    const inp = r.querySelector('input'), out = r.querySelector('output');
    const show = () => { out.textContent = (+inp.value).toFixed(t.step < 0.01 ? 3 : t.step < 1 ? 2 : 0); r.classList.toggle('changed', Math.abs(inp.value - t.def) > t.step / 2); };
    inp.addEventListener('input', () => { vals[t.k] = +inp.value; show(); onChange(t.k, +inp.value); });
    show(); root.appendChild(r); rows[t.k] = { inp, show, t };
  }
  return { vals, set(k, v) { const r = rows[k]; if (r) { r.inp.value = v; vals[k] = +r.inp.value; r.show(); } }, rows };
}

export function buildOverlays(root, ov, local, onChange) {
  const items = [['predict', '预测路径'], ['contact', '预测接触点'], ['timing', '时机圈'], ['fan', '瞄准扇'], ['last', '上一拍轨迹'], ['hist', '历史轨迹'], ['trail', '球尾迹'], ['ring', '接触区圈'], ['mini', '小地图']];
  root.innerHTML = '';
  for (const [k, n] of items) {
    const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox';
    c.checked = k in ov ? ov[k] : local[k]; c.addEventListener('change', () => { if (k in ov) ov[k] = c.checked; else local[k] = c.checked; onChange(k, c.checked); });
    l.append(c, n); root.appendChild(l);
  }
}

function fmt(v, d = 1, unit = '') { return v == null || !Number.isFinite(v) ? '—' : v.toFixed(d) + unit; }
export function renderReadout(el, whoEl, ro, names) {
  if (!ro) { el.innerHTML = '<span class="k">尚无击球</span><span class="v"></span>'; whoEl.textContent = ''; return; }
  const s = ro.ls, m = ro.m || {}, c = s.contact;
  whoEl.textContent = s.machine ? '发球机' : (names[s.by] || '');
  const pick = (a, b) => (b != null ? b : a);
  const tm = s.timingMs, tcls = s.timing === 'perfect' ? 'good' : s.timing === 'wide' ? 'bad' : 'warn';
  const rows = [
    ['手别', s.side === 'fh' ? '正手' : s.side === 'bh' ? '反手' : '—'],
    ['球种', shotCN(s.shot) + (s.serve ? ' (发球)' : '')],
    ['时机', `${tm != null ? (tm > 0 ? '+' : '') + Math.round(tm) : '—'} ms ${TIM_CN[s.timing] || ''}`, tcls],
    ['接触 前/侧/高', c ? `${fmt(c.fwd, 2)} / ${fmt(c.lat, 2)} / ${fmt(c.h, 2)}` : '—'],
    ['拍面角 ψ', fmt(s.face, 1, '°')],
    ['球速', fmt(s.speedKmh, 0, ' km/h')],
    ['上旋', fmt(pick(s.spinRpm, s.topRpm), 0, ' rpm')],
    ['侧旋', fmt(s.sideRpm, 0, ' rpm')],
    ['过网高度', fmt(pick(s.netClear, m.netClear), 2, ' m')],
    ['弧线偏移', fmt(pick(s.curveM, m.curveM), 2, ' m')],
    ['弹起高度', fmt(pick(s.bounceApex, m.bounceApex), 2, ' m')],
    ['方向变化', fmt(s.dirChange, 0, '°')],
    ['质量', fmt(s.quality, 2), s.quality == null ? '' : s.quality > 0.7 ? 'good' : s.quality < 0.4 ? 'bad' : 'warn'],
    ['失误', s.mishit || '无', s.mishit ? 'bad' : ''],
  ];
  el.innerHTML = rows.map(([k, v, c2]) => `<span class="k">${k}</span><span class="v ${c2 || ''}">${v}</span>`).join('');
}

export function renderStats(el, o) {
  const rows = [['回合拍数', o.shots], ['制胜球', o.winners], ['失误', o.errors], ['挥空', o.whiffs], ['比分', o.score || '—'], ['引擎', o.engine]];
  el.innerHTML = rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
}

// ---------------- minimap (top-down, near baseline at the bottom)
export function drawMini(cv, d) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, hw = 7.2, hl = 13.6;
  const X = (x) => W / 2 + (x / hw) * (W / 2), Z = (z) => H / 2 + (z / hl) * (H / 2);
  g.fillStyle = '#0c1117'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1b3550'; g.fillRect(X(-5.485), Z(-11.885), X(5.485) - X(-5.485), Z(11.885) - Z(-11.885));
  g.strokeStyle = '#cfd8e0'; g.lineWidth = 1;
  const L = (a, b, c, e) => { g.beginPath(); g.moveTo(X(a), Z(b)); g.lineTo(X(c), Z(e)); g.stroke(); };
  g.strokeRect(X(-5.485), Z(-11.885), X(5.485) - X(-5.485), Z(11.885) - Z(-11.885));
  L(-4.115, -11.885, -4.115, 11.885); L(4.115, -11.885, 4.115, 11.885); L(-4.115, -6.4, 4.115, -6.4); L(-4.115, 6.4, 4.115, 6.4); L(0, -6.4, 0, 6.4);
  g.strokeStyle = '#fff'; g.lineWidth = 2; L(-5.8, 0, 5.8, 0);
  d.landings.forEach((l, i) => {
    g.globalAlpha = 0.35 + 0.65 * (i / Math.max(1, d.landings.length));
    g.fillStyle = colOf(l.shot); g.beginPath(); g.arc(X(l.x), Z(l.z), l.by === 0 ? 4 : 3, 0, 7); g.fill();
    if (l.in === false) { g.strokeStyle = '#ff6b6b'; g.lineWidth = 1.2; g.beginPath(); g.arc(X(l.x), Z(l.z), 6, 0, 7); g.stroke(); }
  });
  g.globalAlpha = 1;
  if (d.predLand) { g.strokeStyle = '#7ee7ff'; g.lineWidth = 1.5; g.beginPath(); g.arc(X(d.predLand.x), Z(d.predLand.z), 6, 0, 7); g.stroke(); }
  d.players.forEach((p, i) => { g.fillStyle = i === 0 ? '#4a90d9' : '#d9644a'; g.beginPath(); g.arc(X(p.x), Z(p.z), 5, 0, 7); g.fill(); });
  if (d.ball) { g.fillStyle = '#eaff5a'; g.beginPath(); g.arc(X(d.ball.x), Z(d.ball.z), 3, 0, 7); g.fill(); }
}
export function miniLegend(el) { el.innerHTML = Object.entries({ topspin: '上旋', flat: '平击', slice: '切削', lob: '挑高', volley: '截击' }).map(([k, n]) => `<span class="chip" style="border-left:6px solid ${SHOT_COL[k]}">${n}</span>`).join(''); }
