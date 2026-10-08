# 默认本地 Trace 与 Langfuse 双写技术方案

日期：2026-10-08。状态：设计提案，尚未实现。本文数值为第一版建议默认值，须通过压力测试确认。

## 1. 产品行为

- 无需配置即记录本地执行追踪，覆盖用户对话、工具和辅助模型调用。
- 用户在 Settings 配置并启用 Langfuse 后，同一批新采集的 span 同时写入本地和 Langfuse。
- Langfuse 不可用不影响本地记录；本地写入失败不阻止远端导出。两端都不能影响 Agent 的执行结果。
- 本地是有界的排障缓存，不是永久审计记录。容量、保留时间、条数、单次执行大小和写入速率均有上限。
- 默认保留脱敏后的有限输入输出摘要。需要完整上下文时，用户可临时开启详细模式；详细模式仍遵守容量上限。
- 启用远端只影响后续采集，不自动上传历史本地记录。第一版远端导出为 best effort，不承诺断网补传。

## 2. 当前基础

`src/usage/recorder.ts` 已记录模型调用开始、结束、usage、成本和错误；`AiUsageContext` 有业务 traceId、parentEventId、runId、conversationId。`src/agent/embedded/run-turn.ts` 在实际模型流调用处包装 `trackAiUsageStream`。`src/providers/model-call.ts` 包装辅助模型调用。

`src/agent/embedded/subscribe-session.ts` 有模型和工具事件；工具开始/结束包含 toolCallId。`src/agent/embedded/run-for-session.ts` 包含 run 生命周期和模型候选尝试。`src/utils/logger/context.ts` 已有 AsyncLocalStorage 关联。

这些是接入点，不等于已有完整 tracing。现有 `llm_request` 生命周期事件在 agent_start 时触发，不能代表逐次模型调用。现有 usage traceId 有时是业务 UUID，不能直接作为 OTel trace ID。

`ai_usage_events` 保留期当前为 180 天。新 trace 缓存的清理不改变已有用量账本、会话 transcript 或成本汇总。

## 3. 总体架构

```text
Gateway / CLI / Channel / Automation
                  │
             TraceRuntime（OTel context）
                  │
       run / generation / tool / compaction spans
                  │
     字段白名单 → 脱敏 → 字节限制 → 标准化快照
                  │
          ┌───────┴────────┐
          │                │
   LocalTraceProcessor  Langfuse 导出适配器（可选）
          │                │
     有界写入队列       有界批量队列 / 有限重试
          │                │
   独立 SQLite worker   LangfuseSpanProcessor / OTLP
          │
    本地查询 API → Settings 运行追踪
```

建立一套 OTel span 和 context，两端共享 traceId/spanId。独立处理器隔离故障，不要求双端原子提交。完成 span 复制为不可变、已脱敏的快照；不得让两端处理器相互修改对象。

无 Langfuse 时仍初始化 OTel 和本地处理器；不要依赖 Langfuse SDK 启动本地采集。业务统一通过 `src/observability/` 的薄接口操作 span。

第一版只手动埋点关键边界，不启用全量 HTTP/数据库自动埋点。Langfuse 默认过滤规则可能排除自定义 scope，导出适配器须显式允许 `xopc.observability` 的整棵树，并正确设置 generation/tool 等 observation 属性。

## 4. 追踪模型与接入点

### 身份与生命周期

- 每次 run 创建独立根 span，sessionId 使用 conversationId。
- traceId 使用 OTel 标准 32 位小写十六进制；spanId 使用 16 位。业务 runId 独立保存。
- 新增 `otelTraceId` 关联，不无条件重解释已有 usage/context/workflow 的 traceId 字段。
- usage 记录新增可空 `otel_trace_id`、`otel_span_id`，将调用次数和成本关联到 generation；历史数据不回填虚构 span。
- 根 span 覆盖准备、模型尝试、fallback、工具循环和验证。暂停等待连接或澄清时结束本次执行并标记 suspended；恢复执行使用新 trace，并以业务 runId 和 span link 关联，避免维持数小时的活动 span。
- 正常、异常、取消都通过 finally 结束；工具业务错误与抛出异常都设置错误状态，取消单独标记。
- span 引用属于 run/调用，不能以 conversationId 作为唯一缓存键。工具通过 toolCallId 配对。

### 埋点范围

