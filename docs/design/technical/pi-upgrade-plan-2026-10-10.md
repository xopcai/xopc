# pi 0.87.0 → 1.1.0 升级方案

日期：2026-10-10。状态：阶段 1 已完成开发与本地验收；在 main 工作区保留未提交变更，由用户统一 commit。阶段 2/3 尚未实施，未发布或部署。

## 决策与范围

将四个直接依赖 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui` 从固定版本 0.87.0 一起升级到固定版本 1.1.0。先完成新版 SDK 适配和现有功能回归，再试点 Codemode 和按需工具发现。每一阶段均可独立交付和关闭，不把新能力设为升级底座的前置条件。

按用户要求，模型名称、Provider ID 和相关认证入口直接采用目标版本的最新契约，删除相应 legacy 代码。旧名称不保留别名、回退路由、双目录、自动转换或长期迁移层；过期配置明确报错并提示使用当前名称。配置示例、文档、测试和默认值同步更新。历史 transcript 保留原始审计数据，但其中的旧身份不作为恢复当前模型配置的依据。

本轮继续使用 xopc 的 SQLite、会话身份、Agent 配置、凭据、MCP 服务管理、权限策略和图片 Provider。暂不迁移到 `pi-durable`，不引入另一套 `mcp.json` 或 `auth.json`，不更换全屏 TUI，不接入 Virtual Models、分类模型或 pi 的图片生成路径。它们分别评估，不与依赖升级混在一起。

目标版本以 1.1.0 的发布 tag 和 npm 工件为准；实施时复核四个包均已发布、完整性和传递依赖。若发现新的阻断问题，先记录问题与证据，再调整目标，不自动追随 latest。

## 已确认的集成边界

当前会话入口在 `src/agent/embedded/session-runner.ts`：使用 `createAgentSession`、自定义 `ModelRuntime`、SQLite 水合的 `SessionManager`、内存设置，关闭 pi 内置工具并注入 xopc 工具。

| 边界 | 主要位置 | 升级关注点 |
| --- | --- | --- |
| 会话创建与复用 | `src/agent/embedded/session-runner.ts` | SDK 参数、扩展绑定、池指纹和释放 |
| 系统提示词 | `src/agent/embedded/system-prompt-override.ts` | 当前访问 `_baseSystemPromptOptions` 等内部字段；需确认新版本行为 |
| 运行与策略 | `src/agent/embedded/run-turn.ts`、`src/agent/orchestration/` | 重试、停止、澄清挂起、桌面控制租约、结束语义 |
| 事件转发 | `src/agent/embedded/subscribe-session.ts`、`types.ts`、`src/gateway/chat-stream/mapper.ts` | 最终结束、取消、耗时、嵌套调用 |
| 工具桥接 | `src/agent/embedded/xopc-tools-bridge.ts`、`src/agent/tools/executor.ts` | 提示规则、参数、错误、授权和并发 |
| 批量读取 | `src/agent/tools/dataBatch.ts`、`src/agent/data-acquisition/` | AsyncLocalStorage 的允许工具集合不能因嵌套调用而扩大 |
| 持久化 | `src/agent/embedded/sqlite-hydrating-session-manager.ts`、`session-tool-result-guard.ts`、`transcript-runtime.ts` | custom entries、上下文投影、落盘顺序与恢复 |
| 模型与凭据 | `src/providers/`、`src/auth/`、`src/config/models-json.ts` | Provider ID 与 API 类型、OAuth、目录与缓存 |
| TUI 与分发 | `src/tui/`、`scripts/`、`tsdown.config.ts`、Electron 构建配置 | 导出、运行时依赖、资源路径和打包 |

本次工具目录没有提供 codebase-memory-mcp 图查询工具，因此采用源码和配置检索。当前检索未发现运行时代码直接使用已移除的 `AgentHarness` 或 `pi-agent-core/harness`，仍需在实施前对完整依赖和产物做确认。

## 阶段 0：基线和变更清单（PR 1 的准备工作）

1. 固定基线 commit、四个旧包版本、锁文件和测试结果。按用户后续要求，直接在 main 工作区实施，保留其他正在进行的变更；本次不提交，由用户统一 commit。
2. 对比四个包 0.87.0 与 1.1.0 的导出声明、引擎要求、传递依赖和资源。特别检查 `/compat`、`/bun-oauth`、provider 子路径及 TUI 类型扩展。
3. 列出每个破坏性变化的调用位置、修改方式、对应验证与回退影响，并建立 legacy 删除清单：旧模型别名、旧 Provider 身份、专用认证路由、失效的 metadata 修正与过时 SDK 适配。移除实验性 harness 是检查项，不以引入 `pi-durable` 作为默认解法。
4. 保存同模型、同 thinking、同工具集的普通聊天、工具、图片、取消、恢复和数据查询样本。真实模型结果与 mock 回归分开标记。

输出：变更与删除清单、可重现的基线和需处理的问题。未解决包导出或运行时支持问题前不进入发布。

## 阶段 1：底座升级与 legacy 清理（PR 1）

### 依赖与构建

- 更新根 `package.json` 和 `pnpm-lock.yaml`，四个直接 pi 包保持 1.1.0。检查 workspace 其他 manifest、锁文件中的重复版本和 peer 约束；只调整相关项。
- 检查 `pnpm-workspace.yaml` 的 release age 豁免和传递包；需要新增时使用精确项，不扩大到所有包。
- 新增运行时模块、WASM、worker 或资源必须在 Node 发布包及 Electron server 产物中可解析。不可只验证源码环境。
- 修复真实类型差异，不以新增大范围 `any`、忽略诊断或直接修改 `node_modules` 通过编译。

### 会话、提示词与结束语义

- 验证系统提示词覆盖在首次请求、工具切换、复用 runner、重试和恢复后均有效。优先使用公开 SDK 能力；如仍需内部适配，集中在现有适配模块，并加入行为回归。
- 区分低层 `agent_end` 和会话 `agent_settled`。前者可能之后还有自动重试或排队工作；后者表示 pi 不再自动继续。xopc 还有自己的恢复和续跑逻辑，最终 run 完成必须等待这些工作结束，不能简单把任一 pi 事件直接映射成业务完成。
- 明确重试由哪层负责及总尝试上限，防止 pi 与 xopc 重试叠加导致重复调用或长时间无响应。
- 保留 `message_end` 的最终消息为权威结果；取消与正常完成分开，错误后不重复发成功终态。
- SQLite 继续使用现有 append 链路，不新增 turn-end 全量保存；压缩、reset 保持 conversation UUID 与 transcript 切换规则。

### Provider 与认证

- Azure 的 **provider ID** 从 `azure-openai-responses` 变为 `azure`；**API 协议类型** `azure-openai-responses` 仍存在。禁止全局字符串替换。
- 梳理 provider metadata、env key mapping、models.json、模型 ref、agents 配置、工作流 intent/ref、会话覆盖和模型目录中的身份引用；代码、默认值、受版本控制的配置示例和文档统一使用 `azure`。删除旧 Provider ID 的识别、映射和回退，不增加自动迁移脚本。
- 旧名称出现在用户配置、会话覆盖或工作流中时，返回明确的配置错误，列出需要更新的字段和当前名称；不静默选其他模型。用户按新版配置重新选择。历史 transcript 只保留和展示原始记录，不解析成旧 Provider 运行分支，不重写历史。
- 保留 `AZURE_OPENAI_*` 环境变量；协议相关缓存判断按 API 类型处理。
- 将旧 `openai-codex` 专用登录、刷新、凭据解析和请求路由替换为新版 OpenAI ChatGPT 登录契约，并从 xopc 对外目录移除旧 Provider。旧 token 不自动转换或复用，旧订阅用户通过新版入口重新登录；新版 OpenAI API key 与 ChatGPT OAuth 的选择必须显式、可验证。正常使用的其他 Provider OAuth 能力保留，`XopcModelCredentialStore` 的读写、刷新和并发锁继续验证。
- 核对补充模型 metadata、动态目录注册和 upstream 目录的优先级。上游已正确覆盖的旧补丁、别名和兼容分支直接删除，只保留当前仍有依据的修正以及合法自定义 Provider；过期型号不自动映射为新型号。
- 同步清理枚举、schema、UI 选项、默认模型、测试 fixture、文档和示例中的旧身份；删除仅验证旧分支的测试，增加旧配置被明确拒绝及新版登录/模型调用成功的行为测试。上游仍支持的 `/compat` 公共入口或 `azure-openai-responses` API 类型不因名称包含旧词而误删；是否保留以实际新版契约为准。

验收：类型检查、相关回归、完整回归和打包检查通过；真实 Gateway 的带鉴权会话输入与 realtime 订阅完成一次工具调用、取消和恢复验证。底座阶段不加载 Codemode、tool search 或 pi MCP 扩展。

## 阶段 2：Codemode 有界读取试点（PR 2）

### SDK 接入与配置

- 通过 `DefaultResourceLoader.extensionFactories` 显式加载公开的 `createCodemodeExtension()`；SDK 不自动加载 CLI 的 Codemode。核对显式 `tools` 列表与 `noTools: 'builtin'` 的行为，确保目标工具实际启用且权限集合没有扩大。
- 使用 `mode: 'on'` 起步，保留正常工具调用；不启用只允许脚本的 `only` 模式。
- 在现有两层 Agent 配置中增加一个默认关闭的开关（字段名实施时确定），遵循 defaults → agent override。新配置、允许工具、曝光策略、超时和输出预算进入 runner 指纹；配置变更触发重建，关闭后取消活动脚本、释放会话资源。
- 只开放可确认无副作用且可安全并发的读取工具。`data_batch` 作为已有入口保留；外部查询必须沿用它的账户、revision 和允许操作约束。

### 权限与执行约束

- 每个嵌套调用都必须经过 xopc 的策略、目录指令、执行上下文、账户授权、AbortSignal 和并发控制。当前 `session.agent.beforeToolCall/afterToolCall` 是否覆盖 `ctx.executeTool()` 是必须实测的检查点；若没有覆盖，先补齐适配再开启试点。
- 工具搜索可见性与执行授权分别检查。不能仅靠描述里隐藏工具；通过猜名字直接调用也必须被拒绝。
- 首轮不给脚本调用 shell、写文件、发消息、修改任务、浏览器或桌面控制工具；也不开放 `models.classify()` 和 `models.generateImages()` 旁路。若公开 SDK 无法约束这些入口，保持功能关闭并记录缺口。
- 所有调用复用原工具执行器；只读可并行，未知副作用和互斥工具不能因 `Promise.all()` 绕过现有锁。桌面控制租约、等待连接和等待澄清同样约束子调用。
- 使用宿主强制的总超时、并发上限、调用次数与输出预算。建议初始脚本期限 60 秒、同时调用上限 4；实际阈值结合原工具期限调整，脚本参数不得突破宿主上限。
- 脚本失败或取消保留已完成子调用的结果状态；不自动重放整个脚本。沙箱执行不是事务，不能声称失败撤销已经发生的操作。

### 数据与事件

- 核对 xopc 工具的 `details`、内容块、错误状态如何映射到 pi 的 `structuredContent`/`outputSchema`，不能假设它们自动等价。保证 `apply_patch` 等既有直接调用的错误语义不回归。
- `parentToolCallId`、耗时和子调用状态必须穿过 embedded → Gateway → 共享协议 → UI 链路。父调用和子调用的使用量只结算一次。
- 子调用不是独立的顶层模型 tool call；不能在模型上下文中制造缺少对应 assistant toolCall 的 toolResult。按上游 `nestedCalls` 契约保存有界记录，UI/审计与 LLM 投影分别验证。
- `store/load` 使用上游 `codemode-store` custom entry；验证 guard、SQLite 同步、冷启动、压缩和 reset 后的行为。跨 conversation/agent 不共享，reset 后不带入旧 transcript 状态。
- 系统提示词覆盖必须保留脚本 API 和被隐藏工具的必要规则，尤其是工具曝光改变之后；避免宣称可调用实际不可用的工具。

验收：允许读取能运行，越权读取和猜测禁用工具名被阻止；子调用取消、超时和错误可见；状态恢复一致；有完整调用记录且不存在费用重复。任一宿主约束无法落实时，不开启开关。

## 阶段 3：按需工具发现与 MCP 试点（PR 3）

1. 在阶段 2 基础上显式加载 `createToolSearchExtension()`，建立工具 `exposure`、`namespace`、`annotations` 和输出结构映射。授权后的工具集合是上限，工具发现只改变展示和载入。
2. 继续由 `src/agent/mcp/` 负责连接、OAuth、重连、TTL 和销毁，不加载 `createMcpExtension()` 另开连接。用现有 MCP 工具注册到 SDK；名字归一化后的 JS 标识符碰撞必须明确报错。
3. 先对一个工具较多的 MCP 服务器使用 deferred 曝光，保留其他工具的直接路径。验证连接未就绪、搜索无结果、断线、重连、工具移除、配置权限改变、冷启动和会话恢复。
4. `ALL_TOOLS`、搜索和描述结果不得暴露未授权的服务、账户或工具。缓存和 runner 指纹应覆盖工具契约/权限变化；同名工具描述或曝光改变时也必须刷新。
5. 在 Web 展示父脚本、子调用、最终状态和耗时；较长输出提供受控文件访问，不能把本机临时路径当远程客户端的可读文件。TUI 与移动端至少能正确显示或安全降级，不丢失终态。
6. 如果必须增加 Gateway API，按仓库规则同步 lazy-bundle matcher、正负映射测试，并验证真实带鉴权路径。能复用现有事件和文件 API 时不新增路由。

验收：工具发现与直接调用的授权结果一致，断线或恢复不留下失效声明；现有客户端兼容新增可选字段。移动端只有在共享协议或呈现需要改变时才单独修改和运行对应平台验证。

## 验证与收益评估

### 实施时执行的检查

阶段 1 已执行以下本地检查，具体结果见下方实施记录。后续阶段继续先跑相关检查，修改稳定后完成全量门槛。

```bash
pnpm run typecheck
pnpm vitest run src/agent/embedded/__tests__ src/agent/orchestration/__tests__ src/providers/__tests__ src/auth/__tests__ src/tui/__tests__ src/agent/tools/__tests__/concurrency.test.ts src/gateway/chat-stream/__tests__/mapper.test.ts src/realtime/__tests__/compact-run-event.test.ts
pnpm run test:all
pnpm run test:skills:all
pnpm run build
pnpm run release:check-package
pnpm run test:startup:imports
pnpm run test:startup:bench:check
pnpm run test:startup:gateway:check
```

底座阶段验证 Node CLI/TUI、发布包安装后的启动和 Electron server 产物；若 QuickJS/扩展依赖影响桌面打包，追加 `pnpm run electron:build:artifacts` 及开发包启动。Web 协议或 UI 有改动时追加 `pnpm -C web run type-check` 和相关 Web 测试。现有未通过的基线问题单独记录，不能把“已有失败”用作跳过新回归的理由。

新增测试覆盖行为边界：重试期间提前结束、hook 绕过、取消后残留调用、未知工具名、结果结构、指纹失效、custom entry 恢复与错误费用。复用现有测试和 mocked provider；真实上游验证只使用配置好的测试账户，并把是否真实联网、模型和成本范围记录清楚。

### Codemode 推广门槛（PR 4 的评估与默认策略）

- 固定至少 30 个任务，覆盖文件/Git 查找、知识检索、多项目进展和一个 MCP 查询；部分失败与无权限任务均计入。
- 对比现有直接调用/`data_batch` 与 Codemode，固定模型、thinking、数据快照、工具和输出要求，每项至少 3 次；记录请求次数、输入/输出 tokens、缓存命中、总成本、端到端中位数/P95、成功率与来源完整性。
- 严重越权、跨会话状态泄漏、残留运行和落盘错误必须为零；确定性行为测试必须全部通过。
- 以下是拟定的推广阈值，不是已测收益：代表性组合查询的中位耗时降低至少 20%，或输入 tokens 降低至少 15%；成功率不低于基线，整体 P95 不超过基线 10%。样本差异过大时扩大样本，不直接宣布达标。
- 单工具任务允许继续走直接路径；不为了使用 Codemode 强制增加脚本步骤。达标后先让明确的 Agent 试用，再决定 defaults；未达标则保留 opt-in。

## 发布与回退

| 交付 | 内容 | 回退方式 |
| --- | --- | --- |
| PR 1 | 底座、最新模型/认证契约、legacy 删除、回归和分发 | 保留旧发布工件与配置备份；回退需整体恢复旧代码、依赖、锁文件和状态备份，不在新版中保留旧路由 |
| PR 2 | 默认关闭的 Codemode 读取试点 | 关闭开关并重建 runner，保持升级后的底座 |
| PR 3 | 工具发现、单 MCP 试点、事件展示 | 关闭发现/曝光策略，恢复直接工具路径 |
| PR 4 | 评估记录与默认策略 | 恢复 opt-in，不回滚已验证底座 |

底座先在隔离状态目录和 SQLite 副本上验证。新版本写入的 custom entries、嵌套结果与旧版本读取兼容性必须有实测结论；未确认前禁止混用新旧进程访问同一状态目录，也不能只降 npm 版本。

发布说明明确列出旧 Provider/模型名称失效、配置更新位置和重新登录要求。现有用户配置的备份用于整体回退，不用于在新版本内运行旧身份；本轮不静默删除用户凭据文件或历史会话。对旧身份的无引用检查须区分历史记录、变更说明、明确拒绝用例和仍有效的 API 协议名称，避免错误扩大清理范围。

底座发布后至少观察一个完整的日常使用周期；以失败率、提前完成、重试次数、取消耗时、runner 数量、数据库检查和启动耗时判断是否继续。`xopc doctor --deep` 应对隔离验证数据及发布后的目标数据通过。若出现数据完整性、凭据错误或持续运行故障，停止推广并按对应阶段回退。

阶段 1 的本地验收已完成，发布时间由用户决定。Codemode 的 hook、持久化和打包适配仍需阶段 2 的 SDK 验证，再据此确定实施工期。

## 阶段 1 实施记录

- 基线：main `2e4c50517`，四个直接 pi 包为 0.87.0；升级前会话、提示词和认证相关 4 个文件、27 项测试通过。实际执行环境为 Node 24.16.0 / pnpm 11.9.0，项目 Node 最低版本未更改。
- 四个直接依赖固定为 1.1.0；传递依赖包含 pi-codemode、pi-mcp 和 QuickJS，但 embedded SDK 不加载这些扩展。没有增加第二套会话或凭据存储。
- 新 OpenAI ChatGPT OAuth 通过公开 Provider API 接入，持久化安装 UUID、动态签发的 clientId 和 scope；保留 xopc 原有凭据锁。Agent/全局 API key 优先，其次 OAuth，最后环境变量。取消会中止等待中的手动回调。
- 删除旧 OpenAI Codex 登录实现、旧协议枚举/路由修正、Google token 的 legacy 解包、本地 gpt-5.6 别名和已失效的 OpenAI context window 补丁。旧 Provider 在目录、凭据解析、模型解析和自定义配置校验中被拒绝；旧 token 文件不作为新凭据使用，不自动转换用户配置。
- Azure Provider 使用 azure；保留 azure-openai-responses API 和 AZURE_OPENAI_* 变量。历史 cloud-public-models 一次性迁移模块保持历史契约，它不为旧 Provider 提供当前运行分支，也不重写 transcript。
- embedded 关闭 pi 自动重试，由 xopc 继续负责既有重试策略；等待 agent_settled 后转发结束，保留 aborted 与工具 durationMs。业务终态仍由 Gateway 等待 xopc 的全部运行逻辑后发出。
- 提示词适配继续集中于现有模块；真实 1.1.0 SDK 测试验证工具切换重建及同会话再次覆盖后仍使用 xopc 提示词。

| 本地检查 | 结果 |
| --- | --- |
| 根类型检查 / Web 类型检查 | 通过 |
| 全量 Vitest | 1,485 个文件、8,853 项测试通过；3 个文件、12 项测试按原配置跳过 |
| 最后补充回归 | 新版 SDK 提示词与 OAuth 手动回调/取消测试通过；最后的 Provider 拒绝及认证/fallback 回归通过 |
| skills 检查 | 单元测试通过；回归脚本通过，但其当前目录发现逻辑报告 0 项，不作为 bundled skills 实测证据 |
| Node、声明、Web 构建 | 通过；Web 有 chunk 大小和既有静态/动态导入警告 |
| 发布包清单 / bootstrap 导入 | 通过 |
| npm 工件安装 | 本地 pnpm pack 后在临时目录安装，CLI version 和根模块 import 通过；安装时跳过依赖构建脚本，本项不覆盖原生辅助工具安装 |
| CLI 启动预算 | 单独复测通过；TUI 首次输出平均 2,464ms，接近原有 2,500ms 门槛；并行全量测试期间首轮超标 |
| Gateway 启动预算 | 两次通过，ready 平均 6,728ms，p95 8,191ms，门槛 20,000ms |
| 真实 Node Gateway + 本机模拟模型服务 | 带鉴权 REST、realtime 工具结束、模型收到工具结果、取消终态、进程重启及 SQLite transcript 恢复全部通过 |
| Electron server 构建 | 通过，新 OpenAI ChatGPT OAuth 确认包含在 bundle 中 |
| Electron server bundle + 本机模拟模型服务 | 同样完成鉴权输入、工具调用、取消、进程重启及 SQLite 恢复，4 次模型请求全部在本机处理 |

OAuth token 服务和模型响应均使用模拟服务；OAuth 回调使用真实本机 callback server。没有消费真实模型额度，也没有进行真实 ChatGPT 账户登录、系统浏览器/原生桌面辅助工具验收或应用安装包发布。阶段 2/3 的 Codemode、子调用和按需工具发现验收仍待实施。

## 官方依据

- [1.1.0 发布说明](https://github.com/earendil-works/pi/releases/tag/v1.1.0)：目标版本与近期修复。
- [0.99.0 发布说明](https://github.com/earendil-works/pi/releases/tag/v0.99.0)：Codemode、工具曝光和模型能力变化。
- [1.0.3 发布说明](https://github.com/earendil-works/pi/releases/tag/v1.0.3)：Azure provider 改名。
- [Agent Core 1.1.0 changelog](https://github.com/earendil-works/pi/blob/v1.1.0/packages/agent/CHANGELOG.md)：harness 移除与工具耗时。
- [SDK 文档（1.1.0）](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/sdk.md)：会话、最终结束语义与显式扩展注册。
- [Codemode SDK 示例（1.1.0）](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/examples/sdk/14-codemode-mcp.ts)：扩展工厂、工具启用和绑定。
- [Codemode 文档（1.1.0）](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/codemode.md)：沙箱、输出、状态与结果契约。
- [Azure provider 源码（1.1.0）](https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/src/providers/azure.ts)：新 provider ID 与保留的 API 类型。
