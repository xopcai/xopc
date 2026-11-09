# 长期观察会话：技术设计与落地计划

日期：2026-11-08。状态：A+B+C 主链已实施，具体范围、验证与首版边界见[实施记录](./long-term-observation-stage-abc.md)；D/E 仍为设计。本文描述目标方案，新增对象的最终实现以实施记录及源码为准。产品方案为工作台「交给我」v2。

## 1. 结论与边界

以现有 HomeIntelligence 为产品宿主，新增有持久身份的观察状态与增量处理。复用 SQLite、已有事件投影、记忆的证据/策略体系、Task 执行验收、Automation 调度以及 Home 实时刷新。无需新增常驻无限 Agent、消息中间件、向量库或第二套工作台。

观察会话是一个 domain aggregate，不等于普通聊天 transcript。稳定 observationSessionId 关联主题、原始源会话、反馈、试做和托管；可选 discussionConversationId 用于用户讨论。实际每次运行保留独立 taskRunId / automationRunId。

第一版处理已授权的 owner 私聊、任务回执、项目状态和显式反馈，不扫描任意屏幕。主链为事件驱动增量学习；周期任务仅恢复进度、清理与复核。以下新增类型、表、接口、执行器均为建议，不是现有能力。

## 2. 现有实现与真实缺口

| 已核查模块 | 当前能力 | 对本方案的作用与缺口 |
|---|---|---|
| `src/home-intelligence/host.ts` | 租约生成队列、指纹去重、上下文刷新冷却、调用/token 预算、建议动作与反馈、实时发布 | 作为宿主；目前围绕 bounded snapshot 生成建议，不是持久主题会话。5 秒 tick 是查队列，不是每 5 秒调用模型 |
| `src/home-intelligence/snapshot.ts` | 有界项目、未关闭任务、知识、最近会话元信息、证据 | recentSessions 只有标题/时间等元信息；不能据此声称理解了完整历史任务。关闭任务被过滤，不适合直接统计已完成重复工作 |
| `src/home-intelligence/repository.ts` | home_advice_generations、home_opportunity_projections、反馈、抑制、历史、修订检查 | 扩展稳定 topic 关联；短期 opportunity 不应拥有长期理解。当前 undo 会删除最新反馈，长期反馈改为修订/撤回记录 |
| `src/home-intelligence/application-service.ts` | start 创建 Task，有 expectedRevision / 幂等 / 证据新鲜度 / 风险检查；discuss 返回新聊天草稿链接 | 复用试做 Task；讨论需补稳定 topic 和 conversation 回链，不再只返回无后续关联的 draft |
| `src/memory-learning/service.ts`、`repository.ts` | 10 秒 worker、transcript 分段游标、空闲刷新、任务回执、失败重试、租约、事务提交进度 | 复用策略与调度基础；不能让观察与记忆共用 processed_seq，二者消费者完成进度不同 |
| `src/user-model/capture/`、`src/user-model/observation-repository.ts` | 用户要求解释、作用域、证据、敏感性、观察记录与断言调解 | 复用 evidence 和明确偏好晋升路径；工作流假设保留在观察主题，不把每条工作线索都写成全局用户事实 |
| `src/gateway/service.ts` | 事件摄取/投影，Task/Project 触发 Home 更新，transcript 事件桥，连接来源变更 | 接入观察 enqueue。transcript listener 为进程内通知，且自动化会话被过滤，不能作为唯一可靠数据源或结果反馈源 |
| `src/automations/events/` | 持久事件、投影与投递租约、去重、重试、dead letter、causation | 复用摄取与唤醒；投影仅事务入队，模型推理放独立 worker，避免阻塞其他事件 |
| `src/automations/service/` | 定时/事件/手动触发、快照、取消、deadline、重试策略、交付 | 保留一个调度器。agent 动作当前不自动重试；continuous 会话是执行连续性，不是观察状态 |
| `src/tasks/` | Task contract、run receipt、结果交付、Home query 和验收 | 作为试做/长期每周期执行的业务事实来源；读取状态与业务验收分开 |
| `web/src/features/tasks/home-advisor-card.tsx`、`use-home-snapshot.ts` | 建议卡片、证据、历史、操作；监听 home-advisor-updated / gap / reconnect 后重读 | 扩展同一个卡片。无需新长连接或浏览器扫描器 |
| `src/tasks/home-query-service.ts`、`web/src/pages/home-page.tsx` | 综合待决策、交付、后台运行和建议 | 在已有注意力治理下选一个当前事项，不增设竞争的第二个主推荐 |

