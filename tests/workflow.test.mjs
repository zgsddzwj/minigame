import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, inside, readJson, writeJson, validateRelease, packageInventory, packageHash, verifyApproval, execute, reviewBundle, hash, codingPlanProviderArgs } from '../tools/core.mjs';
import { copyFixture, simulatedProvider, simulatedDeviceEvidence } from '../tools/simulation.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(provider = simulatedProvider, configure) {
  const parent = path.join(source, '.workflow/test-runs');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  copyFixture(source, root);
  if (configure) configure(root);
  return new Workflow(root, { demo: true, provider });
}
async function reach(flow, id) {
  await flow.init();
  for (let i = 0; i < 10; i++) {
    const state = await flow.run();
    assert.equal(state.status, 'waiting_human', state.message);
    if (state.pendingGate.id === id) return state;
    if (state.pendingGate.evidenceRequired) await flow.evidence(simulatedDeviceEvidence(flow));
    await flow.approve(state.pendingGate.id, 'SIMULATED test approval');
  }
  throw new Error('gate not reached');
}

test('完整演示逐个停在五个人工节点，不调用平台发布', async () => {
  const flow = fixture(); await flow.init();
  const gates = [];
  for (let i = 0; i < 6; i++) {
    const state = await flow.run();
    if (state.status === 'complete') break;
    assert.equal(state.status, 'waiting_human', state.message);
    gates.push(state.pendingGate.id);
    if (state.pendingGate.evidenceRequired) await flow.evidence(simulatedDeviceEvidence(flow));
    await flow.approve(state.pendingGate.id, 'SIMULATED test approval');
  }
  assert.deepEqual(gates, ['H1', 'H2', 'H3', 'H4', 'H5']);
  assert.equal(flow.load().status, 'complete');
  assert.equal(flow.load().publicationStatus, 'not_started');
  assert.equal(flow.load().totalAgentCalls, 18);
});

test('错误节点不能批准；等待时 run 不调用更多 Agent', async () => {
  const flow = fixture(); await reach(flow, 'H1');
  await assert.rejects(flow.approve('H3', 'bad'), /匹配/);
  await flow.run(); assert.equal(flow.load().totalAgentCalls, 2);
});

test('审批后材料变化被阻止，不能用 retry 保留上游批准', async () => {
  const flow = fixture(); await reach(flow, 'H1');
  fs.appendFileSync(inside(flow.workspace, 'deliverables/game-design.md'), '\nchanged');
  await assert.rejects(flow.approve('H1', 'stale'), /变化/);
  await flow.reject('redo'); await flow.run(); await flow.approve('H1', 'fresh');
  fs.appendFileSync(inside(flow.workspace, 'deliverables/game-design.md'), '\nchanged again');
  const state = await flow.run(); assert.equal(state.blockReason, 'changed_artifacts');
  await assert.rejects(flow.retry(), /不能直接 retry/);
});

test('主 Agent 要求返工时自动修复后重新检查', async () => {
  let reviews = 0;
  const flow = fixture(async context => {
    const result = await simulatedProvider(context);
    if (context.reviewer && ++reviews === 1) return { ...result, status: 'revise', summary: '修复缺失边界条件' };
    return result;
  });
  await reach(flow, 'H1');
  assert.equal(flow.load().records['01-concept'].attempts, 2);
});

test('缺失产物最多尝试三次，不能自报通过', async () => {
  const flow = fixture(async context => {
    const result = await simulatedProvider(context);
    if (!context.reviewer) fs.unlinkSync(inside(context.workspace, context.stage.outputs[1]));
    return { ...result, artifacts: [context.stage.outputs[0]] };
  });
  await flow.init(); const state = await flow.run();
  assert.equal(state.status, 'blocked'); assert.equal(state.records['01-concept'].attempts, 3);
});

test('真正失败的检查命令不能被 Agent 的 done 覆盖', async () => {
  const flow = fixture(async context => {
    const result = await simulatedProvider(context);
    if (context.stage.id === '03-prototype' && !context.reviewer) fs.writeFileSync(inside(context.workspace, 'game/scripts/verify.mjs'), 'console.error("intentional failure"); process.exit(1);');
    return result;
  });
  await reach(flow, 'H1'); await flow.approve('H1', 'ok');
  const state = await flow.run();
  assert.equal(state.status, 'blocked'); assert.match(state.message, /自动检查未通过/);
});

