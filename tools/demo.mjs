import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, writeJson } from './core.mjs';
import { copyFixture, simulatedProvider, simulatedDeviceEvidence } from './simulation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = path.join(root, '.demo', String(Date.now()));
copyFixture(root, demoRoot);
const flow = new Workflow(demoRoot, { demo: true, provider: simulatedProvider });
await flow.init();
const approvals = [];
while (true) {
  const state = await flow.run();
  if (state.status === 'complete') break;
  if (state.status !== 'waiting_human') throw new Error(state.message);
  if (state.pendingGate.evidenceRequired) await flow.evidence(simulatedDeviceEvidence(flow));
  approvals.push(state.pendingGate.id);
  await flow.approve(state.pendingGate.id, 'SIMULATED approval, isolated control-flow test');
}
const state = flow.load();
writeJson(path.join(root, '.demo/latest.json'), { simulated: true, demoRoot, approvals, status: state.status, publicationStatus: state.publicationStatus, agentCalls: state.totalAgentCalls });
console.log(`\n演示完成：${approvals.join(' → ')} → 开发流程结束。\n模拟 Agent 调用：${state.totalAgentCalls}；真实模型调用：0；真实发布：0。\n演示产物：${demoRoot}\n注意：没有生成或测试真实小游戏。`);