补充：`src/work-discovery/` 面向项目来源调查与工作上下文；其中 thread-service 明确只返回当前发现的 bounded suggestions。可以作为输入适配器，不用它冒充长期观察存储。

源码当前 schema version 为 271（`src/storage/sqlite/schema.ts`），不同于较早说明中的 265。实施时以 HEAD 为准分配下一迁移版本，保留既有支持范围与升级链。

## 3. 贯穿链路

```text
SQLite 权威来源：transcript / Task receipt / Project / 显式反馈 / Automation result
  → 持久事件或游标补偿（不丢进度、不计重复）
  → Observation inbox：策略过滤、批次合并、来源身份校验
  → Observation worker：读取增量 + 有效反馈 + 主题摘要 + 必要原始证据
  → 事务提交：证据/主题修订/候选/日志/消费游标/卡片投影
  → home.advisor.updated → 已有 realtime bridge → useHomeSnapshot 重读
  → 用户在卡片补充、修正、试做
  → Trial Task → Task receipt → 观察会话继续积累
  → 用户确认执行约定 → Routine version + Automation
  → 到期运行 Task → 业务验收/产物/用户修改 → 新证据 → 改进候选
```

HomeIntelligenceHost 继续拥有产品投影与建议策略；新增 `src/home-intelligence/observation/` 管理 observation service/repository/worker/context-builder/reducer。后台解释器为无外部写权限的结构化模型调用，不能执行邮件发送、任意 shell 或创建自动化。

## 4. 持续扫描：可靠摄取与增量运行

### 4.1 启动与触发

- 用户开启观察：保存来源范围、隐私策略和回看起点，建立 observation session；首次最多回看 30 天，分批可恢复。
- `session.transcript.updated`：仅唤醒对应源游标，等待完整阶段或空闲片段，不能逐 token 入模型。
- `task.changed.v2`：区分生命周期变更与重试；优先读取最终 receipt，不把五次重试当五次独立任务。
- `project.changed/deleted`：更新适用条件或失效主题；结束项目不自动等同撤销用户约定，除非约定已有结束条件。
- 显式反馈：API 同一事务保存反馈和观察工作项，立即更新作用域/抑制规则，不等普通冷却。
- Automation 完成：通过 run/receipt 适配器摄取，不能依赖已经过滤 automation source 的 transcript listener。

新增 `observation.feedback.recorded` / `observation.updated` 等事件时在 event-catalog 注册严格 payload schema。事件内容只传标识、revision 和来源引用，避免广播原始私人文本。

### 4.2 可靠性

现有 Task 等业务写已有 domain_outbox；优先从其持久事件幂等投影 observation inbox。通知只负责加速。普通 transcript 的内存 listener 不能保证投递，恢复扫描以 `(conversationId, transcriptId, seq)` 为准。

观察独立保存 observedThrough / processedThrough；processedThrough、派生主题和输出必须在同一事务提交。每个消费者单独进度，禁止修改 memory_learning_cursors 来表示观察已经完成。短期复用现有 worker 的调度/租约模式，未来只有确实共享协议时再抽公共工具，不重写全套记忆执行器。

稳定去重键为 owner/workspace + source kind + immutable source id + source revision；任务独立实例采用 root task/run 或周期 id，revision 变化只更新实例证据。seq 按 transcript 隔离，reset 后处理新 transcript，并补完仍有积压的旧 transcript；删除来源立即撤销可读资格。

worker 领取 leaseEpoch；模型调用前记录 policyVersion、topicRevision、feedbackRevision、forgetEpoch 和 sourceThrough。返回后 CAS 检查所有相关版本；用户撤回/忘记/暂停或来源授权变化时，旧结果不得提交。新到来的普通事件只标 dirty，下一批再处理。

