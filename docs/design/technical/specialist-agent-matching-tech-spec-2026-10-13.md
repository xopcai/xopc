# Personal Agent 的 Specialist 匹配技术方案

日期：2026-10-13  
状态：第一阶段已实现，验证记录见第 10 节  
范围：specialist 能力档案、统一匹配入口、选择记录

## 1. 目标与决策

让 Personal Agent 能够解释并稳定复现“为什么把这个任务交给这个 Agent”，同时在实际委派前排除无法执行的候选。

第一阶段采用：结构化专长声明 → 系统资格校验 → LLM 选择 → 创建前复核 → 持久化选择记录。

- Personal Agent 理解用户目标并选择执行者；匹配服务不调用另一个模型，也不自动选择所谓最优 Agent。
- 专长档案属于 Agent Catalog 元数据；工具、Skill、模型和账号权限来自现有运行时检查。
- 普通 Task 与连接应用 Request 复用资格判断，但保留各自的授权和执行流程。
- 保留上下文快照直接委派的快速路径，不强制每次增加一次工具调用。
- 不做数值评分、向量检索、历史成功率排序、负载调度或自学习路由；不自动拆任务。
- 不修改渠道绑定、全局默认 Agent 或模型 intent 路由。Specialist 匹配解决任务执行者选择，不替代会话路由。

## 2. 当前架构与缺口

| 当前实现 | 位置 | 本次影响 |
| --- | --- | --- |
| Agent 的严格 Zod schema、默认配置解析 | `src/agent-config/schema.ts`、`resolver.ts` | 增加可选匹配档案 |
| SQLite Agent Catalog、revision、CRUD | `src/agent-catalog/repository.ts`、`service.ts` | 保存声明并复用版本机制 |
| Personal 上下文 specialist 快照 | `src/personal-agent/prompt-context.ts` | 从统一服务生成紧凑摘要 |
| 模型和工具粗粒度可用性 | `src/personal-agent/specialist-capabilities.ts` | 作为适配器，不继续作为全部执行证据 |
| 普通委派的发现和创建 | `src/agent/tools/personal-task-tool.ts` | 接入匹配及选择记录 |
| 连接应用执行者和账号发现 | `src/personal-agent/capability-service.ts` | 复用资格判断，保留连接状态 |
| Request 授权后创建 Task | `src/personal-agent/request-service.ts` | 授权前记录、启动前复核 |
| Task 创建、幂等命令、事务与启动 | `src/tasks/task-application-service.ts` | 原子关联选择记录与 Task/Run |
| 委派来源关联 | `src/tasks/task-origin-repository.ts`、`task_origin_links` | 复用会话归属，不复制另一套身份体系 |

当前快照主要包含角色、工具和模型可用标记，specialist 内容预算为 1000 字符，可能遗漏候选。`personal_task(agents)` 支持必要工具和指定 Skill 过滤；最终 agentId 由 LLM 提供。

需要注意：现有工具列表是配置投影，主要排除 deny 和 allowlist 外的工具；现有模型检查是模型可解析且 provider 已配置。这两者都不能证明实际网络调用、动态工具、环境依赖或外部账号一定可用。

当前 Catalog 已以 SQLite 为权威存储；本方案不新增 xopc.json 的第二份能力注册表。MCP 代码图工具在本次会话不可用，因此现状核对使用了源码读取和文本搜索。

## 3. Specialist 能力档案

### 3.1 数据结构

在 `AgentEntrySchema` 增加可选 `specialistProfile`，独立于面向用户的 `profile`：

```ts
type SpecialistProfile = {
  version: 1;
  domains: string[];             // 如 software、data、research
  taskTypes: string[];           // 如 bug_fix、code_review、data_analysis
  inputKinds: string[];          // 如 repository、csv、text、image
  outputKinds: string[];         // 如 code_patch、report、chart、image
  specialties: string[];         // 短文本：领域内的具体专长
  examples: Array<{
    request: string;
    deliverable: string;
  }>;
  limitations: string[];         // 供模型判断的适用边界
};
```

字段均为声明信息，不授予权限，也不保证质量。不能在这里另写一套 tools、skills 或账号列表。`limitations` 是语义提示，不作为安全策略；真正禁止的行为仍由 tool policy 和授权系统约束。

