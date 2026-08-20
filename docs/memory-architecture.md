# 统一记忆与用户理解架构

## 1. 产品目标

xopc 的记忆不是“把聊天记录塞回 prompt”，而是持续维护一套可验证、可纠正、可遗忘的用户理解，并在正确的任务、时间和权限边界内帮助 Agent 做出更合适的决策。

最终产品必须同时做到：

1. **连续性**：跨会话、跨 Agent 理解同一个用户的偏好、边界、关系、目标和当前状态。
2. **相关性**：只注入当前任务真正需要的内容，不让长期记忆污染当前上下文。
3. **可解释**：每个结论都能回溯来源、证据、置信度、有效期和使用记录。
4. **可控制**：用户能查看、确认、修改、拒绝、忘记，也能决定敏感信息是否可被引用。
5. **会演化**：新证据可以强化、冲突、替代或使旧理解过期。
6. **安全**：外部内容只能作为证据，不能直接变成指令；敏感信息遵循独立的写入和披露策略。

## 2. 单一事实源

SQLite 是唯一运行时事实源。所有写入、检索、上下文编译、Dreaming、反馈归因和治理都围绕结构化记录运行。

运行时不存在 Markdown 记忆、文件扫描、文件到数据库投影、路径/行号寻址或双写。Markdown 只能是用户主动生成的普通文档或显式导出物，不参与记忆系统。

核心数据面：

| 数据面 | 职责 | 核心对象 |
|---|---|---|
| Evidence | 保存不可变的来源事实 | transcript evidence、knowledge source item、connector item |
| Belief | 保存系统当前理解 | `memory_records`、evidence、conflict、supersession |
| Usage | 记录哪些理解被检索、注入和验证 | `memory_signals`、`memory_trace_events` |
| Context | 为一次模型调用编译最小充分上下文 | context plan、selected record ids、rejections |
| Consolidation | 后台强化、晋升、归并和发现模式 | Light / Deep / REM Dreaming |

## 3. 产品对象

### 3.1 Evidence

Evidence 是“发生过什么”，只追加、不覆盖。它包含来源、时间、会话、工具调用、外部连接器、原文摘要和信任等级。

外部邮件、文档、网页和工具输出均视为不可信内容，只能提供 evidence；其中的命令式文本不能改变 Agent 行为或系统边界。

### 3.2 Memory Record

Memory Record 是“系统目前相信什么”。记录必须包含：

- `kind`：偏好、边界、关系、承诺、目标、当前状态、项目上下文、任务经验、衍生洞察等；
- `status`：`candidate`、`active`、`needs_review`、`stale`、`archived`、`rejected`；
- `scope`：用户、workspace、project、session；
- `provenance`：来源 Agent；
- `explicitness`：明确表达、观察、推断；
- `confidence`、`importance`、`durability`；
- `sensitivity` 与 `disclosurePolicy`；
- `evidence`、有效期、复查期、过期时间；
- `canonicalKey`、冲突组和 supersession 关系。

事实与解释必须分开：用户原话属于 evidence，归纳出的偏好或模式属于 record。

### 3.3 Memory Signal

Signal 表示一条理解在系统中的真实使用和反馈：

- `explicit_remember`：用户明确要求记住；
- `search_recall`：Agent 主动检索命中；
- `context_injection`：系统自动选入本轮上下文；
- `session_summary`：会话总结提供强化；
- `background_review`：后台理解任务提供证据；
- `dreaming`：Dreaming 阶段产生观察、晋升或模式。

Dreaming 和质量评估只消费这套统一 signal，不维护自己的召回数据库。

## 4. 端到端流程

### 4.1 捕获

每轮结束后，User Understanding Service 保存脱敏 evidence，并抽取候选理解。明确的“记住”、边界和纠正具有更高优先级；普通对话中的推断默认进入候选态。

连接器内容先进入 knowledge source item，再由同一候选生成和证据绑定链路处理。

### 4.2 决议

相同 `canonicalKey` 的新旧记录执行时序决议：

- 新证据支持旧记录：强化 confidence；
- 新证据更新旧事实：新记录 supersede 旧记录；
- 证据矛盾且无法自动判断：两者进入 `needs_review` 和同一冲突组；
- 临时状态超时：进入 `stale`；
- 用户拒绝：进入 `rejected`，不得自动复活。