| 边界 | 位置 | 第一版内容 |
|---|---|---|
| Run | run-for-session.ts 及其他独立执行入口 | 根 span、业务身份、结果、耗时 |
| 模型尝试 | run-for-session.ts 的候选尝试 | attempt、模型、fallback 原因 |
| Generation | run-turn.ts 的实际 streamFunction、model-call.ts、其他 usage 包装入口 | 模型输入摘要、输出摘要、参数白名单、usage、成本、错误 |
| Tool | 公共 tool.execute 包装层；事件作为校验和补充 | toolCallId、参数、结果、耗时；内部模型调用继承工具上下文 |
| Compaction | 实际压缩调用 | 原因、tokensBefore/After、关联 generation |
| 委派 / 后台任务 | child-agent、后台 review、任务启动边界 | parent span 或 link、各自生命周期 |

生成输入应来自最终裁剪/修复后的 provider context，附带 message/tool 数量和内容摘要。它不保证等于底层 HTTP payload；原始请求体第一版不采集。成本沿用 xopc 定价与 usage，标注估算来源；未知成本不填 0。缓存 token 映射须核对 pi-ai/provider 的包含关系。

不为每个 token 创建 span 或写一条记录。流输出只维护有界摘要，结束时一次写入；首个有效输出事件可记录 TTFT。不得额外消费同一 stream 造成输出竞争。流返回对象不代表调用完成，span 应随 result/error/abort 结束。

队列、消息总线、子进程边界显式携带 traceparent 和必要的非敏感关联字段，再恢复 context；普通 async 链使用 OTel context。子任务创建时绑定父上下文，不能从会话最近一次 run 猜测父节点。日志自动加入 traceId/spanId/runId。

## 5. 本地存储

### 独立数据库

默认路径为共享 state root 下的 `traces/traces.db`，通常是 `~/.xopc/traces/traces.db`，遵守 XOPC_STATE_DIR。目录权限 0700，数据库及 sidecar 0600。

独立 SQLite 有独立 schema version、连接、迁移、维护与额度，复用项目 SQLite 基础工具，不复用主数据库全局连接。这样大量 trace 正文、checkpoint、清理或损坏不会挤占主库写路径。

SQLite 同步操作在 worker 内执行，Agent 线程只向有界队列提交。多进程通过 SQLite 事务/写锁协调额度，不能各自以缓存计数超卖容量；使用短 busy timeout 和有界重试。多个 Gateway/CLI 共用同一存储额度，但各自内存队列有进程级上限。

### 数据表

| 表 | 主要字段 |
|---|---|
| traces | trace_id PK、root_span_id、run_id、conversation_id、transcript_id、agent_id、trigger、name、status、started_at、ended_at、summary、capture_mode、config_revision、span_count、payload_bytes、partial_reason |
| spans | trace_id + span_id 联合 PK、parent_span_id、type、name、status、start/end、provider/model、tool_call_id、usage_event_id、tokens/cost、attributes_json、input/output 摘要、truncation 标记、payload_bytes |
| trace_links | 源 trace/span、目标 trace/span、关系类型，支持恢复、异步委派 |
| store_state | 当前逻辑容量、条数、速率预算、清理时间、丢弃计数；额度更新与写入处于同一事务 |

按 traces(started_at, trace_id)、(conversation_id, started_at)、(status, started_at)、(run_id) 建索引。spans 按 (trace_id, start_time, span_id) 查询。第一版不用 FTS，减少写放大。

活动 run 起始写入根概要，完成时更新；长期任务最多每 5 秒合并一次概要进度。子 span 结束后写入。父 span 可以稍后结束，所以不能用要求父行先存在的自引用外键阻止写入。

### 建议默认限制

| 项目 | 默认 |
|---|---:|
| 保留时间 | 7 天 |
| 存储空间预算（DB + WAL + SHM） | 256 MiB |
| 清理高/低水位 | 192 / 160 MiB |
| Trace 条数 | 10,000 |
| Span 总条数 | 100,000 |
| 单 trace 记录正文总量 | 1 MiB |
| 单 trace span 数 | 1,000 |
| 常规模式每个 input/output 摘要 | 各 8 KiB |
| 详细模式每个 input/output | 各 64 KiB，且服从 trace 总量 |
| 单事务序列化数据 | 256 KiB |
| 本地待写队列 | 每进程 8 MiB 或 2,000 项，先达到者生效 |
| 全局正文写入速率 | 2 MiB/分钟，突发额度 8 MiB |
| 活动 trace 数 | 每进程 256 |

上限按 UTF-8 字节计算；限制 JSON 深度、属性数、字符串长度、数组项数，处理循环对象。限长保留可解析 JSON，用显式 preview/originalBytes/truncated 字段，不截断 JSON 文本。不得先构建完整巨大 JSON 再截断。

