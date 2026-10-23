# 连接等待与任务持续性调研

日期：2026-10-14。范围：当前 xopc Web Chat、ConnectionWait、SessionInput 和 Personal Request 恢复链路。前五节保留调研记录，第六节记录评审后实施范围与验证。

后续截图暴露的聊天文案、输入控制与恢复状态衔接问题，见 [连接恢复与产品交互整体梳理](connection-product-interaction-audit.md)。该文区分当前实现与下一阶段建议。

## 结论

截图同时出现“正在处理”“等待连接 · Slack”“正在恢复任务”，没有说明任务是否已经开始、哪里需要用户操作，也没有可用的退出操作。应该把连接等待作为可持久化的任务阻塞原因，让界面准确显示阶段，并提供始终可达的取消与故障恢复。


## 1. 源码核查

| 发现 | 证据 | 影响 |
| --- | --- | --- |
| 入队即展示“正在恢复任务”，标题仍是“等待连接” | `web/src/features/chat/connections/connection-action-bar.tsx` 的 `queued` 分支 | 两个状态相互矛盾，入队被误读成执行中 |
| queued 时跳过和取消禁用；后端 action 也只接受 open | 同组件、`src/connectors/connection-recovery-service.ts` 的 `act` | 调度或检查卡住时用户没有直接退出入口；需要前后端一起修 |
| 恢复消费前再次查询连接并搜索工具契约 | recovery service 的 `preflight`；`src/gateway/service/session-input-coordinator.ts` 的 `drain` | 正确的安全检查，但 UI 未单独显示“正在验证工具” |
| 后台检查按等待项串行执行，以 polling 标记防重入 | recovery service 的 `poll` | 单项慢请求会延迟其他等待项；调用链未设置统一的阶段截止时间。托管客户端已有 60 秒请求超时，不能据此认定所有调用都无限等待 |
| 任意新输入都会使自动恢复意图失效，并取消已排队的恢复输入 | coordinator 的 `submitLocked`、`invalidateConnectionResumeIntent` | “继续”和无关聊天也走这个路径；可能转为需要重新确认，而界面又承诺可以继续发消息 |
| 恢复输入先标 running，再 await preflight | coordinator 的 `drain`、SQLite `claimNextSessionInput` | 存在领取后、消费前的重启窗口，见下文 |
| 自动检查只扫描 open 且 intent 未过期的等待项 | `listConnectionWaitsToCheck` | 目标仍保存，但超过 30 分钟后不会由该扫描自动推进 |
| 检查点包含 completedSteps/pendingSteps 的文本列表 | `packages/gateway-contract/src/connection-waits.ts`、`queueConnectionResolution` | 可以提醒模型继续目标，尚不足以证明某个外部副作用已经完成、可以安全重放 |
| 浏览器已有事件游标、去重和重连机制 | `web/src/features/gateway/gateway-realtime.ts` | 应复用已有传输能力，重连后用权威快照补齐状态 |

已运行现有测试：

```sh
pnpm vitest run src/connectors/__tests__/connection-recovery.test.ts src/personal-agent/__tests__/requests.test.ts
```

结果：2 个文件、63 项测试通过。第三方调用使用替身；未读取真实 Slack 数据，也未复现截图对应的运行实例。

### 需要优先验证的重启窗口

1. ConnectionWait 已 queued，恢复输入已持久化。
2. `claimNextSessionInput` 将输入置为 running。
3. 连接/工具检查尚未完成时 Gateway 退出。
4. `recoverSessionInputState` 将 running 输入置为 interrupted，清空 active run。
5. 等待记录仍可能为 queued；后台扫描仅选 open，action 仅接受 open。

从当前链路推导，这可能留下无法继续、也无法通过连接 action 取消的等待状态。已有“preserves the wait through a gateway restart”测试覆盖 open 等待记录，不覆盖这个领取后的窗口。它是待故障注入验证的风险，不能直接认定为截图的实际根因。

## 2. 建议的交互

