import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, readJson, execute } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flow = new Workflow(root);

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const host = argOf('host', '127.0.0.1');
const port = Number(argOf('port', '7788'));
const token = process.env.DASHBOARD_TOKEN || '';
if (host !== '127.0.0.1' && host !== 'localhost' && !token) {
  throw new Error('监听非本机地址时必须设置 DASHBOARD_TOKEN 环境变量，避免控制台暴露到局域网。');
}
const TEXT_EXTS = new Set(['.md', '.txt', '.json', '.mjs', '.cjs', '.js', '.ts', '.tsx', '.css', '.html', '.yaml', '.yml', '.log', '.svg']);
const LISTABLE = /\.(md|txt|json|png|log|svg)$/;

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readState() {
  try { return readJson(flow.stateFile); } catch { return null; }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 2_000_000) reject(new Error('请求体过大')); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}
function stageRows(state) {
  return flow.stages.map(stage => {
    const record = state?.records?.[stage.id] || {};
    return { id: stage.id, name: stage.name, status: record.status || 'pending', attempts: record.attempts || 0, feedback: record.feedback || '', gate: stage.gate?.id || null };
  });
}
function publicState() {
  const state = readState();
  let orphan = null;
  try { orphan = readJson(path.join(flow.runtime, 'active-worker.json')); } catch { }
  return {
    initialized: Boolean(state),
    status: state?.status || 'uninitialized',
    mode: state?.mode || null,
    message: state?.message || '',
    publicationStatus: state?.publicationStatus || 'not_started',
    updatedAt: state?.updatedAt || null,
    totalAgentCalls: state?.totalAgentCalls || 0,
    stages: stageRows(state),
    pendingGate: state?.pendingGate ? {
      id: state.pendingGate.id, title: state.pendingGate.title,
      instructions: state.pendingGate.instructions, stageId: state.pendingGate.stageId,
      evidenceRequired: Boolean(state.pendingGate.evidenceRequired),
      hasEvidence: Boolean(state.pendingGate.evidence),
      candidate: state.pendingGate.candidate || null,
    } : null,
    dashboardBusy: Boolean(currentRun),
    orphanWorker: orphan ? { pid: orphan.pid, stage: orphan.stage, role: orphan.role } : null,
    workspace: flow.config.workspace,
  };
}
let currentRun = null;
function startRun() {
  if (currentRun) return { started: false, error: '已有一次执行在进行中，请等待其结束' };
  const promise = flow.run()
    .then(state => ({ ok: true, status: state.status }))
    .catch(error => ({ ok: false, error: error.message }));
  currentRun = { promise };
  promise.finally(() => { currentRun = null; });
  return { started: true };
}
async function handleAction(body) {
  const action = body?.action;
  const text = value => (typeof value === 'string' ? value.trim() : '');
  switch (action) {
    case 'init': return publicState(await flow.init());
    case 'run': return startRun();
    case 'approve': {
      const gateId = text(body.gateId); const note = text(body.note);
      if (!gateId) throw new Error('缺少 gateId');
      return publicState(await flow.approve(gateId, note));
    }
    case 'reject': {
      const note = text(body.note);
      if (!note) throw new Error('需要填写返工原因');
      return publicState(await flow.reject(note, text(body.from) || undefined));
    }
    case 'retry': return publicState(await flow.retry(text(body.note) || undefined));
    case 'evidence': {
      const raw = typeof body.content === 'string' ? body.content : '';
      if (!raw.trim()) throw new Error('证据内容为空');
      const parsed = JSON.parse(raw);
      const dir = path.join(flow.runtime, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `evidence-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n');
      return publicState(await flow.evidence(file));
    }
    default: throw new Error(`未知操作：${action}`);
  }
}
function listRuns() {
  const runsDir = path.join(flow.runtime, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir).filter(name => /^[0-9-]+$/.test(name)).sort().reverse().slice(0, 20).map(runId => ({
    runId,
    attempts: fs.readdirSync(path.join(runsDir, runId)).filter(name => /^[a-z0-9-]+$/.test(name)).sort().map(dir => {
      const files = fs.readdirSync(path.join(runsDir, runId, dir)).filter(name => /\.(log|txt|json|jsonl)$/.test(name)).map(name => {
        let mtime = 0; try { mtime = fs.statSync(path.join(runsDir, runId, dir, name)).mtimeMs; } catch { }
        return { name, mtime };
      });
      return { dir, files };
    }),
  }));
}
function tailEvents(limit) {
  const file = path.join(flow.runtime, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  return lines.slice(-Math.max(1, Math.min(200, limit))).map(line => { try { return JSON.parse(line); } catch { return { at: '', type: 'unparsed', raw: line }; } });
}
function listWorkspaceFiles() {
  const machine = /^deliverables\/evidence-.*\.txt$|^evidence\/automated\//;
  const results = [];
  const push = relative => {
    if (machine.test(relative)) return;
    const abs = path.join(flow.workspace, relative);
    const stat = fs.existsSync(abs) && fs.statSync(abs);
    if (stat?.isFile() && stat.size < 3_000_000 && LISTABLE.test(relative)) results.push({ path: relative, size: stat.size });
  };
  push('brief.md');
  for (const dir of ['deliverables', 'evidence']) {
    const base = path.join(flow.workspace, dir);
    if (!fs.existsSync(base)) continue;
    const walk = current => {
      for (const item of fs.readdirSync(current, { withFileTypes: true })) {
        if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
        const relative = path.relative(flow.workspace, path.join(current, item.name)).replaceAll('\\', '/');
        if (item.isDirectory()) walk(path.join(current, item.name)); else push(relative);
      }
    };
    walk(base);
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}
function serveWorkspaceFile(res, relative) {
  const abs = (() => { try { return require00(relative); } catch { throw new Error('非法路径'); } })();
  const ext = path.extname(abs).toLowerCase();
  if (!TEXT_EXTS.has(ext) && ext !== '.png') throw new Error('该文件类型不允许预览');
  const stat = fs.statSync(abs);
  if (stat.size > 3_000_000) throw new Error('文件过大，请在编辑器中打开');
  if (ext === '.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(abs));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(abs));
}
function require00(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('非法路径');
  const base = path.resolve(flow.workspace);
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(base + path.sep)) throw new Error('路径越界');
  return resolved;
}
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (token && req.headers['x-dashboard-token'] !== token) return json(res, 401, { error: '缺少或错误的访问令牌' });
  const send = (code, data) => json(res, code, data);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page());
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') return send(200, publicState());
  if (req.method === 'GET' && url.pathname === '/api/events') return send(200, tailEvents(Number(url.searchParams.get('limit') || 40)));
  if (req.method === 'GET' && url.pathname === '/api/runs') return send(200, listRuns());
  if (req.method === 'GET' && url.pathname === '/api/workspace-files') return send(200, listWorkspaceFiles());
  if (req.method === 'GET' && url.pathname === '/api/workspace-file') return serveWorkspaceFile(res, url.searchParams.get('path') || '');
  if (req.method === 'GET' && url.pathname === '/api/runlog') {
    const run = url.searchParams.get('run') || ''; const dir = url.searchParams.get('attempt') || ''; const file = url.searchParams.get('file') || '';
    for (const part of [run, dir, file]) if (!/^[A-Za-z0-9._-]+$/.test(part)) throw new Error('非法日志路径');
    const abs = path.join(flow.runtime, 'runs', run, dir, file);
    if (!abs.startsWith(path.join(flow.runtime, 'runs') + path.sep)) throw new Error('路径越界');
    const stat = fs.statSync(abs);
    if (stat.size > 400_000) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(fs.readFileSync(abs, 'utf8').slice(-400_000)); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(fs.readFileSync(abs, 'utf8'));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/action') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return send(400, { error: '请求体不是合法 JSON' }); }
    try { return send(200, await handleAction(body)); }
    catch (error) { return send(400, { error: error.message }); }
  }
  send(404, { error: 'not found' });
}
function shutdown() {
  if (currentRun) {
    const active = path.join(flow.runtime, 'active-worker.json');
    try {
      const worker = readJson(active);
      if (process.platform === 'win32') execute('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], { timeoutMs: 8000 }).catch(() => { });
      writeForced(active, worker);
    } catch { }
  }
  process.exit(0);
}
function writeForced(active, worker) {
  try { fs.writeFileSync(active, JSON.stringify({ ...worker, forced: true })); } catch { }
}
function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>微信小游戏工作流控制台</title>
<style>
  :root { color-scheme: dark; --bg:#0f1420; --card:#1a2130; --line:#2a3347; --text:#e8ecf4; --dim:#8b96ab;
    --green:#3fb96f; --red:#e05d5d; --amber:#e0a83f; --blue:#4d9df0; --gray:#5a6478; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font: 14px/1.6 "Segoe UI", "Microsoft YaHei", sans-serif; padding: 20px; max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .chip { font-size: 12px; padding: 3px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); }
  .chip.ready { color: var(--blue); border-color: var(--blue); }
  .chip.running { color: var(--green); border-color: var(--green); animation: pulse 1.2s infinite; }
  .chip.waiting_human { color: var(--amber); border-color: var(--amber); }
  .chip.blocked, .chip.failed { color: var(--red); border-color: var(--red); }
  .chip.complete { color: var(--green); border-color: var(--green); }
  .chip.interrupted, .chip.paused_budget { color: var(--amber); border-color: var(--amber); }
  @keyframes pulse { 50% { opacity: .45; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-top: 14px; }
  .bar { height: 14px; background: #0a0e18; border-radius: 999px; overflow: hidden; margin: 10px 0 6px; }
  .bar > div { height: 100%; background: linear-gradient(90deg, #2f7fd6, #3fb96f); border-radius: 999px; transition: width .6s; }
  .stepper { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .step { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line); color: var(--dim); }
  .step.complete { color: var(--green); border-color: var(--green); }
  .step.running { color: var(--blue); border-color: var(--blue); animation: pulse 1.2s infinite; }
  .step.waiting_human { color: var(--amber); border-color: var(--amber); }
  .step.failed { color: var(--red); border-color: var(--red); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  button { background: #24304a; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 16px; cursor: pointer; font-size: 14px; }
  button:hover { border-color: var(--blue); }
  button.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
  button.good { background: var(--green); border-color: var(--green); color: #08130c; }
  button.bad { background: transparent; border-color: var(--red); color: var(--red); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  input[type=text], textarea, select { background: #101624; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font: inherit; }
  textarea { width: 100%; min-height: 64px; resize: vertical; }
  .gate { border-color: var(--amber); }
  .gate h2 { color: var(--amber); font-size: 16px; margin-bottom: 6px; }
  .gate .inst { color: var(--dim); white-space: pre-wrap; margin-bottom: 10px; }
  .msg { white-space: pre-wrap; color: var(--dim); }
  .msg.err { color: var(--red); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 500; }
  .cols { display: grid; grid-template-columns: 1.1fr .9fr; gap: 14px; }
  @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
  .feed { max-height: 260px; overflow-y: auto; font: 12px/1.7 Consolas, monospace; color: var(--dim); }
  .feed b { color: var(--text); font-weight: 600; }
  .feed .evt-bad { color: var(--red); }
  .feed .evt-ok { color: var(--green); }
  .filebtn { display: inline-block; font-size: 12px; padding: 2px 8px; margin: 2px 4px 2px 0; border-radius: 5px; border: 1px solid var(--line); background: #101624; color: var(--dim); cursor: pointer; }
  .filebtn:hover { color: var(--text); border-color: var(--blue); }
  pre.viewer { background: #0a0e18; border: 1px solid var(--line); border-radius: 8px; padding: 12px; max-height: 420px; overflow: auto; white-space: pre-wrap; word-break: break-all; font: 12px/1.6 Consolas, monospace; }
  .viewer img { max-width: 100%; border-radius: 8px; }
  .viewer.md { font: 14px/1.8 "Segoe UI", "Microsoft YaHei", sans-serif; white-space: normal; word-break: normal; }
  .viewer.md h1, .viewer.md h2, .viewer.md h3, .viewer.md h4 { margin: 16px 0 8px; line-height: 1.4; }
  .viewer.md h1 { font-size: 19px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  .viewer.md h2 { font-size: 17px; }
  .viewer.md h3 { font-size: 15px; }
  .viewer.md h4 { font-size: 14px; color: var(--dim); }
  .viewer.md p { margin: 8px 0; }
  .viewer.md ul, .viewer.md ol { margin: 8px 0 8px 22px; }
  .viewer.md li { margin: 3px 0; }
  .viewer.md table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 13px; }
  .viewer.md th, .viewer.md td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
  .viewer.md th { background: #101624; }
  .viewer.md tr:nth-child(even) td { background: #141a28; }
  .viewer.md code { background: #0a0e18; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; font: 12px Consolas, monospace; color: #9fc4f0; }
  .viewer.md blockquote { border-left: 3px solid var(--amber); margin: 8px 0; padding: 4px 12px; color: var(--dim); background: #141a28; }
  .viewer.md .mdcode { background: #0a0e18; border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow-x: auto; font: 12px/1.6 Consolas, monospace; white-space: pre; }
  .viewer.md hr { border: none; border-top: 1px solid var(--line); margin: 14px 0; }
  .viewer.md a { color: var(--blue); }
  label.tgl { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; color: var(--dim); font-size: 13px; }
  .small { font-size: 12px; color: var(--dim); }
  .ok { color: var(--green); } .bad2 { color: var(--red); }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: var(--dim); }
</style>
</head>
<body>
<h1>🧩 微信小游戏工作流控制台 <span id="chip" class="chip">加载中…</span>
  <span class="small" id="meta"></span></h1>

<div class="card">
  <div class="row"><b>总进度</b><span id="pctText" class="small"></span></div>
  <div class="bar"><div id="bar" style="width:0%"></div></div>
  <div class="stepper" id="stepper"></div>
  <div class="small" style="margin-top:8px">判定标准：状态变 <b>waiting_human</b>（🚩 有门禁等你）或 <b>complete</b> 即成功，同时事件区出现 ✓ stage_verified；状态 <b>failed</b> / <b>blocked</b> 即未通过，原因看下方"失败 / 反馈详情"和红色事件行。</div>
</div>

<div class="card" id="msgCard"><div id="msg" class="msg"></div><div id="orphan" class="small bad2"></div></div>

<div class="card gate" id="gateCard" style="display:none">
  <h2 id="gateTitle"></h2>
  <div class="inst" id="gateInst"></div>
  <div id="gateEvidence" style="display:none" class="small">
    真机证据：<span id="evState"></span>
    <div class="row" style="margin:6px 0">
      <input type="text" id="evFile" placeholder="选择 evidence JSON 文件" size="44" readonly>
      <input type="file" id="evPick" accept=".json,application/json" style="display:none">
      <button id="evBtn">选择并导入证据</button>
    </div>
  </div>
  <textarea id="gateNote" placeholder="审批结论 / 返工意见（必填）"></textarea>
  <div class="row" style="margin-top:8px">
    <button class="good" id="approveBtn">✓ 批准</button>
    <button class="bad" id="rejectBtn">✗ 打回返工</button>
    <select id="rejectFrom"><option value="">打回目标：当前阶段</option></select>
    <span class="small">候选包：<span id="gateCand"></span></span>
  </div>
</div>

<div class="card">
  <div class="row">
    <button class="primary" id="runBtn">▶ 执行到下一门禁</button>
    <label class="tgl"><input type="checkbox" id="autoTgl"> 自动续跑（等价于 watch）</label>
    <button id="initBtn">初始化工作流</button>
    <button id="retryBtn">解除阻塞 (retry)</button>
    <span class="small" id="busy"></span>
  </div>
  <div id="retryNote" style="display:none; margin-top:8px">
    <textarea id="retryInput" placeholder="解除阻塞原因（必填）"></textarea>
    <div class="row" style="margin-top:6px"><button id="retryGo">确认 retry</button></div>
  </div>
  <div id="err" class="msg err" style="margin-top:8px"></div>
</div>

<div class="cols">
  <div class="card">
    <b>阶段明细</b>
    <table><thead><tr><th>阶段</th><th>工作</th><th>状态</th><th>尝试</th></tr></thead><tbody id="stages"></tbody></table>
    <details><summary>失败 / 反馈详情</summary><div id="feedback" class="msg small"></div></details>
  </div>
  <div class="card">
    <b>实时事件</b> <span class="small">完整历史 · 最新在最上 · ✗/⛔=失败 ✅=验证通过</span>
    <div class="feed" id="events"></div>
  </div>
</div>

<div class="cols">
  <div class="card">
    <b>产物浏览（deliverables / evidence）</b> <span class="small">仅人工审阅材料；Agent 自检证据与自动检查日志已隐藏（仍计入审批指纹）</span>
    <div id="files" style="margin-top:8px"></div>
  </div>
  <div class="card">
    <b>运行日志</b>
    <div class="row" style="margin:8px 0">
      <select id="runSel"><option value="">选择运行…</option></select>
      <select id="attSel"><option value="">阶段尝试…</option></select>
      <select id="logSel"><option value="">日志文件…</option></select>
      <label class="tgl"><input type="checkbox" id="followTgl"> 跟随最新（阶段运行时自动尾随当前日志）</label>
    </div>
    <div class="small" style="margin-bottom:6px">看"Agent 实际在做什么"选 <b>*.events.jsonl</b>（Codex 事件流：读文件/写产物/思考）；<b>*.stderr.log</b> 是进程错误；<b>*.prompt.txt</b> 是发给它的完整任务书。</div>
    <pre class="viewer" id="logView">选择运行与日志文件后在此查看</pre>
  </div>
</div>

<div class="card" id="viewerCard" style="display:none">
  <b>产物查看：<span id="viewerPath"></span></b>
  <div class="viewer" id="viewer" style="margin-top:8px"></div>
</div>

<div class="card small">
  🔒 控制台只监听本机 127.0.0.1，模型密钥与工作流状态不出本机。所有审批仍由编排器校验（备注必填、证据哈希、审批指纹），界面不会绕过任何门禁。
  开发流程完成 ≠ 微信已上线；上传、提审、发布需按 docs/RELEASE.md 人工执行。
</div>

<script>
var S = null, autoTimer = null, autoMode = false, followTimer = null;
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function api(path, opts) { return fetch(path, opts).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); }); }
function showErr(m) { $('err').textContent = m || ''; }
function fmtTime(iso) {
  if (!iso) return '';
  var d = new Date(iso); if (isNaN(d.getTime())) return String(iso);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
var EVT_ICON = { stage_started: '▶', stage_failed: '✗', stage_verified: '✓', blocked: '⛔', invalidated: '↩', human_approved: '★', interrupted: '⚡', paused_budget: '⏸', device_evidence_recorded: '📎', initialized: '●', stage_retry: '↻' };
function isBadEvt(t) { return t === 'stage_failed' || t === 'blocked' || t === 'interrupted'; }
function isGoodEvt(t) { return t === 'stage_verified' || t === 'human_approved'; }

function render() {
  api('/api/state').then(function (st) {
    S = st; $('err').textContent = '';
    var chip = $('chip'); chip.textContent = st.status; chip.className = 'chip ' + st.status;
    $('meta').textContent = st.mode ? ('模式 ' + st.mode + ' · Agent 调用 ' + st.totalAgentCalls + ' 次 · 更新于 ' + fmtTime(st.updatedAt)) : '';
    var done = st.stages.filter(function (s) { return s.status === 'complete'; }).length;
    var pct = Math.round(done / st.stages.length * 100);
    $('bar').style.width = pct + '%';
    $('pctText').textContent = done + ' / ' + st.stages.length + ' 阶段完成 · 发行状态 ' + st.publicationStatus;
    var stepper = $('stepper'); stepper.textContent = '';
    st.stages.forEach(function (s) { stepper.appendChild(el('span', 'step ' + s.status, s.id + ' ' + (s.name) + (s.attempts ? ' (' + s.attempts + '次)' : ''))); });
    var msg = $('msg'); msg.textContent = st.message || ''; msg.className = 'msg' + (['blocked', 'interrupted', 'paused_budget'].indexOf(st.status) >= 0 ? ' err' : '');
    $('orphan').textContent = st.orphanWorker ? ('⚠ 检测到疑似残留子进程 pid=' + st.orphanWorker.pid + '（' + st.orphanWorker.stage + ' / ' + st.orphanWorker.role + '），如已确认进程不在，删除 .workflow/active-worker.json 后 retry。') : '';
    $('busy').textContent = st.dashboardBusy ? '（执行中…）' : '';
    $('runBtn').disabled = st.dashboardBusy || !st.initialized || ['running', 'waiting_human', 'blocked', 'paused_budget', 'interrupted', 'complete'].indexOf(st.status) >= 0;
    $('initBtn').disabled = st.initialized;
    renderGate(st); renderStages(st);
  }).catch(function (e) { showErr('读取状态失败：' + e.message); });
}
function renderGate(st) {
  var g = st.pendingGate, card = $('gateCard');
  if (!g || st.status !== 'waiting_human') { card.style.display = 'none'; return; }
  card.style.display = '';
  $('gateTitle').textContent = g.id + ' · ' + g.title;
  $('gateInst').textContent = g.instructions;
  $('gateCand').textContent = g.candidate ? (g.candidate.buildVersion + ' / ' + String(g.candidate.packageHash).slice(0, 12) + '…') : '无';
  var ev = $('gateEvidence');
  if (g.evidenceRequired) { ev.style.display = ''; $('evState').textContent = g.hasEvidence ? '已导入 ✓（可重新导入覆盖）' : '尚未导入（批准前必须先导入）'; $('evState').className = g.hasEvidence ? 'ok' : 'bad2'; }
  else ev.style.display = 'none';
  var sel = $('rejectFrom'); sel.textContent = '';
  sel.appendChild(el('option', null, '打回目标：当前阶段（' + g.stageId + '）'));
  st.stages.forEach(function (s) { var o = el('option', null, '打回到 ' + s.id + ' ' + s.name); o.value = s.id; sel.appendChild(o); });
}
function renderStages(st) {
  var tb = $('stages'); tb.textContent = '';
  var fb = $('feedback'); fb.textContent = '';
  st.stages.forEach(function (s) {
    var tr = document.createElement('tr');
    tr.appendChild(el('td', null, s.id + (s.gate ? ' 🚩' + s.gate : '')));
    tr.appendChild(el('td', null, s.name));
    var td = el('td', s.status, s.status); tr.appendChild(td);
    tr.appendChild(el('td', null, String(s.attempts)));
    tb.appendChild(tr);
    if (s.feedback) fb.appendChild(el('div', null, '[' + s.id + '] ' + s.feedback));
  });
}
function loadEvents() {
  api('/api/events?limit=30').then(function (list) {
    var box = $('events'); box.textContent = '';
    list.slice().reverse().forEach(function (ev) {
      var d = el('div', isBadEvt(ev.type) ? 'evt-bad' : isGoodEvt(ev.type) ? 'evt-ok' : '');
      d.appendChild(el('b', null, (EVT_ICON[ev.type] || '·') + ' ' + fmtTime(ev.at) + '  ' + ev.type));
      if (ev.stage) d.appendChild(document.createTextNode('  ' + ev.stage + (ev.attempt ? ' 第' + ev.attempt + '次' : '')));
      if (ev.error) d.appendChild(document.createTextNode('  ' + ev.error));
      else if (ev.message && ev.type !== 'initialized') d.appendChild(document.createTextNode('  ' + ev.message));
      else if (ev.reason) d.appendChild(document.createTextNode('  ' + ev.reason));
      box.appendChild(d);
    });
  }).catch(function () { });
}
function loadFiles() {
  api('/api/workspace-files').then(function (list) {
    var box = $('files'); box.textContent = '';
    if (!list.length) box.appendChild(el('span', 'small', '工作区暂无可预览产物'));
    list.forEach(function (f) {
      var b = el('span', 'filebtn', f.path + ' (' + Math.round(f.size / 1024) + 'KB)');
      b.onclick = function () { openFile(f.path); };
      box.appendChild(b);
    });
  }).catch(function () { });
}
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function inlineMd(s) {
  return s
    .replace(/\`([^\`]+)\`/g, function (m, c) { return '<code>' + c + '</code>'; })
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>')
    .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, function (m, t, u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>'; });
}
function renderMarkdown(src) {
  var lines = escHtml(src).split(/\\r?\\n/);
  var html = [], i = 0, para = [];
  function flushPara() { if (para.length) { html.push('<p>' + para.map(inlineMd).join('<br>') + '</p>'); para = []; } }
  while (i < lines.length) {
    var line = lines[i];
    if (/^\\s*\\\`\\\`\\\`/.test(line)) {
      flushPara(); var buf = []; i++;
      while (i < lines.length && !/^\\s*\\\`\\\`\\\`/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html.push('<pre class="mdcode"><code>' + buf.join('\\n') + '</code></pre>');
      continue;
    }
    var h = line.match(/^(#{1,6})\\s+(.*)$/);
    if (h) { flushPara(); html.push('<h' + h[1].length + '>' + inlineMd(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
    if (/^\\s*(-{3,}|\\*{3,})\\s*$/.test(line)) { flushPara(); html.push('<hr>'); i++; continue; }
    if (/^\\s*\\|.*\\|?\\s*$/.test(line) && line.indexOf('|') >= 0 && i + 1 < lines.length && /^\\s*\\|?[\\s:|-]+\\|?\\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
      flushPara();
      var cells = function (row) { return row.trim().replace(/^\\||\\|$/g, '').split('|').map(function (c) { return inlineMd(c.trim()); }); };
      var head = cells(lines[i]); i += 2;
      var rows = [];
      while (i < lines.length && /^\\s*\\|.*\\|?\\s*$/.test(lines[i]) && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
      html.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>'
        + rows.map(function (r3) { return '<tr>' + r3.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
      continue;
    }
    if (/^\\s*&gt;\\s?/.test(line)) {
      flushPara(); var q = [];
      while (i < lines.length && /^\\s*&gt;\\s?/.test(lines[i])) { q.push(lines[i].replace(/^\\s*&gt;\\s?/, '')); i++; }
      html.push('<blockquote>' + q.map(inlineMd).join('<br>') + '</blockquote>');
      continue;
    }
    var li = line.match(/^\\s*(?:[-*+]|\\d+[.)])\\s+(.*)$/);
    if (li) {
      flushPara(); var tag = /^\\s*\\d+[.)]/.test(line) ? 'ol' : 'ul'; var items = [];
      while (i < lines.length) {
        var m2 = lines[i].match(/^\\s*(?:[-*+]|\\d+[.)])\\s+(.*)$/);
        if (!m2) break;
        items.push(m2[1]); i++;
      }
      html.push('<' + tag + '>' + items.map(function (t) { return '<li>' + inlineMd(t) + '</li>'; }).join('') + '</' + tag + '>');
      continue;
    }
    if (!line.trim()) { flushPara(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flushPara();
  return html.join('\\n');
}
function openFile(p) {
  fetch('/api/workspace-file?path=' + encodeURIComponent(p)).then(function (r) { return r.text().then(function (t) { return { ok: r.ok, ct: r.headers.get('content-type') || '', t: t }; }); }).then(function (r) {
    $('viewerCard').style.display = ''; $('viewerPath').textContent = p;
    var v = $('viewer'); v.className = 'viewer'; v.textContent = '';
    if (r.ct.indexOf('image/png') === 0) { var img = document.createElement('img'); img.src = '/api/workspace-file?path=' + encodeURIComponent(p); v.appendChild(img); }
    else if (/\\.md$/i.test(p)) { v.className = 'viewer md'; v.innerHTML = renderMarkdown(r.t); }
    else { v.textContent = r.t; }
    $('viewerCard').scrollIntoView({ behavior: 'smooth' });
  });
}
function loadRuns() {
  api('/api/runs').then(function (runs) {
    var sel = $('runSel'); sel.textContent = '';
    sel.appendChild(el('option', null, '选择运行…'));
    runs.forEach(function (r) { var o = el('option', null, r.runId + '（' + r.attempts.length + ' 个尝试）'); o.value = r.runId; sel.appendChild(o); });
    sel.onchange = function () { fillAttempts(runs); $('logView').textContent = '选择日志文件后在此查看'; };
  }).catch(function () { });
}
var RUNS = [];
function fillAttempts(runs) {
  RUNS = runs;
  var runId = $('runSel').value; var att = $('attSel'); var log = $('logSel');
  att.textContent = ''; log.textContent = '';
  att.appendChild(el('option', null, '阶段尝试…')); log.appendChild(el('option', null, '日志文件…'));
  var r = runs.find(function (x) { return x.runId === runId; });
  if (!r) return;
  r.attempts.forEach(function (a) { var o = el('option', null, a.dir + '（' + a.files.length + ' 文件）'); o.value = a.dir; att.appendChild(o); });
  att.onchange = function () { fillLogs(r); };
}
function fillLogs(r) {
  var runId = $('runSel').value, dir = $('attSel').value; var log = $('logSel');
  log.textContent = ''; log.appendChild(el('option', null, '日志文件…'));
  var a = r && r.attempts.find(function (x) { return x.dir === dir; });
  if (!a) return;
  a.files.forEach(function (f) { var o = el('option', null, f.name); o.value = f.name; log.appendChild(o); });
  log.onchange = function () {
    var f = log.value; if (!f) return;
    fetch('/api/runlog?run=' + encodeURIComponent(runId) + '&attempt=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(f))
      .then(function (r2) { return r2.text(); })
      .then(function (t) { $('logView').textContent = t || '（空）'; });
  };
}
function followTick() {
  if (!$('followTgl') || !$('followTgl').checked) return;
  api('/api/runs').then(function (runs) {
    if (!runs.length) { $('logView').textContent = '还没有任何运行记录'; return; }
    var r = runs[0];
    var a = r.attempts[r.attempts.length - 1];
    if (!a || !a.files.length) return;
    var best = a.files.slice().sort(function (x, y) { return y.mtime - x.mtime; })[0];
    $('runSel').value = r.runId; fillAttempts(runs); $('attSel').value = a.dir; fillLogs(r); $('logSel').value = best.name;
    fetch('/api/runlog?run=' + encodeURIComponent(r.runId) + '&attempt=' + encodeURIComponent(a.dir) + '&file=' + encodeURIComponent(best.name))
      .then(function (r2) { return r2.text(); })
      .then(function (t) { var v = $('logView'); v.textContent = t || '（空）'; v.scrollTop = v.scrollHeight; });
  }).catch(function () { });
}
function act(body) {
  showErr('');
  return api('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (st) { if (st && st.status) { render(); loadEvents(); } return st; })
    .catch(function (e) { showErr(e.message); return null; });
}
$('initBtn').onclick = function () { act({ action: 'init' }); };
$('runBtn').onclick = function () { act({ action: 'run' }); };
$('approveBtn').onclick = function () {
  if (!S || !S.pendingGate) return;
  var note = $('gateNote').value.trim();
  if (!note) { showErr('批准前请填写审批结论'); return; }
  act({ action: 'approve', gateId: S.pendingGate.id, note: note }).then(function (st) { if (st) { $('gateNote').value = ''; } });
};
$('rejectBtn').onclick = function () {
  if (!S || !S.pendingGate) return;
  var note = $('gateNote').value.trim();
  if (!note) { showErr('打回前请填写返工意见'); return; }
  act({ action: 'reject', note: note, from: $('rejectFrom').value || undefined }).then(function (st) { if (st) $('gateNote').value = ''; });
};
$('retryBtn').onclick = function () { var n = $('retryNote'); n.style.display = n.style.display === 'none' ? '' : 'none'; };
$('retryGo').onclick = function () {
  var note = $('retryInput').value.trim();
  if (!note) { showErr('请填写解除阻塞的原因'); return; }
  act({ action: 'retry', note: note }).then(function (st) { if (st) { $('retryInput').value = ''; $('retryNote').style.display = 'none'; } });
};
$('evBtn').onclick = function () { $('evPick').click(); };
$('evPick').onchange = function () {
  var f = $('evPick').files[0]; if (!f) return;
  $('evFile').value = f.name;
  var reader = new FileReader();
  reader.onload = function () {
    var text = String(reader.result || '');
    try { JSON.parse(text); } catch (e) { showErr('证据文件不是合法 JSON：' + e.message); return; }
    act({ action: 'evidence', content: text }).then(function (st) { if (st) showErr(''); });
  };
  reader.readAsText(f);
};
function autoLoop() {
  clearInterval(autoTimer);
  if (!autoMode) return;
  autoTimer = setInterval(function () {
    if (!S) return;
    if (S.status === 'ready' && !S.dashboardBusy) act({ action: 'run' });
  }, 4000);
}
$('autoTgl').onchange = function () { autoMode = $('autoTgl').checked; autoLoop(); };
render(); loadEvents(); loadFiles(); loadRuns();
setInterval(render, 2500);
setInterval(loadEvents, 5000);
setInterval(loadFiles, 15000);
setInterval(loadRuns, 20000);
setInterval(followTick, 4000);
</script>
</body>
</html>`;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
const server = http.createServer((req, res) => {
  route(req, res).catch(error => { try { json(res, 500, { error: error.message }); } catch { } });
});
server.listen(port, host, () => {
  console.log(`工作流控制台已启动：http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
  console.log('安全说明：默认只监听本机；密钥、审批与状态文件不会离开这台电脑。Ctrl+C 停止（若正在执行阶段会终止当前 Agent 并标记 interrupted，可稍后 retry）。');
});
