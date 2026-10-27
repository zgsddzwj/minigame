import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workflow, execute, inside } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flow = new Workflow(root);
const [configRelative = 'game/config/build-wechat.json', outputRelative = 'game/build/wechatgame'] = process.argv.slice(2);
try {
  const executable = flow.config.tools.cocosExecutable;
  if (!executable || !fs.existsSync(executable)) throw new Error('在 workflow.local.json 配置已安装的 Cocos Creator 可执行文件路径');
  const buildConfig = inside(flow.workspace, configRelative);
  if (!fs.existsSync(buildConfig)) throw new Error('缺少从锁定版本 Cocos 导出的构建配置 JSON');
  const project = inside(flow.workspace, 'game');
  const result = await execute(executable, ['--project', project, '--build', `configPath=${buildConfig}`], { cwd: project, timeoutMs: 20 * 60000 });
  const logDirectory = inside(flow.workspace, 'deliverables/logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(path.join(logDirectory, 'cocos-build.log'), result.stdout + '\n' + result.stderr);
  if (result.expired || result.code !== 36) throw new Error(`Cocos 返回 ${result.code}；官方 3.8 CLI 的成功码为 36。查看 game-workspace/deliverables/logs/cocos-build.log`);
  const output = inside(flow.workspace, outputRelative);
  for (const file of ['game.js', 'game.json', 'project.config.json']) if (!fs.existsSync(path.join(output, file))) throw new Error(`构建缺少 ${file}`);
  console.log(`Cocos 构建成功（36），已验证微信入口文件：${output}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
