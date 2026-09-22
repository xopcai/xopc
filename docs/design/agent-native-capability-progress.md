# Agent 原生能力实施账册

日期：2026-09-21。此表只把实际进入生产调用链的操作标为已迁移，不代表后续阶段完成。

## 最新完成度核查

2026-09-22 S5 进程中断恢复：发布变更前持久化 app 级 pending 标记，Gateway 在扩展代码加载前按 SQLite 最后提交状态恢复安装目录及当前应用启用配置；不覆盖其他应用配置。恢复校验正式产物路径、源码摘要及能力契约，损坏或配置落盘失败保留标记并拒绝启动／继续发布；标记存在时能力调用拒绝。未提交的正式版本目录移至 `.interrupted-*` 保留，避免占用下一次发布版本；不删除业务数据。覆盖安装、回滚、启停、卸载，恢复可重试。边界是单 Gateway 进程中断，不宣称支持多进程同时发布、断电损坏或丢失正式产物时自动修复。

浏览器回归发现并修复工作台 SWR 缓存摘要变化后预览仍绑定旧摘要、升级按钮持续禁用的问题；验收保存失败也会清除保存中状态。增加 `scripts/local-app-release-browser-smoke.mts`，使用隔离状态、真实认证 Gateway 和 Chrome，不使用真实账号／外部写入。

本轮验证：12 文件 82 项通过，根类型检查、生产修改 ESLint、Web 构建及 diff 检查通过（smoke 脚本不在现有 ESLint 配置内，依真实执行验证）。真实浏览器通过预览自动验收、安装／权限确认、iframe 经宿主调用 notes.list、升级旧授权失效／重新授权、禁用拒绝能力调用／启用、回滚后重新运行、卸载保留版本历史。人工构造未提交目录替换检查点后 SIGKILL 实际 Gateway，重启恢复 SQLite 已提交 v1，后续升级流程继续成功。该故障注入不等于所有指令边界或断电耐久性测试。此增量不代表所有 S0–S6 完成，真实账号外部写入仍待授权。

2026-09-22 S5 发布一致性增量：安装、回滚、启停和卸载使用按扩展目录共享的进程内串行锁，覆盖多个 LocalAppService 实例，防止发布操作互相覆盖配置和交错移动目录。失败释放锁，后续操作重新读取状态。修复激活暂存复制失败时误删原安装目录的风险；恢复目录失败保留备份；暂存清理失败只记录日志，不再把已提交发布判为失败并删除正式产物。卸载的提交后通知移出文件回滚区域。

验证：Local App、Agent 工具和能力路由联合 6 文件 62 项通过；新增跨实例并发、生命周期顺序、复制失败及清理失败回归。根类型检查、修改的生产文件 ESLint 和 diff 空白检查通过。

边界：这是进程内并发及异常处理保护，不是跨进程锁或崩溃恢复日志。进程中断后的文件／配置／数据库恢复、完整浏览器发布闭环仍待实现／验收；真实账号外部写入继续单列待授权。

2026-09-22 S5 本地写入／Agent 入口／发布校验增量：声明增加 Notes create/update/append 三项本地写绑定（合计七项）；未开放删除、Task 写或真实外部写。UI 和 `xopc_use local_app capabilities/invoke` 共用 `localAppCapabilities`，Agent 只发现当前已授权发布版，不生成授权。保留调用方 scopes、能力收窄与资源授权；原始意图 key 按调用主体＋应用＋发布版派生，避免不同应用或发布版冲撞领域幂等记录。

执行器增加同步授权有效性检查，在本地事务执行／回执重放前重检；异步资源授权期间撤权会阻止写入。写入提交后撤权导致结果不能交付时，返回 OUTCOME_UNKNOWN，要求保留原 key 核实；重新获得同一发布版授权后原 key 返回存储回执，不重复创建。读取继续拒绝撤权后的迟到结果。Agent 使用显式发现／调用命令，不另起任意后端 JS 注册系统。

发布流程复用既有不可变产物和验收记录：校验、安装、回滚均对照当前生产能力定义检查版本／摘要；过期绑定需更新声明并重新验收。回滚额外校验存储的 sourceHash，篡改产物不能替换当前发布版，也不反向修改业务数据。现有发布崩溃恢复、并发升级完整故障矩阵及浏览器安装／授权闭环仍未完成，不能据此称完整发布流程已验收。

验证：9 文件 93 项联合回归通过，覆盖实际 Agent Notes 创建／相同意图重放／撤权、应用和发布版 key 隔离、scope 收窄、执行前撤权、提交后未知结果恢复、过期契约拒绝及回滚产物篡改。根/Web/SDK 类型检查和变更生产文件 ESLint 通过；隔离 Gateway 认证路由冒烟通过，仍未执行待授权的浏览器安装或真实外部写入。全部 S0–S6 尚未完成。

2026-09-22 S5 Local App 只读能力绑定增量：新增严格 `ui.capabilities` 声明，固定 id/majorVersion/descriptorDigest，目前仅接受 Notes/Tasks get/list 四项宿主读取能力，拒绝通配符、重复绑定、写能力及自带执行代码。绑定进入既有 manifest/sourceHash 与权限增量检查，授权界面列出明确的工作区读取范围，不新增后端生成代码加载路径。

SDK `capability.describe/call` → 已登记 iframe 宿主 → 认证 Local App 能力 API → 共享 dispatcher 已接通。宿主固定 extension identity、认证命名空间和审阅摘要，不接受 iframe 自报身份／发布摘要；服务端要求已安装、启用、当前发布版已授权，并同时检查调用方领域 scopes、安装绑定及当前能力契约。读取返回前重新检查发布版和授权，撤权／切版后不交付迟到数据。新路由 lazy matcher 含正反例；协议不向 iframe 暴露 Gateway 凭证。

验证：13 文件 94 项联合回归通过，覆盖声明、权限增量、未安装／未授权／禁用、版本冲突、输入伪造、跨 scope、读取期间撤权、iframe 身份与宿主固定摘要；根/Web/SDK 类型检查、Web 构建通过。隔离真实 Gateway 新路径验证无认证 401、非法摘要 400、未安装应用 403（GET/POST），未将其记为真实安装后正向端到端通过。生产 src/Web 文件 ESLint 无错误，package 文件未匹配现有 ESLint 配置，依类型检查和测试验证。未运行真实账号或外部写入，也未越过待确认的浏览器安装步骤。

剩余：Local App 写绑定／Agent 侧扩展贡献、能力契约变更的发布验收、实例生命周期及完整安装／撤权／升级／回滚浏览器闭环；通用审批绑定和其他 S0–S6 收尾仍未完成。本增量不是完整 S5 完成声明。

2026-09-22 S5 授权边界前置修复：移除扩展消息路由对 `source=null` 和自报 extensionId 的信任，仅由已登记 iframe 的实际窗口确定身份；卸载、权限重新登记或退出登录后的迟到响应被丢弃。授权弹窗展示服务端权限，而不是父组件的可能过时列表；确认必须携带刚审阅的 manifestDigest，接口拒绝缺失或过期摘要。Local App 已安装版本的授权摘要纳入 sourceHash，UI-only 更新不能沿用旧 release 授权。普通扩展继续使用既有 manifest 授权模型，不声称其 Node 代码受沙箱隔离。

新增 iframe 身份 6 项、授权宿主 3 项测试；最终 MCP/Local App/扩展联合 7 文件 41 项通过。真实隔离 Gateway 验证授权接口缺摘要 400、旧摘要 409、匹配摘要成功；完整构建在本次授权修改前通过，授权修改后根/Web 类型检查及 Web 构建通过。新增宿主测试位于 Web tsconfig 排除目录，直接执行其 ESLint 被项目配置拒绝；未称测试文件 lint 通过，生产文件单独检查。浏览器隔离 Local App 新源码自动验收通过，停在 Add to sidebar 安装前，待用户确认安装／运行本地生成的测试应用后继续真实 iframe 宿主握手验证。该项不同于仍独立待授权的第三方真实账号写入验收；Local App SDK 能力包等其余本地阶段依然未完成。

