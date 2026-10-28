# 对话优先配置：Skill、MCP 与定时任务产品方案

日期：2026-10-28。现状调研基线：`561ffc903`。状态：方案与分阶段实施；实际完成情况及证据以[实施与验收记录](technical/conversation-configuration-implementation-2026-10-28.md)为准。下文“现状”保留调研时的代码快照，避免把新增能力倒写成原有能力。

本文根据当前工作树的工具注册、领域服务、HTTP 路由和 Web 调用链整理。源码存在与历史测试记录不代表本次已完成真实模型、外部授权或移动设备验收。本次未发现可调用的 codebase-memory graph 工具，按仓库规则回退到文件搜索和源码阅读。

## 1. 目标与范围

让普通用户说出目标，由 xopc 发现能力、补齐配置、完成操作并解释如何继续使用。用户无需先理解 Skill、MCP、cron 或配置文件。对话是默认入口，保密输入、OAuth 和确有必要的选择由少量受控 UI 承接。

核心闭环：**表达目标 → 检查真实状态 → 补齐缺项 → 应用配置 → 验证 → 首次成果 → 后续管理。**

三个产品目标：

1. 降低配置成本：尽量在原对话完成，复用已有信息和授权，只追问影响执行的缺项。
2. 缩短等待：前台及时响应，耗时步骤有可恢复状态，用户可以继续聊天。
3. 配置即使用：交付真实结果、相关用法和管理入口，区分已安装、已生效、已验证。

### 1.1 第一期承诺

| 领域 | 首期支持 | 完成定义 |
| --- | --- | --- |
| Skill | 搜索、明确授权后安装、状态检查、启停、受支持范围内卸载、一次使用 | 当前 Agent 确实可见且满足依赖；有真实使用结果，或准确说明剩余阻塞 |
| MCP | 已知服务或可信候选的 HTTP MCP 添加、OAuth／Token 输入、验证、移除自定义配置 | 持久配置已保存、当前会话能发现工具，并完成用户要求的一次有界只读调用 |
| 定时任务 | 创建、查看、修改、暂停、恢复、删除、显式试运行和结果查看 | 时间、时区、执行助手、结果位置正确；保存、启用、试运行、投递状态分别可观察 |

主入口为本地 owner 的移动宽度 Web Chat，桌面 Web 同步覆盖。权限来自可信宿主和现有策略，不因用户进入对话自动增加权限。Electron、原生移动端、Weixin／Telegram 的授权回流均需独立验收；首期不宣称全渠道闭环。

不在首期支持任意 stdio MCP 包安装、任意 shell 安装命令、自动采购服务、自动扩大权限或修改全部产品配置。已有 stdio MCP 保持原有路径；对话中可解释状态和提供可信入口，不承诺完成其安装。连接后自动生成可执行 Skill、无人值守产品巡检和 AI 实时生成双 Panel 属于后续阶段。

### 1.2 与已有方案的关系

- [10-21 对话式配置第一期方案](conversational-setup-phase1-2026-10-21.md)记录了能力检查、语音、Gmail 摘要和持久 setup 协调器；其中未完成项仍是提案。本文新增一条聚焦 Skill／MCP／定时任务的交付范围，不将旧方案整体记作已实现。
- [10-25 纯对话配置修订](technical/conversational-configuration-2026-10-25.md)适用于 Browser／Phone。本文保持这两类流程的既有决策；三类新流程同样不把设置面板嵌入聊天，只在安全输入、授权和必要选择处复用受控交互。不是每个配置步骤都增加卡片。
- [连接恢复梳理](technical/connection-product-interaction-audit.md)中的 ConnectionWait 是继续复用的连接恢复事实源，不再建立竞争的恢复调度者。

## 2. 现状：已有底座与准确边界

### 2.1 Skill：对话发现和安装已有，完整管理与使用反馈待补齐