崩溃后租约到期重领，输出按确定性 batch key 去重；不能以墙钟时间构造 source dedupe key。事件至少一次，业务效果幂等，不宣称跨外部应用 exactly-once。

### 4.3 调度与预算（初始建议，需测量调优）

普通任务/会话变化采用约 60 秒空闲窗口合并；同一主题同一时刻最多一个模型更新，明确未来委托和反馈优先。后台最多一个观察模型调用，按实际调用/token/费用计费，和 Home 建议生成共享总预算，不是两个模块各自用满一份额度。

迁移期间把现有快照生成与观察生成设为单一建议生产者；旧 snapshot 仅为 fallback 的读取上下文，不并行产出互相覆盖的建议。现有 Home 30 分钟冷却用于普通建议刷新，不能阻塞反馈保存与控制动作。现有 daily budget 为 12 次 provider call / 120,000 tokens，应先评估是否适合观察负载，再配置化而非偷偷扩大。

无新证据只查进度，不调用模型。恢复、租约和过期维护可周期 tick，长期观察不绑定一个高频 agent automation。Gateway 未运行时不处理；启动后补偿。remote Gateway 运行时，即使浏览器关闭仍可观察。

## 5. 反馈记忆与数据模型

新增表尽量按职责拆分；下面是逻辑模型，非最终 DDL。

| 对象 | 关键字段与约束 |
|---|---|
| observation_sessions | id、ownerId、workspaceId、status、policyRevision、forgetEpoch、backfillFrom、lastProcessedAt；默认每 owner/workspace 一个活动会话 |
| observation_source_cursors | sessionId、sourceKind、sourceId、transcriptId/sourceRevision、observedThrough、processedThrough、resumeBoundary；唯一消费者/来源键 |
| observation_jobs | batchKey UNIQUE、leaseOwner/epoch/until、attempt、nextAttemptAt、状态、输入版本快照；按 session/topic 串行提交 |
| observation_topics | stable topicId、project/scope、goal、patternKey、hypothesis、validity、status、revision、摘要版本；UUID 是身份，模型措辞/hash 只作匹配线索 |
| observation_entries | session/topic、entryKind、evidenceRef、sourceRevision、因果关联、feedbackRef、before/after revision；append-only 逻辑事件，展示时可过滤失效或已忘记内容 |
| observation_feedback | id、topicId、原话、actor、intent、scope、validFrom/To、status、supersedes/retracts、evidenceRef、revision；独立于机会是否过期 |
| observation_exclusions | owner/workspace、主题/来源范围、排除原因、恢复条件、forgetEpoch；先过滤再提取，避免遗忘后重学 |
| routine_definitions / routine_versions | topicId、当前采用版本、不可变约定/方法版本、适用条件、完成标准、来源/能力引用、内容 hash、验证状态 |
| routine_executions | routineVersion、automationRunId、taskId/taskRunId、cycleKey UNIQUE、验证/用户反馈状态；串起整个执行因果 |

所有查询带 owner/workspace 与可读范围；现有 HomePrincipal 与 user-model principal 映射由代码确认，不能直接把单用户默认常量用作未来多用户隔离。

### 5.1 谁保存什么

- 观察域保存工作流假设、主题反馈、适用范围与演化状态，作为唯一权威。
- `context_evidence` 保存来源身份、hash 与必要片段，复用已有 provenance；原始全文仍在 transcript/任务/连接器源。
- 确认的跨工作长期偏好可通过 user-model 的 capture/reconcile 晋升；项目临时需求无需强行变成全局 assertion。
- 可复用项目事实、任务教训按知识的 write/sensitivity/scope 策略写 knowledge-memory；用 canonical key / derivedFrom 关联，不能双写两个彼此独立的真相。
- “不自动发送”是协作/执行约定；模型对用户偏好的猜测不是权限来源。工具门禁需代码执行，不能只靠 prompt。

卡片反馈先确定性落库；自然语言解释异步进行，低确定性解释呈现确认。`仅本次` 不更新 routine，`当前项目` 不推广到全部工作。相互冲突的明确要求进入澄清，不按最新时间静默覆盖所有范围。

