# 从服务名称到 MCP 连接：技术方案

日期：2026-10-28；实施记录更新：2026-10-29。状态：核心实现已落地，完整连续 E2E 验收尚未通过。下文保留目标设计；实际边界以本节记录为准。

已实现名称发现与文档证据校验、版本绑定的候选计划、认证不确定状态、自定义多密钥请求头、安全表单、Retry-After 与有限重试、旧 SSE、需 owner 审阅的固定版本 stdio 执行，以及原会话续跑和仅连接时的业务调用限制。协议与 OAuth 继续由 pi 原生客户端负责。

提交前验证：25 个测试文件、214 项测试通过，Node/Electron 类型检查通过。真实模型专项中 Token、多密钥、SSE、stdio、固定版本包安装与 OAuth 流程已分别通过；三轮完整矩阵尚未连续通过。第一轮九条业务路径通过，但报告将上游非 200 推理响应误计为非真实模型，该统计条件已修正且保留失败记录。第二、三轮在重启后的原任务续跑遇到异常，尚未完成修复后的完整回归。在线麦当劳抽检因官方资料抓取不可达而阻塞；未提交真实 Token，不算真实第三方连接成功。

当前发现预算为一次搜索、最多五篇资料、单篇 20 KB、合计 80 KB、总截止 45 秒。仅麦当劳具有已审核的官方资料入口加速提示，配置值仍须从当次资料取得；其余来源需 owner 审阅，尚不具备通用官方归属证明。微信官方客户端及 Windows 进程生命周期不在已通过范围内。

## 1. 目标与完成定义

用户说“帮我连接麦当劳”即可发起：发现接入资料 → 核实候选 → 准备配置 → 必要的安全输入 / OAuth → 验证并保存 → 回到原会话。用户不需要知道 MCP URL、请求头、传输协议或配置文件。

必须区分两种目标，持久保存而非只靠模型记忆：

| 用户目标 | 成功终点 | 不能算成功的情况 |
| --- | --- | --- |
| 仅连接服务 | 原生 MCP 初始化与工具发现成功、配置提交且运行时生效；总结可用能力与使用示例 | 仅搜到官网、HTTP 200、保存凭据、保存配置、等待 reload |
| 连接并完成任务 | 连接完成后，原会话中的实际工具调用完成原任务并取得结果 | 用工具数量或示例回答代替真实查询；任务失败却说整体完成 |

仅连接时不额外读取私人资料，不为了证明连接而领取优惠券或创建订单。工具列表为空时报告“连接已验证，但未发现工具”，不承诺存在用户所需能力。原任务涉及写操作时仍适用该动作的权限和确认要求。

## 2. 现有实现和复用边界

| 层 | 当前文件 / 行为 | 本方案变化 |
| --- | --- | --- |
| 常驻引导 | `src/agent/prompt/conversational-configuration-guide.ts`，偏向已有 HTTP URL | 名称请求转服务发现，详细步骤继续按需读取 manual，避免膨胀 SP |
| 直接工具 | `src/agent/tools/mcp-setup-tool.ts`，inspect/start/get/advance 等，start 要 URL | 增加发现、候选证据提交 / 校验、候选选择入口；保留显式 URL 的快捷路径 |
| 搜索与读取 | `src/agent/tools/web.ts`、`search/registry.ts`、`fetch-text.ts`，已有来源、缓存和失败元数据 | 提取共享领域调用，复用 provider、权限、blocklist、限流与来源记录，不另建搜索服务或偷偷绕过禁止的 web 工具 |
| 配置目标 | `src/agent/mcp/conversation-setup.ts`，DurableState 绑定 conversation/transcript，安全 Token、续跑 | 加入来源快照、目标类型、认证诊断和恢复预算，保持 owner / 微信审批与版本约束 |
| 原生探测 | `connection-setup.ts`、`tool-catalog.ts`，原生 pi 初始化和工具发现 | 引入结构化观察与 `auth_unknown`；不再以元数据失败推断 Token |
| 草稿提交 | `connection-drafts.ts`，隔离草稿、临时 OAuth 凭据、CAS 提交 | 继续作为唯一提交入口；持久目标重建临时草稿，不保存不可恢复的内存对象 |
| 秘密解析 | `src/connectors/secret-store.ts` → `CredentialResolver`；`native-mcp.ts` 投影 | 扩展受控 header/env 字段，模型只能见字段说明和是否就绪 |
| UI / HTTP | `mcp-conversation-setup-page.tsx`、`src/gateway/hono/routes/mcp.ts` | 延用同一小弹窗和原会话，增加不确定状态与具体恢复动作 |
| E2E | `scripts/verify-conversation-configuration-e2e.mts` 和独立 HTTP/OAuth fixtures | 新增只给名称的入口和独立搜索语料，沿用真实模型、真实点击、实际工具调用断言 |

