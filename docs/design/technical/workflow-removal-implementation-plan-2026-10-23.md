# Workflow 彻底移除实施计划

日期：2026-10-23。状态：移除已实施；实际通过项与未通过项见[验收记录](./workflow-removal-acceptance-2026-10-23.md)。

用户约束：**彻底清除、不迁移、不兼容。** 删除 Workflow 功能、专属数据与历史适配逻辑，不保留隐藏引擎、开关、旧 API、重定向、旧数据解释器或换名后的相同实现。本文件保留原执行范围；验收记录以实际证据为准。

## 1. 目标和边界

实施完成后，xopc 不再提供可视化 Workflow 定义、图编辑、DAG 执行、Workflow 子 Agent 编排、专属运行历史与相关产品入口。代码、协议、配置、数据库结构、各端界面、资源、测试和文档共同退出。

保留主 Agent 循环、Task/TaskRun、Automation、Skills、通用委派、工具发现、权限、预算、取消、会话、项目和记忆能力。它们直接使用自己的运行语义，不再依赖 Workflow。

明确不做：

- 不把旧定义转换成 Skills、Task、Automation 或其他格式，不自动保存旧结果。
- 不为旧客户端、旧 URL、旧配置、旧数据库设计兼容路径。
- 不保留 Workflow 表、字段、枚举或事件供历史读取使用。
- 不把图引擎改名为“任务流”“执行图”继续保留。
- 不因单词相同而删除 GitHub Actions、OAuth flow、普通文档工作步骤、电脑导航提示或浏览器录制能力。
- 不删除整个共享数据库、整个 `~/.xopc` 或无关业务数据。
- 本计划不授权发布、部署或提交远程变更。

本计划的代码路径均相对仓库根目录 `/Users/micjoyce/develop/github/xopc`。以实际实施时的最新源码为准补齐引用，不以本清单为理由漏掉新增依赖。

## 2. 实施组织与顺序

| 阶段 | 工作包 | 主要产出 | 退出条件 |
| --- | --- | --- | --- |
| P0 | 固定范围与工作区边界 | 文件/符号/存储对象清单、已有修改记录 | 所有依赖归为删除、共享改造或无关保留 |
| P1 | 解除通用执行对 Workflow 的依赖 | Task、Agent、Session、Automation 的正确身份与类型 | 普通任务和聊天不需要任何 Workflow 类型或服务 |
| P2 | 删除后端及共享契约 | 引擎、服务、工具、API、配置、事件删除 | 后端与协议没有可调用的 Workflow 能力 |
| P3 | 删除 Web、移动端、渠道与 TUI | 各端入口、视图、模型、事件处理同步删除 | 无 Workflow UI、请求、链接或后台订阅 |
| P4 | 清洁存储定义并离线清除数据 | 干净 schema/初始化链、清除后的指定本地状态 | 专属结构、数据和文件为零，其他数据完整 |
| P5 | 清理文档、依赖和构建残留 | 产品说明、测试、资源、分发包收尾 | 无旧产品承诺、死依赖或旧打包产物 |
| P6 | 集成验收 | 代码检查、真实 Gateway、各端和数据库证据 | 本文所有强制验收项通过 |

在一个集成分支完成；工作包可拆提交，但不发布中间的不完整状态。P4 的实际本地数据清除安排在代码收敛、相关写入进程停止以后。P6 完成之前不得把“按钮消失”视为完成。

## 3. P0：实施前清单

1. 读取最新 AGENTS.md，确认代码图谱工具是否可用；优先用图谱追踪符号，缺失时使用源码检索。
2. 记录当前 Git 状态与 HEAD。本工作区已有个人记忆相关修改，尤其涉及 `src/agent/tools/factory.ts`、`src/agent/embedded/run-turn.ts`；只编辑与本次清除有关的部分，不重置或覆盖其他工作。
3. 建立语义清单：专属目录、共享导入与调用者、数据库对象、JSON 字段、持久化文件、事件、接口和消费端。
4. 盘点实际状态根目录与正在写入它的进程。此前只读检查的是默认 `~/.xopc/xopc.db`，不能据此自动操作其他实例。
5. 记录待清除对象数量及无关数据计数/标识，用于完成后比较；无需保留 Workflow 内容或编写导出器。

