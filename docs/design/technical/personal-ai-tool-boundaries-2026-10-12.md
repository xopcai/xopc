# Personal AI 工具边界优化技术方案

日期：2026-10-12。状态：P0/P1 已实施；P2 保持评估状态。

## 实施记录

- 新增 `src/agent/embedded/execution-tool-policy.ts`，根据持久会话身份和 Request execution 关系计算执行范围，工厂、turn runner 和 pooled runner 共同使用。没有新增用户配置层或数据库表。
- Personal 主会话保留 12 个窄工具；Request worker 保留现有五个业务入口。两种受限执行都跳过外部工具物化，不安装原生 MCP、Codemode 或 ToolSearch，并向 pi 传入显式工具清单，排除默认内置工具。
- fingerprint 包含执行策略和 revision；旧 discovery 不恢复受限工具。临时 side chat 显式携带主机父会话身份，按父会话范围执行；普通 specialist 不继承主会话限制。
- Personal 历史读取增加 8,000 字符的总序列化预算；按时间序列查询、裁剪并以实际返回记录生成下一页游标。笔记/项目/自动化保留 JSON 对象字段和真实分页位置，不再返回序列化 JSON 字符串的切片。跨会话摘录也限制总序列化长度，文件与附件的截断提示计入输出预算。
- 更新主工具描述、幂等升级的路由规则及中英文用户文档。Attention 高级命令、连接恢复与结果交付沿用现有协议。
- 验证：相关回归 36 个文件、270 项通过，包括生产 pooled runner、真实普通 Agent stdio/HTTP MCP、QuickJS、Request 生命周期、临时子会话、读取预算和 SQLite 分页；类型检查、修改文件 ESLint、公开文档检查、Node 构建通过。
- 全量单元回归：636 个文件、4,029 项通过。随后补充本地搜索词长度限制，并对相关搜索、记忆与工厂测试进行复验。

以下章节保留目标设计与后续评估要求。实际内部策略采用 boolean 开关，尚未实现 `local` discovery 或 `local_reads` Codemode。尚未测量真实模型路由准确率、提示 token 和 P50/P95；不据此开放 P2 能力。

## 1. 目标与决策

Personal AI 主会话负责直接回答、轻量本地读取、用户偏好、任务协调和持续跟进。连接应用通过持久请求执行，复杂工作通过 specialist Task 执行。优化目标是稳定选择正确入口、减少工具往返和重复执行，不以减少工具数量作为验收指标。

采用以下决策：

1. 保留现有 12 个主工具，不合并数据来源、权限和生命周期不同的操作。
2. 第一阶段关闭 Personal 主会话的原生 MCP、额外外部工具、Codemode 和动态发现入口；普通 Agent 的原生 pi 能力继续按现有配置工作。
3. 连接应用继续使用 `personal_capability` → `personal_request`；普通委派继续使用 `personal_task`。Request 复用 Task 执行，但保留自身连接等待、账号、查询范围和结果交付状态。
4. 第二阶段只有在测量证明有效后才开放本地读取 Codemode；其范围必须是实际授权的主机本地读取工具。
5. `personal_attention` 先保留现有协议。高级策略操作是否延迟加载，通过路由准确率和提示成本决定。
6. 所有扩展限制在主机执行层落实，提示词用于选择入口，不承担权限隔离。

本文补充 [Personal AI V1 技术方案](../personal-agent-v1-technical.md)，连接请求遵循 [现有实现](../personal-agent-connected-app-requests.md)，MCP 继续遵循 [pi 工具对齐决策](./pi-tool-convergence-plan-2026-10-11.md)。不恢复自建 MCP runtime、私有 SDK hook 或第二套连接管理器。

## 2. 代码现状与需要解决的问题

