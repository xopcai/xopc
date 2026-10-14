# Agent / Task 执行恢复与回归验证 — 2026-10-14

## 修复行为

1. Gateway 将终端错误事件和失败的 `turn_outcome` 传递为失败状态；候选模型尝试期间的异常不提前充当整个执行的终态。总截止时间耗尽与用户取消分别表现为 error 和 cancelled。
2. 请求恢复覆盖 408/429、服务端故障、HTTP/SSE 流缺少结束标记、连接关闭和 WebSocket 空闲超时。权限、凭证、额度错误保持终止行为。单次执行共享有限重试次数，等待过程可取消；验收模型的临时异常也有有限重试。
3. 模型失败后的 fallback 保留用户输入、已完成的工具调用及确认结果，使用 continue 恢复。失败的 assistant 行归档为 `model_attempt_error`；保留条目 ID 和审计信息，避免重写整个 transcript。
4. 恢复期间拒绝重新执行参数相同、已经确认完成的非只读操作，并返回此前结果。文件读取、检查、只读工具和 managed_job 查询仍可刷新。权限和执行范围检查先于重放保护。
5. TaskRun 请求恢复耗尽、验收仍有剩余工作或临时验收故障时，调度原 TaskRun / 会话续跑。`retryPolicy.maxAttempts` 控制次数，默认三次执行；续跑不重置总截止时间。失败输入使用新的持久化输入 ID，避免被旧失败输入的幂等记录拦住。
6. 重启恢复根据原始 SQLite transcript 检查工具调用/结果配对。模型输入的修复投影不能作为副作用已确认的依据。结果缺失、失败或取消时保留明确失败和检查影响的恢复指引，不重放操作。恢复计划绑定 transcript 身份，重置后拒绝沿用。
7. 持久化编码开始、验证、模型选择和等待 checkpoint；任务续跑恢复先前的验证证据。策略限制、响应截断和预算交接使用明确停止语义，避免把部分工作当成完成。
8. 完整长结果保存在回执与结果投递中，协作板只保存不超过 8000 字符的摘要。未经过验收的收尾保留尚未确认的验收项。

## 执行链路测试

`src/agent/embedded/__tests__/task-recovery.integration.test.ts` 使用本地 OpenAI-compatible HTTP/SSE 服务注入故障。请求经过 Gateway、direct streaming、embedded turn、实际 pi AgentSession、工具调用和 SQLite 存储。TaskRun 用例额外经过实际 Dispatcher 和持久化 SessionInputCoordinator。

认证与模型目录使用测试替身；不使用真实账号或付费模型。模拟外部操作实际向临时文件追加记录，验证确认的操作只产生一次副作用。没有 mock Agent loop、请求恢复、fallback、会话存储或 TaskRun 生命周期。

| 场景 | 验证结果 |
| --- | --- |
| 完成操作后遇到 503 | 原请求续跑，副作用一次 |
| 完成操作后 SSE 提前结束 | 恢复后完成，副作用一次 |
| 主模型重试耗尽后切换模型 | 保留工具结果，无重复用户输入 |
| 备用模型以新调用 ID 重放同一操作 | 拒绝重放，继续剩余工作 |
| 429 限流 | 等待后恢复，副作用一次 |
| 401 鉴权失败 | 正确失败，不误报成功 |
| 用户取消 | 不重试、不切换模型 |
| 外部操作发生但结果丢失 | 停止恢复，不再次执行 |
| 请求重试耗尽后 TaskRun 续跑 | 同一 TaskRun / 会话，副作用一次 |
| 持续模型故障 | 三次执行后明确失败，无无限循环 |
| TaskRun 总截止时间耗尽 | 保留原截止时间，报告 error |

额外 SQLite / 验收回归覆盖长结果收尾、验收有限续跑、验收请求故障、重启恢复边界、checkpoint、取消等待和 transcript 重置。

## 验证命令

最终验证：58 个测试文件、447 项测试全部通过；TypeScript 全量检查及 `git diff --check` 通过。

```sh
pnpm exec tsc --noEmit -p tsconfig.json --pretty false
git diff --check
XOPC_LOG_LEVEL=fatal pnpm exec vitest run \
  src/agent/orchestration/__tests__ src/agent/embedded/__tests__ \
  src/agent/tasks/__tests__ src/tasks/__tests__ \
  src/session/__tests__/store.test.ts \
  src/gateway/service/__tests__/run-gateway-agent.test.ts \
  src/gateway/service/__tests__/agent-runner-interruption.test.ts \
  src/gateway/service/__tests__/session-input-coordinator.test.ts \
  src/storage/sqlite/__tests__/session-input-repository.test.ts \
  src/providers/__tests__/model-response.test.ts \
  src/agent/service/__tests__/process-direct-streaming.test.ts
```

运行中的 Gateway 需要重启后加载本次源码变更。对执行结果未确认的外部操作，本次恢复策略仍要求先确认实际影响；不会通过自动重试推断操作未发生。