当前 `metadata()` 把 404、网络失败和解析失败都收敛为 undefined，`advertisesOAuth()` 返回 boolean；无凭据 401 因此可能在证据不足时进入 Token。普通 403 目前保留 access_denied，并允许安全输入 Token，但尚不完整检查其 OAuth 线索。

底层配置 schema 已有 stdio 的 command/args/env；这不等于对话配置已支持安装、执行本地程序。宿主 schema 目前没有旧 SSE 枚举，pi 的现有公开选项默认只有 stdio / Streamable HTTP，也未提供现成的结构化诊断回调。两者都需要依赖能力验证，不能只改 UI 或错误正则。

## 3. 分层架构

```mermaid
flowchart LR
  A[用户名称与原始目标] --> B[Discovery：搜索与抓取]
  B --> C[Evidence：候选校验与必要消歧]
  C --> D[Setup：既有持久配置目标]
  D --> E[Probe / Auth：原生 pi 与安全弹窗]
  E --> F[Draft commit：版本检查与运行时生效]
  F --> G{原始目标}
  G --> H[仅连接：能力总结]
  G --> I[原会话续跑：完成实际任务]
```

模型负责理解名称、读取资料、提取候选和解释选择；宿主负责证据、URL/字段校验、状态迁移、权限、预算和提交。网页内容是资料，不是可以更改系统权限或要求泄露凭据的指令。OAuth 的 PKCE、注册、回调、refresh 和 MCP 执行仍归 pi，不新增第二套协议 runtime。

### 3.1 名称发现与证据

拟扩展 `mcp_setup`，命令名称在实施时写入 schema/manual：

| 命令 | 输入 | 宿主职责 |
| --- | --- | --- |
| discover | serviceName、objective、可选 region | 按当前 Agent 的 web 权限执行搜索和公开页面读取；保存 discoveryId、版本、来源和内容摘要；不连接服务、不安装程序 |
| propose | discoveryId、expectedVersion、候选字段、fieldEvidenceRefs | 接收当前 Agent 从原文提取的候选；检查字段是否有已抓取资料依据、来源关系和网络策略；返回可选择候选或缺口 |
| select | discoveryId、expectedVersion、candidateId | 唯一且证据充分时自动选择；多候选时接收用户在对话中的选择；固定候选快照 |
| start | 已校验 planId / expectedPlanVersion，或原有显式 URL 参数 | 在既有目标服务创建 setup；从宿主快照读取配置，拒绝模型事后替换 endpoint 或认证字段 |

`discover` 的共享研究服务先提供结果和有限文档片段；仍由当前会话模型提取候选，不在后台另开一个不可见 Agent。`propose` 不把模型自报的 confidence 当可信度，也不能仅因 URL 在模型回答出现就接受它。

证据粒度至少到字段：endpoint、transport、认证方法、header 名、Token 获取入口分别引用 `documentId + contentHash + span/结构化配置路径`。宿主核对原文确实支持该值，记录重定向后的来源与抓取时间。搜索摘要只用于找资料，不能单独授权发送密钥。

来源判断采用可解释的等级，而非一个不透明分数：

