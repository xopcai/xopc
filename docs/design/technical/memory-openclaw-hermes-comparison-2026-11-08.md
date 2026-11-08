# OpenClaw、Hermes Agent 与 xopc 记忆模块及用户交互调研

调研日期：2026-11-08。xopc 基线：`30c2dd50c755ea767439c191b7453937d72b3519`，调研开始时工作树干净。外部资料以官方在线文档及两家 GitHub `main` 为准；不将 `main` 中的能力等同于每个已发布版本。

证据范围：阅读官方文档、OpenClaw memory-core 的注册、整理、评分测试及 Web 组件，Hermes 的 memory tool、session search、memory manager 和 background review 源码，以及 xopc 当前实现。未部署两家产品、未做界面实机验收、未跑同模型召回基准。下文的体验评价是基于交互实现的判断，不是用户研究或性能排名。代码图谱 MCP 本次不可用，因此回退到源码检索。

## 1. 主要判断

三者已有不同的产品重心：

| 产品 | 主要设计取向 | 最值得借鉴之处 | 需要承担的代价 |
| --- | --- | --- | --- |
| OpenClaw | 文件可读、来源分层、分级召回、后台晋升 | 普通问题走便宜路径；复杂往事问题升级深度召回；整理结果可审查 | 文件、索引、来源记录和后台任务之间的一致性复杂 |
| Hermes Agent | 小而常驻的核心记忆、原始会话回查、经验沉淀成技能 | 用户能在聊天里管理写入；把“学会怎么做”作为成长的一部分 | 核心容量有限；原生快照依赖会话边界；插件会引入另一套数据生命周期 |
| xopc | 结构化用户理解、工作知识、时效与权限、逐轮上下文 | 事实与推断、用户偏好与项目事实、来源资料与派生记忆分开治理 | 自动学习与用户感知脱节；作用范围和后台状态尚未充分转成自然交互 |

**建议保留 xopc 的 SQLite、类型化记忆和来源政策，优先补足明确写入回执、聊天内纠错与遗忘、按需深度召回、经验到技能的闭环。** 是否增加 embedding 应由同义改写、多跳和中文场景评测决定。

不能只依据“有无向量数据库”“有无 MEMORY.md”判断记忆优劣。至少需要同时检查：是否正确保存、是否在正确场景取回、是否引用了真实证据、是否能纠错和遗忘，以及用户能否理解当前状态。

## 2. OpenClaw：已经是分层记忆系统

### 2.1 写入与存储