| 能力 | 当前实现与证据 | 边界／缺口 |
| --- | --- | --- |
| 发现 | [`skills_marketplace_search`](../../src/agent/tools/skills-marketplace-search-tool.ts)搜索 Store、SkillHub、ClawHub、skills.sh，返回来源、安装引用、部分来源错误和启发式评分 | 搜索只读；评分不是质量保证。skills.sh 搜索结果不代表可直接用相同 provider 安装 |
| 安装 | [`skill_install`](../../src/agent/tools/skill-install-tool.ts)支持 Store／SkillHub／ClawHub，以及显式 Git／归档等来源；[`AgentService`](../../src/agent/service.ts)执行并刷新 Skill | 默认安装到 global；workspace 需明确指定。`force` 可覆盖；工具标记 `idempotent:false`，缺少跨刷新稳定意图回执 |
| 当前 Agent 可用性 | [`skills_list`、`skill_view`](../../src/agent/tools/skills-tools.ts)应用启用状态、Agent allowlist 和工具 gating；view 检查依赖与可调用限制 | list 是当前会话可用列表，不是全部已安装清单；不能用“搜索结果 installed”或文件存在替代可用性验证 |
| 修改与删除 | [`skill_manage`](../../src/agent/tools/skill-manage-tool.ts)支持创建、编辑、局部修改、删除和支持文件管理，受 `skills.agentWritePolicy` 限制 | 不可修改 bundled／extra-dir Skill；没有启停动作，也不能作为所有来源的通用卸载器 |
| 管理 API | [`commands-skills.ts`](../../src/gateway/hono/routes/commands-skills.ts)已有 `/api/skills/status`、`PATCH /api/skills/enabled`、市场／来源安装、`DELETE /api/skills/:id` 和 reload | 需为聊天补齐受控管理适配，统一 target、依赖、配置清理与卸载语义；不绕过领域服务直接删目录 |
| 注册 | [`factory.ts`](../../src/agent/tools/factory.ts)按 SkillManager／安装依赖注册工具；[`agent-manager.ts`](../../src/agent/agent-manager.ts)提供变更刷新回调 | 工具是否存在取决于运行上下文及最终策略，不保证所有 Agent／渠道都可配置 |

安装回执主要返回名称、来源、路径等技术信息，尚未形成统一的“现在能做什么／立即试用／如何管理”交付契约。已安装也可能因依赖、禁用或当前 Agent 策略而不可用。

### 2.2 MCP：原生执行与管理 UI 已有，通用对话配置桥接不足

需要区分两条现有路径：

1. **原生 MCP**：[`session-runner.ts`](../../src/agent/embedded/session-runner.ts)使用 pi 的 `createMcpExtension`；配置投影见 [`native-mcp.ts`](../../src/agent/mcp/native-mcp.ts)。原生工具发现、执行和 OAuth 归 pi 所有，不能另外实现一套 MCP runtime 或 token store。
2. **连接器恢复**：[`gateway-tools.ts`](../../src/agent/external-tools/gateway-tools.ts)提供 `xopc_tool_search/describe/execute` 与 `xopc_require_connection`；原生来源走原生 `tool_search`，不能把所有 MCP 统一描述成 gateway tool execute。

| 能力 | 当前实现与证据 | 边界／缺口 |
| --- | --- | --- |
| 自定义配置草稿 | [`connection-drafts.ts`](../../src/agent/mcp/connection-drafts.ts)支持未保存草稿、探测、授权、工具列表、commit，隔离临时凭据并校验原配置版本 | 草稿和完成缓存是内存 Map，TTL 为 10 分钟；不是持久 setup 流程，重启后不能原样继续 |
| 探测与 OAuth | [`connection-setup.ts`](../../src/agent/mcp/connection-setup.ts)区分 connected／oauth_required／token_required／error，桥接 pi 登录，校验 owner 和配置指纹 | OAuth 尝试在内存中；401 不必然代表 OAuth。工具数量不是业务调用成功证明 |
| 管理 HTTP | [`mcp.ts`](../../src/gateway/hono/routes/mcp.ts)提供 `/api/mcp/drafts`、probe／auth／commit／tools，现有 server probe／auth／tools 和自定义 server DELETE | 自定义移除要求 `expectedServer`；拒绝通过此入口删除托管 connector。保存后可能 `reloadRequired`，不能回报立即可用 |
| 管理 UI | [`mcp-config-api.ts`](../../web/src/features/connectors/mcp/mcp-config-api.ts)、[`custom-mcp-server-dialog.tsx`](../../web/src/features/connectors/custom-mcp-server-dialog.tsx)承接地址、headers／env、授权和测试 | 当前需要用户理解连接字段；还没有覆盖任意 HTTP MCP 配置的受控聊天工具入口 |
| 目标恢复 | [`connection-recovery-service.ts`](../../src/connectors/connection-recovery-service.ts)、[`connection-wait-repository.ts`](../../src/storage/sqlite/connection-wait-repository.ts)持久保存目标、账号、检查点，验证后入队续跑 | 主要服务候选连接器和 Store 安装等受支持目标；要求 local owner。不能据此宣称任意自定义 MCP／所有渠道已支持自动恢复 |
| 聊天交互 | [`ConnectionActionBar`](../../web/src/features/chat/connections/connection-action-bar.tsx)已有唯一连接操作区、账号选择、安装审阅、重试、跳过和取消 | 复用此入口；新流程不能在消息区和输入区同时出现竞争的授权按钮 |