- 已核实的服务方文档，或服务方网站明确链接的官方代码仓库，可以支撑自动准备。
- 官方文档链接到不同域名的 MCP endpoint / 身份服务，可以建立明确关联；不要求所有域名相同。
- 社区教程、同名 GitHub 仓库、搜索排名第一均不能直接视为官方。无法核实所有者关系时保留 unverified，向用户展示来源并确认目标，不虚构“官方”。
- 可以缓存少量已审核的服务身份与官方资料入口，但服务目录是加速器，不能成为仅支持白名单的硬编码逻辑。缓存中的实际 endpoint、认证说明仍需过期检查。

同名、多地区或官方 / 社区实现并存时，只问能消除歧义的一个问题，例如“中国大陆麦当劳还是其他地区服务”。无结果、搜索不可用、资料冲突分别报告；不向用户假装自动搜索已成功，也不猜测 `/mcp`、`/sse` 等路径。

初始预算建议：每轮最多 3 个搜索 query、5 篇资料抓取，单篇提取不超过 20 KB，总资料 80 KB；并行最多 3 个独立读取。这是待测的工程默认值，不是已实现指标。明确 URL 跳过名称搜索；需要核对认证时才读取该服务资料。有效证据可短期缓存，提交凭据前复核已过期或发生变化的关键字段。

### 3.2 目标和诊断契约

新增 `src/agent/mcp/discovery/` 管理发现证据，继续用 DurableState 保存 JSON 记录；既有 setup 记录以可选字段扩展，不因新增 JSON 字段提升数据库最低版本。

持久数据分为三个对象：

1. **Discovery**：归属身份、原始用户消息引用、版本、候选、资料摘要与哈希、过期时间、是否需要消歧。不得保存搜索服务密钥。
2. **ConnectionPlan**：不可变候选快照、协议类型、认证字段描述、credential 获取入口、字段来源、endpoint 指纹、原始目标 `connect_only | complete_task`。
3. **SetupGoal**：现有 conversationId/transcriptId/agentId/微信路由、planId、版本、配置 revision、阶段、诊断、尝试次数、nextRetryAt、凭据引用、提交/生效/续跑/任务结果状态。

诊断返回结构建议：

```typescript
type AuthDiagnosis = {
  method: 'none' | 'bearer' | 'header' | 'oauth' | 'unknown';
  evidence: 'protocol' | 'official_document' | 'user_selected' | 'insufficient';
  metadata: 'valid' | 'absent' | 'unreachable' | 'invalid' | 'not_checked';
  credential: 'missing' | 'present' | 'rejected' | 'unknown';
  evidenceRefs: string[];
};

type RecoveryAction =
  | { kind: 'enter_secret'; fieldIds: string[] }
  | { kind: 'authorize' }
  | { kind: 'choose_candidate' }
  | { kind: 'choose_auth' }
  | { kind: 'verify_documented_endpoint'; evidenceRefs: string[] }
  | { kind: 'wait'; retryAt: number; remainingAttempts: number }
  | { kind: 'inspect_local_dependency' }
  | { kind: 'report_blocker'; reason: string };
```

以上为目标契约，不是现有导出类型。观察值还需保留 HTTP status、请求方法、协议阶段、Content-Type、是否有认证 challenge、规范化 Retry-After 和安全错误分类；不向模型返回原始 headers、cookies、响应正文或完整带查询参数的地址。

工具给模型返回“当前发现 / 认证状态、已执行动作、下一步 action、宿主生成的准确交互链接”，UI 渲染同一诊断对象，避免模型说能输入而页面只有重复检查。

## 4. 认证判断与原生诊断

### 4.1 不确定是正常状态

`probeMcpConnection` 增加 `auth_unknown` 结果，setup / UI 同步承接。`metadata()` 返回有效、确实不存在、不可达、无效等区分，不能用 boolean 吞掉网络或解析错误。

