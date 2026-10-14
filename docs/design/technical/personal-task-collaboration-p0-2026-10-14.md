# Personal Task 协作闭环 P0 实现与验证

日期：2026-10-14。

## 范围与结果

恢复普通 Personal Task 的完整协作读取、执行者提问、主对话回答、原执行恢复、中途补充要求投递与确认，以及最终结果采用。保留快速提交、后台 Router、同一个 Task、同一个根 TaskRun 和单个执行者；未引入新的业务 Agent、数据库表或额外调度层。

本次覆盖普通 Task。连接应用的授权、连接恢复和 `personal_request` 专用执行工具协议保持现有实现；统一连接应用协作协议属于后续 P1，本次真实模型场景不代表这些路径也已验收。

## 实现

### Personal 读取与协调

`personal_task get` 恢复 waits、runs、receipts、criterionReviews、context、conversation、sessions、authorityGrants 和依赖关系。完整保留任务说明、问题原因、回执验证状态与完成判定，不再经过把所有字符串截成 600 字符的通用投影。

支持 `get(section, offset, limit)` 分页读取各类状态。最近协作消息提供明确的正文长度、摘要标识和 entry ID；通过 `collaboration(afterSequence, limit)` 按稳定序号遍历历史，`entry(entryId, bodyOffset)` 按 4000 字符读取原文，跟随 `nextBodyOffset` 获取剩余内容。正文分段不会静默丢失问题末尾。所有读取均校验当前 Personal 对 Task 的所有权，entry 还校验所属 Task。

`answer` 与 `instruct` 使用当前输入和内容生成稳定幂等键，显式键保持不变。问题回答关联准确的 question ID；分配阶段的问题仍通过原 Task 重新分配，执行阶段的问题通过原 wait 恢复执行。

`external_event` 中关联协作问题的 wait 现在投影成 `input_required` attention。Personal 可以找到正在等待的问题，不会只看到 waiting 和空 attention。

### 回答、恢复与中途要求

协作通知携带完整正文及关联消息 ID。Personal 先从任务书和已有对话回答；缺失事实才询问用户。用户的下一条回答必须投递回原问题，不能只在主对话里说“收到”。

执行者收到回答时，投递服务等待旧执行输入结束，再解析原 wait，恢复同一个 TaskRun。中途指令使用现有 steer/next 输入路径投递。

执行者每轮从动态模型上下文读取协作记录，包括完整正文、entry ID、causationId 和投递状态。回答和指令无论是否已经确认，即使退出最近 12 条消息窗口也会保留，避免进度消息或对话压缩覆盖后丢失新口径。首轮真实验证暴露了用户消息前缀无法可靠保留到模型上下文的问题，因此 Task 上下文现在通过 dynamicSystemContext 注入，而不依赖该前缀。

执行者必须用 `ack` 引用回答或指令 ID，说明理解及预期落实方式。确认检查实际接收会话和 assignment epoch；旧执行者不能确认其他会话收到的消息。已确认记录允许相同幂等键重放。

确认作为关键协作事件送回 Personal，不再需要额外通知判定模型。Personal 感知确认与是否向用户重复通知分开：没有新决策、没有用户状态查询时可保持静默。

### 最终结果采用

结果核验与最终回复都读取持久化的 question / answer / instruction / ack 记录，按序理解补充或覆盖的要求；不再只依赖最近几条聊天和原提交输入。最终回复读取完整执行回执、verification、completionVerdict、needsUser、Task 阶段、契约和验收项评审。

确认记录只证明收到与理解。是否完成补充要求仍需最终产物及工具证据支持；未投递、未确认或未完成的要求不能被包装为已完成。执行成功、验证通过和用户接受仍是不同状态。Task 处于 review 且 needsUser=false 时，最终回复不应新增“是否接受/关闭任务”的问题。

提交路径继续只做本地持久化；上述读取和确认不加到首次提交之前。

## 自动化验证

相关回归覆盖 Task 分配、协作、执行、结果投递、Personal 工具与提示、核验器及动态上下文入口。广泛回归 34 个文件、286 个用例通过；随后增加确认通知用例，并针对最终修改补测 4 个文件、34 个用例通过，共覆盖 287 个不同用例。根目录 TypeScript 类型检查、定向源文件 ESLint 和 diff whitespace 检查通过。

