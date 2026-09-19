# 连接器体验与多账号优化方案

日期：2026-09-19

状态：仓库侧阶段 A/B/C 已实现并完成分阶段自查；真实 Cloud/OAuth 联调仍属于发布前外部验收。第 2 节记录改造前基线，第 11 节记录实际交付与边界。

## 1. 目标与设计决策

普通用户只需要理解“应用、账号、允许做什么”。连接服务、项目密钥、自定义认证和诊断集中放在高级设置。默认使用 XOPC Cloud 托管，保留用户自带 Composio 项目的完整能力。

本次范围包括连接器目录、首次连接、账号管理、Agent 账号选择、执行权限、Cloud/BYOK、授权恢复、迁移与测试。通用产品外壳兼容 MCP、原生连接器等实现；本次完整多账号执行改造首先落到 Composio。其他适配器只展示实际支持的能力，不假设都支持多账号。

确定以下规则：

1. 一个应用下管理多个稳定账号；重复 OAuth 是授权更新，不是自动新增账号。
2. 用户别名可选，邮箱或工作区作为默认名称；不增加首次连接的必填步骤。
3. 首选账号、可用账号和任务所选账号分别建模。第一版不新增首选账号入口。
4. 一个账号直接使用；多个账号存在歧义时选择；一个任务可明确选择多个账号。
5. 每次外部操作只指定一个账号；跨账号任务分别调用、标注来源、合并结果。
6. 连接成功不自动开启内容学习、定时扫描或主动使用。
7. 本地执行权限与第三方 OAuth 授权范围分别表达，降低本地权限不声称已撤销第三方 scopes。
8. Cloud/BYOK 使用显式模式；每个账号的执行后端固定，不随当前全局模式偷偷变化。

## 2. 现状与缺口

以下基于本次工作区源码检查；Cloud 服务端不在本次已检查范围内。

| 领域 | 已实现 | 需要调整 |
| --- | --- | --- |
| 首次连接 | 通用安装弹窗，外部浏览器 OAuth，前端轮询 | 固定 36rem 高度，正文缺少 flex-1，footer 下残留空白；安装完成与授权成功混用 |
| 服务配置 | 有 Key 使用 BYOK，否则 Cloud；Key 保存前验证 | 缺少显式选择、替换/停用入口、项目隔离与切换语义 |
| 多账号 | Session 配置 multiAccount、最多 5 个、显式选择 | Cloud 客户端没有转发这些 Session 配置，云端上限需单独验证，不能宣称端到端统一限制 |
| 账号与授权 | SQLite account/connection 分层；前端聚合多条授权 | 别名、默认标记仍主要挂授权；策略引用 connection ID |
| 身份识别 | Gmail、Drive 邮箱；GitHub 用户名；Slack workspace + subject | 其他 toolkit 缺少强身份适配，不可保证重复授权去重 |
| Agent 执行 | 明确指定 connection；多账号时请求用户选择；支持同应用多个任务绑定 | 工具参数仍暴露易变化的 connection ID；绑定依赖 connection_resume 输入，不能认为覆盖所有后续输入 |
| 默认账号 | 存在 isDefault | UI 同时把 selectedConnectionIds 写成单个连接，混淆首选与权限 |
| 权限 | 应用级 Agent 限制、read/write/admin、执行确认 | 缺少账号级可用性；主 Agent 与直接执行等入口需要统一策略 |
| 学习 | 支持账号扫描与学习任务 | 明确用户同意及各入口一致性；接口回退 scanEnabled=true 不能被当成用户同意 |

代码入口：

- [首次连接](../../../web/src/features/connectors/components/install-connector-dialog.tsx)
- [账号管理](../../../web/src/features/connectors/components/composio-connector-panel.tsx)
- [账号展示聚合](../../../web/src/features/connectors/composio-connection-groups.ts)
- [Session 与授权适配器](../../../src/connectors/composio-sessions.ts)
- [Cloud 客户端](../../../src/connectors/composio-managed-client.ts)
- [Agent 执行](../../../src/agent/external-tools/composio-provider.ts)
- [连接恢复](../../../src/connectors/connection-recovery-service.ts)
- [账号存储](../../../src/storage/sqlite/connector-account-repository.ts)
- [权限检查](../../../src/connectors/policy.ts)

## 3. 产品信息架构

