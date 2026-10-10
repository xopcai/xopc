# Agent 驱动的用户理解：产品与技术方案

状态：方案草案，待评审。
日期：2026-09-24

## 1. 背景

xopc 已经能够从对话、本地来源和连接器中形成用户断言、目标、优先事项、协作规则与工作记忆，并在“你”页面中展示、纠正和删除这些内容。

下一阶段不以扩大用户档案或要求用户维护更多字段为目标，而是让 xopc 在用户正常工作时自动形成一份持续更新的协作模型：理解用户是谁、当前在意什么、如何工作、受到什么约束，以及这些情况正在如何变化。

产品的默认交互应是自然对话。用户可以主动查看和编辑，但不需要定期整理画像、审核候选项或维护分类。

## 2. 产品定义

### 2.1 一句话定义

xopc 自动维护一份用户拥有、可解释、可纠正的动态协作模型，并只在当前任务确有帮助时使用其中相关部分。

### 2.2 核心原则

1. **自动维护为主**：采集、提炼、合并、冲突处理、过期和归档由系统完成。
2. **对话纠错优先**：用户可以用自然语言纠正、限定、撤回或禁止再次学习。
3. **管理页面是审计入口**：页面用于查看、解释、编辑和删除，不成为用户的维护工作台。
4. **高精度优先于高召回**：证据不足时不形成理解，不把每条信息都变成记忆。
5. **事实、模式、解释、行动规则分离**：推断不能伪装成事实，也不能自动扩大行动权限。
6. **目的限定与最小读取**：连接来源时说明用途、字段、回看范围、处理位置和保留时间。
7. **第三方最小化**：只保存第三方与用户协作所必需的关系信息，不建立第三方画像。
8. **权限由代码控制**：模型可以提出候选理解，但不能决定授权、敏感信息准入或自动行动。

## 3. 目标与非目标

### 3.1 产品目标

- 用户不需要重复介绍自己的角色、目标、项目、偏好和约束。
- xopc 能识别稳定特征、临时状态、情境差异和变化趋势。
- 连接邮件、日历、文档、任务及代码活动后，系统能形成高价值且可追溯的理解。
- 用户一句话即可纠正模型，纠正后不会被旧来源自动覆盖。
- 用户能够知道一条理解从哪里来、用于什么、何时过期以及如何删除。
- 自动形成的理解只能改善回答、排序和建议，不能自动授予外部行动权限。

### 3.2 非目标

- 不追求收集用户的全部数据。
- 不提供人格测评或心理、医疗诊断。
- 不根据一次行为建立长期人格标签。
- 不要求用户逐条审批普通、低风险的理解。
- 不用 connector 数据训练面向其他用户的通用模型。
- 首期不处理健康、财务、精确位置、私密消息等高风险领域。

## 4. 用户模型

### 4.1 领域

完整本体支持以下领域，但并非全部默认自动学习：

1. 基础身份
2. 人生经历
3. 身体与健康
4. 心理与情绪
5. 人格与稳定倾向
6. 认知与决策
7. 价值观与信念
8. 需求与动机
9. 目标与未来
10. 能力与知识
11. 行为与习惯
12. 偏好与禁忌
13. 关系网络
14. 资源与约束
15. 环境与情境
16. 数字世界

### 4.2 四层模型

| 层级 | 含义 | 示例 | 默认准入 |
|---|---|---|---|
| 事实 | 用户明确陈述或可直接观察的事实 | 用户居住在上海 | 普通事实可直接使用 |
| 模式 | 多个独立观察支持的规律 | 用户经常在上午安排深度工作 | 低风险、高可信时作为工作假设 |
| 解释 | 对模式背后原因的推断 | 用户可能通过系统化降低不确定性 | 明确标为推断，默认不驱动高后果建议 |
| 行动规则 | 系统在满足条件时应怎样做 | 上午优先保护深度工作时间 | 必须由用户明确启用 |

### 4.3 每条理解的必要维度

- 内容：结构化值和面向用户的陈述。
- 时间：观察、成立、失效、复核时间。
- 情境：工作、家庭、项目、角色、压力状态或其他适用条件。
- 来源：用户陈述、用户行为、第三方内容、系统推断或专业结论。
- 可信度：确认事实、高概率判断、工作假设、冲突或过期。
- 权限：允许的用途、Agent、处理位置、保留期限和披露方式。
- 证据：支持、反驳和派生关系。

