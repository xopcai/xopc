# xopc AI 调用可见性与费用账本技术设计

日期：2026-09-26  
状态：方案草案，待评审；尚未实施

## 0. 技术结论

xopc 应新增一个统一、追加式的 **AI 调用账本（AI Usage Ledger）**。每一次真正发往模型供应商的请求生成一条物理调用记录，再通过 `traceId`、`parentEventId` 和业务归属字段组合为用户能理解的调用链。

- 账本是模型调用用量与费用的唯一事实来源；聊天消息、Scene、Automation 等页面只读取账本投影，不分别维护费用总数。
- 场景由调用方在运行前声明，运行时负责补充模型、token、费用、耗时和结果。不得通过模型猜测调用用途。
- 首版同时覆盖主 Agent 模型循环和 `src/providers/model-call.ts` 下的一次性调用；没有接入账本的远程模型请求视为可观测性缺陷。
- 优先记录供应商返回的 usage；供应商未返回费用时，使用调用当时冻结的模型价格快照估算。未知费用不能显示为 `$0`。
- 默认不保存 prompt、完整响应、工具参数或附件内容。账本只保存归因、计量和有界错误信息。
- 用户界面提供消息级摘要、会话级明细和全局“用量与费用”页；默认安静展示，需要时才展开调用链。

## 1. 目标与非目标

### 1.1 目标

1. 用户能知道一次 AI 调用为什么发生、由谁触发、属于哪个会话／任务／自动化。
2. 用户能看到模型、token、缓存命中、估算费用、调用状态、耗时和重试。
3. 同一用户动作产生的多次模型请求可以组成调用树，并聚合到一条消息或一个后台运行。
4. 历史费用不因模型目录价格更新而变化。
5. 为后续预算、限额、异常费用提醒和供应商账单对账提供稳定基础。

### 1.2 非目标

- 首版不实现付款、充值、发票或平台代理计费。
- 不承诺所有 BYOK、OAuth、订阅套餐都能换算为实际货币成本。
- 不将完整提示词或模型响应复制进账本。
- 不以 transcript message 作为物理调用事实；一条助手消息可能包含多次模型请求。
- 首版不阻断调用，只做记录和展示；预算强制策略在账本稳定后单独设计。

## 2. 当前基础与缺口

| 能力 | 当前实现 | 缺口 |
| --- | --- | --- |
| 主 Agent usage | `message_end` 可获得 assistant message usage | `llm_request` 缺少稳定 call id、模型与业务场景，无法可靠关联开始和结束 |
| 一次性调用 | `completeWithResolvedCredentials`、`createResolvedModelStream` 是共享入口 | 调用方没有统一传入业务归因，调用结果没有统一落库 |
| 聊天实时展示 | `assistant_message_end` 已包含 token 与 `cost` | 只覆盖当前实时消息，不是统一账本；刷新后的费用完整性不足 |
| 会话存储 | transcript payload 可保留 message usage | `SessionStore.convertMessages` 只转换 token，未保留嵌套 `usage.cost.total` |
| Scene | `scene_model_usage` 单独记录 token 与 estimated cost | 与其他模型调用重复建模，无法进行全局聚合和调用树追踪 |
| 模型目录 | 模型包含 input/output/cache 单价 | 历史记录没有冻结价格版本和估算依据 |

首版不能只在 `Message` 上补一个 `cost` 字段；那会遗漏标题生成、压缩、图片理解、网页提取、任务评审、后台 Scene 等非聊天调用，也无法表达失败重试。

## 3. 领域模型

### 3.1 一次物理调用

`AiUsageEvent` 表示一次已经或准备发往模型供应商的物理请求。流式请求从发起到流结束只对应一条记录；重试是另一条记录，并通过 `attempt` 和相同的 `logicalCallId` 关联。