额度优先保留根概要、状态、错误、模型/工具名、耗时、usage；正文先降级到 metadata，随后省略非关键 span。trace 标记 partial，并给出 quota/rate/queue 等原因。活动 trace 和概要预留额度也有界；无法保留新根时记录聚合丢弃计数，不能以“活动记录不可删除”为由无限增长。

### 清理与物理文件控制

1. 启动、每分钟及写入前达到高水位时检查时间、条数、逻辑字节和物理占用。
2. 默认按最旧完成 trace 整棵删除，含 spans/links。达到任一限制即清理，容量回落至低水位。错误记录也服从硬预算。
3. 将 DB 页数通过 max_page_count 限制在空间预算减去 WAL/维护预留的范围；启用 incremental auto vacuum，在受控维护窗口释放空闲页。大规模迁移/重建不在聊天热路径执行。
4. WAL checkpoint 和实际文件大小测量必须独立实现；journal_size_limit 只能辅助，不能当成 WAL 硬上限。查询短事务、分页、超时，避免读者长期阻止 checkpoint。
5. 每次事务前留出最大写放大余量；物理接近预算且 checkpoint/清理不能恢复时暂停正文和新 span 写入，状态显示 storage_paused，继续 Agent 执行。限制事务体积，给增长留下安全余量。
6. 页面分别显示逻辑数据大小与实际 DB/WAL/SHM 大小。256 MiB 是可执行的运行预算；文件瞬时峰值受页/WAL/事务写放大影响，必须通过压力测试测得并保留余量，不能仅靠 DELETE 声称精确字节级硬上限。

只有所属进程实例已停止或其 lease 过期且超过执行期限，才将 running 记录标记 interrupted；不要在一个进程启动时将另一个进程仍在执行的 trace 全部结束。超长/超量任务可以结束采集并标记 partial，不终止业务。

## 6. Langfuse 双写

- 同一 trace/span 身份、脱敏规则和有限正文进入两端，默认远端完整导出所有已采集 span，不做独立随机 span 采样。
- 本地清理和远端保留期相互独立；本地删除不会删除 Langfuse 数据。
- 本地磁盘额度只影响本地 sink；远端也有自己的容量/速率上限。共同的采集上限对两端生效，并说明两端可能因各自故障缺少部分 span。
- 远端队列建议每进程 8 MiB/2,000 spans；5 秒或 100 spans 触发批量发送。每次发送超时 5 秒，指数退避加 jitter，最多重试 3 次或保留 60 秒，先达到者生效。
- 队列满/重试耗尽丢弃并计数，限频记录导出错误；不把业务返回值改成失败。SDK 内部队列也须核验并配置上限，不能只限制外层队列后留下无限内层队列。
- 当前运行状态：disabled、missing_credentials、ready、degraded；最近成功/失败时间、pending/dropped 数量单独展示。ready 表示配置可用，不代表每条记录已经落到云端。
- 第一版不引入持久化 outbox。若未来要求离线补传，新增独立有界 outbox（例如 32 MiB/24 小时），固定目的地配置版本，提供至少一次投递，并先验证 Langfuse 对重复 trace/span 的更新/去重语义。

Langfuse adapter 使用官方 OTel 接入和语义映射；安装时锁定版本。具体 queue/flush 配置名称以锁定版本 API 为准，不在业务层假定 SDK 提供持久化队列。

## 7. 配置与凭证

新增全局 `observability.tracing`，不属于 agents.defaults。示意配置如下，凭证不存入这段配置：

```json
{
  "observability": {
    "tracing": {
      "enabled": true,
      "capture": "redacted",
      "local": {
        "retentionDays": 7,
        "maxStoreMiB": 256,
        "maxTraces": 10000,
        "maxSpans": 100000,
        "maxTraceKiB": 1024,
        "maxWriteMiBPerMinute": 2
      },
      "langfuse": {
        "enabled": false,
        "baseUrl": "https://cloud.langfuse.com"
      }
    }
  }
}
```

Zod 对所有限额设置正整数范围和跨字段约束；不接受 0 表示无限。trace 关闭时停止新采集，保留现有记录并继续清理。

Settings 输入 Public Key 和 Secret Key，由后端调用现有 CredentialResolver 保存。复用 saveApiKey 的 Secret Key 能力，Public Key 如现有结构不支持则扩展服务凭证记录；不把 Langfuse 注册为模型 provider。GET 只返回 configured、masked 值和 source；空 Secret Key 输入表示不修改，删除凭证使用明确删除操作。