2026-09-22 S4 结果卡与审批自审增量：ProductDeliveryEnvelope 增加有界资源表格与建议编辑预览；Notes/Tasks/Projects/Automations/Scenes/LocalApps 列表及 Notes preview_edit 进入生产工具调用链。纯文本渲染，不增加应用编辑或审批按钮；同轮多结果按工具调用 ID 去重并保留多张卡片，渠道保留文本及内部深链。修正笔记和项目卡片 revision 来源。旧浏览器审批卡片改为先读取服务端状态，响应以服务端决定为准；过期／消费／拒绝不能显示成已批准，重复提交和退出登录后的迟到响应被阻断。这不是通用 operation 审批绑定完成声明。

S5 MCP 增量：新增显式 `xopc mcp capabilities --allow-capability <ids...>` stdio HTTP 代理，仅开放白名单与当前 Gateway HTTP 授权目录交集，每次调用重新检查目录并由 Gateway 再鉴权；传入精确 majorVersion/digest，写入强制稳定幂等键，未知结果不自动重试，不代用户批准。复用现有凭证配置，不自动安装或修改 MCP 配置；审计仍是 HTTP surface。保留现有 channel bridge 源码，不恢复旧 channel 命令。HTTP 客户端拒绝重定向、30 秒超时并保留安全的结构化错误码。

验证：联合 17 文件 140 项通过；MCP SDK 内存传输覆盖白名单、撤权、契约变化、缺失幂等键、伪造身份字段、领域冲突及未知写结果。实际 stdio CLI → 隔离认证 Gateway 验证目录白名单、本地笔记写入与同 key 重放、拒绝未授权能力；未使用真实账号或外部写入。根类型检查、Web 构建与相关 ESLint 通过。Local App capability contributions/SDK 授权闭环、通用审批绑定、完整 S4 浏览器模型交互及 S6 发布门禁仍未完成，不能标记整体完成。

2026-09-22 S4 多页面采集增量：Task、Project、Scene（含 task-follow-up）和 Local App 详情使用共享显式引用按钮，经 typed `xopc.context.resolve` 获取已校验正文、版本和截断标识，再创建普通新对话。编辑未保存／操作进行中禁用采集；异步期间切页、切身份、资源版本变化及卸载会使旧请求失效；重复点击不重复创建对话。修复任务解析器错误读取旧 description/goal 字段，改为当前 body/contract.objective；场景预览标题使用目标而非 UUID。

Discussions 保持纪要／逐字稿与用户笔记的独立存储，会议区域新增显式引用按钮：附带当前纪要或已加载的筛选逐字稿，保留观察到的纪要／转写版本，作为 user-supplied 文本，不冒充持久笔记正文。忽略项按当前显示状态处理，不采集录音、隐藏逐字稿页或 iframe 内容；超过 16K 明确拒绝并提示缩小范围。复用普通笔记资源授权，不新增绕过领域权限的讨论读取接口。

验证：8 文件 61 项上下文联合回归通过，新增会议过滤／分页／纠正文案／空内容／超限测试与按钮测试组合 15 项通过（有重叠，不相加）；根类型检查、Web 构建通过。真实隔离 Gateway 冒烟增加任务、项目、Local App 上下文解析；浏览器验证以上页面及 Scene 采集进入普通新对话、项目和任务正文预览及移除。场景使用隔离数据库 needs_setup 样例，未配置模型或执行场景；没有把场景创建／执行记为浏览器验收通过。会议采集尚无完整浏览器样例验收。S4 结构化结果／受控导航及 S0／S2／S3／S5／S6 剩余项仍在推进，真实外部写入仍单独待授权。

2026-09-22 S4 页面采集 UI 增量：笔记详情增加「引用到新对话」，先完成已有自动保存，再固定返回的正文与 revision；只采集编辑区域内的选区。创建普通新对话而非绑定笔记的专用对话，因此移除页面上下文后不会通过笔记绑定再次隐式注入。聊天输入框接入可展开的纯文本预览、版本展示与移除；按 Gateway、认证命名空间、会话及浏览器文档隔离，仅保存在内存。快照传入实际 MessageSender，收到接受回执才移除，提交失败保留；迟到响应不能移除后续快照。带页面上下文时不走排队追问、打断或历史替换路径，不静默丢弃上下文。

自审修复笔记离开页面触发自动保存导致旧 revision 立即过期的问题；保存失败保留待保存内容，异步期间切换页面／身份不跳转，发现新增编辑时停止采集并提示重试。沿用 ui-ux-pro-max 的可访问交互要求，使用原生展开控件、可见焦点和现有语义色。

验证：6 文件 39 项回归通过，包含预览／移除、纯文本转义、草稿保留、身份与会话隔离、接受／拒绝及后端权限检查；Web 类型检查、相关 ESLint 与构建通过（保留既有构建警告）。隔离本地 Gateway 浏览器验证笔记采集进入新对话、展开正文和版本、移除卡片。测试环境无模型配置，浏览器未执行发送；发送行为由自动化测试覆盖，不称为真实模型端到端验收。当前页面入口仅覆盖 Notes，Task／Project／Scene／LocalApp 的页面采集入口及 S4 其余项仍待接入；刷新不恢复内存快照。真实外部写入验收仍独立待授权。

2026-09-22 S4 输入框接受语义修复：继续接入时发现项目 composer 丢弃 onSend 的异步结果，导致请求未被服务器接受即清空草稿。新增独立 input acceptance 通知，在真实 202 回执解析后触发；上层返回接受结果，不再把整轮流式生成结束当作输入接受。项目 composer 透传结果，拒绝／提交异常保留草稿；后续生成错误不撤销已经接受的提交。发送前复制草稿，迟到接受回调仅清空仍与所提交文字／附件／引用一致的草稿，保留用户等待期间的新修改。沿用既有错误反馈与 commitAcceptedSend，不增加全局当前页面状态。

验证：5 个文件 42 项测试通过，覆盖项目首轮创建、已有会话延迟接受／拒绝、流式终态、草稿修改保护及正文重试；Web 类型检查、相关 ESLint 和 diff 检查通过。此轮未新增页面采集、预览／移除 UI，也未进行浏览器视觉验收，S4 和整体剩余事项仍未完成。真实账号验收继续独立待授权，未执行真实外部写入。

2026-09-22 S4 Web 发送器增量：MessageSender 接受显式 appContext，发送前使用共享严格 schema 解析／复制，纳入 submission fingerprint 与固定请求正文。附件和 Note 引用也在等待端点连接前复制，避免等待期间被后续编辑覆盖。自动重试保持相同正文和标识；手动重试同快照复用标识，改变快照则生成新标识。明确拒绝并发 send 和带页面快照的历史 turn replacement；失败恢复 idle，迟到的已取消响应不继续处理。

本增量发送器／指纹 2 文件 23 项测试通过；Web 类型检查通过，相关 ESLint 自审发现两处不必要断言后已修复。尚未把 appContext 从页面／composer 传入生产发送调用点，没有新增可见采集、预览、移除 UI，不将可选发送参数当作前端端到端完成；跨刷新完整请求恢复及剩余阶段仍待推进。未执行真实账号写入。

