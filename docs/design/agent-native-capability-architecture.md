# xopc Agent 原生能力架构：最终技术方案

日期：2026-09-21。状态：分阶段实施中，实际覆盖见[实施账册](./agent-native-capability-progress.md)。配套：[分阶段实施与验收](./agent-native-capability-delivery-plan.md)。

本文将 Agent-Native 调研收敛为 xopc 自有架构。所有新增接口、表和文件均为目标设计，不表示当前实现。采用最终契约分阶段交付，每阶段产物直接进入最终架构，不设一次性 PoC，也不要求全库同时切换。

## 1. 目标与边界

目标是让同一业务操作被用户界面、Agent、CLI、自动化、渠道和 MCP 安全、一致地调用，并让 Agent 理解用户当前正在处理的对象。交付价值通过接入成本、跨入口一致性、上下文准确率和副作用恢复质量衡量。

保留 Node.js、pi-agent、Hono、SQLite、React、SWR、现有 WebSocket realtime，以及现有 Session／Task／TaskRun／Scene／Workflow 的领域职责。新增统一能力执行边界，不引入第二套 Agent Runtime、任务编排器或数据真相源。

最终范围包括：能力契约与执行器、调用身份与授权、审批绑定、持久执行记录、业务变更事件、页面上下文、结构化结果、显式 MCP 暴露、Local App 能力包。A2A、跨主机联邦、多人组织、云端数据库和任意生成代码执行不是本轮完成条件；契约为后续适配保留版本边界。

本方案不改变 [Slack 开发事项方案](./ai-native-scenes-product-technical-design.md) 的业务范围和发布门禁。Scene 继续拥有持续委托，Task 拥有工作目标，TaskRun 拥有执行尝试；能力层只负责一次可识别操作的调用语义。现有 Slack 交付可以继续，新架构按本文阶段接入。

## 2. 已核实的实现基础

| 已有实现 | 结论与复用方式 |
| --- | --- |
| `src/agent/tools/xopc-use-tool.ts` | 已聚合 Scene、Project、Automation、Note、Task、TaskRun、Local App、Settings；保留工具入口，分支逐项转发到注册能力 |
| `src/tasks/task-application-service.ts` | 已有命令幂等、版本校验和事务；复用领域服务，不在能力层重新实现状态机 |
| `src/tasks/task-change-events.ts` | 已写入 `domain_outbox`；扩展关联信息及消费者，不另建平行变更总线 |
| `packages/gateway-contract/src/product-delivery.ts` | 已有 ProductReference、ProductDeliveryEnvelope 和深链；结果协议扩展它们 |
| `src/gateway/side-chat/context-snapshot.ts` | 已支持选中文本／消息／文件范围／diff 快照；将校验与来源语义收敛到通用上下文协议 |
| `packages/gateway-contract/src/session-input-reliability.ts` | 输入指纹已有 contextRefs/browserContexts；新上下文快照必须参与输入幂等比较 |
| `src/agent/tools/metadata.ts`、`executor.ts` | 已有副作用范围、并发、幂等重试和超时；新能力映射到这些机制，消除重复重试所有权 |
| `src/agent/external-tools/types.ts` | 已有 search/describe/execute、工具修订和来源；复用懒发现，不把整个能力目录塞入模型 |
| `src/endpoint-tools/invocation-service.ts` | 已有调用身份、参数哈希和策略；通过 adapter 关联已有调用，不旁路设备策略 |
| `src/extensions/types/core.ts` | tool、HTTP、CLI、command 分别注册；增加 capability 注册入口，迁移已覆盖的业务操作 |
| `web/src/features/chat/messages/assistant-steps-block.tsx` | 已有 ExtensionChatWidget；保留并补齐一方结构化 renderer |
| `src/local-apps/` | 已有预览、权限、发布、回滚和验收；扩展包契约和双入口验收 |

以上是当前工作树的只读核查结果，包含正在开发的代码。不存在“从零补齐所有能力”的前提，也不能由检索局部代码推断所有外部操作已经具备完整防重放保障。

## 3. 分层与模块归属

```text
React / CLI / Agent / Automation / Channel / MCP / Extension bridge
                               ↓ 身份适配与协议解码
                 Capability Dispatcher（统一执行边界）
        registry → schema → policy → approval → invocation → result
                               ↓
                 现有领域 Application Service
                               ↓
         SQLite 事务 / domain_outbox / Connector 或 Endpoint runtime
                               ↓
                 Realtime → SWR → 产品卡 / 业务页面
```

