import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, resolveAgentRuntime, codingPlanProviderArgs, execute, writeJson, readJson } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flow = new Workflow(root);
const dir = path.join(flow.runtime, 'smoke');
fs.mkdirSync(dir, { recursive: true });
const schema = path.join(dir, 'schema.json');
const output = path.join(dir, 'result.json');
writeJson(schema, { type: 'object', properties: { ready: { type: 'boolean' }, message: { type: 'string' } }, required: ['ready', 'message'], additionalProperties: false });
if (!process.env[flow.config.agentRuntime.apiKeyEnv]) throw new Error(`缺少 ${flow.config.agentRuntime.apiKeyEnv}；不会回退使用 OpenAI/Codex 额度。`);
const [cmd, ...prefix] = resolveAgentRuntime(flow.config.agentRuntime);
const result = await execute(cmd, [...prefix, ...codingPlanProviderArgs(flow.config.agentRuntime), '-c', 'approval_policy="never"', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--cd', flow.workspace, '--output-schema', schema, '--output-last-message', output, '--json', '--color', 'never', '--ignore-user-config', '--model', flow.config.agentRuntime.model, '-'], { cwd: flow.workspace, env: flow.agentEnvironment(), input: 'This is a minimal transport smoke test for Volcengine Coding Plan structured output. Do not use tools, change files, research, or build any game. Return ready=true and message="coding plan ready".', timeoutMs: 120000, onStdout: text => fs.appendFileSync(path.join(dir, 'events.jsonl'), text) });
fs.writeFileSync(path.join(dir, 'stderr.log'), result.stderr);
if (result.code !== 0 || result.expired || !fs.existsSync(output)) {
  console.error(`真实 CLI 冒烟未通过；退出码 ${result.code}；超时 ${result.expired}。查看 .workflow/smoke。`); process.exitCode = 1;
} else {
  const payload = readJson(output);
  if (payload.ready !== true) { console.error('模型未返回 ready=true'); process.exitCode = 1; }
  else console.log(JSON.stringify({ codingPlanTransportVerified: true, provider: flow.config.agentRuntime.kind, model: flow.config.agentRuntime.model, ...payload, note: '只验证火山 Coding Plan 结构化调用，不代表游戏构建或微信平台已验证。' }, null, 2));
}
