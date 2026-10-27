# 设计依据与核实边界

核实日期：2026-10-27。以下能力以实际获取的官方材料和本机命令为依据；平台规则在真实发布前再次核对。

| 来源 | 支持的结论 | 边界 |
|---|---|---|
| [用户首次提供的参考流程](https://01a17bf9-bbc3-71db-aa5f-83242fbda660.arena.site/) | 阶段划分、先灰盒、最小 MVP、研发与资质准备并行 | 已读到嵌入页实际内容；这是交互指南，不是现成 Agent 执行器 |
| [用户后来提供的完整交互指南](https://01a17c0a-f61b-7d02-8bbf-99b80485e4ed.arena.site/) | 玩法到上线路线、服务器决策、AI 岗位提示词、双线时间表、上线清单、成本收益估算和试玩 Demo | 2026-10-27 已读取实际嵌入内容；吸收工程方法，不把页面中的费用、收益、时限或资质判断当作已核实官方规则 |
| [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode) | exec、JSONL、output-schema、复用 CLI 登录、非交互运行 | 功能和账户可用性仍以本机版本实测为准 |
| [Codex 迭代修复示例](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex) | 结构化审查和有界修复循环 | 本项目状态机自行实现，不复制示例当成生产证明 |
| [火山 Coding Plan 快速开始](https://ark.volcengine.com/region:cn-beijing/docs/coding-plan-personal-get-started.md) | `glm-5.3-flash` 模型名；OpenAI 兼容专用地址 `/api/coding/v3` | 官方明确普通 `/api/v3` 不消耗套餐额度而会额外计费，因此控制器拒绝该地址 |
| [火山 Coding Plan 接入 Codex CLI](https://ark.volcengine.com/region:cn-beijing/docs/coding-plan-personal-ai-codex.md) | model provider、`ARK_API_KEY`、Responses 协议配置 | Codex CLI 仅作本地 Agent 外壳；模型服务和额度来自 Coding Plan |
| [Cocos 3.8 微信小游戏发布](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-wechatgame.html) | 微信目标构建、平台适配、资源管理、浏览器环境差异 | 真实引擎版本、包体限制与基础库需复核 |
| [Cocos 3.8 命令行发布](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html) | CLI 构建与 GUI 环境要求 | 网页偶发超时，同时读取官方文档源码 |
| [Cocos 官方 CLI 文档源码](https://github.com/cocos/cocos-docs/blob/master/versions/3.8/zh/editor/publish/publish-in-command-line.md) | 32 参数错误、34 构建失败、36 成功 | 适配器按 3.8 约定，换版本应重新测试 |
| [微信官方 miniprogram-ci](https://github.com/wechat-miniprogram/miniprogram-ci-dist/blob/master/README.md) | Project type=miniGame、upload/preview、上传凭据 | 此 README 没有提供本项目可直接采用的提审/发布方法，不推断所有账号都无此能力 |
| [工信部 APP 备案通知](https://www.miit.gov.cn/jgsj/xgj/wjfb/art/2023/art_dd783a581c9644a4aee10afa582811db.html) | 需提前核对备案与真实身份材料 | 具体小游戏主体和经营模式适用要求需结合当前平台后台核实 |
| [工信部办理解读](https://www.miit.gov.cn/jgsj/xgj/hlwgl/art/2023/art_564bf0759d7e41d5b4aa8ce4996b9e84.html) | 主办者真实材料和平台核验 | AI 不能替用户进行本人身份核验 |

微信开发者文档域名本次未能稳定访问，不能据此认定个人主体的当前支付/广告/版号等细则。发布前由发行 Agent 引导核对真实账号后台，未知项留在 `pending`，不编造已通过。

研究材料不会证明这款尚未创建的游戏已经通过测试。构建、平台联调、真机、审核和上线分别需要真实证据。性能目标、重试数、角色划分和审批策略是本项目的工程设计选择，不是上述平台统一规定。
