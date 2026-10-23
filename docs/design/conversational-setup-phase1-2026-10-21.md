# xopc 对话式配置与使用：第一期产品和技术方案

日期：2026-10-21。源码核查基线：`c4e754d32`。状态：完整 setup 闭环仍为设计提案；基于现有能力的对话指引已完成实测选型和代码集成，main 为主要验收入口。

后续实测决策：第一轮在 main 上选出完整内置指引；第二轮将其与“精简常驻规则＋主题 manual＋工具约束”比较，最终两组各 32/32，精简版累计输入少 12.8%，已按结果实现。当前指南按实际 xopc_use 工具注册开放，不再限制 main；新增四类 manual topic、设置入口校验及安全 profile patch。个人 Agent 不是本次真实评测对象。完整语音设备、Gmail 读取及 setup 协调器仍为后续方案。见[最新评测报告](technical/conversational-setup-compact-evaluation-2026-10-21.md)及[第一轮历史报告](technical/conversational-setup-evaluation-2026-10-21.md)。

本期目标：用户说出要做的事，xopc 检查真实能力，补齐必要设置，完成一次实际使用，并能从中断处继续。

本文记录当前实现、Codex 调研、拟新增设计、实施顺序和验收门槛。现有测试文件及历史验收记录仅作复用依据，不代表本方案已通过测试。后续真实模型评测与合成数据操作记录在最终评测报告中；本文提出的语音设备验证、Gmail 实际读取及持久 setup 协调器尚未实现。

## 1. 范围与产品决策

### 1.1 第一期开通三个流程

| 流程 | 用户表达示例 | 完成标准 |
|---|---|---|
| A：能力检查 | “检查我现在有哪些能力可以用” | 返回当前身份、Agent 和会话下的真实状态、原因及可执行下一步 |
| B：开启语音并测试 | “帮我开启语音，并完成一次测试” | 应用用户授权范围内的配置，完成录音识别和回复播放；设备测试仍需用户操作 |
| C：邮箱摘要与每日自动化 | “每天早上九点整理我的 Gmail” | 连接指定账号，生成一次真实摘要，核对时间和结果位置，建立同账号的周期执行 |

第一期以本地 owner 的 Web Chat 为主；Electron 使用相同 Web UI，但麦克风权限、系统浏览器授权必须单独验收。连接恢复现有实现要求 local owner，不宣称已覆盖 Telegram、Weixin、共享群聊或其他身份。其他入口提供准确说明和可信管理入口，不自动套用 owner 权限。

流程 C 首先支持 Gmail 经当前可用连接后端的只读邮件摘要。具体 toolkit、工具和安装候选由运行时目录决定，不硬编码未经发现的工具引用。其他邮箱延后；单纯“总结邮件”不能默认创建周期自动化。

### 1.2 本期边界

- 能力报告覆盖聊天模型、看图、生成图片、搜索、语音、浏览器、连接器、自动化。只对语音和 Gmail 摘要提供新的完整配置流程。
- 语音按现有产品区分听写、助手对话、自然对话；默认推荐能完成目标的最小组合。自然对话仅在实际路由支持时提供。
- 当前语音配置属于共享配置中的 STT、TTS、realtime 设置；第一期明确展示全局影响，不承诺尚不存在的 Agent 私有语音覆盖。
- 不新增任意 JSON 配置编辑、凭证明文聊天输入、通用自动修复命令或新的插件市场。
- 不把邮件摘要扩展成发送、删除、归档或标记邮件；第三方写操作继续走原有授权策略。
- 无聊天模型时保留现有 Cloud／provider onboarding，可在模型不可用时独立运行；不依赖模型完成首个模型配置。本期只接入回流和状态检查，不重写首次安装向导。

### 1.3 交互原则

1. 先检查，再回答；“已配置”“路由就绪”“本次验证成功”分别呈现。
2. 只追问影响执行的缺失信息。已有明确授权可继续，不因为进入配置步骤就重复询问。
3. 需要授权、凭证或设备权限时，用宿主提供的操作；用户无需复制命令、配置路径或 OAuth URL。
4. 保留用户目标与已完成步骤；刷新或重启后可以继续，取消后不被旧回调重新启动。
5. 设置完成必须提供一次可观察结果。保存开关不等于麦克风、模型、邮箱或调度已经工作。
6. 现有设置页仍用于完整管理；对话中的简明操作和设置页共享服务及状态。

## 2. 当前实现：复用与新增的准确边界

本次没有发现可调用的 codebase-memory graph 工具，因此按仓库指引回退到文件搜索和源码阅读。以下均为源码存在性与调用链核查，不是线上可用性承诺。

