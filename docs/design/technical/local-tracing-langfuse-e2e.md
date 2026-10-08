# 本地 Langfuse E2E 验收

日期：2026-10-08；Langfuse：4.54.0。

## 配置与最终状态

- 当前 Gateway：`http://localhost:18790`，状态根目录 `~/.xopc`。
- Langfuse：`http://localhost:3300`，项目 `xopc Debug`。
- Public/Secret Key 通过 Gateway 凭证接口保存，未写入仓库。
- 本地采集开启，模式 `redacted`，保留 7 天，保留用户已有 20 MiB 容量限制。
- Langfuse 双写开启，连接测试通过；最终 `ready`，pending/dropped 均为 0。

## 真实运行结果

通过认证的 `POST /api/sessions/:conversationId/inputs` 发起真实 MiniMax-M3 Agent 运行，请求调用只读时间工具，然后回复验收成功。

- 会话：`27d5371d-0cf0-4f13-8ce2-4876fc412dd8`。
- Run：`558239e8-5524-47d5-8da2-f6886bec5322`。
- Trace：`0d916242f56df1ddd642465d1498066f`。
- Agent 成功调用 `session_status`，最终回复“追踪验收成功。”。
- 本地和 Langfuse 均记录 7 个节点：根 Agent、模型尝试、两次 Generation、工具调用、两次上下文压缩检查。
- 所有 Span ID 与 Langfuse Observation ID 及父节点关联完全一致。
- 两次 Generation 的模型、输入/输出/缓存 Token、USD 成本与本地采集一致。
- 总 Token（含缓存）45354，总成本 USD 0.008180399999。
- SQLite `ai_usage_events` 中两条记录正确关联此 Trace/Span。
- JSON 导出与详情接口一致；本地/远端/Settings 返回数据未出现 Langfuse Key。

## 故障验证

临时将 Langfuse 地址切换为不可达的 loopback 端口，发起第二次真实 Agent 运行；测试结束在 finally 中恢复原配置。

- 离线 Trace：`78867656c8d5c55f13a9b347b96d4ac4`。
- Agent 仍成功完成，本地保留全部 7 个节点，local dropped 为 0。
- 远端显示 `degraded`，重试结束后 dropped 为 8（包括独立生成会话标题的节点）。
- 恢复 localhost:3300 后连接测试通过。

## 页面验证及范围

在 Chrome 的 `http://localhost:3000/#/settings/tracing` 确认执行列表和验收 Trace 的 7 个节点详情可用。

Langfuse 数据通过认证的 `/api/public/v2/observations` 查询验证；v4 events_only 部署的旧 `/api/public/traces/:id` 返回 404，验收不依赖该旧接口。未进行容量压测或清空用户已有追踪数据。故障测试的远端记录按有界队列策略丢弃，不会恢复后补传。