test('账号或工具阻塞不反复消费模型调用', async () => {
  const flow = fixture(async () => ({ status: 'blocked', summary: '缺少工具', artifacts: [], checks: [], blockers: ['需要安装 Cocos'], repairStage: null }));
  await flow.init(); assert.equal((await flow.run()).status, 'blocked');
  await flow.run(); assert.equal(flow.load().totalAgentCalls, 1);
});

test('调用预算到达后停止，不超量启动下一 Agent', async () => {
  const flow = fixture(simulatedProvider, root => {
    const config = readJson(path.join(root, 'workflow.config.json')); config.limits.maxAgentCallsPerRun = 1;
    writeJson(path.join(root, 'workflow.config.json'), config);
  });
  await flow.init(); const state = await flow.run();
  assert.equal(state.status, 'paused_budget'); assert.equal(state.totalAgentCalls, 1);
});

test('返工上游撤销其后全部批准', async () => {
  const flow = fixture(); await reach(flow, 'H3');
  await flow.reject('改变玩法', '01-concept');
  assert.ok(flow.load().approvals.every(item => item.invalidatedAt));
  assert.equal(flow.load().index, 0);
});

test('真机门禁拒绝无证据批准和与包不符的记录', async () => {
  const flow = fixture(); await reach(flow, 'H4');
  await assert.rejects(flow.approve('H4', 'skip'), /真机测试/);
  const file = simulatedDeviceEvidence(flow);
  const evidence = readJson(file); evidence.packageHash = 'bad'; writeJson(file, evidence);
  await assert.rejects(flow.evidence(file), /哈希/);
});

test('添加真机附件不能掩盖已通过 QA 的源代码变化', async () => {
  const flow = fixture(); await reach(flow, 'H4');
  const evidence = simulatedDeviceEvidence(flow);
  fs.appendFileSync(inside(flow.workspace, 'game/scripts/verify.mjs'), '\n// changed after QA');
  await assert.rejects(flow.evidence(evidence), /代码或材料已变化/);
});

test('H5 批准范围在材料变化后失效，但允许新增平台回执', async () => {
  const flow = fixture(); await reach(flow, 'H5'); await flow.approve('H5', 'test');
  const approval = flow.load().approvals.findLast(item => item.id === 'H5');
  verifyApproval(flow, approval);
  const receipt = inside(flow.workspace, 'evidence/platform/receipt.txt'); fs.mkdirSync(path.dirname(receipt), { recursive: true }); fs.writeFileSync(receipt, 'SIMULATED receipt');
  verifyApproval(flow, approval);
  fs.appendFileSync(inside(flow.workspace, 'deliverables/compliance-matrix.json'), ' ');
  assert.throws(() => verifyApproval(flow, approval), /变更/);
});

test('新候选不继承旧版本 approved 发布状态', async () => {
  const flow = fixture(); await reach(flow, 'H5'); await flow.approve('H5', 'first');
  const old = flow.load(); old.publicationStatus = 'approved'; flow.save(old);
  await flow.reject('new version', '08-release'); await flow.run();
  const file = inside(flow.workspace, 'deliverables/release-manifest.json'); const manifest = readJson(file); manifest.version = '0.0.1-demo'; writeJson(file, manifest);
  // Simulate a newly reviewed gate, not an in-place approval of changed files.
  const pending = flow.load(); pending.pendingGate.digest = flow.packetHash(pending); flow.save(pending);
  await flow.approve('H5', 'second');
  assert.equal(flow.load().publicationStatus, 'not_started');
  assert.equal(flow.load().publicationHistory[0].status, 'approved');
});

test('发行哈希包含缓存名目录，额外文件也使候选失效', () => {
  const flow = fixture(); const packageDir = 'game/build/wechatgame'; const dir = inside(flow.workspace, packageDir);
  fs.mkdirSync(path.join(dir, 'temp'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'game.js'), '// fixture');
  writeJson(path.join(dir, 'game.json'), { deviceOrientation: 'portrait' });
  writeJson(path.join(dir, 'project.config.json'), { appid: 'wx0123456789abcdef', compileType: 'game' });
  fs.writeFileSync(path.join(dir, 'temp/included.js'), '// included');
  const manifest = { version: '1.0.0', appId: 'wx0123456789abcdef', packageDir, files: packageInventory(dir) };
  writeJson(inside(flow.workspace, 'deliverables/release-manifest.json'), manifest);
  writeJson(inside(flow.workspace, 'deliverables/compliance-matrix.json'), { items: ['subject', 'filing', 'publishing_qualification', 'privacy', 'copyright'].map(id => ({ id, status: 'verified', evidence: 'unit-test fixture only' })) });
  validateRelease(flow.workspace);
  fs.appendFileSync(path.join(dir, 'temp/included.js'), '// changed');
  assert.throws(() => validateRelease(flow.workspace), /哈希/);
});