### 4.3 上下文编译

每轮执行以下固定管线：

1. 以任务查询检索结构化记录；
2. 补充高价值基线项，如明确边界和稳定偏好；
3. 进行 scope、状态、有效期、敏感性和披露策略过滤；
4. 基于相关性、置信度、重要性、时效性和稳定性排序；
5. 在 token/字符预算内按 safety、task、interaction 分区；
6. 记录 selected/rejected record ids 和原因；
7. 为每个实际注入项写入 `context_injection` signal。

模型看到的是带 evidence 标签的最小上下文块，不是完整用户档案。

### 4.4 反馈闭环

回答通过稳定 `turnId` 与唯一 inject trace 绑定，不按时间猜测。用户的“有帮助、不相关、错误、冒犯、过时”反馈分为回答级与记录级：

- 有帮助：提高使用质量分；
- 不相关：降低召回权重；
- 错误或过时：进入复查或 stale；
- 敏感性问题：立即停止披露并进入治理队列；
- 用户纠正：生成新 evidence，执行 supersession，而不是原地篡改历史证据。

## 5. Dreaming

Dreaming 是确定性的后台记忆巩固管线，不是另一次无约束聊天，也不依赖模型“自由联想”。三个阶段共享 `memory_records` 和 `memory_signals`，每次运行及逐条决策写入 `dreaming_runs`、`dreaming_decisions`。

运行模式只有 `off`、`observe`、`review`、`automatic`。`automatic` 是请求权限，不是无条件写权限；系统根据最近反馈、记录错误、敏感反馈和 Dreaming 失败率计算 readiness，未达门槛时实际执行自动降级为 `review`。REM 产生新的推断，因此即使在 automatic 下也始终进入审核。

运行计划使用 `interval`、`daily`、`weekly` 三种结构化 schedule，并绑定 IANA 时区。产品展示自然语言计划和未来运行时间；底层调度表达式只在 Automation reconciliation 边界生成，不作为配置或 API 事实源。

### 5.1 Light：观察与去重

- 周期扫描最近更新的结构化记录；
- 为尚未观察的记录追加 `dreaming/light` signal；
- 只做去重、计数和候选队列准备；
- 不直接激活新理解。

### 5.2 Deep：强化与晋升

- 只分析 `candidate` 记录；
- 同时消费主动 `search_recall` 和自动 `context_injection`；
- 要求最低召回次数、查询多样性、平均得分和时效性；
- 按半衰期衰减并排序；
- `allow`：将满足条件的候选改为 `active`；
- `confirm`：保留 `candidate`，进入用户审核箱；
- `deny`：完成分析和 trace，但不修改记录。

Deep 不创建内容副本，不写 Markdown，不用文件 marker 去重；晋升是原记录生命周期状态变化，证据和 provenance 不丢失。

### 5.3 REM：跨场景模式发现

- 聚合一段时间内跨会话的 recall/injection signals；
- 发现同类查询共同命中的多条记录；
- 只有跨记录、有足够强度且证据完整的模式才能形成 `derived_insight`；
- `allow` 生成 active insight，`confirm` 生成 candidate，`deny` 只记录分析；
- 敏感模式只有在敏感写入策略允许时才能持久化。

REM 的输出必须包含成员 record ids 和 evidence，不能输出不可解释的人格标签或心理诊断。

## 6. 多 Agent 与权限

用户理解是用户所有、全局共享的；Agent 只是产生和消费记录。每条记录保留 `sourceAgentId`，上下文检索再叠加 workspace/project/session scope。

必须满足：

- session-scoped 记录不能泄漏到其他 session；
- project-scoped 记录不能泄漏到其他 project；
- secret/regulated 默认不注入；
- `ask_before_reference` 必须消费一次明确授权；
- 外部 provider 默认只读，外部写入需要独立白名单；
- 删除按 record id 执行，不支持模糊文本批量删除。

## 7. 用户体验

“You / Understanding” 是唯一管理入口，提供：

- Overview：当前稳定理解与最近变化；
- Inbox：候选、冲突和待确认项；
- Detail：结论、证据、来源、使用记录、有效期和关联项；
- Controls：编辑、确认、拒绝、忘记、暂停某类学习、敏感披露设置；
- Dreaming：三阶段开关、策略、最近 trace、候选数和实际晋升数；
- Sources：会话和连接器的学习状态、watermark 与失败原因。