第一版建立小型、带版本的领域/任务/输入输出词表，覆盖 starter Agents 的主要用途。允许规范化的自定义标识扩展；未知标识只做精确匹配，不能被猜测成相近能力。数组去重并限制大小：标识数组各最多 16 项，specialties/limitations 各最多 8 项，examples 最多 4 项；文本限制分别为 120 字符，示例 request/deliverable 各 200 字符。使用 strict Zod 校验。

示例：

```json
{
  "version": 1,
  "domains": ["data"],
  "taskTypes": ["data_analysis", "data_cleaning"],
  "inputKinds": ["csv", "spreadsheet"],
  "outputKinds": ["report", "chart", "script"],
  "specialties": ["结构化数据分析", "可复现计算"],
  "examples": [{"request": "分析销售 CSV 的月度变化", "deliverable": "含计算脚本的分析报告和图表"}],
  "limitations": ["涉及业务代码修改时优先选择软件开发 specialist"]
}
```

### 3.2 存储、配置和兼容

- 使用现有 `agents.overrides_json` 存储。`splitEntry` 已保存 workspace/profile 之外的 Agent 字段，无需为档案新建表或增加物理列。
- 档案仅属于单个 Agent，不进入 `AgentDefaultsSchema`，避免所有 Agent 继承相同专长。解析器显式透传到 `EffectiveAgentConfigSchema`；不进行递归合并。
- 更新经 `AgentCatalogService.update`，遵守 expectedRevision；修改档案时提升 Agent 和 Catalog revision，触发现有缓存刷新。
- 档案缺失表示 `profileSource: legacy`，仍允许委派；用原有 description/name 辅助模型选择，不从名称推导结构化标签。
- starter Agents 添加人工编写的种子档案。只在字段缺失时补齐，不覆盖用户编辑；复用 `starter-agents.ts` 的初始化模式。
- 档案与 SOUL.md/TOOLS.md 保持不同职责：前者用于发现和选择，后者指导 worker 执行。工具权限仍由配置决定。
- 同步检查 Catalog 的 CLI、Gateway、共享 DTO 和 web 表单 schema，避免 strict schema 丢字段；实际 DTO 所在位置以实现时源码为准。

## 4. 任务需求与统一入口

### 4.1 任务需求

```ts
type SpecialistTaskRequirements = {
  version: 1;
  summary: string;               // 有界任务摘要，不是完整 Task brief
  domain?: string;
  taskType?: string;
  inputKinds?: string[];
  outputKinds?: string[];
  requiredTools?: string[];
  requiredSkills?: string[];     // 使用当前 Skill 规范名称
  requestedAgentId?: string;    // 用户明确指定，不能静默替换
  connector?: { connectorId: string; accountId?: string };
};
```

由 Personal Agent 从请求提取。第一版不要求填满字段；没有必要条件就留空，避免猜测工具需求造成误排除。summary 限制 300 字符，数组各最多 16 项。完整材料、验收条件、用户约束仍写入现有 Task brief/contract，不复制到匹配对象。

调用者不能自行传入可信 owner、权限或 originating conversation；服务从会话和执行上下文取得这些信息。用户指定 Agent 的标记是意图声明，不是授权凭证。

### 4.2 服务接口与模块

新增 `src/agent-matching/`，保持 Catalog 与 Task 之间的依赖边界：

```ts
matchSpecialists(requirements, trustedContext): SpecialistMatchResult;
assessSpecialist(agentId, requirements, trustedContext): SpecialistAssessment;
listSpecialistSummaries(trustedContext): SpecialistSummary[];
```

`matchSpecialists` 枚举 Catalog 候选；`assessSpecialist` 校验指定候选，供直接创建、Request 启动和快照路径使用。二者调用同一套规则和证据适配器。

建议文件：`schema.ts`、`service.ts`、`availability.ts`、`selection-repository.ts`、`delegation-service.ts`。Skill 检查通过注入适配器复用当前 `getAgentSkillAvailability`；匹配服务不导入 tool factory。连接适配器复用现有 principal、installation 和 account access 校验，不递归调用 personalCapabilities。