支持 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY、LANGFUSE_BASE_URL。优先级为环境变量覆盖已保存值，页面显示覆盖来源；环境变量本身不隐式开启上传，仍需 enabled=true。运行时读取成不可变配置快照。

配置保存后通过 reload 更新服务，不重建全局 OTel provider。固定分发处理器路由到可替换 Langfuse target；每个 trace 开始时绑定配置版本和目标，旧队列在有限期限内按旧目标完成或丢弃，不发送到新账户。禁用远端立即停止新导出并丢弃未发送队列；已经发出的请求只能尽力取消。关闭/切换状态由页面说明。

详细采集为临时覆盖，例如默认 30 分钟，过期自动回到 redacted；遵守 configured capture 和远端上传设置。记录变更时间、配置版本；不记录凭证。

## 8. Settings 与本地排障页面

新增 `#/settings/tracing`，名称“运行追踪”，在日志/用量附近。页面三个区域：

1. 本地记录：开关、保留天数、空间上限、采集等级；高级区域有条数/单 trace/写入速率限制。显示当前空间、最早记录、截断/丢弃数量、存储暂停原因。操作包括清理过期记录和清空本地追踪，后者在 UI 确认且不会影响会话、日志、usage 或远端。
2. Langfuse：启用、Base URL、Public/Secret Key、来源状态；保存、测试连接。测试执行明确命名且不含用户内容的诊断 trace，并尝试有界 flush；仅证明认证/采集端可达，不能冒充 UI 已可查询。
3. 最近执行：时间、Agent、状态、耗时、模型调用数、token/成本；按时间、状态、conversation/run ID、Agent 筛选，分页显示。

详情为固定响应式尺寸的 drawer/dialog，内部滚动；显示 span 树/时间轴、输入输出摘要、错误、usage、截断原因和日志关联。提供 JSON 下载。远端链接仅在能够准确构造项目 trace 地址时提供，不能从 Base URL 猜项目 ID；必要时扩展 projectId 配置。

复用语义 tokens、PopoverSelect、Skeleton 和现有 Settings 布局；加载不使用页面级 spinner。未配置 Langfuse 时直接展示本地记录，远端区域显示“未启用”。

## 9. API

新增认证路由 `/api/observability/*`，避免与已有 `/api/usage/traces/:traceId`（用量记录）混淆：

| API | 用途 |
|---|---|
| GET /api/observability/tracing/settings | 脱敏配置、凭证来源 |
| PATCH /api/observability/tracing/settings | 验证并保存配置、热更新 |
| PUT /api/observability/tracing/langfuse/credentials | 保存凭证 |
| DELETE /api/observability/tracing/langfuse/credentials | 删除已保存凭证 |
| POST /api/observability/tracing/langfuse/test | 无用户内容的连接测试 |
| GET /api/observability/tracing/status | 空间、队列、故障/丢弃、导出状态 |
| GET /api/observability/traces | 游标分页、白名单筛选，不返回正文 |
| GET /api/observability/traces/:traceId | 有界详情和 span 分页 |
| GET /api/observability/traces/:traceId/export | 有界 JSON 下载 |
| POST /api/observability/traces/prune | 清理过期历史 |
| DELETE /api/observability/traces | 清空本地历史；用采集 epoch 防止旧队列重新写回 |

排序游标使用 started_at + trace_id；查询/导出返回一致快照或明确 snapshotVersion，不维持长 SQLite 读事务。Base URL 验证协议和长度，允许自托管地址，连接测试有超时且不跟随携带凭证的跨域重定向。凭证、配置写入和测试沿用严格限流。

实现时必须同步添加 lazy-bundles matcher、正向及相邻负向断言，并通过真实认证 Gateway 验证路由可达。

## 10. 故障和数据边界

- 脱敏在两端分流前执行；Pino 的 redaction 不自动覆盖 trace。过滤 apiKey、Authorization、token、secret 等字段，以及已知凭证值；任意自然语言的敏感信息无法保证全部识别，页面明确采集内容范围。
- 默认不采集附件原始字节/base64、完整文件、音视频、原始网络 headers；仅类型、大小、必要摘要。错误栈与工具参数也有字节上限。
- 本地存储权限跟随 state root；排障导出只含已经脱敏的数据。
- 磁盘满、worker 崩溃、锁超时、损坏：限频日志、暴露状态，暂停/有界重试，Agent 继续。损坏库不自动无限改名保留；恢复文件也计入总额度。
- graceful shutdown 有界等待，例如最多 2 秒本地 flush、3 秒远端 flush。强制退出可能丢失内存中的 span，已持久化根概要可用于识别 interrupted。
- 第一版不是可靠审计系统，也不提供精确重放模型请求；被截断或清理的数据不能恢复。

