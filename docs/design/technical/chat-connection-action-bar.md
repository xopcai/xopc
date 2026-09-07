# Chat 单一连接操作区：产品交互与技术方案

状态：待实现的完整设计。决策日期：2026-09-07。源码核查基线：`aa6a22c15`。

用户已选择「历史提示 + 单一连接操作区」。本文替代前一版逐卡片维护状态的产品方案；[竞品调研与源码背景](/Users/micjoyce/develop/github/xopc/docs/design/technical/chat-capability-recovery.md)仅作为研究记录。

## 1. 产品决定

连接请求是当前工作的一个前置条件。**聊天记录解释发生过什么；输入框上方唯一的连接操作区处理现在需要做什么；Connectors 页面管理长期账号和权限。**

不在每次工具调用后插入连接卡片，不在历史消息上保留「连接并继续」按钮。历史无需轮询和更新；当前操作区由服务端快照生成。

实现只增加一个领域对象：当前会话的 `ConnectionWait`。复用 connector 账号和认证状态、SQLite transcript、session input queue 和领域 TaskRun。OAuth attempt 属于已有认证适配层，不建立通用 capability-request 平台，不另建续跑 outbox。

### 产品边界

- 第一版每个会话实例支持一个待恢复的前台目标，可包含多个连接依赖。
- 同一目标下相同账号的同类依赖合并；不同账号不能因为都是 Gmail 就合并。
- 用户可以在等待期间补充要求或做不依赖连接的工作。
- 不把所有新消息都当作取消旧目标。新目标也需要连接且与旧目标无关时，让用户在一个简短选择中决定处理哪个；第一版不暗中累计多个自动恢复目标。
- 不自动创建用户可见 Task。若聊天本身属于 Task，复用该 TaskRun；普通 Chat 只保存恢复所需上下文。
- 用户连接成功后能继续原目标，但不承诺对未知结果的第三方写操作自动重放。

## 2. 信息架构与布局

### 2.1 Chat 时间线

首次遇到当前目标的连接缺口，记录一次简短提示：

> 整理这些邮件需要连接 Gmail，连接后我会继续。

同一个缺口被模型再次发现时不追加这句话。任务范围更新可以正常回复，但不重复解释未连接。

成功恢复时记录一次：

> Gmail 已连接，继续整理邮件。

跳过时记录一次：

> 本次跳过 Gmail。你可以粘贴邮件内容，我会继续整理。

以上是不可执行的历史记录，无 OAuth 链接、运行按钮、动态账号状态。以后账号失效，不改写过去的成功记录。系统生成的提示与正常助手回答使用同一 transcript append 路径，带隐藏的去重事件键；不调用 turn-end `SessionStore.save`。

### 2.2 唯一连接操作区

位于 Chat composer 内部的输入区上方，紧邻当前输入，固定在 composer 布局中，不使用覆盖页面的悬浮层。与上下文条、待发送消息分别分组，避免嵌套多张卡片。

默认结构：

```text
Gmail 尚未连接                           [连接并继续]
用于整理最近 7 天的未读邮件            本次跳过 · 其他连接器
──────────────────────────────────────────────────
继续补充要求…
```

- 首行说明状态，次行说明目的；一个主按钮。标题不使用「缺失能力」「runtime」等工程词。
- 单依赖默认约 76–100px，文本换行时自适应；窄屏将按钮移到第二行，输入框不能被遮挡。
- 多依赖折叠成「需要连接 2 个应用 · Gmail、Calendar」，主按钮「处理连接」；展开到固定尺寸对话框，逐项操作，不堆多个操作条。
- 次要操作为「本次跳过」「其他连接器」；账户、权限和错误详情放进详情对话框。
- 无需求时不占位；等待页刷新时可用一段紧凑 skeleton，不能先闪现旧的 Connect。
- 授权等待不循环显示忙碌动画；只有用户点击后短时网络操作、验证显示按钮级进度。
- 连接并验证完成后显示「已连接，准备继续」，执行实际领取后移除操作区；不以固定计时器代替真实调度状态。

### 2.3 其他表面

| 表面 | 显示内容 | 点击行为 |
|---|---|---|
| Sidebar 会话 | 需要操作的轻量标记；正在处理其他输入时 running 优先，仍可显示待处理标记 | 打开会话，定位当前操作区 |
| Tasks | 有关联 TaskWait 时显示「等待连接 Gmail」 | 打开该任务的执行会话 |
| Connectors 页面 | 全局账号、授权、启用状态 | 连接状态变更同步当前操作区 |
| 聊天历史 | 当时的提示与结果 | 普通文字，不恢复历史任务 |
| 通知 | 新增确需用户处理的等待时至多一次；前台可见时不另发系统通知 | 打开当前会话；账号重新失效不改动历史通知 |

此功能不新增独立「连接请求中心」。

## 3. 状态与文案

下表是 UI 投影，不是各自持久化的状态机。后端结合当前等待、账号、认证 attempt、工作上下文计算。