不把“继续论证是否删除”设为阶段任务，产品决策已经确定。

## 4. 后端、工具与协议的删除范围

### B1：整项删除 Workflow 实现

| 删除对象 | 内容 |
| --- | --- |
| `src/workflows/` | domain、authoring、registry、runtime、engine、store、context、project-presets、service 和专属测试全部删除 |
| `src/agent/workflow/` | catalog、16 个 builtins、Workflow runner、snapshot、progress broker、structured output 适配、child tools 和专属测试全部退出；若发现其他能力仍引用其中辅助函数，先将必要的通用能力移回其所属模块，禁止复制整个编排实现 |
| `src/agent/tools/workflow-tool.ts`、`workflow-manage-tool.ts` | 工具实现与对应测试 |
| `src/gateway/hono/routes/workflows.ts` | 27 个专属 handler 及只服务这些 API 的测试 |
| `src/gateway/gateway-workflow-host.types.ts` | 专用 Host 接口 |
| `src/tasks/task-workflow-coordinator.ts` | Workflow 到 TaskRun 的终态桥接 |
| `src/projects/workflow-bind.ts` | Workflow 项目绑定与导出 |
| `src/connectors/workflow-preflight.ts` | Workflow 专属预检与测试，通用 Connector 连接与权限校验保留 |
| `src/chat-commands/builtins/workflow.ts`、`src/tui/tui-workflow-slash.ts` | `/workflow` 命令及专属测试 |
| `skills/engineering/workflow-authoring/` | 专属 Skill 及其索引、打包、发现入口 |

### B2：共享 Agent 与 Gateway 代码

在以下文件删除 Workflow import、字段、构造、回调、生命周期、工具注册和文案：

- `src/agent/service.ts`、`src/agent/agent-manager.ts`、`src/agent/types.ts`、`src/agent/tools/factory.ts`、`src/agent/tools/index.ts`。
- `src/agent/prompt/sections/tooling.ts`、`voice-presentation.ts`、其他真正描述 Workflow 产品能力的 prompt 和工具元数据。
- `src/gateway/service.ts`：服务实例、session bridge、`createWorkflowRunService`、Workflow dispatch、重启协调、Automation 依赖注入。
- `src/gateway/agent-builtin-tools.ts`、`agents-admin.ts`、`hono/lib/config-payload.ts`、`hono/routes/agents.ts`。
- `src/gateway/hono/routes/lazy-bundles.ts`、`src/gateway/security/gateway-scopes.ts`：删专属 bundle、权限匹配与断言，不留空 handler 或 410 专用接口。
- `src/personal-agent/specialist-capabilities.ts` 及工具目录、手册、发现元数据中的专属项。
- `src/gateway/hono/routes/projects.ts`、`home.ts`、`activity.ts`：删专属列表、统计、绑定、attention 和聚合查询。

认证请求访问 `/api/workflows/**` 应落入现有未知 API 的标准 404；不重定向到 Task，不返回伪造成功，不通过 SPA fallback 返回 200 页面。无认证请求继续遵循现有统一鉴权机制。

### B3：改正共享执行语义

- `src/gateway/service.ts` 中普通 Task 输入目前使用 `origin.source = 'workflow'`。改为项目现有 Task 来源；若不存在，则直接定义 `task` 来源并同步类型、输入队列、审计、授权与 active-execution 判定，不加入旧值映射。
- 同步检查 `src/gateway/service/agent-runner.ts`、`active-execution.ts`、`src/tasks/execution-context.ts`，区分普通 Agent Task 与被删除的 DAG；保留前者执行路径。
- `src/session/types.ts`、`manager.ts`、`src/routing/agent-session-key.ts`：移除 `workflow-run`、`workflow-subagent` 和专属检索方法。通用委派若需要身份，使用其自身的 subagent 语义，不把它继续标为 Workflow。
- `src/gateway/service/sessions-api.ts`、`hono/routes/sessions.ts`：删专用子会话 API 与过滤值；普通会话列表、详情、输入、reset 与 transcript 功能保留。
- `src/projects/{types,project-store,project-loop,index}.ts` 和 Task 查询服务：删 `recentWorkflowRuns`、相关 join 与执行器分支，保留 Task、项目依赖图和其他聚合。

