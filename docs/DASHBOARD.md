# 工作流控制台（Web Dashboard）

用浏览器代替终端操作工作流：点按钮执行、看进度条、填审批意见、上传真机证据、翻产物和日志。

## 启动

```powershell
npm run dashboard          # 默认 http://localhost:7788
npm run dashboard -- --port 8080   # 换端口
```

只监听本机 127.0.0.1。如需局域网/隧道访问，必须先设置环境变量 `DASHBOARD_TOKEN`，再 `--host 0.0.0.0`，浏览器首次访问会要求令牌（请求头 `x-dashboard-token`）。

## 界面功能对照

| 界面元素 | 等价终端命令 | 说明 |
|---|---|---|
| ▶ 执行到下一门禁 | `npm run workflow -- run` | 自动执行到下一人工门禁 |
| 自动续跑开关 | `npm run workflow -- watch` | 状态 ready 时自动 run，等价 watch |
| 批准 / 打回（备注输入框） | `approve H1 --note` / `reject --from --note` | 备注必填，由编排器校验 |
| 选择并导入证据（H4） | `npm run workflow -- evidence x.json` | 上传 JSON，落盘到 `.workflow/uploads/` |
| 解除阻塞 (retry) | `retry --note` | blocked / interrupted / 预算暂停后使用 |
| 阶段明细表 | `npm run workflow -- status` | 含每个阶段尝试次数与失败反馈 |
| 实时事件 | `.workflow/events.jsonl` | 5 秒轮询 |
| 产物浏览 | 打开 `game-workspace/deliverables/` | 支持 Markdown/JSON/PNG 预览（H3 样张直接看图） |
| 运行日志 | `.workflow/runs/…` | 按 运行 → 阶段尝试 → 文件 三级选择查看 |

## 边界与安全

- 控制台只是编排器的界面层：所有操作走 `tools/core.mjs` 的 `Workflow` 方法，不绕过备注必填、证据校验、审批指纹、文件锁等任何门禁。
- 不会读取或展示 `ARK_API_KEY`；密钥仍只存在于用户环境变量。
- 状态只能由编排器修改，控制台写入均通过其公开入口完成。
- **不要同时开 watch 和控制台的"自动续跑"**：两者都会在 ready 时抢跑，先到先得、后者报锁冲突。二选一。
- 控制台运行中执行阶段时直接关闭窗口会终止当前 Agent 并标记 `interrupted`（下次 retry 恢复）；建议等阶段结束或门禁等待时再关。

## 开发流程完成 ≠ 微信已上线

上传、提审、审核、发布仍按 `docs/RELEASE.md` 由本人操作；控制台不提供也无法提供这些能力（policy 全部禁止自动执行）。