新增关键断言包括：

- 超过 4000 字符的问题按正文游标读取后与原文完全一致。
- Personal 读取到完整问题原因、wait 关联和执行记录。
- 回答重放不产生重复协作消息；原 wait 解析后仍保持一个 TaskRun。
- 确认重放保持幂等；确认状态和事件回到任务所有者。
- 补充要求超过最近消息窗口后仍能被恢复上下文读取。
- 跨 Task entry 读取被拒绝。
- 动态上下文独立于持久化的用户消息进入模型请求。
- 最终合成读取历史补充要求和完整回执；核验器读取规范协作记录。

## 真实模型场景

使用当前配置，不替换模型：Personal 为 `deepseek/deepseek-flash`，全局 / Router / data-analyst 为 `xopc-cloud/openai-codex/gpt-5.5`。

启动隔离 Gateway，通过带认证的真实 HTTP 输入接口调用 Personal。只复制 Agent 配置和 profile 到临时状态目录，使用合成 sales.csv；复用现有凭据目录及其锁，不克隆 OAuth 刷新令牌。关闭隔离实例的渠道、心跳和用户记忆。验证结束关闭 Gateway 并删除临时配置文件。

完整流程：

1. Personal 快速提交，真实 Router 选择 data-analyst。
2. 执行者问币种，Personal 从原用户请求回答 CNY；执行者确认并恢复。
3. 执行者问未提供的报告标签；Personal 在主对话询问用户。
4. 在执行者等待期间，主对话仍能回复 READY；第三、四轮还实际调用 `personal_task get` 读取状态。
5. 用户给出“春季观察”，Personal 回答原问题，执行者确认并恢复原 TaskRun。
6. 主对话追加标题“ 双月汇总 ”、金额乘 2、合计 720、校验码 735；Personal 使用 instruct 投递，执行者用 ack 确认。
7. 执行者创建 CSV、报告和可复现脚本，实际运行脚本核验，发布成果。
8. 主对话收到最终结果，采用最新要求；检查单个 Task、单个 TaskRun、一次分配及零工具错误。

等待 30 秒是合成场景的模拟计算窗口，计入总耗时；它不是产品新增的等待步骤。脚本轮询属于测试观察器，Personal 没有后台轮询工具调用。时间包含真实模型生成与网络耗时；恢复、确认的观察时间约有 100 毫秒采样误差，不是延迟 SLA。

### 迭代记录

- [第 1 轮原始记录](personal-task-collaboration-live-run-1.json)：已回答、恢复，但没有正式 ack；同时发现 READY 精确全等断言过严。保留失败记录，修复模型上下文入口，READY 改为验证实际回复包含指定标记。
- [第 2 轮原始记录](personal-task-collaboration-live-run-2.json)：完整闭环通过，三个回答/指令均正式确认；产物与回复采用新要求。
- [第 3 轮原始记录](personal-task-collaboration-live-run-3.json)：增加真实 get、脚本执行证据和零工具错误断言，通过。最终回复额外询问是否验收，随后收紧合成规则。
- [第 4 轮原始记录](personal-task-collaboration-live-run-4.json)：增加“不额外请求接受任务”的断言，闭环通过。执行者当时正在长工具调用中，确认在工具结束后发生。最终合成输出非 JSON，安全回退交付原始结果；因此不能把这一轮当成合成稳定性的证明。
- [第 5 轮原始记录](personal-task-collaboration-live-run-5.json)：将 JSON 格式约束提升到合成调用的 system prompt；完整闭环通过，合成未回退，未额外询问是否接受任务。实际脚本执行成功，工具错误为 0。

用户输入抢占了后台确认通知时，通知输入可以先 cancelled，之后使用原 entry 的 retry 输入完成。第 2、3 轮实际观察到该恢复；这是用户输入优先级路径，Task、执行者和协作 entry 不变，不触发任务重做。

复跑：

```sh
XOPC_COLLABORATION_LIVE=1 \
XOPC_COLLABORATION_REPORT=/absolute/path/report.json \
pnpm exec tsx scripts/personal-task-collaboration-live-smoke.mts
```