| 现状 | 代码位置 | 对方案的影响 |
|---|---|---|
| 固定主工具清单包含 12 项 | `src/personal-agent/policy.ts` | 保留为主会话基线 |
| Personal 场景覆盖工具描述 | `src/agent/tools/factory.ts` | `knowledge_read` 与 `user_context_read` 的最终描述已区分；优化最终描述和示例，不只修改底层通用描述 |
| runner 在工厂过滤后安装 MCP、Codemode、ToolSearch | `src/agent/embedded/session-runner.ts` | 仅限制工厂 allowlist 无法定义完整运行时工具范围 |
| 配置存在 MCP Codemode exposure 时，即使未显式开启 Codemode，也可能自动启用 | 同上 | 必须在 extension 装配前决定允许的运行时能力；仅传入 `codemode: undefined` 不足以表达禁止 |
| Codemode 允许受信任核心读取、只读外部工具及原生 MCP 工具 | `src/agent/embedded/codemode-extension.ts` | 可选本地模式需要显式调用集合，不能复用 MCP 名称前缀放行规则 |
| Codemode 核心读取标记未包含所有 Personal 本地读工具 | `src/agent/tools/codemode-permissions.ts` | 不应承诺现有 Codemode 已能批量调用全部 Personal 读取工具 |
| discovery 状态会跨轮次恢复；runner 按 fingerprint 复用 | `session-runner.ts`、`tool-search-extension.ts` | 变更策略后须重建 runner，并重新过滤恢复的工具 |
| `session_recall` 单次理论文本上限约 40 万字符 | `src/agent/tools/session-recall-tool.ts` | 20 条 × 每条 20,000 字符，和主会话轻量读取目标不一致，应增加 Personal 总输出预算 |
| Request worker 在工厂内收窄工具 | `src/agent/tools/factory.ts` | 原生扩展也应遵循请求范围，不能在工厂后扩大该 worker 的权限 |

以上是静态代码发现。尚未测量真实选错率、模型提示成本或 P50/P95 延迟。

## 3. 主工具协议

| 工具 | 使用条件 | 关键边界 |
|---|---|---|
| `read_file` | 用户指定工作区文件 | 指定路径、有限文本读取；批量扫描或完整大文件处理交给 specialist |
| `read_media` | 用户提供上传附件 URI | Personal 当前为有界文本读取；大文件、二进制解析交给 specialist，不能承诺图片理解 |
| `session_recall` | 当前聊天缺少原话、ID、路径或具体决定 | 当前 conversation，包含压缩前记录；不访问其他聊天 |
| `session_search` | 找其他聊天或最近会话 | 本地短摘录，遵循跨会话访问策略；不自动调用摘要模型 |
| `knowledge_read` | 找项目、工作区事实、决定和承诺 | 提炼的知识，不保证是原话；保留来源和作用域 |
| `user_context_read` | 找用户身份、习惯、偏好和当前状态 | 遵循 User Context 访问策略；只读，不能声称写入画像 |
| `personal_read` | 查笔记、项目、自动化对象 | `kind` + `list/get`，返回有界内容；自动化状态不等于跟进状态 |
| `personal_preference` | 用户明确要求长期改变回复方式 | 保留显式来源；临时指令不持久化；不充当通用记忆写入 |
| `personal_capability` | 查询支持的应用能力、连接、账号及 executor | 本地预检，不代表远端健康；不泛化为所有 MCP 能力的发现器 |
| `personal_request` | 支持的连接应用只读目标 | 保留 connector/account/range，等待连接后自动继续；写操作走具备权限的其他执行路径 |
| `personal_task` | 缺少能力、专业判断或需要复杂处理 | 选择可用 specialist；任务说明完整携带材料与约束；追加指令优先更新既有 Task |
| `personal_attention` | 用户要求稍后再查并主动报告 | 保存关注与检查时间，不授予外部行动权限；查 `list/settings` 验证现状 |

示例路由：

- “刚才给你的那个路径是什么？” → `session_recall`。
- “之前其他聊天讨论过这个项目吗？” → `session_search`。
- “项目最终选了哪个数据库？” → `knowledge_read`，需要原话时再读取对应聊天证据。
- “你记得我平时什么时候有空吗？” → `user_context_read`。
- “以后回复简短一点。” → `personal_preference`；“这次简短一点”直接影响本轮。
- “看看过去一周重要邮件。” → `personal_capability` → `personal_request`。
- “读取这个 PDF 并完整审查。” → `personal_task`，附原始附件 URI 和完整目标。
- “明天下午再看看，有进展告诉我。” → `personal_attention`；按返回的时区、检查时间确认。
- “每天九点给我生成报告。” → 现有自动化能力的 specialist，使用 Automation 生命周期，避免重复创建 Attention。

不要为上述自然语言写一个基于关键词的硬路由器。模型负责语义选择，主机负责数据归属、权限与状态约束。

## 4. 执行层设计

### 4.1 统一运行时工具策略

新增一个内部 `ExecutionToolPolicy`，作为当次执行的派生结果，不新建用户配置层或持久表。由可信入口根据真实会话身份、有效 Agent 配置、Request worker 标记计算。

建议字段：

```typescript
type ExecutionToolPolicy = {
  surface: 'agent' | 'personal_main' | 'personal_request_worker';
  nativeMcp: boolean;
  externalMaterialization: boolean;
  discovery: 'configured' | 'none' | 'local';
  codemode: 'configured' | 'none' | 'local_reads';
  revision: string;
};
```

字段命名为建议，实施时按现有类型组织收敛。`surface` 不从模型参数、工具名称、Agent 名称或用户文本推断。主会话使用 `isPersonalConversation`；Request worker 使用持久请求关系和已有 worker 标记。存在标记但请求已删除时继续拒绝执行，不能回退为普通 Agent。

首阶段策略：

| 执行范围 | MCP | 外部工具物化 | ToolSearch | Codemode |
|---|---|---|---|---|
| 普通 Agent / 普通 specialist | 现有配置 | 现有配置与权限 | 现有配置 | 现有配置 |
| Personal 主会话 | 关闭 | 关闭 | 关闭 | 关闭 |
| Personal Request worker | 关闭 | 仅请求范围；若现有网关工具足够则无需物化 | 不额外注入原生入口 | 关闭 |

Request worker 保留现有 `xopc_tool_search/describe/execute` 与结果发布、连接恢复工具。原生 `tool_search` 和业务 `xopc_tool_search` 是不同入口，不要同时禁用。

### 4.2 策略应用顺序

1. 在 `run-for-session.ts` 的工具物化与 MCP 配置准备之前计算策略。
2. Personal 主会话跳过外部工具物化和 MCP 配置准备；不把 MCP 服务摘要、资源入口或扩展工具注入主提示。
3. 将策略通过 `types.ts`、`run-turn.ts` 传递到 pooled runner；普通 Task 的其他 runner 入口同步核对。所有生产入口均从主机计算，避免只有 Web 生效而语音、后台或 Task 路径遗漏。
4. `session-runner.ts` 以策略控制扩展安装、初始 active tools 和 discovery 恢复。禁止策略优先于 MCP 自动启用逻辑。
5. fingerprint 加入完整策略、revision 和最终工具契约。主机策略改变时让旧 runner 失效，不能沿用旧 MCP 连接或旧激活清单。
6. 当前执行采用固定策略快照。权限撤销按现有 before-tool-call 校验即时生效；需要立即收紧扩展范围时停止旧执行、关闭 runner，下一轮使用新策略。
7. 旧 transcript 中保留 `codemode-store` 和 discovery 审计行，但不从它们恢复已禁止的工具或权限。无需删除用户历史。

工厂仍负责构建业务工具；runner 负责扩展装配。两者消费同一策略，避免分散条件出现不同结果。第二阶段本地 Codemode 的嵌套调用继续经过现有 before/after-tool-call hooks、取消、日志及结果限制。

### 4.3 可选本地 Codemode

首阶段关闭，第二阶段以有限试验验证收益。若开放：

- 不安装原生 MCP；不允许任意外部工具、网络、shell、模型 API 或业务写操作。
- 仅允许工厂创建、可信标记、当次 allowlist 允许且底层访问策略通过的本地读取工具。初步候选为七个读取入口：文件、附件、当前历史、跨聊天历史、知识、用户画像和产品对象读取。
- 不因 `mcp__` 前缀、模型声称只读、外部 annotations 或工具名字相同而放行。
- 保持私有可信标记随包装传递，测试适配器与 description 覆盖后标记没有丢失；不把标记作为扩展可以自报的普通 metadata。
- 沿用现有 Codemode 配置预算并取更严格的主会话上限；初始试验建议 8 次工具调用、并发 2、超时 10 秒、总输出 2,000 token。这些是候选上限，不是速度承诺。
- tool 子调用和脚本结果均有预算。禁止利用连续脚本、分页或输出文件回读绕开完整大材料委派规则。
- 默认直接调用单个工具；只有独立多源读取或必要的结果整理才用 Codemode。没有可调用工具时不暴露空入口。

