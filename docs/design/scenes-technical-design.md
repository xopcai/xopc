# 场景系统技术设计与实施方案

状态：实施中；本文是目标设计，不是已实现能力清单。日期：2026-09-19。具体交付、review 和剩余工作见 [实施记录](./scenes-implementation-progress.md)。

产品依据：[场景产品北极星](./scenes-product-north-star.md)。本文确定实现边界、协议、直接切换和验收方案；此前 Proactive 平台提案中的兼容适配、旧入口转发和双轨演进不再适用。

## 1. 核心决定

1. 场景是用户对 Personal AI 的一项持续委托，覆盖工作与生活；不是定时 Prompt 的新名字。
2. Proactive 是主动帮助的产品行为，Heartbeat 是周期检查的实现方式；二者不再作为两个独立产品或运行时存在。
3. 时间、连接器变化、领域变化和用户操作产生统一事件；场景决定是否执行，执行产生结果，结果再决定是否行动和打扰。
4. 新增一个 `src/scenes/` 领域，直接替换 `src/proactive/` 和助理巡查用途的 HeartbeatService。不建立 legacy adapter、双写、旧 API 别名或长期旧数据 reader。
5. 复用 Agent、Workflow、Task、Connector、通知和 SQLite 基础设施，但不继承旧链路的隐式权限。能力复用不等于接口兼容。
6. 首发为单 Gateway、单 SQLite 的持久运行时；不引入分布式事件总线、独立调度服务、通用编排 DSL 或第三方代码沙箱。
7. 第一版正式上线就是新运行时。开发里程碑可以分开，旧运行时不能作为新产品的线上过渡执行器。
8. 分享的是声明式模板，不是用户的私人委托实例、账号授权或执行历史。

## 2. 当前基线与替换边界

以下是实施前仓库的设计输入；其中旧实现已删除，当前状态见实施记录。

| 现有能力 | 当前位置 | 决定 |
| --- | --- | --- |
| 场景定义、订阅、Prompt 修订 | `src/proactive/scenarios/` | 转为模板版本和 Activation；删除旧服务与类型 |
| 事件、聚合、运行、上下文校验 | `src/proactive/events/`、`routing/`、`execution/` | 提取可靠性逻辑进入新领域，不保留旧执行入口 |
| 时间扫描与邮件跟进 | `src/proactive/temporal/`、`follow-ups.ts` | 转为统一时机及 WorkItem，不保留第二个扫描器 |
| Inbox、摘要、投递、反馈 | `src/proactive/inbox/` | 场景语义迁入结果层；通用投递移出场景领域 |
| 项目任务创建 | `src/proactive/actions/service.ts` | 后续若开放外部动作再实现；首发不承诺场景自动创建任务 |
| 周期巡查与 HEARTBEAT.md | `src/gateway/heartbeat/service.ts` | 删除旧巡查，首发不导入历史文件，也不承诺日常巡查模板 |
| 自动化计划、Agent/Workflow 执行 | `src/automations/`、`src/workflows/` | 保留独立用户自动化；提取纯计划计算等基础件，场景不是隐藏 Automation |
| 用户工具与页面 | `xopc_use` 的 proactive 模式、`/assistant-work`、Heartbeat 设置 | 替换为 scene 模式、场景入口和详情，不保留跳转别名 |

当前 Proactive 使用受限只读执行器；Heartbeat 可以进入常规 Agent turn。这种权限差异不能通过“统一调用 Agent”直接带入新系统。新执行器必须由宿主注入场景权限约束。

网络保活、WebSocket 心跳以及被其他功能使用的通用静默标记，不属于删除范围。现有独立 Automations、Workflow、Task 和 Connector 也不是 legacy。

## 3. 用户闭环与架构

```text
场景模板 → 开启及授权 → 我的场景（Activation）
                             ↓
领域/连接器/时间/手动 → 持久事件 → 匹配与合并 → TriggerIntent
                                                ↓
                              授权与新鲜度检查 → SceneRun
                                                ↓
                                  Agent / Workflow 执行
                                                ↓
                                    校验 → SceneOutcome
                                             ↙       ↘
                            Effect 提议/审批/执行      呈现策略
                                      ↓                ↓
                               回执与对象变化     对象内结果/Inbox/通知
                                      └────→ 价值证据与下一次时机
```

