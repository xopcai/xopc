# Personal Agent 后台分配真实模型验证

验证日期：2026-10-14，Asia/Shanghai。

状态：当前配置的完整端到端验证未通过；XOPC Cloud OAuth 授权阻塞后台分配，等待重新连接后继续。不将以下局部测量当作完整链路通过。

## 运行条件

- personal agent 当前会话模型：`deepseek/deepseek-flash`。
- 全局模型及 task-router 继承模型：`xopc-cloud/openai-codex/gpt-5.5`。
- 使用真实 Gateway、带 token 的 HTTP 输入路径及真实 DeepSeek 调用；没有替换模型执行逻辑。
- 从当前配置读取 Agent 档案、模型和策略，使用独立 SQLite、个人会话与临时工作区；不复制生产会话或现有任务。
- 合成任务：读取四行销售 CSV，生成月度汇总、报告和可复现脚本；正确值为一月 150、二月 210、环比 40%。预期执行者为 data-analyst。

## 已观测耗时

第二次尝试于 08:33:37 发起，后台在 08:33:46 报告没有通过执行条件检查的候选。

| 阶段 | 实测耗时 | 说明 |
|---|---:|---|
| HTTP 输入受理 | 14 ms | Gateway 返回输入确认 |
| personal 首次真实模型调用 | 8,376 ms | DeepSeek 的 agent.answer 记录 |
| 发起输入到 submit 工具开始 | 8,803 ms | 包括输入调度和模型生成任务书 |
| Task 创建函数 | 1.55 ms | 包装原函数作观察，不改变原逻辑 |
| submit 工具总耗时 | 769.51 ms | 修复前值，包含唤醒时同步候选检查 |
| task-router 模型决策 | 未运行 | Cloud 授权失败导致候选不可用 |
| Specialist 执行 | 未运行 | 未分配成功 |
| 主会话并发响应与最终结果 | 未验证 | 不声称主会话已经通过并发及结果回传验证 |

上述数据是一轮受阻运行的测量，没有足够样本计算 p95，也不代表修复后的性能。

## 发现与修复

1. 首轮 personal 自行设置 requestedAgentId=data-analyst，宿主误以为用户明确指定，从而跳过 router。已加强工具字段、工具说明、个人委派提示词与快照标注：只有用户明确点名才允许填该字段；已知需要委派时先提交材料引用，避免主会话先读取输入。验证脚本现在要求存在成功的 task.allocation 真实模型调用，不能用确定性旁路冒充 router 验证。
2. 后台 dispatcher 的 async 调用在第一个 await 前同步发现和检查候选，拖慢提交返回。已改为 setImmediate 后启动分配，并添加测试证明提交唤醒回调返回前不调用候选检查。修复后真实耗时尚待重新运行。
3. 验证脚本使用了不存在的 session_inputs.completed_at_ms，已改为完成状态下的 updated_at_ms。
4. 最初隔离脚本复制了 OAuth 凭据，这种做法可能导致同一个 refresh token 被独立进程重复使用。服务实际返回 `Refresh token reuse detected; the grant was revoked`。已移除凭据复制，改为 XOPC_CREDENTIALS_DIR 指向原凭据目录，复用现有 provider 文件锁和刷新持久化；已删除早期临时目录内的凭据副本。当前 Cloud 授权需要用户重新连接，不能通过修改模型配置把原配置验证写成成功。

修复后 23 项相关测试、TypeScript 检查与相关 lint 通过；这些检查不能替代真实 Cloud 端到端验证。

## 恢复验证

在 xopc 设置重新连接 XOPC Cloud 后运行：

```sh
XOPC_ALLOCATION_LIVE=1 pnpm exec tsx scripts/personal-allocation-live-smoke.mts
```

脚本保留当前模型配置，仅共享认证存储及锁；业务数据仍隔离。它会在个人首次回复后、执行完成前提交第二条消息，要求立即回复唯一 READY 标记；记录任务提交、分配、执行开始/结束、结果保存、个人结果回复和第二条消息的耗时。验收还要求真实 router 选中 data-analyst、实际报告有正确数值、复现脚本存在，以及结果回复进入原个人会话。

结构化记录：`personal-allocation-live-verification-2026-10-14.json`；首轮弃用记录：`personal-allocation-live-initial-attempt-2026-10-14.json`。两者均不含凭据。