目标目录：

| 位置 | 责任 |
| --- | --- |
| `packages/gateway-contract/src/capabilities/` | 可跨端共享的能力描述、调用请求、结果、错误和版本类型，不包含执行函数 |
| `packages/gateway-contract/src/app-context.ts` | 页面语义、上下文快照、导航命令协议 |
| `src/capabilities/runtime/` | registry、dispatcher、身份策略适配、审批、调用账本、恢复 |
| `src/capabilities/adapters/` | Agent／HTTP／CLI／automation／MCP／extension 接入 |
| `src/<domain>/capabilities/` | 领域能力定义，调用既有服务；领域服务不得反向依赖 dispatcher |
| `src/gateway/app-context/` | 页面上下文接收、解析、权限过滤和快照 |
| `web/src/features/capabilities/` | typed client、SWR hooks、结果 renderer、变更失效 |
| `web/src/features/app-context/` | 页面上下文 provider、选区、导航消费 |

`src/capabilities/readiness` 继续描述环境可用性；`src/agent/capabilities` 继续描述 Agent 工具组合。它们不是业务能力注册表，不能仅因名称相似合并。

所有 Gateway 模式调用均由 Gateway 持有的 dispatcher 执行；CLI 在 Gateway 模式下通过认证 API 调用，已有独立 CLI 模式使用同一执行器与明确的本机身份。不能伪装为 Gateway 管理员，也不新增绕过现有数据库写者约束的后台进程。

## 4. 能力契约

### 4.1 身份、Schema 与版本

业务能力 ID 使用 `xopc.<domain>.<verb>`，扩展使用 `extension.<extensionId>.<verb>`，避免与已有工具名冲突。协议版本、能力 major version、descriptor digest、Local App release digest 分开管理。破坏性输入／输出变化升级能力 major；在途调用固定版本与实现发布版本。

公共契约沿用 gateway-contract 的 Zod 4；现有 Task 等 Zod Schema 直接复用。能力输入限制为可无损导出 JSON Schema 的 JSON 子集，不使用 transform、任意实例或只在一端执行的 coercion。跨字段业务校验进入服务端 preflight；AgentTool 的 TypeBox/JSON Schema 结构由适配器生成，禁止人工维护第二份业务 Schema。动态扩展使用受限 JSON Schema，由宿主统一校验。

设计接口如下，具体 TypeScript 泛型在第一阶段冻结：

```typescript
interface CapabilityDefinition<Input, Output> {
  id: string;
  majorVersion: number;
  description: string;
  input: InputSchema<Input>;
  output: OutputSchema<Output>;
  effect: 'read' | 'local-write' | 'external-write' | 'destructive';
  surfaces: CapabilitySurface[];
  requiredScopes: GatewayScope[];
  resourceAccess: ResourceAccessResolver<Input>;
  concurrency: ConcurrencyPolicy<Input>;
  recovery: 'transactional' | 'provider-key' | 'verify-first' | 'manual';
  approval: ApprovalPolicy<Input>;
  resultKind: RegisteredResultKind;
  preflight: PreflightHandler<Input>;
  execute: ExecuteHandler<Input, Output>;
  reconcile?: ReconcileHandler<Input, Output>;
}
```

每个定义明确列出 surfaces，默认空列表。`read` 与 HTTP GET 不互相推导；surface 可见不代表有执行权限。`unknown` 副作用只允许出现在外部适配的未分类描述中，按保守写操作处理，不能假装只读或自动重试。

`preflight` 只做校验和变更预览，不能通过执行再回滚来模拟；不支持可靠预览的能力明确返回 unsupported。预览不承诺后续一定成功，真正执行仍检查对象版本和授权。

### 4.2 调用上下文

可信上下文由宿主生成：principalId、credential/device identity、source surface、Agent/delegation chain、conversationId、logicalTurnId、runId、TaskRunId、requestId、operationId、policyRevision、account/resource scope、deadline 和 abort signal。

浏览器只提交输入、客户端重试键及可验证的上下文引用。不得提交可信 principal、scopes、approved=true、调用来源或 delegation。渠道通过现有身份／配对映射；MCP 从认证凭证映射；自动化使用持久授权快照并在执行时复核撤权。

