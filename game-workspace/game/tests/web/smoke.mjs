import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Web 冒烟（development 入口第⑤步）：真实启动 build/web 构建产物，
 * 用鼠标事件走完 开始→跳跃→连击→坠落→重开→暂停→开关→回首页。
 * 断言失败或页面 JS 异常都会导致非零退出。
 */
const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workspace = path.resolve(gameDir, '..');
const logsDir = path.join(workspace, 'deliverables', 'logs');
const buildDir = process.argv[2] ? path.resolve(gameDir, process.argv[2]) : path.join(gameDir, 'build', 'web-mobile');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.map': 'application/json'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(buildDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(buildDir, 'index.html');
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
let failed = false;
function assertStep(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail === undefined ? null : detail });
  if (!cond) failed = true;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
}

async function main() {
  if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
    console.error(`构建产物缺失：${buildDir}`);
    process.exit(1);
  }
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  console.log(`serving ${buildDir} at ${base}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });

  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!(globalThis).__jieqi, null, { timeout: 60000 });
  const hookInfo = await page.evaluate(() => ({ env: (globalThis).__jieqi.env, version: (globalThis).__jieqi.version }));
  assertStep('boot-engine', hookInfo.env === 'web', hookInfo);

  const state = () => page.evaluate(() => (globalThis).__jieqi.session.state);
  const snap = () => page.evaluate(() => {
    const s = (globalThis).__jieqi.session;
    return { state: s.state, score: s.score, combo: s.combo, games: s.games, best: s.best, tutorialDone: s.tutorialDone, sound: s.sound, platforms: s.platforms.length, idx: s.currentIndex };
  });
  const clickBtn = async name => {
    const pos = await page.evaluate(n => (globalThis).__jieqi.buttonPagePos(n), name);
    if (!pos) return false;
    await page.mouse.click(pos.x + pos.w / 2, pos.y + pos.h / 2);
    await page.waitForTimeout(120);
    return true;
  };
  const press = async ms => {
    await page.mouse.move(195, 480);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    await page.waitForTimeout(1100); // 等待 0.55s 跳跃动画与结算
    return snap();
  };
  // 蓄力参数一律从运行时配置读取（H2 返工 v2：maxDurationSec=2.0，勿再硬编码 900ms）
  const chargeCfg = () => page.evaluate(() => {
    const c = (globalThis).__jieqi.session.config.charge;
    return { min: c.minDistancePx, max: c.maxDistancePx, durMs: c.maxDurationSec * 1000 };
  });
  const perfectPressMs = async () => {
    const [t, c] = await Promise.all([
      page.evaluate(() => (globalThis).__jieqi.targetInfo()),
      chargeCfg()
    ]);
    return Math.max(40, Math.min(c.durMs - 40, Math.round(((t.centerDist - c.min) / (c.max - c.min)) * c.durMs)));
  };

  // ① 首页
  assertStep('home-state', (await state()) === 'home');
  assertStep('home-start-button-visible', !!(await page.evaluate(() => (globalThis).__jieqi.buttonPagePos('home.start'))));

  // ② 开始游戏 → playing + 教程第一步
  assertStep('start-game', await clickBtn('home.start'));
  assertStep('playing-after-start', (await state()) === 'playing');
  assertStep('tutorial-step1', (await snap()).tutorialDone === false);

  // ③ 第一跳（瞄准台面中心）→ perfect/safe，教程自动完成
  await press(await perfectPressMs());
  const afterJump1 = await snap();
  const outcome1 = await page.evaluate(() => (globalThis).__jieqi.outcome());
  assertStep('jump1-lands', outcome1 && ['perfect', 'safe'].includes(outcome1.verdict), outcome1);
  assertStep('jump1-score-increases', afterJump1.score >= 1, afterJump1);
  assertStep('tutorial-auto-done', afterJump1.tutorialDone === true, afterJump1);
  assertStep('charge-duration-v2', (await chargeCfg()).durMs === 2000, await chargeCfg());

  // ④ 连续三跳建立连击
  for (let i = 0; i < 3; i++) {
    await press(await perfectPressMs());
  }
  const afterCombo = await snap();
  assertStep('combo-jumps-land', afterCombo.state === 'playing' && afterCombo.score > afterJump1.score, afterCombo);
  assertStep('platforms-advance', afterCombo.idx >= 4, afterCombo);

  // ⑤ 故意欠距 → 坠落 → gameover
  {
    const [t, c] = await Promise.all([
      page.evaluate(() => (globalThis).__jieqi.targetInfo()),
      chargeCfg()
    ]);
    const shortMs = Math.max(15, Math.round((((t.centerDist - t.halfWidth - 60) - c.min) / (c.max - c.min)) * c.durMs));
    await press(shortMs);
  }
  const afterFall = await snap();
  assertStep('fall-gameover', afterFall.state === 'gameover', afterFall);
  assertStep('games-counted', afterFall.games === 1, afterFall);
  assertStep('best-recorded', afterFall.best >= afterCombo.score, afterFall);
  assertStep('restart-button-visible', !!(await page.evaluate(() => (globalThis).__jieqi.buttonPagePos('over.restart'))));

  // ⑥ 一键重开（失败→新局 1 次点击，AC-4）
  assertStep('restart', await clickBtn('over.restart'));
  const afterRestart = await snap();
  assertStep('restart-playing', afterRestart.state === 'playing' && afterRestart.score === 0 && afterRestart.idx === 0, afterRestart);

  // ⑥b H2 回归：开局第一跳直接按住 1 秒（旧版 0.9s 封顶下的必死本能节奏）→ 必须生还
  const afterInstinct = await press(1000);
  assertStep('novice-instinct-hold-survives', afterInstinct.state === 'playing' && afterInstinct.score >= 1, afterInstinct);

  // ⑦ 暂停/继续（再暂停以便在面板内测试开关与回首页）
  assertStep('pause', await clickBtn('pause') && (await state()) === 'paused');
  assertStep('resume', await clickBtn('pause.resume') && (await state()) === 'playing');
  assertStep('pause-again', await clickBtn('pause') && (await state()) === 'paused');

  // ⑧ 音效开关即时生效并写档（面板打开时点击）
  assertStep('toggle-sound', await clickBtn('pause.sound'));
  assertStep('sound-off', (await snap()).sound === false);
  const saveRaw = await page.evaluate(() => localStorage.getItem('save_v1'));
  assertStep('save-persisted', !!saveRaw && JSON.parse(saveRaw).sound === false && JSON.parse(saveRaw).tutorialDone === true, saveRaw);

  // ⑨ 回首页（暂停面板仍开着）
  assertStep('to-home', await clickBtn('pause.home') && (await state()) === 'home');

  assertStep('no-page-errors', pageErrors.length === 0, pageErrors.slice(0, 5));

  await browser.close();
  server.close();

  const report = {
    entry: 'web-smoke',
    buildDir: path.relative(workspace, buildDir).replaceAll('\\', '/'),
    url: base,
    viewport: '390x844',
    finishedAt: new Date().toISOString(),
    passed: results.filter(r => r.pass).length,
    failed: results.filter(r => !r.pass).length,
    results
  };
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, 'web-smoke.json'), JSON.stringify(report, null, 2));
  console.log(`\nsmoke: ${report.passed} passed / ${report.failed} failed → deliverables/logs/web-smoke.json`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('smoke 异常：', e);
  process.exit(1);
});