有结果不等于要通知，批准动作不等于动作已成功，任务执行成功也不等于用户获得价值。

模块职责建议：

| 模块 | 责任与依赖限制 |
| --- | --- |
| `scenes/templates` | 内置模板加载、校验、版本固定；不访问用户凭据 |
| `scenes/activations` | 用户目标、范围、设置、权限和生命周期 |
| `scenes/events` | 持久事件、来源身份和匹配；不调用模型 |
| `scenes/scheduling` | 计划实例、重启恢复、合并、防循环 |
| `scenes/execution` | 租约、快照、执行预算、结果校验 |
| `scenes/outcomes` | 成果、证据、更新、撤回、采用反馈 |
| `scenes/effects` | 动作计划、审批绑定、执行账本与回执 |
| `scenes/presentation` | 决定结果放在哪里及是否需要通知 |
| 通用通知模块 | 渠道投递、摘要、预算、回执，不反向导入 `scenes` |
| Gateway / Web / Agent tools | 调用应用服务，不直接修改领域表 |

## 4. 领域对象：区分长期委托与一次执行

| 对象 | 核心字段 | 约束 |
| --- | --- | --- |
| TemplateVersion | key、version、manifest、contentHash | 发布后不可变；Activation 固定版本 |
| Activation | id、ownerId、workspaceId、templateRef、goal、scope、inputs、policy、revision、status | 用户自己的持续委托；修改使用 CAS |
| WorkItem | id、activationId、subjectRef、phase、nextReviewAt、status | 一封待回复邮件或一个阶段；无需强制创建 Task |
| Event | id、source、sourceEventId、occurredAt、receivedAt、scope、subjectRef、revision、causationId | 来源去重；载荷优先使用引用 |
| TriggerIntent | id、activationId、triggerKey、occurrenceKey、eventRefs、dueAt、status | 一次被接纳的执行时机，而不是每条原始事件 |
| Run | id、intentId、activationRevision、templateRef、snapshotRef、attempt、leaseEpoch、status | 一次逻辑运行，重试更新 attempt，不重复生成逻辑运行 |
| Outcome | id、runId、workItemId、kind、evidence、payloadRef、supersedesId、status | 有证据的真实结果；可以被撤回或取代 |
| Effect | id、outcomeId、handler、planHash、target、approval、idempotencyKey、status | 外部动作独立于推理重试 |
| Presentation | id、outcomeId、destination、reason、status | 同一结果可以有多个呈现，但不是多个成果 |

`ownerId` 是从宿主认证解析的稳定主体，不另建账号系统；即使当前单用户运行也显式记录。`workspaceId` 是数据边界，`subjectRef` 是业务对象引用。家庭是生活场景范围，不自动成为多人共享租户；访问孩子、伴侣或家庭成员的数据仍需要合法来源和明确授权。

Scope 初始支持 `personal`、`project`、`conversation` 和明确对象集合；连接器账号绑定是独立授权维度，不能由 workspace 或邮箱字符串推断。家庭试点可用 personal 范围内用户主动提供的安排，不要求预先实现家庭账号系统。

开放式场景增加 `goalMode: finite | ongoing`、阶段目标、约束和 `reviewPolicy`。完成一个 WorkItem 不终止 ongoing Activation；暂停、休息或调整目标都是合法结果，不以制造任务维持活跃。

生命周期：

- Activation：`needs_setup → active ↔ paused → completed | archived`。依赖失效可转回 needs_setup，并解释原因。
- Intent：`pending → claimed → resolved | cancelled`；无变化也是 resolved。
- Run：`queued → running → succeeded | skipped | retry_wait | failed | cancelled`。等待用户批准是 Effect 状态，不长期占用 Run 租约。
- Outcome：`current → superseded | withdrawn`，追加版本和理由，不静默覆盖历史。
- Effect：`proposed → awaiting_approval → approved → executing → succeeded | failed | unknown | cancelled`；受窄范围自动授权的动作可以跳过 awaiting_approval。

## 5. 模板契约与开启流程