```ts
type AiUsageStatus = 'running' | 'succeeded' | 'failed' | 'aborted' | 'unknown';
type AiUsageTrigger = 'user' | 'scheduled' | 'system' | 'agent' | 'retry';
type AiCostSource = 'provider' | 'model_catalog' | 'local' | 'unknown';

type AiUsageCategory =
  | 'chat'
  | 'tool_loop'
  | 'delegation'
  | 'compaction'
  | 'session_title'
  | 'image_understanding'
  | 'web_extract'
  | 'session_search'
  | 'note_generation'
  | 'automation'
  | 'scene'
  | 'task_planning'
  | 'task_judging'
  | 'voice_summary'
  | 'home_intelligence'
  | 'work_discovery'
  | 'discussion_analysis'
  | 'other';

interface AiUsageAttribution {
  category: AiUsageCategory;
  operation: string;          // 稳定机器标识，例如 session.compact
  trigger: AiUsageTrigger;
  reasonKey: string;          // i18n key，不落自由文本
  reasonParams?: Record<string, string | number>;

  conversationId?: string;
  transcriptId?: string;
  turnId?: string;
  messageId?: string;
  agentId?: string;
  projectId?: string;
  taskId?: string;
  taskRunId?: string;
  automationId?: string;
  automationRunId?: string;
  sceneId?: string;
  sceneRunId?: string;
}

interface AiUsageEvent extends AiUsageAttribution {
  id: string;                 // 单次物理请求 ID
  logicalCallId: string;      // 多次 attempt 共用
  traceId: string;            // 一次用户动作或后台运行
  parentEventId?: string;     // 调用树父节点
  attempt: number;

  provider: string;
  model: string;
  api?: string;
  authKind?: 'api_key' | 'oauth' | 'token' | 'local' | 'unknown';
  status: AiUsageStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  errorCode?: string;
  errorSummary?: string;

  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;

  currency: 'USD';
  estimatedCostUsd?: number;
  providerReportedCostUsd?: number;
  costSource: AiCostSource;
  pricingSnapshot?: AiPricingSnapshot;
}
```

### 3.2 稳定场景注册表

新增 `src/usage/scenario-registry.ts`。业务代码只能传 `operation` 和受类型约束的参数；注册表决定 category、reason key 和默认 trigger。用户文案在前端 i18n 中渲染。

```ts
const AI_USAGE_SCENARIOS = {
  'agent.answer': {
    category: 'chat',
    reasonKey: 'usage.reason.agentAnswer',
    defaultTrigger: 'user',
  },
  'agent.continue_after_tool': {
    category: 'tool_loop',
    reasonKey: 'usage.reason.continueAfterTool',
    defaultTrigger: 'agent',
  },
  'session.compact': {
    category: 'compaction',
    reasonKey: 'usage.reason.sessionCompaction',
    defaultTrigger: 'system',
  },
  'session.generate_title': {
    category: 'session_title',
    reasonKey: 'usage.reason.sessionTitle',
    defaultTrigger: 'system',
  },
} as const;
```

不允许调用方直接落 `displayReason`，避免文案漂移、无法国际化或把用户内容写入账本。未知 operation 在开发环境报错，在生产环境记录为 `other` 并产生一次有界 warn。

### 3.3 费用语义

对外统一显示 `effectiveCostUsd`，但数据库保留来源：

```ts
effectiveCostUsd = providerReportedCostUsd ?? estimatedCostUsd
```

规则如下：

- 供应商明确返回货币费用时，`costSource = 'provider'`。
- 只有 token usage 时，使用请求开始时冻结的 `pricingSnapshot` 计算，`costSource = 'model_catalog'`。
- 本地模型明确为 `local`，费用可显示“API 费用 $0”；不能写成“完全免费”。
- OAuth、包月订阅或未知价格不能按零价处理，`costSource = 'unknown'`，UI 显示“费用未知”。
- 所有金额以 USD 存储，使用整数微美元 `INTEGER`，避免 SQLite 浮点累计误差；API 再转换为十进制字符串。
- `totalTokens` 以供应商定义优先；没有时才由各 token 分项相加。不同供应商对缓存 token 是否包含在 input 中定义不同，费用必须按分项计算，不能用 `totalTokens * 单价`。

## 4. SQLite 设计

建议新增 migration `214_ai_usage_ledger.sql` 和仓库模块 `src/storage/sqlite/ai-usage-repository.ts`。

