import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本地预览服务器：node scripts/serve-web.mjs [buildDir] 后浏览器打开 http://127.0.0.1:7788/ */
const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = process.argv[2] ? path.resolve(gameDir, process.argv[2]) : path.join(gameDir, 'build', 'web-mobile');
const port = Number(process.env.PORT || 7788);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.wav': 'audio/wav', '.map': 'application/json'
};

if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
  console.error(`构建产物缺失：${buildDir}（先运行 Cocos 构建 web-mobile）`);
  process.exit(1);
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(buildDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(buildDir, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`节气跳跳（灰盒原型）预览：http://127.0.0.1:${port}/`);
  console.log(`产物目录：${buildDir}`);
  console.log('操作：按住蓄力，松手起跳；落在石面中心为 Perfect。');
});