### 4.4 风险分层

| 分层 | 领域示例 | 默认行为 |
|---|---|---|
| A：普通、高价值 | 工作主题、目标、承诺、能力证据、沟通偏好、工作节奏 | 满足证据门槛后自动形成工作假设 |
| B：个人、中风险 | 关系角色、价值排序、压力状态、生活节奏、资源约束 | 形成候选；需要时通过对话确认 |
| C：敏感、高后果 | 健康、财务、政治宗教、性取向、创伤、精确位置、未成年人 | 禁止自动推断；仅接受单独授权下的明确陈述 |

## 5. 产品体验

### 5.1 首次设置

用户不配置 16 个领域，而是选择目的包：

- **理解我的工作**：项目、角色、能力、目标、承诺和工作节奏。
- **适应我的协作方式**：沟通偏好、会议习惯、反馈方式和边界。
- **协助安排时间**：日程、任务、时间约束和重复节奏。
- **深度个人理解**：价值、关系或生活信息；独立说明风险，默认关闭。

每个目的包展示：

- 将连接哪些来源；
- 默认读取哪些字段；
- 初次回看多长时间；
- 原文是否保留以及保留多久；
- 在本地还是远程模型处理；
- 会形成哪些类型的理解；
- 明确不会做什么。

### 5.2 日常使用

日常流程保持低打扰：

1. 后台发现来源变化。
2. 系统形成观察并更新现有理解。
3. 当前任务需要时，只召回少量相关内容。
4. 回答中可用轻量入口显示“参考了与你相关的 3 条理解”。
5. 用户可展开查看依据或直接在对话中纠正。

不创建普通理解的待审核收件箱。证据不足的候选静默等待更多证据或过期。

### 5.3 对话纠错

Agent 应识别以下维护意图：

| 意图 | 用户示例 | 系统行为 |
|---|---|---|
| `correct_fact` | “我现在不是工程师，主要负责产品。” | 用用户明确陈述替换旧事实并保留版本链 |
| `narrow_scope` | “这只适用于这个项目。” | 将全局理解缩小到项目范围 |
| `mark_temporary` | “这只是发布期的状态。” | 设置有效期和复核时间 |
| `reject_inference` | “这不代表我讨厌开会。” | 否定解释，不必删除原始观察 |
| `forget` | “忘掉我的睡眠信息。” | 删除理解、派生关系并写入抑制指纹 |
| `stop_learning` | “不要再从邮件推断关系。” | 修改来源允许的派生领域 |
| `confirm_pattern` | “对，我上午工作效率更高。” | 将模式提升为用户确认 |
| `enable_action_rule` | “以后上午优先排深度工作。” | 创建显式行动规则 |

### 5.4 何时询问用户

系统维护一个“打扰预算”，只在以下情况提问：

- 涉及敏感或高后果信息；
- 两个高可信来源发生冲突；
- 当前任务的结果会因某个不确定理解明显变化；
- 拟将模式升级为长期行动规则；
- 用户曾明确设置相关边界；
- 一次确认可以长期减少错误和重复沟通。

确认优先嵌入正常对话。弹窗只用于连接授权、处理位置变化、敏感信息授权和破坏性删除等必须显式决定的场景。

### 5.5 “你”页面

页面分为四个区域：

1. **此刻重要**：当前目标、承诺、优先级和变化。
2. **xopc 对你的理解**：按领域展示少量高价值事实、模式和推断。
3. **值得确认**：只显示高价值冲突或能转化为行动规则的候选。
4. **数据与边界**：来源、用途、处理位置、保留、暂停、撤销和删除。

每条理解支持：

- 对 / 不对；
- 修改；
- 仅在某情境适用；
- 标记为暂时；
- 暂停使用；
- 忘记且不再自动学习；
- 查看证据、变化历史和当前用途。

## 6. 来源策略

### 6.1 渐进读取

所有 connector 使用三级读取：

1. **元数据级**：标识、时间、类型、作者归属和删除状态。
2. **结构级**：标题、参与角色、目录、摘要和短片段。
3. **正文级**：仅对用户原创、用户明确选择或与当前理解高度相关的条目展开。

模型不能通过扩大上下文窗口绕过字段策略。

### 6.2 邮件

优先级：用户发出的邮件、用户回复过的线程、与当前项目或承诺相关的线程、其他元数据。

