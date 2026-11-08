> 这是改动前的调研基线。后续以 [Codex 对齐实施记录](./tui-codex-parity-2026-11-08.md) 为准；不包含 Goal，不保留旧命令兼容入口。

# TUI 能力审计与补强建议

日期：2026-11-08。源码基线：`068191d66`，包版本 `0.0.454`。本报告基于当前工作区，包含当时未提交的变更；没有修改产品代码或既有变更。

## 结论

当前 TUI 已经是一个能力较完整的终端 Agent 工作台。下一阶段应优先保证会话、执行状态和操作对象正确，再补齐澄清回答、历史检索和附件管理，随后收敛命令与内部实现。继续增加平行命令、管理页面和扩展接口，收益低于完成现有交互闭环。

建议定位为：**在终端发起工作、观察执行、纠偏、恢复上下文、审查结果的轻量入口**。保留本地免 Gateway 使用与远程连接，复杂账号、插件商店和全局资源管理通过 CLI/Web 承接。

这里的优先级表示建议实施顺序，不代表已经测量了生产发生频率。没有使用量数据，不能据此断言某功能无人使用。

## 调研方法与验证范围

- 阅读 CLI 启动、TUI 主循环、双后端、事件渲染、会话操作、命令、选择器、扩展运行时和中英文文档，并与 Web 澄清提交链路比较。
- 当前会话没有可用的 codebase-memory 图谱工具，按仓库规则回退到源码检索。
- `src/tui/` 直接目录及 `backends/`、`components/`、`extension-host/` 下非测试 TS 源码合计约 22,036 行；公开命令列表有 51 项，另有未列出的别名及扩展/skill 命令。
- 执行：`pnpm exec vitest run src/tui src/cli/__tests__/tui-runner.test.ts src/gateway/hono/routes/config-patch/__tests__/tui.test.ts`。结果：**58 个测试文件、442 项测试全部通过**。
- 额外用内存状态、模拟 HTTP 和可控 Promise 运行隔离脚本，确认下文四个失败路径；没有连接真实账号、发送模型请求或改变用户数据库。
- 做了 ChatLog 渲染微基准。没有进行真实 Gateway 故障注入、真实终端视觉验收、跨平台/SSH/tmux/IME 测试。微基准不是完整终端帧率结果。

## 一、当前已有能力

| 能力 | 当前实现与边界 | 判断 |
| --- | --- | --- |
| 启动与双后端 | 默认 embedded；显式 Gateway URL/凭据切远程；启动消息、指定 Agent/工作目录、resume | 核心能力，应保留 |
| 日常对话 | Markdown、thinking 显隐、工具执行/结果、diff、图片显示、compact/transcript/raw 视图 | 已有成熟基础 |
| 输入编辑 | 文件补全、skill 命令、输入历史、草稿落盘、外部编辑器、多行粘贴处理、自定义按键 | 应继续打磨稳定性 |
| 执行控制 | Esc 中止；忙碌时 Enter steer，Tab 排下一条；待发输入可编辑/删除；压缩期间有本地队列 | 很有价值，但状态来源需要统一 |
| 输入可靠性 | Gateway 持久化待确认输入及 clientMessageId，回执核对；embedded 也有草稿和持久输入接收 | 已做过可靠性投入，应复用 |
| 模型与 Agent | 模型选择/循环/限定集合、thinking 等配置、Agent 切换、TUI 默认 Agent 偏好 | 保留，减少重复入口 |
| 会话管理 | 新建、恢复、重命名、删除、重置、fork/clone、JSON 导入、Markdown/JSON/HTML 导出 | 完整，但术语与异步隔离需补强 |
| 历史导航 | transcript tree、turn timeline、标签、过滤、按 SQLite 行窗口加载、原始视图 | 已有分页基础，不应另建历史系统 |
| 编码工作流 | 工作区绑定、项目识别、`/review`、工具 diff、`!` 本地命令和 `!!` 交互子进程 | 是 TUI 差异化价值 |
| 辅助工作 | `/btw` 临时旁问、`/share` 分享工作区产物、token/context 统计 | 保留，置于次级发现层 |
| 个性化 | 主题、自定义主题、光标/图片/补全行数、快捷键重载 | 保留设置，降低首页曝光 |
| 扩展 | 自定义命令、快捷键、编辑器、工具/消息 renderer、overlay、header/footer/widget、sessionManager 适配 | 能力较重，应明确支持边界 |
| 运行恢复 | realtime 重连、gap、事件去重、30 秒 watchdog、`/recover`、`/retry` | 已有机制，仍需纠正错误语义 |
| 澄清/审批 | `clarify_request` 能显示语义卡片；缺少 TUI 回答提交接口和交互 | 目前没有完成闭环 |