| 当前情况 | 标题 / 说明 | 主操作 | 次操作 |
|---|---|---|---|
| 没有依赖 | 不显示 | — | — |
| 未安装，但可直接安装授权 | Gmail 尚未连接 / 用于整理邮件 | 连接并继续 | 跳过、其他连接器 |
| 已安装未授权 | Gmail 尚未连接 | 连接并继续 | 同上 |
| 多个账号，目标不明确 | 选择用于整理邮件的账号 | 选择账号 | 连接新账号、跳过 |
| 当前凭证无法刷新 | Gmail 需要重新连接 | 重新连接并继续 | 详情、跳过 |
| OAuth 正在等待浏览器 | 在打开的页面完成 Gmail 授权 | 重新打开授权 | 检查状态、稍后处理 |
| 授权 attempt 超时 | 这次授权已超时，任务已保留 | 重新打开授权 | 跳过 |
| 用户拒绝授权 | Gmail 尚未连接 / 你取消了这次授权 | 重新连接 | 跳过 |
| 正在验证 | 正在确认 Gmail 账号和访问权限 | 验证中，不可重复提交 | — |
| 就绪，具有有效继续意图 | Gmail 已连接，准备继续 | 排队中 | 取消继续 |
| 在设置页连好，无当前继续意图 | Gmail 已连接 / 原任务尚未继续 | 继续整理邮件 | 跳过 |
| 目标范围需更新确认 | 已保留之前的邮件整理任务 | 查看并继续 | 跳过 |
| 连接基础服务未设置 | 连接 Gmail 前需要完成服务设置 | 完成设置 | 跳过 |
| 策略不允许 / 管理员禁用 | 当前无法使用 Gmail / 简短原因 | 查看原因 | 其他连接器、跳过 |
| 网络或服务暂时失败 | 暂时无法检查 Gmail 连接 | 重试 | 稍后处理 |

规则：

1. access token 可自动刷新时直接刷新；不打扰用户。不能把所有 401、403 或网络错误都归类为重新授权。
2. 展示「本次读取邮件」不等于声称 OAuth 只申请读取权限。详情列出实际授权范围、账号及管理入口。
3. 未配置 Cloud / Composio BYOK / custom auth config 时明确指出前置设置；不能先显示一个注定失败的跳转按钮。
4. 完成设置回到本会话后重新检查；设置成功不自动等于同意执行旧任务。
5. 「稍后处理」只是收起为一行「邮件整理等待连接 · 处理」，不产生跳过或取消记录；保留账号授权流程，在有效继续意图内完成仍可续跑。文案中说明连接后将继续。若用户希望不继续，应使用「取消继续」或「跳过」。

## 4. 完整用户路径

### 4.1 首次使用 Gmail

1. 用户：「整理 Gmail 最近 7 天的未读邮件」。
2. 工具发现用户指定 Gmail，服务端确认没有可用连接；只推荐 Gmail。
3. 保存原目标、解析后的时间范围、所需能力和执行检查点；追加一次历史提示。
4. 若还有可独立执行的工作，先完成；随后结束当前模型执行，呈现连接操作区。
5. 用户点击「连接并继续」。后端校验本次目标版本、账号策略和安装计划；如可按已展示权限直接设置则安装并创建 OAuth attempt。有额外本地执行或高权限配置时，展示具体安装计划后再确认。
6. 浏览器打开授权页；操作区显示等待授权。链接在本次点击后产生。
7. 后端从可信 provider 校验精确账号、有效授权、本地执行策略和所需工具。
8. 条件满足后把原目标的继续输入写入现有队列。
9. worker 实际开始处理时收起操作区，并继续产生邮件摘要。用户不重新输入任务。

### 4.2 重复识别和修改要求

「只看客户邮件」「按紧急程度排序」属于同一目标更新：沿用同一个 waitId，增加 objectiveRevision，更新说明和检查点。正在进行的账号授权可继续完成，但旧版本的自动续跑意图失效；新的范围已由用户明确授权且可被可信协调器确认时重新建立意图，否则显示「继续整理邮件」。不能让晚到回调用旧参数执行。

模型重复请求 Gmail 不改变 objectiveRevision，不重置 OAuth attempt，不重复输出提示，不延长授权意图有效期。

### 4.3 等待期间发新消息

| 用户输入 | 行为 |
|---|---|
| 补充原目标 | 更新原目标，保留唯一操作区 |
| 询问状态 | 简短回答，保持等待 |
| 另一个无需连接的小任务 | 正常执行；旧连接等待保留为一行，新的生成不被 OAuth 打断 |
| 明确取消 / 替换 | 清除旧继续意图，取消其尚未领取的续跑，执行新目标 |
| 不相关的新任务也需要另一个连接 | 单一操作区提示「先处理哪项？」：继续原目标 / 切换到新目标。切换后旧目标记录保留，但不再自动续跑 |

新用户输入到达时，先暂停自动调度权限，再处理该输入的目标关系；不能在消息尚未处理时让 OAuth 回调抢先启动旧工作。无关小任务不删除等待，回答后显示「继续整理邮件」即可。

这里采用明确的第一版边界：一个前台可恢复目标。多个真正独立的长期目标应使用已有独立 Task / 会话；不靠连接操作条承担多任务调度。不得自行创建这些 Task。

