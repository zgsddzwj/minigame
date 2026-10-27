import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, execute, resolveAgentRuntime } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flow = new Workflow(root);
const [command = 'help', ...args] = process.argv.slice(2);
const option = name => { const index = args.indexOf(`--${name}`); return index < 0 ? undefined : args[index + 1]; };
function show(state) {
  console.log(`\n状态：${state.status} · 模式：${state.mode}`);
  console.log(state.message || '');
  console.table(flow.stages.map(stage => ({ 阶段: stage.id, 工作: stage.name, 状态: state.records[stage.id]?.status || 'pending' })));
  if (state.pendingGate) console.log(`\n待确认 ${state.pendingGate.id}；先阅读 game-workspace/deliverables，确认后：\nnpm run workflow -- approve ${state.pendingGate.id} --note "你的确认结论"`);
  console.log(`发行状态：${state.publicationStatus}；进度文件：.workflow/STATUS.md`);
}

async function doctor() {
  const report = { node: process.version, nodeSupported: Number(process.versions.node.split('.')[0]) >= 20, agentRuntime: {}, cocos: {}, wechat: {} };
  try {
    const [cmd, script] = resolveAgentRuntime(flow.config.agentRuntime);
    const result = await execute(cmd, [script, '--version'], { timeoutMs: 30000, env: flow.agentEnvironment() });
    report.agentRuntime = { entrypoint: [cmd, script], version: result.stdout.trim(), provider: flow.config.agentRuntime.kind, model: flow.config.agentRuntime.model, apiKeyEnv: flow.config.agentRuntime.apiKeyEnv, apiKeyConfigured: Boolean(process.env[flow.config.agentRuntime.apiKeyEnv]), usesOpenAIQuota: false };
  } catch (error) { report.agentRuntime.error = error.message; }
  report.cocos = { configuredPath: flow.config.tools.cocosExecutable, found: Boolean(flow.config.tools.cocosExecutable && fs.existsSync(flow.config.tools.cocosExecutable)), note: '未配置不等于未安装；需要在 workflow.local.json 填准确路径，并做一次真实构建。' };
  report.wechat = { configuredPath: flow.config.tools.wechatCli, found: Boolean(flow.config.tools.wechatCli && fs.existsSync(flow.config.tools.wechatCli)), note: '文件存在不代表已经登录或具有目标 AppID 的权限。' };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

try {
  switch (command) {
    case 'init': show(await flow.init()); break;
    case 'doctor': await doctor(); break;
    case 'status': show(flow.load()); break;
    case 'run': show(await flow.run()); break;
    case 'approve': show(await flow.approve(args[0], option('note'))); break;
    case 'reject': show(await flow.reject(option('note'), option('from'))); break;
    case 'retry': show(await flow.retry(option('note'))); break;
    case 'evidence': show(await flow.evidence(args[0])); break;
    case 'watch': {
      await flow.init();
      console.log('主控已启动。人工节点等待批准，批准后自动继续。Ctrl+C 停止。');
      let previous = '';
      while (true) {
        let state = flow.load();
        if (['ready', 'running'].includes(state.status)) state = await flow.run();
        const key = `${state.status}:${state.updatedAt}`;
        if (key !== previous) { show(state); previous = key; }
        if (state.status === 'complete') break;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      break;
    }
    default:
      console.log(`微信小游戏工作流\n\nnpm run doctor\nnpm run workflow -- init\nnpm run workflow -- run\nnpm run workflow -- watch\nnpm run workflow -- status\nnpm run workflow -- approve H1 --note "确认方向"\nnpm run workflow -- reject --from 03-prototype --note "修改意见"\nnpm run workflow -- retry --note "已解除阻塞"\nnpm run workflow -- evidence device-evidence.json\nnpm run demo\n\n发布流程：node tools/release.mjs help\n完整说明：docs/WORKFLOW.md`);
  }
} catch (error) {
  console.error(`\n工作流停止：${error.message}`);
  process.exitCode = 1;
}
