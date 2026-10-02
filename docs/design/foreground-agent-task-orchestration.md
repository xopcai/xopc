# 主 Agent 与后台任务协作：产品技术方案

> 状态：阶段 A–C 已实现并通过本地验证；阶段 D 已加入观测接口，真实语音数据待采集 · 2026-10-02
>
> 范围：同一主 Agent 会话中的文字与语音派工、后台 Task 执行、双向进展、任务可见性。

## 1. 决策

用户始终与主 Agent 对话。主 Agent 负责理解目标、形成任务书、派发、协调、向用户汇报和组织验收；执行 Agent 在独立的任务会话中执行。`Task` 是长期承诺，`TaskRun` 是一次执行尝试，主会话是用户交互边界。沿用 `project-task-taskrun-rfc.md` 的职责，不把任务状态写进 Session，也不把短时 `delegate_task` 改造成后台任务。

主 Agent 和执行 Agent 通过**任务级追加式协作记录**交换进展与指令。记录是事实来源；提交记录后的事件只负责唤醒订阅者。主 Agent 可随时读取任务快照，必要时向执行 Agent 留言。执行 Agent 不能直接替主 Agent 向用户发言。

用户可从派工消息下的任务引用进入单个 Task，并在 Agent Environment Context 中查看当前对话关联的任务。两处都以 Task ID 查询状态，不复制任务状态。左侧栏保持主对话导航，不重复展示任务列表。

## 2. 现有能力与缺口

| 能力 | 当前基础 | 待补 |
| --- | --- | --- |
| 任务书 | Task contract 支持目标、产物、验收条件、约束和审批要求；`xopc_use task create` 可启动执行 | 明确主会话关联和执行 Agent 的汇报约定 |
| 后台执行 | TaskRunDispatcher 建立独立任务会话，SessionInputCoordinator 运行 Agent；TaskRun 保存 receipt | 执行过程中的结构化进展及可靠回传；有界并发 |
| 主会话 | `assistant` 语音使用原会话 Agent 和工具，挂断只脱离语音事件订阅 | 主 Agent 对后台事件的感知及语音播报调度 |
| 消息入口 | Product Delivery 已能在助手回复下渲染 Task 引用 | 引用的实时状态、关联任务聚合 |
| Context | Session Context Summary 只展示当前执行会话的一个 Task | 当前主会话派出的多个 Task |
| 直接子 Agent | `delegate_task` 等待子 Agent 完成后返回工具结果 | 此路径保持短任务用途；长期后台任务走 Task/TaskRun |

当前 `TaskRunDispatcher.drain()` 在单个 worker 中等待一次 `runAgent()` 结束才领取下一个 Agent TaskRun。多任务并行需要独立改造，不应仅在 UI 展示多个运行标签。

## 3. 不变量与身份

- `conversationId`：主 Agent 与用户的持久对话，不随语音连接变化。
- `taskId`：任务长期身份；一次用户请求可以创建多个 Task。
- `runId`：一次 TaskRun 尝试；重试保留相同 Task ID、使用新 Run ID。
- `workerConversationId`：执行 Agent 的独立会话；切换执行 Agent 可以产生新会话。
- `voiceSessionId`：音频传输生命周期，不参与任务身份。
- 派工消息里的 Task 引用使用 Task ID；消息正文保持历史文本，引用状态从当前 Task 读模型刷新。
- 任务的 `review` / 待验收与 `closed` / 已完成保持区分。

## 4. 数据设计

### 4.1 主会话与任务关联

在 `TaskCreateRequest` 中显式传入 `originConversationId`，并在 Task 创建事务中写入不可变的 `task_origin_links(task_id, conversation_id, created_at)`。当前 `task_sessions` 的 `primary` 角色尚无明确的发起会话语义，不先复用它；待统一 Task 会话角色定义后再考虑合并。现有 `context_edges` 中指向 Session 的边继续表示可检索来源，但不充当唯一的派工身份：来源边可变，且没有派工消息信息。历史 Task 可从明确的来源边一次性回填；多义记录不猜测归属。服务端只接受当前已鉴权会话作为 Agent 创建任务的发起会话，不能信任模型自由传入的任意 ID。

派工消息继续使用现有 Product Delivery 的 Task reference。若需要跨消息追踪“哪条回复首次派工”，增加单独的派工锚点记录，保存 `taskId`、`conversationId`、`runId` / `assistantMessageId`、创建时间。工具调用早于最终助手消息时，先以 Run ID 关联，消息落盘后再补消息 ID。锚点不影响 Task 生命周期。

### 4.2 任务协作记录

新增 `task_collaboration_entries`，按 Task 内递增 `sequence` 追加。建议字段：`entryId`、`taskId`、`taskRunId?`、`assignmentEpoch?`、`sequence`、`authorKind`、`authorId`、`kind`、`bodyJson`、`causationId?`、`idempotencyKey`、`createdAt`。`kind` 限定为 `progress`、`question`、`answer`、`instruction`、`ack`、`result`、`failure`。`bodyJson` 包含简短摘要和可选产物/证据引用；大文本与文件仍归原存储。