第一版模板是仓库内声明式资源，不引入执行任意 JavaScript 的场景插件。下面是目标契约示例，字段不是现有 API：

```yaml
schemaVersion: 1
key: weekly-family-plan
version: 1.0.0
title: 提前准备下周家庭安排
goalMode: ongoing
inputs:
  timezone: { type: timezone, required: true }
  reviewTime: { type: local_weekly_time, required: true }
context:
  - provider: user_notes
    required: true
  - provider: calendar
    required: false
triggers:
  - id: weekly-review
    type: schedule
    scheduleInput: reviewTime
  - id: relevant-change
    type: event
    eventType: calendar.event.changed
execution:
  kind: agent
  instructionRef: prompts/weekly-family-plan.md
  skillRefs: []
  limits: { timeoutSeconds: 90, maxIterations: 6 }
outputs:
  allowedKinds: [no_change, artifact, decision]
effects:
  allowedHandlers: []
presentation:
  default: inbox
  interruptWhen: decision_required
```

宿主注册输入类型、事件类型、Context Provider、Effect Handler 和有限条件操作符。Manifest 只能引用注册能力；不允许任意表达式求值。Skill 提供方法与约束，不创建另一套 Agent 运行时。

开启流程：展示“能替你做什么”及示例 → 收集最少输入 → 校验数据连接与账号 → 展示执行/打扰边界 → 用户确认 → 持久 Activation → 可选真实试用。未绑定 Calendar 时，不订阅日历变化，只使用用户笔记；不得假装已读取日历。

试用分两种：样例演示不读私人数据、不计真实价值；真实试用读取授权数据并产生结果，但默认不执行外部 Effect。只有真实来源和真实用途符合价值口径。

升级：固定模板及 Skill/Workflow 的版本或内容哈希；模板更新不静默改变已开启场景。新增数据范围、写操作或预算需要重新确认。未知 schemaVersion 明确拒绝，不添加 legacy parser。分享导出只包含声明、通用资源和依赖，排除凭据、实例输入、私人修订和运行历史。

## 6. SQLite 持久化与事务

表结构、资源读取与迁移统一归属 `src/storage/sqlite/`。场景与通知运行时不创建表，不保留独立 schema 加载器。当前 SQL 放在 `schemas/`；普通版本升级清空未使用的旧实验数据并初始化新表，不导入旧历史、不建立快照或配置 journal。Node 与 Electron 从本次源码复制同一 SQL 树，使用统一资源定位，不从旧构建兜底取 SQL。

通用通知通过宿主注入领域投递策略，不导入场景或旧 Proactive。旧领域的通知实现必须与旧运行时整体删除；不得留在通用通知目录成为隐式依赖。具体复查及落实情况见[架构复查](./scenes-architecture-review.md)。


建议首版表组如下；实际 migration 编号在实现时按主干分配，不预占当前正在开发的编号。

| 表组 | 唯一键/索引与用途 |
| --- | --- |
| `scene_template_versions` | UNIQUE(key, version)，manifestHash |
| `scene_activations`、`scene_work_items` | owner/workspace/status 索引；WorkItem 的业务相关键防重复 |
| `scene_events` | UNIQUE(source, sourceEventId)，receivedAt、scope 索引 |
| `scene_trigger_intents`、`scene_intent_events` | UNIQUE(activationId, triggerKey, occurrenceKey)，事件关联去重 |
| `scene_schedule_cursors` | UNIQUE(activationId, triggerKey)，nextDueAt、revision |
| `scene_runs`、`scene_context_snapshots` | UNIQUE(intentId)，leaseUntil、epoch、retryAt；快照带保留期限 |
| `scene_outcomes` | runId、subjectRef、status、语义相关键及 revision |
| `scene_effects` | UNIQUE(idempotencyKey)，planHash、externalReceipt、unknown reason |
| `scene_presentations`、`scene_feedback` | UNIQUE(outcomeId, destination, revision)，价值证据去重 |
| 通用通知表及 outbox | 沿用有效渠道能力，去掉 proactive 命名与反向领域依赖 |

既有 Inbox 数据迁入新结果/呈现模型，不另做两个 Inbox。交付物引用现有文件、任务、项目或交付物对象，不再把大文件复制进 outcome JSON。