主要入口：`src/cli/commands/tui.ts`、`src/cli/commands/tui-runner.ts`、`src/tui/tui.ts`、`src/tui/tui-backend.ts`。

## 二、优先补强：正确性和操作边界

### P0-1：隔离会话切换前后的异步响应（已复现）

证据：`src/tui/tui-session-actions.ts:82` 的 `loadHistory` 在 await 前读取当前 conversationId，返回后直接更新共享 ChatLog、snapshot 和 history keys，未核对会话是否已变化。窗口加载也采用同一模式。

复现：启动会话 A 的历史请求，挂起；切到 B 并完成 B 的加载；最后释放 A 的响应。结果：`currentConversationId` 是 B，视图变为 A 的历史，B 的历史消失。这是显示/客户端快照混淆的已验证问题；未证明数据库内容被串写。

建议：每次会话切换递增 generation；请求捕获 conversationId + generation，更新 UI 前核对。对 history、window、metadata、输入状态和 picker 回调一起审查。AbortController 取消旧请求可以减少资源消耗，但不能代替响应归属检查。

验收：A→B→A 快速切换、旧请求晚返回、旧请求 finally、切换期间断线恢复均不能污染当前会话。

### P0-2：停止和重置必须报告真实结果（两条已复现）

证据：`src/tui/tui-session-actions.ts:158` 在等待后端前就清掉 activeRunId、切 idle，既不使用 `{ ok }` 也吞掉异常。模拟 `abortChat` 返回 `{ ok: false }`，UI 仍变成 idle。

证据：`src/tui/backends/gateway-realtime-backend.ts:828` 的 reset 不检查 HTTP 状态，并吞网络错误。模拟 HTTP 503，方法仍正常 resolve，调用方继续清理和加载历史。

建议：停止显示 `aborting`，等待服务端确认或终态；超时显示“停止未确认”，保留 run 身份并允许重查。重置必须检查响应，失败保留原视图。`/retry` 依赖 abort，因此应在停止结果明确后才能继续重发。

验收：403/503/网络超时、终态先于 HTTP 返回、重复 Esc、停止失败后 retry 均有明确且一致的状态。

### P0-3：远程操作不能悄悄落到本机（源码确认）

证据：`src/tui/tui-commands.ts:499` 的 `withTuiProjects` 打开本机 SQLite；`runTuiProjectCommand` 使用本机 ProjectService、TaskRepository、config、session metadata；`case 'project'` 在 Gateway 模式也直接调用它。远程启动项目解析已有 Gateway 后端实现，但后续 `/project` 命令没有走同一路径。

结果：远程 `/project list` 查的是本机项目；创建/归档等命令可能改本机数据，或因远程会话在本机不存在而失败。具体写入结果取决于本地数据库和约束，未对真实数据执行验证。

`/login` 从 `tui.ts:2226` 调本地 OAuth，`tui-oauth-login.ts:274` 使用 CredentialResolver 保存本机凭据；`/logout` 默认操作本机 auth profiles。远程模式用户可能期待修改 Gateway 的模型账号，但这里不会直接更新远程账号。`/trust` 同样基于客户端 cwd/配置；远程后端没有 refreshWorkspaceTrust 实现。

