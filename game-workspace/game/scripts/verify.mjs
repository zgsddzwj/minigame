import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(gameDir, '..');
const logsDir = path.join(workspace, 'deliverables', 'logs');
const rel = p => path.relative(workspace, p).replaceAll('\\', '/');

const FORBIDDEN_CORE = [
  { pattern: /\bwx\s*\./, why: 'wx 只允许出现在 platform/wechat.ts' },
  { pattern: /from\s+['"]cc['"]/, why: 'core 禁止依赖 Cocos' },
  { pattern: /localStorage/, why: 'core 禁止 DOM 存储' },
  { pattern: /\bwindow\b/, why: 'core 禁止 window' },
  { pattern: /\bdocument\b/, why: 'core 禁止 document' },
  { pattern: /Math\.random/, why: 'core 禁止非确定性随机（用 mulberry32）' },
  { pattern: /\bnavigator\b/, why: 'core 禁止 navigator' }
];

const report = { entry: process.argv[2] || 'help', startedAt: new Date().toISOString(), steps: [], ok: false };

function fail(msg) {
  report.error = msg;
  finish(1, msg);
}

function finish(code, msg) {
  report.ok = code === 0;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(logsDir, { recursive: true });
  const out = path.join(logsDir, `verify-${report.entry}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[verify:${report.entry}] ${msg || (code === 0 ? '全部通过' : '存在失败步骤')}`);
  console.log(`报告：${rel(out)}`);
  process.exit(code);
}

function run(name, cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: gameDir, encoding: 'utf8', timeout: opts.timeoutMs || 180000, shell: process.platform === 'win32' && cmd.endsWith('.cmd') });
  const step = {
    name,
    command: [cmd, ...args].join(' '),
    exit: r.status,
    durationMs: Date.now() - t0,
    stdoutTail: (r.stdout || '').split('\n').slice(-30).join('\n'),
    stderrTail: (r.stderr || '').split('\n').slice(-20).join('\n')
  };
  report.steps.push(step);
  console.log(`\n== [${name}] ${step.command}\n   exit=${r.status} (${step.durationMs}ms)`);
  if (r.stdout) console.log(r.stdout.trimEnd().split('\n').slice(-12).join('\n'));
  if (r.stderr && r.status !== 0) console.log('STDERR:\n' + r.stderr.trimEnd().split('\n').slice(-12).join('\n'));
  if (r.status !== 0 && !opts.continueOnError) fail(`步骤失败：${name}（exit=${r.status}）`);
  return step;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ① data ↔ resources/config 哈希一致性
function checkDataSync() {
  const src = path.join(workspace, 'data', 'numeric.json');
  const dst = path.join(gameDir, 'assets', 'resources', 'config', 'numeric.json');
  if (!fs.existsSync(src)) fail('缺少数值唯一源 data/numeric.json');
  if (!fs.existsSync(dst)) fail('assets/resources/config/numeric.json 缺失：运行 npm run sync-data 同步');
  const a = sha256(src);
  const b = sha256(dst);
  const step = {
    name: 'data-sync',
    command: `sha256(${rel(src)}) == sha256(${rel(dst)})`,
    exit: a === b ? 0 : 1,
    detail: { src: a, dst: b }
  };
  report.steps.push(step);
  console.log(`\n== [data-sync] ${step.command}\n   ${a === b ? '一致 ' + a.slice(0, 16) + '…' : `漂移！src=${a} dst=${b}`}`);
  if (a !== b) fail('数值配置漂移：运行 npm run sync-data 后重试');
}

// ④ core 纯净性扫描
// ④ core 纯净性扫描（剥掉注释与字符串字面量，只检查代码）
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | str | template | regexish
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; out += '  '; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; out += '  '; continue; }
      if (c === "'" || c === '"') { mode = 'str'; out += ' '; i++; continue; }
      if (c === '`') { mode = 'template'; out += ' '; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += '\n'; } i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; } else { out += c === '\n' ? '\n' : ' '; i++; } continue; }
    if (mode === 'str') { if (c === '\\') { i += 2; continue; } if (c === "'" || c === '"') { mode = 'code'; out += ' '; } i++; continue; }
    if (mode === 'template') { if (c === '\\') { i += 2; continue; } if (c === '`') { mode = 'code'; out += ' '; } i++; continue; }
  }
  return out;
}