test('演示状态不能由真实控制器加载', async () => {
  const flow = fixture(); await flow.init();
  const live = new Workflow(flow.root); assert.throws(() => live.load(), /演示状态/);
});

test('路径越界和活动写入者都会阻止启动', async () => {
  const flow = fixture(); await flow.init();
  assert.throws(() => inside(flow.workspace, '../credentials'), /越界/);
  writeJson(path.join(flow.runtime, 'active-worker.json'), { pid: process.pid });
  assert.equal((await flow.run()).blockReason, 'orphan_worker');
  assert.equal(flow.load().totalAgentCalls, 0);
});

test('两个主控不能同时取得写锁', async () => {
  const flow = fixture(); await flow.init();
  let release;
  const pending = flow.locked(() => new Promise(resolve => { release = resolve; }));
  try { await assert.rejects(flow.locked(async () => {}), /已有控制器运行/); }
  finally { release(); await pending; }
  assert.equal(fs.existsSync(path.join(flow.runtime, 'run.lock')), false);
});

test('挂起的子进程被时间上限终止', async () => {
  const start = Date.now();
  const result = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 });
  assert.equal(result.expired, true);
  assert.ok(Date.now() - start < 8000);
});

test('审查交接包含真实文件全文与哈希，过大文件明确列为遗漏', async () => {
  const flow = fixture(); await reach(flow, 'H1');
  const large = inside(flow.workspace, 'deliverables/large.md'); fs.writeFileSync(large, 'x'.repeat(210000));
  const bundle = reviewBundle(flow.workspace, flow.stages[0], []);
  const evidence = bundle.included.find(file => file.path === 'deliverables/game-design.md');
  assert.equal(evidence.content, fs.readFileSync(inside(flow.workspace, evidence.path), 'utf8'));
  assert.equal(evidence.sha256, hash(Buffer.from(evidence.content)));
  assert.equal(bundle.omitted.find(file => file.path === 'deliverables/large.md').reason, 'context_limit');
});

test('Coding Plan 固定使用专用套餐地址和 glm-5.3-flash', () => {
  const flow = fixture();
  const args = codingPlanProviderArgs(flow.config.agentRuntime).join(' ');
  assert.match(args, /volcengine-coding-plan/);
  assert.match(args, /api\/coding\/v3/);
  assert.doesNotMatch(args, /base_url="https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3"/);
  assert.equal(flow.config.agentRuntime.model, 'glm-5.3-flash');
});

test('拒绝普通火山按量 API 地址', () => {
  assert.throws(() => fixture(undefined, root => {
    const config = readJson(path.join(root, 'workflow.config.json'));
    config.agentRuntime.baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
    writeJson(path.join(root, 'workflow.config.json'), config);
  }), /拒绝可能产生额外按量费用/);
});

test('子 Agent 环境删除 OpenAI 凭据并保留 Coding Plan 环境变量', () => {
  const before = { openai: process.env.OPENAI_API_KEY, codex: process.env.CODEX_API_KEY, ark: process.env.ARK_API_KEY };
  process.env.OPENAI_API_KEY = 'must-not-pass'; process.env.CODEX_API_KEY = 'must-not-pass'; process.env.ARK_API_KEY = 'coding-plan-test-key';
  try {
    const env = fixture().agentEnvironment();
    assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CODEX_API_KEY, undefined); assert.equal(env.ARK_API_KEY, 'coding-plan-test-key');
  } finally {
    for (const [name, value] of [['OPENAI_API_KEY', before.openai], ['CODEX_API_KEY', before.codex], ['ARK_API_KEY', before.ark]]) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});

test('缺少 Coding Plan Key 时直接阻塞且不发起模型调用', async () => {
  const parent = path.join(source, '.workflow/test-runs'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'no-key-')); copyFixture(source, root);
  const config = readJson(path.join(root, 'workflow.config.json')); config.agentRuntime.apiKeyEnv = 'ARK_API_KEY_TEST_MISSING'; writeJson(path.join(root, 'workflow.config.json'), config);
  delete process.env.ARK_API_KEY_TEST_MISSING;
  const flow = new Workflow(root); await flow.init(); const state = await flow.run();
  assert.equal(state.status, 'blocked'); assert.equal(state.blockReason, 'missing_credentials'); assert.equal(state.totalAgentCalls, 0);
  assert.match(state.message, /不会回退到 OpenAI\/Codex 额度/);
});
