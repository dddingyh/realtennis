// End-to-end test of the arcade phone controller (Playwright, headless chromium).
//   host page (tests/arcade_ctl_host.html: createRemoteHost + RemoteAdapter + mock sim, or ?real=1 -> real ArcadeSim)
//   <-- BroadcastChannel (?local=1) -->  phone page cartoon/controller.html?room=..&local=1&sim=1 (synthetic IMU through the real recogniser)
// Usage: node tests/arcade_ctl_e2e.mjs [outDir]      env: PORT (default 8230), REAL=1 to host the real ArcadeSim
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || '/tmp/claude-0/-home-user-realtennis/1ed3b93b-9ab4-51cf-b0b0-f10d7faeaf73/scratchpad/actl';
mkdirSync(out, { recursive: true });
const PORT = Number(process.env.PORT || 8230);
const REAL = process.env.REAL === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let srv = null;
try { const r = await fetch(`http://127.0.0.1:${PORT}/cartoon/controller.html`); if (!r.ok) throw new Error(); console.log(`(reusing server on :${PORT})`); }
catch (e) { srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' }); await sleep(800); }
let failures = 0;
const check = (n, ok, info = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`); };
const base = `http://127.0.0.1:${PORT}`;
const pollHost = async (host, fn, arg, timeout = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await host.evaluate(fn, arg)) return true; await sleep(40); } return false; };
const pollPage = async (page, fn, arg, timeout = 5000) => { try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch (e) { return false; } };