2026-09-22 S4 后端提交接入增量（目录仍为 94 项）：新输入 HTTP 入口接收显式 appContext，使用认证中间件的 principal 解析，不接收客户端自报授权。经服务端解析后的快照进入既有 contextSnapshots；同键重试复用原正文，同时检查原授权和当前请求权限。修改／移除同键快照、替换调用主体均拒绝。执行前重新检查资源可读性、设备撤销／scope 收缩、浏览器会话及认证配置；资源正文更新不替换已接受的快照。授权修订使用进程密钥 HMAC，不存储原始凭据或可猜测的凭据裸 hash；进程重启后旧授权保守失效，需要重新捕获并使用新提交标识。此边界尚不提供跨重启自动续期授权。

自审修复：执行前检查抛异常时输入落为 failed，并继续后续队列，不遗留 running 阻塞；明确拒绝落为 cancelled。编辑排队文本／Note、Task 引用不再丢弃独立捕获的页面／浏览器快照。非法 envelope 返回 400、明确权限拒绝 403、上下文冲突 409、内部失败 503，内部失败保留同请求重试语义。编辑历史 turn 暂不支持新 appContext，明确返回 400，不静默丢弃字段。

验证：10 个文件 39 项测试通过，根类型检查、相关 ESLint、diff 检查通过；完整 Node／声明／Web 构建通过，保留既有 chunk／动态 import／插件耗时警告，最后错误映射调整另经类型检查和测试。既有隔离认证 Gateway 的 94 项目录／跨入口回执／实时事件冒烟通过。新增输入链路由真实 Hono handler、授权 dispatcher fixture 和 SQLite 队列分层测试覆盖，尚未声称真实运行 Gateway + 浏览器 + 模型端到端通过。未调用真实外部服务、未部署、未迁移个人数据库。页面采集、可见选区预览／移除、前端发送指纹调用点、Discussion、导航／renderer 及其余阶段仍未完成。

2026-09-22 S4 快照存储基础增量（目录仍为 94 项）：新增服务端 resolved context 到 AgentSourceContext 的转换，逐项核对解析结果与原引用的种类／ID／版本，复制原 envelope，并用内容摘要标识快照。模型边界明确区分已保存资源与未保存选区，不从页面内容推导写入授权；JSON 引用转义阻止资源正文伪装成外层 prompt 标签。快照复用现有 session input 的 contextSnapshots 存储，不增加第二套上下文表；会话重试指纹支持 envelope，并保持无页面上下文的已有提交指纹不变。

自审修复：submit／replace 在首次异步等待前复制输入，避免等待会话锁或查询时被调用方改写；替换上一轮先完成上下文校验，再执行清理，失效上下文不会先清理原会话。7 个文件 24 项测试通过，覆盖异步等待期间修改、保存／执行原内容、SQLite 重开后 envelope 保留、缺失／错配资源、选区信任边界、重试指纹和替换失败保护。根类型检查、相关 src ESLint 与 diff 检查通过；gateway-contract 文件不在根 ESLint 配置范围内，不能声称已由该命令 lint。

此转换器目前只有测试调用，页面采集 provider、HTTP 提交接入、执行前权限复核、客户端指纹调用点和可见上下文交互仍未串通，不将存储基础或隔离测试记作生产端到端能力。S4 及 S0／S2／S3／S5／S6 剩余项仍需推进；真实账号验收继续单独列为待授权，未执行真实外部写入。

S4 纯协议增量：目录 94 项（不含 Scene 为 65 项），新增 xopc.context.resolve。共享 AppContextEnvelope 包含 client/tab、sequence、显式资源 revision 和未保存选区；最多 20 引用、16K 选区、64 KiB UTF-8，拒绝重复资源和越限，不静默截断输入。服务端逐项经过原读取 capability 授权，不因 resolve 权限而提升资源 scope／委托范围；核对 Note／Task／Project／Scene 的版本，LocalApp 使用源码 hash。返回有界摘要并标注截断；不返回 LocalApp 预览令牌等完整 DTO。选区明确标记 user-supplied，不作为数据库事实或授权。

本增量协议／授权测试 2 文件 11 项、Agent／上下文组合 2 文件 24 项、根类型检查和相关 ESLint 通过；xopc_use context/resolve 使用相同解析和资源授权。真实隔离 Gateway 94 项目录及指定版本笔记上下文解析冒烟通过；最终完整 Node／声明／Web 构建通过，保留既有构建警告。该能力只解析调用方明确提交的不可变快照，没有建立共享“当前页面”，也未接入页面 provider、输入持久化／指纹、Discussions、导航或 renderer；因此 S4 仍未完成，不能把 stateless fixture 的 tab 测试说成浏览器多 tab 验收。

最新增量：目录 93 项（不含 Scene 为 64 项）。LocalApps record_acceptance 已统一 HTTP／Agent／dispatcher；验收记录、operation 回执和验收事件同事务，提交后发布，发布失败可在重开数据库后重放原键补发。移除按内容合并不同验收意图的分支；同键重放保持原记录，新键保留一次新的验收记录。源码 hash 变化拒绝新提交；必需检查不可全部跳过却报告通过。真实 Gateway 冒烟以明确失败的 fixture 检查验证跨入口回执，不冒充浏览器验收。

自查修复：LocalApps 后台恢复事件沿用原 Gateway 通知路径，不能被通用 outbox 误投递为 Task／自动化触发。Composio successful=false 的响应保留原始证据并转 unknown，不假定远端未生效。Notes 本地预览／Automation 本地模拟的 POST 路由按真实只读语义授权，不与 dispatcher 权限冲突。

该增量 LocalApp 18 项通过，包含事务故障、源码冲突、必需检查、提交后发布失败与数据库重开恢复；Task／Scene 事件回归通过，lazy matcher 最终 28 项通过；最新 Composio／LocalApp／外部操作组合 3 文件 65 项通过，scope 7 项通过。93 项真实隔离 Gateway 冒烟通过。完整构建、根／Web 类型检查及相关 lint 已通过（最后的 Composio 失败响应和 scope 小幅调整另有测试／类型验证）。未部署、未改个人数据库、未进行真实外部写入。

2026-09-22：真实第三方写入仅作为独立的待授权验收项，不再阻塞本地开发、fixture 故障注入或其他阶段；未执行该项时不宣称真实 provider 协议验收通过。

本轮目录增至 92 项：Notes preview_edit 按源码核查为纯本地建议生成，并不调用模型（纠正下方历史归类），统一 HTTP／Agent 读取入口。Automations simulate／draft／repair_draft 统一 HTTP／Agent 与 dispatcher；模拟不执行自动化，后两者调用模型但不安装／应用草稿，使用 external-write/manual 持久回执。同一意图可跨入口重放，未知结果不重新生成。Web API 发送幂等键并允许调用方保留原键重试，尚不声称跨刷新 UI 草稿意图恢复完成。

Composio 写入复用现有审批和 capability_operations：绑定完整 action 契约（不含缓存时间）、主体、Agent、会话／目标、账号及具体连接；在外部会话建立后、发送前再次授权并消费审批。成功回执重放不重复发送；并发返回进行中；不明结果保持 unknown。契约更新、换连接、撤权不能复用旧审批或结果。未增加第二套审批表，也未执行真实第三方写入。

本轮已通过：Composio／外部恢复专项 3 文件 57 项；领域／能力专项 6 文件 70 项；扩大回归 12 文件 201 项；根类型检查和相关 ESLint。真实隔离 Gateway 的 92 项目录、原与共享模拟／笔记预览、草稿非法输入、缺失修复对象及既有重放／实时同步冒烟通过。整体仍有 S0 全入口、S2 完整审批／provider 协议、S3 剩余领域、S4–S6 未完成，不能由本轮验证推断整体完成。

