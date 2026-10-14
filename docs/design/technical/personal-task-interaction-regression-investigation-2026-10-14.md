# Personal / Task / Executor 协作链路调查 — 2026-10-14

## 结论与对比基线

快速提交和后台分配已验证，但主对话与执行者之间的持续协作没有获得同等覆盖。`3a2c98374` 对 Personal 读取面的裁剪引入了明确回归；其余若干协作缺口在引入 Router 前已经存在，现在的异步提交与连接应用分配沿用了这些缺口。

对比基线为 `77c0560b1`（引入 Router 前）、`f7042e9f9`（后台分配）和 `3a2c98374`（工具优化）。调查时 HEAD 为 `5553e6086`。调查未修改运行时代码，也未改动其他正在进行的 UI 和连接连续性研究文件。

之前的普通 Task 已经是：Personal 选择执行者 → personal_task(create/start) → TaskRunDispatcher → 执行者独立会话。现在是：Personal submit → TaskAllocationDispatcher / task-router 选择执行者 → 同一 TaskApplicationService.start → 同一 TaskRunDispatcher → 执行者独立会话。Task Runner 是调度基础设施，不是额外的业务 LLM Agent。Router 的正常职责仅是选择执行者。

如果比较更早的 `delegate_task`，则那是另外一种交互模型：父 Agent 等待子执行的工具结果，并在原回合内继续处理该结果。持久化 Task 则通过协作板、会话输入投递和最终结果 outbox 回到主对话；不能把两者的交互保证视为等价。

## 已复现的新增回归：Personal 读取缺失协作信息

`src/agent/tools/personal-task-tool.ts:282` 将 get 结果投影为 task、allocation、operationalState、attention、allowedCommands，去掉原有 waits、runs、receipts、context、conversation 等。Personal 的模型命令没有 collaboration/entry 读取，且主会话禁止广泛的 xopc_use。

`src/tasks/task-main-update-delivery.ts:64` 投递问题时只传 Task ID 和 collaboration entry ID，没有问题正文，要求 Personal 使用 get 读取问题和协作板。但是 xopc.tasks.get 原本也没有 board 字段；旧 Personal get 尚能通过 waits.reason 和 waits.condition.collaborationEntryId 读取问题，新的投影连这条途径也删除了。

同时，普通 worker 问题在 `xopc-use-tool.ts` 使用 external_event wait，而 `TaskReadModelProjector` 的 attention 只将 user_input、approval、dependency 等 wait 映射为相应关注项，external_event 不生成问题关注项。当前 get 可能表现为 waiting，却没有问题文本或可读问题列表。

独立内存数据库复现（不调用真实模型）结果：

```json
{
  "legacyGetWaits": 1,
  "legacyGetHasFullQuestion": true,
  "personalGetFields": ["ok", "task", "operationalState", "attention", "allowedCommands"],
  "personalGetHasQuestion": false,
  "personalAttention": [],
  "automaticTriggerHasQuestionId": true,
  "automaticTriggerHasQuestionBody": false
}
```

主对话系统上下文还有 `buildDelegatedTaskDirective` 的 latest-board 400 字符摘要，因此部分短问题仍可能被理解；但它只含最新一条消息，不提供完整问题读取，不能当作可靠协作闭环。统一 600 字符字符串裁剪也会损失 Task 详细背景，requiresSpecialist 提示可能把本应由任务所有者读取的协作信息再次引向委派。

## 执行进度：独立流没有自动成为主对话的任务事件

`src/gateway/service/run-gateway-agent.ts` 将执行事件发布到当前 run 的 topic，捕获 plan/outcome/patch 交给 TaskRunCoordinator。Coordinator 的 capturePlan/capturePatch 收集证据，未自动创建 progress 协作条目。

`src/tasks/task-context-assembler.ts:144` 要求执行者主动调用 xopc_use collaboration_post。只有进入协作板的 progress 才进入 TaskMainUpdateDelivery → 通知判定 → 主 Agent 新回合。更新还受主会话空闲检查、较新条目合并和用户通知偏好影响。Personal proactivity=decisions 的判断先于本次对话偏好的模型判定，可能压过用户临时要求进度的意愿。

只读检查本机最近一条已分配普通 Task：运行 succeeded；worker 使用 web_search 42 次、web_fetch 38 次、update_plan 2 次；协作板只有 result 1 条；最终结果与最终回复 delivered。这个记录可以解释为什么执行实际很活跃，而主对话只有开始和结束。此机制在 Router 引入前已存在，不是 Router 删除了这些事件。

## 主对话中途补充：通道存在，状态闭环不足

`personal_task(instruct/answer)` 仍写 TaskCollaborationRepository 并设置 deliverToWorker。TaskCollaborationDelivery 对活跃执行者提交 steer；Gateway 在会话没有活跃运行时改成 next。回答等待问题时先检查旧执行输入结束，再 resolve_wait，让恢复后的 TaskRun 从执行上下文读取 board。此投递路径相对基线未改变。