function checkCorePurity() {
  const coreDir = path.join(gameDir, 'assets', 'scripts', 'core');
  const files = fs.readdirSync(coreDir).filter(f => f.endsWith('.ts'));
  const hits = [];
  for (const f of files) {
    const text = stripCommentsAndStrings(fs.readFileSync(path.join(coreDir, f), 'utf8'));
    for (const { pattern, why } of FORBIDDEN_CORE) {
      const m = text.match(pattern);
      if (m) hits.push({ file: `game/assets/scripts/core/${f}`, match: m[0], why });
    }
  }
  const step = { name: 'core-purity', command: `grep 纯净性扫描 assets/scripts/core（${files.length} 个文件）`, exit: hits.length ? 1 : 0, hits };
  report.steps.push(step);
  console.log(`\n== [core-purity] 扫描 ${files.length} 个文件\n   ${hits.length ? JSON.stringify(hits) : '无违规（wx/cc/DOM/Math.random 均未出现）'}`);
  if (hits.length) fail('core 纯净性违规');
}

function prototypeSteps() {
  checkDataSync();
  run('typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.check.json', '--noEmit'], { timeoutMs: 240000 });
  run('unit-tests', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit', '--reporter=dot'], { timeoutMs: 240000 });
  checkCorePurity();
}

function checkWebBuild() {
  const cfg = JSON.parse(fs.readFileSync(path.join(gameDir, 'scripts', 'build-config.web.json'), 'utf8'));
  const buildDir = path.join(gameDir, cfg.buildPath || 'build', cfg.platform);
  const index = path.join(buildDir, 'index.html');
  if (!fs.existsSync(index)) fail(`web 构建产物缺失（${rel(index)}）：先用 Cocos CLI 构建（成功退出码 36）`);
  const settings = JSON.parse(fs.readFileSync(path.join(buildDir, 'src', 'settings.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(gameDir, 'package.json'), 'utf8'));
  const step = {
    name: 'web-build-present',
    command: `检查 ${rel(path.join(cfg.buildPath || 'build/web', 'index.html'))} 与 settings.json CocosEngine`,
    exit: settings.CocosEngine === pkg.creator.version ? 0 : 1,
    detail: { built: settings.CocosEngine, project: pkg.creator.version }
  };
  report.steps.push(step);
  console.log(`\n== [web-build-present] 构建版本 ${settings.CocosEngine} vs 工程 ${pkg.creator.version}`);
  if (step.exit !== 0) fail('web 构建与工程引擎版本不一致：重新构建');
  return settings;
}

function resolveCocosExe() {
  const candidates = [];
  if (process.env.COCOS_EXECUTABLE) candidates.push(process.env.COCOS_EXECUTABLE);
  const localCfg = path.join(workspace, '..', 'workflow.local.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(localCfg, 'utf8'));
    if (cfg.tools?.cocosExecutable) candidates.push(cfg.tools.cocosExecutable);
  } catch { /* 无 local 配置 */ }
  candidates.push('C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe');
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  fail('未找到 CocosCreator.exe：设置环境变量 COCOS_EXECUTABLE 或在 workflow.local.json 配置 tools.cocosExecutable');
}

async function main() {
  const entry = process.argv[2];
  if (entry === 'prototype') {
    prototypeSteps();
    finish(0, 'prototype 入口通过（data 同步 / 类型检查 / 单元测试 / core 纯净性）');
  } else if (entry === 'development') {
    prototypeSteps();
    checkWebBuild();
    run('web-smoke', process.execPath, ['tests/web/smoke.mjs'], { timeoutMs: 240000 });
    finish(0, 'development 入口通过（prototype + web 构建 + Playwright 冒烟）');
  } else if (entry === 'wechat') {
    prototypeSteps();
    checkWebBuild();
    const exe = resolveCocosExe();
    const cfg = path.join(gameDir, 'scripts', 'build-config.wechat.json');
    if (!fs.existsSync(cfg)) fail('缺少 build-config.wechat.json（版本化构建配置）');
    const step = run('cocos-build-wechat', exe, ['--project', gameDir, '--build', `configPath=${cfg}`], { timeoutMs: 600000 });
    if (step.exit !== 36) fail(`Cocos CLI 退出码 ${step.exit} ≠ 官方成功码 36`);
    const out = JSON.parse(fs.readFileSync(cfg, 'utf8')).outputName || 'wechatgame';
    const buildDir = path.join(gameDir, 'build', out);
    for (const f of ['game.js', 'game.json', 'project.config.json']) {
      if (!fs.existsSync(path.join(buildDir, f))) fail(`微信产物缺少 ${f}`);
    }
    report.steps.push({ name: 'wechat-product-check', command: `检查 build/${out}/{game.js,game.json,project.config.json}`, exit: 0 });
    console.log('\n== [wechat-product-check] 微信入口文件齐全');
    finish(0, 'wechat 入口通过');
  } else if (entry === 'release') {
    fail('release 入口在 06/08 阶段（微信构建与包体预算实测）启用；本阶段禁止伪造。请先运行 wechat 入口。');
  } else {
    console.log('用法：node scripts/verify.mjs <prototype|development|wechat|release>');
    report.entry = 'help';
    finish(entry ? 2 : 0, '未指定入口');
  }
}

main().catch(e => fail(e && e.stack ? e.stack : String(e)));
