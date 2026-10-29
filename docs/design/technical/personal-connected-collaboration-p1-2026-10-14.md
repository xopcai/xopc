# Personal 连接应用 Task 协作协议 P1

日期：2026-10-14。接续 [P0](personal-task-collaboration-p0-2026-10-14.md)。

## 结果与范围

连接应用 Request 的底层 Task 现在使用普通 Task 的协作记录、问题 wait、回答恢复、指令投递与 ack 确认。Personal 继续负责理解用户补充和最终交付；Router 分配一次，执行者使用同一个 TaskRun。保持账户授权、选定账户、只读策略和原连接恢复界面。

本次实现没有新增业务 Agent、数据库表或网关路由。完整任务书存入现有 Request 的 parameters_json；结果来源序号存入既有 Task 协作表，结构化邮件项仍使用现有 Request 结果存储。

## 协议与工具

Personal 的 `personal_request` 支持：

| 命令 | 用途 |
| --- | --- |
| submit | 短 objective + 完整 description；本地持久化后立即返回 |
| get | Request 信息及完整 Task 协作状态、waits、运行、回执、上下文和近期消息 |
| collaboration | 根据 afterSequence / limit 分页读取规范协作记录 |
| entry | 根据 entryId / bodyOffset 读取完整正文，跟随 nextBodyOffset |
| answer | 将 instruction 作为回答关联指定 questionId，解析原问题 wait |
| instruct | 将补充要求写入原 Task，投递给原执行者 |
| list / cancel | 保留分页查询及取消语义 |

提交和取消响应使用紧凑确认，不返回完整任务书，避免把长描述的截断误当成“需要再委派”。提交默认幂等键关联当前输入及任务书，未知结果重试不会另建 Request。

用户明确修改查询范围时，instruct 可携带新的绝对 timeRange；校验通过后持久化新参数、写入协作要求，并更新当前授权等待的 checkpoint。最终 coverage 以新范围为准，避免把合法收窄误判为旧范围未完成。

初次账户授权前尚未建立 Task 时，instruct 更新原 Request 和等待连接的目标，保留绝对时间范围及权限审查；授权成功后只创建一个包含新要求的 Task。已有 Task 的指令仍进入规范协作记录。

连接应用执行者仅新增 `task_collaboration`：

- get：完整记录分页、指定 entry 或 section=task 的完整任务书及约束。
- post：只允许 progress、question、ack；绑定运行中的实际 Task，无模型可填的 taskId 或 accountId。
- question 复用普通 Task 的 external_event wait，执行者停止该轮直到原问题获得回答。
- ack 引用被投递的回答/指令 ID，复用实际接收会话和 assignment epoch 检查。

执行者仍只有以下六个工具：

```
xopc_tool_search
xopc_tool_describe
xopc_tool_execute
personal_request_connection
personal_request_result
task_collaboration
```

没有开放通用 xopc_use、命令执行、写文件、原生 MCP、动态工具恢复或 Codemode。执行边界 revision 升到 v2，池化运行器继续按边界重建/过滤工具。

## 账户授权与恢复

授权是独立约束，协作文本不能代替授权：

1. 外部执行必须使用 Request 的 connectorId 和 xopcAccountId；传入不同账户或连接器会在 provider 执行前被拒绝。
2. Personal Request 使用内部 personalReadOnly=true 强制 host-curated read。只读许可与 batchRead 可批量执行许可分开：Gmail 查询等只读但不可批量执行的操作可以运行，普通批量调用仍须 batchRead=true。模型输入不能设置该内部模式。Composio 操作还必须是 host-curated read；安装级允许 write 也不能让 Request 发送、删除或归档邮件。
3. 检查账户启用状态、安装策略、selectedAccountIds、Personal 所有者与执行者双方的允许名单，以及当前主对话 transcript。
4. schema 描述等异步操作之后，在 provider dispatch 前再次检查；Composio 在自身 SDK beforeExecute 前也执行此检查，防止权限在准备期间撤回。
5. 账户过期继续走原连接恢复 UI。授权 wait 只含 connectionWaitId，不伪装成可被 answer 消解的协作问题。普通回答只能消解对应协作 wait，不能消解授权 wait。
6. 等待授权期间保存的指令保持 pending；重新授权后在原 TaskRun / 会话中继续投递和确认。
7. 授权暂停和恢复也写入统一 progress 记录。重新授权不得更换已运行 Request 的连接器、账户或执行者。