### 4.3 资格与适配信息

资格返回 `eligible | blocked | needs_verification`，每个条件都有 `verified | configured | unknown | blocked` 证据等级和稳定 reason code。

| 条件 | 判断方式 |
| --- | --- |
| Agent 身份 | 未删除、启用、ready；排除自己和 `personal-*` |
| 用户指定 Agent | 只返回该目标的判断；不能自动降级为其他候选 |
| 模型 | 复用配置检查，记录为 configured，不声称网络健康 |
| 必要工具 | 必须有运行时注册/暴露证据且策略允许；只有配置名称时记 unknown |
| 必要 Skill | 已安装且对候选可用；检查器缺失时 unknown，不能默认为通过 |
| connector/账号 | 校验安装、Agent 访问策略、连接有效性与账号可访问性 |

工具检查需要细化当前 `DISCOVERY_TOOLS`：配置允许、实际注册、按需激活、需审批和外部权限应分别表达。按需能力用现有 capability 激活机制确认可激活；不创建第二套激活系统。需审批表示受现有审批流程约束，不等于已授权，也不一定永久不可执行。

领域、任务类型、输入和输出标签属于声明适配信息：返回 matched/missing/unknown 标签与边界提示，不作为执行资格的硬过滤。这样档案不完整的自定义 Agent 仍有机会被 LLM 判断适用。

未知必要条件不能直接开始 worker；应通过明确的 preflight 补充证据。普通网络可达性不做每次主动探测；模型配置充分时可以启动，但返回未验证网络的提示。外部连接缺失保持 Request 的 waiting_connection 流程，不能绕开授权创建普通 Task。

### 4.4 返回结果及顺序

返回 `matcherVersion`、`catalogRevision`、`checkedAt`、完整候选数量、分页游标和候选：

- Agent id、revision、档案来源及精简档案；
- eligibility、资格检查证据、拒绝或待验证原因；
- 匹配的声明标签、缺失标签、limitations。

不返回数值分数或“胜率”。顺序采用固定分组：eligible → needs_verification → blocked；组内以声明的 taskType 精确匹配优先，其次 domain 精确匹配，再按 id。这个顺序只用于展示，不代表系统指定最优者。LLM 可以选择同组其他候选并说明理由。

默认每页 10 个候选，reason 列表有界，提供 nextCursor；不能截断后假装没有其他候选。分页目录版本变化时要求重新查询，不能混合两版结果。

## 5. 接入 Personal Agent

### 5.1 普通委派

`personal_task` 增加 `match` 命令，接收 requirements；`agents` 保留兼容入口，内部调用相同服务，不再维护另一套过滤规则。

`create` 增加可选 `requirements` 和 `selectionReason`。已有 requiredTools/requiredSkills 合并到标准需求；同字段冲突应报错，不允许创建时缩减已确认的必要条件。agentId 必须与 requestedAgentId 一致。

流程：

1. 简单请求可直接回答；需要 specialist 时提取任务需求。
2. 快照中有合适目标时直接 create；没有、含遗漏、能力不明确或创建失败时调用 match。
3. Personal Agent 根据结构化档案、实例和资格证据选择，提交短 selectionReason。
4. create 对所选 Agent 按最新状态执行 assess，不信任快照或旧 match 结果。
5. 资格通过后，经委派服务持久化记录并调用现有 TaskApplicationService；执行和交付继续使用现有链路。

快照使用 `listSpecialistSummaries`，包含 id、短专长、主要 taskTypes/outputs 和就绪摘要，保持明确 omitted 数量。没有做运行时验证的字段不得输出为 verified；一次普通聊天不遍历所有 Skill 或发起远端探测。

更新 `prompts.ts` 和 personal_task 描述：工具资格决定能否执行，专长声明帮助选择；用户指定 Agent/Skill 时不得静默替换。失败重选先检查已有 Task/Run，避免为同一目标重复启动。

### 5.2 连接应用

personal_capability 继续负责连接和账号发现，但执行者资格由 agent-matching 提供，并保留账号级 executorAgentIds。