继续沿用现有的“历史提示 + 单一连接操作区”，避免另建请求中心。参考已有 [连接操作区设计](chat-connection-action-bar.md)，补齐实际实现与设计之间的差距。

| 真实阶段 | 面向用户的状态 | 可用操作 |
| --- | --- | --- |
| 需要授权 | 连接 Slack 后继续整理消息；目标已保存 | 连接并继续、使用现有信息继续、取消 |
| 等待 OAuth | 请在打开的窗口完成 Slack 授权 | 重新打开授权、检查授权、取消 |
| 验证工具 | Slack 已连接，正在检查消息读取能力 | 查看详情、取消 |
| 恢复已排队 | 已连接，等待继续；若被当前执行阻塞则说明原因 | 查看等待原因、取消 |
| 执行已开始 | 正在整理 Slack 消息 | 查看进度、停止任务 |
| 临时故障 | Slack 检查暂时失败，目标已保存；将在稍后重试 | 立即重试、取消 |
| 永久缺口 | 已连接，但缺少任务所需权限或工具 | 对应的权限/设置入口、使用现有信息继续、取消 |
| 页面断线 | 与 Gateway 的连接中断，任务状态暂时无法确认 | 重连；重连后恢复快照 |

“已连接”只表示账号授权成立，“正在处理”只在 worker 实际开始执行后出现。等待授权时结束本次执行显示、暂停执行计时；授权等待、排队等待和实际执行耗时分别统计。不要用一个持续增长的计时器暗示模型一直在工作。

建议正常等待区：

```text
连接 Slack 后继续整理消息                 [连接并继续]
目标与查询范围已保存。完成授权后会自动继续。
使用现有信息继续 · 取消
```

建议异常恢复区：

```text
Slack 已连接，工具检查暂时失败               [重试检查]
原目标已保存；最近一次检查：11:20。无需重新授权。
查看详情 · 取消
```

“跳过连接”改成说明结果的“使用现有信息继续”；Personal Request 当前 skip 实际会取消请求，不能只改标签。应统一为真实降级继续，或明确显示“取消查询”。不得把查不到数据包装成无结果。

验证与恢复期间保留用户输入。请求中显示准确阶段和最近进展；可以先采用约 10 秒无进展时补充解释、约 30 秒时突出诊断入口的阈值，之后按测量数据调整。阈值只改变反馈，不能凭计时器宣告失败或重复执行。未知完成时间不展示伪百分比。

## 3. 持续执行方案

### 分开投影三个状态

不要让 `ConnectionWait.phase` 同时承担账号、调度和任务生命周期。

- 连接：需要授权、授权中、有效、账号选择、失效、权限不足。
- 恢复：等待用户、验证中、已排队、已领取、重试等待、已取消。
- 执行：等待、运行、完成、部分完成、失败、停止。

后两者优先从 SessionInput/TaskRun 派生，增加必要的恢复阶段字段，不复制已有 task 状态。快照附带 `phaseStartedAt`、`lastProgressAt`、`nextRetryAt`、明确 `reasonCode` 和服务端 `allowedActions`。取消操作依据真实执行边界投影，不能只依赖 queued 判断。

### 把连接成功作为持久化事件

连接/账号变化触发定向检查；低频轮询负责事件丢失和重启兜底。检查通过后在事务中提交恢复意图与恢复输入，复用现有唯一键。

每个等待项独立超时与退避，使用有上限的并发，避免某个慢服务阻塞所有等待项。实际将 AbortSignal 传到网络/CLI 调用，不仅在外层 Promise.race；超时后到达的旧结果仍需通过版本、目标 revision 和领取令牌校验。

已有 30 分钟继续意图与 10 分钟授权 attempt 应继续区分。目标持久化不随短期 intent 消失。长时间后的继续确认应针对目标范围、账号或授权边界变化；UI 明确说明原因，避免把所有超时都要求重连。

### 修复 queued 的回收与取消

启动和周期性 reconciliation 对账等待记录、恢复输入和 task run：