**待补关键能力**：安全、脱敏的 MCP 管理 adapter；连接后的当前 Agent 工具刷新与一次真实调用；自定义 MCP 的目标恢复与过期重建；移除配置、停止使用、退出 OAuth、撤销第三方授权之间的明确语义。移除本地配置不等于撤销远端授权，也不意味着卸载共享 connector／plugin。

### 2.3 定时任务：已有最完整的对话管理基础

| 能力 | 当前实现与证据 | 边界／缺口 |
| --- | --- | --- |
| 对话操作 | [`automation`](../../src/agent/tools/automation-tool.ts)与 `xopc_use` 产品能力支持创建、更新、删除、运行、暂停／恢复、历史、运行事件和投递诊断 | 参数落到领域 schema 校验；不应再维护一个“聊天专属调度器” |
| 持久配置会话 | [`configuration-conversation.ts`](../../src/automations/configuration-conversation.ts)用 session metadata 绑定一个 automationId，重启后复用配置会话，附带当前配置和近期结果 | 已有专属配置会话的防重复约束，不等于任意普通聊天创建都能按用户意图去重 |
| HTTP 与 UI | [`api/routes.ts`](../../src/automations/api/routes.ts)提供 configuration-conversations；[`automation-create-navigation.ts`](../../web/src/features/automations/automation-create-navigation.ts)和 [`automation-conversation.tsx`](../../web/src/features/automations/automation-conversation.tsx)接入配置对话 | 已有聊天入口仍部分依赖自动化工作区；需确保主 Chat 内无需先离开当前目标就能完成 |
| 草稿与模拟 | [`drafts.ts`](../../src/automations/capabilities/drafts.ts)提供 draft／repair_draft／simulate，共享 dispatcher 和回执 | draft 不安装、不运行；simulate 不调用真实服务，不能作为首次成果 |
| 执行与交付 | [`automation-service.ts`](../../src/automations/service/automation-service.ts)及[自动化说明](../automations.md)已有持久事件、运行、投递与恢复链路 | 入队不是执行完成；任务成功与投递成功分别报告；暂停未来调度不等于停止当前 run |

现有 manual 已要求时区明确、修改前读取 revision、试用不默认创建任务、缺少邮件连接和真实读取时不能启用邮件日程。见 [`xopc-configuration.ts`](../../src/agent/tool-manuals/xopc-configuration.ts)。本期需要将这些约束贯穿三领域组合流程，而非仅靠提示词遵守。

### 2.4 安全输入、导航和引导：可复用，但不能直接认定完整

- [`setup-secrets.ts`](../../src/connectors/setup-secrets.ts)和 [`connectors.ts`](../../src/gateway/hono/routes/connectors.ts)已有 request-secret／submit-secret，安装输入可传 `secret://` 引用；[`secret-store.ts`](../../src/connectors/secret-store.ts)消费引用并通过 CredentialResolver 保存凭据。
- 当前 pending secret 是内存 Map，默认 5 分钟过期；请求结构未绑定 principal／conversation／目标用途。HTTP 有认证，但这还不等于完整的跨会话安全输入契约。自定义 MCP 和 Skill 也尚未共享此链路。
- MCP 管理列表包含原始 `configured` 配置，草稿输入能携带 headers／env；不得原样暴露为模型工具响应。应提供单独的脱敏 DTO，敏感值只在可信服务端解析。
- [`capability-links.ts`](../../web/src/features/capabilities/capability-links.ts)已有插件详情／使用入口；自动化已有配置会话链接；[`product-delivery.ts`](../../web/src/features/chat/product-delivery/product-delivery.ts)已有资源交付机制。仍缺跨渠道、短时授权回流和三领域统一结果表达。
- [`conversational-configuration-guide.ts`](../../src/agent/prompt/conversational-configuration-guide.ts)已按实际工具注册提供精简常驻规则，manual 按主题加载。优先扩展这一入口，不再默认新增一份重复的“万能配置 Skill”。