事务边界：

1. 同库领域变化与待发布事件同事务落库；生产者不得只发内存消息。连接器以源事件 ID/修订生成确定去重键，先存事件再推进同步游标。
2. 匹配事件、写 Intent/关联、推进处理游标同事务，崩溃可重做。
3. claim Run 使用条件更新并递增 leaseEpoch；每次续租、写结果和提交终态都校验 epoch。过期 worker 不能提交结果。
4. Outcome、待执行 Effect 和 Presentation outbox 原子提交。SQLite 事务外调用模型、连接器和通知服务。
5. 外部动作成功后写回执；崩溃窗口由幂等键或查询回执恢复，不能靠事务幻想跨外部系统 exactly-once。

## 7. 事件、时间和执行去重

事件源：`manual`、`schedule`、`domain`、`connector`；Webhook 后续作为认证后的事件接入方式，不允许请求直接指定用户或扩大范围。

匹配采用事件类型 + 授权范围 + subjectRef + 注册条件。先做确定性过滤，再决定是否值得花模型预算。重复触发、空清单、超预算和无有效上下文均可以产生解释性 skipped 记录，不调用模型。

时间规则：

- 持久记录时区、计划定义、nextDueAt 和计划 revision，时间计算复用或抽取自动化纯函数；运行所有权仍归场景。
- occurrenceKey 使用 triggerId、计划 revision 和具体 UTC 触发时刻，不使用“这周”等模糊文本。
- DST 默认：不存在的本地时间移至当日下一有效时刻；重复本地时间只执行一次。此策略由计划库测试固定并在设置中解释。
- 重启补偿默认 coalesce：过期窗口内至多补一次，超过有效期 skipped。单次截止类场景可选择明确的 catch_up_once；禁止无限补跑。
- debounce 和 maxWindow 持久化，避免进程重启重新开启无限等待窗。
- 会议改期、邮件已回复、对象归档时取消对应旧时机；执行前再次确认业务条件。
- 事件带 correlationId、causationId、originActivationId 和 depth；默认忽略自身 Effect 产生的同类触发。允许的后续阶段也有深度和每日预算上限。

同 Activation 默认最多一个运行；同 WorkItem 的事件在等待期间合并。不同对象有需要时才开放有上限并发。新的关键变化在当前运行后排一个 follow-up intent，不在运行中无边界追加上下文。

## 8. 执行、授权与新鲜度

首版必须支持受控 Agent executor；只有被首发场景需要的 Workflow 才进入同次上线，否则后续补充。两者都使用现有执行基础件，不使用旧 ProactiveExecutor 或 HeartbeatService 包装。

每次运行构造 ExecutionEnvelope：主体、Activation revision、模板哈希、对象范围、连接器 account IDs、允许读取能力、允许 Effect handlers、预算、deadline、取消信号和 correlationId。

权限取交集：宿主权限 ∩ 当前用户连接器授权 ∩ Activation 许可 ∩ 模板请求。Prompt、Skill、事件正文、网页和邮件内容都不能授予权限。

执行边界要求：

- Agent 仅获得范围化读取和“提议 Effect”工具，不直接获得 send_message、任意 shell、任意写入或无约束连接器工具。
- 所有子 Agent 和 Workflow 节点继承同一或更小的 envelope；不能通过嵌套执行重新拿到默认工具集。
- 无法在工具层执行此约束的执行路径不能用于场景，不能靠 Prompt 替代。
- 预算至少含超时、迭代次数、工具调用数、模型 token/估算费用；分别按 Run、Activation、主体统计。
- 快照记录授权版本、源对象修订、证据引用和 freshness 时间；提交结果前重新校验。敏感原文只按最小必要保存并支持到期清理。
- 场景暂停、归档、撤权或修改范围时取消未启动 Intent，取消运行信号并使旧 envelope 失效；晚到结果不得发布。
- 实际执行 Effect 前再次检查最新授权和源状态。可查询来源却查询失败时视为未知，不能当作“没有变化”。

生活领域边界作为模板及宿主双重约束：不推断对第三人的访问权，不自动代替亲子互动或关系表达，不把健康管理场景包装成诊断；高后果操作不因日常委托获得自动权限。

