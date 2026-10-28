# 02 方案与技术选型（02-architecture）

- 阶段：`02-architecture` ｜ 角色：architect ｜ 日期：2026-10-27
- 输入：`brief.md`、`deliverables/01-concept.md`（H1 已批准，候选 A《节气跳跳》）、`deliverables/game-design.md`、`AGENTS.md`
- 状态：待 Producer/人工审查。本文为决策文档，不构成游戏代码；不承诺上线日期或广告收益。
- 诚实声明：本机 **Cocos Creator 编辑器尚未安装**（Cocos Dashboard 2.2.1 已装、未下载编辑器），引擎补丁版本置 `null` 并给出安装与锁定程序；方案设计已完成，原型开发在编辑器就绪前不得声称引擎可用。全部实测记录见 `deliverables/evidence-02-architecture.txt`。

## 0. 决策摘要（TL;DR）

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | 引擎 | Cocos Creator **3.8 LTS 系列**；补丁版本=待安装后实机锁定（现为 null） |
| D2 | 语言与纯度 | TypeScript（strict）；规则层零 Cocos/wx 依赖，`wx` 只出现在 `platform/` |
| D3 | 单测 | Vitest（TS 原生、单工具覆盖）+ `tsc --noEmit` 类型检查；精确版本 03 安装时锁定 |
| D4 | Web 冒烟 | Playwright（浏览器下载失败有 npmmirror 镜像回退；再失败则显式返工，不静默降级） |
| D5 | 后端 | **首版完全不用服务器**（六能力逐项论证见 §5），0 元预算、无域名无备案依赖 |
| D6 | 构建 | 目标平台 `wechatgame`；Cocos CLI 成功退出码 36；构建 JSON 版本化导出 |
| D7 | 验证入口 | `game/scripts/verify.mjs` 四入口 prototype/development/wechat/release（03 落地，契约见 §8） |
| D8 | 登录 | 不做登录（无服务端身份需求）；客户端永不含 AppSecret |

## 1. 实机探测与工具链状态（2026-10-27 实测，详见 evidence）

| 组件 | 状态 | 关键事实 |
| --- | --- | --- |
| Node.js | ✅ 可用 | v20.20.0 |
| npm | ✅ 可用 | 10.8.2，registry=npmjs.org（200/7.2s），npmmirror 镜像可达（200/3.3s） |
| git | ✅ 可用 | 2.53.0.windows.1 |
| Cocos Creator 编辑器 | ❌ 未安装 | 全盘标准路径/注册表/默认编辑器目录均无 `CocosCreator.exe`；仅 C: 盘 |
| Cocos Dashboard | ✅ 已安装 | 2.2.1（`C:\Program Files (x86)\CocosDashboard`，2026-10-27 新装，无启动记录） |
| 微信开发者工具 | ✅ 已安装 | `cli.bat -h` 实测 exit=0；IDE 版本未知（null）；项目命令需登录+服务端口（用户操作） |

解锁动作（用户本人）：在 Dashboard 内安装 Creator 3.8 LTS 最新补丁 → `CocosCreator.exe --version` 实测回填 `toolchain.json` → 03 阶段真实工程构建复核后冻结。

## 2. 引擎、版本与依赖策略

- **引擎系列**：brief 指定 Cocos Creator 3.8 LTS + TypeScript，无经证据确认的硬阻塞，予以采纳。选型依据是项目约束（一人、离线、2D 竖屏、微信小游戏一键构建），不依赖任何未核实的市场数据。
- **补丁锁定程序**：Dashboard 安装 → `--version` 实测 → 回填 `toolchain.json` → 03 用真实工程构建复核 → 首版期间冻结不升级；升级视为变更，需重新过验证。
- **微信基础库**：`project.config.json` 的 `libVersion` 当前=null（不可离线得知可用列表）。锁定程序：06 阶段在真实开发者工具「详情-基础库」中选最近稳定版并写死进工程配置；不盲猜版本号。
- **Node/npm**：Node 20.20.0 + npm 10.8.2（本机实测）。不用 yarn/pnpm。锁文件 `package-lock.json` 入库。
- **依赖清单**（目标，精确版本在 03 执行 `npm install --save-exact` 时按 registry 实际解析结果锁定，不预先捏造）：
  - 运行时依赖：**0**（渲染/音频/存储全部用引擎与平台能力，无第三方运行库）。
  - 开发依赖：`typescript`、`vitest`（D3）；`playwright`（D4，浏览器二进制下载受网络影响时设 `PLAYWRIGHT_DOWNLOAD_HOST` 走 npmmirror 镜像；仍失败则记录并显式返工）。