personal_request submit 保存选择依据和标准需求；连接未就绪时记为等待，不声称 Task 已启动。授权完成后的 `startPersonalRequest` 对同一个 Agent 和选定账号重新校验，再关联 Task/Run。若原 Agent 已失效，返回具体原因供 Personal Agent 重选，不能擅自换执行者或账号。

记录不能视为账号授权；既有主聊天和 specialist 双方账号访问检查保留。

## 6. 选择记录

### 6.1 记录什么

新增 SQLite `agent_selection_records`，通过下一可用迁移版本创建；不预占当前版本号。

| 字段 | 内容 |
| --- | --- |
| id、created_at、updated_at | 主机生成的记录身份与时间 |
| conversation_id、transcript_id、input_id | 来自可信执行上下文，input_id 可空 |
| personal_request_id、task_id、task_run_id | 关联现有对象，可在启动后补充 |
| decision_group_id、previous_selection_id | 同一委派目标的替代尝试链，主机生成 |
| idempotency_key、request_hash | 保证同一次尝试不重复、不混用输入 |
| matcher_version、catalog_revision | 当时的匹配规则和目录版本 |
| requirements_json | 规范化且有界的需求 |
| selected_agent_id、selected_agent_revision | 当时选定的身份与版本 |
| selected_profile_json、assessment_json | 当时的精简声明和系统检查证据 |
| candidates_json | 显式 match 时已展示候选的有界证据，可空 |
| selection_source、selection_reason | snapshot / match / explicit / legacy；理由来自 LLM 或用户选择 |
| status、reason_code | pending_connection / rejected / task_linked / start_blocked / start_failed |

selected_profile 保存历史快照，因为当前 Agent 档案可能变更。candidates 只保存实际展示过的候选及 reason code，不声称完整比较了所有 Agent。快速路径记录“基于快照选择，创建前仅复核所选 Agent”，不伪造候选比较。

LLM 的选择理由标记为 `reasonSource: model`，系统生成的 checks 单独存储。只记录短、可核对的理由，不要求或存储模型内部推理过程。

### 6.2 幂等与事务

- 不为每次快照或浏览目录写数据库。普通路径在 create 尝试时记录；Request 在 submit 时记录，授权后补链。
- 委派服务接收稳定 idempotencyKey，要求 uncertain retry 保留原 key；现有随机默认值保留兼容，但说明它不能保证跨调用去重。
- 同 key、同规范化输入返回已有选择与 Task；同 key、不同输入返回冲突，不重新选择。不把可变的实时 assessment 放入请求 hash。
- 幂等命中优先于新资格复核，避免已创建任务因 provider 状态变化被误报成未创建。新尝试才复核最新条件。
- 对 rejected 的新尝试记录实际拒绝原因；修复配置后的重试使用新 attempt key，并链接 previousSelectionId。
- 使用 `runSqliteWriteTransaction` 包裹选择记录、TaskApplicationService.create 和关联写入。现有嵌套事务通过 savepoint 支持；匹配前的异步验证不能占用长事务。
- 在短写事务中核对 Agent/Catalog revision 和会话来源；版本已变化则重新读取，不提交旧证据。账号权限也在启动边界复核；运行时仍执行既有安全校验。
- Task create 的失败返回可能带 model，意味着 Task 已持久化但未成功启动。必须据真实 model 关联 task_id，记 start_blocked/start_failed；不能简单把 ok:false 当成“没有创建任务”。
- SQL 异常回滚创建事务；随后独立事务记录可重试的失败诊断。若提交结果不确定，先按幂等 key 恢复真实状态，再报告；日志不能替代持久化关联。

### 6.3 生命周期和读取

选择记录说明“分配时为什么选”，不复制 TaskRun 的完成状态和 receipt。查询结果通过 Task/Run 读模型展示执行结果及验收状态；succeeded 不等于通过验收。

新执行者分配或实际重新开始任务时产生新记录，保留历史，不覆盖原选择。既有 Task 上的指令、回答或单纯重读不新增记录。

增加 `personal_task(selection, taskId)` 读取当前会话拥有任务的选择链；Request 记录通过 requestId 读取并校验所属会话。Gateway 如需诊断，提供受鉴权的 `/api/personal-agent/selections`，过滤 conversationId/taskId/requestId 并校验 owner，分页读取。

