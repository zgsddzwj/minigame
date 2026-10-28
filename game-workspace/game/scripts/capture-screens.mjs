import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** 对最终 web 构建截图，作为 03 阶段人工审查/H2 试玩说明的视觉证据。 */
const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(gameDir, '..');
const buildDir = path.join(gameDir, 'build', 'web-mobile');
const outDir = path.join(workspace, 'deliverables', 'screenshots');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(buildDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(buildDir, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(globalThis).__jieqi, null, { timeout: 60000 });
  const shot = async name => { await page.screenshot({ path: path.join(outDir, name) }); console.log(`screenshot: ${name}`); };
  const state = () => page.evaluate(() => (globalThis).__jieqi.session.state);
  const clickBtn = async name => {
    const pos = await page.evaluate(n => (globalThis).__jieqi.buttonPagePos(n), name);
    if (!pos) return false;
    await page.mouse.click(pos.x + pos.w / 2, pos.y + pos.h / 2);
    await page.waitForTimeout(150);
    return true;
  };
  const pressMs = async ms => {
    await page.mouse.move(195, 480);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    await page.waitForTimeout(1100);
  };
  // 蓄力参数从运行时配置读取（H2 返工 v2：maxDurationSec=2.0）
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

  await shot('01-home.png');

  await clickBtn('home.start');
  await page.waitForTimeout(350);
  await shot('02-tutorial.png');

  // 蓄力中截图（0.8s ≈ 40% 蓄力条；此落点落在新手安全带内）
  await page.mouse.move(195, 480);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await shot('03-charging.png');
  await page.mouse.up();
  await page.waitForTimeout(1500);
  if ((await state()) !== 'playing') {
    await clickBtn('over.restart');
  }

  // 连续两次精准跳 → 游玩中截图
  await pressMs(await perfectPressMs());
  await pressMs(await perfectPressMs());
  await shot('04-playing.png');

  // 坠落 → 结算截图
  {
    const [t, c] = await Promise.all([
      page.evaluate(() => (globalThis).__jieqi.targetInfo()),
      chargeCfg()
    ]);
    const shortMs = Math.max(15, Math.round((((t.centerDist - t.halfWidth - 60) - c.min) / (c.max - c.min)) * c.durMs));
    await pressMs(shortMs);
  }
  await page.waitForTimeout(600);
  await shot('05-gameover.png');

  await browser.close();
  server.close();
  console.log(`完成：${outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });
