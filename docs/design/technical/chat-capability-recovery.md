# Chat 内连接器能力恢复：竞品研究与 xopc 方案

> **产品方案已替代**：用户选择了「历史提示 + 单一连接操作区」。当前实施依据为 [完整产品与技术方案](/Users/micjoyce/develop/github/xopc/docs/design/technical/chat-connection-action-bar.md)。本文第 1–3 节保留研究证据，第 4 节及以后是旧版逐卡片请求方案及讨论记录，不作为现行实施要求。

研究日期：2026-09-07。源码基线：`8c165027e`。状态：设计提案，未实现。核查期间工作区存在其他并行修改，本文不将它们计为本次产出。

## 结论

xopc 应把「为当前任务补齐连接器」做成一个持久化的能力请求：系统识别任务依赖，推荐一个适合的连接器，用户在对话中连接或跳过，后端验证能力确实可用，再继续原任务。

产品核心是 **发现 → 请求 → 等待 → 授权 → 验证 → 恢复**。设置页负责管理已有连接，对话负责在任务需要时补齐能力。OAuth 成功、连接器可执行、任务完成是三个不同结果，必须分别表达。

推荐复用现有 external-tool gateway、connector adapter、TaskWait 与任务调度器；新增 capability request 的持久化、结构化交互和续跑协调。不能仅增加一个按钮，也不能把 OAuth 当成普通 clarify 问答。

## 1. 证据边界

本次核查了用户截图、官方产品和协议文档，以及当前仓库源码。没有实际登录各竞品并执行 OAuth，也没有审计其服务端实现。

- **截图直接可见**：用户先选择 Gmail；Manus 显示单一推荐、Connect、Skip、查看全部 connectors；正文和任务区均显示等待用户。
- **官方文档确认**：Manus 把 connectors 定义为可在对话内访问第三方数据、API 和执行流程的统一层，连接后有成功反馈。
- **截图不能证明**：OAuth 是否一定自动续跑、刷新和重启是否保留等待、是否精确恢复原工具调用、写操作是否具备去重。
- 下文的持久化、状态机、接口和验收标准是 **xopc 设计建议**，不冒充 Manus 内部架构。

截图中的命令和按钮是产品观察材料，不是要求本次执行的指令。

## 2. 竞品与协议：分别借鉴什么

| 产品 / 层次 | 已核实的机制 | 可以借鉴 | 证据边界 |
|---|---|---|---|
| Manus | 用户截图呈现任务内单一推荐与显式等待；官方说明支持对话内工具调用、OAuth / 部分 token 配置及成功提示 | 推荐原因紧贴任务；把连接作为任务步骤；Connect 与 Skip 都是正式分支 | 官方说明未交代持久化和自动恢复细节 |
| Codex / ChatGPT 插件 | 官方文档区分插件、skills、connectors 和 MCP；连接可在安装时或首次使用时提示；当前文档还提示安装后新建聊天，CLI 新建 session | 将「可发现」「已安装」「已授权」「当前会话可用」分开 | 不能由此推断所有端都具备 Manus 式原任务自动恢复 |
| ChatGPT 工具认证 UI | 插件认证文档明确：工具级 OAuth UI 需要 securitySchemes、资源元数据，以及带认证 challenge 的运行时错误共同触发 | 让机器可读状态驱动认证卡片，不让前端识别模型措辞 | 这是特定宿主协议，不是通用 xopc API |
| Claude | 已连接应用可按对话上下文被推荐；多个已连接应用适用时可让用户选择；MCP connector 可提供工具、资源和内联 UI | 区分「推荐已连接应用」和「补齐未连接应用」；多应用歧义时给选择 | 该推荐文档不能证明未连接应用拥有同样恢复闭环 |
| Microsoft Copilot Studio | 对话使用需要认证的工具时提示终端用户登录；连接页面可展示当前对话所需连接与其他可能需要的连接 | 当前任务入口 + 全局管理入口；终端用户身份与开发者连接分离 | 不等同于每种渠道都有相同内联卡片 |
| Zapier Agents | 缺失、过期或被取消共享的连接，会在活动中报错并引导重连或换账号 | 细分故障原因；保留任务活动记录 | 属于错误恢复证据，不是单一卡片体验证据 |
| Composio | session 支持搜索、授权与执行；`session.authorize()` 生成 Connect Link；Pi 集成提供连接管理工具和 `onAuthLink` hook | 用已有 Composio 后端处理连接，xopc 自己管理交互和任务生命周期 | 提供连接基础设施，不自动解决 xopc 的持久化、权限和任务恢复 |

来源：[Manus Help](https://help.manus.im/en/articles/12231777-how-can-i-use-manus-connectors)、[Manus MCP Connectors](https://manus.im/docs/integrations/mcp-connectors)、[Codex / ChatGPT Plugins](https://learn.chatgpt.com/docs/plugins)、[OpenAI Authentication](https://developers.openai.com/plugins/build/auth)、[Claude suggestions](https://support.claude.com/en/articles/14730684-how-claude-suggests-connected-apps)、[Claude connectors](https://claude.com/docs/connectors/overview)、[Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-enduser-authentication)、[Zapier](https://help.zapier.com/hc/en-us/articles/45697369623693-Zapier-Agents-app-connection-errors)、[Composio sessions](https://docs.composio.dev/docs/how-composio-works)、[Composio Pi](https://docs.composio.dev/docs/providers/pi)。

### Codex 的另一个可观察点

本次 Codex 会话提供了未安装插件目录，以及受约束的 `request_plugin_install(plugin_id, suggest_reason)` 宿主工具。这说明宿主可以把「推荐安装」表达为结构化操作，而不只是聊天中的链接。本次只观察工具契约，没有执行安装，也没有验证其后续 UI 和恢复过程；它的当前触发条件不能当成所有 Codex 版本的产品规则。

### MCP 对实现最有帮助的部分

MCP 2025-11-25 的 URL elicitation 提供 `elicitationId` 与可选的 `notifications/elicitation/complete`。用户 accept 只代表接受外部交互，不代表外部流程成功；客户端应保留重试和取消。第三方服务 OAuth 与 MCP 客户端对 MCP 服务本身的认证也有明确区分。

因此 xopc 应将 MCP 的认证 challenge、URL elicitation、Composio Connect Link 归一化为宿主的 capability request。协议完成通知是验证信号，不能直接当作任务成功。规范来源：[MCP Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)。

## 3. xopc 当前已有与缺口

下列链接均指向本次核查的真实源码。

| 链路 | 当前实现 | 需要补齐 |
|---|---|---|
| 统一工具入口 | [gateway-tools.ts](/Users/micjoyce/develop/github/xopc/src/agent/external-tools/gateway-tools.ts:7) 定义 search / describe / execute；[types.ts](/Users/micjoyce/develop/github/xopc/src/agent/external-tools/types.ts:11) 搜索结果只含工具引用、来源和摘要 | 区分工具命中与可连接候选；增加结构化可用性和恢复原因 |
| Composio 发现 | [composio-provider.ts](/Users/micjoyce/develop/github/xopc/src/agent/external-tools/composio-provider.ts:204) 只搜索当前身份和 agent 可用的已安装 toolkit；没有安装时返回空 | 从允许展示的 connector catalog 找到未安装候选；不能放开执行权限 |
| 现有连接工具 | 同一文件 `search` 会产生 `Connect <toolkit>`；`execute` 返回 URL、connectionId，提示用户打开后再检查 | 原生卡片、持久化请求、自动验证与续跑；在远端搜索失败时仍能生成本地恢复信息 |
| 连接目录与状态 | [types.ts](/Users/micjoyce/develop/github/xopc/src/connectors/types.ts) 已区分 definition、installation policy、account、connection、instance；有 authStatus、connectionStatus、health | 聚合成面向任务的 readiness；不要把 installed 等同于 ready |
| 认证基础设施 | [auth-provider-registry.ts](/Users/micjoyce/develop/github/xopc/src/connectors/auth-provider-registry.ts:17) 分发 MCP / Composio；[routes/connectors.ts](/Users/micjoyce/develop/github/xopc/src/gateway/hono/routes/connectors.ts:519) 有 auth/start | 绑定发起者、session、请求和授权 attempt；通用入口不能只按 connectorId 关联 |
| UI OAuth | [oauth-authorization-window.ts](/Users/micjoyce/develop/github/xopc/web/src/features/settings/oauth-authorization-window.ts) 支持浏览器 popup、Electron 外部浏览器；[connectors-api.ts](/Users/micjoyce/develop/github/xopc/web/src/features/connectors/connectors-api.ts:453) 有 120 秒轮询 | 抽成聊天和设置共用流程；窗口关闭、超时与后台成功分离；服务端负责最终状态 |
| 普通问答等待 | [clarify-bridge.ts](/Users/micjoyce/develop/github/xopc/src/gateway/clarify-bridge.ts:8) 是内存 Map + Promise，5 分钟超时；[clarify-tool.ts](/Users/micjoyce/develop/github/xopc/src/agent/tools/clarify-tool.ts) 可使用默认回答 | 认证不能用默认回答；不能依赖内存 Promise 承载长时间等待 |
| 持久化任务等待 | [task-lifecycle.ts](/Users/micjoyce/develop/github/xopc/packages/gateway-contract/src/task-lifecycle.ts:14) 有 TaskWait；[task-run-repository.ts](/Users/micjoyce/develop/github/xopc/src/tasks/task-run-repository.ts:469) 有创建 / 解决等待；[task-application-service.ts](/Users/micjoyce/develop/github/xopc/src/tasks/task-application-service.ts:224) 设置 run waiting | 增加 capability 请求与 wait 的确定关联，使用既有应用服务而非散落写状态 |
| 任务续跑 | [task-run-dispatcher.ts](/Users/micjoyce/develop/github/xopc/src/tasks/task-run-dispatcher.ts) 可领取等待已解决的 run；[task-run-coordinator.ts](/Users/micjoyce/develop/github/xopc/src/tasks/task-run-coordinator.ts:96) 避免有 active wait 时 finalize | 恢复输入需包含解决结果与已完成步骤，而不是只重发原 objective；增加 durable resume intent 与去重 |
| 普通 Chat 状态 | [chat-run-presence-store.ts](/Users/micjoyce/develop/github/xopc/web/src/features/chat/session/chat-run-presence-store.ts:3) 仅 running / completed / failed；[agent-stream.ts](/Users/micjoyce/develop/github/xopc/packages/gateway-contract/src/agent-stream.ts:102) run end 为 success / error / cancelled | 表达 awaiting_connection，明确一次模型执行结束与整个任务完成不同 |

两个容易误用的基础：

1. [interaction-state.ts](/Users/micjoyce/develop/github/xopc/src/user-context/interaction-state.ts) 表达倾听、澄清、建议、行动等沟通状态，不应承载认证交互。
2. `TaskRunCoordinator.start` 需要 `context.taskId`。普通 Chat 并不保证有领域 TaskRun，不能把所有聊天等待都强行塞进 `task_waits`，也不应为了连邮箱自动创建用户可见任务。

另外，[composio-sessions.ts](/Users/micjoyce/develop/github/xopc/src/connectors/composio-sessions.ts:202) 已设置 `manageConnections.enable=true`、`waitForConnections=false`，并支持多账号；连接等待正适合由 xopc 负责。现有 provider 在没有指定账号时会选默认账号或第一个 active 账号，恢复阶段应改为绑定明确账号，避免连接 A 却在 B 上执行。

## 4. 产品设计

### 4.1 推荐入口

只在任务依赖确实缺失时触发，不要求每次搜索空结果都展示安装推荐。

优先级：用户指定的服务 / 账号 → 已可用且符合任务的连接 → 已安装待授权 → 可安装的可信目录候选。

- 用户明确说 Gmail：显示 Gmail 单卡；不反复询问 Gmail 还是 Outlook。
- 用户只说「总结邮箱」：若无法从上下文判断，先问邮箱类型，或给少量相关选择。
- 任务已有可用工具：直接完成，不做无关插件推销。
- 一个服务有 native / MCP / Composio 多条实现：后台选择符合部署配置的推荐实现，产品上默认只显示一个 Gmail。
- registry 失败、网络超时：显示检查失败 / 重试，不把它误报为用户没连接。
- 管理员禁用：说明当前不可用或联系管理员，不显示无效的 Connect。

### 4.2 核心卡片

在对应助手消息下独立显示，不藏在折叠的工具日志里：

> **连接 Gmail，继续整理邮件**\
> 为了汇总最近 7 天的未读邮件，需要访问你的 Gmail。\
> 本次操作：搜索和读取邮件。\
> **[连接 Gmail 并继续]**\
> [本次跳过]　[查看其他连接器]

权限文案必须区分「本次操作范围」与「实际 OAuth 请求范围」。若提供方的认证配置还申请发送权限，详情必须据实展示；不能因为 xopc 本次只读就声称 OAuth 也只读。

「查看其他连接器」打开固定尺寸的选择对话框，保留当前聊天位置，优先显示适合该任务的候选，并保留全部目录入口。目录加载用 skeleton；选其他服务必须重新判断是否能满足原任务，不能仅因为任意连接成功就恢复 Gmail 步骤。

卡片状态：

| 状态 | 文案 / 行为 |
|---|---|
| 待连接 | 单一主按钮；任务提示「等待你连接 Gmail」 |
| 正在授权 | 「在打开的页面完成授权」；重新打开、检查状态、稍后处理 |
| 正在验证 | 「正在确认账号和访问权限」；按钮短时进度可用 |
| 已连接，待调度 | 「Gmail 已连接，准备继续」；不要提前说任务完成 |
| 已恢复 | 收起成「已连接 Gmail · a***@example.com」，下方继续生成结果 |
| 已跳过 | 「本次跳过 Gmail」；提供粘贴邮件、导入文件或执行其他独立部分 |
| 可重试失败 | 可理解原因 + 重试；保留原任务，不要求重新输入 |
| 请求失效 | 对话已重置 / 任务已取消 / 请求已被替代，禁用旧按钮 |

底部 composer 显示等待条，sidebar 与任务页显示需要用户操作；不能继续显示工作中的假进度。等待期间允许用户正常发送新消息；只有明确的卡片操作或对当前等待的明确回答才能解决该请求。

### 4.3 Skip 的精确定义

Skip 表示拒绝本次连接，不等于任务完成、不等于撤销已有账号、不等于永久屏蔽 Gmail。

- 有独立步骤：先完成它们，并说明缺失部分。
- 邮件读取是唯一前提：保留上下文，邀请粘贴或导入邮件；不虚构摘要。
- 对同一任务与同一能力记住拒绝，避免下一轮又弹同一张卡；用户重新要求连接后才解除。
- 用户取消整个任务，则取消所有待恢复请求；迟到的授权成功不应唤醒已取消任务。

## 5. 建议的架构

### 5.1 能力发现与执行权限分开

扩展 `xopc_tool_search` 的结果为 `tools` 与 `recoveryCandidates` 两类。前者仍然只有可按当前权限发现的真实工具；后者仅代表可提供的恢复路径，不具有执行资格。

为目录增加小型任务语义索引，如 `email.search`、`email.read`、`calendar.read`。现有 ConnectorCapability 中的 `tools`、`auth.oauth` 等偏技术分类，不足以做用户任务匹配。先使用 Gmail、Calendar、Drive、Slack、Notion 的人工策划映射及中英别名，再逐步扩大；不能依赖模型凭空猜 connectorId。

推荐流程为「模型识别需求 + 后端验证状态」。命中其他无关工具不代表能力已满足；没有命中也不代表需要安装。执行时再次检查连接与权限，用于覆盖过期、撤销等情况。

建议增加一个小型工具 `xopc_request_capability`，接收搜索返回的候选引用和任务理由。principal、agent、session、run 必须从可信执行上下文派生，不能交给模型填写。该工具只创建等待请求；用户点击 Connect 后才开始授权 / 有必要的安装。

### 5.2 持久化对象

增加 `capability_requests`，可选关联既有 TaskWait。以下为提案字段，不是已有 API：

```ts
type CapabilityRequest = {
  id: string;
  principalId: string;
  agentId: string;
  sessionKey: string;
  sessionId: string; // 标识当前 transcript 世代，防止 reset 后错误恢复
  originGatewayRunId: string;
  taskId?: string;
  taskRunId?: string; // 与 gateway run id 不混用
  toolCallId?: string;
  connectorId: string;
  capability: string;
  reasonCode: 'not_installed' | 'not_connected' | 'expired'
    | 'insufficient_scope' | 'account_selection' | 'setup_required';
  requiredActionScope: 'read' | 'write' | 'admin';
  status: 'pending' | 'authorizing' | 'verifying' | 'ready'
    | 'resumed' | 'skipped' | 'cancelled' | 'expired' | 'failed';
  authAttemptId?: string;
  connectionId?: string;
  providerConnectionId?: string;
  continuationId: string;
  version: number;
  createdAt: number;
  resumeConsentValidUntil?: number; // 自动续跑授权的边界，与 OAuth attempt TTL 分开
};
```

OAuth attempt 单独存储，重试产生新 attempt，旧 callback 不得覆盖新状态。账号、安装、认证连接、OAuth scopes、xopc 本地 scope 与单次动作 approval 仍由各自模型管理；不要全部压进一个 connected 布尔值。

当前任务存在时，用 `TaskWait.kind='user_input'` 与 `condition.type='capability'` 投影这一请求，复用现有 attention 机制。普通 Chat 以 capability request 为持久化等待源。不要同时建立两套互相独立的 pending 真相：请求状态与 TaskWait 变更由同一个协调服务在事务中完成。

### 5.3 状态与执行生命周期

```text
发现缺失 → pending → authorizing → verifying → ready → resumed
              │            │            │
              ├─ skipped   └─ failed ────┘（用户重试新 attempt）
              ├─ cancelled
              └─ expired
```

展示状态之外还需管理执行生命周期：

1. 工具返回已记录的 `requires_user_action` 结果，保留合法的 tool-call / result 配对。
2. 嵌入式 agent loop 在安全边界 yield，结束当前模型执行并释放资源；不能靠模型读到一句「请等待」自行停止，也不能粗暴抛普通错误导致 run 被标记失败。
3. capability request 与必要的 TaskWait 已在发布卡片前持久化。
4. gateway execution 可以结束，但会话/领域任务仍处于等待。扩展 stream 协议表达 suspended / waiting，审查所有成功通知和 presence 的 consumer，防止 run_end 被误显示为完成。
5. 连接验证成功后写入 durable resume intent（outbox），原子地解决对应 wait。
6. 对有 TaskRun 的路径唤醒既有 dispatcher；普通 Chat 走 session input / run 调度路径，创建续接执行。
7. 续接执行带上已完成步骤、未完成目标、绑定账号和 recovery resolution，重新 search / describe 必要工具，再继续执行。

这样用户感知为「同一任务继续」，实现上无需让同一个模型请求或 Promise 存活数小时。现有 dispatcher 只传原 objective 的行为需要补充恢复上下文；原聊天记录有助恢复，但不足以替代明确的 continuation。

### 5.4 OAuth 与连接验证

建议的请求 API：

```text
GET  /api/sessions/:sessionKey/capability-requests
POST /api/capability-requests/:requestId/connect
POST /api/capability-requests/:requestId/check
POST /api/capability-requests/:requestId/skip
POST /api/capability-requests/:requestId/cancel
```

Connect 输入至少有 expectedVersion / 幂等键；响应提供宿主生成的授权启动信息。MCP 的 protocol state / PKCE 继续由既有 OAuth manager 管理，Composio 第三方授权由 provider 管理；xopc 额外负责 request ↔ attempt ↔ principal ↔ session ↔ connection 的绑定。

- 浏览器点击时同步预留 popup，再请求授权链接，复用现有 helper。
- Electron 使用系统浏览器；远程 gateway / 移动渠道不能假定 localhost callback 可达。
- redirect / webhook / MCP completion 通知触发后端重新查询可信 provider 状态；验证精确 connectionId、身份、有效性、所需 scopes、本地 policy 和工具可用性。
- 首次请求可能尚无工具 schema：验证阶段重新发现并加载实际工具合约。
- `connected` 但目标工具不可用：保持恢复请求，显示真正原因。
- 前端 poll 可改善反馈，后台 reconciliation 负责刷新、关闭页面或重启后的恢复；UI 的 120 秒超时不等于用户拒绝或授权失败。
- 首次 OAuth 需要 Composio BYOK、Cloud 登录或 custom auth config 时，明确展示前置设置步骤。未配置前不承诺 Gmail 一键连接。
- Token 留在 credential/provider 层；聊天 transcript 只保存请求引用及脱敏结果。授权 URL 不应作为永久聊天附件反复传播。

### 5.5 幂等与副作用

目标是至少一次恢复信号下的单次有效调度，不应承诺对所有第三方操作都有端到端 exactly-once。

- `(requestId, resolutionVersion)` 的 resume intent 唯一；处理器用 CAS / lease 领取。
- 点击两次、重复 webhook、同时打开多个标签，只产生一个有效 continuation。
- 撤销、session reset、任务取消或修改了目标后，回调只能更新连接状态，不能盲目续跑旧任务。
- 重新连接只恢复授权前尚未执行的动作。对结果不明的写操作，先查询业务结果或检查 provider 幂等键，不能无条件重放。
- OAuth 允许访问服务，不等于用户批准发送某一封邮件。继续复用 [policy.ts](/Users/micjoyce/develop/github/xopc/src/connectors/policy.ts) 和一次性 connector approval。
- 独立步骤可继续执行，只有真正依赖缺失能力的执行单元进入等待。

## 6. 前端与多渠道落点

建议新增 `ConnectorRequestCard` 和 `useConnectorAuthorization`，放在现有 chat / connectors feature 中；注册 versioned capability request stream event，同时提供 REST 快照用于 hydration。

服务端保存事实，realtime 负责通知，React 负责表现。卡片更新引用同一 requestId，不通过 Markdown 正则解析「请连接 Gmail」，不只存在于当前流的临时状态。

- Chat timeline：推荐卡、授权中、成功收起、失败重试。
- Composer：等待提示及继续 / 处理入口；允许发送纠正和新消息。
- Sidebar / Tasks：需要用户操作状态与对应 request 深链。
- Connectors 页面：管理账号和权限；完成连接后同样通知恢复协调器。
- Telegram / Weixin：简短说明 + 可信授权页链接 + 显式跳过 / 检查状态；共享群聊中连接账号必须绑定实际发起身份，不能套用本地 owner。

遵循现有设计系统的 slate 表面、细边框、单一蓝色主按钮、内部滚动的固定尺寸对话框。候选选择使用项目已有 PopoverSelect 或现有目录列表，不增加第二套主题。

## 7. 实施顺序与验收

### 第一阶段：已安装未授权的纵向闭环

Gmail + Composio + Web Chat：结构化请求、聊天卡片、后端验证、持久化等待、同任务续跑、Skip。覆盖现有 TaskRun 与普通 Chat 两条路径。这是内部纵向验证，尚不能宣称完整覆盖用户截图场景。

### 第二阶段：完成用户可感知的 MVP

增加可信目录候选与必要安装、未安装 Gmail 的单一推荐、重新授权、账号选择、查看全部、基础服务未配置提示、刷新与重启恢复。此时才能覆盖用户首次提出「帮我整理 Gmail」但完全没有连接器的场景。

### 第三阶段：扩展而非重写

MCP auth challenge / URL elicitation、其他连接器、多渠道、多个依赖、管理员政策和遥测。只扩展 adapter 与 capability mapping，不再各做一套等待 UI。

关键验收：

1. 未安装 Gmail：可推荐、完成安装授权，原任务继续，用户不用重复输入。
2. 已安装未连接：跳过重复安装，直接授权。
3. 已可用：直接读取，不显示恢复卡。
4. 已过期：显示重新连接；不是泛化为安装错误。
5. 多账号：用户选择或明确默认策略绑定的账号与实际执行账号一致。
6. 跳过：本任务不重复弹卡，明确未读取邮件。
7. OAuth 窗口被拦截 / 关闭 / 超时：请求仍可恢复，不误判成功。
8. 授权成功但 scope 不足、策略不允许或工具不存在：不续跑错误步骤。
9. 重复回调、重复点击、多标签：一次有效恢复。
10. 重启 gateway、刷新页面：卡片状态可还原，resume intent 不丢失。
11. reset / cancel / 新目标：旧授权不能唤醒旧任务。
12. 发邮件等动作：连接成功后仍遵守原授权与确认策略，未知结果不自动重放。

指标围绕任务恢复而非安装数：推荐曝光→点击→授权验证→有效续跑→任务完成的转化，恢复耗时，误推荐率，Skip 后重复打扰率，错误账号执行和重复副作用事件数。分别统计未安装、未授权、过期、权限不足，避免一个总体转化率掩盖失败原因。

## 8. 建议的下一步开发范围

先实现共享契约、持久化 request 与 resume coordinator，再接 Gmail 卡片和授权 adapter。将「未安装」「取消后迟到回调」「重启后恢复」「写操作不重放」列为 MVP 必须验证的路径。不要先做可点击外观，再把等待和续跑留给模型提示词。

本研究新增本文档和一个对话内交互草图；没有修改运行时代码，没有连接真实账号，没有执行产品端到端测试。正式排期前仍需对当前 embedded loop 的 yield 边界、gateway 认证主体映射与运行通知 consumer 做实现级验证。

## 9. 延迟点击、历史卡片与再次失效

### 三种生命周期

历史卡片是会话记录，按会话保留策略存在；capability request 是一次任务恢复请求；OAuth attempt 是一次短期授权尝试。账号连接又有自己的有效期。它们不能共用一个 expiresAt 或 connected 状态。

产品原则：**历史可回看；当前动作实时判定；短期链接点击时生成。**

卡片创建时只持久化 requestId、展示快照和任务关联，不提前创建或保存可直接点击的 OAuth URL。用户点击按钮后，向 xopc 提交 requestId，后端重新校验，再生成有效授权链接。可复用仍有效且匹配的当前 attempt；失效时生成新 attempt，不为重复点击无限创建尝试。渠道链接同样先到 xopc 处理页，登录并验证请求归属后开始 OAuth；查看链接本身不启动授权或恢复任务。

当前 xopc 的 [MCP OAuth session](/Users/micjoyce/develop/github/xopc/src/agent/mcp/oauth/mcp-oauth-session.ts:6) 默认 TTL 为 10 分钟。这是该本地 MCP 流程的期限，不是 Gmail / Composio 的统一期限，也不是聊天卡片的期限。授权页已经打开后放置过久，则提示「这次授权已超时，任务已保留」，提供「重新打开授权」。过期 attempt 不能把仍有效的恢复请求永久变成 expired。

### 历史卡片的状态矩阵

| 请求与当前状态 | 历史中显示 | 可执行动作 |
|---|---|---|
| 从未点击，原任务仍有效 | 等待连接 Gmail | 连接 Gmail 并继续；点击时生成新链接 |
| 打开授权后超时 | 本次授权超时，任务已保留 | 重新打开授权；保留原请求，新建 attempt |
| 同一请求已经连接并恢复 | 当时已连接、已继续的时间记录 | 查看连接；不再执行旧的继续动作 |
| 账号已在别处连接，原任务仍等待 | Gmail 已连接，原任务尚未继续 | 继续原任务；仅有仍有效的明确自动续跑意图时可以自动恢复 |
| 历史任务已完成，但账号现在失效 | 当时已连接 / 任务已完成；详情可显示当前需重新连接 | 管理连接；可重新授权账号，但不能重放历史任务 |
| 当前新任务遇到同一账号失效 | 新消息下显示「重新连接 Gmail，继续本次任务」 | 新 requestId；沿用已有 accountId，绑定新的 authorization |
| 旧请求已被新请求替代 | 已由新的连接请求接替 | 查看最新请求；不并存两个活跃的继续按钮 |
| 已跳过 | 本次已跳过 | 重新处理；创建后继请求，不回滚旧请求的终态 |
| 任务取消、聊天 reset、目标已改变 | 原任务已取消 / 此请求已失效 | 查看详情；如要再做，用户显式发起新请求 |
| 原任务放置较久或数据条件变化 | 原任务仍保留，需要确认执行范围 | 查看并继续；先展示任务摘要和范围，确认后再连接或续跑 |

历史事实与当前状态必须分开：过去的「已连接」不能因今天 token 失效被篡改成「当时连接失败」。已完成卡片保持收起；当前连接状态放在展开详情或连接器管理页，不因一次账号失效把所有历史消息变成警告。

只有最新、仍待处理、归属当前用户且关联有效任务的请求可以有“继续原任务”主按钮。历史展示不是执行权限；每次点击必须后端重新检查，不相信旧前端缓存或按钮文案。

### 再次失效先尝试刷新

普通 access token 到期时，由 provider / credential adapter 尝试刷新；能恢复就继续，用户无需重新连接。refresh token 被撤销、失效或需要新增授权时，才为当前任务显示重连请求。网络超时和 provider 故障显示重试，不误报授权失效。[Google OAuth 文档](https://developers.google.com/identity/protocols/oauth2/web-server)说明了 access token 刷新，以及 invalid_grant 时可能需要重新认证。

新请求记录 accountId 和所需能力，验证新 connection 确实对应原账号。若用户选了另一个账号，明确提示切换再继续；不能因为任意 Gmail 账号可用就解决原账号的等待。

### 长时间之后继续什么

任务保留不代表原执行条件无限期有效。应分别保存原始表达和解析后的绝对范围，例如「最近 7 天」对应的起止时间与时区。用户数天后点击时，若时间范围、任务目标、账号或动作内容已不再明确，显示一个紧凑的恢复确认：

> 继续整理之前的邮件？\
> 原请求：9 月 1 日至 9 月 7 日的未读邮件\
> 时间范围：[原时间范围] [截至今天的最近 7 天]\
> [确认范围并连接]

日期仅为示例。时间范围可固定，但「未读」这类可变过滤条件若未曾抓取快照，只能反映本次实际查询时的状态；不能声称能还原原请求日的未读集合。必要时在恢复摘要中说明。

保持上下文，不要求重新输入整段任务；没有歧义的只读任务仍可直接点击连接并继续。发送邮件等写动作继续遵守原来的审批和幂等要求，不沿用已经过期的操作 approval。

连接状态变更只产生 capability-ready 信号。是否自动续跑由 continuation 策略决定：用户点过明确的「连接并继续」、请求仍有效、任务与范围未变、其他依赖已满足、操作授权仍有效，才可自动调度。在设置页单独连接账号、迟到的旧 callback，均不自动代表同意执行所有历史任务。

### 实现补充

- request 终态保持稳定，retry 创建新 authAttempt，重新处理创建后继 request；记录 supersededByRequestId。
- 前端读取服务端的 `allowedActions`、`version`、`currentConnectionState`、`resumeDisposition`（continue / review / unavailable），以当前投影控制按钮。
- `resumeDisposition=review` 是请求仍可恢复但需要更新执行条件，不等于 OAuth 失败；具体 freshness 条件按任务语义制定，不把任意固定天数作为所有任务的失效规则。
- 点击与回调都校验 principal、sessionId、请求版本、任务状态、账号关联和当前 attempt；未通过时返回最新投影，而不是继续重放旧操作。
- 同时测试页面打开时有效但点击时失效、旧 OAuth 页迟到回调、账号在设置页重连、终态卡片重复点击，以及相对时间范围跨天后的继续。
