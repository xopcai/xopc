# 自动化可靠性与业务接入契约

日期：2026-09-26  
状态：已实现  
优先级：P0  
关联：[Automations](../automations.md)

实现范围：R0–R4 已落地。Event、Run、Result 与每个 Destination 均使用独立持久状态；Executor 明确声明重试安全性；DLQ、授权恢复、指标、Doctor 检查和生命周期清理已接入。`gateway_event` 与 `webhook` 为内建 Adapter，File/Card 契约已冻结并可通过 Router 注册，不在核心调度器中增加业务分支。

## 1. 结论

下一阶段不继续增加 Trigger、Action 或 Delivery 类型，而是先完成自动化平台的可靠性闭环，并冻结业务接入契约。

目标链路保持不变：

```text
Business mutation / User request / Schedule / Webhook
                         │
                         ▼
                 Durable Event Hub
                         │
                         ▼
             Trigger match and run claim
                         │
                         ▼
              Versioned action snapshot
                         │
                         ▼
              Execution result + artifacts
                         │
                         ▼
              Durable delivery destinations
```

本阶段完成后，业务接入只需要做三件事：

1. 定义并发布领域事件；
2. 提供可取消、可判定重试安全性的业务能力；
3. 将结果表达为标准 Artifact，或注册一个 Delivery Adapter。

业务代码不得直接调用 AutomationService、操作自动化表、实现自己的定时轮询或复制重试队列。

## 2. 目标与非目标

### 2.1 目标

- 单条坏事件不能阻塞后续事件。
- 并发额度满、业务对象忙碌或 Gateway 重启时不丢 Trigger。
- 执行成功与交付成功独立，且状态不会出现假成功。
- 只有被执行器明确声明为安全的操作才能自动重试。
- 外部 Delivery 具有稳定幂等键、签名、超时和可回放状态。
- 事件、运行、Artifact 和 Delivery 具有统一保留与清理规则。
- 业务方通过稳定接口接入，不依赖数据库结构和调度实现。
- 增加新的业务事件、执行器或交付适配器时，不修改事件调度主循环。

### 2.2 非目标

- 不引入 Kafka、Redis、Temporal 或第二套工作流 DSL。
- 不承诺外部系统 exactly-once；采用持久状态、幂等键和 at-least-once Delivery。
- 不在本阶段实现所有 Card、File、Email、IM 适配器，只冻结 Artifact 和 Destination 契约。
- 不允许业务上传任意可执行 DAG；复杂流程继续由已发布 Workflow 承担。
- 不保留旧内存事件总线、旧 completion hook 或旧字段兼容分支。

## 3. 平台不变量

以下规则必须由数据库约束、事务边界或测试保证，不能仅依赖调用约定。

1. **先持久化后确认**：入口返回成功前，Event 必须已写入 SQLite。
2. **一次身份一个内容**：相同 eventId 或 `(source, dedupeKey)` 只能表示完全相同的事件。
3. **一次 Delivery 一个稳定身份**：`(runId, destinationKey)` 全局唯一，重试不得创建新身份。
4. **运行与交付分离**：Delivery 失败不能改写 AutomationRun 的执行结果。
5. **声明后才能重试**：执行器未声明 retry safety 时，默认不自动重试。
6. **Artifact 不内联大文件**：事件和结果只保存有界元数据，文件使用受控 URI 引用。
7. **坏记录不阻塞队列**：失败记录退避或进入 dead letter，worker 继续处理后续记录。
8. **停机必须静默**：停止接单、终止或等待在途任务、持久化最终状态后才能关闭数据库。
9. **状态可修复**：所有 dead letter 都能查询、解释并通过受权操作回放。
10. **无双轨实现**：迁移完成后只保留新状态机和新字段，不在运行时读取旧字段。

## 4. 业务接入契约

### 4.1 Event Producer

业务模块只依赖一个窄接口：