## 3. 产品交互决策

### 3.1 原目标优先，配置结束继续使用

| 用户表达 | 系统行为 | 最终反馈 |
| --- | --- | --- |
| “找一个处理 PDF 的能力，装好后总结这份文件” | 检查已有能力，搜索候选，解释必要选择，安装到明确范围，刷新当前 Agent，读取 Skill 并执行 | 安装范围、真实摘要、两条相关用法、管理入口 |
| “连接这个服务，查一下我的资料” | 校验服务来源和地址，创建草稿，安全输入或 OAuth，验证并提交，刷新工具，执行本次只读请求 | 使用的服务／脱敏账号、查询结果、权限范围、断开入口 |
| “每天九点总结反馈；先试一次” | 确定来源、时区和结果位置，验证读取，创建未启用任务并试运行；成功且周期授权有效后启用同一对象 | 首次结果、下次时间、时区、投递状态、暂停／修改入口 |
| “每天九点提醒我，直接启用，不用试跑” | 对不依赖新外部连接的明确低风险安排，按现有策略创建启用，不额外执行一次 | 已启用、下次时间、尚未试运行；不宣称首测通过 |

只要求推荐不安装，只要求使用一次不创建定时任务。已有明确授权可继续；替换同名 Skill、改变全局影响、选择不同账号、扩大权限时，补充具体影响并取得必要选择，不反复索要相同确认。

### 3.2 安全输入闭环

拟新增共享安全输入 adapter，复用既有凭据服务和 pi 凭据机制：

1. 后端生成绑定 principal、conversation、operation、目标和字段用途的短时请求。
2. Web 展示受控安全表单；只向已认证且匹配请求的用户开放。跨渠道安全链接留待第二期。
3. 凭据直接提交后端，模型仅收到请求状态及不含秘密的引用；工具参数不接受原始 Key。
4. 后端校验用途并消费，生成领域凭据引用，再验证连接；秘密不得进入 transcript、普通日志、工具回包或 URL。
5. 过期、取消、跨身份／跨用途、重复消费必须拒绝；重启后要求安全重输，不持久化尚未消费的明文。

OAuth 页面和回调由宿主管理，模型不生成授权地址、不接收 OAuth code／token。保留现有 pi 所有权；服务端进度恢复与 OAuth 临时会话过期分别处理。

### 3.3 结果反馈与详情导航

结果统一包含：对象引用和作用范围、已保存／待生效／已验证状态、真实结果引用或阻塞原因、一至两个相关用法、当前可执行管理动作。

复用 ProductDeliveryEnvelope 和领域资源；只有确需新增的表达才扩展严格 schema。历史结果保留当时事实，当前状态重新读取。链接不含凭据、不承载授权，目标不存在时明确说明；不将普通导航回执当作配置或页面打开成功。

桌面未来可在右侧展示详情、结果或动态界面，移动端用抽屉／全屏承接；首期先复用现有页面与最小交互组件，不引入任意生成 HTML 的配置权限。

## 4. 实施方式与恢复约束

### 4.1 复用结构

```text
原始 Chat 目标 + 精简常驻引导 / 按需 manual
    ↓
已注册专用工具 + 受控配置 adapter
    ├─ Skill 安装 / 状态 / 管理领域服务
    ├─ MCP draft / probe / pi OAuth / commit
    └─ Automation dispatcher / 配置会话 / run / delivery
    ↓
原会话的最小交互 + 持久目标引用 + 结果交付
```

Skill 可用于可分享的业务流程和场景知识；内置配置规则优先沿用 manual。授权、校验、幂等和事实必须由领域服务执行，不能由 Skill 文案或模型判断替代。

### 4.2 最小流程记录，不复制领域状态机

拟补充持久配置目标引用，保存 `principalId`、`conversationId`、`transcriptId`、当前 Agent、目标版本、领域对象／操作回执引用、已完成／待完成步骤和验证证据引用。仅持久化非敏感计划；不保存 headers／env 原值、回调 URL 或 token。

