# 一个人 + AI 的微信小游戏工作流

可以一个人完成小体量微信小游戏。这个项目提供主 Agent、9 个专业子 Agent 的任务书，以及可运行的持久化编排器，覆盖选题、方案、原型、美术、开发、微信接入、测试、发行与运营准备。

默认方案是 **Cocos Creator 3.8 LTS + TypeScript + 火山引擎 Coding Plan（glm-5.3-flash）+ 微信开发者工具**。本地使用 ZCode（桌面版内置 CLI）的无头模式作为文件和命令执行外壳，通过火山引擎 Anthropic 兼容协议调用 glm-5.3-flash，密钥只经环境变量 `ARK_API_KEY` 注入，不消耗 OpenAI/Codex 模型额度。首款限定为 2D 竖屏、单手、短局、离线核心玩法。

本次交付的是工作流工具包。真实游戏尚未制作，真实微信构建、真机和发布尚未验证。完整说明见 [工作流设计](docs/WORKFLOW.md)，平台动作见 [发行手册](docs/RELEASE.md)。

本次已通过 23 项自动测试、9 阶段隔离演示，以及迁移前的真实子 Agent 写文件和主 Agent 审查联调。Coding Plan 迁移后的真实调用需在你配置 `ARK_API_KEY` 后验证。见 [验证记录](docs/VERIFICATION.md)。本机 CLI、代理和 Windows 沙箱设置已写入局部配置，不影响全局设置。

## 先体验整个流程

在项目目录运行：

```powershell
npm run doctor
npm test
npm run demo
```

编排器没有第三方依赖，不需要先 `npm install`。演示只验证状态机，不消耗模型、不操作账号，所有演示产物保存在隔离的 `.demo/`，不能作为真实开发通过记录。

## 启动真实 Agent 工作流

1. 查看 `game-workspace/brief.md`。默认方向已填写，不需要你先做技术选型。
2. 在火山方舟创建或选择**已绑定 Coding Plan 套餐**的 API Key，然后运行 `npm run setup:coding-plan`，按提示安全输入。密钥只保存到 Windows 用户环境变量 `ARK_API_KEY`，不会进入项目、提示词或日志。重新打开终端后运行 `npm run doctor`，确认 `apiKeyConfigured` 为 `true`、模型为 `glm-5.3-flash`、`usesOpenAIQuota` 为 `false`。
3. 需要安装/定位 Cocos 时，在 `workflow.local.json` 填准确路径。首次没有此文件可复制 `workflow.local.example.json`；本机已有配置请合并编辑，不要覆盖。不要把示例路径当实际安装位置。
4. 如修改工具配置，尽量在首次运行前完成；运行中更改需按受影响阶段返工。
5. 启动主控：

```powershell
npm run workflow -- init
npm run workflow -- watch
```

`watch` 在当前终端持续运行，只有等待人工或阻塞时停留，批准后自动继续。可以关闭它；文件进度保留，重新运行继续。它不是已安装的后台服务，电脑关闭时不会执行。

首次会自动完成候选调研与玩法设计，生成可审阅材料后停在 H1。在另一终端处理节点：

```powershell
npm run workflow -- status
npm run workflow -- approve H1 --note "同意推荐玩法和首版范围"
# 不满意则返工
npm run workflow -- reject --note "需要更短的单局和更明确的操作反馈"
```

不使用常驻模式时，可用 `npm run workflow -- run` 执行到下一个节点；每次批准后再运行该命令。

## 人工只处理这些事情

| 节点 | 你审什么 | Agent 必须先提供什么 |
|---|---|---|
| H1 | 玩法与范围 | 三个候选、明确推荐、一页 GDD |
| H2 | 核心玩法是否值得继续 | 真正可玩的灰盒、操作说明、测试记录 |
| H3 | 视觉方向 | 实际界面样张和素材账本 |
| H4 | 微信真机是否通过 | 精确候选包、Android/iOS 测试清单 |
| H5 | 发行候选与上架材料 | 同一版本包、哈希、资质与隐私核验、回退方案 |

账号本人实名、扫码、资质事实、支付或新增费用，以及未预授权的平台操作，按实际需要单独请求。日常编码、检查、可逆修复不逐次询问。

## 目录

```text
agents/                  主 Agent 与专业子 Agent 的任务书
workflow/                阶段依赖、门禁、结构化结果约定
tools/                   控制器、构建适配器、发行工具、演示
tests/                   失败/恢复/审批/发行边界测试
templates/               真机和平台回执模板
game-workspace/          游戏代码与阶段产物（工作 Agent 可写）
.workflow/               状态、批准、日志、进度（控制器维护）
.demo/                   隔离的模拟运行
docs/                    完整工作流、发行手册、资料来源
```

Coding Plan 模型冒烟可用 `node tools/smoke.mjs`，会消耗少量 Coding Plan 套餐额度。ZCode 运行时供应商固定为 `ark`（Anthropic 兼容协议 `https://ark.cn-beijing.volces.com/api/coding`），密钥从环境变量 `ARK_API_KEY` 读取，不使用普通 `/api/v3` 按量地址。缺少 `ARK_API_KEY` 时工作流直接停止，不会回退到 OpenAI/Codex。

发行上传需要另装并锁定 `miniprogram-ci`；没有 AppID、上传密钥和明确版本授权时不会上传。**上传成功、提审、审核通过、正式发布分别记录。**