### 4.4 跳过、取消与停止

- 单依赖「本次跳过」：记录该目标不使用此连接，清除操作区。以一次 typed continuation 通知 agent 做替代方案 / 汇报未完成部分；已有新用户输入时将结果并入下一次处理，不抢先恢复旧目标。
- 多依赖：默认展示「选择要跳过的应用」；单项跳过只移除依赖它的步骤。全部跳过必须使用明确文案。
- 跳过后，同一目标的 suppression 进入恢复上下文，防止 agent 再次提出相同连接。用户明确改为连接，才清除 suppression。
- 等待期间没有正在执行的模型请求，composer 不显示假的 Stop；有新的执行时 Stop 只停止那次执行。操作区的「取消继续」或明确取消原目标，才取消连接等待的恢复意图。
- 取消恢复不主动撤销已经获得的 Gmail 账号连接；回调可更新账号事实，但不能重新启动被取消目标。

### 4.5 多应用与其他连接器

同一目标「总结邮件并核对日历」可聚合 Gmail 和 Calendar 两项。主区只有一个入口，展开对话框中每项展示一个账号、状态和操作。按当前已知的全部必需依赖判断就绪；不具备全部依赖时不能将整个目标标为可执行。可独立步骤在挂起前尽量完成，未知的新依赖可在后续执行中再次进入同一操作形态。

「其他连接器」打开相关目录，保留全部目录入口。Gmail 已被用户明确指定时，选择 Outlook 会展示「改用 Outlook 整理邮件」的任务变更确认；连接其他无关应用不会解决 Gmail 等待。多个技术实现（native、MCP、Composio）在产品上默认合并为一个品牌，使用服务端兼容且受允许的推荐实现。

### 4.6 长时间未处理、历史和再次失效

- 卡片不存在于历史，只有提示文字。操作区在打开会话时从当前快照还原。
- 原目标有效且明确：即使很久未点击也能生成新授权链接。OAuth attempt 过期只影响授权尝试。
- 原目标存在时间歧义：点击「查看并继续」先选原绝对日期范围或截至今天的范围，再开始连接。保留原表达、解析时间、时区；没有快照不能还原原日期的未读集合。
- 原目标完成、被替换或 session reset：操作区消失，旧客户端动作返回最新快照，不执行旧工作。
- Gmail 后来再次失效：当前新目标建立新的等待，历史成功提示不变。普通 token 刷新失败且确需用户操作时才展示重连。
- 在其他页面连接：只刷新就绪状态。没有仍有效的「连接并继续」意图时，显示「继续原任务」，不执行所有历史目标。

### 4.7 刷新、关闭页面和重启

刷新或切换会话不取消等待。前端关闭后，已点击「连接并继续」仍表示后台可以在本次授权完成后继续，前提是目标和账号未变、授权意图仍有效。系统不能依赖前端常驻轮询。

MCP 的本地 OAuth 进程重启可能使原 attempt 不可继续：保留 ConnectionWait，重新打开授权。Composio 可查询已有 providerConnectionId 的结果，重新核实后再决定继续。

## 5. 数据模型：一个等待快照

### 5.1 三个事实源

| 数据 | 唯一事实源 |
|---|---|
| 账号连接、权限、凭证、OAuth 生命周期 | 现有 connector / auth adapter |
| 当前目标在等待什么、用户是否要求继续 | 新增 ConnectionWait |
| 后续执行是否已排队、领取、完成 | 现有 session_inputs；关联 TaskRun 使用既有任务模型 |

前端无第二份业务状态机。历史消息无连接状态。TaskWait 是关联任务的投影，不是另一套可独立解决的认证记录。

### 5.2 提案类型

```ts
type ConnectionWait = {
  id: string;
  principalId: string;
  sessionKey: string;
  sessionId: string; // 会话实例；reset 后变化
  objectiveId: string; // 从原始用户输入派生，不按 toolCallId 生成
  objectiveRevision: number;
  agentId: string;
  originInputId: string;
  originRunId: string;
  taskRunId?: string;
  status: 'open' | 'queued' | 'closed';
  resolution?: 'continued' | 'skipped' | 'cancelled' | 'replaced';
  objective: {
    summary: string;
    checkpointEntryId: string;
    timeRange?: { from: string; to: string; timezone: string; expression: string };
  };
  needs: Array<{
    key: string;
    connectorId: string;
    accountId?: string;
    accountSelector?: string;
    capabilities: string[];
    requiredScope: 'read' | 'write' | 'admin';
    required: boolean;
    skipped?: boolean;
    authAttemptRef?: string; // 不存 OAuth URL 或 token
    providerConnectionId?: string;
  }>;
  resumeIntent?: {
    objectiveRevision: number;
    acceptedAt: number;
    validUntil: number;
  };
  queuedInputId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};
```

SQLite 使用 `session_connection_waits`，needs、objective、resumeIntent 为经 Zod 校验的 JSON。为 `(principal_id, session_id)` 建 `status IN ('open','queued')` 的唯一索引。会话只有一个当前操作区；closed 记录仅为审计与引用保留，随会话清理，不作为用户待办集合。

