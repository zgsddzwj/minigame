import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 生成灰盒短音效（16bit PCM 单声道 22050Hz 正弦/扫频）。确定性输出，便于 diff。 */
const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(gameDir, 'assets', 'resources', 'audio');
const RATE = 22050;

const SPECS = {
  charge: { dur: 0.30, from: 180, to: 320, gain: 0.35 },
  jump: { dur: 0.12, from: 420, to: 720, gain: 0.45 },
  land: { dur: 0.09, from: 300, to: 300, gain: 0.5 },
  perfect: { dur: 0.16, from: 660, to: 990, gain: 0.55 },
  milestone: { dur: 0.30, from: 523, to: 1046, gain: 0.55 },
  fall: { dur: 0.45, from: 400, to: 110, gain: 0.4 },
  ui: { dur: 0.05, from: 800, to: 800, gain: 0.3 }
};

function synth({ dur, from, to, gain }) {
  const n = Math.round(dur * RATE);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const k = i / n;
    const freq = from + (to - from) * k;
    const env = Math.min(1, k * 12) * Math.exp(-3.2 * k);
    const v = Math.sin(2 * Math.PI * freq * t) * gain * env;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const [name, spec] of Object.entries(SPECS)) {
  const file = path.join(outDir, `${name}.wav`);
  fs.writeFileSync(file, synth(spec));
  console.log(`gen-audio: ${path.relative(gameDir, file)} (${spec.dur}s ${spec.from}->${spec.to}Hz)`);
}
console.log(`gen-audio: ${Object.keys(SPECS).length} 个音效已生成`);