现有 home_opportunity_feedback 继续记录点击/拒绝等行为，但通过 feedbackId 关联 topic 反馈，不靠它存长期记忆。旧 opportunity 过期不删除 topic 反馈。后续撤回应追加撤回记录，重新计算依赖项；不把旧 HTTP undo 的物理删除语义直接复制过来。

### 5.2 压缩与隐私

每轮上下文 = 受预算约束的新增片段 + 相关主题摘要 + 有效反馈/明确限制 + 未决问题 + 必要原始来源。摘要含 through cursor、feedbackRevision、策略和证据列表；不能把摘要当原始真相。

暂停观察提升 observation epoch、取消未提交解释，不影响 automation.enabled。恢复明确选择补看或跳过暂停区间，记录新的边界。forget 先提升 epoch 和排除，再撤销摘要/索引/建议/相关反馈派生，异步物理清理敏感片段；仅保留不含已忘记语义的删除审计。原始工作记录与已授权自动化分别控制，不能因 forget 悄悄停止或更改授权执行。

## 6. 自动化执行：试做、确认、周期与方法改进

### 6.1 试做

扩展 HomeOpportunityApplicationService.start，在 Task 创建事务中同时保存 topicId、proposalRevision、routineDraftVersion 和 task origin link。仍使用 Task contract 的 expectedOutputs / acceptanceCriteria / constraints，以及现有 capabilities preflight。生成私人草稿属于本次任务，不能隐式创建定时任务。

Task receipt 到达后生成结构化 observation outcome：平台运行状态、业务检查、证据缺口、用户修订分别记录。已读、工具成功、用户未反对都不算验收通过。

### 6.2 长期托管

确认 API 输入 expectedTopicRevision、expectedContractRevision、idempotencyKey 和用户明确认可的约定。后端重验来源/权限/能力、时区、预算、结束条件、与现有 routine 的重复，建立 routineVersion 与 automationId 关联。

推荐新增 AutomationAction `kind: 'routine'`，只包含 routineId 与版本绑定策略，不让模型生成任意执行器。需要同步修改 domain types、validation、gateway-contract、前端 schema、executor 和测试，不能只加一个 TypeScript 分支。默认每次启动固定 adopted version，排队后新采用版本不能静默改变已排队运行的快照。

routine executor 从不可变版本构造 Task，周期键 `(routineId, trigger occurrence/event id)` 唯一，并等待该 Task 的终态或明确人工等待状态，在 automation deadline / cancellation 协议内维护租约与回执映射。每个周期新建 Task；`task_command` 适合指挥既有任务，不可简单对已完成 Task 重复 resume 来实现周报。

不能用 system action “任务已入队”就把整次自动化标成功。若 Task 等待人工超出当前 run 生命周期，明确返回待处理状态并在统一 contract 增加关联/展示支持；第一版优先支持能在单次 deadline 内完成的私人草稿任务，超时沿用现有明确终态。

确认落库与调度不能跨异步操作假装一个事务。采用创建意图 + 同事务 routine/link/outbox，commit 后幂等创建/唤醒 AutomationService；dispatcher 执行前验证该 adopted version 已生效。失败显示 enabling/repairable 状态，重试不会创建第二个 automation。

### 6.3 执行反馈与副作用

每次运行关联 topic → adopted version → automationRun → taskRun → receipt → artifact → verification → user feedback。利用现有结果交付与回执作为唯一交付源，卡片只投影链接与状态，不复制产物。

暂停托管按现有服务禁用未来触发并处理排队/运行中取消，不能仅改前端状态。agent executor 当前 retrySafety 为 never；新 routine executor 仅对入队/读取等确定幂等步骤重试，外部业务副作用结果未知先对账。模板 hash、source grants 与能力版本在 dispatch 时重查，不能因曾试做成功而永久绕过检查。

观察器自身生成的摘要、系统建议、自动化运行不能作为独立的“用户需求重复”。它们标记 origin=observer/automation，只提供效果证据；真实用户独立请求、明确反馈才支持需求证据，避免自举形成越来越多的空转自动化。