`version` 用于并发控制，所有更新递增；`objectiveRevision` 只在目标、账号选择或范围改变时递增。UI 轮询、OAuth 状态检查和重复工具请求不改变目标版本。

需要的合并键为 `connectorId + account selector + principal`，capabilities 做集合合并。本地 read/write/admin scope 取满足目标所需的最小并集；权限提升不能隐式沿用原先只读继续意图。

### 5.3 不持久化的 UI 状态

`hidden / needs_connection / authorizing / checking / retryable_error / ready / review / queued` 由服务端投影生成。新产生的错误由认证适配层或 wait 的受限诊断字段保存；不为每种文案新增状态迁移表。

自动续跑意图只覆盖最近一次明确点击和匹配的目标版本。建议 MVP 默认有效 30 分钟，这是 xopc 的可配置产品策略，不是第三方 OAuth TTL；超过后只转为「继续原任务」，不删除等待。再次主动点击可以重新建立意图。写动作审批使用原本更严格的期限。

## 6. 能力发现与模型工具

### 6.1 搜索扩展

扩展现有 `xopc_tool_search` 响应，新增 `connectionCandidates`。可信目录可在服务不可访问时提供基础元数据；它只说明支持哪些连接，不暴露未授权工具执行入口。

```ts
type ConnectionCandidate = {
  candidateRef: string;
  connectorId: string;
  title: string;
  capability: string;
  reason: 'not_installed' | 'not_connected' | 'reauthorize'
    | 'choose_account' | 'setup_required' | 'policy_blocked';
};
```

第一版为 Gmail / Calendar / Drive / Slack / Notion 建少量人工能力映射、中英文别名及服务优先级；Gmail 先完成验收。优先用户指定品牌和账号，其次可用工具，再选允许安装的候选。网络异常走 sourceErrors，不能生成「没连接」假结论。

### 6.2 一个具体工具

新增 `xopc_require_connection`，入参仅为候选引用列表和当前目标的一句用途，工具的宿主上下文提供 principal、sessionId、objectiveId、runId、agentId。目标修改通过明确的当前输入关系更新，不能让模型传入其他用户或会话标识。

- `search` 只读，不制造等待。
- `require_connection` 后端确认缺口后 upsert 当前 ConnectionWait，合并重复依赖。
- `execute` 中遇到真实认证缺口，复用同一服务生成需求，不要求模型再次猜测。
- 现有 Composio `Connect <toolkit>` 合约改为走此服务，不再返回给模型裸授权 URL。
- 用户拒绝 / 跳过同一需求后返回 `skipped_for_objective`，不重新打开操作区。
- 有同类可用账号时返回 ready / choose_account；不是所有缺少候选都要 OAuth。

工具结果包含 `waitingForConnection` 标记和 `waitId`，但不承诺工具已执行。一次外部写调用结果不明确时先走原错误处理，不把它包装成可安全重试的认证缺口。

## 7. 挂起与继续执行

### 7.1 已有真实落点

当前 [run-turn.ts](/Users/micjoyce/develop/github/xopc/src/agent/embedded/run-turn.ts) 已装配 `beforeToolCall`、`afterToolCall` 和 `shouldStopAfterTurn`，可在现有 turnPolicy 上组合一个 connection-wait policy。不要另开无期限 Promise，也不要伪装成用户 abort。

处理顺序：

1. 服务端事务保存等待和必要 TaskWait，追加一次检查点 / 历史提示事件，返回合法 tool result。
2. 同一模型批次中的独立工具按既有规则完成；依赖缺失连接的调用被拦截并返回结构化等待结果。对尚未持久化的并发工具结果不得提前结束会话。
3. `shouldStopAfterTurn` 在安全边界结束循环，结果增加 `stopReason='connection_required'` 与 waitId。
4. 不触发默认的「验证代码修改后再继续」循环，不因正常等待重试模型。
5. gateway 把本次执行标为 `suspended`，关闭 run stream 并释放 lease；领域目标仍在等待。

现有 [run-gateway-agent.ts](/Users/micjoyce/develop/github/xopc/src/gateway/service/run-gateway-agent.ts) 目前会将无异常返回映射为 success；必须贯通修改 turn dispatcher、stream mapper、run-end 通知、TaskRunCoordinator、session-input coordinator，而不是只改前端文案。

### 7.2 复用现有输入队列

[SessionInputCoordinator](/Users/micjoyce/develop/github/xopc/src/gateway/service/session-input-coordinator.ts) 与 [session-input-repository.ts](/Users/micjoyce/develop/github/xopc/src/storage/sqlite/session-input-repository.ts) 已提供持久化输入、expectedSessionId、`UNIQUE(session_key, client_message_id)` 和串行领取。

新增可信的 internal input kind：`connection_resume`，其 payload 引用 waitId、objectiveRevision、resolution、checkpointEntryId 和绑定账号。不是伪造一条用户聊天消息「已授权，请继续」；内部 payload 也不能由公共输入 API 任意提交。