每个消费者保存已读游标或通过 `afterSequence` 按需读取。写入记录与 `task.collaboration_entry_added` outbox 事件在同一事务完成。需要送达执行会话的指令，同时在事务中建立 `delivery_intent`；异步投递器用稳定 `clientMessageId` 提交到 `SessionInputCoordinator`，投递成功后再更新送达状态。协作记录入库不等于 Agent 已接收。重放事件不重复写入，断线后按 sequence 补读。普通工具日志不自动变成协作记录；执行 Agent 只在里程碑、阻塞、关键发现和结束时汇报，防止噪声。

Task contract 和 TaskRun receipt 仍分别是任务书与最终执行结论的权威来源；协作记录是过程及双方通信，不替代它们。任务书更新走现有版本控制，`instruction` 记录只表达请求；执行 Agent 回 `ack` 后才能显示“已接收”。

## 5. 执行链路

```text
用户语音/文字 → 主会话 Agent → 创建 Task + origin 关联 + TaskRun
                                     ↓
                            TaskRunDispatcher
                                     ↓
                            执行 Agent 独立会话
                                     ↓
              进展/提问/结果 → 协作记录 + outbox
                                     ↓
                     主会话任务投影与提醒调度
                                     ↓
                主 Agent 按需读取 → 回复用户
```

1. 主 Agent 使用 Task 创建能力提交任务书、执行 Agent、来源主会话及幂等键。Task 创建返回 Task ID / Run ID；主 Agent 可立即继续对话。
2. Dispatcher 启动执行会话。执行提示包含固定版本任务书、上下文快照和“何时汇报”的规则。执行 Agent 获得任务范围内的 `report_progress`、`ask_owner`、`ack_instruction` 能力，权限不得超出当前 Task 的授权快照。
3. 执行 Agent 的关键进展写协作记录。最终 TaskRun receipt 生成时由系统自动追加 `result` 或 `failure` 记录，避免 Agent 忘记汇报。
4. 主 Agent 问进度时先读 Task、TaskRun 和新增记录；需要执行 Agent 进一步判断时，追加 `question` 或 `instruction`，由可靠投递器向当前执行会话提交。运行中优先在安全检查点读取留言，`steer` 只作为加速路径；注入结果不确定时不能盲目重试成下一轮输入。返回“已记录／已投递／已确认”分层状态，`ack` 由执行 Agent 明确写入。
5. 执行 Agent 向主 Agent 提问时，必须建立带问题 ID、对应 TaskRun 和解除条件的等待状态，并结束或暂停当前执行回合；主 Agent / 用户回复后按同一问题 ID 恢复。需要用户批准的动作继续使用现有审批 / TaskWait 机制，不能仅凭自由文本 `answer` 放行。

## 6. 主 Agent 感知与语音

新增轻量 `TaskAttentionCoordinator`，从 outbox / 协作记录读取新增事件，按主 `conversationId` 聚合，并为 UI 和主 Agent 提供同一个任务摘要。它只做确定性的分级，不直接生成用户可见的自然语言：

- 普通 `progress`：刷新三个任务入口；主 Agent 在下一次用户提问时读取。
- `question` / 待审批：形成待处理事项；活跃通话在当前语音回合的安全边界交给主 Agent 表述。
- `result` / `failure`：形成一次可恢复的汇报机会；主 Agent 读取 receipt 后总结，不照搬执行 Agent 自述。

第一阶段不在主 Agent 正在生成的回复中途强塞事件。语音客户端可实时收到状态卡更新；主 Agent 在下一次用户回合读取高优先级变化。后续再建立独立的事件驱动回合，要求同一主会话串行调度、去重、可中断，并通过语音播放状态决定播报时机。若已挂断，保留记录与待汇报游标；再次接通时提供有界摘要。音频连接中断不重新执行任务或重放语音输入。

当前 `natural` 模式仍没有工具，不假装它能派工。首版用具备 Agent 工具能力的 `assistant` 语音路径实现；自然语音与任务控制的统一桥接作为后续独立阶段设计与验证。

## 7. 产品投影与接口

### 主 Agent 消息

沿用 Product Delivery Task reference。增加 Task 当前状态查询与订阅：已派发、排队、执行中、待用户、待验收、已完成、失败。任务引用可展开最新一条重要进展与更新时间；点击 Task ID 打开现有详情。

### 左侧

左侧栏只保留主对话导航，不增加“本对话的任务”分组。任务执行会话继续归任务详情，不平铺成新的主 Agent 聊天。

### Agent Environment Context

扩展 `SessionContextSummary.work`：保留现有 `task`（当前会话正在执行的 Task），增加 `delegatedTasks` 摘要与总数。摘要包含 Task ID、标题、阶段、运行状态、最近重要进展及待用户标记。此处显示**关联**，不声称模型已读完整任务内容。模型每轮只获取有界任务目录；日志、任务书和 receipt 按需工具读取。

### 接口和能力