## 9. 结果、动作和注意力治理

Outcome 类型：`no_change`、`observation`、`artifact`、`decision`、`state_change`、`effect_proposal`、`receipt`。`state_change` 必须来自已提交内部领域操作，`receipt` 必须来自真实执行回执；模型不能自行声称动作完成。

每个非 no_change 结果至少包含：对用户有何帮助、发生在哪个对象、证据、生成时间/有效期、是否需要用户决定。不同 Run 对同一事项的更新使用相关键聚合，不刷出重复卡片。

Effect 审批绑定 `handler + account + target + normalized payload + source preconditions + activation revision` 的 planHash，保存审批者、到期时间和消费状态。收件人、内容、账号或关键上下文变化使原审批失效。用户批准“准备回复”不等于批准发送回复。

Effect Handler 注册接口职责：validatePlan、authorize、execute、可选 reconcile。自动执行只对明确低风险动作开放；首发以现有 create_project_task 为候选，发送消息等另行启用。

外部系统支持幂等键则使用稳定 Effect ID；不支持时先持久 executing，超时后进入 unknown，优先查外部回执，无法查证则交给用户核实，禁止自动重发。Run 重试不能重放 Effect。暂停无法撤回已发出的外部请求，UI 必须如实呈现其最终或未知状态。

通知流程：结果资格 → 用户/场景偏好 → 安静时间 → 合并/摘要 → 预算 → 渠道能力 → outbox。静音不暂停工作，暂停工作也不删除成果；无变化默认不新增 Inbox 卡片或通知。

通知 deliveryId 在渠道侧幂等；无法确认是否发送的状态保留 unknown，不无限重试。通知链接只能打开有权限的结果。锁屏推送默认不带敏感家庭、健康或沟通内容。

## 10. API、工具和界面

目标 REST 契约（版本一，无旧接口别名）：

| 接口 | 作用 |
| --- | --- |
| `GET /api/scenes/templates`、`GET /api/scenes/templates/:key/versions/:version` | 模板发现与详情 |
| `POST /api/scenes/preflight` | 输入、账号、权限和依赖检查，无写操作 |
| `POST /api/scenes/activations` | 开启场景，支持客户端幂等请求键 |
| `GET /api/scenes/activations` | 按状态和范围分页列出我的场景 |
| `GET/PATCH /api/scenes/activations/:id` | 查看、CAS 更新目标/设置/状态 |
| `POST /api/scenes/activations/:id/checks` | 创建手动 Intent，受去重和预算约束 |
| `GET /api/scenes/activations/:id/runs`、`GET /api/scenes/runs/:id` | 历史、原因、来源及失败解释 |
| `GET /api/scenes/outcomes`、`GET /api/scenes/outcomes/:id` | 结果聚合及详情 |
| `POST /api/scenes/outcomes/:id/feedback` | 采用、纠正、不相关、负担变化证据 |
| `POST /api/scenes/effects/:id/decision` | 批准/拒绝指定 planHash，服务端复核身份 |

若复用宿主已有审批服务，Effect API 调用该服务而非新建第二套审批语义。禁止 LLM 自己调用批准接口来冒充用户确认。

HTTP 409 表示 revision/plan 冲突，403 表示无权限，422 表示配置不完整，429 表示预算限制。列表游标分页；所有入口由服务端解析 owner/workspace，不能信任请求体中的主体身份。

`xopc_use` 使用 `mode=scene`：discover、start、inspect、update、check、results；写操作复用同一应用服务，确认规则与 UI 一致。删除 proactive 模式及其手册。

用户界面：`/scenes` 提供发现与我的场景，`/scenes/:activationId` 展示承诺、范围、状态、最近成果和控制；结果仍可回到项目、邮件、对话或 Inbox。不要求用户先进入管理页。Heartbeat 设置改为日常巡查实例，不展示调度技术术语。

新 REST 路由必须更新 `src/gateway/hono/routes/lazy-bundles.ts` 及映射测试，并通过真实鉴权 HTTP 验证。Realtime 事件统一为 scene.activation.changed、scene.run.changed、scene.outcome.changed、scene.effect.changed；Web、移动端、Agent 手册、通知 deep link 和 service worker 同批更新，旧 REST/路由返回正常的未找到，不转发。