该命令使用真实模型，产生正常模型调用费用。

## 代码入口与协议示例

- Personal 读取和命令：`src/agent/tools/personal-task-tool.ts`。
- 规范协作记录与确认权限：`src/tasks/task-collaboration-repository.ts`、`src/agent/tools/xopc-use-tool.ts`。
- 回答解析等待及补充投递：`src/tasks/task-collaboration-delivery.ts`。
- 主对话关键事件：`src/tasks/task-main-update-delivery.ts`。
- 每轮动态上下文：`src/agent/service/direct-turn-helpers.ts`、`src/tasks/task-context-assembler.ts`。
- 结果核验与采用：`src/agent/tasks/task-judge-service.ts`、`src/personal-agent/reply-composer.ts`。
- 可复跑的真实验证：`scripts/personal-task-collaboration-live-smoke.mts`。

```ts
// Personal: read current execution, pending question and complete receipts.
personal_task({ command: 'get', taskId });
personal_task({ command: 'entry', taskId, entryId: questionId });
// If nextBodyOffset is present, read the remaining body before answering.
personal_task({ command: 'answer', taskId, questionId, instruction: 'Currency: CNY' });
personal_task({ command: 'instruct', taskId, instruction: 'Double displayed amounts' });

// Executor: confirm actual receipt and its interpretation.
xopc_use({ mode: 'task', command: 'collaboration_post', args: {
  taskId, kind: 'ack', causationId: instructionId,
  body: 'Will double amounts in the CSV and report and rerun verification.',
  idempotencyKey: `ack:${instructionId}`,
} });
```

| 状态 | 含义 | 不足以证明 |
| --- | --- | --- |
| pending | 原 Task 中已保存，等待投递 | 执行者已收到 |
| delivered | 投递已接受，或回答已用于解析原 wait | 执行者已理解/落实 |
| confirmed + ack | 当前执行者确认收到并说明理解 | 最终要求已完成 |
| 最终产物 + 工具证据 + 回执 | 可检验的实际交付和验证状态 | 用户已经接受任务 |

## 后续边界

本次没有把每个工具输出都复制成主对话消息，也没有增加多执行者。长工具执行期间，指令可以先持久化并投递，但执行者通常在该工具结束后的下一轮才确认，不能承诺即时确认或取消已经发生的外部效果。

独立最终回复合成仍保留为表达辅助，已补齐规范协作记录与验证状态。是否取消默认独立合成、连接应用协作统一，以及执行中更多自动进度投影，继续按 P1 单独推进；本次验证不声称这些后续能力已经完成。

## 最终轮次耗时

| 阶段 | 耗时 |
| --- | ---: |
| 提交工具本地执行 | 12.06 ms |
| 用户请求到 Task 持久化（含模型准备任务书） | 5175.00 ms |
| 后台 Router 分配 | 2138.00 ms |
| 已有事实问题到 Personal 回答 | 1391.00 ms |
| 已有事实回答到执行恢复 | 2277.00 ms |
| 等待期间主对话回复 | 1025.00 ms |
| 主对话完整 Task 状态读取及回复 | 2748.00 ms |
| 用户回答到协作记录持久化 | 1730.00 ms |
| 用户回答到原执行恢复 | 1828.00 ms |
| 补充要求到协作记录持久化 | 1966.00 ms |
| 补充要求到执行者确认 | 8036.00 ms |
| 执行完成到主对话最终回复 | 2056.00 ms |
| 整条场景（含 30 秒模拟窗口） | 121130.00 ms |

最后一轮结果：CSV 为 300 / 420 CNY，合计 720，环比 40%；报告采用“双月汇总”和“春季观察”，校验码 735。实际 `node reproduce.mjs` 成功运行，文件已发布，主对话回复采用同一组新要求。

第 2–5 轮闭环均通过。提交工具为 12.06–14.29 ms，等待期间主对话回复为 1.03–1.64 s。补充要求确认在第 2、3、5 轮约 8 s，第 4 轮因等待长工具结束约 43 s；主对话并不等待这个确认才回复。样本数量有限，不构成延迟分位数或长期可靠性承诺。