有效权限是调用主体、设备、Agent、Scene／Task、扩展授权、资源和账号权限的交集。`gateway.admin` 不能隐式绕过 Scene 的委托范围。UI 人工点击可以构成具体操作意图，但不能豁免权限，也不能通过伪造 `surface=ui` 豁免审批。

### 4.3 单一执行入口

执行顺序固定为：解析能力及修订 → 输入校验 → 身份与资源授权 → 绑定／查询 operation → 审批判断 → 获取执行租约 → 重新核查撤权与对象版本 → 领域执行 → 持久结果及事件 → 协议投影。

返回已完成 operation 也必须先重新核查读取结果的权限，避免撤权后通过幂等缓存泄露数据。普通 input validation 失败不创建可执行 operation，留下有界诊断即可。

HTTP／Agent／MCP 等 adapter 不包含业务分支。`execute` 仅由 dispatcher 调用，CI 约束跨目录直接调用。领域服务可组合内部纯操作，但复合能力不得递归取得更高权限；外部副作用拆成可记录的子 operation，并继承根操作及授权范围。

### 4.4 结果和错误

调用结果区分 `succeeded / pending / waiting-approval / failed / unknown / cancelled`，携带 invocationId、operationId、能力版本、结构化 data、已有 ProductDeliveryEnvelope、变更引用和必要恢复提示。业务异步任务接纳成功只代表已派发，任务是否完成仍由 TaskRun／Workflow 状态决定。

错误码至少包括 `INVALID_INPUT / FORBIDDEN / NOT_FOUND / REVISION_CONFLICT / APPROVAL_REQUIRED / CONTRACT_CHANGED / IN_PROGRESS / RATE_LIMITED / UNAVAILABLE / OUTCOME_UNKNOWN / CANCELLED / INTERNAL`。HTTP 依次映射合适的 400/403/404/409/202/429/503/500；Agent adapter 按 pi 契约抛出真实失败，等待审批作为明确控制结果处理，不能把失败包装为普通成功文本。CLI 使用非零退出码表达失败，MCP 使用协议错误标记及结构化结果。

## 5. 幂等、审批与恢复

### 5.1 操作身份不等于参数哈希

参数相同的两次合法操作可能都应该执行，例如用户明确要求再发一次消息。因此不能用全局“工具名 + 参数”直接去重。

采用三种身份：requestId 标识一次传输；operationId 标识一次业务意图、跨重试稳定；invocationId 标识一次实际尝试。幂等唯一键为 `(principalId, capabilityId, majorVersion, idempotencyKey)`。同键同输入复用；同键不同输入返回冲突。

Agent 首次工具调用前由宿主持久分配 operation。恢复优先使用 transcript 中的工具调用身份与绑定；模型重新生成不同 toolCallId 时，在同一 logicalTurn 内用参数摘要寻找候选，但只能在唯一对应且未消费的情况下重新绑定。重复意图有歧义则先核实，不能自动重跑写操作。跨 turn 的相同参数默认是新意图。

摘要使用校验后 JSON 的稳定键排序和 SHA-256；缺省值在公共 Schema 层统一处理，拒绝非 JSON 值。账号、资源、能力修订及会影响执行的输入均参与摘要。敏感输入不明文进入普通审计；恢复所需私密 payload 使用现有受保护存储策略或加密引用。

### 5.2 持久记录

逻辑存储模型如下，物理迁移号在实现时根据最新 migration runner 分配，不预占当前开发中的编号。

| 表／既有存储 | 必要字段与约束 |
| --- | --- |
| `capability_operations`（新增） | operationId、principal、capability/version/digest、幂等键、inputDigest、payloadRef、logicalTurn、TaskRun、状态、resultRef、effectReceipt、policyRevision、时间；幂等唯一约束 |
| `capability_invocations`（新增） | invocationId、operationId、attempt、leaseOwner、fencingEpoch、leaseExpiresAt、开始／结束、failureClass、externalReceiptRef；operation+attempt 唯一 |
| 审批记录（适配已有等待／审批存储） | operation、输入摘要、资源／账号、版本、授权修订、期限、决策者及消费状态；缺少字段时增量扩展，不再建第二个用户审批收件箱 |
| `domain_outbox`（复用） | eventId、业务对象版本、operation/invocation 关联、最小失效 payload；同一事务提交 |
| transcript（复用） | operation 引用和面向模型的结果投影；不是幂等真相源 |

