import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, resolveAgentRuntime, parseAgentOutput, execute } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flow = new Workflow(root);
const dir = path.join(flow.runtime, 'smoke');
fs.mkdirSync(dir, { recursive: true });
if (!process.env[flow.config.agentRuntime.apiKeyEnv]) throw new Error(`缺少 ${flow.config.agentRuntime.apiKeyEnv}；不会回退使用 OpenAI/Codex 额度。`);
const [cmd, script] = resolveAgentRuntime(flow.config.agentRuntime);
const result = await execute(cmd, [script, '--cwd', flow.workspace, '--json', '--locale', 'zh-CN', '--no-color', '--mode', 'plan', '--prompt', '这是最小传输冒烟测试。不要使用工具、不要读写任何文件。只回复四个词：coding plan ready。'], { cwd: flow.workspace, env: flow.agentEnvironment(), input: '', timeoutMs: 120000, onStdout: text => fs.appendFileSync(path.join(dir, 'events.jsonl'), text) });
fs.writeFileSync(path.join(dir, 'stderr.log'), result.stderr);
if (result.code !== 0 || result.expired) {
  console.error(`真实 CLI 冒烟未通过；退出码 ${result.code}；超时 ${result.expired}。查看 .workflow/smoke。`); process.exitCode = 1;
} else {
  const event = parseAgentOutput(result.stdout);
  if (!/coding plan ready/i.test(event.response || '')) {
    console.error('模型未返回预期确认语：'); console.error(String(event.response || '').slice(0, 300)); process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ codingPlanTransportVerified: true, provider: flow.config.agentRuntime.kind, model: flow.config.agentRuntime.model, usage: event.usage, note: '只验证 ZCode→火山 Coding Plan 调用链，不代表游戏构建或微信平台已验证。' }, null, 2));
  }
}