```ts
export interface AutomationEventPublisher {
  publish(input: BusinessEventInput): AutomationEventReceipt;
}

export interface BusinessEventInput {
  id: string;
  type: string;
  source: string;
  schemaVersion: number;
  subject: { kind: string; id: string };
  occurredAtMs: number;
  dedupeKey: string;
  correlationId?: string;
  causationId?: string;
  rootEventId?: string;
  chainDepth?: number;
  trust: 'system' | 'user' | 'connector' | 'untrusted_webhook';
  payload: Record<string, unknown>;
}

export interface AutomationEventReceipt {
  eventId: string;
  created: boolean;
  matchedAutomationCount: number;
}
```

规则：

- `id`、`dedupeKey` 必须来自业务操作的稳定身份，禁止用每次重试都变化的随机值。
- payload 序列化后不超过 256 KiB；更大内容写文件或业务表，只发布引用。
- payload 不放 token、Secret、Authorization Header、完整模型上下文或二进制数据。
- `schemaVersion` 从 1 开始；同版本只能增加可选字段，删除或改变含义必须升版本。
- `occurredAtMs` 表示业务事实发生时间，不是 worker 获取时间。

同一 SQLite 事务内发生的业务变更使用 Domain Outbox：

```ts
runSqliteWriteTransaction((db) => {
  updateBusinessState(db, command);
  appendDomainEvent(db, event);
});
```

远程 Webhook、Connector Poller 或用户主动请求直接调用 Event Publisher；Publisher 自己负责事务和去重。业务方不能在提交业务事务后再异步拼装事件，否则崩溃时会丢失事实。

### 4.2 Event Catalog

内建业务事件必须在代码目录注册元数据：

```ts
export interface BusinessEventDefinition<TPayload> {
  type: string;
  source: string;
  schemaVersion: number;
  payloadSchema: ZodType<TPayload>;
  defaultTrust: 'system' | 'user' | 'connector';
  description: string;
  subjectKind: string;
}
```

Catalog 的职责只有校验、文档和 UI 发现，不承担派发。未知的自定义事件仍可进入 Event Hub，但不能伪装成内建 `system` 事件。

首批 Catalog 覆盖现有 Task、Project、Note、Scene、Workflow、Discussion、Session 和 Connector 事件。迁移采用一次性更新生产者与消费者，不增加事件别名或双写。

### 4.3 Action Executor

执行器需要显式声明安全语义：

```ts
export type RetrySafety =
  | { mode: 'never' }
  | { mode: 'idempotent'; key: 'run_id' }
  | { mode: 'transient_only'; classify: (error: unknown) => boolean };

export interface AutomationExecutorDefinition<K extends string, TAction> {
  kind: K;
  actionSchema: ZodType<TAction>;
  retrySafety: RetrySafety;
  execute(context: AutomationExecutionContext, action: TAction): Promise<AutomationExecutionResult>;
}

export interface AutomationExecutionContext {
  runId: string;
  automationId: string;
  attempt: number;
  deadlineAtMs: number;
  signal: AbortSignal;
  trigger: AutomationEventEnvelope;
  projectId?: string;
}
```

默认策略：

| Executor | 默认重试 | 条件 |
|---|---|---|
| Agent | never | 通用 Agent 可能已经产生不可逆副作用 |
| Browser | never | 除非目标自动化声明并验证稳定幂等键 |
| Workflow | idempotent | 使用 `automation:{automationId}:{runId}` |
| Task command | idempotent | 使用现有 command idempotency key |
| System capability | transient_only | 每个 capability 单独注册错误分类 |

业务能力优先注册为 Capability 或 Workflow。只有执行生命周期、取消或结果形态确实不同，才新增 Action Executor。

### 4.4 Result 与 Artifact

执行结果冻结为版本化信封：

