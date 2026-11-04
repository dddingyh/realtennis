// End-to-end test (Playwright, headless chromium): game-side host page + phone controller page (?local=1&sim=1)
// in one browser context, linked by the BroadcastChannel transport. Usage: node tests/e2e.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(os.tmpdir(), 'realtennis-e2e');
mkdirSync(out, { recursive: true });
const PORT = Number(process.env.PORT || 8180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// reuse a server already serving the repo on PORT, otherwise start one
let srv = null;
try { const r = await fetch(`http://127.0.0.1:${PORT}/controller.html`); if (!r.ok) throw new Error(); console.log(`(reusing server on :${PORT})`); }
catch (e) { srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' }); }
let failures = 0;
const check = (n, ok, info = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${info}`); };
async function pollHost(host, fn, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await host.evaluate(fn)) return true; await sleep(50); }
  return false;
}
let browser;
try {
  await sleep(700);
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const errors = [];
  const host = await ctx.newPage();
  host.on('pageerror', (e) => errors.push('host: ' + e)); host.on('console', (m) => { if (m.type() === 'error') errors.push('host console: ' + m.text()); });
  await host.goto(`http://127.0.0.1:${PORT}/tests/e2e_host.html`);
  await host.waitForFunction(() => window.__host && window.__host.roomCode);
  const room = await host.evaluate(() => window.__host.roomCode);
  const url = await host.evaluate(() => window.__host.controllerUrl);
  check('host controllerUrl', url === `http://127.0.0.1:${PORT}/controller.html?room=${room}&local=1`, url);
  await host.waitForTimeout(500);
  const qrOk = await host.evaluate(() => { const c = document.getElementById('qr'); return c.width > 50 && c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] === 255; });
  check('QR drawn on canvas', qrOk);

  const ph = await ctx.newPage();
  ph.on('pageerror', (e) => errors.push('phone: ' + e)); ph.on('console', (m) => { if (m.type() === 'error') errors.push('phone console: ' + m.text()); });
  await ph.goto(`http://127.0.0.1:${PORT}/controller.html?room=${room}&local=1&sim=1`);
  await ph.screenshot({ path: `${out}/1-intro.png` });
  await ph.click('#btn-start');
  await ph.waitForSelector('#s-hand:not([hidden])');
  await ph.screenshot({ path: `${out}/2-hand.png` });
  await ph.click('#s-hand [data-hand="R"]');
  await ph.waitForSelector('#s-neutral:not([hidden])');
  await ph.screenshot({ path: `${out}/3-neutral.png` });
  await ph.click('#btn-neutral');
  await ph.waitForTimeout(1200);
  await ph.screenshot({ path: `${out}/3b-neutral-progress.png` });
  await ph.waitForSelector('#s-swing:not([hidden])', { timeout: 8000 });
  check('neutral calibration finished (wizard shown)', true);

  // swing calibration wizard through the simulator: 3 swings per type
  const order = ['flat', 'topspin', 'slice', 'lob'];
  for (const [ti, shot] of order.entries()) {
    for (let i = 0; i < 3; i++) {
      await ph.evaluate(({ shot, i }) => window.__ctl.swing({ shot, side: i % 2 ? 'bh' : 'fh' }), { shot, i });
      await ph.waitForFunction(() => !window.__ctl.phoneSim.busy, null, { timeout: 8000 });
      await ph.waitForTimeout(700);
    }
    if (ti === 1) await ph.screenshot({ path: `${out}/4-swingcal.png` });
  }
  await ph.waitForSelector('#btn-cal-done:not([hidden])', { timeout: 5000 });
  const cnt = await ph.evaluate(() => window.__ctl.rec.calibratedCount);
  check('swing calibration collected 3 per type', Object.values(cnt).every((n) => n === 3), JSON.stringify(cnt));
  await ph.click('#btn-cal-done');
  await ph.waitForSelector('#s-play:not([hidden])');
  await ph.waitForTimeout(1500);
  check('host sees phone connected + hello', await host.evaluate(() => window.__host.state === 'connected' && window.__msgs.some((m) => m.t === 'hello' && m.hand === 'R')));
  const connTxt = await ph.textContent('#conn-text');
  check('phone shows 已连接', connTxt.includes('已连接'), connTxt);
  const rtt = await ph.textContent('#rtt');
  console.log('      phone rtt label:', rtt);

  // play: tilt + swings
  await host.evaluate(() => { window.__msgs.length = 0; window.__simCalls.length = 0; });
  const box = await ph.locator('#sim-pad').boundingBox();
  await ph.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ph.mouse.down();
  await ph.mouse.move(box.x + box.width / 2, box.y + box.height * 0.05, { steps: 6 });   // top of pad = head down = forward
  await ph.waitForTimeout(1500);
  await ph.screenshot({ path: `${out}/5-play-tilt.png` });
  const tilt = await host.evaluate(() => { const t = window.__msgs.filter((m) => m.t === 'tilt'); return t[t.length - 1]; });
  check('tilt messages arrive, forward tilt -> z < 0', tilt && tilt.z < -0.5 && tilt.ageMs !== undefined, JSON.stringify(tilt));
  await ph.mouse.up();
  await ph.waitForTimeout(1200);

  const results = [];
  for (const shot of order) for (const side of ['fh', 'bh']) {
    await host.evaluate(() => { window.__msgs.length = 0; });
    await ph.keyboard.press(String(order.indexOf(shot) + 1));
    await ph.keyboard.press(side === 'fh' ? 'f' : 'b');
    await ph.keyboard.press(' ');
    await pollHost(host, () => window.__msgs.some((m) => m.t === 'swing'));
    const sw = await host.evaluate(() => window.__msgs.find((m) => m.t === 'swing'));
    results.push({ shot, side, sw });
    if (shot === 'topspin' && side === 'fh') { await ph.waitForTimeout(150); await ph.screenshot({ path: `${out}/6-play-swing.png` }); }
    await ph.waitForFunction(() => !window.__ctl.phoneSim.busy, null, { timeout: 8000 });
    await ph.waitForTimeout(500);
  }
  const good = results.filter((r) => r.sw && r.sw.shot === r.shot && r.sw.side === r.side);
  console.log('      swing results:', results.map((r) => `${r.shot}/${r.side}->${r.sw ? r.sw.shot + '/' + r.sw.side + ' p' + r.sw.power + ' age' + Math.round(r.sw.ageMs) : 'none'}`).join('  '));
  check('all 8 swings arrived at host', results.every((r) => r.sw));
  check('swing shot+side correct (>=7/8, user-calibrated)', good.length >= 7, `${good.length}/8`);
  const swm = results[1].sw;
  check('swing message fields', swm && typeof swm.power === 'number' && typeof swm.conf === 'number' && typeof swm.ts === 'number' && swm.feat && typeof swm.ageMs === 'number' && swm.ageMs >= 0 && swm.ageMs < 400, JSON.stringify(swm));
  const simSw = await host.evaluate(() => window.__simCalls.filter((c) => c[0] === 'swing').length);
  check('RemoteInput forwarded swings to sim.swing', simSw >= 8, `(${simSw})`);

  // ---- analog swing fields (DESIGN.md 6.2) ----
  const AN = ['aimX', 'lift', 'spin', 'exec', 'speedDps'];
  check('analog fields arrive at host on every swing', results.every((r) => r.sw && AN.every((k) => typeof r.sw[k] === 'number')),
    JSON.stringify(results.map((r) => r.sw && AN.map((k) => r.sw[k]))));
  const meanSpin = (shot) => { const a = results.filter((r) => r.shot === shot && r.sw).map((r) => r.sw.spin); return a.reduce((x, y) => x + y, 0) / a.length; };
  const sp = { topspin: meanSpin('topspin'), flat: meanSpin('flat'), slice: meanSpin('slice') };
  check('spin ordering topspin > flat > slice', sp.topspin > sp.flat && sp.flat > sp.slice, JSON.stringify(sp));
  const lobLift = results.filter((r) => r.shot === 'lob').map((r) => r.sw.lift), flatLift = results.filter((r) => r.shot === 'flat').map((r) => r.sw.lift);
  check('lift: lob > flat', Math.min(...lobLift) > Math.max(...flatLift), JSON.stringify({ lobLift, flatLift }));
  const calls = await host.evaluate(() => window.__simCalls.filter((c) => c[0] === 'swing').map((c) => c[2]));
  check('sim.swing receives aimX/spin/lift/exec (RemoteInput, DESIGN 6.2)', calls.length >= 8 && calls.every((o) => ['aimX', 'spin', 'lift', 'exec'].every((k) => typeof o[k] === 'number') && o.aimDepth === null && o.source === 'remote'),
    JSON.stringify(calls[0]));

  async function simSwing(o) {
    await host.evaluate(() => { window.__msgs.length = 0; });
    await ph.evaluate((o) => window.__ctl.swing(o), o);
    await pollHost(host, () => window.__msgs.some((m) => m.t === 'swing'));
    const sw = await host.evaluate(() => window.__msgs.find((m) => m.t === 'swing'));
    await ph.waitForFunction(() => !window.__ctl.phoneSim.busy, null, { timeout: 8000 });
    await ph.waitForTimeout(400);
    return sw;
  }
  const early = await simSwing({ shot: 'flat', side: 'fh', contactYaw: 20 });
  const late = await simSwing({ shot: 'flat', side: 'fh', contactYaw: -20 });
  const earlyBh = await simSwing({ shot: 'flat', side: 'bh', contactYaw: 20 });
  check('direction: right-hander forehand early -> left/cross (aimX<0), late -> right; backhand early -> right',
    early && late && earlyBh && early.aimX < -0.3 && late.aimX > 0.3 && earlyBh.aimX > 0.3, JSON.stringify([early && early.aimX, late && late.aimX, earlyBh && earlyBh.aimX]));
  const clean = await simSwing({ shot: 'topspin', side: 'fh', contactYaw: 0 });
  const jerky = await simSwing({ shot: 'topspin', side: 'fh', contactYaw: 0, jerk: 1 });
  await ph.waitForTimeout(100);
  await ph.screenshot({ path: `${out}/6b-play-jerky.png` });
  const trunc = await simSwing({ shot: 'topspin', side: 'fh', contactYaw: 0, truncate: 1 });
  check('execution: clean > jerky, clean > truncated follow-through', clean && jerky && trunc && clean.exec >= 0.85 && jerky.exec < clean.exec - 0.2 && trunc.exec < clean.exec - 0.2,
    JSON.stringify([clean && clean.exec, jerky && jerky.exec, trunc && trunc.exec]));
  const grade = await ph.textContent('#last-grade'), hint = await ph.textContent('#ex-hint'), dir = await ph.textContent('#dir-label');
  check('phone shows grade + hint + direction for the last swing', grade.length > 0 && hint.includes('提示') && dir.length > 0, `${grade} | ${hint} | ${dir}`);
  const strong = await simSwing({ shot: 'flat', side: 'fh', contactYaw: 0, speed: 1.35 });
  const soft = await simSwing({ shot: 'flat', side: 'fh', contactYaw: 0, speed: 0.65 });
  check('power: fast swing > slow swing', strong && soft && strong.power > soft.power + 0.2 && strong.speedDps > soft.speedDps, JSON.stringify([strong && [strong.power, strong.speedDps], soft && [soft.power, soft.speedDps]]));

  // touch buttons: override + serve + pause
  await host.evaluate(() => { window.__msgs.length = 0; window.__simCalls.length = 0; });
  await ph.dispatchEvent('.pad[data-shot="lob"]', 'pointerdown', { pointerId: 5, bubbles: true });
  await ph.keyboard.press('1'); await ph.keyboard.press(' ');
  await pollHost(host, () => window.__msgs.some((m) => m.t === 'swing'));
  const ov = await host.evaluate(() => ({ sw: window.__msgs.find((m) => m.t === 'swing'), call: window.__simCalls.find((c) => c[0] === 'swing') }));
  check('hold-to-override forces swing type to lob', ov.sw.shot === 'lob' && ov.call[2].shot === 'lob', JSON.stringify(ov.sw.shot));
  await ph.dispatchEvent('.pad[data-shot="lob"]', 'pointerup', { pointerId: 5, bubbles: true });
  await ph.click('#btn-serve'); await ph.click('#btn-pause'); await ph.click('#btn-pause');
  await ph.waitForTimeout(400);
  const btns = await host.evaluate(() => window.__msgs.filter((m) => m.t === 'btn').map((m) => m.id + ':' + m.value));
  check('serve/pause/resume buttons delivered', btns.includes('serve:undefined') && btns.includes('pause:undefined') && btns.includes('resume:undefined'), JSON.stringify(btns));

  // host -> phone: state + haptic path
  await host.evaluate(() => window.__remote.notify([{ type: 'point', winner: 0, reason: 'winner' }], { match: { phase: 'serve-prep', pointText: '30-15', server: 1 } }));
  await ph.waitForTimeout(300);
  const banner = await ph.textContent('#match-banner');
  check('phone shows match state from host', banner.includes('30-15') && banner.includes('对手发球'), banner);
  await ph.click('#btn-settings');
  await ph.waitForTimeout(400);
  await ph.screenshot({ path: `${out}/7-settings.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(failures ? `\n${failures} FAILED` : '\nE2E ALL PASSED');
} catch (e) {
  console.error('E2E exception', e); failures++;
} finally {
  if (browser) await browser.close();
  if (srv) srv.kill();
}
process.exit(failures ? 1 : 0);