let browser;
try {
  browser = await chromium.launch();
  const errors = [];
  const watch = (page, tag) => { page.on('pageerror', (e) => errors.push(`${tag}: ${e}`)); page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); }); };

  // =========================================================== pass 1: 390x844, full functional flow
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const host = await ctx.newPage(); watch(host, 'host');
  await host.goto(`${base}/tests/arcade_ctl_host.html${REAL ? '?real=1' : ''}`);
  await host.waitForFunction(() => window.__host && window.__host.roomCode);
  const room = await host.evaluate(() => window.__host.roomCode);
  const url = await host.evaluate(() => window.__host.controllerUrl);
  check('host controllerUrl points to cartoon/controller.html', url === `${base}/cartoon/controller.html?room=${room}&local=1`, url);

  const ph = await ctx.newPage(); watch(ph, 'phone');
  await ph.goto(`${base}/cartoon/controller.html?room=${room}&local=1&sim=1`);
  // networking starts as soon as the page opens, status visible on the intro screen
  check('intro: connected before pressing 开始 (status bar visible)', await pollPage(ph, () => document.getElementById('conn-text').textContent.includes('已连接')), await ph.textContent('#conn-text'));
  check('intro: latency shown in status bar', /延迟 \d+ ms/.test(await ph.textContent('#rtt')) || await pollPage(ph, () => /延迟 \d+ ms/.test(document.getElementById('rtt').textContent), null, 4000), await ph.textContent('#rtt'));
  await ph.screenshot({ path: `${out}/01-intro.png` });
  check('intro: 开始 button visible', await ph.isVisible('#btn-start'));
  await ph.click('#btn-start');
  await ph.waitForSelector('#s-hand:not([hidden])');
  check('hand screen after 开始 (no calibration screens)', true);
  await ph.screenshot({ path: `${out}/02-hand.png` });
  await ph.click('#s-hand [data-hand="L"]');   // left first, then switch back to right below
  await ph.waitForSelector('#s-warm:not([hidden])');
  check('host got hello with hand L', await pollHost(host, () => window.__msgs.some((m) => m.t === 'hello' && m.hand === 'L')));
  // optional warm-up: two synthetic swings
  for (const shot of ['topspin', 'lob']) { await ph.evaluate((shot) => window.__ctl.swing({ shot }), shot); await pollPage(ph, () => !window.__ctl.phoneSim.busy, null, 8000); await ph.waitForTimeout(600); }
  check('warm-up shows both detected swings', (await ph.$$eval('#warm-dots b.on', (b) => b.length)) === 2);
  await ph.screenshot({ path: `${out}/03-warmup.png` });
  await ph.click('#btn-warm-go');
  await ph.waitForSelector('#s-play:not([hidden])');
  // switch to right hand via settings (also exercises the settings sheet)
  await ph.click('#btn-settings'); await ph.waitForTimeout(150);
  await ph.screenshot({ path: `${out}/04-settings.png` });
  await ph.click('#set-hand [data-v="R"]'); await ph.click('#btn-sheet-close');
  check('host got hello with hand R after switching', await pollHost(host, () => window.__msgs.filter((m) => m.t === 'hello').pop().hand === 'R'));
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: `${out}/05-play-idle.png` });

  // ---- swings of each shape through the real recogniser -> host
  const waitIdle = async () => { await pollPage(ph, () => !window.__ctl.phoneSim.busy, null, 8000); await ph.waitForTimeout(550); };
  const results = [];
  for (const shot of ['topspin', 'flat', 'slice', 'lob', 'topspin', 'flat', 'slice', 'lob']) {
    await host.evaluate(() => { window.__msgs.length = 0; window.__simCalls.length = 0; });
    await ph.evaluate((shot) => window.__ctl.swing({ shot, sloppy: 0 }), shot);
    const got = await pollHost(host, () => window.__msgs.some((m) => m.t === 'swing'));
    const sw = got ? await host.evaluate(() => window.__msgs.find((m) => m.t === 'swing')) : null;
    const call = got ? await host.evaluate(() => window.__simCalls.find((c) => c[0] === 'swing')) : null;
    results.push({ shot, sw, call });
    await waitIdle();
  }
  const ok = results.filter((r) => r.sw && r.sw.shot === r.shot);
  console.log('      swings:', results.map((r) => `${r.shot}->${r.sw ? r.sw.shot + ' p' + r.sw.power + ' age' + Math.round(r.sw.ageMs) : 'none'}`).join('  '));
  check('all 8 synthetic swings arrived at the host', results.every((r) => r.sw));
  check('shape correct for >= 7/8 swings', ok.length >= 7, `${ok.length}/8`);
  const ages = results.filter((r) => r.sw).map((r) => r.sw.ageMs).sort((a, b) => a - b);
  console.log(`      ageMs seen by host: min ${ages[0]?.toFixed(0)} median ${ages[ages.length >> 1]?.toFixed(0)} max ${ages[ages.length - 1]?.toFixed(0)}`);
  check('ageMs sane (0 < age < 200, median 30..120)', ages.length && ages[0] > 0 && ages[ages.length - 1] < 200 && ages[ages.length >> 1] >= 30 && ages[ages.length >> 1] <= 120);
  const sw0 = results[0].sw;
  check('swing message fields (shot, side, power, conf, ts, speedDps, lift, spin)', sw0 && ['power', 'conf', 'ts', 'speedDps', 'lift', 'spin'].every((k) => typeof sw0[k] === 'number') && ['fh', 'bh'].includes(sw0.side), JSON.stringify(sw0));
  check('RemoteAdapter forwarded sim.swing(0,{shot,power,ageMs,source:"remote"})', results.every((r) => r.call && r.call[1] === 0 && r.call[2].source === 'remote' && typeof r.call[2].ageMs === 'number' && r.call[2].shot === r.sw.shot));
  const pw = Object.fromEntries(['topspin', 'flat', 'slice', 'lob'].map((s) => [s, results.filter((r) => r.shot === s && r.sw).map((r) => r.sw.power)]));
  check('powers in (0,1]', Object.values(pw).flat().every((p) => p > 0 && p <= 1), JSON.stringify(pw));
  // lighter swing -> lower power
  await host.evaluate(() => { window.__msgs.length = 0; });
  await ph.evaluate(() => window.__ctl.swing({ shot: 'topspin', speed: 0.7 })); await pollHost(host, () => window.__msgs.some((m) => m.t === 'swing')); await waitIdle();
  await ph.evaluate(() => window.__ctl.swing({ shot: 'topspin', speed: 1.4 })); await pollHost(host, () => window.__msgs.filter((m) => m.t === 'swing').length >= 2); await waitIdle();
  const pp = await host.evaluate(() => window.__msgs.filter((m) => m.t === 'swing').map((m) => m.power));
  check('soft swing sends lower power than hard swing', pp.length === 2 && pp[0] + 0.15 < pp[1], JSON.stringify(pp));

  // ---- feedback from the host (fb) shown on the phone
  const emit = (e) => host.evaluate((e) => window.__sim.emit({ type: 'hit', by: 0, ...e }), e);
  await ph.evaluate(() => { document.getElementById('fbcard').className = 'fbcard idle'; });
  await emit({ shot: 'topspin', side: 'fh', timing: 'early', timingMs: -62, dir: -0.44, quality: 0.8, power: 0.7 });
  check('fb early: phone shows 早 + ms + shot + left arrow + stars',
    await pollPage(ph, () => document.getElementById('fb-main').textContent === '早' && document.getElementById('fb-ms').textContent.includes('62')), await ph.textContent('#fb-main') + ' ' + await ph.textContent('#fb-ms'));
  const f1 = await ph.evaluate(() => ({ shot: document.getElementById('fb-shot').textContent, stars: document.querySelectorAll('#fb-stars b').length, aria: document.getElementById('fb-arrow').getAttribute('aria-label'), cls: document.getElementById('fbcard').className, ms: document.getElementById('fb-ms').textContent }));
  check('fb early details', f1.shot === '上旋' && f1.stars === 4 && f1.aria.includes('左') && f1.cls.includes('t-early') && f1.ms.includes('左'), JSON.stringify(f1));
  await ph.screenshot({ path: `${out}/06-fb-early.png` });
  await emit({ shot: 'flat', side: 'fh', timing: 'perfect', timingMs: -3, dir: 0, quality: 0.95 });
  check('fb perfect: 准！', await pollPage(ph, () => document.getElementById('fb-main').textContent === '准！'));
  await ph.screenshot({ path: `${out}/07-fb-perfect.png` });
  await emit({ shot: 'slice', side: 'fh', timing: 'late', timingMs: 71, dir: 0.5, quality: 0.5 });
  check('fb late: 晚 + right arrow', await pollPage(ph, () => document.getElementById('fb-main').textContent === '晚' && document.getElementById('fb-arrow').getAttribute('aria-label').includes('右')));
  await ph.screenshot({ path: `${out}/08-fb-late.png` });
  await emit({ shot: 'lob', side: 'fh', timing: 'wide', timingMs: -190, dir: -1, quality: 0.2, mishit: 'frame' });
  check('fb wide: 太早', await pollPage(ph, () => document.getElementById('fb-main').textContent === '太早'));
  await host.evaluate(() => window.__sim.emit({ type: 'whiff', by: 0 }));
  check('fb whiff: 挥空', await pollPage(ph, () => document.getElementById('fb-main').textContent === '挥空'));
  await ph.screenshot({ path: `${out}/09-fb-whiff.png` });
  // opponent's hits produce no feedback on this phone
  const before = await ph.textContent('#fb-main');
  await host.evaluate(() => window.__sim.emit({ type: 'hit', by: 1, shot: 'flat', timing: 'perfect', timingMs: 0, quality: 1 }));
  await ph.waitForTimeout(250);
  check('opponent hit does not change the phone feedback', (await ph.textContent('#fb-main')) === before);

  // ---- net button
  await host.evaluate(() => { window.__simCalls.length = 0; window.__msgs.length = 0; });
  check('net button label starts as 上网', (await ph.textContent('#net-title')) === '上网');
  await ph.tap('#btn-net');
  check('net tap -> host btn net toggle -> sim.toggleNet', await pollHost(host, () => window.__msgs.some((m) => m.t === 'btn' && m.id === 'net' && m.value === 'toggle') && window.__simCalls.some((c) => c[0] === 'toggleNet' && c[1] === 0)));
  check('net button shows 上网中… while moving (host zone toNet)', await pollPage(ph, () => document.getElementById('btn-net').dataset.zone === 'toNet'));
  await ph.screenshot({ path: `${out}/10-net-moving.png` });
  check('net button becomes 回底线 when host reports zone net', await pollPage(ph, () => document.getElementById('net-title').textContent === '回底线' && document.getElementById('btn-net').dataset.zone === 'net', null, 4000));
  await ph.screenshot({ path: `${out}/11-net.png` });
  const ageNet = await host.evaluate(() => window.__msgs.find((m) => m.t === 'btn' && m.id === 'net').ageMs);
  check('btn net carries ageMs', typeof ageNet === 'number' && ageNet >= 0 && ageNet < 400, String(ageNet));
  await ph.tap('#btn-net');
  check('second tap -> back to 上网', await pollPage(ph, () => document.getElementById('net-title').textContent === '上网' && document.getElementById('btn-net').dataset.zone === 'base', null, 4000));
  // keyboard shortcut in the simulator panel
  await host.evaluate(() => { window.__simCalls.length = 0; });
  await ph.keyboard.press('n');
  check('simulator key N toggles net', await pollHost(host, () => window.__simCalls.some((c) => c[0] === 'toggleNet')));
  await ph.waitForTimeout(900); await ph.tap('#btn-net'); await ph.waitForTimeout(900);   // keep zone consistent with the mock (back to base)
  await pollPage(ph, () => document.getElementById('btn-net').dataset.zone === 'base', null, 3000);

  // ---- serve prompt + score
  await host.evaluate(() => { const s = window.__sim.state; s.match = { phase: 'serve-prep', pointText: '30-15', server: 0 }; s.hint = { i: 0, tossUp: false, canServe: false }; });
  check('serve prompt: 准备发球… during serve-prep', await pollPage(ph, () => document.getElementById('serve-prompt').textContent.includes('准备发球')));
  await host.evaluate(() => { const s = window.__sim.state; s.match = { phase: 'serving', pointText: '30-15', server: 0 }; s.hint = { i: 0, tossUp: false, canServe: true }; });
  check('serve prompt: 挥拍抛球 when you serve and tossUp=false', await pollPage(ph, () => !document.getElementById('serve-prompt').hidden && document.getElementById('serve-prompt').textContent.includes('挥拍抛球')));
  check('score line: 你发球 + 30-15', (await ph.textContent('#srv')) === '你发球' && (await ph.textContent('#pt')) === '30-15');
  await ph.screenshot({ path: `${out}/12-serve-toss.png` });
  await host.evaluate(() => { window.__sim.state.hint = { i: 0, tossUp: true, canServe: true }; });
  check('serve prompt: 再挥拍 when tossUp=true', await pollPage(ph, () => document.getElementById('serve-prompt').textContent.includes('再挥拍')));
  await ph.screenshot({ path: `${out}/13-serve-hit.png` });
  await host.evaluate(() => { const s = window.__sim.state; s.match = { phase: 'rally', pointText: '40-15', server: 1 }; s.hint = { i: 0, tossUp: false, canServe: false }; });
  check('serve prompt hidden in rally; 对手发球', await pollPage(ph, () => document.getElementById('serve-prompt').hidden && document.getElementById('srv').textContent === '对手发球'));

  // ---- hold-to-force chip
  await host.evaluate(() => { window.__msgs.length = 0; window.__simCalls.length = 0; });
  await ph.dispatchEvent('.chip.hold[data-shot="lob"]', 'pointerdown', { pointerId: 7, bubbles: true });
  await ph.evaluate(() => window.__ctl.swing({ shot: 'flat' }));
  await pollHost(host, () => window.__msgs.some((m) => m.t === 'swing'));
  const ov = await host.evaluate(() => ({ sw: window.__msgs.find((m) => m.t === 'swing'), call: window.__simCalls.find((c) => c[0] === 'swing') }));
  check('hold chip 挑高 + flat swing -> forced lob', ov.sw && ov.sw.shot === 'lob' && ov.call && ov.call[2].shot === 'lob', JSON.stringify(ov.sw && ov.sw.shot));
  await ph.dispatchEvent('.chip.hold[data-shot="lob"]', 'pointerup', { pointerId: 7, bubbles: true });
  await waitIdle(); await ph.waitForTimeout(500);

  // ---- toggles + pause
  await ph.click('#tog-snd'); check('sound toggle', (await ph.getAttribute('#tog-snd', 'aria-pressed')) === 'false'); await ph.click('#tog-snd');
  await host.evaluate(() => { window.__simCalls.length = 0; });
  await ph.click('#btn-pause');
  check('pause -> sim.pause(true) + overlay', await pollHost(host, () => window.__simCalls.some((c) => c[0] === 'pause' && c[1] === true)) && await ph.isVisible('#pause-overlay'));
  await ph.screenshot({ path: `${out}/14-paused.png` });
  await host.evaluate(() => { window.__msgs.length = 0; });
  await ph.evaluate(() => window.__ctl.swing({ shot: 'flat' })); await waitIdle();
  check('swings are not sent while paused', (await host.evaluate(() => window.__msgs.filter((m) => m.t === 'swing').length)) === 0);
  await ph.click('#btn-resume');
  check('resume -> sim.pause(false)', await pollHost(host, () => window.__simCalls.some((c) => c[0] === 'pause' && c[1] === false)) && !(await ph.isVisible('#pause-overlay')));

  // ---- haptic request from the host reaches the phone (vibrate stubbed in headless: just make sure the message arrives)
  await ph.evaluate(() => { window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; }; });
  await emit({ shot: 'topspin', side: 'fh', timing: 'perfect', timingMs: 0, dir: 0, quality: 0.9 });
  check('perfect hit -> double-buzz haptic pattern reaches the phone', await pollPage(ph, () => window.__vib.some((p) => Array.isArray(p) && p.length === 3)));

  // ---- settings: timing adjust shifts the sent timestamp (-> larger ageMs on the host)
  const ageWith = async (adj) => {
    await ph.evaluate((adj) => { document.getElementById('set-adj').value = adj; document.getElementById('set-adj').dispatchEvent(new Event('input')); }, adj);
    await host.evaluate(() => { window.__msgs.length = 0; });
    await ph.evaluate(() => window.__ctl.swing({ shot: 'topspin' }));
    await pollHost(host, () => window.__msgs.some((m) => m.t === 'swing')); await waitIdle();
    return host.evaluate(() => window.__msgs.find((m) => m.t === 'swing').ageMs);
  };
  const a0 = await ageWith(0), a1 = await ageWith(60);
  console.log(`      ageMs adj 0 -> ${a0.toFixed(0)}, adj +60 -> ${a1.toFixed(0)}`);
  check('timing adjust +60 ms (提前) increases ageMs by ~60', a1 - a0 > 35 && a1 - a0 < 90);
  await ph.evaluate(() => { document.getElementById('set-adj').value = 0; document.getElementById('set-adj').dispatchEvent(new Event('input')); });

  // ---- reconnect: host disappears and comes back with the same room
  await host.close();
  check('phone shows disconnected overlay when host disappears', await pollPage(ph, () => !document.getElementById('offline-overlay').hidden, null, 9000));
  await ph.screenshot({ path: `${out}/15-offline.png` });
  const host2 = await ctx.newPage(); watch(host2, 'host2');
  await host2.goto(`${base}/tests/arcade_ctl_host.html?room=${room}${REAL ? '&real=1' : ''}`);
  check('phone reconnects to the restarted host and re-sends hello', await pollPage(ph, () => document.getElementById('offline-overlay').hidden && document.getElementById('conn-text').textContent.includes('已连接'), null, 12000) && await pollHost(host2, () => window.__msgs.some((m) => m.t === 'hello' && m.hand === 'R'), null, 5000));
  await host2.evaluate(() => { window.__msgs.length = 0; });
  await ph.evaluate(() => window.__ctl.swing({ shot: 'flat' }));
  check('swing works again after reconnect', await pollHost(host2, () => window.__msgs.some((m) => m.t === 'swing')));
  await waitIdle();

  // ---- walking in front of the phone must not produce swings
  await host2.evaluate(() => { window.__msgs.length = 0; });
  await ph.evaluate(() => { document.getElementById('sim-walk').click(); });
  await ph.waitForTimeout(4000);
  const falseSw = await host2.evaluate(() => window.__msgs.filter((m) => m.t === 'swing').length);
  check('simulated walking: no false swings in 4 s', falseSw === 0, String(falseSw));
  await ph.evaluate(() => { document.getElementById('sim-walk').click(); });

  // ---- layout checks at 390x844
  const lay = await ph.evaluate(() => { const b = document.getElementById('btn-net').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, bottom: b.bottom, ih: innerHeight, h: b.height, w: b.width }; });
  check('390x844: no horizontal scroll, huge net button fully on screen', lay.sw <= lay.iw && lay.bottom <= lay.ih && lay.h >= 150 && lay.w >= 330, JSON.stringify(lay));
  await host2.close();
  await ctx.close();

  // =========================================================== pass 2: small phone 360x640, screenshots + layout
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const hostS = await ctx2.newPage(); watch(hostS, 'hostS');
  await hostS.goto(`${base}/tests/arcade_ctl_host.html`);
  await hostS.waitForFunction(() => window.__host && window.__host.roomCode);
  const roomS = await hostS.evaluate(() => window.__host.roomCode);
  const pS = await ctx2.newPage(); watch(pS, 'phoneS');
  await pS.goto(`${base}/cartoon/controller.html?room=${roomS}&local=1&sim=1`);
  await pollPage(pS, () => document.getElementById('conn-text').textContent.includes('已连接'));
  await pS.screenshot({ path: `${out}/s01-intro.png` });
  await pS.click('#btn-start'); await pS.waitForSelector('#s-hand:not([hidden])');
  await pS.screenshot({ path: `${out}/s02-hand.png` });
  await pS.click('#s-hand [data-hand="R"]'); await pS.waitForSelector('#s-warm:not([hidden])');
  await pS.screenshot({ path: `${out}/s03-warmup.png` });
  await pS.click('#btn-warm-skip'); await pS.waitForSelector('#s-play:not([hidden])');
  await pS.waitForTimeout(300);
  await pS.screenshot({ path: `${out}/s04-play-idle.png` });
  await hostS.evaluate(() => { const s = window.__sim.state; s.match = { phase: 'serving', pointText: '15-30', server: 0 }; s.hint = { i: 0, tossUp: true, canServe: true }; window.__sim.emit({ type: 'hit', by: 0, shot: 'topspin', side: 'fh', timing: 'late', timingMs: 48, dir: 0.6, quality: 0.7 }); });
  await pS.waitForTimeout(500);
  await pS.screenshot({ path: `${out}/s05-play-fb-serve.png` });
  await hostS.evaluate(() => { window.__sim.state.match = { phase: 'rally', pointText: '15-30', server: 1 }; });
  await pS.tap('#btn-net'); await pollPage(pS, () => document.getElementById('btn-net').dataset.zone === 'net', null, 4000);
  await pS.screenshot({ path: `${out}/s06-play-net.png` });
  const layS = await pS.evaluate(() => { const b = document.getElementById('btn-net').getBoundingClientRect(), f = document.getElementById('fbcard').getBoundingClientRect(), c = document.getElementById('chips').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, bottom: b.bottom, ih: innerHeight, h: b.height, fbH: f.height, chipsBottom: c.bottom, netTop: b.top }; });
  check('360x640: no horizontal scroll, net button fully on screen, feedback card still has room', layS.sw <= layS.iw && layS.bottom <= layS.ih && layS.h >= 100 && layS.fbH >= 100 && layS.chipsBottom <= layS.netTop, JSON.stringify(layS));
  await pS.click('#btn-settings'); await pS.waitForTimeout(150);
  await pS.screenshot({ path: `${out}/s07-settings.png` });
  await ctx2.close();

  // =========================================================== pass 3: the REAL ArcadeSim (if present), real field names end to end
  if (existsSync(path.join(root, 'cartoon/src/sim/arcade.js'))) {
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const h3 = await ctx3.newPage(); watch(h3, 'host3');
    await h3.goto(`${base}/tests/arcade_ctl_host.html?real=1`);
    await h3.waitForFunction(() => window.__host && window.__host.roomCode);
    const modeTxt = await h3.textContent('#mode');
    check('pass 3: host runs the real ArcadeSim', modeTxt.includes('real'), modeTxt);
    if (modeTxt.includes('real')) {
      const room3 = await h3.evaluate(() => window.__host.roomCode);
      const p3 = await ctx3.newPage(); watch(p3, 'phone3');
      await p3.goto(`${base}/cartoon/controller.html?room=${room3}&local=1&sim=1`);
      await pollPage(p3, () => document.getElementById('conn-text').textContent.includes('已连接'));
      await p3.click('#btn-start'); await p3.waitForSelector('#s-hand:not([hidden])');
      await p3.click('#s-hand [data-hand="R"]'); await p3.waitForSelector('#s-warm:not([hidden])');
      await p3.click('#btn-warm-skip'); await p3.waitForSelector('#s-play:not([hidden])');
      const st0 = await pollPage(p3, () => /发球|准备/.test(document.getElementById('srv').textContent) && document.getElementById('pt').textContent.length > 0, null, 5000);
      check('real sim: state message reaches the phone (score + server)', st0, `${await p3.textContent('#srv')} ${await p3.textContent('#pt')}`);
      check('real sim: serve prompt appears for the serving human', await pollPage(p3, () => !document.getElementById('serve-prompt').hidden, null, 15000), await p3.textContent('#serve-prompt'));
      const promptOk = await pollPage(p3, () => document.getElementById('serve-prompt').textContent.includes('挥拍抛球'), null, 15000);
      check('real sim: 挥拍抛球 when the sim is ready for the toss (hint.canServe)', promptOk, await p3.textContent('#serve-prompt'));
      await p3.screenshot({ path: `${out}/r01-real-serve-prompt.png` });
      await h3.evaluate(() => { window.__simCalls.length = 0; });
      await p3.evaluate(() => window.__ctl.swing({ shot: 'flat', sloppy: 0 }));
      check('real sim: toss swing -> sim.swing -> tossUp -> prompt 再挥拍', await pollPage(p3, () => document.getElementById('serve-prompt').textContent.includes('再挥拍'), null, 8000), await p3.textContent('#serve-prompt'));
      await p3.screenshot({ path: `${out}/r02-real-toss-up.png` });
      const c0 = await h3.evaluate(() => window.__simCalls.find((c) => c[0] === 'swing'));
      check('real sim: sim.swing received remote swing with ageMs', c0 && c0[2].source === 'remote' && c0[2].ageMs > 0, JSON.stringify(c0 && c0[2]));
      // second swing (hit): the synthetic arm needs ~1.3 s to reach contact, so this serve is usually late/early -> any fb is fine
      await pollPage(p3, () => !window.__ctl.phoneSim.busy, null, 8000);
      await p3.evaluate(() => window.__ctl.swing({ shot: 'flat', sloppy: 0 }));
      const gotFb = await pollPage(p3, () => !document.getElementById('fbcard').classList.contains('idle'), null, 9000);
      check('real sim: serve swing produces an fb on the phone', gotFb, `${await p3.textContent('#fb-main')} | ${await p3.textContent('#fb-ms')}`);
      await p3.screenshot({ path: `${out}/r03-real-serve-fb.png` });
      // rally + net button against the real zone state machine
      await h3.evaluate(() => { window.__sim.debugPlace(0, 0, 11.8, 'base'); window.__sim.debugFeed(1, { speedKmh: 50, topRpm: 1500 }); });
      await p3.waitForTimeout(400);
      await p3.tap('#btn-net');
      check('real sim: net button -> zone toNet/net reported back', await pollPage(p3, () => ['toNet', 'net'].includes(document.getElementById('btn-net').dataset.zone), null, 4000), await p3.getAttribute('#btn-net', 'data-zone'));
      const z = await h3.evaluate(() => window.__sim.state.players[0].zone);
      check('real sim: sim zone of the human changed', z === 'toNet' || z === 'net', z);
      await p3.screenshot({ path: `${out}/r04-real-net.png` });
      // a ball is coming: time a swing so that the contact lands near the ball (swing needs ~1.3-1.7 s to peak)
      await h3.evaluate(() => { window.__sim.debugPlace(0, 0, 11.8, 'base'); window.__sim.debugFeed(1, { speedKmh: 45, topRpm: 1200 }); });
      let started = false;
      for (let i = 0; i < 300 && !started; i++) {
        const ci = await h3.evaluate(() => window.__sim.state.hint.contactIn);
        if (ci !== null && ci < 1.55) { await p3.evaluate(() => window.__ctl.swing({ shot: 'topspin', sloppy: 0 })); started = true; } else await sleep(20);
      }
      const fbIn = started && await pollPage(p3, () => document.getElementById('fb-main').textContent !== '挥拍！' && !document.getElementById('fbcard').classList.contains('idle'), null, 9000);
      const fbTxt = `${await p3.textContent('#fb-main')} | ${await p3.textContent('#fb-ms')} | ${await p3.textContent('#fb-shot')}`;
      console.log('      real-sim rally swing feedback:', fbTxt);
      check('real sim: rally swing -> fb (hit or whiff) shown on the phone', !!fbIn, fbTxt);
      await p3.screenshot({ path: `${out}/r05-real-rally-fb.png` });
    }
    await ctx3.close();
  }

  check('no page errors / console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  console.log(failures ? `\n${failures} FAILED` : '\nE2E ALL PASSED');
} catch (e) {
  console.error('E2E exception', e); failures++;
} finally {
  if (browser) await browser.close();
  if (srv) srv.kill();
}
process.exit(failures ? 1 : 0);