只保存必要摘要、标识和有界证据，不保存完整用户对话、附件内容、邮件正文、token 或连接凭证。账号仅记录内部 id。Agent 删除不删除历史理由；会话/Task 删除按现有产品数据删除语义清理关联记录，避免无归属隐私数据。第一版不设置独立静默过期清理。

日志用 createLogger('AgentMatching')，输出 selectionId、conversationId、agentId、taskId、phase 和 reasonCode；完整 assessment 由受鉴权诊断读取，不写入默认日志。

## 7. 编辑与诊断界面

第一版复用能力中心 Agent 详情页面，增加专长档案编辑区域：领域、任务类型、输入/输出、具体专长、例子和边界。单独展示运行时可用性，明确“已配置”“待验证”“被策略阻止”。

复用现有 Agent 更新接口及 revision 冲突处理，不能覆盖其他配置。遵守 semantic tokens、项目 Select 和 skeleton；必要时扩展既有页面，不新增独立能力中心。

选择记录优先提供工具读取和小型 Task 诊断区域。默认聊天不输出内部候选列表，用户询问“为什么选择它”时解释与任务相关的短理由。

新增 Gateway API 时必须同步 lazy-bundles matcher、正反映射测试，并通过运行中 Gateway 验证真实鉴权路径。档案 API 与诊断 DTO 使用共享 Zod contract，避免前后端独立定义。

## 8. 分阶段实施

1. **档案与统一评估基础**：新增 schema/词表；透传有效配置；Catalog 读写兼容；starter 缺失补齐；建立 availability 适配器及 assess 服务。
2. **匹配与两条委派路径**：match 接口、证据等级、分页；更新快照与 prompts；普通 create 和 personal_request 共用评估，保留授权恢复。
3. **选择记录与原子关联**：迁移、repository、delegation service；幂等恢复、失败记录和 Task/Run 关联；接入工具/受鉴权诊断。
4. **档案编辑和验收**：复用 Agent 详情界面；完善固定样例与端到端验证；检查历史 Agent 和旧工具参数兼容。

设计文件新增集中在 `src/agent-matching/`；现有修改点包括 agent-config、agent-catalog、starter-agents、personal-agent、personal-task-tool、xopc-use 的 Task 创建映射，以及必要的 Gateway contract/UI。TaskApplicationService 保持通用执行器职责，不把 specialist 语义塞入 TaskRepository。

## 9. 验证与验收标准

| 场景 | 预期 |
| --- | --- |
| Coder 与 Data Analyst 都能 exec | 返回不同专长证据，LLM 根据任务类型选择；不只凭 exec 判断 |
| 已禁用、未 ready、删除或 personal Agent | 不能作为新委派执行者 |
| 必要工具只有配置名称、无法验证 | 返回 needs_verification，不能误报 verified |
| 指定 Skill 未安装、被策略排除或检查器缺失 | 分别给出明确原因；不能悄悄换 Skill |
| 档案缺失的自定义 Agent | 保留候选，标记 legacy，不伪造专长 |
| 用户指定 Agent 不可用 | 返回该目标的阻碍，不自动换人 |
| 快照遗漏或 match 分页 | 告知遗漏，可发现其余候选 |
| 选择后 Agent/账号权限变化 | 创建或授权后启动时重新检查并拒绝失效条件 |
| 重复 key 或 key 输入冲突 | 恢复原 Task/selection 或返回冲突，不重复启动 |
| 创建返回 blocked 且已持久化 Task | 正确关联 task_id，保留等待/阻碍信息 |
| worker 失败后更换 Agent | 新选择记录关联旧尝试，不覆盖历史，不遗漏已有 Task |
| Agent 档案后来更新或删除 | 仍可解释历史选择 |
| 跨会话读取记录 | 被归属校验拒绝 |

单元测试覆盖 schema、有效配置、资格规则和确定性顺序；SQLite 集成测试覆盖回滚、幂等、关联、删除与重试；工具测试覆盖快照直接 create、match 与 Request 授权后复核。新增 API 验证真实 Gateway lazy loading 和身份访问。