外部 CLI 写入增量：复用 capability_operations 和原 connector_approvals／connector_cli_executions，不新建审批系统。一次审批固定一个操作身份；无审批策略的写入按 conversation/toolCall 身份区分意图，不按参数去重。审批摘要绑定完整 action 契约、adapter／binary 版本、账号／连接、主体／Agent／会话和目标范围；重放前仍检查当前权限。成功后的相同审批重放返回持久结果，不再次消费审批或启动进程。未知结果与非零退出均保守处理，不声称远端未写入；仅未启动／明确启动失败可记为未执行。读操作保留原路径。

CLI 审批、并发领取、数据库重开、权限收回、同 revision 的契约变化、新意图及未知结果保护已覆盖，CLI 全目录／连接恢复／审批／外部操作联合 11 文件 82 项通过。该验证只启动本机 fixture 进程，没有执行真实第三方写入；真实 provider 幂等／回执恢复门禁仍需用户明确指定测试平台、账号及对象范围。Composio 等其他外部适配器和通用审批接入尚未全部完成。

当前累计验证分组：场景／Host／能力／迁移／LocalApp／前端缓存 29 文件 316 项通过；Notes／Projects／Tasks／Automations／路由等 35 文件 313 项通过；LocalApp 后续 17 项通过；真实隔离 Gateway 的 88 项目录及 Scene 资源事件冒烟通过。最终完整构建（Node、声明、Web）、根／Web 类型检查、相关 ESLint 和 diff 检查通过，保留既有 chunk 大小／动态导入／插件耗时警告。LocalApp 旧 index.js 运行时入口兼容函数与分支已删除，旧草稿只报验证失败，不静默改写用户文件。

实时同步增量：v199 为 Scene 聚合维护独立资源 revision（不冒充 activation 编辑版本），领域表变更与既有 domain_outbox 原子记录，覆盖配置、资料、调度、工作项、运行、成果、反馈、偏好和跟进状态。租约心跳不产生刷新事件；能力调用关联 operationId，后台变更无需经过 HTTP 才能通知页面。打开／重开数据库均安装事务上下文 SQL 函数。Gateway 复用 resources:scenes，Web 在 Scene 专属 SWR provider 内订阅、批量失效并在重连／缺口后重新读取。编辑草稿保存原 revision；移除按 revision 重建表单的行为，避免实时更新丢失输入或静默覆盖。

Scene 事件回滚、单次重放、后台成果、心跳抑制和数据库重开 4 项通过；真实 Gateway 验证偏好事件仅一份并带 operationId；缓存 hook／领域 Host／事件／迁移联合 5 文件 54 项通过。最新 UI 类型检查和相关 ESLint 通过。尚未把实际浏览器交互及 S3 全领域迁移声明为完成。

LocalApp validate 经重新逐行核查是只读文件检查，没有验证状态写入；此前清单分类有误，现已纠正并接入共享读取能力，新增无文件／数据库变更断言。完整目录现为 88 项，Scene 未启用时为 59 项。验收记录 acceptance、安装等仍是写操作，尚未统一。其他剩余阶段不变。

Scene 后续增量：完整目录现为 87 项（未安装 Scene 域时仍为 58 项），Scene 共 18 个读取和 11 个写入。新增邮件账户／来源、结果／单条呈现／反馈／摘要、指标／诊断读取；start/configure/transition/check/notes/work_item/update_work_item/schedule/set_preferences/feedback/mark_read 的 HTTP 与 Agent 直接写入分支已移除，统一原领域逻辑、严格契约与 SQLite 回执。

异步就绪检查只在写事务之外预检；提交前重验授权、取消状态及可信 owner/workspace，状态切换由精确 revision 抵御预检期间变更。回执重放不再次预检或重新激活场景。业务写入和回执必须使用同一个数据库；偏好 patch 不注入未提供字段的默认值；可信场景归属纳入幂等摘要，切换工作区不能取回旧回执。HTTP 保留 needs_setup 的 422 投影。写入回执代表接受时结果，不代表检查任务／模型运行已经完成。

本增量 Scene 全目录、HTTP、dispatcher／事务联合回归 20 文件 226 项通过，类型检查与变更运行时代码 ESLint 通过。真实隔离 Gateway 已覆盖 85 项阶段的 Scene 偏好跨路由重放和精确版本冲突，随后启动／切换带来的 87 项阶段正在补充综合验收。完整构建在异步启动迁移前通过，最终改动仍需重跑。Scene 资源 outbox／Web 实时同步、mail_search 的外部读取与缓存副作用、source-provider／TaskFollowUp 专属入口仍未统一；不得据此将 S3 标为完成。

以下为同轮先前增量，目录数量以本节最新记录为准。

后续入口增量：完整服务目录增至 68 项（Scenes 未启用时为 58 项）。Notes 新增 project_summaries/history/snapshot；Task 新增 metrics，TaskRun 新增 feedback；LocalApps 新增 list/get；Settings open 统一到只返回相对导航建议的读取能力。Scenes 共享模板／激活／偏好契约已移到 gateway-contract，新增 templates/get_template/list/get/read_notes/list_runs/list_schedules/list_work_items/get_preferences/preflight，原 HTTP 与 Agent 对应直接分支已移除。保留 Scenes owner/workspace 查询隔离及原管理员 scope；LocalApp 详情含预览令牌，继续要求管理员，不扩大普通工作区读取权限。

TaskRun feedback 的记录、Task 版本和资源事件与回执同事务；重放不重复评价，输出失败全部回滚。TaskRun 原 REST scope 补为 tasks.read/write，与能力入口一致，相邻非目标路径仍按管理员处理。Web 反馈发送意图 key，不宣称跨刷新保存待重试请求。Settings 只生成目标 DTO，不授予配置权限、不强制客户端跳页；完整页面上下文与导航消费属于未完成 S4。

已完成验证：Notes 4 文件 36 项、Task／Agent 3 文件 53 项、事务能力 22 项、LocalApp／Agent／授权 3 文件 34 项、导航／scope 4 文件 31 项，Scene 首批跨入口真实认证 HTTP 和领域回归通过。真实隔离 Gateway 已覆盖 Notes 历史及严格时间戳、TaskRun 反馈回执和指标、LocalApp 读取、Settings 目标、启用 Scenes 后模板的跨入口结果一致；新增场景分页／偏好／预检仍纳入下一轮综合回归。完整构建已覆盖至 Settings 阶段，Scenes 新改动待重新完整构建。

新增[HTTP 入口核对清单](./agent-native-http-inventory.md)：160 条静态路由及两条动态 pin/unpin，逐项标记可见 capability 调用和待分类项。它不是全渠道完成声明；CLI、内部自动化／扩展入口和未分类副作用仍需继续核全。特别是 context-status GET 会构建理解，而 LocalApp validate 的 POST 只检查文件，不能仅按 HTTP 方法推断副作用。

Projects 创建／编辑／工作区解析增量：目录增至 50 项。原 HTTP 和 Agent 入口共用 create/update/resolve_workspace 能力；编辑要求精确 version，Web 编辑、重命名、归档／恢复携带观察到的版本。解析与可选会话绑定同事务，已有会话路由优先于输入提示，拒绝静默覆盖其他项目绑定。新会话通过 SQLite authoritative record 创建，不再写入空消息。

v198 project_workspace_creation 持久化目录创建意图。SQLite 提交后才创建目录；输出校验或外层事务失败不会遗留目录。失败后保留项目／回执和恢复任务，同键重试、重开数据库及后台 tick 可恢复；重绑／删除后不创建过期目录。路径规范化覆盖尚不存在目录的真实父路径，恢复时拒绝符号链接重定向。自动理解排队与项目同事务，提交后才调度；目录未恢复时不消耗模型尝试。Agent 工具链与 Gateway 均接入同一理解服务。