```ts
export interface AutomationResultEnvelopeV1 {
  schemaVersion: 1;
  resultId: string;
  runId: string;
  automationId: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'timeout';
  summary?: string;
  error?: { code: string; message: string; retryable: boolean };
  artifacts: AutomationArtifact[];
  correlationId: string;
  rootEventId: string;
  createdAtMs: number;
  completedAtMs: number;
}

export type AutomationArtifact =
  | { id: string; kind: 'text'; text: string; mediaType: 'text/plain' | 'text/markdown' }
  | { id: string; kind: 'json'; schema: string; data: Record<string, unknown> }
  | { id: string; kind: 'file'; uri: string; name: string; mediaType: string; bytes?: number; sha256?: string }
  | { id: string; kind: 'card'; schema: string; data: Record<string, unknown> }
  | { id: string; kind: 'reference'; resourceType: string; resourceId: string; url?: string };
```

限制：

- 单个 text/json/card Artifact 不超过 64 KiB。
- File Artifact 必须引用 xopc 管理或业务明确授权的位置；不能包含任意本机绝对路径。
- Delivery Adapter 不得重新解释 Agent 原始文本来猜测 Artifact。
- Artifact 在 AutomationRun 完成事务中固化；Delivery 只读取结果快照。

### 4.5 Delivery Destination

Automation 定义改为开放目的地数组：

```ts
export interface AutomationDeliveryPolicy {
  notificationPolicy: 'attention' | 'all' | 'none';
  destinations: AutomationDeliveryDestination[];
}

export type AutomationDeliveryDestination =
  | { key: string; kind: 'gateway_event' }
  | { key: string; kind: 'webhook'; endpoint: string; secretId: string }
  | { key: string; kind: 'file'; targetId: string; pathTemplate: string }
  | { key: string; kind: 'card'; channelId: string; templateId: string };
```

本阶段只实现 `gateway_event` 和 `webhook`，但持久层、Result Envelope 和 Router 使用开放 `kind + config` 契约。后续业务增加 File/Card Adapter 时，不修改 AutomationService 或 Event Dispatcher。

每次交付必须携带：

- `Idempotency-Key: {runId}:{destinationKey}`；
- `X-Xopc-Delivery-Id`；
- `X-Xopc-Delivery-Attempt`；
- `X-Xopc-Timestamp`；
- 使用 `secretId` 解析的 HMAC 签名。

Webhook 不跟随跨 origin redirect；出站地址应用统一网络安全策略。外部接收方按 Idempotency-Key 去重。

## 5. 状态机与失败处理

### 5.1 Event Projection

```text
pending -> projecting -> projected
                    \-> retrying -> projecting
                                \-> dead_letter
```

- worker 使用 lease claim，不能只依赖进程内 `active` Promise。
- 一条 projection 失败后记录错误并继续处理下一条。
- 默认 5 次：1 秒、5 秒、30 秒、2 分钟、10 分钟，随后进入 dead letter。
- projection 只负责 Gateway 投影和业务订阅，不影响已经创建的 Automation Delivery。

### 5.2 Event 到 Automation Run

```text
pending -> queued -> completed | failed | cancelled
       \-> retrying -> pending
       \-> skipped
       \-> dead_letter
```

- 目标 Automation 正在运行不算失败；更新 `nextAttemptAtMs` 后继续扫描后续记录。
- 每轮分页扫描直到填满执行槽位或达到有界 scan budget，不能让前 100 条忙碌记录阻塞后续工作。
- 队列异常按退避策略重试；配置永久无效进入 dead letter。
- run claim、run snapshot 和 delivery `queued` 必须在同一事务提交。

### 5.3 Result Delivery

```text
pending -> delivering -> delivered
                     \-> retrying -> delivering
                                 \-> dead_letter
```

- `delivering` 持有 owner 和 leaseUntil；只有过期 lease 可以被其他 worker 回收。
- 不能在启动时无条件把所有 delivering 改成 failed。
- Handler 必须返回 Promise，Router 在实际副作用完成后才能标记 delivered。
- Gateway Event 也属于真实 Delivery；publish 或 notification 失败必须进入 retrying。
- 到达最大尝试次数进入 dead letter，不继续每秒扫描。

