# Personal Agent 后台分配真实模型验证

验证日期：2026-10-14，Asia/Shanghai。

状态：XOPC Cloud 重新连接后，使用当前真实模型的完整端到端验证通过。最终运行于 09:31:02–09:32:20，验证进程正常退出（exit 0）。下方同时保留早期受阻运行的诊断记录。

## 运行条件

- personal agent 当前会话模型：`deepseek/deepseek-flash`。
- 全局模型及 task-router 继承模型：`xopc-cloud/openai-codex/gpt-5.5`。
- 使用真实 Gateway、带 token 的 HTTP 输入路径及真实 DeepSeek 调用；没有替换模型执行逻辑。
- 从当前配置读取 Agent 档案、模型和策略，使用独立 SQLite、个人会话与临时工作区；不复制生产会话或现有任务。
- 合成任务：读取四行销售 CSV，生成月度汇总、报告和可复现脚本；正确值为一月 150、二月 210、环比 40%。预期执行者为 data-analyst。

## 最终验证与各阶段耗时

最终任务：`664b44dd-8ad8-43c4-a694-9e6ca465bd1d`；唯一标记：`LIVE-ALLOCATION-36fe5e98`。

| 阶段 | 实测耗时 | 口径 |
|---|---:|---|
| HTTP 输入受理 | 15 ms | 输入发起到 Gateway 确认 |
| 用户输入到 Task 保存 | 5.70 s | 包括 personal 模型理解需求、生成任务书 |
| Task 创建函数 | 1.64 ms | 本地创建事务及投影 |
| submit 工具总耗时 | 13.62 ms | 工具开始到返回，不等待后台分配 |
| 提交后个人首次回复完成 | 1.56 s | submit 返回到个人回合完成 |
| 后台分配 | 3.05 s | Task 保存到执行者分配提交 |
| task-router 真实模型调用 | 3.04 s | 包含在后台分配耗时内，非额外串行阶段 |
| 执行队列到开始 | 10 ms | Run queued_at 到 started_at |
| Specialist 执行 | 68.15 s | 包括实际文件读取、脚本生成、运行核验与发布 |
| 执行结束到个人结果回复 | 1.50 s | 包括持久化成果、回复合成及主会话展示 |
| 第二条主对话消息响应 | 1.34 s | 后台分配期间发送，到个人回合完成 |
| 端到端总时间 | 78.42 s | 首次输入到最终结果回复 |

并发证据：个人在提交后结束首个回合，09:31:09.604 发送第二条消息；09:31:10.939 已回复准确的 `LIVE-ALLOCATION-36fe5e98-READY`。此时后台尚在分配，执行者于 09:31:11.105 开始，09:32:19.258 才结束。主对话没有等待后台执行。

选人证据：存在成功的 `task.allocation` 真实调用，模型为 `xopc-cloud/openai-codex/gpt-5.5`；一次选中 `data-analyst`，不是 requestedAgentId 或确定性旁路。主对话历史同时包含分配给 Data Analyst、由 data-analyst 开始执行的状态消息。

执行与回传证据：实际生成 `monthly_summary.csv`、`report.md`、`reproduce.mjs` 并运行核验、发布三个产物。报告与主对话最终回复均包含一月 150、二月 210、环比 40%。Task 最终为 closed，执行者为 data-analyst；成果卡与结果回复属于原个人会话。

执行中有一次 shell 参数错误，模型自行修复，计入执行耗时。最终回复时间通过 100 ms 间隔轮询观测，包含轮询调度误差；Task 创建函数计时不等同于包含外层 capability 提交的 submit 工具总耗时。以上为单次合成任务实测，不代表 p95、并发容量或所有任务的耗时；不能把不同阶段直接相加，因为后台分配、个人回复和第二条消息存在重叠。

## 主对话提示词与工具收敛

- 对模型只展示 submit、list、get、instruct、answer、retry_allocation、selection；不再展示 agents/match/create 和直接选择 executor 的 agentId 参数。
- 不再扫描或注入 Specialist 目录；个人动态上下文保留用户、项目和已有 Task 状态。
- 主对话用任务书描述所需能力，不猜测底层工具名称；硬工具名检查留给后台，用户明确点名的 Skill 仍保留并验证。
- 用户明确点名执行者时支持 ID 或唯一显示名称，由后台解析；不要求主对话先查询 Agent 目录。
- 修复了生产执行上下文没有 agentId 时，“开始执行”消息显示 undefined 的问题：从实际 TaskRun executorRef 读取身份。

相关 133 项测试、TypeScript 检查和相关源码 lint 通过。两次成功合成运行的 personal 初次调用总输入（input_tokens + cache_read_tokens）从 11,436 变为 10,770；只比较 input_tokens 会被缓存命中差异误导，该观测不作为稳定性能保证。

优化过程发现：移除目录后，主模型曾将 file-read/file-write/shell-exec 等猜测名称当成硬工具要求，导致没有可行候选；模型可见参数已移除该字段，修复后的最终真实运行通过。该次失败单独保存在 `personal-allocation-live-prompt-requirements-failure-2026-10-14.json`。

## 历史受阻运行的耗时

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

早期修复后 23 项相关测试、TypeScript 检查与相关 lint 通过；当前结论另外由上面的真实模型运行支持。

## 恢复验证

确保当前配置模型及 XOPC Cloud 授权可用后运行：

```sh
XOPC_ALLOCATION_LIVE=1 pnpm exec tsx scripts/personal-allocation-live-smoke.mts
```

脚本保留当前模型配置，仅共享认证存储及锁；业务数据仍隔离。它会在个人首次回复后、执行完成前提交第二条消息，要求立即回复唯一 READY 标记；记录任务提交、分配、执行开始/结束、结果保存、个人结果回复和第二条消息的耗时。验收还要求真实 router 选中 data-analyst、实际报告有正确数值、复现脚本存在，以及结果回复进入原个人会话。

结构化最终记录：`personal-allocation-live-verification-2026-10-14.json`；优化前成功记录：`personal-allocation-live-before-prompt-optimization-2026-10-14.json`；首轮弃用记录：`personal-allocation-live-initial-attempt-2026-10-14.json`。记录均不含凭据。

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