建议：为命令声明 `client` / `backend` 归属和后端 capability。项目命令通过后端统一实现；远程账号管理优先跳转 Gateway 设置，或明确标注为本机账号管理；本机 shell/信任策略显式标识作用机器和路径。未完成的远程管理能力应从远程菜单隐藏并给出清楚的替代入口。

验收：用本机 A、Gateway B 两套隔离存储，检查每条管理命令的读写归属。远程操作不得产生未声明的本机项目或账号变更。

### P0-4：读失败不能伪装成没有数据（已复现）

证据：Gateway backend 的 `loadHistory`、`listSessions`、`listModels` 等在 HTTP 错误/异常下返回空结果。模拟历史 HTTP 503 得到 `{ messages: [] }`；`tui-session-actions.ts:102` 可以据此清掉已展示历史，finally 又设置 historyLoaded=true。

建议：区分成功空列表、未找到、未授权、暂时不可用；失败保留最后成功的数据，并提供重试。统一处理 401/403、连接状态和 REST 错误；`gatewayFetch` 增加可取消和按操作配置的超时，当前没有统一应用层 deadline。

验收：历史已显示时接口短暂失败，历史仍在；会话列表加载失败不会显示“没有会话”；认证失败不被描述为单纯网络不可达。

## 三、需要补齐的产品闭环

### P1-1：澄清与审批回答

证据：`tui-agent-events.ts:417` 仅 upsert 语义卡片；`components/semantic-cell.ts` 仅渲染标题和选项，没有 handleInput；TuiBackend 没有提交澄清答案的方法。Web 已有 `/api/clarifications/:id/responses` 提交链路（`src/gateway/hono/routes/agent-stream.ts:118`）。embedded 创建 AgentService 时未传 gatewayClarify，factory 的 resolveAskUser 无回调时返回 null。

建议先实现单选/自由文本、确认/拒绝、取消、过期/已回答显示和重新连接后恢复待答问题；保留 requestId、version、幂等键与审批操作身份。不要把普通聊天输入或 steer 当成审批答复。多问题批量澄清可后做，但客户端必须明确声明能力，不接收无法回答的 presentation。

### P1-2：统一命令发现和帮助

51 项公开命令以平铺形式展示，增加学习成本。`getSlashCommands(_isLocal)` 没有使用模式参数，也没有能力过滤。`/tree` 描述是 grouped session tree，实际主要打开当前会话 transcript tree；`/agents` 实际优先开 picker；`/compact` 文案写 local API，但 Gateway 已实现。

建议建立单一 command registry：canonical name、aliases、说明、参数、scope、capability、handler 从一份定义生成补全和帮助。`/help` 先列日常对话/会话/模型/诊断分组，再展开高级功能。未知命令先给出建议或明确的转聊天操作，当前直接 `sendMessage(input)` 容易让拼错命令触发模型请求；skill 和扩展命令继续按注册规则支持。

### P1-3：历史检索和大历史体验

已有 timeline/tree 过滤与会话元数据模糊/短语/正则搜索，不能描述为“没有搜索”。缺口是统一的会话正文全文检索和结果定位，以及历史视图间的清楚导航。

Gateway 初始 `loadHistory` 即使只展示 200 条，也请求整份 transcriptRows 后在客户端裁剪；loadTranscriptTree 和统计路径也可能读取全量。TranscriptOverlay 已按窗口加载，但向前翻页不断合并历史后重建 ChatLog。

建议复用现有 SQLite 搜索/窗口接口：检索正文→命中列表→定位 rowNumber；初始也按窗口读取。整合 tree/timeline/transcript 的导航入口，但保留分支、turn、原始数据各自的用途。

### P1-4：附件管理和上下文可见性