### B4：配置、自动化、事件、共享契约

| 位置 | 删除/改造内容 |
| --- | --- |
| `src/agent-config/{schema,resolver}.ts` | WorkflowPolicySchema、defaults/profile 的 workflows 字段、合并与来源追踪 |
| `src/agent-catalog/migrations/legacy-config-cutover.ts` | 初始化旧配置时生成 workflows 的逻辑；不新增忽略/转换旧 Workflow 字段的兼容器 |
| `src/automations/domain/{types,validation}.ts` | workflow action、Workflow 依赖与专属字段 |
| `src/automations/service/{action-executor,automation-service}.ts` | executeWorkflow、对应 handler、取消/重试/终态分支；不将旧 action 转为 agent |
| `src/automations/storage/automation-run-repository.ts`、draft 模块 | 专属列读写、草稿生成和校验提示 |
| `src/automations/events/event-catalog.ts`、实时桥与消息总线 | workflow.run.completed、workflow.event.appended、workflow.run.updated/error 等专属事件生产与消费 |
| `src/tasks` 与 `packages/gateway-contract/src/{tasks,task-runs}.ts` | workflow executor、workflowId/version、专属任务状态处理 |
| `packages/gateway-contract/src/{automations,product-delivery,home,session-identity,welcome-suggestions}.ts` | workflow action/runId、资源类型、导航映射、attention 类型、purpose、推荐类型与测试 |
| `src/activity/types.ts` 与 Activity 调用点 | Workflow actor/source/object/event 类型、专属关联和展示 |

对移除后的严格输入类型，旧 Workflow 请求按普通无效输入处理；不保留专属报错适配、旧枚举解析或“已迁移”应答。

## 5. 数据库与本地数据清除范围

### D1：仓库内 schema、SQL 和读写代码

| 对象 | 最终状态 |
| --- | --- |
| `workflow_runs`、`workflow_events`、`workflow_context_snapshots`、`project_workflow_presets` | 表、索引、外键及所有读写代码删除 |
| `sessions.workflow_run_id / workflow_definition_id / workflow_agent_id / workflow_agent_label` | 列和 `idx_sessions_workflow_run` 删除；同步 row mapper、SELECT、INSERT、UPDATE |
| `automation_runs.workflow_run_id` | 列及契约、mapper、查询、写入删除 |
| `task_runs.executor_kind` | CHECK 中删除 workflow，保留 agent/human/external |
| `home_attention_acknowledgements.subject_kind` | CHECK 中删除 workflow_run，保留其他合法类型 |
| `durable_state` | 通用表保留；Workflow 专属 namespace 不存在 |
| `schema.sql`、`migrations/220_normalize_timestamps.sql` | 同步删建表、列、SELECT 列表和索引里的专属逻辑；检查全部历史 SQL、迁移测试和 fixture |
| `session-repository.ts`、`session-read-repository.ts`、`row-mappers.ts`、`session-identity-sql.ts`、`connection-wait-repository.ts` | 删除字段映射、类型判断、专用继承和账号选择路径 |

**初始化策略：修正现有基线与初始化链，让新库从创建到最终状态均不包含 Workflow。** 保留其他模块的通用 schema 版本管理与迁移；不新增 Workflow 迁移脚本，不为旧 Workflow 数据库增加启动检测、自动清理或 repair 分支。旧安装无缝升级不在目标中。若实施期间发现当前版本号已变化，同步检查最新初始化链，不重写其他模块的新功能。

已有开发数据库由一次性离线管理操作清除专属结构与数据，操作不进入产品运行时代码，也不作为受支持迁移工具留在仓库。