本增量定向回归 5 个文件 94 项通过，另有目录恢复与事务提交钩子测试通过；根／Web 类型检查、变更生产代码 ESLint、diff 检查通过。创建／编辑阶段完整构建通过（仍有既有 chunk／动态 import／插件耗时警告）；后续解析改动需纳入最终构建。真实隔离 Gateway 已验证 50 项目录、创建／编辑／解析在原 REST 与通用 invocation 间共享回执、过期编辑拒绝、资源事件不重复。未执行真实模型、第三方写入或个人数据库升级。

整体仍在实施：S0 全入口、S2 完整审批／真实外部恢复、S3 剩余领域及 S4–S6 门禁尚未全部通过。下面为前序增量，历史未完成描述以最新记录和迁移表为准。

Projects 删除增量：目录增至 47 项，xopc.projects.delete 统一原 DELETE 路由与新增 Agent delete 命令。删除要求原项目 version；执行环境保护下沉到领域服务，HTTP 保留 execution_environments_exist 错误投影。删除／关联清理／事件／回执同事务；Web 详情与侧栏提交观察到的版本和意图 key，稳定重试必须携带原版本。回执重放不再查询已删除项目，始终重新鉴权。工作区文件不删除。

后台理解任务沿用原外键级联删除语义（包括历史运行），不新建取消状态兼容表。删除前将该项目待执行／执行中的后台运行 ID 固定到 project.deleted outbox；提交后仅向匹配项目、匹配运行且记录已删除的内存执行器请求停止。后台恢复无法重排已删除记录，关机重排／分析返回也检查项目是否仍存在。executionStopConfirmed=false 明确不声称第三方模型已停止；其他项目和后续运行不会被旧删除事件误取消。

故障测试发现了外键级联删除理解任务记录的边界，已移除最初依赖保留取消状态行的实现，改用现有事件队列保存停止意图。主体 create/update/resolve_workspace 的目录副作用恢复与统一入口仍未完成；浏览器实际交互验收仍待执行。

本轮验证：7 个文件 113 项测试通过，覆盖事务回滚、执行环境阻止删除、工作区文件保留、精确停止 ID、关机／恢复不重排已删除运行，以及 Agent 预演和重放。根／Web 类型检查、变更代码 ESLint、完整构建通过（保留既有 chunk／动态 import／插件耗时警告）。真实隔离 Gateway 验证 47 项目录、原 DELETE 与通用 invocation 共用删除回执、删除后 GET 404、单次 deleted 事件。未调用真实外部模型，未部署或升级个人数据库。

Projects 置顶增量：目录增至 46 项，新增 xopc.projects.set_pinned。原 POST pin/unpin 路由与 Agent pin/unpin 命令共用同一能力，原直接服务写入分支已移除。项目原 version 必须精确匹配，变更／事件／回执同事务提交，仅提交后发布；旧回执重放不覆盖后续取消置顶状态，且每次重放仍重新鉴权。稳定重试 key 必须带原 expectedVersion；无 key 的旧 HTTP 请求仍表示新意图。

Web 项目列表、详情、侧栏的置顶操作均发送观察到的 version 和本次意图的 key；不再把服务端最新版本当作浏览器已经确认的版本。此处不声称浏览器具有跨刷新请求恢复机制。能力仅覆盖置顶状态，不涉及工作目录、项目理解任务或主体 create/update/delete 的恢复迁移。

本轮定向回归及路由映射 5 个文件 100 项通过，根／Web 类型检查、变更代码 ESLint、完整构建通过（保留既有 chunk／动态 import／插件耗时警告）。真实隔离 Gateway 验证原路由与通用 invocation 共享置顶回执、过期版本拒绝、取消置顶后重放旧置顶不改当前状态，且资源事件版本只递增一次。Projects 路由在 routes/index.ts 中直接注册，未增加 lazy bundle；浏览器实际交互验收仍待执行。未部署或升级个人数据库。

Projects 主体生命周期事件增量（能力目录仍为 45 项）：领域 create/update/delete 现在将主体／索引变更与持久资源事件放在同一 SQLite 事务；更新含 pin/unpin，删除事件使用原 version + 1，重复删除不重复发事件。Gateway 将 created/updated/deleted 映射到已授权的 resources:projects，沿用后台 outbox 恢复。目录创建仍在数据库事务之外；主体操作尚未接入 capability 幂等回执，不宣称文件副作用恢复已经完成。

本轮自审修复：更新不存在的项目先拒绝，避免先创建工作目录；项目删除不删除工作区文件。详情重新读取遇到 404 时清除已失效的对象；实时刷新按字段合并设置草稿，只同步未编辑字段，避免将未编辑的旧表单值自动保存回服务端，同时保留用户编辑。主体写操作尚未统一版本校验，同字段并发写冲突的完整防护仍待迁移验收。

本轮已验证 10 个文件 113 项测试（含活动日志回归）、根／Web 类型检查、变更代码 ESLint、完整构建和真实隔离 Gateway：主体创建／修改／删除产生版本 1/2/3 的对应事件，删除后读取 404；故障注入验证对象与索引／事件共同回滚，重开数据库可恢复发布。完整构建保留既有 chunk／动态 import／插件耗时警告；浏览器多窗口实际交互验收仍未执行。未部署或升级个人数据库。

以下是前序增量记录；历史“未完成”描述以本节最新增量和迁移表为准。

Projects 实时同步增量（目录仍为 45 项）：四个已迁移写能力的领域服务现在将变更与 project.changed outbox 同事务保存，里程碑增删改也递增父项目 version。operationId 关联回执；仅提交后发布，失败可由重放或既有后台 outbox drain 恢复。返回的 project 是变更后版本，不是修改前快照。

Gateway 按 workspace.read 授权发布 resources:projects 的 resource.changed；Web 按目录授权订阅，复用有界 eventId 去重，重连／缺口触发重新读取。项目列表和详情原本使用本地 state 而非 SWR，已补显式刷新监听、请求顺序／卸载保护；详情刷新不改设置草稿。当前只覆盖上述里程碑／进展写入，未声称项目主体创建／编辑／删除全部具备事件。

本增量 7 个文件 103 项回归通过，包含版本／事件／回执事务回滚、提交后发布失败、重复回执不重复事件、Web 缓存选择／去重、resource topic 权限。真实隔离 Gateway 验证项目事件关联 operationId、版本与 REST 当前数据一致，重复写请求只产生一次事件。根／Web 类型检查、变更代码 ESLint 和完整构建通过（保留既有 chunk／动态 import／插件耗时警告）；尚未执行浏览器双窗口或未保存草稿的交互验收，不能视为 S3/S4 全部验收。

最新增量（45 项目录）：Notes delete 已统一 HTTP／Agent。原 remoteVersion 精确校验、笔记／FTS／上下文／快照删除、默认分享撤销、文件清理任务和 resource.deleted 事件同库提交，提交后才删除媒体和分享快照文件。HTTP 的 revokeShares=false 明确保留已分享快照；Agent 默认改为与 HTTP 一致的撤销策略。显式重试 key 必须传原 expectedRevision，回执重放不重新查询已删除笔记。

v197 新增 note_deletion_cleanup，失败退避重试，初始化及既有后台 flush 恢复。清理限定受控 ID 和固定目录，不接受任意路径；新笔记／有效分享占用同 ID 时不删除文件。附件上传晚于删除完成时返回 null 并补排清理；追加附件读取保存后的最新状态，避免用上传前快照覆盖其他附件。未迁移个人数据库，未部署。

Notes 删除增量验证：7 个文件 89 项通过，覆盖事务回滚、分享撤销／明确保留、重启文件清理、路径校验及退避、晚到上传、精确版本与旧回执重放。类型检查、变更代码 ESLint、完整构建通过（既有 chunk／动态 import／插件耗时警告保留）。真实隔离 Gateway 验证 45 项目录、创建本地分享后删除撤销、删除回执重放、GET 404，以及 revision=3 且关联 operationId 的 deleted 实时事件。