事务内本地写：operation 占用、业务写入、结果回执与 outbox 必须处于同一个 SQLite 事务。Task 等领域已有幂等记录时复用相同 operation key 并关联，不创造互相冲突的完成状态。不得在 SQLite 事务中 await LLM 或网络。

外部写：先提交 executing 状态和稳定 provider idempotency key，再发请求，最后提交回执与结果。网络与本地数据库不能原子提交，因此不宣称全局 exactly-once。

### 5.3 状态与恢复规则

```text
prepared → waiting-approval → ready → executing → succeeded
    └──────────────→ ready             ├──────→ failed
                                      └──────→ unknown → reconcile
prepared / waiting-approval / ready → cancelled
```

执行中收到取消只表示 cancellation requested。确认未产生副作用才标 cancelled；结果已成功则记录成功及取消请求时间；结果不可确定标 unknown。超时也不等于失败。

| 恢复模式 | 重启／断线后的行为 |
| --- | --- |
| transactional | 已提交返回记录；未提交回滚后以原 key 重试，重新检查权限 |
| provider-key | provider 明确保证 key 有效且范围匹配时，以原 key 查询／重试；超过保留期限转核实 |
| verify-first | 调用 reconcile 根据外部回执／对象查询；确认未发生才重试，确认成功补记结果 |
| manual | 呈现结果未知及核查入口，阻止无人值守重发 |

租约只能防止本地并发提交。fencingEpoch 拒绝旧执行者写回本地，但无法撤销已经在外部发出的请求。接管外部 unknown 操作不得仅依据租约过期。外部系统无幂等和可查询回执时只能保留未知状态。

如果业务已成功而输出 Schema 校验／序列化失败，记录副作用回执并转 `unknown`（带 committed 证据及 result-invalid 原因），通过 reconcile 重建结果；不能作为普通失败自动重新执行。成功结果过大则保存结果引用，不能因截断丢失恢复凭据。

### 5.4 审批与重试所有权

审批绑定 operationId、输入摘要、账号／资源、能力版本和授权修订，具备期限及原子消费语义。修改参数、切换账号、升级实现或撤销授权使旧审批失效。重试同一 operation 不重复弹审批，但执行前始终复核权限。已有 connector/endpoint 审批由 policy adapter 协调，禁止双重提示，也不能忽略底层更严格要求。

新能力的重试仅由 dispatcher 拥有。现有 ToolExecutor 继续提供截止时间、signal 和并发适配，对已托管能力关闭其通用 retry。只读能力可按策略有限重试；外部未分类工具、shell 和电脑点击不因接入能力层自动变为幂等操作。

保留 operation 去重凭据至少覆盖恢复和 provider key 有效窗口，终态 payload 可按现有隐私策略删除，保留最小 tombstone；未决 operation 不自动清理。用户删除敏感内容时同步处理 payload、UI 快照及 transcript 引用，不让审计成为隐性内容副本。

## 6. 页面上下文与导航

### 6.1 协议与隔离

`AppContextEnvelope` 使用 version、clientInstanceId、tabId、monotonic sequence、surface、resourceRefs、selection、capturedAt；资源引用复用 ProductReferenceLocator 并增加 revision。route 只作显示辅助，不能作为权限或任意导航依据。

上下文隔离键为 `(principalId, clientInstanceId, tabId)`。页面只同步语义变化，300ms 合并；轻量状态可使用 TTL 内存缓存。提交用户输入时携带完整、不可变的 context snapshot，由服务端校验并随输入持久化，避免更新与提交的竞态。背景任务使用启动时快照，不读用户另一台设备的“当前页面”。

默认边界：最多 20 个资源引用，选中文本合计 16K 字符，envelope 64KiB；内容超限要求明确附件／资源引用，禁止静默声称完整。Side Chat 的既有更大选区按其独立限制保留，由通用解析器标明 truncation／availability，不扩大通用页面上下文预算。

### 6.2 读取与执行

`xopc.context.resolve` 按快照 ID 或当前已绑定 tab 返回授权对象和有界摘要。资源正文通过领域读取能力取得；浏览器提供的文本是用户附带资料，不是可信数据库状态或新增授权。未保存草稿明确标 draft，不能覆盖持久对象。

上下文进入输入指纹、排队请求和 transcript context rows。模型运行开始只固定本轮快照；用户随后切页不会把“修改这条”偷偷指向另一条。写操作使用 snapshot 的 expectedRevision，冲突后重新读取并解释变化。