```text
连接器 /connectors
  已连接：应用卡片、可用账号数量、异常提示
  添加应用：搜索、分类、应用连接
  应用详情 /connectors/:connectorId
    账号列表、添加账号
    允许 XOPC 做什么
    高级设置（折叠）
      可用 Agent、账号使用范围、自定义认证、诊断
  页面更多菜单 → 应用连接服务

设置 → 高级 → 应用连接服务 /settings/connector-service
  XOPC Cloud 托管
  自己的 Composio 项目
```

路径为拟新增设计；复用现有 hash router 和设置导航，不新增无必要的全局导航分组。连接器页面更多菜单直接进入服务设置，避免用户只能在未配置时找到 BYOK。

应用目录默认展示品牌名称，不把 Composio、MCP 等技术来源当成应用名称。存在多种实现时选择兼容的推荐实现，高级设置提供来源详情；不静默合并不同后端的权限或账号。

### 3.1 首次连接

标准流程：选择应用 → 紧凑连接确认 → 外部授权 → 服务端确认账号 → 返回应用详情。

```text
连接 Gmail                                      ×
连接后可以查看邮件。发送等操作需要另外开启并确认。

□ 连接后开始了解我
  读取有限范围的近期内容，可在账号设置中关闭。

通过 XOPC Cloud 连接
                              取消   连接 Gmail
```

初始权限默认仅查看。文案根据实际配置生成，不在只读状态声称已经允许发送。学习选项只对有理解能力的应用出现，默认关闭，解释扫描范围。

Cloud 已就绪时不显示认证卡片。未登录时在同一流程完成 Cloud 登录，再继续原应用连接。服务暂不可用显示重试；缺少 Cloud 权限显示重新登录；应用认证未配置显示具体原因和高级设置入口。不能将所有故障都显示为“请登录”。

尺寸规则：简单连接确认使用约 30–32rem 宽、内容自适应、视口 max-height；应用管理放详情页。仍需复杂配置的 MCP 等通用弹窗遵循仓库固定响应式尺寸规范，header/footer 固定，正文 min-h-0 flex-1 overflow-y-auto。简单确认与复杂管理采用独立组件，不能直接把所有弹窗改为自适应。

等待授权时用明确状态、重新打开授权、检查结果和关闭按钮。关闭弹窗保留服务端 attempt，不撤销已有账号。授权失败时允许重试，不因安装记录存在而展示“已连接”。连接成功后自动刷新列表；显示已确认的账号身份，名称编辑可稍后完成。

### 3.2 应用详情与账号管理

```text
Gmail                                  添加账号

工作邮箱                              连接正常  …
mic@company.com

个人邮箱                              需要重新连接
mic@gmail.com                             重新连接

允许 XOPC 做什么
仅查看                              [选项选择器]

高级设置                                     ▸
```

账号主行始终显示真实身份；别名不能取代邮箱/工作区，以免两个同名账号无法区分。更多菜单提供修改名称、暂停使用、断开连接。扫描设置在支持学习的账号上按需展开，显示“了解此账号”和“主动提醒”的独立开关。

“断开账号”停用本地使用并撤销该账号在当前后端下的有效授权；失败时显示本地已停用、远端撤销待重试。历史导入内容单独说明保留状态，并提供现有内容管理入口，不默认删除内容，也不暗示仅撤销一个旧 authorization 就断开了整个账号。原始授权记录只放诊断。

当无法识别身份时显示“账号信息待确认”与可选名称编辑；不能仅凭别名合并账号。添加账号后若强身份与现有账号一致，提示“已更新此账号的授权”，保留原名称与设置。

### 3.3 用户权限界面

普通设置仅提供“仅查看”和“查看并执行操作”。默认仅查看；后者映射为 read + write，写入遵循执行确认。删除等 admin 操作仍需高级权限，不被普通“执行操作”暗中包含。

高级设置包括应用级可用 Agent、账号级可用 Agent、确认策略、特殊权限和认证方式。默认账号继承应用权限，账号覆盖只允许收窄。现有主动配置的高级策略迁移时保留，不无声重置。

新增账号默认可被应用已允许的 Agent 使用，且保持应用现有权限；界面在添加流程中展示当前权限摘要。用户可在高级设置中选择“仅允许选定账号”，此时新账号不自动进入允许范围。