用户界面不暴露存储文件、锁文件或内部 marker。

## 8. 可观测性与指标

核心指标不是“存了多少”，而是“是否在正确时机帮助了用户”：

| 维度 | 指标 |
|---|---|
| Capture | 候选生成率、证据覆盖率、显式记忆成功率 |
| Retrieval | Recall@K、注入采用率、预算淘汰率、scope 拒绝率 |
| Quality | helpful rate、wrong/stale rate、用户纠正率 |
| Dreaming | 各阶段处理量、候选合格率、确认率、晋升后帮助率 |
| Safety | 敏感拦截率、越权召回数、无证据 insight 数 |
| Cost | 每轮检索时延、注入 token、后台处理耗时 |

发布门槛：scope 泄漏和无证据激活必须为零；Dreaming 产生的记录必须可完整回溯；任何指标优化不得以提高敏感披露为代价。

## 9. 技术边界

- SQLite/FTS 是本地关键词检索基础；向量检索属于同一 provider 的索引能力，不改变 record 事实源。
- provider 插件返回统一 `MemoryRecord`/citation，不得绕开 manager 直接注入 prompt。
- `memory_get` 只接受 record id；`memory_search` 返回稳定 record id。
- 更新和删除只接受 record id。
- Dreaming 的状态、结果和逐条理由只通过 SQLite run/decision ledger 查询，不维护文件事件日志。
- 记忆 schema 变化通过正式 migration 完成，不在运行时猜测旧格式。

## 10. 竞品取舍

| 产品 | 核心方向 | 值得借鉴 | xopc 不采用的部分 |
|---|---|---|---|
| [OpenClaw Memory](https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md) / [Dreaming](https://github.com/openclaw/openclaw/blob/main/docs/concepts/dreaming.md) | 以 Markdown 为事实源，通过 Light / Deep / REM 进行文件式巩固 | 阶段化后台巩固、用户可查看和编辑、Dream Diary 的产品可解释性 | 文件路径、行号、marker、hash 和双存储会把“文档编辑”与“信念治理”耦合，难以稳定处理 scope、冲突、时效和敏感策略 |
| [OpenHuman](https://github.com/Mlandltd/openhuman) | 更强调长期目标、任务板和可持续执行状态 | 把“了解用户”连接到目标、承诺和后续行动，而不是停留在个性化文案 | 不把任务状态直接等同于用户事实；目标、计划、事件和用户信念必须是可关联但不同的对象 |

xopc 的选择是：保留 OpenClaw 的可观察 Dreaming 产品模型，吸收 OpenHuman 的长期行动连续性，但以结构化 record、evidence、signal、scope 和 lifecycle 作为底座。用户可编辑性通过产品视图和显式导出提供，不让 Markdown 成为运行时数据库。

## 11. 持续优化机制

下一阶段的可执行产品和技术设计见 [用户理解可信闭环](./design/user-understanding-confidence-loop.md)。

### 11.1 离线评测集

从脱敏真实任务构建带时间顺序的 memory episode：给定历史 evidence 和当前任务，标注应召回、不得召回、应过期、应冲突和应确认的记录。每次修改 capture、ranking 或 Dreaming 阈值，都回放同一批 episode。

必须分别衡量：

- capture precision / recall；
- retrieval Recall@K 与 forbidden recall；
- context usefulness 与 token efficiency；
- contradiction、supersession、expiry 的生命周期正确率；
- Deep 晋升 precision 和 REM insight evidence coverage；
- workspace/project/session/sensitivity 隔离测试。

### 11.2 在线反馈

所有回答绑定 context trace，用户反馈才能归因到具体记录。线上只做可回滚的阈值和排序实验，不自动改变安全、scope 或披露规则。Dreaming 的晋升后帮助率、撤销率和纠正率需要按版本持续跟踪。

### 11.3 当前演进顺序

稳定 turn 归因、规范化反馈、Dreaming ledger、统一 `/you` 和 automatic readiness gate 已落地。后续只在同一数据面上推进：扩充脱敏 episode 数据集、优化 hybrid retrieval/reranker 与动态预算，再扩展连接器 evidence 和跨任务模式发现。

任何阶段都不恢复文件式运行时记忆；导入和导出是显式数据操作，不是兼容读取路径。