后台自动化没有页面也应正常工作：显式资源引用是主要入口，UI context 是便利信息。Side Chat 保留其临时会话生命周期，不为通用上下文把整段父会话重复持久化。

导航采用服务端校验的 ProductReference + commandId + target client/tab + TTL + sequence。只允许本 App 已注册目的地，消费一次并返回 ack；tab 已离开原上下文时显示可点击链接，避免后台 Agent 抢走用户当前工作页面。需要导航行为的能力单独声明 surface 和授权。

## 7. 实时同步与结果 UI

领域服务拥有变更事实。dispatcher 关联 operation，但不再次发同一领域事件。提交后由现有 outbox 投递 `resource.changed` 的规范化投影，携带 eventId、资源 ID、revision、集合失效标签和 operationId。

现有 WebSocket topic 授权保持生效；SWR 根据资源／集合标签失效，不全站刷新。乱序旧 revision 不覆盖新值；断线重连有可用持久 cursor 时补取，cursor 失效则刷新当前订阅数据。事件只有失效信息，不携带无权读取的对象正文。乐观更新收到冲突后回滚并重新读取。

优先注册 task、approval、table、diff 四类一方 renderer，复用 ProductDeliveryEnvelope 和 TurnOutcome 产物。调用日志仍保留执行过程，结果卡呈现对象；依据 operationId 去重，刷新聊天不会重复结果卡。

交互卡中的写按钮调用同一 capability，携带新的用户操作键和对象版本。旧卡不能携带永久批准标记。无 renderer／旧版本／Telegram／CLI 使用文本与深链降级，结构化输出不是唯一可访问途径。

已有 ExtensionChatWidget 保持 iframe 隔离；renderer 只接受受校验数据，不允许能力描述指定任意 React 源码或脚本 URL。动态生成 HTML 沿用现有受控预览，后续另作产品能力，不作为本轮交付依赖。

## 8. API 与各入口

目标 HTTP 路由：

| 路由 | 语义 |
| --- | --- |
| `GET /api/capabilities/operations` | 当前身份可发现的操作目录；与现有 connectors 市场子路由隔离 |
| `GET /api/capabilities/operations/:id` | major/revision 对应的描述与 JSON Schema |
| `POST /api/capabilities/operations/:id/invocations` | 提交 `{ majorVersion, descriptorDigest, input, idempotencyKey, contextSnapshotId? }`；同步结果或 202 |
| `GET /api/capability-invocations/:id` | 读取本身份有权访问的状态与结果 |
| `POST /api/capability-invocations/:id/cancel` | 请求取消并返回真实取消状态 |
| `PUT /api/app-context/clients/:clientId/tabs/:tabId` | 校验主体绑定后更新当前语义状态；拒绝倒序 |
| `POST /api/app-context/snapshots` | 生成已校验的不可变快照；输入提交也可在同事务生成 |

审批提交复用现有 clarification／connector／Task wait 的用户入口，经 adapter 绑定 operation；不先发明新的通用审批 API。跨 capability 读取必须按实际资源权限过滤。

新路由同时更新 lazy-bundles、gateway scopes 及正负匹配测试。通用 capability 入口不能被简单映射成一个宽泛写权限：Gateway 认证后 dispatcher 必须检查描述中的实际 scopes 和资源边界；默认拒绝。列表／状态入口分别做描述过滤与操作归属校验。

既有 `/api/tasks`、`/api/notes` 等保留请求／返回格式，由 route adapter 调用 dispatcher；新 Web typed client 使用生成目录和共享 envelope。URL、旧客户端返回类型和深链不必因内部归一而改变。

`xopc_use` 保留公共工具名与 mode/command 调用兼容性，内部根据静态映射调用 registry；错误语义按 pi 执行契约修正。外部工具继续走 search/describe/execute，按需解析能力，显式账号和 descriptor revision 保持传递。

CLI 新增 `xopc capability list/describe/call/status`，不强制重写既有业务命令；旧命令迁移为 adapter。Automation 使用固定能力版本的 typed action，运行 key 来自 automation/run 身份；自然语言任务仍通过现有 Agent。