## 4. 多账号与 Agent 行为契约

### 4.1 账号选择

先按用户身份、应用启用状态、后端可用性、Agent 权限、账号策略和有效授权计算 eligible accounts，再选择账号。Agent 不能通过提供一个 ID 绕过过滤。

| 情况 | 行为 |
| --- | --- |
| 用户明确指定邮箱或唯一匹配的别名 | 在允许范围内选定；不可用时说明原因，不回退到其他账号 |
| 当前目标已有账号绑定 | 复用绑定；新的明确指令要求变更时更新目标版本 |
| 仅一个允许的可用账号且没有冲突指令 | 自动绑定并执行 |
| 多个可用账号且有歧义 | 请求账号选择，不以默认排序猜测 |
| 用户明确要求多个账号 | 绑定有限、明确的账号集合，按账号调用 |
| 选定账号过期 | 对该账号发起重新连接，保留目标，不替换为另一个账号 |
| 定时任务未绑定且存在多个账号 | 标记需要配置，等待用户处理，不随机选择 |

别名匹配由服务端确定：真实身份精确匹配优先，其次规范化后的唯一别名。别名是非唯一展示字段；重名、模糊描述均要求选择。用户明确账号不在 eligible 集合中，即使只剩一个其他账号也不能自动使用。

聊天中的选择器只显示用户被允许看到的账号，支持按任务需求单选或多选。“查看全部账号”属于明确多账号读取选择，不意味着未来新增账号也自动纳入任务。

### 4.2 绑定生命周期

绑定属于 objective，不永久属于聊天窗口。目标内的连续工具调用、授权恢复、进程重启都保留绑定。独立新目标重新解析账号；用户明确切换账号时增加 objective revision，旧的等待和审批不能继续使用。

延续现有输入队列、ConnectionWait 和恢复机制，增加独立持久化的 objective-account binding，避免仅在 connection_resume 输入存在时才能取到绑定。连接等待仍只负责等待和恢复，不再充当所有账号绑定的唯一存储。

工作流/定时任务保存稳定 accountId 引用，每次运行验证。工作流明确配置的跨应用步骤分别绑定各自账号。账号重连不要求用户重配工作流。

### 4.3 Agent 工具契约

search/describe 返回允许范围内的账号摘要：opaque accountId、应用、别名、已验证身份、状态和本次目标已选账号。原始 Token、API Key、OAuth URL 和不允许访问的账号信息不进入模型工具上下文。

execute 接受宿主保留的 xopcAccountId。执行前从本地 accountId 解析当前可用 authorization，再向 provider 传 connected account ID。宿主参数与第三方参数分开定义，避免同名字段冲突。

跨账号任务一次执行仍选择一个 accountId；只读调用可并行，输出保留账号来源。部分账号失败时可报告其余账号结果，明确缺失范围。写入按照既有确认策略执行，审批明确显示账号、动作、对象和参数；跨账号写入的每项都需要被准确包含在批准范围内，不能凭一次 A 账号批准改用 B 账号。

审批校验绑定 principal、agent、objective revision、connector、accountId、action、参数摘要及有效期，且原子消费。账号授权变化后重新验证账号身份与有效权限；不因 connectionId 更新自动扩大允许范围。

### 4.4 示例

- “总结今天邮件”：一个账号直接执行；两个账号询问选择，支持明确选两个。
- “总结工作邮箱”：唯一精确别名匹配后使用工作账号，结果显示来源。
- “把工作邮箱附件存到个人 Drive”：分别绑定 Gmail 工作账号与 Drive 个人账号，写入批准明确显示目标 Drive。
- “用个人邮箱发给客户”：即使任务之前绑定工作邮箱，也要更新目标绑定，旧批准失效。

## 5. Cloud 与自己的 Composio 项目

### 5.1 高级设置流程

服务设置提供“XOPC Cloud 托管（推荐）”和“自己的 Composio 项目”。普通连接流程不出现项目密钥或 Auth Config。

BYOK 流程：打开 Composio Platform 项目 → 创建项目 Key → 粘贴 → 验证 → 保存并启用。验证结果区分凭证有效、Session 创建、认证配置读取、账号管理与工具调用所需权限。不能为了验证执行有副作用的动作；无法无副作用验证的权限明确标为待首次使用验证。