优先复用 pi 公开 Codemode 扩展和现有主机 hooks，不增加第二个 JS 执行器。

## 5. 读取预算与提示精简

### 5.1 Personal 总输出限制

为 Personal 本地读工具增加统一的总输出规范，先收敛 `session_recall`，再处理其他读取入口的不一致：

- 目标单次总序列化文本不超过 8,000 字符；该数值为初始产品预算，按真实场景调整。
- 服务端分配条数、单条摘录和总长度，不只依赖模型传入参数；普通 Agent 的读取默认保持原样。
- 先组装有效 JSON，再缩减摘录字段和结果条数；不直接截断序列化字符串。
- 保留来源 ID、conversation/对象作用域、截断标记、下一页位置。按实际已返回的结果生成 cursor，避免预算截断导致遗漏未交付结果。
- 窄问题允许必要分页；完整、批量处理返回 `requiresSpecialist`、原因和原始对象定位信息。
- 大材料委派携带原 URI/绝对路径/对象 ID；仅靠摘录不能宣称已读完材料。

无需给所有工具追加相同参数。内部复用预算辅助函数，外部协议按各数据源的定位和分页语义保持清晰。

### 5.2 路由提示

在 `policy.ts` 保存短职责与关键参数提示，在 `prompts.ts` 保留跨工具的路由、授权、委派及结果真实性规则。工具实现负责验证和具体错误，不在多处重复长篇产品说明。

已有 specialist snapshot 可用时直接选择；缺失、不匹配、用户指定 Skill 或创建失败时再发现。主助手已有足够上下文时直接回答，不先遍历所有记忆库。

`refreshPersonalDelegationGuidance` 沿用现有升级机制，保留自定义指令、额外配置和相关审计数据。新增或收紧的是 Personal 主会话的运行时规则；同一 Agent 的普通聊天按普通执行策略处理。文档须明确此行为，避免把配置中已有 MCP 误当成主会话可直接操作的能力。

## 6. Attention 精简的第二阶段设计

第一阶段保持现有九个 command 和后台策略行为，以免用户已有关注、策略版本或撤销入口失效。

候选方案：常驻 `personal_attention` 保留 `follow/list/settings/pause/end/resume`，将 `interests/feedback/rollback` 移到一个 Personal 本地延迟工具，例如 `personal_attention_manage`。

只有满足以下条件才实施：

1. 主机 `local` discovery 只注册这个受限本地管理工具；不混入 MCP 或其他外部工具。
2. “下次准备完整些”“撤销刚才调整”等请求能稳定发现和执行管理工具。近期旧 tool-call 历史不会引导模型继续调用已移除 command。
3. 两个入口共享现有服务端校验、显式用户依据、话题作用域及版本验证，不复制 Attention repository 逻辑。
4. 写操作不加入本地 Codemode 读取集合。
5. 最终提示 token 节省和准确率收益足以抵消一次 discovery 往返；若不满足，继续保留单工具，简化描述即可。

这是评估项，不作为第一阶段交付依赖。若采用，更新 Personal allowlist 和升级逻辑，并在文档中明确固定工具总数变化，不把迁移期间数量写成最终状态。

## 7. 实施顺序与改动范围

| 阶段 | 交付 | 主要文件 |
|---|---|---|
| P0：执行边界 | 运行时策略、主会话关闭额外扩展、Request worker 不扩权、fingerprint 与历史恢复过滤 | `src/personal-agent/policy.ts`；`src/agent/embedded/{run-for-session,types,run-turn,session-runner}.ts`；核对普通 Task runner 入口 |
| P1：轻量读取和路由 | Personal recall 总预算、统一有效 JSON/截断反馈、精简路由提示与更新文档 | `src/agent/tools/{factory,session-recall-tool,personal-read-tool}.ts`；`src/personal-agent/{policy,prompts,service}.ts`；`docs/personal-ai.md`、`docs/zh/personal-ai.md` |
| P2：数据驱动优化 | 本地 Codemode 试验；Attention 延迟管理工具评估 | `codemode-permissions.ts`、`codemode-extension.ts`、`tool-search-extension.ts`、`personal-attention-tool.ts` |