| 状况 | 建议行为 |
| --- | --- |
| queued 等待对应 queued 输入 | 唤醒已有队列，不创建第二条输入 |
| queued 等待对应 running 输入，仍有有效 owner | 显示验证/领取阶段，避免重复领取 |
| 领取阶段中断，尚未执行外部动作 | 在确认前一 owner 失效后重新检查并调度；使用 CAS/领取令牌阻止旧 worker 迟到提交 |
| queued 等待对应 interrupted/failed/cancelled 或输入不存在 | 根据明确阶段恢复到可重试状态，或关闭并给出原因；不能留在无限 queued |
| 执行已进入模型/外部工具，结果未知 | 先核对执行记录与回执；不能套用“检查阶段安全重试”规则 |

允许取消 open、queued 和验证阶段；事务中取消输入与等待目标，后续旧检查不得再次入队。进入 running 后转交既有执行取消机制，显示“正在停止”，以实际停止回执结束。未知外部写操作结果需要保留并核对。

### 让新消息与原目标有清晰关系

现有无条件 invalidate 是保守策略，但伤害连续性。建议先接收新输入，并短暂设置“等待新消息分流”，防止旧目标越过可能的新限制；完成分流后：

- 明确“继续”：对当前目标发送 typed resume，校验账号和目标版本，复用同一目标。
- 修改条件：只更新对应 objectiveRevision，取消旧恢复输入，再按新范围推进。
- 无关聊天：保留原目标与继续意图，原任务可以在连接完成后继续。
- 明确取消：取消原目标。
- 归属不明确：保留目标，提出一次简短澄清；不偷偷丢弃原目标。

修改或关联目标应使用明确目标 ID；模型分流不能修改账号权限。多目标支持是后续产品决策，第一阶段仍维持每会话一个连接等待目标。

### 从“保存提示”走向“保存执行进度”

已有 checkpoint 可用于只读查询的目标恢复；需要可靠恢复的执行步骤应记录：步骤 ID、输入摘要、状态、输出/文件引用、外部回执、幂等键和结果是否确定。复用已有工具审计与 TaskRun 回执，缺少的部分再补表或字段。

只读查询可按游标/分页继续，并声明数据时效；外部写动作重试前必须依据 provider 幂等机制或可验证回执去重。恢复授权不会额外授权发送、删除等动作。既有“不要重复已完成步骤”的提示保留，但不能代替执行层检查。

### 页面只负责观察与发出控制命令

页面关闭、切换会话或网络断开不取消服务端任务。realtime 恢复订阅时使用已有 seq 去重，重连/事件缺口后重新拉取权威快照，避免错过“验证中→运行”的转换。

任务结果继续用既有投递 outbox 回到原会话。任务生命周期与当前页面无关；会话 reset/delete 的目的地处理必须沿用产品规则，不能把旧任务结果错误投递到新 transcript。

本地 Gateway 退出或电脑关机期间无法执行；可承诺的是再次启动后恢复。若产品希望关机仍持续工作，需要另行设计常驻服务或云执行端。

## 4. 外部实践与适用范围