显示凭证来源（本地保存或环境变量）、验证时间、后端标签、可获得的项目标识；没有可靠项目标识时显示用户标签，不伪造验证结果。SecretInput 不回显完整 Key。提供替换 Key、停用 BYOK和控制台链接。环境变量凭证显示来源并提示通过运行环境变更，不能承诺在 UI 删除环境变量。

应用的自定义 Auth Config 在该应用高级设置内按需展开。可用托管认证时默认自动配置；必须自定义时显示明确准备步骤。Cloud 模式不显示无法使用的自定义选择器。

### 5.2 模式切换与账号归属

配置增加显式 mode 和 activeBackendId。activeBackendId 决定新连接使用的后端；现有账号一直绑定其 backendId。Cloud 与 BYOK 同时保留账号时，执行按账号所属后端路由，普通列表只在有歧义时显示后端小标签。

切换流程先验证新后端，展示受影响账号/任务，再提交配置。不存在“把旧账号当作新项目账号直接使用”的迁移。切回 Cloud 可以保留未启用的 BYOK 凭证；移除仍被账号依赖的后端时，必须明确其账号将不可用。

同项目 Key 轮换保留 backendId；更换项目创建新 backendId。没有可靠项目验证能力时，使用非破坏性的连接归属验证；仍不能确认时要求重新连接，不能仅凭 Key 文本不同认定换项目，也不能把 Key 哈希作为项目身份。

一个本地稳定安装标识用于 BYOK user_id 派生，取代依赖状态目录路径的新身份策略。老账号保留现有 providerPrincipalId，迁移不能重算后改变远端归属。Cloud 的 subject 与项目隔离由 Cloud 服务端确认，客户端不凭本地 user_id 假设云端归属。

## 6. 技术模型与服务边界

复用现有 connector_accounts、connector_connections、connector_installations、审批和审计结构；以下为增量字段概念，不是新建平行框架。

| 对象 | 关键字段与职责 |
| --- | --- |
| ConnectorBackend | id、provider、mode、owner/project binding、credentialRef、status；密钥不进入配置正文 |
| ConnectorAccount | id、principalId、connectorId、backendId、identityKey、label、enabled；稳定业务账号 |
| ConnectorConnection | accountId、providerConnectionId、providerPrincipalId、authConfigId、状态、能力快照；授权记录 |
| InstallationPolicy | 应用权限、Agent 范围、accountAccess={all 或 selected accountIds} |
| AccountPolicy | 继承或收窄应用权限；显式 none 与继承区分，空数组不能同时表达所有和没有 |
| ObjectiveAccountBinding | objectiveId、revision、principalId、agentId、connectorId、accountIds、选择来源 |
| AuthorizationAttempt | 发起者、backendId、connectorId、expectedAccountId、provider request、状态、过期时间、幂等键 |

账号去重的唯一边界为 principalId + backendId + connectorId + strong identityKey。优先使用供应商不可变 ID；现有邮箱/用户名匹配保留已验证行为并逐步改进。没有强身份不自动合并；跨 backend 不自动合并，避免跨项目策略和采集数据混用。

currentConnectionId 只作可用授权缓存，解析时检查后端、active 状态、认证配置和所需权限。不能仅取“最新 active”而忽略权限差异。重新授权返回其他身份时保留为独立账号，原目标继续等待正确账号确认。

新增/收敛四个应用服务：

- ConnectorAccountService：账号聚合、身份同步、名称、启停与账号断开。
- ConnectorAuthorizationService：统一设置页和聊天的 OAuth attempt、轮询、验证与状态更新。
- ConnectorAccountResolver：候选过滤、目标绑定、确定账号及授权。
- ConnectorExecutionService：统一策略、审批、执行与审计，供 Agent、手动执行、工作流、扫描调用。

扫描服务使用明确 accountId 和独立学习授权，不走“只有一个账号所以自动开始扫描”的逻辑。请求关联记录 requestId、objectiveId、accountId、connectionId、backendId 和阶段，遵循对象在前、消息在后的日志约定。

### 6.1 状态与失败处理

应用安装状态、服务配置状态、账号授权状态、学习状态分别存储，再聚合为 UI readiness。网络检查失败表示暂时无法验证，不直接把账号变成 revoked。