建议扩展 `session_inputs.kind`（默认 user）与经验证的 continuation JSON；原始输入暂停后标为 `suspended`，从 active runtime 释放，不进入自动领取集合。`finishSessionInputRun`、SQLite CHECK 和恢复逻辑同时扩展。会话普通用户输入仍正常排队。

准备恢复时：

```text
事务开始
  校验 sessionId / wait version / objectiveRevision / 当前目标 / 继续意图
  确认连接 readiness 的检查结果仍对应当前账号与授权版本
  插入 connection_resume 输入
    clientMessageId = connection:<waitId>:<objectiveRevision>:<resolution>
  wait.status = queued，记录 queuedInputId
  关联 TaskWait 按所选调度所有者同步更新
事务提交
唤醒现有 worker
```

事务里只做同步 SQLite 操作；provider 网络查询和媒体准备在事务外完成，提交时再校验绑定版本。网络结果过旧或版本不符则重新检查。

此事务本身就是 durable resume intent：崩溃在提交前无续跑；提交后即使唤醒信号丢失，现有 queue recovery 仍可恢复。无需为这个功能另建 outbox。执行去重键直接使用已存在的队列唯一约束。

跳过是独立分支：同一事务将 wait 关闭为 skipped，并插入 `resolution='skipped'` 的内部输入，让操作区立即消失。这条输入只能告知 agent 缺失数据、执行替代方案，不能发起 OAuth 或执行被跳过的依赖。worker 允许精确匹配的 closed/skipped 记录处理这一结果；已有更新的用户输入时，把跳过结果与 suppression 合入该输入的上下文并消费这条内部输入，不额外抢跑一轮旧目标。

### 7.3 任务路径只允许一个调度所有者

- 普通 Chat：ConnectionWait coordinator 直接向 SessionInputCoordinator 入队。
- 已有 TaskRun：TaskRunDispatcher 是唯一的任务恢复调度入口，增加专用 `enqueueConnectionContinuation` 方法。wait readiness / resolution 通知此方法，它不依赖 `claimNext` 先领取一个仍有 active wait 的任务；它在事务中幂等入队 typed continuation、记录 queuedInputId，并解决对应 TaskWait。它不再对这个 continuation 直接调用第二次 agent prompt。
- TaskRun 领取增加“此恢复已有 queued/running input”的过滤，避免 lease 到期重新直启；输入真正被领取时才更新实际执行状态。
- gateway runId 是执行尝试标识，taskRunId 是领域运行标识；二者分开传递。TaskRunCoordinator 使用已有 taskRunId，不为续接新建第二个 root run。
- readiness、wait resolution 与 continuation 入队的关系要通过同一仓储事务完成，或保持 TaskWait active 直到幂等入队成功；不能先解锁 task wait 再异步创建输入而留下竞态。
- 第一版不同时让 connector callback 和 TaskRunDispatcher 各自启动一次执行。现有定时任务、workflow 的认证恢复不作为首发渠道，沿用已有失败/人工处理提示，后续接入同一协调器。

通用任务 `resolve_wait` 对 `condition.type='connection'` 必须委派此协调服务，不得绕过连接验证直接解锁。TaskWait 的人工取消仍映射为取消原目标的继续意图。

### 7.4 执行前的最后检查

worker 领取 `connection_resume` 后检查 wait / session / objective 是否匹配、继续意图是否仍有效、是否有更早到达尚未处理的用户纠正。取消或不匹配时取消该输入并回到当前快照，不执行旧操作。

连接继续分支验证通过后消费这一恢复版本，把 wait 关闭为 continued，并加载检查点与当前工具合约。跳过分支遵循上文的 closed/skipped 规则。新执行中连接再次失效可建立下一次 ConnectionWait；旧等待是审计事实，不复活。

运行 checkpoint 包含原目标、已完成步骤、未完成步骤、时间范围、账号选择、跳过需求和已知工具结果引用。不复制 token，不依赖模型从几百条历史自行猜测恢复位置。恢复的是未完成工作，不重放整个工具调用列表。

## 8. OAuth 与身份约束

### 点击时生成链接

前端同步预留 popup，然后调用后端 action；复用 [oauth-authorization-window.ts](/Users/micjoyce/develop/github/xopc/web/src/features/settings/oauth-authorization-window.ts)。没有跳转必要时关闭空白 popup。Electron 走系统浏览器；popup 被拦截时提供明确的“打开授权页面”链接，链接仅属于当前 attempt。

`Connect` 的 GET 展示不执行授权。实际授权由用户 POST action 发起。授权 URL 不存进 transcript，不出现在长期等待快照。每项需求至多关联一个当前有效 attempt；重复点击复用，失败/超时则替换，旧 attempt 的回调不能覆盖新绑定。

### 授权与验证

复用 [auth-provider-registry.ts](/Users/micjoyce/develop/github/xopc/src/connectors/auth-provider-registry.ts)，但入口要显式接收已认证的 principal、目标 installation 和账号上下文。不能沿用面向本地 owner 的隐式默认值处理其他用户的聊天。

OAuth adapter 返回状态不直接表示目标可运行。需要验证：