1. **持久等待 + 信号恢复**：Temporal 把用户输入作为异步 Signal，workflow 等待后再继续。可借鉴“等待是持久状态”的语义，当前 xopc 用 SQLite 与既有队列实现；暂不引入 Temporal 服务及运维成本。[官方人机协作教程](https://learn.temporal.io/tutorials/ai/building-durable-ai-applications/human-in-the-loop/)
2. **执行与订阅分离**：OpenAI Background mode 提供异步执行、状态查询和按事件序号恢复流的模式。适用于借鉴传输与执行的分离；这是单次模型响应能力，不能替代 xopc 整个多工具任务的持久化。[官方 Background mode 文档](https://developers.openai.com/api/docs/guides/background)
3. **授权错误与其他错误分开**：MCP 规范要求客户端正确处理 401 的认证挑战与 scope 信息。建议 xopc 明确区分令牌失效、权限不足、网络/限流和工具契约缺失；只有认证需要时启动 OAuth。现有 Composio 不是这项 MCP 规范的直接实现，不能简单把每个服务 401 都映射成用户账号失效。[MCP Authorization 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## 5. 实施顺序与验收

**P0：消除无限恢复与无出口等待。** 前后端一起开放 queued/验证取消；准确区分授权、验证和排队；补充失败原因、检查时间；补齐启动对账和领取后重启恢复。沿用现有 endpoint 时无需新增路由；如果新增路由，必须同时更新 lazy matcher 并通过真实鉴权 Gateway 验证。

**P1：减少用户补救操作。** 定向事件唤醒、受限并发与退避；“继续”使用 typed resume；无关聊天保留目标；重连后权威快照恢复；Personal Request 与普通 Chat 一致的阶段和降级语义。

**P2：精确执行恢复。** 复用工具审计、回执及分页游标，补齐步骤记录、幂等与未知结果核对；需要时扩展多目标等待和跨端一致交互。

关键故障注入验收：

- 授权时刷新、关闭页面、切换会话，再回来仍看到原目标。
- 授权成功→入队、领取→检查、检查→消费、执行→回执、回执→投递各边界杀进程；恢复后不无限 queued、不重复执行。
- Slack 检查超时不阻塞其他会话；429/5xx 可退避重试，不触发重复 OAuth。
- queued/验证阶段取消后，迟到的授权/检查结果不能再调度。
- 重复点击、HTTP 回应丢失后重试复用同一操作幂等键；当前 hook 每次 act 都生成新键，需补充命令回执恢复策略。
- 等待时发送“继续”、补充范围、无关问题，分别产生正确效果。
- 流断线后恢复快照和游标，不显示旧状态、不重复结果。
- 发送等写动作已提交但回执丢失时，不因重连而重发。
- 测量授权完成到入队、入队到领取、验证时长、最久 queued 时长、重试次数、用户取消成功率；先建立基线再确定 SLA。

定位截图实例所需的最小证据是 waitId、queuedInputId、input 状态、activeRunId、阶段开始/最近进展时间、关联 requestId/taskRunId 和对应模块日志。截图本身不足以判断是上游慢请求、队列阻塞、重启窗口，还是客户端状态未同步。

## 6. 评审后实施（2026-10-14）

本次落地范围为连接恢复反馈、取消、重启对账和单账号选择。多账号合并查询、项目默认账号、自由文本账号解析及无关消息分流均未加入。

- 使用现有 ConnectionWait JSON 记录检查阶段、阶段开始时间、最近检查时间与恢复错误；新增可选快照字段，不改变已有 phase 枚举。界面区分连接检查、工具验证、恢复排队，排队被当前输入阻塞时说明原因。跳过连接后的排队不会显示“已连接”。
- queued 和检查阶段可以取消；取消命令回执与关闭等待在同一事务提交。客户端允许检查请求进行期间发送取消；以同一 transcript、同一目标 revision 校验取消，阶段版本变化不会阻止取消，也不取消用户已经修改的目标。
- 连接与工具验证分别有 30 秒等待上限。取消或超时后旧检查不能推进等待状态；未支持底层中止的第三方 SDK 探测可能稍后返回，其结果不能重新入队或执行目标。失败命令不保留成功幂等回执。
- coordinator 启动恢复在清理旧 running 输入后进行等待对账：未消费的 interrupted 恢复输入沿用原 ID 重新检查；失效队列引用退回可重试状态并更新 continuation revision。已经 consume、进入执行边界的输入不自动重放。周期性对账也唤醒遗漏的 queued 输入。
- 单账号选择使用输入区内的明确单选问答，显示 Slack 工作区/用户或邮箱身份。默认不预选，确认后直接调用现有 `select_account` action。该流程不创建 ClarificationWait，也不产生 clarification_resume；恢复唯一由 ConnectionWait 管理。
- 候选仅来自服务端允许访问的账号，提交时重新校验；指定账号缺失时不替换成唯一的其他账号。账号选择的幂等键在 HTTP 回应未知时复用；新目标 revision 重置本地选择。已选择的账号不提供执行中直接切换入口。
- realtime 重连后重新拉取等待快照。未更改新增普通聊天输入使旧继续意图失效的既有保守策略；账号问答通过 typed action 提交，不经过该路径。

验证包括服务、真实 coordinator 恢复、React 组件和 hook。故障场景覆盖 queued 取消、检查中取消与迟到结果、检查超时、领取后重启、执行边界后禁止重放、坏队列引用重试、过期意图确认、失败命令重试、账号权限变化及未知 HTTP 回应。

最终验证结果：相关 6 个测试文件共 113 项通过；根项目和 Web 类型检查通过；修改文件 ESLint、`git diff --check`、`pnpm run build:node` 与 `pnpm -C web run build` 通过。Web 构建仍有现有模块分包大小及重复静态/动态导入提示。

生产 Hono app 以真实监听端口和鉴权中间件验证了账号选择、重复提交去重、queued 取消以及未鉴权拒绝；GatewayService 外层使用测试配置，连接适配器使用替身，没有真实 Slack OAuth 或数据读取。

真实 Chrome 验证了桌面浅色和 320px 深色界面、无横向溢出、无默认选择、选定账号 ID 提交与 queued 取消。截图使用组件预览和模拟 HTTP 快照，临时预览文件与监听进程已清理。

截图：

- [桌面账号选择](/Users/micjoyce/.codex/visualizations/2026/10/14/01a1386d-cdd7-7073-b43a-eb6d59cf701f/connection-continuity/accounts-desktop.png)
- [320px 深色账号选择](/Users/micjoyce/.codex/visualizations/2026/10/14/01a1386d-cdd7-7073-b43a-eb6d59cf701f/connection-continuity/accounts-mobile-dark.png)
- [320px 深色恢复排队](/Users/micjoyce/.codex/visualizations/2026/10/14/01a1386d-cdd7-7073-b43a-eb6d59cf701f/connection-continuity/queued-mobile-dark.png)

## 7. 实现评审问题修复（2026-10-14）

四个已复现的问题已加入正式回归并修复：

1. **阶段变化导致取消静默失败**：取消 action 新增可选 `expectedObjectiveRevision`。新 Web 客户端按点击时的目标 revision 提交；服务端忽略该目标内部的检查阶段版本变化，仍拒绝修改过的目标或已进入执行的等待。旧客户端未提交该字段时保留 version 校验。无法确认取消时显示错误，等待条消失后也保留可关闭的提示；该提示独立于后台检查错误，避免取消成功后被迟到错误误报。取消刷新对同一 transcript 保留更高 revision 的快照。
2. **重启误认中断命令已完成**：启动对账清除 open 检查的 `lastAction`。进行中的 open 检查不作为幂等成功回执；已入队的选择即使处于消费前验证，也仍可重复获取回执，不重复入队。
3. **超时或重启丢失所选账号**：先验证本地候选与访问策略，将账号绑定、继续意图和 connection 检查状态原子写入，再查询第三方连接与工具。远程校验仍会重查权限；失败保留账号但停止自动重试。重启保留有效继续意图，可在后台重新验证并恢复；迟到结果不能推进旧版本。
4. **Store 安装成功仍被恢复错误阻塞**：安装完成清除过期 checking/recoveryError；修正 Store 检查读取尚未初始化 needs 的问题，并在已有 action schema 中接受安装回调 `instanceId`。正常安装和重启后的安装均通过真实鉴权 HTTP 验证并只入队一次。

验证包括连续阶段变化中的取消、目标变更拒绝取消、中断命令重试、两个检查阶段超时、选择期间重启后的自动检查与迟到结果、已入队选择的幂等回执、Store 安装以及客户端取消失败反馈。第三方连接仍使用测试替身。

延迟目标进入范围确认后清除自动继续意图，停止无意义的后台检查，直到用户确认。最终相关 6 个测试文件共 134 项通过；类型检查、修改文件 ESLint、Node/Web 构建与 `git diff --check` 通过。
