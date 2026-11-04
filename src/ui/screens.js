// Pause overlay + end-of-match stats screen (HTML).
const $ = (id) => document.getElementById(id);

export function createScreens({ onResume, onRestart, onMenu, onAgain }) {
  $('btn-resume').onclick = () => onResume();
  $('btn-restart').onclick = () => onRestart();
  $('btn-tomenu').onclick = () => onMenu();
  $('btn-again').onclick = () => onAgain();
  $('btn-endmenu').onclick = () => onMenu();
  return {
    showPause(on) { $('pause').classList.toggle('hidden', !on); if (on) $('btn-resume').focus(); },
    showEnd(state) {
      const m = state.match, st = m.stats || {};
      const win = m.winner === 0;
      const t = $('end-title'); t.textContent = win ? '你赢了！' : '你输了'; t.className = win ? 'win' : 'lose';
      const sets = (m.sets || []).map((s) => `${s[0]}-${s[1]}`).join('  ');
      $('end-score').textContent = sets || `${m.games?.[0] ?? 0}-${m.games?.[1] ?? 0}`;
      const num = (a, i) => (a && a[i] != null ? a[i] : 0);
      const row = (label, a, fmt = (x) => x, better = 'high') => {
        const x = num(a, 0), y = num(a, 1);
        const cx = x !== y && ((better === 'high') === (x > y)) ? 'win' : '', cy = x !== y && ((better === 'high') === (y > x)) ? 'win' : '';
        return `<tr><td class="${cx}">${fmt(x)}</td><td>${label}</td><td class="${cy}">${fmt(y)}</td></tr>`;
      };
      $('end-stats').innerHTML = `<tr><th>你</th><th></th><th>对手</th></tr>` +
        row('ACE 发球直接得分', st.aces) + row('双误', st.doubleFaults, (x) => x, 'low') + row('制胜分', st.winners) +
        row('非受迫性失误', st.unforcedErrors, (x) => x, 'low') + row('一发成功率', st.firstServePct, (v) => `${Math.round(v)}%`) +
        row('最高发球速度', st.maxServeKmh, (v) => `${Math.round(v)} km/h`);
      $('end').classList.remove('hidden');
    },
    hideEnd() { $('end').classList.add('hidden'); },
  };
}