```sql
CREATE TABLE ai_usage_events (
  id TEXT PRIMARY KEY,
  logical_call_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_event_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),

  category TEXT NOT NULL,
  operation TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  reason_key TEXT NOT NULL,
  reason_params_json TEXT,

  conversation_id TEXT,
  transcript_id TEXT,
  turn_id TEXT,
  message_id TEXT,
  agent_id TEXT,
  project_id TEXT,
  task_id TEXT,
  task_run_id TEXT,
  automation_id TEXT,
  automation_run_id TEXT,
  scene_id TEXT,
  scene_run_id TEXT,

  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api TEXT,
  auth_kind TEXT,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  error_summary TEXT,

  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_tokens INTEGER,

  currency TEXT NOT NULL DEFAULT 'USD',
  estimated_cost_microusd INTEGER,
  provider_cost_microusd INTEGER,
  cost_source TEXT NOT NULL,
  pricing_snapshot_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_ai_usage_started ON ai_usage_events(started_at DESC, id DESC);
CREATE INDEX idx_ai_usage_conversation ON ai_usage_events(conversation_id, started_at DESC);
CREATE INDEX idx_ai_usage_trace ON ai_usage_events(trace_id, started_at ASC);
CREATE INDEX idx_ai_usage_agent ON ai_usage_events(agent_id, started_at DESC);
CREATE INDEX idx_ai_usage_task_run ON ai_usage_events(task_run_id, started_at DESC);
CREATE INDEX idx_ai_usage_automation_run ON ai_usage_events(automation_run_id, started_at DESC);
CREATE INDEX idx_ai_usage_scene_run ON ai_usage_events(scene_run_id, started_at DESC);
```

写入协议：

1. 请求真正开始前插入 `running` 记录。
2. 模型返回后更新同一行的 usage、费用和 `succeeded`。
3. 抛错或中止时更新为 `failed` / `aborted`；如果供应商没有返回 usage，token 和费用保持 `NULL`。
4. Gateway 启动时将超过恢复阈值的孤立 `running` 记录改为 `unknown`，不能假装失败请求没有产生费用。
5. 开始和结束更新分别提交，不与 transcript 写入组成跨网络长事务。

不为 transcript、session、task 设置级联删除。账本是审计数据；业务对象删除后保留归属 ID，但 UI 不再提供内容深链。未来如支持“删除所有使用记录”，应显式执行账本删除，而不是依赖业务表 cascade。

## 5. 运行时接入

### 5.1 上下文传播

新增 `src/usage/context.ts`，使用 `AsyncLocalStorage` 维护：

```ts
type AiUsageContext = AiUsageAttribution & {
  traceId: string;
  parentEventId?: string;
};

withAiUsageContext(context, callback);
getAiUsageContext();
```

入口负责创建 trace：

- Web / channel / CLI 用户输入：复用 `runId` 作为 trace，或建立稳定映射。
- TaskRun、AutomationRun、SceneRun：运行 ID 作为 trace 根。
- 子 Agent：继承 trace，当前父模型调用或 delegation event 作为 parent。
- 后台独立功能：由 application service 创建 trace，并声明 operation。

上下文传播可以复用现有日志 async context 的组合方式，但 usage context 应为独立类型，避免日志字段变化影响计费记录。

### 5.2 一次性模型调用入口

扩展 `src/providers/model-call.ts`：

```ts
type TrackedModelCallOptions = {
  usage: {
    operation: AiUsageOperation;
    attribution?: Partial<AiUsageAttribution>;
  };
  stream?: SimpleStreamOptions;
};
```

`completeWithResolvedCredentials` 与 `createResolvedModelStream` 在解析出最终模型后调用 `AiUsageRecorder.start()`。流式调用必须包装 `result()` 和终止路径，确保只 finalize 一次。

迁移期间可以暂时允许缺少 `usage.operation`，但必须记录 metric 和开发告警。所有生产调用点迁移完成后将其改为必填。

首批接入调用点：