最新增量（44 项目录）：TaskRun cancel 已统一 REST／Agent，精确版本、终态回执、领域事件与 operation 同事务；仅提交后唤醒事件派发。`executionStopConfirmed=false` 明确保留“不确认外部执行已停止”的边界，不按可复用 conversationId 盲目终止新任务。原重复取消分支已移除。

本增量 5 个文件 96 项回归通过，覆盖取消／项目写入回滚、跨入口回执重放、原版本拒绝、权限重验、同毫秒时间边界和新执行隔离。真实隔离 Gateway 验证 44 项目录、里程碑增删改、项目进展身份拒绝及 human executor TaskRun 取消重放；不调用实际 Agent 或第三方。完整构建通过，保留既有构建警告；未部署或升级个人数据库。

Projects create_milestone/update_milestone/delete_milestone/create_update 已统一 REST／Agent。里程碑修改／删除检查原 updatedAt，进展更新检查原项目 version；显式重试 key 必须携带原版本，无 key 的原 REST 请求仍表示新意图。进展 actor 来自可信调用上下文，不接受 HTTP 自报身份。里程碑版本同毫秒单调递增；进展创建直接返回本次插入对象，修复同毫秒查询“最新记录”可能取错的问题。项目文件目录创建、主体编辑／删除、工作区解析和资源实时事件仍未完成。

整体未完成：S0 全入口清单尚未核全；S2 通用审批与真实外部恢复验收未完成；S3 仍有多个领域未迁移；S4–S6 未完成。历史测试通过和目录操作数均不代表整体交付。

本次补齐 Automations `get_run/run_events/metrics/product_events`，目录增至 39 项。原 REST 四条读取路由、两个 Agent 工具均通过统一 dispatcher，独立 automation 工具的 list/history 也已移除直接服务查询。当前运行状态通过 get_run 获取，不把历史取消／排队回执冒充当前状态。

读取自审：产品事件查询拒绝只有 key 或只有 value 的不完整筛选，保留空字符串值，limit 使用共享整数范围校验。指标只描述当前服务实例的活跃运行数，不宣称分布式运行总数。运行及事件在自动化删除后仍可查询历史。新增测试覆盖缺失对象、鉴权先于读取、筛选边界和双 Agent 一致性。

本次验证：业务回归 4 个文件 73 项，以及 dispatcher／事务／Gateway 能力路由／lazy loading／scope 回归 5 个文件 47 项，共 120 项通过。根类型检查、变更代码 ESLint、diff whitespace 检查通过。真实隔离 Gateway 验证 39 项目录、原 REST 与通用 invocation 结果一致、错误筛选拒绝。测试没有调用真实模型或第三方写入。

完整构建通过，仍有既有大 chunk、无效动态 import 和插件耗时警告；未部署或发布。

以下增量日志中的“仍待迁移”描述记录的是当时状态；本节及迁移表为最新状态。

## 当前实现

S1 已迁移 `xopc.notes.get/list`、`xopc.tasks.get/list`：公共 Zod 契约 → dispatcher → 原领域服务。原 REST 与 xopc_use 仅做参数／结果投影；Web Task 详情使用同源 typed client。旧读取业务分支已删除。

操作目录使用 `/api/capabilities/operations`，不抢占既有 connectors 市场路由。目录不授予权限；HTTP 使用真实 Gateway principal，dispatcher 限定域 scope、surface、委托 allowlist、资源授权。个人 Gateway 的域 scope 当前覆盖整个域，并未凭空引入多租户 ACL。资源级委托由可信宿主回调收窄；输入不能自报身份或 surface。当前只读能力不提供审批或持久写入恢复。

S2 已完成本地事务子集：`xopc.tasks.create` 和 `xopc.tasks.command` 的 HTTP／Agent 入口使用同一能力定义。SQLite v192 新增 operation／invocation 记录；业务写入、结果校验、回执在同一事务提交。并发同 key 只执行一次，参数变化冲突，新 key 表达新意图；每次重放重新鉴权。Task 原有领域幂等键保留原语义，避免升级后历史重试创建重复 Task。领域 key 当前仍为全局键，不宣称支持多租户隔离。

只对同库同步写入采用此路径，不把文件或外部 I/O 塞进 SQLite 事务；不为同步写入引入无意义的租约和恢复线程。写后唤醒在提交后执行，响应丢失后可重放回执。旧暂停回执重放时校验 Task 版本，避免中断后续新执行。此处没有外部副作用恢复、通用审批或 Notes 文件恢复的完成声明。

## 迁移范围与归属

所有目标 ID 使用 `xopc.<领域>.<操作>`。表内逗号分隔项各对应独立操作；未迁移项不能通过新目录调用。

| 领域及当前代码 | 操作 | 性质／恢复边界 | 状态 |
| --- | --- | --- | --- |
| `src/notes/capabilities/read.ts` | get, list | 只读；workspace.read | 已迁移 |
| `src/tasks/capabilities/read.ts` | get, list | 只读；tasks.read | 已迁移 |
| `src/notes/capabilities/write.ts` | create, append, update, capture, restore | SQLite 事务、持久回执、附件清理队列 | 已迁移现有 HTTP／Agent 入口；capture/restore 仅 HTTP |
| `src/notes/capabilities/write.ts` | delete | 同库删除／分享撤销／清理意图／回执；提交后清理文件 | 已迁移 HTTP／Agent |
| `src/notes/capabilities/read.ts` → `src/notes/service.ts` | preview_edit | 纯本地只读建议，不调用模型，不修改笔记 | HTTP／Agent 已迁移 |
| `src/tasks/capabilities/write.ts` → `src/tasks/task-application-service.ts` | create, command | SQLite 事务＋domain_outbox＋持久结果回执；不绕过既有任务审批 | HTTP／Agent 已迁移；其他调用方仍待 S3 |
| `src/tasks/capabilities/{relations,management}.ts` | update_dependencies, add_context, remove_context, delete, update, reorder | SQLite 事务＋domain_outbox＋回执；上下文递增版本；删除须确认无活跃执行 | 已迁移现有 HTTP／Agent 入口；update/reorder 仅 HTTP |
| `src/projects/capabilities/read.ts` | list, get, list_milestones, list_updates | 只读；workspace.read | 已迁移 HTTP／Agent 查询；显示字段仍由 HTTP 投影 |
| `src/projects/capabilities/write.ts` | create_milestone, update_milestone, delete_milestone, create_update | SQLite 事务、精确版本、持久回执及资源 outbox | 已迁移 HTTP／Agent；资源实时同步已接入 |
| `src/projects/capabilities/write.ts` | set_pinned | 原项目 version 校验、事务回执与资源事件 | HTTP pin/unpin、Agent pin/unpin 已统一；Web 提交观察版本 |
| `src/projects/capabilities/write.ts` | delete | 版本、执行环境保护、级联删除和停止意图／回执同事务；提交后请求停止理解运行 | HTTP／Agent 已统一；不确认外部执行已停止 |
| `src/projects/capabilities/write.ts` | resolve_workspace, create, update | SQLite 回执；目录创建意图提交后恢复；理解任务提交后调度；编辑精确版本 | 已迁移 HTTP／Agent，主体资源事件已接入 |
| `src/automations/capabilities/read.ts` | list, get, history, get_run, run_events, metrics, product_events | 只读；automations.read | 已迁移 HTTP／Agent，保留通知／对话策略、运行诊断和历史查询 |
| `src/automations/capabilities/write.ts` | create, update, delete, set_enabled, run, rerun, cancel, read, read_all | SQLite 业务状态与回执同事务；提交后唤醒／取消；回执记录接受时状态 | 已迁移 HTTP 与双 Agent 工具；草稿等其他入口待迁移 |
| `src/automations/capabilities/drafts.ts` | simulate, draft, repair_draft | 模拟纯读取；生成调用模型，manual 恢复和持久回执，不应用草稿 | HTTP／xopc_use 已迁移；模型验证使用 fixture |
| `src/scenes/capabilities/read.ts` | templates, get_template, list, get, read_notes, list_runs, list_schedules, list_work_items, get_preferences, preflight | 管理员入口；owner/workspace 隔离；预检保留 account/provider 授权 | 已迁移 HTTP／Agent |
| `src/scenes/capabilities/read.ts` | mail_accounts, mail_sources, results, get_presentation, get_feedback, digest_results, metrics, diagnostics | 管理员、owner/workspace 隔离及领域可见性检查 | 已迁移 HTTP／Agent |
| `src/scenes/httpServices.ts` | mail_search、source-provider／TaskFollowUp 专属入口 | 外部读取、用量／缓存副作用及账户授权，不按纯读取处理 | 待迁移 |
| `src/scenes/capabilities/write.ts` | start, configure, transition, check, notes, work_item, update_work_item, schedule, set_preferences, feedback, mark_read | 精确版本、异步只读预检、业务／资源事件／回执同事务；check 仅排队；可信归属绑定 | HTTP／Agent 已迁移；资源实时事件与 Scene 缓存已接入，实际浏览器验收待完成 |
| `src/tasks/capabilities/read.ts`、`runs.ts` | tasks.metrics, task_runs.list/get/cancel/feedback | 读取；取消／反馈事务回执及事件 | 已迁移 HTTP／Agent；外部执行停止确认仍是独立缺口 |
| `src/local-apps/capabilities/read.ts` | list, get, validate | 管理员权限读取／文件检查，保留预览令牌权限边界 | 已迁移 HTTP／Agent |
| `src/local-apps/capabilities/write.ts` | record_acceptance | 当前源码 hash 校验；验收记录、回执和事件同事务 | HTTP／Agent 已迁移；不代表浏览器检查已经执行 |
| `src/local-apps/` | create, install, enable/disable, rollback, uninstall | 文件包构建／配置；绑定 release digest 和 grants | 待迁移 |
| `src/capabilities/runtime/settings.ts` | open | 返回相对导航建议，无配置读写或强制跳转 | 已统一 Agent／能力入口；S4 客户端上下文消费未完成 |