## 3. 工程目录结构与依赖方向

```
game-workspace/
├─ brief.md / deliverables/          # 阶段文档与证据（已有）
├─ data/                             # 玩法配置唯一源：numeric.json（game-design §5 数值表）、audio.json 等
├─ tests/
│  ├─ unit/                          # Vitest 规则单测：只 import core，不 import cc/wx
│  └─ web/                           # Playwright 冒烟：针对 web 构建产物
└─ game/                             # Cocos Creator 工程根（03 用真实编辑器/CLI 从官方模板生成，不手搓引擎文件）
   ├─ package.json / tsconfig.json   # tsconfig strict；core 编译目标隔离
   ├─ assets/
   │  ├─ scripts/
   │  │  ├─ core/                    # 纯规则逻辑（见下），禁止出现 cc/wx/DOM
   │  │  ├─ presentation/            # Cocos 组件与场景脚本：只 import core 与 platform 接口
   │  │  └─ platform/                # IPlatformService 实现：web.ts / wechat.ts（wx 仅可出现在 wechat.ts）
   │  ├─ scenes/                     # Boot / Home / Main（三场景，状态机见 game-design §3）
   │  └─ resources/
   │     ├─ config/                  # 由 scripts/sync-data.mjs 从 data/ 生成（不手改）
   │     └─ audio/                   # 短音效（初版 wav；真实构建兼容性 03 实测后定稿）
   ├─ scripts/
   │  ├─ verify.mjs                  # 四入口验证编排（§8 契约，03 落地）
   │  ├─ sync-data.mjs               # data/ -> assets/resources/config/ 同步与漂移校验
   │  └─ build-config.json           # Cocos CLI 构建配置（版本化导出，platform=wechatgame）
   └─ build/                         # 构建产物（git 忽略，哈希入证据文件）
```

**依赖方向（单向，违规即 verify 失败）**：
`presentation → core`、`presentation → platform(接口)`、`platform(实现) → core(类型)`；`core` 不 import 任何东西；`wx`、`localStorage`、`window`、`document` 字面量在 `core/` 内出现即失败（verify grep 检查）。

**data 同步机制**：`data/` 是数值唯一源（可审查、可 diff）；`sync-data.mjs` 单向复制到 `assets/resources/config/`；verify 每次运行先校验二者哈希一致，漂移即失败并提示重新同步——保证“审过的数值”与“打包的数值”同一。

## 4. PlatformService 平台适配层契约（TS 签名）

```ts
// game/assets/scripts/platform/types.ts —— core 只依赖本接口，不依赖任何实现
export type Env = 'web' | 'wechat';

export interface IStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
export interface ILifecycle {          // 切后台自动暂停的依据（game-design §3）
  onHide(cb: () => void): void;
  onShow(cb: () => void): void;
}
export interface IAudio {
  preload(names: string[]): void;
  play(name: string): void;            // 短音效；受 sound 开关控制由调用方裁决
  setEnabled(on: boolean): void;
}
export interface IShare {              // v1 disabled：无 UI 入口
  canShare(): boolean;                 // 恒 false
  shareAppMessage(msg: { title: string }): void;  // no-op
}
export interface IRewardedAd {         // v1 disabled：无广告回退=默认路径（brief 硬要求）
  isAvailable(): boolean;              // 恒 false
  load(): Promise<void>;               // reject('disabled')
  show(): Promise<'completed' | 'aborted'>;  // reject('disabled')
}
export interface IAnalytics {          // v1 disabled：不联网、不收集个人信息（brief 隐私最小化）
  track(event: string, props?: Record<string, number | string>): void;  // 本地事件计数器
}
export interface IDevice {             // 竖屏适配必需的最小成员
  getMenuButtonRect(): { left: number; top: number; right: number; bottom: number } | null;
  getSafeArea(): { top: number; bottom: number };
  vibrateShort(): void;                // Web 实现 no-op；受 haptics 开关控制由调用方裁决
}
export interface PlatformService {
  env: Env;
  storage: IStorage; lifecycle: ILifecycle; audio: IAudio;
  share: IShare; rewardedAd: IRewardedAd; analytics: IAnalytics; device: IDevice;
}
```