但是主工具返回的是持久化/待投递信息，而不是执行者已理解并应用的证明。deliveryStatus=delivered 主要表示输入被接受；confirmed 要依赖执行者 ack。当前 Personal 不能读取完整 board 或 ack，且任务目录仅提供最新一条摘要。因此它难以准确说明：已经写入、已经投递、执行者已确认、结果实际采用了哪条补充。

普通后续用户消息也不会自动转发到执行者；必须由 Personal 判断并调用 instruct/answer。快速结束回合、精简任务书与禁止额外查询的提示使这个依赖模型判断的通道更容易表现为普通聊天，而非持续协调。这里是风险推断，不代表现有 steer 投递已被实测证明失败。

## 连接应用：任务化没有统一协作面

`src/tasks/task-main-update-delivery.ts:21` 对 personal_requests 对应的 Task，直接跳过 progress、failure、result 协作更新。结果由专门的请求结果路径处理，但这不补齐执行中进度与恢复。

`src/agent/embedded/execution-tool-policy.ts:9` 的 connected worker 只有 external search/describe/execute、personal_request_result、personal_request_connection。它没有 xopc_use，也没有通用业务问题/进度工具；而通用执行上下文要求用 xopc_use 上报协作信息。连接恢复可以走专门工具，业务问题与普通中途协作却没有同等入口。

这些限制在此次 Router 引入前已经存在。现在连接应用也后台分配 Task，并不会自动获得普通 Task 的完整交互能力。修复应增加严格限定于当前 Task 的协作工具，不应直接开放所有对象管理或扩大连接器授权。

## 最终结果：回复合成不能代替任务所有者继续处理

`TaskResultDeliveryService` 在 Personal 场景向 PersonalReplyComposer 入队，后者是独立、无工具的模型调用。`reply-composer.ts:99` 只从原始输入和针对原始 main run 的 interrupt 输入组成 originalRequest；普通后续 next 消息与 Task board instructions 不作为完整任务变更清单进入 packet。recentConversation 只带最近六条消息、每条 1200 字符；report 也有 16000 字符上限。

传给 Composer 的 executionReceipt 仅选取 status、summary、evidence，没有明确携带 verification、completionVerdict、needsUser、Task phase 和验收记录。本机该任务的 TaskRun 已 succeeded、结果已 delivered，而 Task 仍为 review，说明执行结束、结果交付和 Task 验收是不同状态，回复合成应直接感知这些状态。

因此旧补充要求可能只暂时存在于聊天摘要中，随后被新对话挤掉；最终合成无法查询 board、追问执行者或恢复任务。这个组件相对上述基线没有改变，缺口是异步任务所有权未形成稳定任务上下文，并非新增 Router 本身导致。

## 之前的验证为何未发现

七轮真实模型 smoke 主要验证了创建一个 Task、正确选择执行者、执行者运行时主对话回复 READY、脚本执行、成果与最终回复回传。没有制造 worker 提问、主 Agent 自动回答、用户回答、执行中改要求或需要进度通知的场景。

`personal_task` 之外的主工具调用还被 smoke 断言排除；这是该固定任务的快速提交验收，不能推广为整个任务执行期不应使用 get/answer/instruct。292 项回归包括各底层投递组件，但没有完整覆盖“新 Personal 工具面 + 自动更新触发 + 等待恢复 + 最终合成”的组合。原来的稳定性结论应限定为提交、分配与直接完成路径。

## 修复顺序与下一轮验收

1. 恢复窄而完整的 owner 协作读面：当前运行、等待问题、完整指定 entry、最近进度/指令/ack、回执和必要上下文。自动触发直接携带对应条目；防止问题、指令和决策字段被通用截断吞掉。
2. 区分快速提交回合与后续协调回合：后者明确允许 get/answer/instruct，补齐执行重试/恢复的显式入口；中途补充需关联 Task、指令序号和确认状态。
3. 从执行事件生成有限、去重的里程碑，保证主 Agent 私有感知与用户通知可分别控制。保留用户要求的进度，减少对执行者是否记得发 board 的依赖。
4. 连接应用使用同一套 scoped 协作协议，保留账户与只读授权边界。
5. 最终合成输入携带 Task 修订、完整问题/答案/补充指令摘要及回执，不仅依赖最近聊天。缺信息时回到任务所有者协调流程，无工具 Composer 只负责表达。

必须补充完整链路用例：

- 执行者提出超过摘要长度的问题，Personal 从原对话已有信息回答，原 TaskRun 恢复并完成。
- Personal 无法自行回答的问题返回主对话，用户的正常下一条输入被正确映射到该问题，执行者确认并继续。
- 执行中用户改变范围或输出格式，Personal 发指令，worker 确认，最终结果与验收采用最新要求。
- 多个执行里程碑在“仅结果”与“请求进度”两种偏好下正确处理。
- 连接应用业务问题、连接恢复和失败恢复保持同一 Task 身份。
- 多轮无关聊天后，最终结果仍保留较早的 Task 补充要求。
- 失败恢复在检查已有影响后继续原 Task，而不是误用 retry_allocation 或重复创建任务。