- 连接器继续由 ConnectionWait 负责恢复调度；自动化继续由配置会话、capability operation、run／delivery 提供事实。
- 自定义 MCP 外层保存非敏感意图；内存 draft／OAuth 丢失或过期后，重新 inspect 并建立草稿，必要时重新授权，不能伪装原 OAuth 流程仍存活。
- Skill 安装补稳定操作键与目标锁；出现结果不明先检查来源、版本／hash、安装范围及原回执，不能盲目 `force` 重装。
- 一个目标只有一个续跑者。刷新、重复回调与后台排队复用相同操作身份；重试不同于新意图，不能单纯按相同参数合并用户两次独立操作。
- 取消阻止尚未执行的步骤；迟到回调不得复活目标。取消配置目标不撤销已安装能力，也不暂停已启用任务，需分别报告和处理。
- reset／身份变化／权限撤销后复核上下文；旧配置意图不得在新 transcript 或不同用户下自动执行。
- 文件配置、SQLite 和外部服务不能宣称原子事务或 exactly-once。保存成功但 reload 失败应显示部分成功；补偿不得覆盖后续修改。

### 4.3 模型与速度

查询状态、确定性管理操作走短路径；复杂选择再规划，独立检查可并行。长安装或外部探测可后台执行，但第一期不要求所有配置都创建 Task 或多 Agent 委派。

新增内容按主题加载，避免扩大每轮 SP。分别测量首个有效回应、系统执行、第三方等待和用户授权时间；在相同模型与网络条件下比较，先建立基线，再决定模型路由和延迟目标。快速说“正在处理”不能代替真实进展。

## 5. 第一阶段任务清单

以下任务以[分阶段实施与验收记录](technical/conversation-configuration-implementation-2026-10-28.md)跟踪实际进度；代码位置是落点建议，操作名与 DTO 在 F0 冻结前不视为现有 API。按 2026-10-28 用户要求，领域实现严格按 **Skill（F2）→ MCP（F3）→ 自动化（F4）** 推进。F0／F1 的共享能力按阶段补齐，每阶段同时完成其 F5 引导与 F6 自动 E2E，验收通过后才进入下一领域。不得在三个领域全部开发完后再补验收。

| 编号 | 具体任务与交付物 | 主要落点／复用 | 验收门槛 |
| --- | --- | --- | --- |
| F0 契约与范围 | 冻结三条主流程、权限矩阵、安装范围、MCP 移除语义、成功状态和失败码；确定 HTTP MCP 测试服务与只读工具 | gateway-contract、现有 manual、领域 schema | 契约区分 saved／reload_required／verified／blocked／unknown；明确一个 OAuth 和一个 Token 测试对象；无凭据也能跑 fixture |
| F1 安全输入与目标恢复 | 扩展 secret 请求的身份／会话／用途绑定；提供 Web 安全输入、脱敏回包；保存最小流程引用与取消／过期语义 | setup-secrets、secret-store、连接 UI、session metadata／SQLite；需要持久表时走现有升级链 | 秘密不进入模型或 transcript；跨用户／跨用途拒绝；刷新能恢复状态，重启能解释过期并安全重建；仅一个续跑者 |
| F2 Skill 管理闭环 | 复用搜索安装；新增已安装状态、依赖与 Agent 可用性查询、启停和受支持卸载适配；补稳定安装意图、范围提示、首次使用反馈 | skills-tools／skill-install／skill-manage、AgentService、commands-skills 的共享服务 | 同键重试不重复安装；global／workspace 明确；bundled／extra-dir 删除受限；当前 Agent 能调用或有准确阻塞；用指定文件产出真实结果 |
| F3 HTTP MCP 闭环 | 提取 HTTP 与工具共用应用服务；新增脱敏 inspect／plan／apply／remove adapter，串接 draft、OAuth／Token、commit、reload 和一次实际调用 | agent/mcp、mcp route、pi extension、连接恢复 adapter | OAuth 与 Token 两条路径通过；凭据不经模型；并发冲突不覆盖；重启重建不重复发布；托管 connector 不走自定义删除；工具发现与实际调用均有证据 |
| F4 定时任务原 Chat 闭环 | 复用 automation dispatcher 和配置会话，在原 Chat 保留目标与对象关系；统一 preview、时间／时区、首次试跑和结果反馈；有外部来源时固定选定来源并在未来执行复验 | configuration-conversation、capabilities、action executor、ProductDelivery | 对话可创建／修改／停启／删除；重试一个意图只产生一个对象；要求试跑时同对象 run→成功后启用；外部账号失效不换账号、不伪报成功 |
| F5 引导与导航 | 补 Skill／MCP manual topic 和精简路由提示；成功反馈给相关用法；复用管理详情与返回原会话，适配移动宽度 | xopc-configuration、guide、capability-links、product-delivery、Web i18n | 信息齐全零多余追问；不引用未注册命令；授权返回原目标；结果链接刷新可用；无重复授权入口；普通聊天不额外加载整本手册 |
| F6 验收与观测 | 建立中英表达集、fixture 故障注入、真实认证 Gateway 和外部服务验收脚本；记录耗时、成功率和报告 | 现有 Vitest／Gateway 测试、scripts、docs/design/technical/evidence | 下节关键用例全通过；报告明确模型、入口、账号脱敏标识、提交与待验收项，不以 mock 代替真实闭环 |