- **v1 能力状态**：storage/lifecycle/audio/device=必需并实现；share/rewardedAd/analytics=**明确 disabled**（disabled 实现进 Web 与微信双端，无任何 UI 入口；广告资格确认前不得改动）。
- **登录**：不做。无服务端身份需求；未来若做，临时 code 由服务端换身份，客户端不含 AppSecret（本契约预留点：仅 storage 与 lifecycle，无身份接口）。
- **双实现**：`WebPlatformService`（localStorage、`document.visibilitychange` 模拟 onHide、指针事件）与 `WechatPlatformService`（`wx.setStorageSync`、`wx.onHide/onShow`、`wx.getMenuButtonBoundingClientRect()`、`wx.vibrateShort`）。音频格式初版 wav，微信端真实兼容性在 03/06 构建实测后定稿（当前未知=null）。

## 5. 服务器决策表（首版结论：全部“不用服务器”）

| 能力 | 首版是否需要后端 | 不用服务器 | 微信云开发（CloudBase） | 自有服务器 |
| --- | --- | --- | --- | --- |
| 本地存档 | **不需要**（save_v1 已够） | 0 成本，`storage` 接口即满足 | 可换云同步但引入冷启动与配额依赖 | 需 https 域名+ICP+后端开发，成本最高 |
| 好友排行 | 不需要（NOT-1） | —（若未来做：**微信开放数据域**路线可免服务器免域名，需子域工程） | 云数据库存 openid+分数；有免费额度但超量计费（价格随官方调整，未核实） | 域名+ICP+防刷，0 元预算不可行 |
| 全服排行 | 不需要（NOT-1） | 不可行（无全局存储） | 同上，配额风险 | 服务器费 >0 元，违反 0 元预算 |
| 云存档 | 不需要（本地版本化存档） | 存档随包内与设备本地 | 需登录身份+数据库 | 同上，最重 |
| 远程配置 | 不需要（数值随版本走，调参=发新版本） | `data/` 随包构建 | 启动路径依赖云函数，增加失败面 | 同上 |
| 实时对战 | 明确不做（brief 暂缓） | 不可行 | 云函数无长连接，需自建 ws，实际等于自有服务器 | 成本与审核风险最高 |

**决策**：首版离线优先，六项能力全部不建后端——0 元现金成本、无域名/备案阻塞、审核风险最低、离线可玩完整闭环成立（01 已批准）。**重评触发条件**：确认需要好友排行（优先评估开放数据域路线）或跨端云存档时，按 AGENTS.md 单独评审 CloudBase 方案与数据迁移，0 元新增预算下不创建付费资源。

## 6. 存档、配置与数据

- `save_v1`（键名 `save_v1`）：`{v:1, best, games, sound, haptics, tutorialDone}`，语义与写入时机按 game-design §7 执行；`SaveData` 模块负责解析+校验，**坏档一律降级为默认值重建，不崩溃**。
- 版本迁移：`migrate(vN -> vN+1)` 纯函数链，测试覆盖 v1→v2 假想迁移与非法输入；当前只有 v1。
- 数值配置：`data/numeric.json` 与 game-design §5 参数表逐项对应（含随机区间），`StageGen`/`ChargeSim`/`LandingJudge` 从 config 读取，调参不改规则代码。
- 隐私：存档与日志不含设备标识、用户标识、精确位置（§7 日志卫生）。

## 7. 确定性与可测试性设计

