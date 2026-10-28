import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(gameDir, '..');
const src = path.join(workspace, 'data', 'numeric.json');
const dest = path.join(gameDir, 'assets', 'resources', 'config', 'numeric.json');

if (!fs.existsSync(src)) {
  console.error(`缺少数值唯一源：${src}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
console.log(`sync-data: ${path.relative(workspace, src)} -> ${path.relative(workspace, dest)}`);
console.log(`src  sha256=${sha(src)}`);
console.log(`dest sha256=${sha(dest)}`);
if (sha(src) !== sha(dest)) {
  console.error('同步后哈希不一致');
  process.exit(1);
}