允许提取：

- 承诺、截止时间和工作主题；
- 场景化的沟通风格；
- 角色和责任；
- 与用户直接相关的协作关系。

禁止：

- 将收到的内容视为用户观点；
- 从第三方内容推断用户健康、财务、政治或亲密关系；
- 建立第三方完整画像；
- 将一次表达方式升级为稳定人格。

Gmail 应使用首次同步加 `historyId` 增量同步；正文读取和附件读取分开授权。Outlook 使用 Microsoft Graph delta，同步层统一封装游标失效和重新全量同步。

### 6.3 日历

适合提取承诺、重复节奏、会议负载、工作窗口和近期变化。必须区分 organizer、accepted、tentative、declined；敏感标题在本地分类后才可进入远程分析。

### 6.4 文档和本地文件

默认元数据优先。仅对用户拥有、用户选择或当前项目高度相关的文件读取正文。个人笔记默认一次性授权、短期原文保留；密钥文件、认证目录和系统隐私目录始终排除。

### 6.5 GitHub、Linear 和任务系统

用于区分“拥有知识”“实际做过”和“能够稳定交付”。能力模式需要跨时间、多条独立的用户归属证据，仓库依赖和被指派事项不能单独证明用户能力。

### 6.6 暂不进入首期的来源

- 私密即时消息；
- 健康和医疗记录；
- 金融账户和消费明细；
- 连续精确位置；
- 未成年人数据。

这些来源需要独立加密域、单独授权、影响评估和更严格的使用策略。

## 7. 技术架构

```text
Connector / Local source
        │
        ▼
Source Grant + Consent Receipt
        │
        ▼
Incremental Sync / Dedup / Deletion Propagation
        │
        ▼
Local Sanitization / Ownership / Sensitive Classification
        │
        ▼
Observation Store ───────────────┐
        │                        │ evidence
        ▼                        │
Domain Extractors               │
        │                        │
        ▼                        │
Policy Admission Gate           │
        │                        │
        ▼                        │
Reconciliation / Temporal Decay / Conflict
        │                        │
        ▼                        │
Fact / Pattern / Interpretation ┘
        │
        ▼
Task-aware Context Selection
        │
        ▼
Agent Response

Explicit user confirmation only
        │
        ▼
Action Rule
```

### 7.1 组件职责

#### Source Agent

- 调度 connector 和本地适配器；
- 增量同步、分页、重试和游标恢复；
- 传播源端更新和删除；
- 不生成用户人格或动机判断。

#### Signal Pipeline

- 清洗 HTML、签名、引用历史和自动通知；
- 判断用户、第三方或共享作者归属；
- 提取日期、参与者、任务、项目和关系信号；
- 检测敏感类别和 prompt injection；
- 在允许远程处理前完成最小化和脱敏。

#### Understanding Model

- 从有界观察中生成结构化候选；
- 每个候选必须引用证据；
- 区分事实、模式和解释；
- 不决定授权和最终准入。

#### Reconciliation Agent

- 合并同义候选；
- 处理单值断言的替换和冲突；
- 保持时间区间、情境和作用域；
- 计算独立证据，而不是简单累计重复条目；
- 对动态状态衰减，对稳定事实定期复核。

#### Policy Engine

- 根据 source grant、领域、敏感类别、后果和用途执行硬规则；
- 决定拒绝、候选、工作假设、可用事实或需要确认；
- 禁止模型自行降低敏感等级；
- 禁止推断直接创建行动权限。

#### Context Planner

- 按任务、作用域、情境、有效期和允许用途过滤；
- 优先用户明确陈述，其次用户行为，再次系统推断；
- 将工作假设明确标注给 Agent；
- 不把原始 connector 内容直接放入系统提示词。

#### Maintenance Agent

- 运行过期、冲突、重复、漂移和删除传播；
- 不因记忆被读取而提升可信度；
- 维护审计记录和可重复执行的检查点。

## 8. 数据模型

### 8.1 扩展断言

在现有 `user_assertions` 上增加：

```ts
type PersonalModelLayer = 'fact' | 'pattern' | 'interpretation';

type UserAssertionExtension = {
  domain: PersonalDomain;
  layer: PersonalModelLayer;
  sensitivityCategories: string[];
  purposeIds: string[];
  allowedUses: Array<'answer' | 'rank' | 'recommend' | 'remind'>;
  allowedAgentIds?: string[];
  consentReceiptId?: string;
  supportCount: number;
  independentSourceCount: number;
  lastSupportedAt?: number;
  deleteAfter?: number;
};
```