- `GET /api/sessions/:id/delegated-tasks`：当前主会话任务摘要，分页；或纳入现有 Session Context Summary 的有限预览。
- `GET /api/tasks/:id/collaboration?afterSequence=`：协作记录增量。
- `POST /api/tasks/:id/collaboration`：主 Agent / 执行 Agent 写入有类型的记录；按身份与 Task 关联校验。
- Agent capability：创建任务、读任务摘要、读记录、发布进展、询问 / 追加指令。可在 `xopc_use` 下扩展，但应给出清晰的工具描述与受限权限。
- Realtime：发布 `task.collaboration_entry_added`，客户端收到后以 sequence 补读，不把易丢的推送当作事实来源。

新增认证 Gateway API 时，同步更新 `lazy-bundles.ts`、映射测试，并验证真实鉴权路径。

## 8. 并发、恢复与边界

- Dispatcher 改为有上限的并发执行；每个 Task 默认仍只有一个活跃 root TaskRun。设置网关级并发和每个 Agent / Project 的限额，避免一个任务阻塞全部任务。
- 当前 `claimNext` 只领取 `queued` / 可恢复的 `waiting`，不会因为 `running` 的租约到期就自动重领。并发上线前必须接通 `heartbeat`、进程重启后的运行状态对账与明确的重试决策；不能仅缩短租约或直接重领，以免重复执行外部操作。不能把逻辑取消误写为外部执行已停止。
- 协作记录使用幂等键和因果 ID；事件至少一次投递下由 sequence 去重。
- 任务改派时使用 `assignmentEpoch` 隔离旧执行 Agent 的迟到汇报。旧记录保留审计，但不能改变新执行轮次的状态。
- 协作记录中的外部文本视作数据。主 Agent 根据 Task 权限和用户已给的范围行动；执行 Agent 的留言不授予新权限。
- 主 Agent 的“停止说话”“挂断”“停止 TaskRun”“关闭 Task”保持独立语义。

## 9. 推进阶段与验收

### 阶段 A：关联与可见性

完成主会话到 Task 的持久 origin 关联；消息引用实时刷新；Environment Context 任务摘要。验收：文字和语音派工后，消息引用与 Context 显示同一 Task ID；刷新、重连、任务改派后仍正确；历史消息正文不被覆盖。

### 阶段 B：协作记录、等待状态与双向指令

完成 schema、仓储、能力、outbox、可靠投递意图、执行 Agent 汇报提示、最终 receipt 自动记录及提问等待状态。主 Agent 可读进展、发问题和补充指令，执行 Agent 可确认并回复。验收：断线补读不漏不重；记录写入后进程崩溃仍能投递；版本冲突和改派后的迟到消息处理正确；问题、审批和普通进展不混淆。

### 阶段 C：实时汇报与后台并发

先完成 Dispatcher 心跳、重启对账，再开放有界并发；接入语音状态卡、下一用户回合摘要和挂断后摘要。事件主动触发语音播报作为后续独立切片。验收：主 Agent 在多个执行任务并行时仍可连续对话；普通进展不打断用户；待决定事项被准确呈现；挂断不停止任务；重启后任务和未读进展可恢复。

### 阶段 D：体验优化

用真实语音场景评估派工确认延迟、进度问答准确率、无谓播报率和重复执行率；再决定是否为自然语音引擎增加 Agent 工具桥接。首版不以更换语音模型作为前置条件。

## 10. 主要代码落点

- Task / TaskRun：`src/tasks/`、`src/storage/sqlite/`、`packages/gateway-contract/src/tasks.ts`
- Agent 工具：`src/agent/tools/xopc-use-tool.ts`、`src/agent/tools/factory.ts`
- 后台执行：`src/tasks/task-run-dispatcher.ts`、`src/gateway/service.ts`
- 语音：`src/voice/realtime/agentEngine.ts`、`web/src/features/voice/realtime/`
- 消息任务引用：`web/src/features/chat/product-delivery/`
- Context：`src/gateway/session-context-summary.ts`、`web/src/features/chat/context/session-context-panel.tsx`

## 11. 本次实现记录

- 阶段 A：Task 创建事务写入主会话关联；Agent 创建时使用运行时会话身份；派工消息和 Environment Context 使用同一 Task ID 显示当前状态。后续产品评审决定移除左侧任务分组，使左侧栏专注对话导航。
- 阶段 B：任务留言按 Task 内序号持久化；指令有待投递、已投递、已确认状态；执行 Agent 可汇报进展、提问并等待回答；最终 receipt 自动形成结果留言。回答只在当前执行回合结束后解除等待，恢复回合使用新输入 ID。
- 阶段 C：TaskRunDispatcher 限制并发并维持租约心跳；过期执行标记为中断并要求检查外部效果；语音通话展示后台任务卡，主 Agent 下一回合得到有界任务目录。
- 阶段 D：提供 `/api/tasks/orchestration-metrics` 汇总任务量、进展、问题、投递和延迟。真实语音派工延迟与进度问答准确率需要带可用语音服务的场景采样，不能从本地单元测试推断。

当前产品范围不包含事件主动打断主 Agent 的语音回合，也不包含 natural 模式的工具桥接；这两项按第 6、9 节留在独立切片。