已有剪贴板图片、图片大小/数量限制和 `@file:` 引用补全。缺口是统一附件列表、预览/移除/清空、失败重试时附件归属和终端不支持剪贴板时的入口。忙碌期间图片不能排队或 steer，需在发送前明确反馈并保住草稿。

`@file:` 是工作区引用，不等同于把客户端文件上传到远程 Gateway。应区分本地文件、后端文件引用和实际上传。先完善图片及文件路径输入，无需立刻复制 Web 的所有音视频功能。

### P1-5：终端适配与可访问性

已有硬件光标配置、多行粘贴 fallback、Windows 图片按键分支、图片终端能力检测及主题。当前文案主要是英文，中文 IME、窄窗口、tmux/SSH、headless clipboard 的真实表现仍需验收。

建议补 UTF-8/CJK/emoji 宽度、IME 组合输入、括号粘贴、resize、终端恢复、SSH 无桌面剪贴板、Ctrl+S 流控等测试矩阵；复制可考虑 OSC52 或导出降级。不要在缺少真实终端证据时直接删除平台 workaround。

## 四、可以优化或移除什么

原则：**以 Codex CLI 的交互和工作流为目标；确认属于 legacy 的重复入口和占位实现直接删除，不保留兼容分支。**

| 对象 | 建议 | 保留的核心价值/条件 |
| --- | --- | --- |
| `/exit` 与 `/quit`、`/btw` 与 `/aside`、reload 变体、status/session | 删除旧别名和对应 dispatch，仅保留规范命令 | 减少重复入口 |
| `/models`、`/model`、`/switch` | 统一成 `/model` picker + 参数切换；列表作为子操作；删除旧入口 | 保留脚本式输入与快速切换 |
| `/fork`、`/clone` | 同一套分叉实现与明确的“从此处/复制全部”选项；删除 clone 入口，保留 fork 的定位选择 | 当前 fork 无参数开消息 picker，clone 无参数复制全部，不能粗暴视为完全重复 |
| `/list`、`/resume`、跨会话 tree 与当前 transcript tree | 统一会话入口和术语；当前会话 tree 放历史导航 | 不移除分支定位和恢复能力 |
| `/think`、`/thinking`、`/reasoning`、`/verbose` | 区分推理强度、内容可见性、显示详情；常用操作留快捷入口，其余进设置 | 它们影响不同层，不能合并成同一个布尔开关 |
| `/config`、`/session`、`/status`、`/usage`、`/context` | 共用状态摘要和详细分区，减少格式器/统计请求重复 | 模型配置、上下文预算、累计 token 是不同数据，不混为一个指标 |
| `/start`、`/changelog`、`/hotkeys`、`/reload-keybindings` | 降为帮助/高级操作；统一 `/reload` | 诊断和高级配置能力仍保留 |
| 远程 `/project`、本机 OAuth/信任管理 | 修正归属前停止在远程主菜单无差别展示；提供 CLI/Web 入口 | 项目工作区绑定仍是核心，不删除启动解析 |
| HTML export | 当前是 escaped Markdown 包在 `<pre>`，不是完整富文本导出；降级描述，或按导出需求复用已有 renderer | JSON 保留恢复语义，Markdown 保留通用性 |
| 重型管理能力 | 不建议新增完整插件商店、知识库/自动化 CRUD、账号设置中心到 TUI | 展示状态、发起必要操作、跳转 CLI/Web 即可 |
| 双后端 | 保留；优先抽共享契约和业务服务，减少客户端直读存储 | 免 Gateway 启动与远程使用都有清晰价值 |
| 扩展 UI | 保留已使用的命令/renderer/overlay；冻结新增接口，明确本地支持范围 | `tui.ts` 仅本地加载扩展；replacement context 存在返回空值的 UI 占位，应逐项审计并显式报告不支持 |
| 平台补丁 | 有终端矩阵与替代机制后再退场 | 函数名含 Windows 的 paste fallback 实际还覆盖部分 macOS 终端，不能按名称判断删除 |