行动规则继续使用独立的 collaboration rule 存储，避免与普通理解混合。

### 8.2 Observation 表

新增 `user_model_observations`：

- `observation_id`
- `principal_id`
- `domain`
- `observation_type`
- `subject_type` / `subject_id`
- `value_json`
- `context_json`
- `sensitivity_categories_json`
- `owner_attribution`
- `observed_at` / `valid_to` / `delete_after`
- `source_grant_id` / `source_item_id` / `evidence_id`
- `content_hash`
- `created_at`

Observation 默认短期保留，不直接进入 Agent 上下文。

### 8.3 Assertion Edge 表

新增 `user_assertion_edges`：

- `from_assertion_id`
- `to_assertion_id`
- `relation`: `supports`、`contradicts`、`derived_from`、`specializes`
- `confidence`
- `created_at`

用于解释“事实如何形成模式，模式如何形成解释”，以及级联删除。

### 8.4 Consent Receipt

为 understanding source grant 增加版本化授权收据：

```ts
type UnderstandingConsentReceipt = {
  id: string;
  sourceGrantId: string;
  purposes: string[];
  allowedDomains: PersonalDomain[];
  deniedDomains: PersonalDomain[];
  allowedFields: string[];
  accessMode: 'once' | 'continuous';
  lookbackDays: number;
  rawRetentionDays: number;
  processingPolicy: 'local_only' | 'remote_allowed';
  allowedAgentIds?: string[];
  disclosureVersion: string;
  grantedAt: number;
  revokedAt?: number;
};
```

授权变更必须使进行中的 extraction 失败关闭；撤销后停止同步并按策略清理 raw、observation 和派生 assertion。

## 9. 准入策略

### 9.1 权威度

```text
user_explicit > user_observed > system_inferred > external_untrusted
```

收到的邮件、第三方文档和共享日历内容默认是 `external_untrusted`。只有能够证明由用户本人创作或执行的行为，才能成为 `user_observed`。

### 9.2 自动准入矩阵

| 候选 | 条件 | 结果 |
|---|---|---|
| 普通明确事实 | 用户直接陈述，引用可验证 | active fact |
| 普通行为模式 | 至少 3 个独立事件、跨至少 2 天、用户归属明确 | candidate pattern，可作为工作假设 |
| 稳定偏好 | 至少 2 个独立证据，且情境一致 | candidate pattern |
| 动机或人格解释 | 由模式派生 | interpretation，默认不直接使用 |
| 敏感推断 | 任意自动来源 | rejected |
| 行动规则 | 非用户明确确认 | disabled 或不创建 |
| 来源冲突 | 同作用域、同时间区间、不同值 | conflicted，不进入上下文 |

证据阈值按领域配置，不能只使用一个全局数字。

### 9.3 敏感度传播

派生结果的敏感度不得低于证据的敏感类别所要求的最低级别。模型只能提高敏感度，不能降低；最终分类由确定性规则重新计算。

## 10. API 与事件

### 10.1 建议新增 API

- `GET /api/user-model/portrait`：按领域和层级返回当前模型。
- `GET /api/user-model/assertions/:id/explanation`：返回证据、派生链、时间和用途。
- `POST /api/user-model/corrections`：统一处理纠正、限定、暂时、拒绝推断和忘记。
- `POST /api/user-model/assertions/:id/confirm-pattern`。
- `POST /api/user-model/assertions/:id/create-action-rule`。
- `GET /api/user-model/sources/:id/consent`。
- `PATCH /api/user-model/sources/:id/consent`。
- `POST /api/user-model/sources/:id/purge`：按 dry-run → confirm → purge 执行级联删除。

新增认证 Gateway 路由时必须同步更新 `lazy-bundles.ts` 和映射测试。

### 10.2 建议事件

- `user-model.assertion.updated`
- `user-model.assertion.conflicted`
- `user-model.confirmation.requested`
- `user-model.source.consent.updated`
- `user-model.source.purge.progress`
- `user-model.maintenance.completed`

事件 payload 不携带原始邮件、文档正文或敏感值。

## 11. 连接器实施调整

### 11.1 Gmail