授权 attempt 状态：created → awaiting_user → verifying → succeeded；可进入 failed、expired、cancelled。超时不撤销账号；远端晚到成功可以更新账号，但不能自动恢复已经取消或变更的目标。后端绑定变化或授权前置条件变化时使旧 attempt 的恢复动作失效。

同步仅处理完整成功的远端快照中的缺失项；分页未结束或网络失败不能批量失效本地账号。需要核实 SDK list 的分页与 Cloud 列表合约。轮询采用退避与限流，不在每个页面请求中重复全量同步。

### 6.2 API 草案

以下路径均为拟新增或重构，执行时先核对现有路由避免冲突。

| API | 职责 |
| --- | --- |
| GET /api/connectors/:id/accounts | 聚合业务账号及状态，替代普通 UI 读取授权列表 |
| PATCH /api/connectors/accounts/:accountId | 名称、启用状态；权限修改独立校验 |
| POST /api/connectors/accounts/:accountId/disconnect | 账号级断开与结果反馈 |
| POST /api/connectors/:id/authorizations | 创建幂等 attempt，可带 expectedAccountId 与目标关联 |
| GET /api/connectors/authorizations/:attemptId | 授权进度，URL 仅给授权发起者 |
| GET/PATCH /api/connectors/:id/account-policy | 应用账号范围及按账号收窄策略 |
| GET /api/connectors/service | 当前模式、后端与凭证来源，不返回密钥 |
| POST /api/connectors/service/validate | 暂存候选凭证并返回短期验证引用 |
| POST /api/connectors/service/activate | 使用验证引用和配置版本提交模式/后端变化 |

聊天继续复用 ConnectionRecoveryService 的命令接口，选择 payload 改为 accountId 或明确 accountIds，使用 expectedVersion 与幂等键。变更任何选择前验证 principal、Agent、目标及 eligible 集合。

所有新增认证路由同步更新 lazy-bundles.ts 和映射测试，检查静态前缀与 :id 前缀优先级，并通过运行中的已认证 Gateway 验证真实路径。管理类写操作按现有 gateway scope 体系限制为有权管理者；普通会话选择只能作用于自己的目标。

## 7. 迁移策略

1. 使用下一可用 schema 版本，事务性增加 backend/account policy/objective binding 所需字段与表，不硬编码尚未确认的版本号。
2. 复用现有 accountId。将授权别名迁移到账号：优先现有当前授权别名，冲突保留在诊断中；不覆盖已存在账号标签。
3. selectedConnectionIds 按存储映射转换为 selected accountIds 并去重。空旧列表保留“所有”语义；非空列表全部失效时迁移为明确“无可用账号”，不能误转为所有。
4. 无法判断旧“默认”是偏好还是限制时保留限制，避免迁移自动放宽权限。提示用户到高级设置检查，不自动解除 selected 策略。
5. 根据当前凭证和可验证远端归属创建后端；历史无法归属的连接标记为待验证，不能直接归入当前项目。保留原 providerPrincipalId。
6. 所有有效工作流、等待、审批和审计引用检查兼容性。历史审计保留 connectionId，新增 accountId/backendId；待执行审批无法完整证明账号绑定时要求重新批准。
7. 工具契约新增 accountId 后，旧 connection 参数只在边界做受控解析：两者同时出现且冲突则拒绝；旧缓存契约失效并重新发现。迁移稳定后移除旧参数，避免长期双写。
8. 同步策略优先保留明确已有同意；缺少可证明同意的账号不新增扫描授权。关闭学习停止后续采集，已有内容按独立管理策略保留。

上线前备份数据库和配置，失败自动回滚未提交事务。迁移后回退旧二进制需要恢复匹配的备份或经过验证的降级方案，不能只回退前端。

## 8. 分阶段实施

### 阶段 A：简单用户路径与明确状态

- 拆分紧凑连接确认与通用复杂安装弹窗，修复 footer 布局。
- 应用详情以账号列表为主，技术字段收纳到高级设置。
- 分离 installed、authorized、ready，明确失败及重试路径。
- 删除“设为默认同时限制其他账号”的联动；停止新增默认入口，保留已有策略。
- 提供固定可发现的应用连接服务入口；模式切换功能依赖阶段 B 后再开放。

验收：已配置服务连接 Gmail 只需连接确认和供应商授权；添加第二账号可见且不意外改变第一账号权限；未授权成功不能显示已连接；简单弹窗没有无意义大片空白。