MCP 新增与现有 channel bridge 并列的 capability server 接入模式。沿用现有 bridge 认证和 Gateway client；只暴露显式允许 MCP 的能力，认证身份逐调用检查。现有 `xopc mcp serve` 渠道语义保持兼容。首次启用以 Notes／Tasks 的受限目录验收，不能自动暴露全部本机管理操作。

## 9. Local App 与扩展

扩展 manifest 增加版本化 capability contributions：id/version/schema digest、显式 surfaces、资源命名空间、所需 scopes、resultKind、context provider、验收场景。宿主校验重复 ID、版本兼容、权限变化和实现来源。运行时注册必须与 manifest 对齐。

统一 SDK 提供 `capability.call/describe`、`context.publish` 和受控 `resource.open`。iframe bridge 使用宿主签发的 instance identity 绑定 extension/release/principal；服务端按已保存 grant 校验，不能信任 iframe 自报 extensionId 或权限列表。沿用 manifest digest 授权，新增权限必须重新授权。

执行信任等级固定：一方能力在 Gateway 进程运行；已受信任的 Node 扩展保持既有信任等级，明确它并非隔离沙箱；Agent 生成的 Local App 默认只包含 UI、声明式绑定和受控能力组合，不允许把生成的服务端 JS 加载进 Gateway。任意第三方后端代码隔离是独立工程，不以 `worker_threads` 或 worktree 冒充安全边界。

Local App 发布原子固定 UI、manifest、能力绑定、Schema 和验收结果的 release digest。在途 operation 固定原 release；缺失原实现时中止／核实，不能换新版继续写。回滚恢复代码和契约绑定，不逆向回滚业务数据；迁移采用向前兼容，并声明最低可运行数据版本。

验收不仅检查页面存在：同一业务动作分别从 UI 和 Agent 入口执行，结果一致、权限一致、状态同步；另测撤权、版本冲突和重试。现有 Local App sourceHash 验收记录扩展能力契约摘要，防止修改实现后复用旧验收。

## 10. 可观测性、性能和发布

日志使用既有 createLogger，稳定前缀 `CapabilityDispatcher`／`CapabilityRecovery`，关联 requestId、operationId、invocationId、conversationId、TaskRunId、capability、surface 和阶段。普通日志不记完整输入、选区或凭据。

指标包括每能力调用耗时、授权拒绝、审批等待、重放复用、未知结果、恢复耗时、版本冲突和 outbox 延迟。operationId 仅用于追踪，不作为无限基数指标标签。

性能验收采用同机器、同数据集相对基线：本地小输入能力执行开销 p95 目标增加不超过 10ms（不含领域操作／磁盘结果读写）；页面语义更新合并上限每 tab 约 3 次/秒；读取不调用模型；能力发现按当前 scope 懒加载。此处是验收目标，不是已有性能结论，超标必须定位并记录调整依据。

按领域切换到新 dispatcher，切换单位必须覆盖该领域的全部写入口；禁止 HTTP 走新路径而 Agent 继续绕过同一操作。可对只读调用 shadow 比较，写操作不能双执行。回退只回退入口适配，新增表保留，未决操作保持由新恢复器处理；存在未决外部写时禁止降级到无法理解它的旧二进制。

迁移前备份 SQLite 并进行版本兼容检查。不改既有 conversation UUID、不重写 transcript 历史、不抹除 Task／Scene 运行记录。已经过期的旧审批按旧处理器完成或明确失效，不能自动升级为新授权。

## 11. 参考与设计判断

- [Agent-Native Actions](https://www.agent-native.com/docs/actions-overview/)：借鉴一次定义、多入口适配。
- [Access & Authorization](https://www.agent-native.com/docs/actions-access-control/)：借鉴授权、暴露和人工确认分离；xopc 默认显式暴露并保留现有身份边界。
- [Context Awareness](https://www.agent-native.com/docs/context-awareness/)：借鉴语义页面上下文；xopc 加入 tab 隔离和输入时快照。
- [Durable Resume](https://www.agent-native.com/docs/durable-resume/)：借鉴执行记录与硬性防重放；xopc 以业务 operation 为主键，参数摘要只辅助恢复匹配。
- [Generative UI](https://www.agent-native.com/docs/generative-ui/)：借鉴结构化组件与生成 iframe 的区别，优先扩展已有产品结果协议。

最终取舍：共享契约和执行保证必须集中，领域规则、任务编排和外部系统能力仍留在原有所有者中。每阶段的代码、验收和迁移都服务上述最终边界。