| 证据组合 | 认证判断与动作 |
| --- | --- |
| 初始化与工具发现成功 | connected；记录实际协议，不再额外要求认证 |
| 官方资料明确 Bearer / 自定义 header | 进入已确认方式的安全输入；不需要先发无凭据请求 |
| 401 / 403 且有可验证的 protected-resource / authorization-server 元数据 | OAuth；由 pi 执行，不能只因有 Bearer challenge 就假定支持 OAuth |
| 401 / 403，但认证元数据不存在且没有其他方式依据 | auth_unknown；允许用户选择 Token 或补充说明，不声称“确定需要 Token” |
| 认证元数据超时、网络/TLS异常、格式无效 | 保留 auth_unknown 和具体原因，按恢复策略重试或停止；不回退为已确认 Token |
| 已输入凭据后 401 / invalid_token，或明确凭据拒绝 | 标记 rejected，允许替换；不无限自动重试密钥 |
| 已输入凭据后 403，缺少明确 invalid_token 证据 | 保留“凭据可能被拒绝或权限不足”；提供替换与权限检查，不只提示 Token 错误 |
| 官方说明和实际元数据冲突 | 保留冲突并核对服务 / 文档版本；不静默换认证方式或把已有凭据发往新目标 |

普通 403 也可在预算内读取公开认证线索，所有元数据请求不带用户已有 Token。OAuth 的资源、issuer、授权端点关联必须验证，不能发现一个第三方登录页就触发授权。已确认 Token 的服务不因元数据请求失败被改判 OAuth。

### 4.2 观察来自哪里

首先给 pi 增加或使用上游提供的结构化传输诊断接口：包含 method、stage、status、允许记录的响应头摘要和错误 cause。宿主只适配诊断，不重实现 MCP 请求/会话、token refresh 或协议协商。

若依赖版本尚无诊断接口，允许宿主做一次受策略约束的只读初始化 / metadata 复核，必须计入同一预算、可取消，且明确它不是工具发现成功。这个过渡方案不能成为永久的并行 MCP runtime；拿不到足够证据就返回 unknown，不从字符串强行制造确定性。结构化接口是 P1 恢复质量的依赖，不能在验收中假装已具备。

本方案不要求同步升级到最新 MCP 消息协议。当前诊断初始化版本、pi 实际协商版本及测试服务支持版本应在兼容矩阵记录；协议升级另行验证。参考规范版本固定到链接，不能让 `latest` 的变化悄悄改变产品行为。

## 5. 分类之后的恢复策略

宿主生成有限、可审计的恢复动作，模型不能自由拼接 URL、无限重试或自动关闭 TLS 校验。

| 现象 | 宿主动作 | 停止条件 |
| --- | --- | --- |
| 初始化 POST 返回 404 / 405 | 重新读取已核实资料，确认准确端点与传输；只有找到明确的新地址才能更新候选 | 无证据、目标变化需重新确认，或同一地址已尝试过 |
| 可选 GET/SSE 返回 405，但 POST 初始化和发现成功 | 作为协议支持范围记录，不误判连接失败 | 不因此切换为旧 SSE |
| 429 / 503 且有 Retry-After | 解析秒数或 HTTP 日期，保存 nextRetryAt；到期后有限重试 | 等待超过交互预算则展示等待状态；不得截短服务要求的等待再提前请求 |
| 超时、临时网络错误，无 Retry-After | 在可重试的阶段退避重试，例如 2s、5s 加 jitter | 最多两次自动重试；仍失败报告可理解的阻塞原因 |
| TLS / 证书错误 | 报告证书问题，核实域名和官方文档 | 不忽略证书、不自动改成 HTTP |
| 返回 HTML / 登录页面 | 识别为端点或认证待核对，读取官方接入资料 | 不把网站登录页当 MCP，不把 HTML 内容当协议指令 |
| 搜索错误 / 多候选 | 原因可见，有限换查询词；必要时消歧 | 不静默换成不同服务或社区代理 |
| 依赖缺失 / stdio 启动错误 | 在相应阶段检查程序、路径和受控安装说明 | 未取得执行授权时不下载或运行 |

重试预算按 setup + endpoint 指纹 + 阶段持久保存：初次加最多两次自动重试；metadata、SDK 内部重连与宿主复核不能各自偷偷重置预算。用户刷新页面或 Gateway 重启不清零。错误密钥、取消、scope 变化不自动重试。