### D2：专属记录与共享表引用

以对象类型、主键和关联关系选择删除集合，禁止通过全文 `LIKE '%workflow%'` 批量删除用户数据。

1. 删除四张专属表的数据；删除 `durable_state` 的 `workflow-definitions`、`workflow-revisions`、`workflow-drafts` namespace。
2. 删除 Workflow 专属会话及其 transcripts、entries、FTS、session config、输入队列、运行关联、创建回执、会话环境与专属附件引用；按实际外键和对象归属确定删除顺序。
3. 在普通会话中清除系统生成的 Workflow 链接 context entry、专属 toolCall/toolResult 及结构化结果引用。成对处理调用和结果，不产生悬空 toolCallId；保留普通用户正文及无关消息。
4. 删除以 Workflow 为 action 的 Automation、相关运行与专属事件；删除仅依靠 Workflow 完成事件触发的自动化，不转为其他触发器。共享自动化中的结构化 Workflow 过滤/交付引用按其实际语义清除，不能留下永远无法触发的配置。
5. 删除 `executor_kind = 'workflow'` 的 TaskRun 及专属回执、wait、证据和关联；保留独立存在的用户 Task。若该 Task 的当前执行配置指向已删除 Workflow，清除这项配置，不自动改成 Agent 或执行任务。
6. 从 `agents.overrides_json`、`agent_catalog_settings.defaults_json` 及实际配置文件删除 workflows 属性和专属工具策略；不删除其他 Agent 模型、权限和用户配置。
7. 清除 Activity、对象关联、attention、outbox、通知、项目更新、context evidence、记忆来源、缓存与索引中以专属 Workflow 对象为身份的记录/字段。共享对象仅删相关字段或关系；完全由 Workflow 产生且无独立归属的记录删除。若为共享知识项，只删除专属来源，不误删其他独立证据。
8. 审计步骤 1—7 的入站引用与外键，保证没有指向已删除对象的结构化引用。必要的通用索引重建使用已有机制，不新增 Workflow 修复代码。

本项不要求重写 Git 历史、普通自然语言中出现的 workflow 单词或无关日志文本；要求清除可执行配置、产品数据对象及其专属系统记录。

### D3：文件与缓存

- 删除实际状态根目录下 `agents/<id>/workflows/` 及专属运行产物；处理其明确归属的附件和缓存，不能删整个 Agent home。
- 清除 Web/桌面/移动端持久化缓存中专属页面状态、选中运行和 Workflow 实体；不清除登录凭据、普通草稿与其他产品数据。
- 清理仓库内专属截图、fixture、演示和失效产物；对于 `.bundle-flow`、`dist`、Electron out 等生成目录，按产物归属处理，不按目录名误删其他任务成果。
- 重新构建分发产物，确认删除的模块不会通过旧 dist、打包缓存或静态 chunk 再被发布。

### D4：一次性清除的操作顺序

停止目标状态目录的 Gateway/桌面后台写入 → 记录待删对象及无关数据基准 → 在隔离副本验证删除顺序与约束 → 对明确的目标数据库和专属文件执行同样清除 → 检查完整性与无关数据 → 使用新代码启动验证。隔离副本仅用于验证并在完成后移除，不作为产品迁移或历史兼容设施。

混合表的列/CHECK 修改应采用 SQLite 支持的 DDL；必须重建表时，保留其他列、索引、触发器和约束，校验外键后再提交。运行时需要的 SQLite 自定义函数也应纳入离线验证环境，不能为绕过错误而静默丢弃通用触发器。

## 6. 各端界面与交互清除

### U1：Web