- 将通用 messages stream 拆为 sent、participated threads 和 metadata inventory。
- 首次有界同步后使用 history cursor；游标失效时重新同步有界窗口。
- 邮件正文仅在归属和字段策略通过后读取。
- 清理签名、引用历史、营销邮件和自动通知。
- 将附件正文作为独立能力和授权项。

### 11.2 Google Calendar

- 保留 sync token 流程。
- 标准化 organizer、attendee response、recurrence 和 visibility。
- 从时间结构生成观察；标题和描述按敏感分类决定是否展开。

### 11.3 Drive

- inventory 默认只保存必要元数据。
- content enrichment 优先用户拥有、近期活跃和当前项目相关文档。
- 文档正文生成临时 observation 后尽快删除，除非用户选择 bounded raw。

### 11.4 GitHub 与 Linear

- 将 actor attribution 扩展为 author、reviewer、assignee、merger 等动作角色。
- 能力与交付模式只使用用户实际完成的动作。
- 项目事实继续进入 work memory，不进入全局用户人格。

## 12. 本地与远程处理

`local_only` 必须是一条真正可运行的路径，而不是简单跳过理解：

- 优先使用确定性本地 signal extractor；
- 可选配置本地 understanding model；
- 未配置本地模型时仍生成基础事实、时间和行为观察，但不做复杂解释；
- UI 清楚说明哪些能力因 local-only 不可用。

远程处理前发送最小化后的 observation batch，不发送 connector 的完整原始响应。批次应包含授权收据版本和 extractor 版本，以便审计。

## 13. 删除、撤销与保留

### 13.1 删除层级

1. 删除一条理解：删除版本链、边和检索索引，写入抑制指纹。
2. 删除理解及派生观察：额外删除相关 observation。
3. 清除来源：删除本地 raw/index、observation、仅由该来源支持的派生项并撤销持续同步。
4. 断开账号：在 xopc 清除之外，提示用户在服务提供方撤销 OAuth。

共享证据支持的 assertion 不因一个来源撤销而直接删除；应移除对应支持并重新计算准入状态。

### 13.2 默认保留建议

- 原始正文：7 天或不保存；按来源配置。
- Observation：30 天；模式形成后可更早删除原始文本。
- 动态状态：7–30 天后复核。
- 慢变化模式：180 天后复核。
- 用户确认事实：直到用户修改、删除或来源明确失效。
- 审计元数据：保留不含原始内容的最小记录。

## 14. 安全设计

- connector 内容始终是不可信数据，不能覆盖系统指令。
- 凭据、令牌、私钥、认证头和高风险标识符在进入索引前清除。
- 第三方联系人使用内部稳定 ID；UI 需要时再从来源解析显示名。
- 日志只记录 ID、计数、阶段和有界预览，不记录正文。
- 远程模型调用记录 provider、model、purpose、consent receipt 和字段摘要。
- 高风险变化执行 DPIA/个人信息保护影响评估。
- connector OAuth 使用最小 scope，并为 Gmail Restricted Scope 验证和安全评估预留发布周期。

## 15. 质量与评测

### 15.1 离线数据集

为每类来源建立合成与人工标注数据：

- 多来源一致与冲突；
- 用户原创和第三方内容混合；
- 暂时状态与长期模式；
- 中英文和跨语言同义；
- 撤销、删除、更新和游标失效；
- prompt injection 与敏感信息；
- 应当拒绝推断的负例。

### 15.2 核心指标

- assertion precision；
- evidence grounding precision；
- owner attribution accuracy；
- temporal validity accuracy；
- conflict and update accuracy；
- sensitive inference leakage；
- deletion resurrection rate；
- inappropriate reference rate；
- correction success rate；
- useful context precision；
- abstention quality。

不以保存条数或用户审核量作为成功指标。

### 15.3 在线指标

- 用户通过对话纠正理解的成功率；
- 被展开“为什么这样理解”的比例；
- 用户删除或关闭某领域的比例；
- 个性化被标记 helpful / irrelevant 的比例；
- 因理解错误导致的负反馈率；
- 每用户每周主动确认次数，目标保持低水平。

## 16. 实施阶段

### Phase 0：安全与数据契约