P0、P1 可独立交付。无需 SQLite schema migration、新增 Gateway 路由、连接流程重建或移动端工具协议改造。若实施中引入 API 变化，应另行补充 lazy-bundle 映射、真实鉴权 Gateway 测试和客户端验证。

## 8. 验收与测量

### 8.1 必须通过的行为回归

- Personal 主会话在全局 MCP、Codemode 开启且 MCP 配置为 direct/deferred/codemode 时仍仅拿到允许的主工具；资源工具、服务摘要、额外外部工具均不出现。
- 同一 Agent 的普通 conversation 和普通 specialist 继续拥有其合法配置能力。
- 语音、Web 输入、主会话后台回传使用一致策略；Request worker 原生扩展不扩大 connector/account/read-only 范围。
- 历史 discovery、Codemode store、旧 pooled runner 和配置重载不能重新激活已禁止工具；正在执行的撤权按明确的停止流程处理。
- 连接请求仍覆盖已连接、待连接、多账号、重新授权、取消、重启恢复、reset、删除和交付去重；实际取消语义保持准确，不声称远端读已停止。
- Personal recall 最大参数也不突破总输出预算；JSON 有效、cursor 无跳项、保留原文出处；跨聊天/画像的拒绝策略仍生效。
- 大附件委派携带原始定位和完整目标；现有结果与 worker 提问可以继续查看、回答和追加方向。

测试优先扩展现有 `personal-agent.test.ts`、`requests.test.ts`、`session-runner.test.ts`、`codemode.integration.test.ts`、`external-tool-discovery.test.ts`，补充针对输出预算的必要测试。

动态扩展边界须使用真实生产 pooled runner 验证，不能只测纯策略函数。普通 Agent MCP 用现有 stdio/HTTP 契约测试验证；不需要读取真实私人邮箱来证明主会话工具边界。

### 8.2 模型路由与性能评估

建立至少 30 条固定输入，覆盖当前历史、跨聊天、知识/画像、附件、产品对象、偏好、连接应用、委派、Attention 和 Automation，另含混合目标、worker 提问及失败恢复。每条标注合法入口集合、必须保留的信息和禁止的行为；允许等价的正确路径，不要求机械一致的调用顺序。

在相同模型、配置、历史和材料下对比优化前后，覆盖冷启动和 pooled runner 复用，每条重复至少三次。记录：

- 入口选对率、恢复后的目标完成率、重复 Request/Task 数量。
- 最终工具提示 token、工具结果 token、工具调用次数及重试次数。
- 输入到首次有效回复、到持久任务/请求确认、到最终结果的 P50/P95；三种延迟分别统计。
- Attention 保存成功率、话题范围准确率和额外 discovery 往返。

候选验收门槛：受限工具不可调用场景 100% 通过；路由合法率至少 95%，且已有目标完成率不下降；不出现未经确认的完成陈述或重复派发。P95 与 token 成本无明显回退，任何回退先定位原因再决定是否接受。模型指标需注明样本量和实测值，不把小样本结果视为线上保证。

日志遵循现有 `createLogger` 规范，记录 `conversationId/runId/surface/policyRevision/tool/phase/durationMs` 与计数；不记录画像正文、附件全文或连接凭据。使用现有观测能力，不在本阶段增加专用统计表或管理页面。

## 9. 上线与回退

先交付策略和必要回归，再交付读取预算与提示更新。更新策略 revision 后关闭受影响的旧 runner，下一轮按新规则重建；使用现有 session shutdown 清理原生扩展。

回退通过代码版本与策略 revision 完成，不删除 Request、Task、Attention、历史 discovery 或 Codemode store 数据。普通 Agent 的 MCP 能力保持现有版本语义。第二阶段本地 Codemode 和 Attention 精简分别决策、分别回退，避免为了恢复一个功能重新开放主会话全部动态工具。

本方案完成后，主会话仍拥有本地理解与持续协调能力；外部执行通过可追踪的 Request/Task 交付，工具总数的调整由真实准确率和成本决定。