- 整体删除 `web/src/features/workflows/`、`web/src/features/chat/workflow/`、`web/src/pages/workflows-page.tsx`、`web/src/features/projects/project-workflow-run-dialog.tsx` 及专属测试。
- `app.tsx`、`navigation/product-navigation.ts`、`lib/{app-link,route-preload}.ts`、侧栏与命令面板：删除路由、导航、预加载、快捷动作与深链接识别；旧链接走通用未找到页面。
- 项目详情、Task 详情、Home、Projects API：删除 Workflow 区域、运行按钮、计数、关联字段和 skeleton。
- 聊天：删除 Workflow 卡片、banner、agent 行、结果预览、链接解析、专用工具标题与实时回调；保留通用工具消息、Agent 流式输出和 Task 结果。
- Automation 编辑/解释/反馈/API：删除 Workflow 动作和参数；剩余动作列表、保存和运行正常。
- Agent 默认设置、编辑器、配置类型与 catalog cache：删除 Workflow 默认值、允许列表和专属工具描述。
- 删除 `i18n/locales/{en,zh}/workflows.json` 及 bundle 注册；清理其他 locale 中的功能入口、推荐与键引用。
- 检查 CSS、Markdown fixture、preview、Search、Notes、Connector 等共享模块中的真正产品引用；普通英文 workflow 表述不机械删除。

`@xyflow/react` 仍由 `features/projects/task-board/task-dependency-graph.tsx` 使用，**保留该依赖及 Task 依赖图**。其他依赖只有在全仓确认无使用者后才通过 pnpm 删除并更新 lockfile。

### U2：Android

- 删除 `apps/mobile-android/app/src/main/java/ai/xopc/mobile/gateway/WorkflowRepository.kt` 和 `ui/main/WorkflowScreen.kt`。
- 更新 `Navigation.kt`、`GatewayViewModel.kt`、`MainScreen.kt`、`ProgressScreen.kt`、`ProgressRepository.kt`、`ProgressLabels.kt`、`MessageActions.kt`：移除仓库方法、回调参数、选中运行、tab/filter/section、深链接与状态。
- `AutomationRepository.kt` 删除 Workflow run 关联字段；删除中英文资源和专属 instrumentation/unit fixture。
- 保留 Progress 中 Task、Project、Automation 的现有入口；减少分区后正确处理默认选择、空态、返回和恢复状态。

### U3：iOS

- 删除 `apps/mobile-ios/XopcMobile/Core/Models/WorkflowModels.swift`、`Core/Networking/GatewayClient+Workflows.swift`、`Features/Progress/WorkflowRunsView.swift`。
- 更新 `ProgressView.swift`、Automation 详情与事件文案、`Core/Models/{MessageLink,ProductModels}.swift`、`ChatMessageLinkRouter.swift`，删除实体、关联字段、跳转和展示分支。
- 清理本地化、`ChatRenderingTests.swift`、`ProductStateTests.swift` 和专属 fixture。
- 检查 `project.yml` 与生成的 `XopcMobile.xcodeproj/project.pbxproj`；按项目既有 XcodeGen 流程再生成，不能残留已删除文件的 build reference。

### U4：HarmonyOS

- 删除 `apps/mobile-harmony/entry/src/main/ets/view/WorkflowView.ets`。
- 更新 `view/{HomeView,AutomationRunView,ChatResultTail}.ets` 和 `common/{homeProtocol,messageLink,chatRichContent}.ets`：删除路由、请求、卡片、对象类型、attention 与跳转。
- 清理 `resources/base`、`zh_CN` 的字符串、`rawfile/welcome-{en,zh}.json`、合同导出与测试数据。
- 更新 `tests/{home,workspace,messageLink,conversationalCreation,mobileLoadingExperience}.test.ts` 等实际调用者；保持其他页面 skeleton、tab 和导航行为。
- 实施时按 HarmonyOS 技能要求修改与验证 .ets；本次已按该范围清理 .ets。

### U5：CLI、TUI、渠道、Electron

- 更新 `src/chat-commands/{index,types,context}.ts`、TUI command/backend/chat-log/startup，删命令目录、解析、面板、格式化、订阅和帮助说明。
- 删除 `extensions/{telegram,weixin,feishu}/src/workflow-progress.ts` 及对应测试，删除各 `plugin.ts` 的专属 wiring；普通消息和 Task/Automation 通知保留。
- Electron 沿用清理后的 Gateway/Web；检查主进程、菜单、深链接、静态资源与 bundle 测试，不新增旧客户端回退。