### 6.4 方法自进化

先规则归因再模型提议：单次事实修正本次、长期要求修订约定、流程失败形成方法候选、环境故障修恢复。新 methodVersion 状态 draft → validating → proposed → adopted/rejected；用户采用与独立验证分别存储。

验证保持固定约束、适用边界和代表性旧案例不退步，有条件时保留未参与修改的新案例；没有历史真实状态就注明仅做可重建检查。候选生成器不能修改评分标准、执行权限或用户约定。回退只改变后续 adopted version，已经发生的外部写操作需单独补救。

Skill 是版本化方法的一种导出形式；第一版 SQLite 中的结构化 routine 为权威，Markdown 为可读导出，脚本为受控 artifact。避免首次发现就自动修改 live skill 目录；只有独立复用价值与验证成立后再发布 Skill，执行时 pin hash 防止中途替换。

## 7. 工作台、API 与 realtime

### 7.1 合同与组件

扩展 `packages/gateway-contract/src/home.ts`，在 HomeResponse 增加独立 `observation` 与 `handoff` 投影，不把 disabled/quiet/ready 等旧 advisor union 强行解释成观察会话状态。

observation 包括 sessionId、status、lastIngestedAt、lastProcessedAt、pendingCount、policyRevision、coverage 和不含私人明文的错误码。观察仍开启但 worker 为空闲时显示“等待新记录”；运行中的 skeleton 仅表示实际任务。

handoff 是服务端选择的一个当前事项，含 topicId/revision、kind（clarify/suggest/trial/result/improvement/attention）、可用动作、证据引用、当前操作进度。工作台已有任务异常仍由 HomeQueryService / AttentionGovernor 统一仲裁，不新增一套与全页主任务冲突的优先级。

扩展现有 HomeAdvisorCard，拆出 ObservationStatus、ObservationJournal、ScopedFeedbackComposer、RoutineContractSummary 等局部组件。继续复用 HomeTaskReview 和自动化详情页。用户正编辑时按 topicRevision 保存草稿，后台新建议不能覆盖输入，冲突时提示更新并保留用户文字。

现有 discuss 只有 chat_draft 链接；改为 backend ensureDiscussion(topicId)，创建或复用可追踪的普通 conversation，存 origin topic 与 revision。卡内文字走显式 feedback endpoint，复杂聊天的明确反馈才提取回主题；普通 assistant 输出不当成用户反馈。

### 7.2 拟新增 API

```text
GET  /api/home/observation                       状态/范围/进度
POST /api/home/observation/start                 创建/开启（含回看范围）
POST /api/home/observation/pause                 暂停观察
POST /api/home/observation/resume                catch_up / new_only
GET  /api/home/observation/topics/:id/journal     带游标的可读日志
POST /api/home/observation/topics/:id/feedback    原话/范围/意图/expectedRevision/幂等键
POST /api/home/observation/feedback/:id/retract   撤回并失效派生
POST /api/home/observation/topics/:id/forget      确认范围后排除与清理
POST /api/home/observation/topics/:id/discussion  创建/复用普通讨论会话
POST /api/home/observation/topics/:id/trial       复用 Task 创建路径
POST /api/home/observation/topics/:id/adopt       确认版本与执行约定
POST /api/home/observation/topics/:id/method      采用/回退具体版本
```

路径是建议，实施时可合并 control command。均使用 owner/workspace scope、strict Zod schema、idempotencyKey、expectedRevision；409 返回当前 revision，前端保留输入。GET 不做模型推理或副作用。暂停/结束托管继续走现有 automations API。

`/api/home` 已有 lazy bundle，但仍需补每个新 route family 的正向和邻近负向映射断言，跑真实鉴权 Gateway 请求，不能只测 route 模块。

提交卡片投影后沿用 `home.advisor.updated`，payload 提供 observationSessionId/topicId/revision 与刷新原因，不携带整段记忆。前端沿用 realtime bridge 和 useHomeSnapshot，重连/gap/focus 时重读快照。高频队列内部变化合并发布，业务反馈与控制完成立即发布。

## 8. 落地顺序与可验收结果