### 阶段 B：账号与后端模型

- 持久化显式 mode/backend，实现凭证验证、轮换、后端归属及切换。
- 完成稳定 accountId 策略、授权 attempt 和身份归一化迁移。
- 同一账号重连保留名称、权限、扫描设置和工作流引用。
- Cloud 合约核实/补齐：归属、认证状态、多个账号、显式执行账号、错误码及限制。

验收：同项目轮换不丢账号；换项目不误用旧授权；重连不改变业务账号；Cloud/BYOK 两条链路分别验证。

### 阶段 C：Agent 与工作流一致使用

- 接入统一账号解析、目标绑定和执行服务。
- 明确 accountId 工具契约、单/多选聊天交互、账号绑定审批。
- Agent、手动执行、工作流、扫描统一权限判断。
- 跨账号读取保留来源、部分失败可解释，目标变更使旧批准失效。

验收：单账号无多余提问；多账号不猜测；当前目标持续使用所选账号；后台任务可确定账号；发送确认显示且绑定正确账号。

阶段 A 可先发布体验改善；完整多账号方案须在 B+C 验收后才能宣称完成。账号级 Agent 权限随 C 的统一策略一起交付，普通页面仍保持继承默认值。

## 9. 验证矩阵与发布判定

| 场景 | 必须成立 |
| --- | --- |
| 两个邮箱无指向请求 | 明确选择，不依赖默认排序 |
| 指定账号无权限，另一个可用 | 拒绝或请求权限，不能替换账号 |
| 同一账号重复 OAuth | 强身份一致时一个业务账号、多条诊断授权 |
| OAuth 返回其他身份 | 不重写原账号，不恢复原账号目标 |
| 重连与旧 selected 策略 | 新授权通过稳定 accountId 继承原限制 |
| 审批后更换账号/参数/目标 | 旧审批不可消费 |
| 跨两个账号读取 | 每个调用锁定账号、输出有来源、部分失败明确 |
| 多账号后台任务 | 明确绑定，否则需要配置 |
| 关闭“了解我” | 不新增内容扫描与主动使用，工具连接仍可用 |
| Cloud ↔ BYOK / 不同项目 | 不混用凭证、授权、账号策略和待执行批准 |
| Key 验证网络失败 | 原有效配置继续存在，不误报 Key 必然无效 |
| 授权关闭、超时、重启、晚到结果 | 账号状态可恢复，已取消目标不自动执行 |
| 网络/分页失败 | 不错误批量撤销账号 |
| API 经 Gateway lazy loader | 正确命中路由与鉴权，而非仅模块内测试通过 |

重点自动测试放在账号解析、策略组合、迁移、审批绑定、后端选择和恢复状态机；界面验证覆盖中英文、窄屏、深浅色、键盘焦点、错误恢复。数据加载用 skeleton；选择控件复用项目组件；授权窗口复用已有 Electron/Web 打开逻辑，避免异步打开导致 popup 被阻止。

运营观察采用聚合指标：连接开始到成功的转化率、身份识别失败率、重新授权次数、账号选择次数、任务恢复成功率、错误码分布。日志不得采集完整凭证或内容，也不为统计额外记录邮箱正文。

## 10. 实施前需核实的外部边界

- Cloud 服务是否实施与 BYOK 相同的多账号上限、所有权检查和显式账号执行约束；客户端配置本身不构成云端保证。
- SDK/Cloud 对稳定项目标识、分页、认证刷新、账号身份和实际 scopes 的可用程度。
- Composio toolkit 的身份适配逐步覆盖；不支持可靠身份的应用采用明确未知状态。
- 现有 Agent 写入批准消费及直接执行入口需要统一检查，防止账号绑定遗漏；方案不以已有 UI 说明替代执行校验。

本次讨论参考的官方资料：