## 7. 文档、资源、评测与打包

| 类别 | 清除范围 | 完成标准 |
| --- | --- | --- |
| 产品文档 | 删除 `docs/workflows.md`、`docs/zh/workflows.md` 与 `.vitepress/config.ts` 导航；更新 README、中文 README、AGENTS.md、DESIGN.md、package description/keywords | 没有可用 Workflow 功能的承诺或入口 |
| 共享文档 | tools、configuration、automations、loops、product、getting-started、projects-tasks-notes、desktop、channels/webui、models、skills 的中英文页面 | 不再描述 Workflow 配置、执行或链接；其他产品说明完整 |
| 设计与架构 | storage/database domain model、agent capabilities、实时协议、会话身份、Home、Task、移动端 parity 文档 | 删除已退出实现；纯 Workflow 历史设计文档删除；混合文档更新相关部分 |
| 图与截图 | `docs/public/architecture.drawio`、派生 SVG、相关截图/演示与引用 | 无 Workflow 产品节点及失效图片；修改 draw.io 文件使用项目可用的 drawio 工具并同步导出 |
| Skills 与示例 | Workflow authoring、手册、对话建议、能力 smoke、测试服务器 fixture、演示用例 | 不再诱导模型调用已删除能力 |
| 测试和评测 | 专属测试整项删除；混合测试移除专属分支，保留通用验证；检查 `evals/`、`scripts/`、`vitest.config.ts` | 没有陈旧 fixture、include glob 或把已删能力计入完成度的断言 |
| 依赖和发布资产 | package manifests、lockfile、生成索引、dist/out、静态 chunk 与打包清单 | 不分发旧模块、专属 Skill、页面或字符串资源 |

历史评测记录若完全是 Workflow 专属场景则删除；混合报告不通过改分数伪造历史结果，可删除已退出场景的整项记录并注明统计范围变化，或删除不再有使用价值的整份产物。

本实施计划与前期评估文档作为决策记录允许提及已移除功能；实施完成时更新状态、结论和实际验收证据，不把计划里的旧入口描述为现行功能。Git 历史和 GitHub Actions workflow 不属于清除对象。

## 8. 强制验收矩阵

| ID | 验收项目 | 明确通过条件 |
| --- | --- | --- |
| A01 | 文件与依赖 | B1 的专属目录/文件不存在；无悬空 import/export、注册、构建 include 和专属 Skill |
| A02 | 运行工具 | 工具清单、ToolSearch、提示词、slash menu 均不暴露 workflow/workflow_manage；无 alias 或旧入口适配 |
| A03 | API 与事件 | 真实、带认证 Gateway 请求 `/api/workflows/**` 返回标准未知 API 404；无专属 producer、listener、lazy bundle、scope 或轮询 |
| A04 | 配置和契约 | 无 workflows/default/allowed 产品字段、Workflow executor/action/resource/session purpose；旧字段不被转换或静默激活 |
| A05 | 新库初始化 | 空状态目录完整启动成功；最终 sqlite_schema、table_info、索引、CHECK、历史初始化语句均无专属对象 |
| A06 | 当前数据清除 | D2/D3 清单中的专属行、JSON 字段、文件和结构化入站引用为零；没有遗留清理器或自动迁移逻辑 |
| A07 | 存储完整性 | `PRAGMA integrity_check` 为 ok、`foreign_key_check` 无记录；通用索引和触发器存在；无关数据基准一致 |
| A08 | 普通聊天与委派 | 新建、发送、流式输出、工具、取消、会话 reset 正常；delegate_task 使用自身身份、权限和预算，无 Workflow import |
| A09 | Task/Project | Agent TaskRun 能领取、执行、完成并生成回执；取消和中断处理正常；项目详情、Task 依赖图及证据入口正常 |
| A10 | Automation | agent/task_command/system/browser_automation 的适用现有路径可配置并运行；事件触发与取消正常；无 Workflow 动作和重试适配 |
| A11 | Web | 导航、命令面板、项目/Task/Home/聊天/设置/自动化均无入口、卡片或请求；旧页面地址进入通用未找到；中英文、深浅主题无空白区或 console 错误 |
| A12 | Android/iOS/HarmonyOS | 构建与相关测试通过；联网实测 Progress、聊天、项目、Task、Automation；无 Workflow 请求、深链接 handler 和旧恢复状态 |
| A13 | CLI/TUI/渠道/桌面 | help、slash、启动资源与进度无专属项；普通任务/消息交付正常；桌面加载清理后的资源 |
| A14 | 文档和包 | 文档链接检查与构建通过；打包清单/静态产物没有旧功能；无仍承诺 Workflow 的说明 |
| A15 | 无隐藏残留 | 不存在 feature flag、兼容 endpoint、旧数据 decoder、映射器、后台 DAG、替代名称复制品或专属数据库修复分支 |
| A16 | 工作区边界 | 未覆盖现有个人记忆工作；最终 diff 中每项修改都能归属于删除或必要解耦 |