## 11. 实施顺序与验收

1. TraceRuntime、标准身份与日志/usage 关联；接 run、generation、tool，补并发与终止路径。
2. 本地 worker/store、版本迁移、quota/清理/物理空间维护和查询 API；无 Langfuse 的完整排障流程先可用。
3. Settings 与详情/导出；Langfuse 凭证、双写、测试连接和热切换。
4. 补 compaction、委派、其他辅助调用；按压力结果调默认预算。

必要验收：

- 同会话/不同会话并发、并行工具不串 trace；实际每次模型请求恰好一个 generation，无双层 usage 包装重复埋点。
- 流式输出和原调用结果不变；throw、abort、fallback、暂停/恢复都有正确结束状态。
- 无主库连接的 CLI 仍能本地采集；双端故障互不影响、业务正常。
- 单条超大参数、深层 JSON、长工具输出均有界；token 流不逐项写盘。
- 时间、数量、字节、速率、活动 trace/内存队列上限均测试；多进程争用不能超卖额度。
- 持续写入与并发读取下测量 DB+WAL+SHM 实际峰值，验证 checkpoint 被阻塞时停止写入；清理后空间可回落。
- 凭证不进入配置 GET、日志、trace、导出；环境变量覆盖来源正确；换账户不误投递旧数据。
- 清空后旧队列不重建已清理历史；usage/transcript 保留完整。
- 认证 Gateway route/lazy mapping 实测，Settings typecheck/build 和关键交互验证。
- 本地/Langfuse 同一测试 trace 的 ID、树、usage 一致；过滤器不丢父节点，远端失败/队列满状态可观察。

## 12. 参考

- [Langfuse tracing 接入](https://langfuse.com/docs/observability/get-started)
- [手动埋点、上下文和 trace ID](https://langfuse.com/docs/observability/sdk/instrumentation)
- [过滤、脱敏和 TTFT](https://langfuse.com/docs/observability/sdk/advanced-features)
- [OTel 接入及语义映射](https://langfuse.com/integrations/native/opentelemetry)

Langfuse 接口行为依据上述官方资料；本地数据库、额度、页面和 API 为 xopc 本方案设计。

## 13. 第一版实现说明
+
+已实现默认本地采集、独立 SQLite worker、额度与清理、run/generation/tool/compaction/model attempt 埋点、usage 的 OTel 关联、认证懒加载 API 和 Settings 运行追踪页面。
+
+远端采用有界 OTLP/HTTP JSON 导出适配器，发送到 Langfuse 官方 `/api/public/otel/v1/traces`，携带 v4 ingestion header；不额外安装 Langfuse SDK，不存在 SDK 内部隐藏队列。HTTP 最多三次发送尝试。更换目标/凭证或禁用时关闭旧 target 并丢弃未发送队列，旧活动 trace 的后续 span 不会误投新账户；同一目标的普通额度调整保留 target。
+
+本地空间预算为 DB+WAL+SHM 总预算。数据库页数限制约为 `(maxStoreMiB - 4) / 2` MiB，给 WAL 的最坏写放大预留空间；因此可保留的正文数据小于页面设置的总空间。每次写入与事务额度检查均在 worker 执行，当前按 span 提交短事务。正文限额还会降级为 metadata。时间清理每分钟执行，清空通过持久化 epoch 阻止旧 root/span 回写。
+
+第一版详情提供 span 树、各调用耗时、属性/usage、JSON 导出；未提供跨进程 W3C 上下文恢复、恢复执行 span links、图形时间轴、远端项目深链接和持久化 outbox。同步工具内部及嵌套执行使用 OTel async context 继承关系，独立执行创建新的 root。详细采集 30 分钟后降级为摘要。
+
+验证包括临时目录 SQLite、并发 run/工具、截断/脱敏、清理 epoch、远端本地模拟采集端、断网失败隔离，以及认证 HTTP + lazy fallback 的真实网络请求。尚未使用真实 Langfuse 账户进行上线验收。
+EOF
python3 - <<'PY'
p='docs/design/technical/local-tracing-langfuse.md';s=open(p).read().replace('状态：设计提案，尚未实现。','状态：第一版已实现，落地范围及差异见第 13 节。');open(p,'w').write(s)
PY
pnpm -C web run type-check > /tmp/xopc-tracing-webcheck.log 2>&1