1. provider 可信查询返回的 connection / account 与本次 attempt 相符。
2. 身份是目标账号；选择另一账号时必须明确更新目标。
3. OAuth 实际授予范围、本地 maxScope / allowedAgentIds / selectedConnectionIds 均满足要求。
4. 目标工具确实可以发现，describe 合约有效；恢复时使用当前 revision。

无侵入性验证优先使用 token/账号/工具元数据；不能用发送邮件作为连通性检查，也不为了显示 ready 扫描整个邮箱。

新账号授权完成后自动跳入另一个窗口不代表授权失败；关闭 popup 也不代表用户拒绝。成功以 provider 校验为准。

### 无页面的恢复

有可信 callback / webhook 时触发检查；没有时后台只针对有 open wait 且存在 active attempt 的连接执行带退避的检查，直至 attempt 的已知期限或有限检查窗口。超过后保留等待，并转为手动检查/继续；不永久扫描所有账号。页面 focus、用户主动检查与重启也可触发核验。

MCP 本地 callback 不适用于所有远程/移动部署；不支持时显示可用的受信任设置入口，不能伪造可达的 localhost URL。第一版 Web / Electron 优先；跨渠道协议复用但渠道入口单独验收。

## 9. 接口与实时协议

以下均为新增提案，以共享 Zod schema 为准。

### 当前操作区快照

```text
GET /api/sessions/:sessionKey/connection-wait
→ { sessionId, revision, wait: null | ConnectionWaitView }
```

View 仅包含当前目标摘要、需求列表、UI phase、脱敏账号、错误摘要和 `allowedActions`。不返回 token、OAuth URL、内部 checkpoint 正文。获取快照读本地事实并按需异步刷新，不在每次 GET 都调用第三方。

### 统一操作

```text
POST /api/sessions/:sessionKey/connection-wait/actions
{
  waitId, expectedSessionId, expectedVersion, idempotencyKey,
  action: 'connect' | 'check' | 'continue' | 'skip' | 'cancel'
        | 'select_account' | 'replace_source' | 'confirm_scope',
  needKey?, accountId?, candidateRef?, scopeChoice?
}
→ { view, authorization?: { attemptId, url, expiresAt? } }
```

- route 从 gateway 身份中校验 session 的访问和执行权限；waitId 不是授权凭证。
- connect / continue 对仍有效版本幂等。重复 action 返回同一结果或最新快照。
- 409 返回最新 view，前端显示「任务已更新」，不能在用户不知情时自动重放到新目标上。
- skip 默认只针对显式 needKey；全部跳过使用明确参数和文案。
- `replace_source` 与 `confirm_scope` 改变目标版本，不只是改 UI 名称。
- action 参数中的 accountId / candidateRef 必须可由当前 principal 使用，不能信任客户端选项。

### 实时事件

沿用现有 session realtime 通道，新增 `session.connection-wait.changed`，载荷为 sessionKey、sessionId、revision 和当前 view/null。事件是通知和加速，REST 是恢复来源。前端只接收相同 sessionId 且更新 revision 的事件，乱序旧事件不能让已消失的操作区复活。

删除等待时仍增加 session 级 revision；清空不能丢掉版本水位。可复用 `session_input_runtime.revision` 作为统一水位并在 GET/事件返回，所有等待变更也递增它，避免新增第三个状态版本源。

stream `run_end.status` 增加 `suspended`（协同升级 contract 与所有 consumer），独立字段表明 `waitingFor='connection'`。session input 使用对应 suspended 终止本次执行；前台通知不得将它映射成 success / failure。

## 10. React 实现落点

新增以下组件/模块，复用已有设计 token、Button、Dialog、PopoverSelect、Skeleton：

| 拟新增模块 | 职责 |
|---|---|
| `web/src/features/chat/connections/connection-action-bar.tsx` | 唯一操作区，根据 view 纯渲染 |
| `.../connection-details-dialog.tsx` | 多应用、账号、权限、重连错误详情 |
| `.../connection-resume-dialog.tsx` | 长时间后恢复的范围确认 |
| `.../use-session-connection-wait.ts` | SWR 快照、realtime invalidation、版本拒绝 |
| `web/src/features/connectors/use-connector-authorization.ts` | 抽取设置页/Chat 共用授权窗口交互 |
| `packages/gateway-contract/src/connection-wait.ts` | DTO、Zod schema、事件和 action 类型 |

在 [chat-composer.tsx](/Users/micjoyce/develop/github/xopc/web/src/features/chat/composer/chat-composer.tsx:561) 的现有 composer 布局添加一个槽位，不增加消息 renderer 的特殊卡片分支。若有旧版本卡片数据，历史 renderer 只显示其静态摘要。

交互细节：

- 等待不禁用输入框；独立执行时显示真实 streaming/stop。
- OAuth 成功不自动抢输入焦点；授权弹窗关闭后尽量回到原操作按钮或输入框。
- 状态变化使用 `aria-live=polite`，错误操作失败使用可读提示，不能仅靠颜色区分。
- Details dialog 固定响应式外尺寸，header/footer 固定，内部内容滚动；移动端底部空间和键盘 safe area 留给 composer。
- 一个主蓝按钮，其他操作低强调；默认最多两行说明，长错误放详情。
- 静态历史不订阅 connector 状态。仅当前会话 hook 订阅；大量历史对渲染和网络成本不产生线性增长。