- 增加 domain、layer、purpose、allowed use 和敏感类别。
- 增加 consent receipt、observation 和 assertion edge。
- 修复 connector 派生内容被固定标为 normal 的问题。
- 去除新 connector grant 对 `remote_allowed` 和 `bounded_raw` 的硬编码默认。
- 建立级联删除和撤销测试。

验收：任何 connector 数据都能回答“为什么读取、读了什么、在哪里处理、保留多久、形成了什么”。

### Phase 1：工作型个人模型

- Gmail 发件箱、Calendar、GitHub、Linear 的领域 extractor。
- 自动形成目标、承诺、工作主题、能力证据、沟通偏好和工作节奏。
- 对话纠错和“为什么这样理解”体验。
- task-aware context selection。

验收：在测试集上高精度形成工作理解，并且不从第三方内容生成用户事实。

### Phase 2：文档与跨来源推理

- Drive 和本地文档渐进读取。
- 跨来源实体和项目对齐。
- 事实 → 模式 → 解释的可视化派生链。
- Outlook、Dropbox、Box 等来源接入统一数据契约。

验收：跨来源更新、冲突、删除和时间变化能够正确传播。

### Phase 3：主动协作

- 由用户确认的模式生成行动规则建议。
- 基于当前目标和变化提供低打扰提醒。
- 只在已授权、可恢复边界内执行主动动作。

验收：推断本身永远不能授权外部、财务、公开、破坏性或权限扩大的行动。

### Phase 4：高风险领域评估

仅在独立加密域、本地处理、单独授权、影响评估和专门评测完成后，决定是否支持健康、财务、位置或私密消息；它们不属于普通 user model 的自然扩展。

## 17. 首期建议范围

建议首期只交付以下闭环：

1. 用户连接 Gmail、Calendar、GitHub 或 Linear，并选择“理解我的工作”。
2. 系统自动形成目标、承诺、项目、能力证据、沟通偏好和工作节奏。
3. 当前回答按需使用这些理解，并提供轻量来源说明。
4. 用户可以通过一句话纠正、限定、标记暂时或忘记。
5. “你”页面可查看证据、使用范围和来源授权，但不要求用户维护。
6. 行动规则只有在用户明确确认后启用。

这条路径能够验证产品价值，同时把隐私、第三方数据和模型误判风险控制在可管理范围内。

## 18. 开放问题

- 默认是否允许远程 understanding model，还是首次连接时必须选择处理位置？
- 原始邮件和文档是否默认不落盘，仅保留结构化 observation？
- connector 学习权限跟随账号、Agent，还是 purpose pack？建议以账号 + purpose pack 为主，Agent 为可选限制。
- 用户否定一个 interpretation 时，是否保留支持它的 pattern？建议保留并记录否定边，除非用户要求一并忘记。
- 本地模型不可用时，local-only 是否只提供确定性事实与模式？建议如此，并明确展示能力差异。
- “值得确认”是否显示在“你”页面还是只在相关对话中出现？建议对话优先、页面汇总，但不产生待办压力。

## 19. 已实现基线（2026-09-24）

本轮已完成首期闭环的技术基线：

- SQLite v207 增加领域、模型层、目的、允许用途、Agent 范围、敏感类别、证据统计、授权收据、Observation 和 Assertion Edge。
- connector learning 使用不可变 consent receipt；字段白名单在模型调用前执行，处理位置取 grant 与 consent 的更严格交集。
- Gmail 分离发件与其他邮件流；Calendar、GitHub、Linear 的 owner attribution 进入统一 observation 管道。
- connector 原文按 consent 的 raw retention 清理；默认远程理解采用 derived-only，本地处理采用 bounded raw。
- 自动形成工作偏好、节奏、角色、责任、能力证据和有时效的当前目标；第三方内容不能形成用户事实。
- 当前回答按 query、scope、purpose、allowed use、Agent、时效和风险筛选个人模型。
- “你”页面展示事实/模式/解释层、独立来源数和来源说明；用户仍可直接编辑、停用或删除。
- 已确认模式只生成 inert action-rule suggestion；用户明确确认后才创建 active collaboration rule。
- 来源撤销会撤销 consent、删除 observation、移除对应证据、重算支持强度，并停止使用证据不足的推断。
- 健康及被标记为财务、政治、宗教、性取向、创伤、凭据等高风险自动推断保持关闭。

Outlook、Dropbox、Box 等后续来源只需接入相同 source item / consent / observation 契约，不新增旁路画像或 legacy 存储。