- [Connected accounts](https://docs.composio.dev/docs/auth-configuration/connected-accounts)
- [Tool Router sessions](https://docs.composio.dev/kb/guide/mcp-tool-router-sessions)
- [Authentication](https://docs.composio.dev/docs/authentication)
- [Project API key permissions](https://docs.composio.dev/kb/guide/platform-project-api-key-permissions)

实施时按仓库锁定的 SDK 版本和 Cloud 合约验证，不将在线文档的最新行为直接当作当前部署保证。

## 11. 实施记录与最终自查

### A：用户界面

- 首次 Composio 连接使用紧凑确认布局；通用复杂安装弹窗保留固定高度和内部滚动。复用同一组件的两个布局分支，不引入重复表单实现。
- 账号列表支持别名、暂停/启用、重连和断开；账号级 Agent 权限及授权明细折叠显示。没有“默认账号即唯一允许账号”的行为。
- 连接服务独立在 `/settings/connector-service`；Cloud 为简单路径，BYOK、项目选择、密钥更新和移除在高级区域。
- 学习默认关闭；不支持学习的 toolkit 不展示同步/扫描开关。托管模式不展示用户不可配置的 auth config 表单。
- 自查修复：授权窗口预打开避免浏览器拦截、失败后可重试、窄屏按钮换行、环境变量密钥移除文案不承诺删除环境变量。

### B：稳定账号、后端与授权

- SQLite migration 182 将策略转为稳定 `selectedAccountIds`（`null` 为全部、空数组为不允许），增加账号权限、后端注册、授权记录和安装身份。
- 后端注册存入现有数据库，而非在配置文件、进程状态和数据库各保存一份；凭证继续使用既有 CredentialResolver。旧 Key/env 只在首次建立后端时导入，此后不做动态 fallback。
- 每个账号保留所属后端。切换仅影响新授权；已有账号执行、刷新、撤销使用原后端。Key 轮换验证原账号访问后才保存。
- 授权记录有效期 10 分钟，可以重新打开授权或继续检查；完成/失败/过期清除 URL。重连身份不符不会替换原账号目标。
- 支持 Gmail、Drive、GitHub、Slack 的强身份归一化。其他 toolkit 保留独立账号，不猜测同一身份。展示身份采用字段白名单，不透传 provider token。
- 自查修复：账号分页完整读取、重复 cursor 拒绝、网络失败不批量撤销、授权记录级联删除、旧账号 auth config 不受当前项目配置覆盖。

### C：Agent、审批与工作流

- 工具统一使用 `xopcAccountId`；每次操作解析当前授权并检查应用策略、账号状态和 Agent 限制。无歧义单账号直接使用，多账号不依赖排序或默认标志。
- 目标绑定复用既有会话输入与 connection wait；独立新输入是新目标，不让旧账号选择变成永久隐含权限。多账号任务逐账号调用并在结果中携带来源。
- 审批绑定账号、参数、Agent、会话和目标；通过已有暂停/恢复机制继续原目标，不创建丢失批准的新目标。账号/参数/目标变化不能复用旧批准。
- 工作流要求可声明 `connectors[].accountIds`。预检结果固化到本次 workflow-run 元数据，子工作流继承；指定账号失效阻止执行，不替换成其他账号。
- 复用现有 service、adapter 和 repository；没有按草案额外建立平行解析/执行框架。历史数据库字段只为一次性迁移及已有存储结构保留，不恢复默认账号路由。

### 验证与边界

- 相关自动测试覆盖 connectors、workflows、tasks、迁移、Gateway 路由和前端账号分组；真实本地 HTTP 测试经过鉴权及 lazy bundle 加载。
- `node scripts/test-connectors-visual.mjs` 验证 Gmail、Airtable、连接服务页 × 桌面/窄屏 × 深浅色，共 12 组。可用 `CHROME_EXECUTABLE_PATH` 指定本机 Chrome；截图写入临时目录，不覆盖用户数据。
- root TypeScript、Web TypeScript/生产构建、修改范围 ESLint 和 diff whitespace 检查均纳入最终验证。构建仍有既有 bundle 大小/混合动态导入提示。
- 未使用真实用户密钥测试写操作，未改动用户运行数据库。Cloud 服务端不在此仓库，其多账号限额、项目身份及远端所有权校验仍需部署环境联调；客户端测试不等于该外部验收通过。
- SDK 未提供本次使用路径下的可靠项目 ID；Key 轮换通过现有连接可访问性校验。无现有连接时不能证明两个 Key 属于同一项目，不声称完成项目身份认证。
- 恢复来源为 Git stash `7c920870`，使用 apply，原 stash 保留；无关 UI 修改不属于本次实现，未回滚或重写。
