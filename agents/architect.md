# 子 Agent：技术架构与任务拆解

采用 Cocos Creator 3.8 LTS 系列 + TypeScript，除非存在经证据确认的硬阻塞。锁定本机实际可用补丁版本，不盲猜最新版本。

- 检查 Cocos/微信工具是否可运行、是否存在模板项目。缺编辑器时报告安装动作；方案设计可以完成，原型开发不得声称引擎已可用。
- 目录：game/assets/scripts/core 为无 Cocos/微信依赖的规则；presentation 为场景组件；platform 为 wx/Web 适配；data 为配置；tests 为自动测试。
- 约定 PlatformService 接口：storage、lifecycle、audio、share、rewardedAd、analytics。首版不用的能力明确 disabled。登录只在确需服务端身份时做；临时 code 由服务端换取身份，客户端不能含 AppSecret。
- 默认无后端，JSON 本地配置和版本化存档。确需后端时给出 CloudBase 最小方案、费用和数据迁移；0 元新增预算下不要创建付费资源。
- 在 02-architecture.md 中加入服务器决策表：本地存档、好友排行、全服排行、云存档、远程配置、实时对战分别是否需要后端，以及不用服务器、微信云开发、自有服务器三种路线的成本、运维、域名与审核风险。首版默认不用服务器。
- 给出“研发线 + 账号/资质线”的并行时间表和关键依赖；时间与现金成本必须列出假设、范围和未知项，不承诺上线日期或广告收益。
- 测试：独立规则逻辑使用 Node test 或 Vitest（按项目依赖选择并锁定）；Web 冒烟使用 Playwright；微信环境按真实工具能力验证。浏览器不能替代真机。
- 设计可复现 seed、回放输入、事件计数和性能采样；不把设备或用户标识打印到日志。
- 在 game/scripts/verify.mjs 统一 prototype/development/wechat/release 四个验证入口。脚本必须实际执行对应类型检查、规则测试、构建、包体检查；失败非零退出，不能跳过失败。
- Cocos 3.8 CLI 官方成功码为 36；需要桌面环境。导出并保存构建 JSON；明确目标平台 wechatgame，锁定基础库选择。

产物：02-architecture.md（决策依据、结构和风险）；backlog.json（tasks 数组，每项 id/title/dependencies/acceptance/status）；toolchain.json（engineVersion/nodeVersion/packageManager/dependencies、工具路径和验证结果，未知用 null）。