## 11. 直接切换与 legacy 删除

### 11.1 原则

没有运行时向后兼容。旧 Proactive／助理 Heartbeat 尚未被用户使用，已明确取消历史保留要求。删除实验数据，不构造历史 Activation、Run、Outcome 或私人说明。

### 11.2 数据与配置清理

- 使用普通 SQLite 版本升级，在同一事务内清理旧实验数据、初始化当前表、更新版本；失败回滚，重启重试。
- 已升级安装不重复清理，新场景数据跨重启保留。
- 旧场景通知及其回执／投递记录一并清理，不能重放；无关通知保留。
- 废弃 Heartbeat 配置在 schema 解析时忽略，错误类型也不阻塞启动；正常保存时移除。用户清单文件不扫描、不导入、不删除。
- 不清空整库，不影响聊天、项目、连接器和账号等其他功能；其他已发布功能的 migration 链继续保留。
- 删除转换器、映射、对账、快照、journal、恢复命令、导入专用表与历史 UI，不保留备用路径。

### 11.3 发布顺序

1. 在 workers 启动前执行普通数据库升级；事务失败不启动依赖新表的 worker。
2. 正式宿主、事件生产者、工具和客户端成套替换，删除旧执行器。
3. 删除旧表结构必须与最后一个运行时调用者的删除同批进行；当前过渡代码仅清空旧数据，避免正式 Gateway 缺表崩溃。
4. 验证新装、旧数据与旧配置、失败重试、重复启动，以及更新后的打包产品启动。
5. 启动新运行时，只接纳新委托与新事件；不恢复旧权限或旧发送任务。

### 11.4 必删清单与完成证据

- 删除 `src/proactive/` 旧实现、旧 repository/type/export，以及仅支持该链路的测试 fixture；有价值的测试场景迁入新领域。
- 删除助理巡查 HeartbeatService、独立 timer/wake/delivery worker、其 Gateway wiring 与专有配置。
- 删除 `/api/proactive/*`、`/api/internal/proactive/*`、旧 judgments 协议、Heartbeat trigger/文件编辑专有接口和 lazy-bundle matcher。
- 删除旧页面、`/proactive` 跳转、`/assistant-work` 旧入口、Heartbeat 设置和旧 Agent 工具模式；所有客户端同步改动。
- 删除 `proactive_*` 和助理巡查专有旧表在新 schema 中的定义、seed 与运行时引用；通知通用表使用独立当前结构。
- 删除“先走旧实现”“新模型回退旧格式”的 feature flag、双写、条件 import 和兼容参数。
- 旧设计文档可以保留为明确标注的历史决策材料，但不能继续作为实施依据；用户文档不得保留失效操作指南。

删除以调用图/引用检查和测试为准，不按字符串全仓替换。网络 heartbeat、通用 notification/token 与历史 migration 中的旧名称允许在明确清单内保留。当前工作区其他 Connector、多账号和导航改动不是本次删除对象。

## 12. 分阶段实施：开发拆分，切换一次

| 阶段 | 交付 | 门槛 |
| --- | --- | --- |
| T0 契约与初始化验收 | 冻结字段、状态机、权限矩阵，准备旧状态清理 fixture | 旧实验数据丢弃，旧配置不阻塞启动，新数据重启保留 |
| T1 单场景纵向新链路 | 邮件跟进：事件→WorkItem→受控 Agent→结果→Inbox；最小 Web 管理与可观测性 | 重启/重复事件/已回复/撤权均正确；新链路只用测试或隔离数据 |
| T2 首发候选与完整切换 | 会议准备、项目风险、日常巡查、家庭安排试点；统一通知、首个低风险 Effect；新 API/UI；删除 legacy | 初始化、渠道验收、全客户端、可靠性测试全部通过，首次正式发布 |
| T3 模板产品化 | 官方目录、模板导入导出、固定版本、升级审查、所需 Workflow executor | 不理解 Prompt 的用户能开启并获取真实帮助 |
| T4 受控开放 | 创作者工具、签名、评测与经验证的扩展点 | 不可绕过宿主权限，不携带私密实例数据 |
| T5 授权内个性化 | 推荐及有限参数调整，长期目标回顾 | 减少负担而非增加消息和确认数量 |