| 阶段 | 交付 | 验收门槛 |
|---|---|---|
| A：持久观察基础 | session/topic/独立游标/job/exclusion、来源策略、事件适配、暂停恢复、无模型的观察进度卡片 | 离线后补齐、重复事件不加证据、reset 不串 seq、暂停后旧 worker 不能提交 |
| B：反馈与有界理解 | 结构化反馈、原话/范围、撤回/忘记、上下文构造、观察日志、单一 Home 建议生产者 | “仅本次”不晋升；发布期纠正跨压缩/重启保留；忘记后不重学；隐私策略全程生效 |
| C：试做与卡内闭环 | 复用 Task、稳定 discussion 关联、contract 草稿、结果回链、工作台投影 | 从建议到一份可查看私人草稿，业务检查与运行状态区分，取消/重放不重复任务 |
| D：长期执行 | routine 版本、routine executor、启用 outbox、周期幂等、Automation 交付/取消/异常 | 确认后真实触发；每周期单一 Task；暂停/重启/能力失效/结果未知可恢复且不重复写 |
| E：受验证改进 | 修改归因、candidate/validation/adopted 分离、版本比较与回退、效果观察 | 旧约束不退步；一次成功不冒充长期有效；无收益可拒绝，队列版本固定 |

依赖 A → B → C → D；E 的离线评估可在 C 后准备，但自动采用不得早于 D 的版本/约束机制。每阶段一个独立可回退交付，不承诺未经估算的日历工期。

最小发布切片为 A+B+C：观察 → 反馈 → 更准确的建议 → 试做结果。这已经体现连续价值，D 前只允许手动试做，不给用户一个“已启用”但无法可靠运行的开关。

## 9. 验证、迁移与运维

- SQLite：增量 migration、fresh schema、Node/Electron 迁移资产；覆盖既有支持起点（包含 v217 baseline）到新版本，不缩短升级链，不在设计阶段直接升级用户本地数据库。
- 单元/存储：CAS、lease fencing、游标事务、重复/乱序/迟到事件、feedback scope/retract、forget epoch、来源撤权与项目删除。
- Worker 集成：保存源后通知丢失、模型返回前崩溃、反馈与模型竞争、budget 用尽、local_only 无本地模型、暂停恢复补看/跳过。
- Gateway：真实 listener + authentication 测完整 `/api/home/observation/*`；越权、409、幂等返回、lazy bundle、realtime gap 重建。
- 执行集成：试做与每周期任务不同；运行超时/取消/重启时不得报告假成功；入队不等于完成；未知副作用不能自动重放。
- 前端：组件覆盖整个路径与输入保留，skeleton、错误/暂停/遗忘状态、窄屏、键盘、i18n；复用项目 select 与语义 token。
- 离线质量：按时间切分历史样本，有真实 owner 标注与临时/重试/结束项目反例，比较有无长期反馈的后续推荐质量，不用评估集反复调优。
- 可观测：ingestion lag、pending age、lease retries、source coverage、feedback adoption/retraction、suppression hit、调用/token/cost、trial quality、接管/纠正、重复副作用。日志用稳定 `HomeObservation` 前缀、对象优先、bounded preview，不打印完整私人反馈。
- 灰度：单一 observation enable 控制生产者切换，shadow 模式不发推荐和通知；保留旧快照读模型供回退，但不允许双写长期理解。关闭功能后保留可读历史，已有明确授权托管保持可管理。

## 10. 第一批实现文件建议

新增：`src/home-intelligence/observation/{types,repository,service,worker,context-builder,source-adapters,feedback-service}.ts`；routine domain/executor 位置随 D 阶段确定，避免提前铺空接口。

修改：Home host/snapshot/application-service/repository、Gateway service/home routes/lazy-bundles、gateway-contract home/automations、memory-learning 的可复用证据出口、Automation executor 与 validation、Task origin/receipt 关联、HomeQueryService、HomeAdvisorCard/home-api/useHomeSnapshot 和对应测试。

正式开工先完成 A 的 migration/事务测试与一条真实 transcript → topic → Home 状态链，再逐步扩大来源；不从全量改 prompt 或直接生成几十个 Skill 开始。