| 模块 | 已有实现与证据 | 复用方式 | 必须新增或调整 |
|---|---|---|---|
| 产品操作 | [xopc-use-tool.ts](../../src/agent/tools/xopc-use-tool.ts)、[product.ts](../../src/capabilities/runtime/product.ts) | 复用领域 dispatcher、产品回执、现有 Agent／任务／笔记／自动化操作 | 增加受控 setup 工具适配；不依赖改存储文件 |
| 设置入口 | [settings.ts](../../src/capabilities/runtime/settings.ts) | 保留 `xopc.settings.open` 导航建议 | 当前不能查询或修改配置；新增状态与配置服务，不能把 open 成功当作应用成功 |
| 聊天配置命令 | [config.ts](../../src/chat-commands/builtins/config.ts) | 保留已有命令与 schema 验证 | 不将 `/config set path=value` 包装成新的任意路径写工具；provider 与 gateway token 等原有边界不放宽 |
| 能力规划 | [readiness/](../../src/capabilities/readiness/) | 复用候选排序、disabled／degraded／unavailable 原因 | 当前仅五类能力；`from-config` 使用默认 Agent 目录信息，不是任意当前会话解析器；需增加上下文适配 |
| Provider setup | [engine.ts](../../src/providers/setup/engine.ts)、[provider-setup.ts](../../src/gateway/hono/routes/provider-setup.ts) | 复用推荐、selected uses、preview revision、apply 校验 | 提取 HTTP 外可调用的应用服务，明确部分保存和运行时 reload 结果 |
| Cloud 首次配置 | [xopc-cloud-onboarding.ts](../../src/gateway/xopc-cloud-onboarding.ts)、[历史验收](technical/onboarding-all-capabilities-2026-10-18.md) | 复用现有登录和多用途配置 | 增加绑定 setup run 的返回入口；历史测试通过不能替代本期真实测试 |
| 语音目录与选择 | [voice.ts](../../src/gateway/hono/routes/voice.ts)、[platform-settings.ts](../../src/voice/platform-settings.ts) | 复用 catalog、selection、realtime status、preflight、sessions、preview | 将目录状态与实际验证分开；统一共享写锁与并发检查 |
| 语音配置 | [config.ts](../../src/gateway/hono/routes/config.ts)、[voice-settings-revisions.ts](../../src/gateway/hono/lib/voice-settings-revisions.ts) | 复用按 transcription／speech／conversation 的 revision 与 patch 语义 | 新配置入口必须使用同一领域服务；revision 采用进程随机 HMAC key，重启后旧 revision 要重新预览 |
| 语音交互 | [voice-config-api.ts](../../web/src/features/settings/voice-config-api.ts)、[composer](../../web/src/features/chat/composer/)、[realtime](../../web/src/features/voice/realtime/) | 复用采集、上传、播放、实时会话与麦克风租约 | 新增聊天内测试面板、设备证据和结果回传；不能由服务端声称已允许麦克风或已听到声音 |
| 外部工具 | [gateway-tools.ts](../../src/agent/external-tools/gateway-tools.ts) | 复用 search → describe → execute；候选不足时 require connection | Gmail 需求和已验证工具映射；保持真实工具引用及契约 revision |
| 连接恢复 | [connection-recovery-service.ts](../../src/connectors/connection-recovery-service.ts)、[connection-wait-repository.ts](../../src/storage/sqlite/connection-wait-repository.ts) | 复用持久等待、checkpoint、账号选择、连接／工具验证、取消及队列续跑 | setup run 只引用 waitId，不复制 OAuth 或新建第二套连接状态机 |
| 连接 UI | [connection-action-bar.tsx](../../web/src/features/chat/connections/connection-action-bar.tsx)、[connection-waits.ts](../../src/gateway/hono/routes/connection-waits.ts) | 复用唯一连接操作区与安装审阅 | 连接后衔接摘要／自动化步骤；不再增加竞争的“连接 Gmail”按钮 |
| 自动化 | [drafts.ts](../../src/automations/capabilities/drafts.ts)、[write.ts](../../src/automations/capabilities/write.ts)、[action-executor.ts](../../src/automations/service/action-executor.ts) | 复用 draft、simulate、create、run、set_enabled 与持久回执 | 增加结构化邮件来源绑定、未来执行的身份校验、首个结果证据和流程协调 |
| 自动化契约 | [automations.ts](../../packages/gateway-contract/src/automations.ts) | 复用 cron 时区、delivery、run status、运行快照 | 当前 agent action 无专用账号绑定字段；不能只靠 instruction 中写账号保证后续执行一致 |
| 诊断 | [doctor.ts](../../src/gateway/hono/routes/doctor.ts)、[setup-diagnostics-api.ts](../../web/src/features/settings/setup-checklist/setup-diagnostics-api.ts) | 复用只读诊断和浏览器检查 | 新增可控时延的聚合报告；重型 deep doctor 不默认每轮执行 |
| 产品使用手册 | [xopc-use.ts](../../src/agent/tool-manuals/xopc-use.ts)、[tool-manual-tool.ts](../../src/agent/tools/tool-manual-tool.ts)、[factory.ts](../../src/agent/tools/factory.ts) | 复用 `tool_manual({ tool: 'xopc_use' })`、对象路由、操作步骤和错误恢复 | 补强场景引导与按主题读取；本次按实际工具注册注入精简指引，增加四类主题手册；不新增产品引导 Skill |