连接探测和只读业务查询的重试分开管理。创建订单等非幂等调用不能因为超时自动重放；应查询已有结果或报告 outcome_unknown。重试等待不创建用户的定时任务，使用 Gateway 可恢复的截止时间调度；到期时先检查目标、身份、版本与预算。

## 6. 接入方式扩展

### 6.1 自定义 Header：P2

ConnectionPlan 增加受控 secret 字段：`fieldId`、label、headerName、必要的固定 prefix、helpUrl、是否必需、来源引用。多个字段可以显示在同一个安全弹窗；模型只收到“字段缺失 / 已保存 / 被拒绝”。

- 复用 `xopcSecretRef` 和 CredentialResolver，把值仅在 `prepareNativeMcpConfig` 解析；禁止 Token 经模型传参或普通配置 JSON 落明文。
- header 名和 prefix 来源于已确认的文档/用户选择，按实际支持方式白名单校验；拒绝 CR/LF、Host、Cookie、Proxy-*、Sec-*、连接和转发控制头等。首期覆盖 Bearer、X-API-Key 一类明确字段，不做任意 header 编辑器。
- 带凭据请求只到已确认的 endpoint；跨源重定向不带认证，不静默跟随。目标/传输/认证字段变更使旧验证失效，重新确定凭据是否可用；不能仅因为服务名相同就复用。

### 6.2 旧 HTTP+SSE：P3，依赖能力门槛

区分“Streamable HTTP 回复是 SSE”与“2024-11-05 旧 HTTP+SSE transport”。文档或受控协议协商确认后才使用旧 transport，不把 405 或 `text/event-stream` 单独当作证据。

先验证 / 扩展 pi 旧 SSE transport 能力，再扩展宿主 schema、原生投影和草稿探测。若 pi 仍不支持，输出 unsupported_transport 和可用路径，不在宿主另造 runtime，不在 UI 放无法执行的选项。旧 SSE 下还要验认证请求头和断流恢复，不能只测初始化。

### 6.3 本地 stdio：P4，单独的执行边界

复用已有 command/args/env/cwd schema 及 pi stdio runtime，新增受控安装计划。网页中出现一条 `npx` 命令不构成执行授权。

宿主必须把来源、固定包/版本、程序及参数、运行目录、所需 env 字段、网络与文件访问影响做成具体可审阅计划；准备完成后再请求必要授权。优先现有可信本地程序，不能无提示使用 `@latest`、curl 管道或 shell 拼接。密钥经 secret ref 注入进程环境，限制继承宿主其他秘密，日志脱敏。

取消/超时必须结束独立子进程及后代，重启不得留下重复进程。微信只能提出计划，执行仍需 Gateway owner 对具体本地计划批准；用户手机不被描述为实际运行主机。

## 7. 权限、持久恢复与 UI

- **发现权限**：名称搜索仅访问公网。网页不能把候选导向 loopback、LAN、云 metadata 或本机文件；DNS/重定向每跳检查。用户明确提供的本机 MCP URL 继续按现有 owner 权限支持，不能用统一禁内网策略破坏该能力。
- **搜索来源**：读取网页和认证 metadata 不附带 MCP Token；复用既有网络与搜索权限，禁止通过内部发现命令绕过 `web_search/web_fetch` 的拒绝。
- **scope**：Discovery、Plan、Goal 都绑定 principal/conversation/transcript/Agent；沿用微信账户/peer/public-origin校验。明确名称请求允许搜索和已核实唯一目标的常规准备，stdio 执行、扩大 scope 或不同服务替换另有边界。
- **失效**：每次异步动作返回、秘密保存后和 commit 前检查 scope / version。改候选、改目标 URL、认证字段、取消或重置会使旧尝试失效。准备不同地址时不带上旧 Token。
- **重启**：恢复持久目标和 nextRetryAt，重新构造内存草稿；不复用旧 OAuth state/code，不重放已经提交的配置或完成的业务写入。需要重启授权时在原目标内明确提示。
- **续跑**：沿用 setupId 的确定 clientMessageId 做队列幂等键；不能只依靠 `resumed` 布尔值保证 exactly-once。提交已完成但入队未完成时补入队；业务副作用以其既有幂等机制为准。配置生效、任务执行、结果投递分别报告。
- **UI**：仍以对话承接搜索进度和消歧；只在秘密、OAuth、必须审阅本地执行计划时开 modal/sheet。auth_unknown 显示具体依据和可选方式；429 显示等待到期，不放一个会绕过冷却时间的“立即重试”。关闭弹窗不取消目标，取消则撤销后续动作。
- **链接**：宿主生成准确 Markdown 链接，模型原样复制；继续用 app-link 的受控内部路由。E2E 点击实际回复链接，不以测试拼接 URL 代替。