代码入口：`src/personal-agent/request-access.ts`、`src/agent/external-tools/gateway-tools.ts`、`src/agent/external-tools/service.ts`、`src/agent/external-tools/composio-provider.ts`。

## 状态及最终结果

连接应用的 question、ack、progress、failure 不再被专用结果路径一律丢弃。它们通过普通 Task 的主对话更新机制进入 Personal；通知偏好仍决定是否对用户重复展示日常进度。授权卡片仍由原连接 UI 管理。

result 使用现有共同结果 outbox / Personal 最终回复路径，保留结构化邮件项和来源链接，避免同时再启动一次主对话结果通知。终态结果去重只处理 result，不吞掉其他协作事件。

`personal_request_result` 同步持久化结构化结果和规范 result 记录。幂等键包含最后一条用户回答/指令的序号及结果摘要哈希。发布时要求原执行仍在 running/verifying，且账户授权仍有效。

如果保存结果之后又收到补充要求，最终交付将其识别为过期结果：不把旧结构化项目作为最新内容附回，结果标为 partial 并说明新要求尚未验证。执行者在最新要求下重新发布后，可正常采用新的结构化结果。旧 Request 尚无规范 result 记录且没有后续要求时仍可交付，避免破坏既有持久化结果。

## 自动化验证

最终广泛回归 35 个测试文件、335 个用例通过；随后补充绝对查询范围修改用例，对应模块 37 个用例通过，累计覆盖 336 个不同用例。连接恢复、Composio SDK 和权限策略相关补测 4 个文件、114 个用例通过。根 TypeScript 检查及定向 ESLint 通过。

新增关键断言：

- 完整 description 原样进入 Task，模型提交不能只传短 objective。
- 提问、回答、指令、ack 使用同一协作表；回答重放不重复，始终一个 TaskRun。
- Personal get 读取原问题和 Task 状态；跨 Task entry 读取被拒绝。
- 文字回答不解除账户授权 wait；授权期间指令保持 pending。
- 初次授权前补充要求与查询范围保留，且不重复 Request / Task；明确改范围后采用新 coverage 基准，非法范围不写入协作记录。
- 新要求之后的旧结构化结果不交付；重新发布结果后采用最新项并去重。
- 错账户、写操作、跨连接器、取消、删除、账户/安装/所有者/执行者撤权均阻止 provider 调用。
- 描述 schema 期间撤权，也必须阻止最终 provider dispatch；Composio SDK beforeExecute 期间所有者撤权，也不能执行实际效果。
- 六工具边界阻止原生 MCP、恢复工具和 Codemode 进入连接应用执行。

## 当前真实模型验证

模型未替换：Personal 为 `deepseek/deepseek-flash`，Router 和执行者为全局 `xopc-cloud/openai-codex/gpt-5.5`。

使用隔离 Gateway、真实认证 HTTP 输入与连接操作路由、真实 Task/Request/权限代码，以及真实 Router / Personal / 执行者模型。应用 I/O 是隔离的合成 Gmail HTTP provider，OAuth authorize / sync / capabilities 是测试适配器模拟：**没有读取真实邮箱，也不代表已经验证生产 Gmail OAuth 或 Composio 网络连接。**

模型凭据使用当前目录和提供方锁，不复制刷新令牌。合成账户有 work / other 两个身份；work 仅允许 Personal、researcher、writer。Router 必须真实调用模型并选择这两个获准执行者之一，其他更通用的 Agent 无法取得该账户权限。