T1/T2 是同一新实现的研发增量，不通过线上 legacy adapter 临时交付。若首发范围过大，可减少首发模板数量，但不能以保留旧引擎作为减量方案；旧实验实例直接丢弃。

不在首发建设：通用可视化 DAG 编辑器、第三方执行代码、跨用户家庭共享权限系统、无限自主目标追求、自动替人经营关系、跨设备分布式调度。长期需要时按第二个真实场景驱动抽取。

## 13. 测试、可观测性与价值验收

### 13.1 必须通过的测试矩阵

| 类别 | 案例及断言 |
| --- | --- |
| 持久事件 | 重复/乱序/游标写入崩溃：只接纳一次，不丢事件 |
| 调度 | 时区、DST、改期、重启、过期窗口：按明确策略执行且不补跑风暴 |
| 租约 | 两个 worker 争抢、旧 worker 晚提交：只有当前 epoch 能写结果 |
| 权限 | 撤账号、改范围、暂停、子 Agent/Workflow 绕行：不能读取或发布越权结果 |
| 结果 | 同一邮件更新、引用删除、来源查询失败：更新/撤回/标记未知，不伪造新事实 |
| 动作 | 重复批准、改收件人、审批过期、执行超时、回执丢失：不重复执行且 unknown 可解释 |
| 通知 | quiet hours、静音、预算、摘要、渠道超时：无变化静默，不重复发送 |
| 数据初始化 | 旧实验数据／配置不阻塞启动、事务失败重试、重复启动不清空新数据、无关数据保留 |
| HTTP/UI | 真实鉴权+lazy bundle、跨主体访问、旧 API 404、客户端深链接：入口一致 |
| 生活试点 | 无项目/Task 也能运行，阶段完成不终止长期委托，允许休息/跳过 |

单元测试使用可控时钟；集成测试使用真实临时 SQLite。升级演练不连接真实外部写接口。端到端至少覆盖一次真实授权读取和测试账号的受控 Effect，对渠道不确定状态有故障注入。

### 13.2 运行观测

结构化日志统一记录 activationId、intentId、runId、effectId、correlationId、phase 和有限原因码，不记录敏感正文/凭据。看板覆盖事件延迟、待执行深度、租约过期、Run 成本、Effect unknown、通知重复率和初始化失败。

每次不执行/不通知都有可查询理由，例如 empty_input、no_relevant_change、stale_source、needs_permission、paused、budget_exceeded、quiet_hours；不用模型自由文本代替状态码。

### 13.3 产品验收

北极星沿用 WSVR，不以执行次数作为成功。记录 `activation_started`、`real_trial_completed`、`outcome_adopted`、`effect_confirmed`、`burden_feedback`、`interruption_dismissed` 等最小证据，带版本和去重 ID。

采用信号与已验证价值分开：打开、点赞、导出本身不是充分证据。首发通过访谈/明确反馈验证准备成果是否实际使用、动作是否真正完成、判断和返工成本是否降低；敏感生活内容不进入默认遥测。

上线门槛是用户能说清楚“它持续替我管哪件事、做到哪里、给了什么帮助、怎么停”，且初始化、权限和幂等测试全部通过。具体转化率与 WSVR 目标在试点建立基线后制定，不凭空承诺百分比。

## 14. 实施启动检查表

- [ ] 核定首发模板范围及一个无工作对象依赖的生活试点。
- [ ] 完成旧 API/客户端/表/后台 worker 的穷尽引用清单。
- [ ] 审核当前 Connector 多账号权限接口，落实到 ExecutionEnvelope。
- [ ] 确定首个 Effect 的自动授权边界；未批准的写能力默认关闭。
- [ ] 实现并演练旧实验数据清理、旧配置忽略和重复启动。
- [ ] 冻结 schema/API 合约，再开始 T1 纵向实现。

旧运行时及其表结构在 T2 同批删除，验收以本方案的必删清单为准。研发阶段的隔离 schema 和测试不表示生产链路已经完成切换。