## 11. 后端改动清单

| 模块 | 具体变化 |
|---|---|
| `src/connectors/connection-wait-service.ts`（新增） | 去重、当前等待、目标变更、行动校验、readiness 投影、恢复协调 |
| `src/storage/sqlite/session-connection-wait-repository.ts`（新增） | 当前快照、唯一索引、CAS、与队列/TaskWait 的同步事务 |
| `src/agent/external-tools/{types,service,gateway-tools,composio-provider}.ts` | 候选发现、连接工具改路由、执行时缺口归一化 |
| `src/agent/orchestration/agent-turn-policy.ts` 与 `embedded/{run-turn,types}.ts` | 安全停止原因、抑制非必要继续和错误重试 |
| `src/gateway/service/{session-input-coordinator,run-gateway-agent}.ts` | suspended 传播、internal continuation 入队、领取前校验 |
| `src/storage/sqlite/session-input-repository.ts` 与 migration | typed input、suspended 状态、去重、reset 清理与恢复 |
| `src/tasks/{task-run-dispatcher,task-run-coordinator,task-run-repository}.ts` | TaskRun 复用、唯一调度所有者、避免重复领取 |
| `src/gateway/hono/routes/connection-wait.ts`（新增） | 快照和 action；接入既有身份与 rate limit |
| `src/connectors/auth-provider-registry.ts` | 显式身份/账号/attempt 参数；复用现有 OAuth manager |
| stream mapper、gateway realtime bridge、presence、通知 consumer | 正常挂起与真正完成分开 |
| session reset / delete | 取消 open wait、queued continuation 与继续意图；新 sessionId 隔离旧 callback |

源码里真实存在的两处容易漏改：

- `SessionInputCoordinator.drain` 当前只把 ok→completed、aborted→cancelled，其他→failed。必须增加 suspended 分支并释放当前 active input。
- `run-gateway-agent` 的 finally 仍会发 run.completed / turnComplete 通知。等待不能沿用成功 review、完成 toast 或自动闭合任务逻辑。

## 12. 可靠性与授权边界

| 场景 | 必须成立的规则 |
|---|---|
| 双击、多标签 | 同一有效 auth attempt；同一目标恢复输入最多一条 |
| 回调重复 | 只更新同一账号事实；CAS 和队列唯一键去重 |
| 回调迟到、当前 attempt 已换 | 不覆盖新绑定，不恢复旧目标 |
| 成功后连接马上被撤销 | worker / tool execute 再次校验；必要时重新等待 |
| 修改目标与回调同时发生 | objectiveRevision 和 session serialization 决定；新输入未处理时不自动启动旧目标 |
| 事务后进程崩溃 | 已入队 continuation 可恢复；未入队不宣称 resumed |
| 运行中崩溃且可能已发送邮件 | 标记 interrupted，走已有人工/幂等恢复；不自动重放未知写结果 |
| 一个账号连接完成 | 只满足该 principal + account + capability 的需求，不满足所有 Gmail 等待 |
| Connectors 页面连接 | 无当前有效继续意图时只显示 ready |
| 用户跳过 | 将 suppression 带入原目标后续上下文；不重复制造等待 |

继续意图只决定能否调度，不能提升数据权限。外部写动作沿用 [connector policy](/Users/micjoyce/develop/github/xopc/src/connectors/policy.ts) 与一次性 approval。目标中若包含发送邮件，必须保留收件人、内容和原授权边界；连接成功不能扩大授权。

## 13. 验收与交付顺序

### 必须通过的验收用例

| 编号 | 用户路径 / 注入故障 | 验收结果 |
|---|---|---|
| P01 | 未安装 Gmail 的首次任务 | 唯一入口完成所需安装授权，原目标继续 |
| P02 | 已安装未连接 | 不重复安装，直接授权 |
| P03 | 重复 require 10 次 | 一个 ConnectionWait，一个操作区，一次历史提示 |
| P04 | 同账号多个能力 / 两个不同账号 | 前者合并，后者不错误合并 |
| P05 | 两个必需应用 | 一个入口；全部必需项满足后继续，跳过有明确影响 |
| P06 | 补充原目标 / 无关小任务 / 明确取消 | 分别更新、保留、清除；不误执行旧版本 |
| P07 | 很久后点击 | 新有效链接；时间歧义有范围确认 |
| P08 | OAuth 页面取消 / 超时 / popup 被拦截 | 原目标保留，有可恢复动作，无失败任务假结论 |
| P09 | 设置页连接 / 历史账号后来失效 | 当前区更新；历史不变；不重放历史任务 |
| P10 | 跳过后模型再次请求 | 不重复提示；可提供替代方法 |
| P11 | 新 session/reset 后旧页面点击 | 不恢复旧 transcript 目标 |
| P12 | 320/360px 和桌面、键盘与屏幕阅读器 | 输入可用、唯一主动作、对话框不跳高、无横向溢出 |
| T01 | 重复 callback / 双击 / 同时两个标签 | 一次有效授权关联、一次有效续跑 |
| T02 | provider 成功但账号/权限不匹配 | 不入队，返回准确的处理入口 |
| T03 | 关闭页面、重启 gateway | 等待可恢复；不依赖前端 poll；MCP 旧 attempt 可重开 |
| T04 | 入队事务前后分别崩溃 | 没有丢失或重复 continuation |
| T05 | TaskRun 与普通 Chat 两条路径 | TaskRoot 不重复创建，dispatcher 与 input queue 不双执行 |
| T06 | suspended 贯穿状态与通知 | 无 success/failure 假提示，无保持中断的模型资源 |
| T07 | 恢复前有新用户输入 / 目标版本改变 | 先处理输入，再判断继续；旧意图不越过新要求 |
| T08 | 历史 100 条连接提示 | 历史无按钮、无网络订阅，当前区仍只有一个 |
| T09 | 相对日期和未读条件变化 | 绝对时间范围可确认，不伪造历史未读状态 |
| T10 | 写动作已完成但结果丢失 | 不因重新连接无条件再次发送 |