新认证状态、Probe DTO、UI 和所有消费方同批实现。旧持久记录缺少新诊断时标为未检查并重新验证，不根据缺字段猜成 Bearer/OAuth。现有显式 URL 的 start 参数保留；新的 plan 引用是新增入口。

## 8. 实施阶段与交付清单

| 阶段 | 必做任务 | 完成标准 |
| --- | --- | --- |
| P1：名称到 HTTP 闭环 | discovery/evidence/plan、共享搜索读取与权限、工具/manual/SP 路由、connect_only 目标、auth_unknown、结构化诊断依赖、有限恢复、小弹窗和持久续跑 | 只说名称的公开 / Bearer / OAuth 服务，以及错误候选、403、429、HTML、重启等矩阵通过；不能拿已有 URL E2E 替代 |
| P2：Header 认证 | 受控字段描述、多字段安全表单、secret refs 投影、目标指纹与跨源限制 | 真实 X-API-Key / 多字段 fixture，错误/缺失/替换、隔离和重启均通过 |
| P3：旧 SSE | 原生 pi 能力验证或上游实现、schema/投影、传输诊断、兼容测试 | 真正旧 SSE server 的握手、认证、只读调用、断流和释放均通过；依赖未完成则该阶段不通过 |
| P4：stdio | 来源/包版本/执行计划、owner 授权、env 安全、进程生命周期和异常恢复 | 无预装环境与已安装环境的真实子进程 E2E，通过取消、超时、重启不留进程与秘密泄露测试 |

P1 建议任务拆分：

1. **契约与状态**：在 MCP 域定义 Evidence、Plan、AuthDiagnosis、RecoveryAction，迁移旧 JSON 记录语义和版本校验。
2. **发现**：提取共享搜索/抓取服务，增加 discovery/propose/select，保存字段证据和来源可信度，接入工具可用性与取消。
3. **探测**：验证 pi 诊断接口依赖，改 metadata 三态以上结果，覆盖 401/403 与协议阶段；新增 auth_unknown。
4. **恢复**：实现有限重试、Retry-After 和重启续接，endpoint 变更重新校验；拒绝模型提交任意恢复 URL。
5. **交互**：在现有安全弹窗承接新状态；工具手册与精简常驻引导同步，连接完成按 objective 决定是否继续任务。
6. **HTTP 接线**：在 `mcp.ts` 注册所需 discovery/plan 读写，复用 owner admin 校验；验证 `lazy-bundles.ts` 的 `/api/mcp` 匹配并补测试，真实认证 Gateway 路径验收，不能只直接调用路由模块。
7. **E2E 与报告**：按下一节验收，保存失败分类、耗时、实际外部请求次数和脱敏证据；最后才更新支持范围声明。

## 9. 中立、从名称开始的自动验收

### 9.1 两层测试，不混淆成功率

**可重复产品 E2E**：真实对话模型、生产 Gateway/Web Chat、真实 MCP/OAuth 服务及独立搜索 HTTP fixture。搜索 fixture 只返回资料，不生成模型回复；测试不直接写配置 API。普通用户输入只包含服务名称和目标，URL、认证方式、Token 获取入口必须来自搜索结果/资料。

fixture 服务名和端口每次随机，搜索资料不包含“请调用某工具”等答案提示；同时注入排名靠前的错误结果、失效资料和恶意说明，避免模型靠预训练记忆或测试专用服务名过关。仅在安全输入环节由测试模拟用户输入测试秘密。