- **可复现 seed**：唯一 RNG=mulberry32（纯函数），种子由 `GameSession` 生成并注入 `StageGen`；逻辑层禁止 `Math.random`（verify grep 检查）。
- **回放**：`replay = {v:1, seed, inputs:[{t:ms, type:'press'|'release'}]}`；判定全部为纯函数（蓄力时长→距离→落点→得分），同 seed 同输入必同结果；表现层动画不影响判定。回放导出仅进本地调试文件，不上报。
- **事件计数**：`core/EventSink` 接口；事件集=game_start / jump / perfect / stumble / fall / game_end / combo_milestone；默认实现 `LocalEventCounter` 只进内存并在 debug 模式可导出，供 QA 对照（analytics 对外仍 disabled）。
- **性能采样**：presentation 层 rAF 帧时长环形缓冲，debug overlay 显示 FPS p50/p95；工程目标（60 FPS / 低端 30 FPS / 首屏 3s / 主包 4MB）一律以 07 阶段真实设备与开发者工具实测记录为准。
- **日志卫生**：logger 唯一出口；release 入口对 `core/presentation/platform` 做 grep 禁用扫描（openid、IMEI、IDFA、身份证、经纬度及裸 `console.*` 出现在非 logger 文件即失败）。

## 8. 验证体系：`game/scripts/verify.mjs` 四入口契约（03 阶段落地）

统一用法：`node game/scripts/verify.mjs <prototype|development|wechat|release>`。**铁律**：任何子步骤失败→非零退出；前置缺失（如无 tsconfig、无编辑器、无构建产物）→ 明确报错非零退出，**禁止静默跳过或假装通过**；每步打印所执行命令与结果。

| 入口 | 执行内容（顺序） | 成功判据 |
| --- | --- | --- |
| `prototype` | ① data↔config 哈希一致性 ② `tsc --noEmit`（strict） ③ `vitest run tests/unit` ④ core 纯净性 grep（禁 `wx.`/`localStorage`/`from 'cc'` 等） | 全部 exit=0；无需编辑器 |
| `development` | prototype 全部 + ⑤ `vitest run tests/web`（Playwright 冒烟：加载 web 构建→开局→跳→坠落→重开）+ ⑥ web 构建产物存在性与首屏资源检查 | 全部 exit=0（编辑器未装时此入口必须失败） |
| `wechat` | ①–⑥ + ⑦ Cocos CLI 构建：`CocosCreator.exe --project game --build "game/scripts/build-config.json"`，**官方成功退出码 36**，非 36 即失败；⑧ 构建 JSON 导出存档至 `game/build/`；⑨ wechatgame 产物结构检查（`game.json`/`game.js` 存在）+ 主包 ≤4MB | 全部 exit=0 |
| `release` | wechat 全部 + ⑩ 包体预算细分记录（主包/分包清单）+ ⑪ 两次构建哈希记录（可复现性观察，不硬卡）+ ⑫ 日志卫生 grep + ⑬ 性能采样产物存在性检查 | 全部 exit=0 |

- 构建配置 `build-config.json` 版本化入库（title、platform=`wechatgame`、buildPath、md5Cache 等）；CLI 构建需 Windows 桌面会话；首次构建前需编辑器打开过工程完成依赖导入——这两条约束在 03/06 实测记录。
- `verify.mjs` 本身只做编排与判定，不包含任何游戏规则，不属于 core。

## 9. 并行时间表：研发线 × 账号/资质线

**假设与范围**：工作日为相对天数（D1=03 阶段启动日），按每阶段 0–2 轮返工估计；引擎安装/账号注册/备案等待时间不可控，均计入“未知”；**不承诺上线日期，不做广告收益预测**；现金成本目标 0 元（新增外部支出）。

| 研发线（Agent 主导） | 相对工期 | 账号/资质线（用户本人，可全程并行） | 完成截止建议 |
| --- | --- | --- | --- |
| 引擎安装→03 工程初始化 | D1–D2 | （无依赖动作，可先启动 V-1） | — |
| 灰盒原型：逻辑+适配+场景+闭环 | D2–D6 | V-1 注册 AppID；V-2 类目与资质口径确认 | V-1 建议 D10 前完成 |
| verify prototype 全绿 → **H2 试玩** | D6 | V-6 真机清点+开发者工具扫码登录 | V-6 建议 D18 前 |
| 04 美术定稿 → **H3** | D7–D10 | V-3 ICP 备案启动（周期未知，未核实） | 备案尽早启动 |
| 05 正式开发 → verify development 全绿 | D11–D18 | V-5 适龄/健康合规文案口径 | 08 前 |
| 06 微信接入 → verify wechat 全绿 **［硬依赖 V-1 AppID+登录］** | D19–D24 | V-4 流量主资格（可选，未确认则广告保持 disabled） | 上线后亦可 |
| 07 QA+真机验收 → **H4** **［硬依赖 V-6］** | D25–D32 | （配合真机测试时段） | — |
| 08 发行候选 → **H5** → 上传/提审（用户另行授权，逐项操作） | D33–D36 | V-2/V-3 材料齐备 | 提审前必须齐 |