| 模块 | operation |
| --- | --- |
| `session/session-title.ts` | `session.generate_title` |
| `agent/memory/compaction.ts` | `session.compact` |
| `agent/image/understanding/pi-ai-provider.ts` | `media.understand_image` |
| `agent/tools/web-extract.ts` | `tool.web_extract` |
| `agent/tools/session-search-tool.ts` | `tool.session_search_summarize` |
| `notes/service.ts` | `note.generate` |
| `voice/tts/summarize.ts` | `voice.summarize_for_tts` |
| `tasks/task-contract-planner.ts` | `task.plan_contract` |
| `agent/tasks/task-judge-service.ts` | `task.judge_result` |
| `home-intelligence/generator.ts` | `home.generate_advice` |
| `work-discovery/*` | `work_discovery.analyze` / `work_discovery.investigate` |
| `discussions/analyzer.ts` | `discussion.analyze` |
| `automations/draft/*` | `automation.generate_draft` |

### 5.3 主 Agent 循环

现有 `llm_request` 生命周期事件发生在 `agent_start`，语义不足以表达每一次模型 round-trip。首版应从 `pi-agent-core` 的模型请求／响应边界接入，而不是仅依赖最终 `message_end`。

如果上游事件无法提供稳定 request id，则在 xopc 的 Agent stream bridge 外围创建 call handle，并将 id 写入 event metadata。每个工具循环后的再次请求单独记录：

```text
trace: 用户发送消息
└── call 1  agent.answer
    ├── tool call: web_search（不属于模型费用）
    └── call 2  agent.continue_after_tool
        └── assistant message
```

完成后，助手消息写入 `usageTraceId` 或 `usageEventIds`，只作为 UI 关联指针；token 与费用汇总以账本查询为准。

### 5.4 Scene 迁移

首版双写：

- Scene 继续写 `scene_model_usage`，保持现有 metrics 不变。
- 同一个物理请求同时写统一账本，并带 `sceneId`、`sceneRunId`。
- 增加一致性测试，保证两边 token 和费用相等。

全局页面稳定后，将 Scene metrics 攅读账本聚合，再删除双写和旧表。切换前禁止把两张表相加，否则会重复计费。

### 5.5 非 LLM AI 服务

图片生成、STT、TTS、embedding 和 rerank 可能按字符、秒、张数或固定请求计费，不应伪装为 token 模型调用。首版 schema 为 LLM 优先；第二阶段增加通用 `quantity` 明细：

```ts
usageUnits: Array<{
  kind: 'token' | 'character' | 'second' | 'image' | 'request';
  direction?: 'input' | 'output' | 'cache_read' | 'cache_write';
  quantity: number;
  unitPriceMicrousd?: number;
}>;
```

在此之前，未接入的 AI 服务必须在页面覆盖说明中列出，不能让“总费用”暗示已经完整覆盖。

## 6. Gateway API 与契约

公共 schema 建议新增到 `packages/gateway-contract/src/usage.ts`。

### 6.1 接口

```text
GET /api/usage/summary
GET /api/usage/events
GET /api/usage/events/:id
GET /api/usage/traces/:traceId
GET /api/sessions/:conversationId/usage
```

`GET /api/usage/summary` 参数：

- `from`、`to`：必填或由服务端限制默认 7 天；最大跨度首版 366 天。
- `groupBy=day|provider|model|category|agent|trigger`。
- 可选 `agentId`、`conversationId`、`projectId`、`taskId`、`automationId`。

响应同时返回：

```ts
type UsageTotals = {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  unknownCostCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  knownCostUsd: string;
  costCompleteness: 'complete' | 'partial' | 'unknown';
};
```

`events` 使用 `(startedAt, id)` keyset cursor，禁止 offset pagination。列表不返回 error stack 和 pricing JSON；详情接口才返回价格快照和有界错误摘要。

### 6.2 权限

费用信息具有账号级敏感性。首版 `/api/usage` 使用 `gateway.admin`，会话内的 `/api/sessions/:id/usage` 沿用 `sessions.read`，且只能读取该会话归属数据。未来移动端需要全局用量时，再新增独立 `usage.read` scope，而不是扩大默认 mobile scopes。