静态扫描针对 `workflow_manage`、`WorkflowRunService`、`GraphWorkflowRuntime`、`workflow_run_id`、`workflow-subagent`、`/api/workflows` 等精确符号与路径；所有运行时正向实现命中必须清零。通用工作步骤、CI/OAuth、决策记录及少量验证未知接口/不存在 schema 的负向测试可保留；不建立运行时白名单来掩盖残留。

## 9. 验证命令与实测要求

以下命令留待实施阶段执行，本轮不运行构建、测试或数据清除。

| 范围 | 命令/方式 |
| --- | --- |
| Node 与共享契约 | `pnpm run typecheck`、`pnpm run lint`、`pnpm run test:all`、`pnpm run build` |
| Web | `pnpm -C web run type-check`、`pnpm -C web run lint`；根 build 已包含 Web 构建 |
| 文档 | `pnpm run docs:check`、`pnpm run docs:build` |
| 依赖边界与分发 | `pnpm run depcheck`、`pnpm run release:check-package`；检查实际 dist 和静态根目录，不执行发布 |
| Android | `pnpm run mobile:android:test`、`pnpm run mobile:android:build`，以及相关 instrumentation journey；执行 Gradle 前遵循 gradle-run skill |
| iOS | `pnpm run mobile:ios:test`、`pnpm run mobile:ios:build`；确认实际可用 simulator destination，再使用项目现有脚本 |
| HarmonyOS | `pnpm run harmony:verify`，以及连接真实 Gateway 的设备/模拟器验证；host-only 不能代替 HAP 构建与设备验收 |
| Electron | 清理后的项目 build 与 `pnpm run electron:build`；启动验证内嵌 Gateway/Web，没有旧静态资源 |
| 集成 | 在隔离状态目录启动真实认证 Gateway，逐项执行 A03、A08—A13；访问普通会话/Task/Automation 路径，不能只测 route module |

实施阶段先运行直接受影响模块的测试，修复后完成一次全量检查；不通过删掉通用测试、跳过失败项或只保留类型检查来宣称通过。环境缺少 SDK、模拟器或签名条件时，验收记为未完成并记录具体原因；不把源码检查等同于设备通过。

不要求为已确定删除的图引擎再运行付费 A/B 基线或维护质量对照设施。使用现有有代表性的任务验证存活能力即可；需要真实模型的验收应记录 provider/model、任务目标、结果与取消/交付证据，不能只比较文字长度。

## 10. 最终交付物

1. 删除与解耦的完整代码变更，覆盖 Gateway、Web、移动三端、CLI/TUI、渠道和共享包。
2. 不含 Workflow 的 schema、初始化链和指定本地状态；无迁移器、兼容器、隐式修复或保留引擎。
3. 更新后的产品文档、架构图、资源、测试和干净分发产物。
4. 按 A01—A16 记录的验收结果，列出执行命令、实际设备/环境、数据库检查和剩余阻碍；全部强制项通过后才标记完成。

当前仅完成计划编写。下一步是依照本计划实施；本轮不执行任何删除、运行时修改或数据库操作。