## 6. Replay 与人工恢复

新增原子写能力：

```text
xopc.automations.replay_event
xopc.automations.retry_delivery
```

建议 HTTP 映射：

```text
POST /api/automation-events/:eventId/replay
POST /api/automation-deliveries/:runId/:destinationKey/retry
```

约束：

- 仅 dead_letter 或显式 terminal failure 可以回放。
- 必须提供 Idempotency-Key。
- Replay 不修改原始 Event 或 Result；只创建新的 attempt 并记录操作者、时间和原因。
- 执行失败的 AutomationRun 不自动 replay；用户发起 rerun 时创建新的 Trigger Event 和 Run。
- 已 delivered 的外部目的地默认禁止 replay，除非调用者显式确认可能产生重复副作用。

## 7. 可观测性

`AutomationMetrics` 增加：

```ts
interface AutomationQueueMetrics {
  pendingEvents: number;
  oldestPendingEventAgeMs: number;
  projectionDeadLetters: number;
  pendingRunDeliveries: number;
  runDeliveryDeadLetters: number;
  pendingResultDeliveries: number;
  resultDeliveryDeadLetters: number;
  activeExecutions: number;
  activeDeliveryLeases: number;
}
```

最低日志字段：

- eventId、eventType、source；
- correlationId、causationId、rootEventId；
- automationId、runId；
- destinationKey、deliveryKind、attempt；
- phase、durationMs、nextAttemptAtMs、errorMessage。

进入 dead letter 时发送一次需要注意的 Gateway Event；状态不变时不重复通知。

## 8. 数据生命周期

统一保留规则：

- AutomationRun 默认每个 Automation 保留最近 1500 条 terminal run。
- 删除 run 前，先处理 Result Delivery 和 Event Delivery 引用。
- 未完成、retrying、delivering、dead_letter 记录不自动删除。
- 已 delivered/projected 且超过保留窗口的 Event、Delivery 和 Artifact 元数据可以级联删除。
- File Artifact 的元数据删除与实体文件删除分开；只有明确拥有关系时才删除文件。
- `doctor --deep` 检查 orphan runId、悬空 Artifact、过期 lease 和无法解析的 payload。

当前分支中的 209–212 迁移尚未形成发布基线时，直接修正这些迁移和目标表结构；不要先发布不完整表，再增加运行时兼容读取。如果这些迁移已经被任何正式版本采用，则使用新的单向迁移重建表，迁移结束后仍只保留一套运行时模型。

## 9. Graceful Shutdown

AutomationService 停止顺序固定为：

1. 标记 stopping，拒绝新 dispatch；
2. 停止 scheduler 和轮询 timer；
3. Abort Event/Delivery HTTP 和可取消执行器；
4. 等待 Event Dispatcher、Delivery Router 和 active runs settle；
5. 未完成 lease 保持可恢复状态；
6. 停止日志、Realtime 和其他依赖；
7. 最后关闭 SQLite。

所有 `stop()` 返回 `Promise<void>`，且具备有界 shutdown deadline。超过 deadline 的工作只释放 lease，不伪造成功。

## 10. 业务接入流程

### 10.1 新增领域事件

1. 在业务模块定义 payload schema 和稳定 dedupe key。
2. 在 Event Catalog 注册类型、版本、source、subject 和默认 trust。
3. 业务写事务中调用 `appendDomainEvent`。
4. 增加重复发布、事务回滚、Schema 不匹配和大 payload 测试。
5. 如需产品预设，只在 Automation UI 增加模板，不修改 dispatcher。

### 10.2 新增可执行业务能力

1. 优先提供 Capability 或 Workflow。
2. 明确输入 Schema、权限、取消、幂等键和 retry safety。
3. 仅在生命周期明显不同的情况下注册新 Executor。
4. 输出标准 Result 和 Artifact，不直接发送通知或写 Delivery 表。

### 10.3 新增交付方式