新增 authenticated route 时必须同步修改：

- `src/gateway/hono/routes/lazy-bundles.ts`
- `src/gateway/hono/routes/__tests__/lazy-bundles.test.ts`
- `src/gateway/security/gateway-scopes.ts`
- `src/gateway/security/__tests__/gateway-scopes.test.ts`

### 6.3 Realtime

新增 `usage.updated` 只携带：

```ts
{ traceId: string; conversationId?: string; updatedAt: number }
```

客户端收到后合并刷新对应 summary；事件中不发送费用明细或错误信息。聊天流现有 `assistant_message_end.usage` 保留用于即时反馈，但页面最终以账本查询为准。

## 7. Web UI

### 7.1 消息级摘要

助手消息底部在已完成且存在已知调用时显示：

```text
GPT-5 · 3 次调用 · 12.4K tokens · 约 $0.031
```

规则：

- 只有供应商实际成本时显示 `$0.031`；目录估算显示 `约 $0.031`。
- 存在未知费用时显示 `已知 $0.031 + 1 次费用未知`。
- 默认只显示一行；点击后展开调用列表。
- 流式进行中不滚动累加金额，结束或后台刷新后一次更新。
- 费用为零但属于本地模型时显示“本地模型 · API 费用 $0”。

### 7.2 会话用量面板

聊天 header 的详情菜单增加“本次会话用量”：

- 总调用数、已知费用、未知费用调用数。
- 输入／输出／缓存 token。
- 按场景分组的调用列表。
- 每条记录可以展开模型、时间、耗时、重试和价格来源。

### 7.3 全局页面

新增 `/usage`，导航名称为“用量与费用”。页面包含：

- 今日、7 天、本月已知费用和覆盖完整度。
- 按日期趋势。
- 按 Agent、场景、模型和触发方式的聚合。
- 可筛选调用明细表和 trace 详情抽屉。
- CSV / JSON 导出在后续阶段提供。

加载态使用现有 Skeleton；筛选使用项目 `PopoverSelect`。不要用“账单”命名页面，因为数据可能是估算，也可能来自用户自己的订阅或本地模型。

## 8. 隐私、保留与日志

- `reasonParams` 只允许注册表声明的非敏感参数，如工具序号或自动化名称的稳定展示 ID；禁止原始用户文本。
- `errorSummary` 最长 512 字符，写入前复用日志脱敏规则；不保存 stack、请求头、API key 或完整供应商响应。
- `authKind` 只记录认证类别，不记录 profile id 或凭据内容。
- 默认保留期与 session 审计数据保持一致；设置页可增加 30／90／365 天或永久保留。清理按时间批次执行，不在页面请求中同步删除。
- 日志只记录 usage event id、trace id、provider/model、status 和有界数值，不重复打印完整账本行。

## 9. 故障与一致性

| 情况 | 处理 |
| --- | --- |
| 请求成功但账本 finalize 失败 | 响应仍交付用户；记录 error 并进入恢复队列，不能让可观测性故障破坏主功能 |
| 插入 running 失败 | 模型调用继续；记录一次高优先级 error 和缺口 metric |
| Gateway 在调用中崩溃 | 重启后将超时 running 标为 unknown |
| 供应商 usage 缺失 | 成功状态保留，费用未知，不按字符估 token 充当计费事实 |
| 重复 finalize | repository 使用状态与版本条件保证幂等，第二次相同写入无副作用 |
| 同一事件由两条链路记录 | `id` / `logicalCallId` 由调用边界创建并向下传递，Scene 双写不能再创建第二条 ledger event |
| 模型目录价格改变 | 历史使用 `pricing_snapshot_json`，不回算 |

账本写失败必须可观测：增加 `ai_usage_record_start_failures`、`ai_usage_finalize_failures`、`ai_usage_unattributed_calls` 和 `ai_usage_unknown_cost_calls` 指标。

## 10. 实施阶段

### 阶段 A：账本内核