验证流程：

1. Personal 检查能力并快速提交一个 Request，Router 后台分配。
2. 执行者问已知查询范围；Personal 从原请求回答，执行者确认并恢复。
3. 执行者问未知报告标签；Personal 在主对话询问。等待期间仍能回复 READY，并实际读取完整 Request/Task 状态。
4. 用户给出“工作观察”；回答回原问题，执行者确认并恢复。
5. 用户追加“待办简报”、仅紧急邮件和校验码 735；原 Task 指令投递、确认并实际用于最终筛选。
6. 模拟原账户过期。真实外部工具守卫创建原主对话授权 wait；通过认证的连接 UI actions 路由 connect 和恢复检查，使用模拟 OAuth 适配器恢复原账户。
7. 同一个 TaskRun 继续最终读取、发布最新结构化结果，并返回主对话。
8. 断言一 Request、一 Task、一根 TaskRun、原账户、获准执行者、真实 Router 模型调用、最终 urgent-001 唯一项、正文采用新标题/标签/校验码、模型执行零工具错误、结果合成未回退。

第三轮还在实际工具入口执行四个预期拒绝探针：错账户、写操作、跨连接器、临时撤回执行者权限。所有探针均被拒绝，未增加应用 provider 的调用数。探针在模型回合之外执行，预期拒绝日志不计为模型工具错误。

### 迭代证据

- 第 1 轮（历史产物已移入 Git 历史）：失败。原工具只有 objective，Personal 将分阶段要求缩成短目标，执行者没有收到明确步骤。修复为独立完整 description，不用“按指定流程”代替原文。
- 第 2 轮（历史产物已移入 Git 历史）：完整协作和原账户重新授权均通过，包括长读取期间补充要求。
- 第 3 轮（历史产物已移入 Git 历史）：完整协作、重新授权和四个实际工具越权探针均通过。执行者为 researcher；原账户未变，模型工具错误为 0。
- 第 4 轮（历史产物已移入 Git 历史）：改为 readOnly=true、batchRead=false 的只读应用契约，完整协作、重新授权和四个越权探针均通过。原模型与账户约束不变，模型工具错误为 0，合成未回退。

```sh
XOPC_CONNECTED_COLLABORATION_LIVE=1 \
XOPC_CONNECTED_REAUTHORIZE=1 \
XOPC_CONNECTED_COLLABORATION_REPORT=/absolute/path/report.json \
pnpm exec tsx scripts/personal-connected-collaboration-live-smoke.mts
```

真实模型调用产生正常费用。20 秒初始读取是测试中的合成应用延迟，包含在总耗时中。观察器轮询不属于 Personal 的工具行为；确认时机取决于执行者当前的工具调用是否结束。

## 最终轮次耗时

| 阶段 | 耗时 |
| --- | ---: |
| 提交工具本地执行 | 14.61 ms |
| 用户请求到 Task 持久化（含能力检查及任务书生成） | 6486.00 ms |
| Router 后台分配 | 5403.00 ms |
| 已知问题到 Personal 回答 | 2278.00 ms |
| 等待期间主对话回复 | 1340.00 ms |
| 完整 Request 状态读取及回复 | 3591.00 ms |
| 用户回答到原执行恢复 | 1786.00 ms |
| 补充要求到协作持久化 | 2981.00 ms |
| 补充要求到执行者确认 | 9543.00 ms |
| 授权 wait 到原 TaskRun 恢复（含测试适配器授权） | 6261.00 ms |
| 执行完成到主对话最终回复 | 4202.00 ms |
| 总计（含合成读取延迟） | 106380.00 ms |

第 2–4 轮提交工具为 11.79–14.61 ms，等待期间回复为 1.23–1.43 s。第二轮补充指令在 20 秒读操作中收到，约 24 s 后确认；第三、四轮约 9.3–9.5 s 确认。账户授权仍会暂停执行，但不会让主对话等待；样本不是生产延迟 SLA。

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