默认 memory-core 保留 Markdown 工作区记忆；核心文件与日常情景记录分层，索引承载检索及来源元数据。`USER.md` 承担稳定个人偏好，`MEMORY.md` 承担长期事实；日记和会话材料用于按需查找与整理。不能把所有文件都理解为每轮完整加载。[官方概览](https://docs.openclaw.ai/concepts/memory)

来源可信度决定内容能否进入自动上下文及长期核心，而不只是检索分数。普通工作观察、压缩前 flush、会话摄取汇入情景层，再经过整理；核心上下文在长会话中可以按预算刷新。[记忆架构](https://docs.openclaw.ai/concepts/memory-architecture)

这意味着它保留了“可用编辑器查看”的优点，但事实身份、血缘和删除已经不能只靠 Markdown 文件本身表达。

### 2.2 召回分级

当前架构把低成本规则召回和需要模型的深度召回分开。后者默认在用户询问往事、且普通路径没有强可信命中时升级；并非每条消息都先跑一次记忆 Agent。[Active Memory](https://docs.openclaw.ai/concepts/active-memory)

搜索支持词法、向量及混合检索，并提供时间衰减、结果多样化和多种 embedding 接入。没有必要将某个外部记忆插件的能力算成默认 memory-core；索引历史会话、跨会话召回也有独立开关和可见性约束。[搜索文档](https://docs.openclaw.ai/concepts/memory-search)

对 xopc 的启发：只补向量检索不能解决“上个月先决定 A，后来为什么改成 B”。这类问题通常还需要时间过滤、追读原始消息、识别修订关系以及答案证据检查。

### 2.3 后台整理不等于自由改写

Dreaming 分阶段积累、反思和晋升候选；是否进入长期核心受到规则门槛及模型整理共同约束，整理有预算、回退和历史记录。[Dreaming](https://docs.openclaw.ai/concepts/dreaming)

源码提供了比“让模型重写 MEMORY.md”更准确的解释：模型返回候选的 `added / merged / superseded` 操作及精确旧条目，宿主生成最终条目，验证替换对象并处理血缘。模型不直接返回任意替换正文。这种受约束操作协议值得借鉴。[整理源码](https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/src/dreaming-consolidation.ts)

评分测试还专门区分跨日、多次使用的材料、低质量填充材料和一次高分材料，说明“有用过多次”是晋升信号，而不是单纯信任写入时的自评分。[评分测试](https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/src/short-term-promotion-scoring.test.ts)

### 2.4 用户操作与遗忘

OpenClaw 已有记忆 Web 界面。检索组件展示片段、路径、行号、分数与检索模式，并能展开受支持的工作区文件；总览展示索引健康和整理调度。其信息结构更偏向解释“系统正在如何工作”。[检索组件](https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/browser/memories.tsx)、[状态总览](https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/browser/overview.tsx)

个人偏好还可以通过 Profile 的 Personal instructions 编辑；多用户 Gateway 对个人文件归属有单独规则。因此，不能将 OpenClaw 描述为只能手动编辑共享 USER.md。[用户模型](https://docs.openclaw.ai/concepts/user-model)

CLI 包含状态、检索、重建和遗忘入口。`reset` 清理派生索引与删除原始记忆不是同一操作。[CLI 文档](https://docs.openclaw.ai/cli/memory)

`memory forget` 可按已跟踪来源清理派生内容，并记录被遗忘会话，阻止再次摄取。它明确不承诺清除原会话、所有自由编辑文本及外部副本；手工编辑和缺失血缘的历史内容需要另行处理。[来源与删除](https://docs.openclaw.ai/concepts/memory-provenance)

## 3. Hermes Agent：核心笔记、会话检索与技能学习

### 3.1 原生核心很小，并且是冻结快照

原生 MEMORY 和 USER 默认上限分别为 2,200、1,375 字符，可配置；它们在会话开始时形成系统提示快照。中途写入落盘，但不会修改这份快照，以保持前缀缓存。容量超限会要求合并或删减；并非存储无限增长后全部常驻。[原生记忆](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)

工具支持新增、局部 patch、删除及批量操作。当前 patch 保留条目其他部分，旧 replace 已不再作为正常写入动作，以减少模型把局部替换误当整条替换的损失。[memory 工具](https://github.com/NousResearch/hermes-agent/blob/main/tools/memory_tool.py)

设计取舍很清楚：常驻信息少、成本可控，但正在运行的其他会话不会立即获得新快照。产品需要解释何时生效，尤其是长期不重置的聊天渠道。xopc 逐轮准备动态上下文更适合持续个人助手，但也需要关注动态内容放置对缓存的影响。

### 3.2 历史检索补足容量

`session_search` 支持发现、围绕消息滚动、读取会话和浏览历史，直接访问 SQLite 会话消息，不需要先调用 LLM 总结才能取回原话。源码还处理会话谱系、时间范围和排除已检查会话。[会话检索源码](https://github.com/NousResearch/hermes-agent/blob/main/tools/session_search_tool.py)

这里要纠正一个容易照搬文档造成的误解：直接返回原始消息不代表所有调用都无限、完整输出。源码存在有界窗口及内容截断标识。真正有价值的是可继续追读证据，而不是一次性把历史塞进上下文。

### 3.3 学习的产物包括技能

Hermes 的 background review 是独立的回顾执行路径，能从协作中更新记忆和技能，并有取消、预算、模型路由及配置控制。同模型路径考虑缓存复用，异模型路径可以构造较紧凑的输入。[后台回顾源码](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py)

技能系统把可复用做法写成按需加载的技能，并提供学习、管理和审查入口。其优势是把“以后怎么做”与“曾经发生过什么”分成不同产物。[技能系统](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)

对 xopc 而言，保存 `task_lesson` 已经能记录经验；还应评估如何将反复成功的经验形成可审查、有版本、能验证结果的执行方法。已有技能市场与技能加载能力，不等于已经实现了这条自动学习闭环。

### 3.4 面向用户的学习感

Hermes 提供 `/memory pending / approve / reject` 等聊天命令；可选择写入审批。还提供记忆更新通知及 `/journey` 学习时间线，后者关联记忆与技能，并有编辑删除入口。[原生记忆交互](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)

这些交互的价值在于及时告诉用户“刚才学到了什么、是否已经生效、能在哪里修正”。时间线的视觉表现不等于更高召回率；xopc 值得借鉴的是可解释的变化记录，不必先实现星图。

### 3.5 外部 provider 是加法

外部 provider 可以补充预取、同步、用户建模和语义检索；当前用户配置选择一个外部 provider，原生文件记忆仍可与之并用。具体 provider 的安装方式和生命周期有差异，不能把 Honcho、Mem0 或 Hindsight 的效果归到原生核心。[Provider 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers)

统一 manager 处理 provider 生命周期、后台同步和失败隔离等宿主问题。[MemoryManager](https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_manager.py)

## 4. xopc 当前实际能力

### 4.1 数据结构与治理是已有优势

当前实现将用户断言、目标、关注时间窗、协作规则和工作知识分开。资料原文索引与派生工作记忆也分开，后者具有决定、经验、承诺、问题等类型。SQLite 维护证据、修订、授权及生命周期。

这让“我喜欢简短回答”“这个项目采用 PostgreSQL”“本周优先发布”“外发前询问我”不必挤进同一段无类型文本。优点是可以分别纠错、过期、限定范围和判断是否能影响行动。代价是提取与检索必须正确分类。

证据：[用户模型领域](../../../src/user-model/domain.ts)、[知识领域](../../../src/knowledge-memory/domain.ts)、[知识使用政策](../../../src/knowledge-memory/usage-policy.ts)、[语义提取协议](../../../src/user-model/capture/semantic.ts)。

### 4.2 自动学习是持久化后台流水线

当前 `MemoryLearningService` 每 10 秒调度，恢复近期符合条件的会话任务，消费任务回执和来源学习。默认按轮数阈值或空闲时间安排学习，不要求用户开启新会话才保存。任务有游标、租约、重试和每日批次预算；结果应用与游标推进在事务内完成。

这比只在上下文压缩时记忆更适合长会话。不过“异步最终写入”与用户说“记住这个”期待的即时承诺之间仍有差距。

证据：[后台服务](../../../src/memory-learning/service.ts)、[任务仓库](../../../src/memory-learning/repository.ts)、[提取执行器](../../../src/user-model/capture/executor.ts)。

### 4.3 默认策略必须以当前源码为准

| 项目 | 当前默认值或约束 |
| --- | --- |
| 普通用户模型写入 | `allow`；配置枚举为 `deny / allow` |
| 工作记忆写入 | `allow`；配置枚举为 `deny / allow` |
| 敏感用户信息 | `confirm`，另可选 deny / allow |
| 上下文预算 | 最多 20 条断言、12 条知识、6,000 字符；实际还受任务分配约束 |
| 默认内容来源 | memory、local_import；connector 不在默认集合 |
| 外部记忆写入 | 默认关闭 |

旧 `memory-architecture.md` 中普通记忆默认 `confirm` 的描述已过时。本次没有修改旧文档，以免将历史说明与当前调研混为一次实现变更。

证据：[当前配置](../../../src/user-context/config.ts)。敏感知识写入还有独立拒绝逻辑，不能把敏感用户模型的配置泛化为所有记忆类型均可保存。

### 4.4 检索与逐轮上下文

本地知识检索使用 FTS5/BM25，中文通过单字及相邻双字扩展词项，并支持来源分块检索。它不是默认语义向量检索；英文同义词、中文转述与跨表述追问可能出现召回缺口。

逐轮 coordinator 结合当前输入、近期短查询及任务上下文，选择画像、规则、目标、优先级和知识，按字符预算裁剪，并记录实际纳入项。遇到“继续、上次、进度”等表达会补近期连续工作线索。用户反馈也已进入部分排序评分，不能说 xopc 完全没有反馈闭环。

证据：[文本检索](../../../src/knowledge-memory/search-text.ts)、[知识仓库](../../../src/knowledge-memory/repository.ts)、[coordinator](../../../src/agent/context/coordinator.ts)、[选择与渲染](../../../src/agent/context/execution-context.ts)、[上下文审计](../../../src/agent/context/audit.ts)。

与 OpenClaw 的专门深度召回相比，目前看到的这条自动路径主要是确定性选取与连续性补充。模型仍可主动调用历史检索；不应把它描述为完全不能多跳。但本次未发现同等清晰的“缺少可信命中 → 有预算追读历史 → 验证答案证据”的自动升级协议。

### 4.5 纠错、遗忘和读取边界

用户纠错可保留修订，并通过权威性和证据校验防止后续自动提取覆盖。删除有 suppression；遗忘历史还有单独投影逻辑，避免自动召回重新暴露被忘内容。原始对话和文件保留，因此“删除记忆”不等于从所有介质抹除原始信息。

共享个人上下文的读取与写入边界要求主人身份的 direct 会话及 enabled 模式；临时模式关闭该共享访问。这个条件不能直接解释为临时会话不落盘，需要对 transcript 保留另行说明。

证据：[删除抑制](../../../src/user-context/memory-suppression.ts)、[遗忘投影](../../../src/memory-learning/forgotten-history.ts)、[知识删除提取](../../../src/memory-learning/forget-capture.ts)、[统一访问边界](../../../src/user-context/access-policy.ts)。

### 4.6 已有用户界面比“管理表”更丰富

“我的”包含总览、对我的了解、工作记忆、数据与隐私。已有基础资料编辑、当前关注、明确表达与协作学习区分、来源依据、知识搜索、修改删除、长期记忆开关、敏感策略及导入导出入口。

学习状态显示来源数量、生效记忆和待处理／失败任务；聊天检索步骤有记忆专用文案；回答菜单可查看本次个人上下文并提交反馈。应在现有入口上改进发现性，而不是另造一个重复中心。

证据：[主页面](../../../web/src/features/user-model/user-model-page.tsx)、[画像依据](../../../web/src/features/user-model/understanding-row.tsx)、[学习状态](../../../web/src/features/user-model/learning-status.tsx)、[聊天记忆活动](../../../web/src/features/chat/messages/memory-activity.ts)、[回答解释与反馈](../../../web/src/features/chat/messages/message-bubble.tsx)。

## 5. 用户任务对比与具体差距

| 用户任务 | OpenClaw 当前机制 | Hermes 当前机制 | xopc 当前机制与差距 |
| --- | --- | --- | --- |
| “记住我偏好中文” | 核心文件／个人指令可持久化并刷新 | memory 写入；下一会话快照读取 | 后台语义捕获；个人主助手缺少直接写入工具及即时持久化回执 |
| “你为什么这样建议？” | 搜索命中带来源；有状态与记忆查看界面 | 核心笔记可查看，历史可追读 | 已有逐轮引用审计与回答解释，但入口位于回答菜单，值得提高发现性 |
| “这只是本项目约定” | 项目标注影响检索及自动注入 | profile 隔离；上下文文件／技能／provider 承载进一步边界 | 后端支持五种 scope，用户编辑入口只开放一部分 |
| “不对，改成 B” | 核心文件编辑及受约束 supersession | patch，必要时待审 | 管理页可纠错，普通工具也有 update；个人主助手工具表没有直接 update |
| “忘掉这条” | 可按来源清理并阻止再摄取，但覆盖有边界 | 原生条目可删；原始会话及 provider 数据应分别管理 | 有 suppression 和遗忘投影；需要给用户一张范围清楚的删除回执 |
| “上次为什么改方案？” | 可以升级深度召回 | 历史发现和前后滚动 | 有历史工具和工作决策；专门自动深度召回协议仍需补强 |
| “你最近学会了什么？” | 整理状态、Dreams 等记录 | 通知、journey、技能学习 | 管理页能看条目和任务统计；缺少贯穿事实、纠错及技能变化的统一变化视图 |

外部列依据前述各家文档和源码；本表是交互机制比较，不代表已做实机操作对比。

### 5.1 即时承诺与异步学习之间的断层

`PERSONAL_MAIN_TOOL_IDS` 只有 `user_context_read / knowledge_read` 等读取能力，没有直接记忆写入或更新。通用工具工厂存在 `user_context_update / knowledge_write`，但工具存在不代表个人主聊天可用。

个人提示词要求只有成功写入后才能宣称已保存，这是正确约束；用户明确要求记住或忘记时，仍需要提供一条能返回真实状态的最短操作路径。

建议显式请求进入同步事务或具有持久化请求 ID 的执行路径，返回 `saved / pending / denied / failed`、记忆 ID、适用范围及生效时间。自然表达中的隐式学习继续走后台。成功文案只根据提交回执生成，不能根据模型意图生成。

证据：[个人工具表](../../../src/personal-agent/policy.ts)、[提示词](../../../src/personal-agent/prompts.ts)、[通用更新工具](../../../src/agent/tools/user-context-tool.ts)。

### 5.2 范围在存储层充分，在操作层不足

后端支持 global、agent、workspace、project、session。画像 `MemoryActions` 只呈现 global／agent；agent 选项在原 scope 非 agent 时回落到 `main`，并没有从组件参数接收当前 Agent。应验证非 main 会话中“仅当前助手”的实际指向。工作记忆行没有传 `onScopeChange`，所以不能套用画像行已有的范围编辑能力。

建议从真实会话上下文填充当前 Agent／项目／工作区，对用户只展示当前可用范围；缺少项目上下文时不猜 ID。

证据：[范围操作组件](../../../web/src/features/user-model/memory-actions.tsx)、[KnowledgeRow](../../../web/src/features/user-model/user-model-page.tsx)。这是明确的代码检查点，尚未作为实机复现缺陷验证。

### 5.3 已有反馈还不能准确解释原因

回答点赞／点踩会写到 execution-context feedback，点踩也有原因及修复提示。但回答质量差可能来自检索遗漏、过时记忆、推断错误、推理错误或工具失败。若直接降低本轮全部记忆的分数，容易误伤正确事实。

建议在已有反馈上增加“这条记忆不对／已过期／这次不相关”与具体 item 的绑定；让纠错修改事实，让相关性反馈影响排序，让一般回答反馈保留为回答评价。

### 5.4 来源显示与因果解释需要区分

上下文审计可以证明某条记忆被注入，不能证明模型实际依赖了它。用户文案应使用“本次提供给助手的参考”，避免声称已经精确追踪模型内部因果。进一步可将每条已选记忆连接到来源、当前版本及纠错入口。

## 6. 建议迭代顺序

| 优先级 | 工作 | 验收结果 |
| --- | --- | --- |
| P0 | 显式记住／纠错／忘记的持久化回执 | 新会话能够读到已保存版本；失败不报成功；重复请求幂等 |
| P0 | 在现有聊天与管理页贯通来源、修正、范围和删除 | 同一条记忆在聊天、页面及其他渠道操作语义一致；非 main Agent 指向正确 |
| P0 | 展示学习状态与实际生效状态 | 排队、待审、被拒、已保存但当前不可用能区分；状态来自任务与提交记录 |
| P1 | 按需深度召回 | 普通问题不额外跑模型；历史问题低命中时按时间、项目追读，给出可核对原话 |
| P1 | 近期变化记录 | 用户可看新增、修正、过期、遗忘及来源变化，并能从变化记录继续管理 |
| P1 | 经验到技能的受控闭环 | 从重复验证成功的方法生成候选；有 diff、范围、确认、验证与回退 |
| P2 | 语义／混合检索实验 | 在固定权限、延迟、注入预算下改善中文转述及跨表述召回，收益足以覆盖成本 |

近期不建议更换主存储或引入独立图数据库。先复用现有事实槽、修订、证据链接和执行上下文审计；它们已能表达大量记忆关系。图结构或 embedding 是否必要，应由未解决的任务证明。

## 7. 建议用户流程

用户：“记住：这个项目的发布只能走 release 分支。”

系统应返回可验证的保存状态，并显示“仅当前项目”。规则是否能够约束执行还应明确：普通项目事实不能自动变成行动授权或代码级权限规则。

用户：“以后只在这个项目这样做。”

在同一条记忆上修改 scope，保留修订及证据；不再新建一条模糊的全局偏好。

用户：“不是 release，改成 stable。”

显示旧值到新值的修正结果。后续后台重读旧对话不能覆盖用户的新版本。

用户：“忘了这条。”

删除回执解释“不再用于后续自动记忆，原始聊天保留”，并区分受控派生条目、已有会话上下文与外部副本。对仍在运行的上下文应单独验证何时停止使用，不能仅凭数据库删除就承诺即时全局遗忘。

用户：“上个月为什么没有走 release？”

先判断是否明确授权重读相关原始历史，再查修订和原话。答不出来时报告证据不足，避免利用已遗忘的残留内容填补答案。

以上为建议目标流程，不是声明现有三家均完整支持。

## 8. 用相同任务验证，不给架构打主观总分

| 测试组 | 示例 | 核心指标 |
| --- | --- | --- |
| 显式持久化 | 保存偏好后立即换会话，再重启 | 成功回执真实性、落盘成功率、生效延迟 |
| 隐式学习 | 多轮重复纠正风格；助手单独猜测用户职业 | 正确捕获率、错误画像率、错误权威升级率 |
| 转述检索 | 原文“禁止直接改生产”，查询“线上操作限制” | Recall@k、证据支持率、误召回 |
| 时间与修订 | 周一 A、周四改 B，分别问当时和现在 | 时间归属正确率、旧值误用率 |
| 多跳历史 | 决定、原因、后续修订分布在三个会话 | 完成答案正确率、原话可核验率 |
| 作用范围 | 同名项目、不同 Agent、群聊和临时模式 | 越界率、错误共享率 |
| 遗忘耐久性 | 删除后重建索引、补处理、重启再问 | 重新生成率、答案泄漏率；区分原始历史获授权重读 |
| 程序性学习 | 某种操作失败后被纠正，再运行类似任务 | 旧错复发率、新技能成功率及回退成功率 |
| 成本与交互 | 相同模型、等价预算和相同输入 | p50/p95 延迟、总 token、后台费用、用户完成管理操作步数 |

外部 provider 作为单独实验组；原生默认与增强配置分开报告。固定会话边界、持久化等待条件、语料规模及隐私政策，避免把 Hermes 的快照机制或 xopc 的后台等待误判成偶发遗忘。各家工具返回的分数不可直接横向比较。

本次交付是源码与文档调研；未修改运行逻辑、未启动真实学习任务、未读取或修改本机个人记忆数据库。下一步应先验收 P0 流程，再决定召回算法实验的规模。