HTTP 专属操作分布在 `src/gateway/hono/routes/`、`src/automations/api/routes.ts` 及 Scene 领域路由：附件、同步、分享、会话、handoff 等尚未全部纳入账册逐项迁移，因此 S0 全入口清单验收尚未完成。快照恢复与 Task board position 已在上述增量中迁移。不得把 xopc_use 操作数当作全部业务覆盖。

## S1 自我 review 与修复

- Task 列表原 Agent 实现在前 200 条内筛选；统一为 SQL 筛选、稳定排序、offset 与全量 count。
- TaskRun 原契约把派发前暂停／取消误判为缺失快照；改为按已派发证据要求快照，继续拒绝真正派发后缺失快照的结果。
- 通用能力入口不额外要求 gateway.status/admin，避免已有 tasks.read/workspace.read 用户失去读取能力；实际操作始终由 dispatcher 检查。
- 返回的 descriptor 克隆隔离，注册时复制 scope/surface，避免外部修改集合绕过边界。
- 输出契约失败保持 INTERNAL，并保留内部 cause，不向 HTTP 暴露内部数据。
- 删除迁移后无用的旧读取实例、常量和 imports，不引入双路径回退。

已执行：根 typecheck、Web type-check、变更代码 ESLint、diff whitespace 检查通过；21 个测试文件共 148 个测试通过，包含超过 200 条 Task 的 SQL 筛选和计数。完整 `pnpm run build` 通过（Vite 有大 chunk／无效动态 import 警告）。`node --import tsx scripts/capabilities-gateway-smoke.mts` 已通过真实隔离 Gateway 的鉴权、lazy routing、新旧列表结果一致、过期契约、伪造身份拒绝、Task 创建跨入口重放和版本化命令重试。测试只创建并清理专用临时目录，不使用个人数据库。

## 后续实现与自我 review（同日增量）

- Notes create/update/append/capture/restore 已进入持久 operation 路径。HTTP 和已有 Agent 命令共享定义；snapshot restore 与 quick capture 仅按现有 HTTP 入口开放。保留快记历史稳定 ID，但移除重复创建逻辑和内存并发映射。
- Notes 的快照、版本、附件清理意图和 domain_outbox 与业务写入同库提交。附件只在提交后清理；启动及 Gateway 后台调度继续处理积压。故障测试验证回滚不误删附件、重启能补做清理。
- Update/restore 使用精确 revision。旧 HTTP 请求未传 key 时仍表示一次新意图；显式传 key 必须同时传原始 expectedRevision。Append 在事务内读取最新内容，可选 revision，并按原 key 重放，避免追加两次。
- 外部写入增加 running/succeeded/failed/unknown 状态、租约与 generation fencing、原始结果证据。Endpoint 非读取工具已接入 manual 恢复：断连或超时不盲目重发。provider-idempotent 恢复仅经确定性 fixture 验证，没有把设备自报幂等提示当成可靠保证，也没有宣称真实第三方验收通过。
- Task 专用 outbox dispatcher 已移到共享基础设施，无旧名转发层。Notes/Tasks 事件关联 operationId，经域 scope 控制的 resource topics 发送；Web 仅重新读取缓存，不把乱序事件写回资源。eventId 去重、重连重新读取与 gap 恢复已接入。
- TaskRun get/list 已统一契约与 dispatcher；现有 REST get/events、Agent get/list 使用共享路径。列表直接传数据库 limit，不再固定截断到 100 条。cancel 仍待迁移。

当前完整 HTTP 能力目录共 45 项，新增 Notes 删除，包含 Projects 四类读取及四类写入、Automations 七类读取及九类写入、Task 六类关系／管理写入和 TaskRun 取消。Projects 的 REST 和 Agent 查询已共用输入／结果契约，REST 继续做工作区显示与 operating view 投影，不复制查询逻辑；Projects 主体写入和文件工作区操作尚未迁移。Task 删除重放使用持久回执，删除事件携带最终 revision 与 operationId；回归覆盖活跃执行拒绝、删除后同 key 重放、上下文不存在时事务回滚。

Automations 取消／已读增量：`cancel/read/read_all` 已统一 HTTP、`xopc_use` 与独立 `automation` 工具。取消意图、事件和回执同事务提交，再按原 runId 发送停止信号。排队任务立即确认取消；running/cancelling 只返回请求已接受，不能以没有本地 controller 推断任务已停止。重复请求不追加取消事件，旧回执不影响新运行，重放保持原始接受时状态。单条已读保留首次时间；批量已读重试返回原 count，不误标后来结束的运行。原 REST 已读响应形状保留，取消响应新增 confirmed 字段；cancelled 表示请求接受，不等于停止确认。

本增量 4 个文件 70 项测试通过，覆盖真实本地执行器信号、提交后通知失败重试、输出校验失败完整回滚、权限重验、排队取消、新运行隔离、未来完成记录保护及双 Agent 回执一致性。根类型检查、变更 TypeScript ESLint、完整构建通过；保留既有 chunk 大小、无效动态导入和插件耗时警告。真实隔离 Gateway 验证 35 项目录与三个原 REST 路径。无真实模型／第三方执行，无个人数据库迁移或部署。独立运行查询／事件、草稿等未统一入口，以及其他领域和 S4–S6 仍待完成。

Automations 接入发现并清理共享契约中的旧 after_run phase/event，改为服务端实际使用的 completion_hook；补齐 conversationMode/notificationPolicy/completionWebhookUrl。Expo 创建请求和详情显示同步移除旧 afterRun 字段。Expo 类型检查与 7 项请求测试通过，未执行移动端发版或真机 UI 验收。