F4 的来源固定不能仅靠 instruction 中写账号：优先复用连接绑定，在真实 executor 上补齐可信账号上下文和执行前校验。若无法保证，依赖该来源的定时任务保持未启用并报告缺口；不阻塞无需该连接的普通提醒。

实施中新增或移动认证 API 时，同步 [`lazy-bundles.ts`](../../src/gateway/hono/routes/lazy-bundles.ts)、正向映射和附近非重叠断言，并走真实认证 Gateway。若新增 SQLite 表，保留全部受支持升级路径与迁移资产，不改低版本支持边界。

## 6. 第一阶段验收标准

### 6.1 用户流程与异常用例

| 编号 | 操作 | 必须观察到的结果 |
| --- | --- | --- |
| S01 | 仅搜索／推荐 Skill | 返回有来源的候选；没有安装或覆盖副作用 |
| S02 | 明确安装并处理测试文件 | 展示范围，安装后当前 Agent 可见；真实结果来自该文件；提供两条用法和管理入口 |
| S03 | 已安装但禁用、缺依赖、Agent 无权使用 | 原因区分准确；不会反复重装或擅自放宽 allowlist／工具策略 |
| S04 | 重复请求、同名更新、启停与卸载 | 同意图不重复安装；覆盖前解释影响；卸载与停用语义明确，拒绝删除 bundled／extra-dir；不影响其他范围对象 |
| M01 | 已知 HTTP MCP，无需授权／OAuth／Token | 分别完成相应路径；Token 从安全表单提交；实际工具调用完成原始只读需求 |
| M02 | 401、权限不足、服务超时、零工具 | 区分需要认证、工具不可用和未知；不把 401 一律判 OAuth，不把列表成功当业务成功 |
| M03 | 保存成功但 reload 失败 | 显示已保存、待生效；重试先核对配置及回执，不能误称全部失败或已可用 |
| M04 | 并发编辑、删除自定义 MCP、误删托管服务 | 旧 revision 拒绝覆盖；移除正确对象；明确远端授权是否仍在，托管服务沿原 owner 管理 |
| A01 | 创建“每天九点”，修改时间／助手、暂停／恢复／删除 | 使用明确 IANA 时区并展示下次时间；修改同一对象，保留其他字段；删除后不自动重建 |
| A02 | “先存草稿”“试一次”“每天运行”三种表达 | 分别保持 disabled、不创建周期安排、建立周期安排；试跑必须有明确请求，simulate 不算真实运行 |
| A03 | 依赖新连接且请求“先试再启用” | 校验选定账号，创建 disabled 对象，真实 run 成功后启用同一对象；读取零条数据可作为有证据的空结果 |
| A04 | 执行成功但通知失败；暂停时 run 正在运行 | 两种状态分别报告；只重试投递不会再次执行；暂停不声称已中止在途 run |
| A05 | 后续调度、撤权和多账号 | 至少观察一次实际调度；使用原绑定账号，失效报告需重连，不自动切到其他账号 |
| X01 | 刷新／重启／双标签／重复回调 | 恢复非敏感目标，必要时重建过期授权；无重复安装发布、无重复任务、一个续跑者 |
| X02 | 等待期间取消、reset、换身份；迟到授权完成 | 旧目标不继续；可报告连接事实变化，但不复活已取消流程 |
| X03 | 跨用户、跨会话、跨用途、过期、重复消费秘密 | 全部拒绝；transcript、日志、工具输出、URL 和结果资源无测试秘密及 OAuth code／token |
| X04 | 非 owner／无管理权限请求 | 读取与变更遵守实际策略；返回准确限制，不切换 Agent／工具／身份绕过 |
| X05 | 390px Web、桌面 Web、刷新后的管理链接 | 操作可达、无横向溢出、键盘可操作、授权后回原目标；删除资源有明确失效反馈 |