注意两项现有机制的限制：`simulate` 只校验和解释自动化，不执行模型或读取邮箱；`persistConfigMutation` 能恢复内存快照，不等于跨文件／SQLite 事务，也不能抹去已经落盘的事实。

## 3. Codex 调研：是否有 skill 支撑

### 3.1 官方已证实的机制

调研日期为 2026-10-21。只将实际打开的官方页面作为外部产品依据。

| 机制 | 已核实事实 | 对 xopc 的启示 |
|---|---|---|
| Skill 发现与读取 | 模型先看到 name／description，再按需读取正文；支持显式和隐式调用 | 产品引导需要清晰触发描述，不应把整本手册塞进每轮 prompt。[Build skills](https://learn.chatgpt.com/docs/build-skills) |
| Skill 与工具分工 | Skill 描述如何组合工具完成工作；MCP 工具提供实时信息与受控动作 | 指南不能代替后端验证、配置写入和权限检查。[Skills 概念](https://developers.openai.com/plugins/concepts/skills) |
| 插件安装后引导 | 插件可声明 `extensions.com.openai.onboardingSkill`；用户运行 setup 时调用包内 skill，可进入新对话或安装所在对话 | 后续可为 xopc 扩展提供同类引导入口；第一期先做内置产品引导，不增加插件协议。[Package your plugin](https://developers.openai.com/plugins/build/plugins) |
| 使用引导 | 官方提示指南围绕目标、上下文、输出和边界组织请求，给出操作及验证示例 | 引导询问用户想完成的成果，按需补充信息；用结果验证是否完成。[Prompting](https://learn.chatgpt.com/docs/prompting) |

上表是产品设计参考，不据此推断 Codex 的内部持久化、权限或自动恢复实现。官方页面支持 onboarding skill，不代表 Codex 所有设置都能通过自然语言修改。

### 3.2 当前本地环境观察

本次读取的已安装 skill 显示：

- `openai-docs`：覆盖 Codex 使用、配置、自知识与排障，要求按需核对官方资料。这是最接近“教用户用好产品”的现有 skill。
- `skill-creator`：把重复流程整理成可复用 skill；不是产品状态查询器。
- `skill-installer`：发现及安装技能；不是账号授权或配置执行器。
- 本地还有 `find-skills` 等生态技能。不能将本地安装状态概括成所有 Codex 用户的默认配置。

OpenAI Docs 手册抓取 helper 本次返回 HTTP 403，已改为打开对应官方页面核查；不将未取得的手册当作证据。没有安装新 skill、插件或执行任何账号授权。

### 3.3 待验证的设计假设：优先补强 manual

现有 `xopc_use` 已是产品操作入口，`tool_manual({ tool: 'xopc_use' })` 已提供对象路由、可靠操作步骤和错误恢复。原建议将产品引导补到这份手册，避免入口选择、资料维护及触发规则重复；最新要求是与独立 Skill、直接提示词及现有基线实际比较，再决定是否采用。Codex 的 onboarding skill 说明一种可用机制，不要求 xopc 采用相同包装。

职责分工：工具描述提供简短触发提示；manual 说明用户目标如何对应产品动作、必要补问、调用顺序、作用范围和验证方式；`xopc_use` 及专用工具执行动作；领域服务负责权限、版本、幂等、事实和持久恢复。manual 可以覆盖跨工具场景，但每个动作只指向现有权威入口，不复制专用工具的完整参数手册。

手册补强五类内容：

1. 使用入口：如何检查能力，如何选择任务／项目／自动化，哪些请求可以直接执行。
2. 配置范围：当前对话、当前 Agent、全局和设备之间的区别，以及哪些配置尚未开放。
3. 场景流程：能力检查、语音配置和测试、邮件摘要与每日自动化。
4. 验证和恢复：已保存、已生效、已测试的区分，以及冲突、部分成功、取消和重新连接的处理。
5. 当前能力边界：动态状态从工具取得；文档未实现的命令不得呈现为可调用。

当前 manual 一次返回完整正文，且已包含较多领域内容。拟增加可选 `topic` 参数，例如 `overview`、`capabilities`、`voice-setup`、`mail-digest`；省略时兼容原调用。主题内容由同一份模块化资料构建完整手册，避免维护两份重复正文。未知主题返回合法主题列表，不能静默回退到不相关内容。

在工具描述／现有 tooling prompt 中增加简短的目标路由提示：询问如何使用或配置 xopc 时按需加载相关主题；普通写作、编码、文件处理不加载。简单且明确的产品动作可直接调用，不能把读手册变成所有调用的硬前置。权限与正确性必须由执行代码保证，即使模型未读手册仍不能越权。

第一期也不新增独立 `find-skills` 或 `skill-installer`：xopc 已有市场搜索、安装和管理工具。后续仅在独立业务流程需要可选安装、分享或用户定制时考虑 skill；核心产品使用知识继续由 manual 统一维护。

## 4. 三条用户路径

### 4.1 A：能力检查

1. 用户问“我现在能做什么”；宿主绑定当前身份、conversationId、transcriptId 和 Agent。
2. 读取有效模型配置、工具开关／权限、语音路由、连接状态、调度服务；按领域权限裁剪。
3. 返回简短报告：可用、尚未验证、需配置、已关闭、受限制；每项可展开原因和检查时间。
4. 只给一至两个与用户目标相关的动作。例如“开启语音”“连接 Gmail”“查看浏览器设置”。
5. 普通查询不调用付费模型测试、不触发 OAuth、不写配置；用户明确要求测试时才进入验证步骤。

状态文案示例：“语音服务已配置，当前设备尚未测试”“Gmail 已连接，但本次需要的搜索工具暂不可用”。不能把服务超时报成未授权。

### 4.2 B：开启语音并完成测试

1. 检查现有听写、助手／自然对话路由及凭证引用；尊重用户已有关闭选择，当前明确请求开启的用途除外。
2. 生成最小方案：所选用途、provider／model／voice、共享配置影响、预计需要的设备操作及用量提示。模型价格未知时不编造金额。
3. 已有请求足够明确且策略允许时直接应用；需要选择模式、服务或新增全局影响时展示具体方案让用户选择。选择完成即构成该方案的授权，不再连问。
4. 缺凭证时进入现有登录／受保护设置入口，返回后重新生成 preview；凭证不进入聊天 transcript 或 setup plan。
5. 应用后先核对 persisted 与 runtime-effective 状态，再提供录制测试。复用麦克风权限和租约，录一句话 → 显示识别文字 → 播放回复。
6. 服务端记录 STT／TTS 或实时会话证据；客户端记录采集、播放事件。需要用户判断“是否听到”时明确标为用户反馈。
7. 用户跳过设备测试时结果为“配置已保存，设备测试待完成”，不能标记完整成功。

保存成功但 provider 不可用时保留配置与失败证据，提供重试或恢复本次受影响设置。拒绝麦克风权限不应被误判成凭证失效。

### 4.3 C：连接 Gmail、首份摘要、每日自动化

1. 解析目标并记录时区、每日时间、邮件范围和结果位置。示例使用 `Asia/Shanghai`；缺时区先从可信用户设置取得，再有歧义才问。
2. 搜索真实邮件读取工具。已可用时直接使用；缺连接时复用 `xopc_require_connection` 和唯一连接操作区，保存已完成与剩余步骤。
3. 绑定准确账号和连接引用。授权后复验身份、scope、工具契约，恢复原目标，不要求用户再输入“继续”。
4. 生成自动化方案：Gmail 脱敏账号、每天本地时间、每次执行时计算的查询范围、摘要字段、xopc 内结果入口、通知偏好。默认不外发到邮箱、Webhook 或其他渠道。
5. 复用 draft／simulate；采用固定支持模板和 schema 验证，不能把模型生成的草稿直接当成可信配置。
6. 对已明确要求周期执行的用户，创建 `enabled=false` 的自动化并记录稳定 id；经真实 run 生成首份摘要，复用后续将使用的执行器与账号绑定。
7. 根据 run 状态和结构化读取证据判断结果。读到零封邮件是成功的空结果；没有工具执行证据却由模型声称完成，不算成功。
8. 首次验证通过且原始周期授权、方案版本仍有效时启用同一条自动化；显示首份摘要、下次运行时间和结果入口。试运行跨过原定触发时间时不补跑过去的周期。
9. 用户只要求试用，或明确要求先审阅，则保持未启用。失败保留未启用对象和恢复入口；重试不另建第二条自动化。

页面 `gateway_event` 通知不能直接解释为永久聊天消息或系统推送。第一期保证结果能在 xopc 自动化运行详情中查看；若需要聊天内稳定结果链接，新增结构化引用并验证刷新后仍可打开。额外通知渠道另行明确配置。

未来运行每次重新验证绑定账号及读取权限。账号失效时保留自动化并报告需重连；后台不得自行切换到另一个 active 账号或反复打开授权窗口。

## 5. 技术设计

### 5.1 分层和事实来源

```text
用户目标 / 按需加载 xopc_use manual
          │
          ▼
受控 setup 工具 ─────────────── Web Chat 配置与测试面板
          │                              │
          ▼                              ▼
SetupApplicationService ─────── 共享、带鉴权的领域服务
          │                       │
          ├─ 能力状态聚合           ├─ provider / voice setup
          ├─ SetupRun / plan       ├─ ConnectionWait / session input
          └─ 步骤回执与协调         └─ AutomationService / 真实 run
```

不新增第二份配置真相。配置文件和 AgentCatalog／全局 defaults 仍由现有服务维护；连接事实仍来自 connector repository；执行事实仍来自 automation runs；新记录只保存配置流程、计划及上述对象引用。

### 5.2 能力报告契约（新增）

在 `packages/gateway-contract/src/` 新增 `conversational-setup.ts`，导出 Zod schema。建议结构：

```typescript
type CapabilityReadiness = {
  capability: string;
  availability: 'ready' | 'degraded' | 'unavailable' | 'disabled' | 'restricted' | 'unknown';
  verification: 'not_tested' | 'passed' | 'failed' | 'stale';
  effectiveScope: 'conversation' | 'agent' | 'global' | 'device';
  reasons: Array<{ code: string; message: string }>;
  observedAt: number;
  verifiedAt?: number;
  evidenceRef?: string;
  allowedActions: Array<{ action: string; targetRef?: string }>;
};
```

宿主提供身份和会话上下文；不接受模型自报 principal／scope。有效配置按当前会话及 Agent 解析，不能直接把默认 Agent 的 `buildCapabilityPlansForConfig` 输出当作所有对话的结果。

聚合层采用独立 adapter：model、search、voice、browser、connector、automation；每项失败返回 unknown 与原因，不拖垮整份报告。缓存包含身份、Agent、会话配置版本及目录版本；配置／连接变更失效。设备状态带客户端会话标识及观察时间，未上报时为 unknown。

普通检查仅读本地状态与已有诊断快照。远端探测为显式 verify，需超时、取消、有限重试；不得因可用性探测产生第三方写操作。错误码至少区分 disabled_by_user、missing_credentials、unsupported_model、account_required、scope_missing、policy_denied、provider_unreachable、device_permission_denied、runtime_reload_failed。

### 5.3 持久化 SetupRun（新增，限本期两种配置流程）

拟新增 `src/setup/` 应用模块和 SQLite `setup_runs`、`setup_step_receipts` 表，通过现有迁移机制分配实际版本号，不预先占用版本。能力检查不创建 SetupRun。

| 数据 | 要求 |
|---|---|
| 身份与归属 | id、owner／principalId、conversationId、transcriptId、agentId、kind（voice_setup／mail_digest） |
| 目标与版本 | objective、objectiveRevision、version、createdAt、updatedAt |
| 计划 | schemaVersion、planRevision、受控用途／账号引用／时间／结果位置、受影响设置的 before／after 脱敏摘要 |
| 授权 | 已授权动作范围、授权来源引用、对应 planRevision；模型不能通过 `approved=true` 自授予权限 |
| 步骤引用 | connectionWaitId、provider setup 引用、automationId、automationRunId、verification refs |
| 执行与恢复 | 当前步骤、步骤状态、稳定幂等键、错误码；凭证、音频和邮件正文不保存在此表 |

状态为 `planning → waiting_user / applying → verifying → completed`，并支持 `failed / cancelled / stale`。配置已保存但设备测试待完成属于 waiting_user；跨存储部分成功通过逐步骤回执表达，不能笼统回成“未保存”。

ConnectionWait 仍是连接等待的唯一权威来源。SetupRun 只记录依赖引用与下一步骤；OAuth callback 不直接执行配置或创建自动化。连接恢复输入在现有 session input 调度下触发协调器重读状态，唯一键 `(setupRunId, objectiveRevision, step)` 配合版本检查防止重复推进。

一个会话同时只允许一个活跃配置流程；与现有前台 ConnectionWait 有冲突时返回已有目标，不能静默替换。无关聊天可继续，取消／reset／目标修改会废止旧 plan 的执行授权。取消流程不会自动撤销已连接账号、已保存设置或已启用自动化；返回已生效对象，按用户明确意图调用原有暂停／撤销操作。

### 5.4 配置应用、并发及失败恢复

- 从 HTTP handler 中提取可复用 provider／voice 应用服务；新工具直接调用服务，不 loopback HTTP，不复制 patch 逻辑。
- 统一配置写入口的锁与 expected-config 检查。当前 provider／config 路由使用 `withGatewayConfigWriteLock`，voice selection 使用不同的 `withModelConfigLock`；实施时必须统一或证明协调关系，不能仅给新入口加锁。
- 复用 preview revision 和 voice scope revision。旧计划、目录变化、运行时重启导致 revision 失效时重新预览；计划授权不能沿用到不同模型或扩大用途。
- 只修改计划覆盖的设置，保留现有 TTS trigger、未选择用途及其他并发修改。第一期语音优先只写所需 voice 配置，避免为语音需求顺带重配聊天模型和全部 intents。
- Provider setup 现有路径先保存 voice，再更新 SQLite defaults；可能部分成功。新步骤先持久化执行意图，分别记录文件落盘、运行时 reload、defaults 提交事实，并在重启后重新读取核对。
- 不把文件写操作放进 SQLite transaction 后宣称原子性。若观察到目标字段已匹配且回执缺失，可补齐状态；结果无法判定时标记 unknown，先核实再重试。
- 恢复本次设置采用字段范围补偿：仅在当前值仍等于本次写入值时恢复 before 值；否则返回 conflict，不能覆盖用户之后的修改。补偿需明确动作或有效授权，不自动把已经生效配置回滚成旧版本。
- 外部请求和模型计费不能承诺 exactly-once。稳定请求键防止重复领取；崩溃后结果不明时先查询原 run／请求，不盲目重发。

### 5.5 邮件账号绑定与执行证据（新增）

在现有 agent automation action 中增加可选、严格 schema 的 `sourceBindings`；第一期仅允许 Gmail 摘要所需的已授权只读来源绑定。内容包括可信 principal 引用、connectorId、accountId、connectionId 和允许的语义能力。不能包含 token 或由模型提供的任意 permission scopes。

领域服务从已验证连接生成绑定。run 接受时将其纳入现有配置快照；执行器把绑定放入受信上下文，外部工具发现及执行均限制到该账号。未来 session 的 principal 必须由后台调度的可信身份解析得到，不能使用 action 自报 principal 覆盖鉴权。重连允许更新同一 account 的 connection，切换 account 必须更新计划与授权。

现有安全策略仍作最终控制。摘要流程仅允许读取；邮件正文是外部数据，不得用正文指令发起配置更改或扩大工具权限。

新增受控邮件摘要模板与结果契约，记录账号引用、查询绝对时间范围、实际查询时间、读取数量、所用工具／契约版本和结果资源引用。结构化证据由执行宿主收集并与 run 关联，不接受模型自行提交“已成功读取”的布尔值。

首次试运行固定绝对范围；周期配置保存范围规则和时区，每次运行重新解析。长时间等待后继续按现有范围确认规则处理，不把“未读”解释成能还原过去未读快照。

### 5.6 工具、HTTP 与前端（拟新增）

扩展现有 `xopc_use`：`mode: capability` 提供 inspect；`mode: setup` 提供 plan／get／apply／verify／cancel。本期不新增 `xopc_setup` 工具。新增分支采用严格的 discriminated union schema，在调用边界验证；内部拆分服务，避免向现有大函数继续堆叠逻辑：

| 命令 | 输入与行为 | 权限 |
|---|---|---|
| inspect | 可选能力列表；上下文由宿主注入 | gateway.status 加各领域读取权限，按权限裁剪 |
| plan | kind、目标和允许选项；返回 SetupRun 与具体计划 | 目标领域权限；计划不产生配置或自动化副作用 |
| get | setupRunId；读取当前允许动作 | 所有权及会话归属检查 |
| apply | setupRunId、expectedVersion、planRevision、idempotencyKey | 语音写入沿用 gateway.admin；邮件创建／启用沿用 automations.write，并验证原目标授权 |
| verify | setupRunId、具体验证步骤 | 原身份／领域权限；设备采集仍由客户端用户操作 |
| cancel | setupRunId、expectedVersion、idempotencyKey | 所有权检查；只取消未领取的后续步骤 |

工具写入 adapter 使用共享 capability dispatcher 的鉴权／外部操作回执机制；配置写入按外部效果处理，不标记成单库原子写。参数与 HTTP 共用 Zod schema，并为工具导出 schema，避免两套规则。

拟 API：`GET /api/setup/readiness`、`POST /api/setup/plans`、`GET /api/setup/runs/:id`、`POST /api/setup/runs/:id/actions`。账号、OAuth、语音会话、音频上传仍调用既有受鉴权入口。设备结果单独经过验证 schema；客户端播放事件不能升级为服务端模型验证证据。

新增路由必须同步 `lazy-bundles.ts` 与正反例测试，并通过真实认证 Gateway 访问。计划在现有 broad `/api/capabilities` 外使用 `/api/setup`，仍须验证附近路径不重叠。实时事件只负责通知重读；REST／SQLite 为恢复事实源。

完整 setup 能力未来应按入口真实授权收窄，不能因为注册工具就自动赋予 admin。本次以 main 测试为主并补 coder 范围验证；指南按 xopc_use 最终工具注册注入，不改变 allowlist 或授权策略。四类 manual topic 已实现；更完整的 setup 流程仍按后续能力逐步开放。

前端新增 `web/src/features/chat/setup/`：能力报告、设置变化预览、进度与测试面板。复用 ProductDeliveryEnvelope 机制，新增严格版本化的 setup presentation；仅提供服务端允许的动作与受控 setupRunId，不执行历史 Markdown 中的链接命令。

连接依赖继续使用 ConnectionActionBar；配置面板显示其状态引用，避免两个主操作区争抢。刷新时重新读取允许动作。固定外层对话框尺寸、内部滚动、Skeleton 和项目 Select，沿用现有语义色与中英 i18n。历史完成消息保留当时结果，当前状态另行读取。

## 6. 实施顺序与交付物

| 阶段 | 工作与交付 | 依赖及退出条件 |
|---|---|---|
| S0：契约与边界 | 新契约、错误码、三条流程 fixture、权限矩阵；确认真实语音路径及邮件绑定在 executor 的落点 | 不改运行行为；schema 能覆盖 ready／unknown／部分成功／重启等状态 |
| S1：只读能力检查 | `src/setup/readiness/` adapters、inspect 工具、HTTP、报告 UI、默认个人会话接线 | 先交付 A；真实认证 Gateway、不同 Agent／权限与设备 unknown 全通过 |
| S2：配置应用基础 | 提取 provider／voice 应用服务、统一写锁、SetupRun／步骤回执、apply／cancel／get、迁移和恢复 | 文件／SQLite 部分成功可判定；并发写与 restart 注入测试通过 |
| S3：语音完整流程 | 方案、凭证回流、配置应用、录音／播放验证、冲突补偿 | 交付 B；Web 实际麦克风与播放通过，Electron 单列结果 |
| S4：邮箱来源与首份摘要 | sourceBindings、可信 executor 上下文、Gmail 模板及结构化证据、ConnectionWait 衔接 | 同账号贯穿连接与实际读取；零邮件、过期、取消和重复恢复通过 |
| S5：周期闭环 | 复用 draft／simulate／create disabled／run／enable；记录资源 id、首份摘要和下次时间 | 交付 C；真实执行器的首次及后续调度均遵守账号绑定，无重复自动化 |
| S6：manual 补强与发布验收 | 手册主题、场景流程、工具描述／tooling prompt 路由、加载评测、完整恢复回归与指标 | 手册与可执行命令一致；三条真实用户路径及下表门槛通过 |

顺序为 S0 → S1 → S2 → S3 → S4 → S5 → S6。手册结构及现有能力说明可在 S1 补强；新增流程说明随对应工具能力交付，不提前暴露未实现命令。S4 的账号与执行证据是 S5 启用周期执行的硬前置，不能以 prompt 中写账号替代。

本方案不预估人日；S0 确认 executor 和配置服务提取规模后再估算。开发可分批合入，但未完成的入口不得被 manual 或工具描述推荐为可用。

## 7. 验收标准

### 7.1 功能与异常矩阵

| 编号 | 用例 | 必须观察到的结果 |
|---|---|---|
| A01 | 当前 Agent 覆盖全局模型；会话另有覆盖 | 报告与实际执行解析一致，展示正确作用域 |
| A02 | STT 已配置但用户关闭；provider 有凭证但服务宕机 | 分别显示 disabled 与验证失败／未知，不误报 ready 或未授权 |
| A03 | 无远端访问的普通 inspect | 无配置修改、OAuth、音频请求或付费模型测试 |
| A04 | 不同用户／Agent／会话缓存 | 不泄露别人的账号；无权限字段被裁剪，旧缓存不跨身份复用 |
| A05 | 无聊天模型 | 现有 onboarding 可运行；完成后回到目标，不伪装已有 Agent 对话 |
| B01 | 已有可用凭证，请求开启语音 | 仅改变选中用途；共享范围清楚，TTS trigger 等未选字段保持 |
| B02 | 真实录制、识别、回复播放 | 有实际服务证据、客户端播放事件；用户听感反馈单列，不能只凭 HTTP 200 |
| B03 | 麦克风拒绝、设备占用、播放失败、用户跳过 | 原因明确；允许重试，状态不误写成完整成功 |
| B04 | 缺凭证，登录后返回 | transcript、日志和 setup plan 不含凭证；重新预览并继续相同 run |
| B05 | 两个页面同时改 voice／provider；目录变化 | 陈旧计划被拒绝或重新预览，无未选字段丢失 |
| B06 | 文件落盘后 reload 失败／defaults 更新失败 | 准确显示已落盘与未完成步骤；重启可核对，不谎报全部回滚 |
| B07 | 写后崩溃、重复点击、恢复设置时已有后续修改 | 同步骤不重复领取；补偿冲突拒绝覆盖用户新值 |
| C01 | 未连接 Gmail，连接并继续 | 一处连接操作区；刷新／重启后目标还在；无需重述或回复继续 |
| C02 | 已有多账号，授权 A 而 B 也 active | 首次摘要和后续定时执行都访问 A；失效时不切换 B |
| C03 | 空邮箱／scope 不足／工具不可用／网络失败 | 空结果可成功；其余分类失败，未读取时不生成虚构摘要 |
| C04 | 试运行失败或用户只要求试用 | 自动化未启用；重试复用对象；simulate 不能替代真实 run |
| C05 | 用户明确要求每日执行，首次验证通过 | 同一对象启用；展示正确时区、范围规则、下次时间及可打开结果 |
| C06 | 重复回调、两标签、队列重复投递、进程重启 | 一个有效步骤推进、一条自动化；未知外部结果先核查原 run |
| C07 | 等待期间修改范围、取消、reset；迟到 OAuth 回调 | 旧计划不运行；账号事实可更新，但旧目标不会复活 |
| C08 | 数日后恢复“最近一天”；未来一次运行 | 恢复使用确认后的范围；周期运行重算时间，不固定首测日期 |
| C09 | 邮件正文要求发送或修改配置 | 作为数据处理，不触发写工具或配置变更 |
| X01 | 工具、HTTP、设置页同一配置动作 | 共享服务产生一致结果，版本冲突和权限语义一致 |
| X02 | 新 API 的真实 authenticated Gateway 路径 | 无认证 401，越权拒绝，合法正向可达；lazy matcher 无邻近误匹配 |
| X03 | Web 刷新、窄屏、键盘及 Electron 权限 | 状态可恢复；无布局跳动／重复连接入口；Electron 结果单独记录 |

### 7.2 测试层级与发布门槛

1. 单元测试：状态 adapter、严格 schema、scope 解析、计划变化与版本、范围计算、补偿 CAS、manual 主题读取与兼容性、引导加载和不加载样例。
2. 集成测试：临时配置与数据库、共享写入口并发、持久回执、ConnectionWait／session input／SetupRun 协调、崩溃恢复、账号绑定和调度执行。
3. 真实 Gateway + 浏览器：三条路径、认证和 lazy routing、实际 UI 状态、刷新与取消；不能只测试 route module。
4. 外部服务验收：使用明确授权的测试账号和测试邮件，完成真实读取、STT／TTS、首测与后续一次调度。fixture 与真实测试分开标注。账号或设备条件不足时保留待验收，不改写成通过。
5. 根和 Web 类型检查、受影响文件 lint、相关 Vitest 项目、Web production build；新增契约还需相关 package 检查。依项目现有脚本执行，不为纯样式或文档增加无意义测试。

发布必须满足：上述适用关键用例全部通过，越权／秘密泄露／错误账号／重复自动化为零；不存在以 ready 或 completed 掩盖 unknown／部分成功的状态。Web 完整闭环完成后才能宣称 Web 已支持；Electron 未验收时不能随 Web 一起宣称通过。

### 7.3 产品指标与建议目标

埋点只记录匿名化流程 id、步骤、耗时、原因码和结果引用；不采集邮件正文、音频、token 或完整配置。报表区分新配置、重连和故障恢复。

| 指标 | 定义与首期目标 |
|---|---|
| 首次成果完成率 | 开始流程后达到真实验证成功的比例；先采基线，灰度后比较，不编造现有数值 |
| 必要补问次数 | 只统计用户必须回答的问题；信息齐全时为 0，不把 OAuth／麦克风点击算问答 |
| 设置页跳转 | 已有凭证的能力检查／语音路径目标为 0 次；必要的登录授权单列 |
| 首次成果耗时 | 分开统计系统处理、provider 延迟及用户授权／设备等待；目标在基线后确定 |
| 恢复成功率 | 自动化测试的刷新／重启／重复事件矩阵应 100% 通过；真实灰度单列 |
| 状态错误和副作用 | 错报成功、错误账号、重复自动化、取消后复活在发布验收中均为 0 |
| Manual 引导质量 | 每条目标流程至少 10 个中英表达，另有至少 20 个普通任务负例；评测主题选择、必要时加载及正确执行，关键越权或直接改配置文件行为为 0；省略 topic 兼容原调用 |

## 8. 发布、降级和后续范围

新增独立 rollout 开关控制 setup UI 与 `xopc_use` 新分支曝光；manual 仅展示当前可用分支。关闭后现有设置页、连接器及自动化服务继续使用；数据库保留回执，不通过删除记录“回滚”已经发生的外部效果。

禁用入口不会自动停掉用户已经启用的自动化。发现流程缺陷时通过既有 automations pause 管理具体对象；UI 明确区分“停止设置流程”和“暂停每日任务”。

后续再扩展 Agent 私有语音配置、更多邮箱、多渠道引导、通用诊断修复和插件安装后 onboarding skill。扩展前提是复用本期契约与领域服务，不继续复制设置逻辑，也不把所有配置强塞进一个万能 skill。

## 9. 实施前需要确认的环境事实

- 测试用 Cloud／其他语音服务是否提供所需 STT／TTS／realtime 路由，及明确可使用的测试额度。
- Gmail 连接后端、只读测试账号与邮件样本；是否能在隔离环境覆盖首次 OAuth 和重连。
- Web 与 Electron 的麦克风、播放和系统浏览器验证环境。

这些是后续真实验收的环境条件，不阻止先实施契约、fixture 和本地集成。本期所有新增路径、字段和状态均为拟议设计，不能与第 2 节已有能力混记。