不同 scope/surface 只发现其授权子集。已运行根与 Web typecheck、变更代码 ESLint、完整构建、真实隔离 Gateway 冒烟；新增资源 topic 权限测试和 Web 事件去重测试通过。Notes 与 capability 相关 11 个文件 78 项测试通过，Projects／Agent／目录相关 3 个文件 47 项测试通过。真实 Gateway 新增验证了 Notes 跨入口创建／更新重放、过期版本拒绝及携带 operationId 的 WebSocket 事件；由此发现并修复了 pinned 默认值导致的跨入口摘要不一致。测试使用临时数据库，不触及个人数据。

以上增量覆盖此前表中对应条目；未列为已实现的领域和入口仍未迁移。

## 后续门禁

Automations 执行增量：`xopc.automations.run/rerun` 统一 REST、`xopc_use` 与独立 `automation` 工具。一次新意图接受当时的配置，排队 run、配置快照、归属、事件及 operation 回执同事务提交；提交后才领取并启动。重跑使用新接受的配置，同时保留原触发事件。回执是接受排队时的结果，不冒充当前运行状态；重放只唤醒同一个 run，已启动／结束／取消的 run 不会再执行。

v196 保存内部完整执行配置快照；一次性迁移为既有 queued run 固化原动作／触发器快照和升级时其余配置。迁移仅移除顶层缺失可选字段，保留工作流任意输入中的显式 null，已补迁移回归。恢复不再用可变配置，也不从最近 500 条历史中筛选未结束任务。领取 queued → running 在独立事务中先提交，再调用执行器；领取后崩溃会记录失败／未确认终止，不自动重试外部作用。本地 fixture 验证了双 dispatcher 只领取一次，不声称外部系统 exactly-once。

执行自审：历史清理不删除 queued/running/cancelling 记录，并同步清理结束记录的内部配置快照；排队任务可以在启动前取消，原回执重放不会重新启动。调度刷新移到结束事务提交之后；定时器排除已被排队／运行任务占用的自动化，避免到期时间引起重复空唤醒。80 项联合回归、类型检查、变更代码 ESLint、完整构建通过；构建保留既有 chunk 大小、无效动态导入和插件耗时警告。测试覆盖排队回滚、启动通知失败、快照／安全策略保持、重启恢复、领取后中断、历史超过 500 条、启动前取消、定时器、触发事件和双 Agent 重放。真实 Gateway 在隔离数据库中用 suggest_only 工作流验证执行／重跑两条 REST 链路，只生成建议，不调用实际工作流或外部模型。独立 cancel/read 入口及其他领域、S4–S6 仍未完成。

Automations 删除增量：`xopc.automations.delete` 统一 REST、`xopc_use` 与独立 `automation` 工具。删除、对应运行的持久取消意图、取消事件和 operation 回执同事务提交，提交后才按记录的 runId 发送取消信号及刷新调度。回执只表示删除／取消请求提交，不宣称外部执行已停止；取消确认仍由执行器记录。缺失对象返回 removed=false；显式重试 key 必须带原 revision，null 只表示期望对象不存在。

删除自审修复：旧运行结束按 runId 校验归属，不能覆盖同 ID 重建对象的运行状态；取消后不启动 completion webhook。v195 新增只保存已删除 ID 与版本下限的表，防止同一毫秒重建时版本复用；版本记录与删除同事务回滚，重启仍保持隔离。未清理历史 run 和 operation 审计记录，未迁移个人数据库。

删除回归：4 个文件 64 项业务测试、15 项迁移测试通过，类型检查、变更代码 ESLint 与完整构建通过；构建仍有既有 chunk 大小、动态导入和插件耗时警告。真实隔离 Gateway 验证 30 项目录、删除回执重放、同 ID 重建保护及过期删除拒绝。测试覆盖真实本地执行器取消、旧运行晚到完成、提交后通知失败重试、取消意图回滚、重启不执行已删除排队任务、双 Agent 工具共享删除回执及鉴权重验。独立 run/rerun/cancel/read 等入口仍待迁移。

Automations 创建／编辑增量：`xopc.automations.create/update` 统一 REST、`xopc_use` 与独立 `automation` 工具。创建不再覆盖已存在的 ID；编辑使用精确 revision，业务写入与回执同事务，调度器只在提交后刷新。可选字符串契约改为可描述的类型输入，同时保留空白／null 归一化。公共写入拒绝调度器持有的 `state`，内部可信服务仍可维护运行状态；`xopc_use` dry run 与真实执行共享写入校验。

自审修复：原 UpdateAutomationSchema 的默认值在 partial 后仍会注入会话模式、通知策略和 state，导致只改名称也可能重置策略，空补丁被误接受。更新契约现仅保留明确提交的字段；测试覆盖策略与运行诊断保留。项目校验在统一事务内完成，Agent 保留项目展示投影，错误返回共享 code。

创建／编辑回归：5 个文件 61 项通过，根类型检查、变更代码 ESLint 与完整构建通过；构建保留现有 chunk 大小、无效动态导入和插件耗时警告。真实隔离 Gateway 验证 29 项目录、REST 创建与通用能力入口共享回执、编辑重放、过期 revision／缺失 revision 拒绝、运行状态伪造拒绝。删除、手动执行、重跑、取消和运行已读等操作尚未迁移，本增量不代表整个 Automations 阶段完成。

Automations 启停增量：`xopc.automations.set_enabled` 统一原 REST pause/resume、`xopc_use` 和独立 `automation` 工具。暂停只停止未来调度，不取消正在执行的 run；原有取消机制未改动。精确 `updatedAtMs` 检查、业务写入与 operation 回执同事务完成，调度器仅在提交后刷新；重放只刷新当前数据库对应的调度，不回写旧结果。修复同毫秒修改以及失败自动禁用时版本号不单调的问题。显式重试 key 必须携带原始 revision，未提供 key 的既有调用表示新意图。拒绝 null revision，避免退化为隐式读取最新版本。

启停阶段回归：4 个文件 51 项通过，覆盖服务端调度原有测试、双 Agent 工具共享回执、删除后回放、权限重验、旧版本冲突、输出验证失败回滚、提交后唤醒失败重试和单毫秒版本递增。真实隔离 Gateway 冒烟验证 REST 启停及重放不会覆盖后续更新。根类型检查、变更代码 ESLint 和完整构建通过，构建仍有 chunk 大小、无效动态导入及插件耗时警告；最终工具适配调整后新增 7 项测试再次通过。创建／编辑已由上述增量迁移；删除、执行等入口仍未迁移，不能将当前增量等同于整个 Automations 阶段完成。

最新联合回归：23 个文件 219 项通过；之后新增外部租约、Automation 契约／读取验证独立通过。根／Web／Expo 类型检查通过，Expo 7 项请求测试通过。完整构建通过，保留现有 chunk 大小与动态 import 警告。真实 Gateway 冒烟在与重型构建和测试并行时出现过一次启动超时；待构建结束后独立重跑通过，未把该超时计为功能验收通过。

仍需开发：Notes 文件／分享／会话等剩余操作、TaskRun 执行停止确认及 handoff 等入口、Projects 主体写入／工作区及对应资源事件、Automations 草稿／修复草稿／模拟及其他渠道入口核全、Scenes、Local Apps；S4 页面上下文与结构化结果、S5 Local App 能力贡献和 MCP、S6 升级回退及性能验收均未完成。当前没有部署或移动端发布。

S2–S6 尚未完成。真实外部写入验收需要用户指定已授权的测试连接器、账号及测试对象；未得到授权前只能进行本地和 fixture 验证。不得把 mock 结果写成真实第三方验收通过。