### 开发切片

1. **契约与停止语义**：共享 DTO、ConnectionWait 仓储、队列 typed continuation、suspended 全链路。先验证不会误报完成或重复执行。
2. **Gmail 纵向闭环**：可信候选、require tool、唯一操作区、授权、后端验证、跳过和续跑；含普通 Chat 与关联 TaskRun。
3. **完成首发交互**：未安装路径、账号选择、重连、长时间恢复、查看其他连接器、多依赖聚合、刷新/重启和竞态测试。
4. **扩展适配**：其他品牌、MCP URL elicitation、Telegram/Weixin、自动化等待。保持同一等待和操作协议，不再新增每渠道一套状态机。

首发必须完成前三片；仅做已安装 Gmail 的演示不能宣称完整能力。受环境限制无法一键授权的类型提供明确设置路径，不能假装支持。

观察指标：一次目标的等待创建数 / 去重次数、连接完成率、有效续跑率、验证→开始执行延迟、跳过后重复打扰次数、误完成通知、重复续跑和错误账号执行事件。日志记录 waitId / objectiveRevision / principal 的内部标识 / runId / phase，沿用 createLogger 与脱敏规范；不记录邮件正文或授权 URL。

## 14. 实现记录（2026-09-07）

已实现 Web / Electron 的单一连接操作区与 Composio 恢复链路。聊天历史不保存 OAuth URL 或可执行授权卡片，设置页仍提供独立的连接管理入口。

- `packages/gateway-contract/src/connection-waits.ts` 定义共享协议；`session_connection_waits` 保存当前目标、版本、账号需求、继续意图和恢复检查点。SQLite 150 迁移保留现有输入及会话绑定，并增加 `connection_resume`、`task_run_id` 与 `suspended`。
- `xopc_tool_search` 返回可信连接候选及当前目标的账号绑定；`xopc_require_connection` 接收 `requirements` 和包含已完成步骤、剩余步骤、绝对日期的 `checkpoint`；`xopc_update_connection_objective` 更新或取消等待目标。Composio `$connect` 搜索项、契约和执行分支已删除。
- `ConnectionRecoveryService` 在点击时生成授权链接，复用 OAuth 窗口组件；校验账号、安装策略与动作权限。网关每 5 秒检查具有有效继续意图的等待项，页面关闭不影响处理。默认继续意图有效期 30 分钟、单次授权界面等待期 10 分钟；第三方是否实际接受授权仍以服务端查询结果为准。
- 授权成功与内部输入入队分离；入队与等待状态变更在同一 SQLite 事务内提交，worker 再次校验后消费。内部恢复以隐藏 custom message 进入模型上下文，不伪造用户聊天消息。重启不重放执行结果未知的输入。
- TaskRun 经现有输入队列执行，域 runId 与模型 execution runId 独立；连接等待绑定 TaskWait，通用 `resolve_wait` 不能绕过恢复检查。取消、重置和编辑原请求会使旧继续失效。
- 输入区组件提供连接、重连、检查、账号选择、跳过、取消、延迟范围确认和 Gmail / Outlook 更换确认。多应用聚合在一个详情面板中；两个同品牌账号通过需求 key 区分。历史消息没有连接状态订阅。

候选映射覆盖 Gmail、Google Calendar、Google Drive、Slack、Notion 和 Outlook。首次安装仍需要已配置 Composio BYOK 或 XOPC Cloud；缺少环境配置时显示错误与连接器设置入口。MCP URL elicitation 和跨渠道交互属于后续适配范围。

验证包括连接恢复仓储与服务、首次安装、重复点击、后台检查、失效重试、目标更新、会话重置、账号隔离、TaskRun 队列去重、数据库升级、停止语义及 React 操作区测试；另使用 Chrome 检查桌面和 320px 深色界面、详情面板与延迟继续确认。第三方调用在自动测试中使用适配器替身，没有连接真实 Gmail 账号或读取用户邮箱。