不建议移除：steer/follow-up、草稿和回执、recover、分叉、timeline、工具 diff、review、`!`/`!!`、外部编辑器。这些直接服务终端工作连续性。

## 五、内部实现优化

### 1. 统一业务操作和状态来源

`tui.ts` 2,862 行、commands 1,421 行、双 backend 合计 2,445 行、扩展 runtime 942 行。行数只是维护信号，真正的问题是 UI 主循环同时承担会话、认证、工作区、事件、导出、扩展适配和输入交付。

建议按会话控制、输入交付、命令注册、历史视图、终端宿主划分 controller。持久输入状态是发送与排队的事实来源；compactionQueue、扩展 pending message、编辑状态要定义清楚如何接入，不再各自隐含推进任务。保留 runId、conversationId、inputId、revision 的归属检查。

### 2. 优化 ChatLog，而不是先换 TUI 框架

`components/chat-log.ts:425` 每次渲染遍历全部 child；又对每个 child 做 entryRecords.find，存在 O(children × records) 查找。历史视图最终只截一屏，但截屏发生在全量渲染之后。active/committed 集合目前主要记录生命周期，没有让该 render 路径跳过旧 cell。

同一机器、宽度 100、纯系统消息带 displayIndex、预热后 5 次中位数：

| 组件数 | render 中位耗时 |
| --- | --- |
| 200 | 0.15 ms |
| 1,000 | 4.09 ms |
| 5,000 | 69.06 ms |

这只证明该构造下有明显增长开销，不能推成所有真实对话都会卡。建议先用 Map 去掉逐条 find；按宽度/主题/展开状态缓存已提交 cell；为视图保留行索引并限制加载窗口，再用真实长对话验收内存与输入延迟。没有证据支持现在重写或替换 pi-tui。

### 3. 测试从 helper 扩展到工作流

现有 442 项通过证明局部行为覆盖较好；stream recovery 测试主要验证状态 helper，不能替代真实断线/回放。已检索到 node-pty 的基础 CI smoke 和若干以 clientKind=tui 访问协议的脚本，不能当成完整 TUI 按键与屏幕验收。

优先补上述四个复现的回归，再加真实 Gateway + PTY 场景：启动→发送→排队→断线→恢复→切会话→停止；澄清→回答→重连；慢历史与认证失败；大工具输出与 resize；退出恢复终端。不要为了覆盖数字而给纯格式函数继续堆镜像测试。

## 六、建议实施顺序与验收

| 阶段 | 交付 | 验收依据 |
| --- | --- | --- |
| A：正确性 | 异步响应归属、abort/reset 结果、读失败保留数据、远程命令作用域 | 四个已复现问题变成回归测试；A/B 存储隔离测试；真实 Gateway 故障路径 |
| B：工作流闭环 | 澄清/审批回答、统一命令注册与帮助、附件列表与移除 | 本地/远程核心能力矩阵；问答恢复；命令 scope 和能力过滤 |
| C：效率 | 正文搜索+row 定位、窗口读取、ChatLog 索引/缓存 | 真实长历史的首屏耗时、网络体积、峰值内存、输入延迟 |
| D：收敛 | 删除旧别名、重复面板与格式器合并、扩展接口边界、文档补齐 | 常用任务操作数减少；规范快捷键与旧别名拒绝行为；终端矩阵通过 |

中英文 `docs/tui.md` 目前只有启动/恢复/连接/排错，未解释主要命令、队列、历史导航、权限作用域。阶段 B 应同步补一份简明任务指南；帮助与文档尽量由命令定义生成，避免 `/tree` 一类语义漂移。

建议先做阶段 A，之后用同一条“启动→完成一个工作→中断→恢复→审查结果”的路径判断新增功能的价值。属于 legacy 的入口和实现直接删除；功能是否完成按真实行为验收。