**在线发现抽检**：使用真实搜索 provider 和官方公开资料，只给真实服务名称；单独报告找到正确官方资料、正确 endpoint/认证的比例。无第三方测试账号时不得把名称发现通过说成官方授权和业务调用通过。也不得用本地 fixture 结果代表搜索引擎线上排名的稳定性。

### 9.2 必须通过的矩阵

| 场景 | 起点与断言 |
| --- | --- |
| 名称 + 仅连接公开服务 | 搜索/抓取确实发生，来源准确，原生发现与配置生效；业务工具调用数为 0 |
| 名称 + 查询目标 | 原会话真实调用并返回本次服务随机标记；未提供凭据前无读取 |
| 名称 + 明确 Bearer | 从资料提取准确 endpoint、认证方式与申请入口；直接打开真实回复链接中的安全表单，无无凭据探测 |
| 401 无元数据 | auth_unknown，不把“没发现 OAuth”当作“确定为 Token” |
| 403 + 有效 OAuth metadata | 不误导 Token；真实授权、回流和原会话续跑 |
| 403 + 通用 JSON、无 challenge | 不伪造拒绝原因，提供首次 Token/认证选择，错误秘密可替换 |
| metadata 超时、TLS、格式错误 | 各自原因保留；不转换成已确认的认证方法 |
| 多候选 / 地区歧义 | 用户选择前不安装或提交错误服务；只问必要问题 |
| 错误搜索结果 / 文档注入 | 不把社区代理当官方，不执行网页命令，不扩大权限，不把秘密发往替代地址 |
| POST 404/405、正常 GET 405、HTML | 依据 method/stage 区分；只使用有来源的新 endpoint；禁止猜路径 |
| 429 / Retry-After 与重启 | 冷却期间无请求；尝试预算不因刷新/重启清零；可恢复的服务最终完成 |
| 错误 Token / 新 header | 秘密只走安全表单，错误可恢复，模型、transcript、日志、URL 和普通配置均不含明文 |
| 取消 / 过期 / 原会话 reset | 旧链接、异步响应、OAuth callback、待重试动作不能恢复旧授权或提交配置 |
| 续跑与副作用 | 原 conversation、目标与版本一致，只入队一次；仅连接不额外执行任务；写操作不因超时重复 |
| 搜索权限拒绝 / 搜索不可用 | 明确阻塞且无隐式旁路；允许用户提供公开资料作为新输入 |

### 9.3 发布门槛

每阶段必须单独具备可复跑脚本、结构化报告与失败证据。关键安全/身份/目标断言全部通过；P1 核心可恢复路径至少连续运行 3 轮，逐轮报告结果，不挑一次成功当作通过。确定不可恢复的 fixture 应以正确阻塞作为预期结果，不算连接成功。

报告分别统计发现正确率、认证判断准确率、连接验证率、原任务完成率、非预期阻塞、用户必要交互次数、重试次数、耗时与秘密泄露检查。分母包含所有尝试；基础设施/搜索/模型不可用单列原因，不能从报告消失。在线抽检建立基线后再决定性能和覆盖率阈值，不预先宣称任意第三方服务 100% 可连接。

## 10. 参考与版本说明

- [MCP Authorization（2025-06-18）](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)：HTTP 认证、资源元数据及授权服务器发现的兼容依据。
- [MCP Transports（2025-06-18）](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)：区分 Streamable HTTP、可选 GET 405 与旧 HTTP+SSE。
- [MCP Authorization（2026-07-28）](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)及[安全实践](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)：调研时 latest 指向的版本；用于复核资源边界和 SSRF 等要求，不等同于当前运行时已升级该协议。
- [麦当劳官方接入指南](https://github.com/M-China/mcd-mcp-server)：作为名称发现后应取得 endpoint、Bearer 认证和 Token 获取入口的真实例子，不硬编码为唯一特例。
- [本轮 Token / 403 修复与证据](mcp-token-auth-recovery-investigation-2026-10-28.md)：153 项回归及 9 场景专项 E2E；其输入主要已有 URL，不能作为本方案名称发现闭环的验收证据。