另准备至少 12 个固定业务样例：代码修改/审查、CSV 分析、实时研究、写作、图片生成、指定 Skill、连接应用、定期报告、缺少权限、档案缺失、用户指定 Agent、相近候选。每例人工声明可接受 Agent 集合及理由，检查候选覆盖、错误资格判定、选择可解释性和重复启动。

确定性匹配测试不依赖在线模型。LLM 选择样例作为单独的产品评估，记录模型和提示词版本，不把偶发模型选择当作规则单元测试结果。

验收底线：必要条件失败不得启动；正常新委派都有可追溯记录；快速路径不强制额外 discovery；现有 Agent/Skill/账号授权不被扩大；旧档案缺失和旧 create 调用仍可工作。完成后再讨论是否确实需要评分或反馈学习。


## 10. 第一阶段实现与验证（2026-10-13）

已落地能力档案、统一匹配/资格评估和选择记录。新增模块为 `src/agent-matching/`；共享档案与需求 schema 位于 `packages/gateway-contract/src/specialists.ts`；SQLite 迁移为 `247_agent_selection_records.sql`。工作区中的其他功能可能继续提升全局 schema 版本，不能把迁移编号当作当前最终版本。

### 使用入口

- Agent 详情的角色配置区域可编辑领域、任务类型、输入/交付类型、专长、例子和边界。已有档案缺失的 Agent 保持可用；starter 只补齐缺失档案。
- `personal_task(command="match", requirements=...)` 返回分页候选、资格证据与临时 matchId。matchId 缓存有界，不能跨工具实例当作长期凭证。
- `personal_task(command="create", agentId=..., objective=..., requirements=..., selectionReason=..., matchId=...)` 保留匹配时的需求，记录实际展示的候选；快照直接 create 仍然可用，不伪造候选比较。
- `personal_task(command="selection", taskId=...)` 或 requestId 读取所属对象的选择记录；省略对象 ID 时分页读取当前 Personal 会话的记录，包括没有创建 Task 的拒绝尝试。
- 普通成功创建通过现有 product capability 的内部 createTask 注入点，在 Task 创建事务中关联选择记录；不会绕开原有 capability 授权和提交后调度。
- 连接应用继续使用 personal_capability → personal_request。capability 新增 executorProfiles 帮助判断专长；submit 可提供 selectionReason。账号授权前和启动前各保留一次证据，同组关联同一个 Request 和最终 Task。

### 兼容与证据边界

旧 agents 数组结果和旧 create 参数继续工作。新结构化需求对必需工具进行运行时注册校验；对于没有注入运行时检查器的旧调用，保留原配置投影校验并标记为 configured。Skill 检查缺失或失败保持未验证，不假装已安装。

Personal 快照仍采用本地 revision 缓存和有界内容预算；工具摘要标记为配置投影。候选工具/Skill 发现使用候选执行范围，避免错误继承 Personal 主聊天的窄工具边界。模型可用性仍只检查配置，网络和工具执行环境由运行时验证。

档案 CRUD 复用现有 `/api/agents` 路由，并增加可选 expectedRevision；没有新增独立诊断 API 或复杂路由。选择记录通过 Personal 工具读取，执行结果继续由 Task/TaskRun 的现有读模型解释。记录区分 model 与 system 来源的理由。

### 验证记录

- 43 个测试文件、325 项相关回归通过，覆盖 Agent Catalog/配置、starter、Personal Agent/Request、Task capability 原子操作、SQLite 迁移和 gateway-contract。
- 最后的匹配边界复核：2 个测试文件、17 项通过，含 12 个固定业务样例、配置与注册证据区分、失败探测、历史关联、回滚、重试和工具实例重建。
- 实际监听 localhost 的 HTTP Gateway 验证档案 PATCH：无凭据拒绝、有凭据保存、旧 revision 拒绝、非法字段拒绝、清除档案成功。
- 根项目 typecheck、web type-check、相关文件 ESLint 和 web 生产构建通过。构建仍有项目现有的分包提示。

本阶段没有引入在线模型选择评测、数值评分、向量索引、负载调度或自学习。固定样例验证候选与规则；LLM 对这些候选的真实选择质量仍需后续独立产品评估。
