import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const gameDir = path.resolve('.');
const buildDir = path.join(gameDir, 'build', 'web-mobile');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.map': 'application/json' };
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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.log('PAGEERROR', String(e)));
  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!(globalThis).__jieqi, null, { timeout: 60000 });

  const dump = async tag => {
    const d = await page.evaluate(() => {
      const s = (globalThis).__jieqi.session;
      return { state: s.state, score: s.score, idx: s.currentIndex, combo: s.combo, games: s.games, charging: s.charging, events: (globalThis).__jieqi.recentEvents() };
    });
    console.log(`\n== ${tag}: state=${d.state} score=${d.score} idx=${d.idx} combo=${d.combo} games=${d.games} charging=${d.charging}`);
    for (const e of d.events) console.log('   ', e);
  };
  const snap = () => page.evaluate(() => { const s = (globalThis).__jieqi.session; return { state: s.state, score: s.score, idx: s.currentIndex }; });
  const clickBtn = async name => {
    const pos = await page.evaluate(n => (globalThis).__jieqi.buttonPagePos(n), name);
    await page.mouse.click(pos.x + pos.w / 2, pos.y + pos.h / 2);
    await page.waitForTimeout(120);
  };
  const press = async ms => {
    await page.mouse.move(195, 480);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    await page.waitForTimeout(1100);
    return snap();
  };
  const chargeCfg = () => page.evaluate(() => { const c = (globalThis).__jieqi.session.config.charge; return { min: c.minDistancePx, max: c.maxDistancePx, durMs: c.maxDurationSec * 1000 }; });
  const perfectPressMs = async () => {
    const [t, c] = await Promise.all([page.evaluate(() => (globalThis).__jieqi.targetInfo()), chargeCfg()]);
    return Math.max(40, Math.min(c.durMs - 40, Math.round(((t.centerDist - c.min) / (c.max - c.min)) * c.durMs)));
  };

  await clickBtn('home.start');
  await press(await perfectPressMs());
  for (let i = 0; i < 3; i++) await press(await perfectPressMs());
  await dump('after combo (score should be 11)');

  const [t, c] = await Promise.all([page.evaluate(() => (globalThis).__jieqi.targetInfo()), chargeCfg()]);
  const shortMs = Math.max(15, Math.round((((t.centerDist - t.halfWidth - 60) - c.min) / (c.max - c.min)) * c.durMs));
  await press(shortMs);
  await dump('after short press (gameover)');

  await clickBtn('over.restart');
  await dump('after restart click');
  console.log('restart snap:', JSON.stringify(await snap()));

  const after = await press(1000);
  await dump('after instinct press(1000)');
  console.log('instinct snap:', JSON.stringify(after));

  await browser.close();
  server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