### 6.2 测试与证据

优先复用以下测试基础，补缺口而不是重复证明实现细节：

- Skill：[`skill-install-tool.test.ts`](../../src/agent/tools/__tests__/skill-install-tool.test.ts)、[`skills-marketplace-search-tool.test.ts`](../../src/agent/tools/__tests__/skills-marketplace-search-tool.test.ts)。
- MCP：[`connection-drafts.test.ts`](../../src/agent/mcp/__tests__/connection-drafts.test.ts)、[`connection-setup.test.ts`](../../src/agent/mcp/__tests__/connection-setup.test.ts)、[`mcp-connection-setup.integration.test.ts`](../../src/gateway/hono/routes/__tests__/mcp-connection-setup.integration.test.ts)。
- 连接恢复：[`connection-recovery.test.ts`](../../src/connectors/__tests__/connection-recovery.test.ts)和 [`connection-action-bar.test.tsx`](../../web/src/features/chat/connections/__tests__/connection-action-bar.test.tsx)。
- 自动化：[`automation-configuration-http.test.ts`](../../src/gateway/__tests__/automation-configuration-http.test.ts)、[`automation-service.test.ts`](../../src/automations/service/__tests__/automation-service.test.ts)。

按契约／领域集成 → 真实认证 Gateway → 真实 Web Chat + 模型 → 外部服务的顺序验收。正常流程每类至少 10 条中英表达，另有至少 20 条普通任务／只推荐／不执行负例；关键异常用例在 fixture 中确定性覆盖。真实环境至少完成一次 Skill 安装及使用、HTTP MCP OAuth 和 Token 各一次、定时任务试跑与后续调度各一次。

通过根／Web 类型检查、受影响 lint、相关 Vitest 和涉及 Web 变更的 production build。报告将 fixture、真实模型、真实第三方和独立客户端分别记账；缺测试账号／权限时标为待验收，不以历史通过记录补齐。

### 6.3 发布门槛与指标

- 所有适用关键用例通过；秘密泄露、越权、错误账号、重复有效任务、取消后复活、错误成功宣称均为零。
- 新增路径没有未验证权限和持久恢复分支；普通管理入口仍可使用。关闭新入口不自动卸载能力或暂停用户任务。
- 统计完成率、必要补问次数、离开原对话次数、配置后首次使用率、恢复成功率及按步骤分解的 p50／p95 耗时。信息齐全的正常路径目标为零多余补问；已有可用凭据时不要求用户进入设置页找字段。
- 首期先采基线；不预设未经测量的秒级承诺。埋点只含流程／对象引用、阶段、原因码、模型路由和耗时，不采集秘密、业务正文和完整配置。

## 7. 后续阶段

1. **微信与原生移动端**：可信身份映射、短时安全页面、OAuth 回流、通知与 Deep Link；未登录、设备切换和链接被转发时不能继承配置权限。微信接续实现和独立验收见[微信对话配置记录](technical/weixin-conversation-configuration-2026-10-28.md)，官方手机客户端由用户自测；原生端扩展仍为后续范围。
2. **持续能力巡检**：维护功能→API→对话工具→授权→验证→渠道矩阵；仓库变更触发检查，定期用隔离账号运行代表场景；只在新增缺口、退化或需行动时通知。输出证据和修复建议，不自动修改生产配置。本次仅规划，不创建真实定时任务。
3. **连接后生成场景知识**：先生成有工具／权限依据的使用说明，再考虑可执行 Skill；生成后需扫描和运行验证，工具契约变化时失效或复验，避免重复或越权 Skill。
4. **速度优化**：依据基线优化 SP、按需 manual、模型路由、缓存和后台 Task／delegate；同时衡量正确率与成本，不能以减少校验换响应速度。
5. **双 Panel 工作界面**：桌面左侧对话、右页面；移动端对应卡片与详情。AI 生成视图仍经同一受控 API 执行，不获得独立配置权限。

第一阶段的完成标志是三个场景在原对话中可靠闭环，并有真实验证证据。后续范围按同一契约扩展，不以“所有配置都能聊天完成”作为当前发布声明。