**关键依赖声明**：06 起的所有微信侧验证、07 真机验收、08 上传提审，都硬依赖真实 AppID 与用户本人扫码登录；账号线延误只推迟 06 以后，不阻塞 03–05。备案（V-3）周期不可控，属最大外部不确定项。

## 10. 风险登记

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | 编辑器未装，03 无法开工 | 高确定 | 解锁动作已给用户（§1）；03 首任务即依赖它 |
| R2 | Cocos CLI 构建退出码/无桌面会话差异 | 中 | 以官方成功码 36 为判据并在 06 实测留档；构建 JSON 版本化 |
| R3 | Playwright 浏览器下载受网络影响 | 中 | npmmirror 镜像回退；仍失败→显式返工改方案，不静默降级 |
| R4 | 真机差异（iOS 静音键/帧率/安全区） | 中 | 07 按机型清单实测；胶囊/安全区经 platform 层抽象（§4） |
| R5 | 云开发免费额度/价格不确定 | 低 | 首版不依赖后端，无影响；重评时以官网实时价为准 |
| R6 | 单人带宽与返工 | 中 | backlog 显式依赖图（backlog.json），阶段门禁不合并 |
| R7 | CLI 登录态/服务端口未开启 | 中 | 06 前由用户开启并扫码（一次性），记录到 evidence |
| R8 | 基础库版本影响 API 行为 | 低 | 06 实测锁定 libVersion 并记录；不盲猜版本 |

## 11. 对后续阶段的硬约束

1. 03 必须先用真实编辑器/CLI 生成工程（T-0301），不得手写伪造引擎文件；随后立即落地 `verify.mjs`（T-0302）——在缺失前置时它必须**以真实失败**呈现。
2. `core/` 永远零 Cocos/wx/DOM；数值改动只动 `data/`，规则改动不碰渲染。
3. share/rewardedAd/analytics 在资格确认前保持 disabled，且不得出现 UI 入口。
4. 不修改编排器、门禁、审批记录；不降低任何验证标准以换取通过。
5. 所有“通过”声明必须对应真实执行证据；浏览器结果不得写成真机结果。

## 12. 未知项清单（显式 null，含解锁动作与记录位置）

| 未知项 | 为什么未知 | 解锁动作 | 记录位置 |
| --- | --- | --- | --- |
| 引擎补丁版本 | 编辑器未安装 | 用户 Dashboard 安装→`--version` 实测 | toolchain.json / evidence |
| 微信开发者工具 IDE 版本 | 配置目录无版本文件 | 06 阶段读取 IDE「关于」或启动日志 | toolchain.json |
| 微信基础库 libVersion | 需真实工具的可用列表 | 06 阶段实选并写死 | toolchain.json / 06 文档 |
| 音频格式微信端实测结论 | 需真实构建验证 | 03/06 构建实测（初版 wav） | 03/06 文档 |
| Playwright 浏览器可下载性 | 网络依赖 CDN | 03 安装时实测，镜像回退 | evidence |
| ICP 备案时长 | 官方流程外部依赖 | 用户启动备案后记录 | 账号线台账 |
| 真机清单 | 用户设备未登记 | 用户填 V-6 | 07 device-test-plan |
| CloudBase 实时价格 | 官方随时调整且未核实 | 重评时查官网 | （首版不适用） |

## 13. 变更记录

- 2026-10-27：首版。因上次架构师进程中断（Dashboard 终端关闭），本次为温和恢复后的完整重做；工具链探针与成品校验见 `deliverables/evidence-02-architecture.txt`。