1. 定义 Destination config schema。
2. 注册 Delivery Adapter。
3. 使用平台提供的 deliveryId、幂等键、lease、超时和 retry policy。
4. 增加并发 claim、超时后重试、重启恢复和 dead-letter 测试。
5. 不修改 AutomationService、Event Dispatcher 和已有 Adapter。

## 11. 实施阶段

### R0：冻结契约

- 建立 Event Catalog 接口。
- 定义 Executor retry safety。
- 定义 Result Envelope、Artifact 和 Destination 类型。
- 更新 Gateway Contract 和文档。

完成标准：业务团队可以只根据接口完成接入设计，不需要阅读 AutomationService。

### R1：修复可靠性正确性

- Gateway Delivery 改为真实可等待的 Promise。
- Dispatcher/Router 使用 lease claim。
- 修复 projection 和 pending delivery 队头阻塞。
- 实现 graceful shutdown。
- 删除不安全的通用执行重试；按 Executor policy 重试。

完成标准：故障注入测试中没有假成功、重复并发发送或后续记录饥饿。

### R2：DLQ、Replay 与指标

- 增加 retrying/dead_letter 状态。
- 增加受权 replay/retry capability。
- 增加 backlog、oldest age 和 dead-letter 指标。
- 增加一次性用户注意通知。

完成标准：无需直接操作 SQLite 即可定位和修复所有 terminal delivery failure。

### R3：开放 Artifact 与 Destination

- 持久化 Result Envelope 和 Artifact。
- Delivery Policy 改为 destinations 数组。
- 迁移现有 gateway_event 和 webhook。
- 提供 File/Card Adapter 接入示例，但不要求同时上线全部适配器。

完成标准：新增一个测试 Delivery Adapter 不修改调度主循环。

### R4：生命周期与业务试点

- 统一 run/event/delivery/artifact 清理。
- 扩展 doctor 深度检查。
- 选择 Task 与 Project 各一个真实事件作为试点。
- 完成业务接入模板和验收清单。

完成标准：连续压测、重启和数据裁剪后不存在 orphan、无限 pending 或无法解释的状态。

## 12. 必须覆盖的测试

| 场景 | 预期 |
|---|---|
| 相同事件重复发布 | 返回原 receipt，不增加 run |
| 同 identity 不同 payload | 拒绝并告警 |
| 第一个 projection 永久失败 | 后续 projection 继续，失败项最终进 DLQ |
| 前 100 个 Automation 都忙碌 | 第 101 个可运行项仍可被领取 |
| Gateway Event 异步失败 | Delivery 不得标记 delivered |
| Webhook 已接收但响应超时 | 使用同一 Idempotency-Key 重试 |
| 两个 Router 同时扫描 | 只有 lease owner 执行副作用 |
| Gateway 在 delivering 时退出 | 重启后从过期 lease 恢复 |
| Agent 失败且 retryCount > 0 | retry safety 为 never 时不重复执行 |
| Workflow 瞬时失败 | 相同 run idempotency key 安全重试 |
| 删除 Automation 后处理结果 | 仍使用结果快照完成 Gateway Delivery |
| 裁剪 2000+ runs | 无悬空 Event/Result Delivery |
| 新增测试 Card Adapter | 不修改 AutomationService/Event Dispatcher |

## 13. Definition of Done

- 所有平台不变量都有至少一个失败路径测试。
- Root unit、Web test、typecheck、lint、production build 全部通过。
- 不存在旧字段、旧状态机或内存事件总线兼容分支。
- 业务事件接入不直接依赖 `src/automations/service/` 和 SQLite 表。
- 所有外部 Delivery 都有稳定幂等键；Webhook 有签名和受控网络策略。
- 所有 terminal failure 可查询、可解释、可受权回放。
- 停机测试确认 SQLite 关闭后没有后台 Automation Promise 继续写库。
- 文档包含 Event、Executor、Artifact、Destination 四类接入示例。