1. 增加 migration、repository、领域类型、场景注册表和费用计算器。
2. 增加 AsyncLocalStorage usage context。
3. 接入 `model-call.ts`，迁移所有现有调用点。
4. 接入主 Agent 每次物理模型请求。
5. 修复 session message API 对嵌套 cost 的保留，维持旧聊天实时 UI 兼容。

完成标准：测试中每一次远程模型请求恰好产生一条账本记录，成功、失败、中止和重试均可区分。

### 阶段 B：查询与用户可见性

1. 增加 gateway contract 和 `/api/usage/*` 路由。
2. 增加 lazy bundle 与权限映射测试。
3. 实现消息级摘要和会话用量面板。
4. 实现 `/usage` 全局页面和聚合筛选。
5. 增加中英文 reason 与状态文案。

完成标准：用户可以从任意助手消息追踪到物理调用，并理解场景、模型、费用来源和重试情况。

### 阶段 C：覆盖与治理

1. Scene 从双写迁移为统一账本聚合。
2. 接入图片生成、STT、TTS、embedding 和其他非 token AI 服务。
3. 加入导出、预算提醒、异常费用检测。
4. 评估独立 `usage.read` scope 与移动端页面。

完成标准：全局页明确显示覆盖率；所有未覆盖 AI 服务都有清单，不将部分数据宣称为总账单。

## 11. 测试计划

### 11.1 单元测试

- 价格计算：input/output/cache、缺失价格、本地模型、微美元舍入。
- scenario registry：所有 operation 唯一且具备中英文 reason key。
- repository：start/finalize 幂等、非法状态转换、unknown 恢复、cursor pagination。
- context：嵌套调用继承 trace，子调用 parent 正确，并发请求不串上下文。
- 安全：错误和 reason params 脱敏、长度限制。

### 11.2 集成测试

- 普通聊天一次响应。
- 工具调用导致两次模型 round-trip。
- 用户中止流式响应。
- 供应商失败后重试成功，两条物理记录、一个 logical call。
- 会话压缩、标题生成和图片理解的归因。
- Automation、TaskRun、SceneRun 的 trace 归属。
- Gateway 重启后的 running → unknown 恢复。
- realtime usage 与重新加载后的账本汇总一致。

### 11.3 API 与 Web 测试

- lazy route 正向映射及相邻 route 不重叠。
- scope：全局 usage 需要 admin，会话 usage 只需 sessions.read。
- summary 对未知费用不错误显示为零。
- 消息 footer 对 estimated/provider/local/unknown 四种费用来源正确显示。
- Skeleton、空状态、部分覆盖说明和移动端窄屏布局。

## 12. 验收标准

1. 一条包含两次工具循环的回答，页面显示三次物理模型调用，而不是一条消息调用。
2. 每次调用都有稳定场景说明，并可定位到会话、任务、自动化或 Scene；无法归因时明确标记“其他”，同时产生工程告警。
3. 重载页面后 token 和费用与实时结束时一致。
4. 价格目录更新后，历史估算费用不变化。
5. 未知价格、OAuth 套餐和缺失 usage 不显示 `$0`。
6. 用户中止、失败重试和 Gateway 中断都有可解释状态。
7. 数据库和 API 不包含 prompt、完整响应、凭据或完整错误堆栈。
8. `/usage` 聚合值与明细求和一致；Scene 双写期间不会重复计费。
9. 新增模型调用点如果没有声明 operation，会在测试或 CI 中失败。

## 13. 关键工程决策

| 决策 | 结论 |
| --- | --- |
| 事实粒度 | 一次供应商请求，而不是一条消息 |
| 归因方式 | 调用前显式声明 operation，通过 async context 传播 |
| 文案来源 | 稳定 reason key + i18n，不由模型生成 |
| 金额存储 | USD 微美元整数，保留 provider 与 estimate 两套值 |
| 历史价格 | 每次调用冻结 pricing snapshot |
| Prompt 保存 | 默认不保存 |
| Scene 迁移 | 先双写校验，再切换读取，最后删除旧表 |
| 首版权限 | 全局 usage 为 `gateway.admin`，会话 usage 为 `sessions.read` |
| UI 名称 | “用量与费用”，不用“账单” |

