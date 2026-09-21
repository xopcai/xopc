# Orca 调研与 xopc 产品决策：先解决自己的 Slack 开发闭环

更新：2026-09-21。状态：调研事实、修订后的产品取舍与待验证假设；不是功能完成声明。

## 1. 用户澄清后的决定

用户已有三项具体问题：Slack 消息跟不过来；交给 Codex 开发需要不断复制消息并观察后续讨论；分支与 Slack 需求关联混乱。

因此本次决定是：**先做用户自己的 Slack → 排查 → 开发 → 分支管理闭环，不以寻找更广泛目标人群作为启动条件。**

上一版“先聚焦独立顾问／客户交付、先访谈 8—12 位用户再决定是否建设”的建议不再作为本轮计划。跨用户的增长与付费仍是未来假设，但不能代替已经存在的个人需求。

当前范围见[产品与技术方案](/Users/micjoyce/develop/github/xopc/docs/design/ai-native-scenes-product-technical-design.md)，推进顺序见[计划](/Users/micjoyce/develop/github/xopc/docs/design/scenes-launch-plan.md)。本报告保留 Orca 的事实及启发，不承担另一套路线图。

## 2. 调研方法与证据边界

- 本地 Orca：`/Users/micjoyce/develop/github/orca`，commit `1b77838d1c0e80729bf574c16436bdc7f5154d77`，version `1.4.197`，remote `stablyai/orca`。
- 本地 xopc 调研基线：commit `059ecfb1d` 及当前工作区设计文档。
- 阅读源码、产品说明和部分测试源码；没有运行 Orca 应用，没有本轮复跑代码测试，没有操作真实 Slack／邮箱。
- 图检索 MCP 不可用，采用文件／符号检索回退。
- 官方竞品材料只证明描述的能力存在，不证明实际成功率、留存、市场份额或用户满意度。

后续实现应重新核对接口变化。个人需求已明确不等于技术已实现，也不等于市场增长已验证。

## 3. Orca 的产品价值

Orca 主要围绕开发者组织工作：issue／目标、工作区、agent 终端、浏览器、diff、评审和反馈在同一处衔接。减少的是人在多个工具、上下文和并行执行之间的协调成本，而不仅是启动 Codex。

它并非完全不能做非编码工作：指南允许 folder workspace，自动化示例包含邮件摘要。但主要入口、对象和收益以开发工作为中心。xopc 应借鉴连续工作体验，不复制完整 IDE。

### 原生 Chat 的边界

Orca 的 Native Chat UI 是支持的 agent terminal session 上的结构化界面，终端仍为事实来源，模型选择等传给对应 CLI。它不是 xopc 自有 Agent runtime 的同一种架构。[文档](/Users/micjoyce/develop/github/orca/docs/site/content/docs/agents/native-chat.mdx)

xopc 的内部 BYOK Agent 可以直接执行，省去先启动另一个产品再解析终端状态的必经链路；但这只是架构差异，不证明模型或实际完成率更高。用户选择 Codex 时，仍需真实可靠的执行适配。

## 4. 最值得借鉴的机制

| Orca 机制 | 已读事实 | 对当前 Slack 场景的意义 |
| --- | --- | --- |
| 来源与执行上下文分离 | `sourceContext` 与 `runContext` 独立 | Slack 账号范围不是代码执行权限；分别绑定与核验 |
| Task 与 Dispatch 分离 | Dispatch 是有权威的一次执行尝试 | 重试不能让旧回报错误完成当前任务 |
| 持久消息及确认 | Delivery 可重放，处理后确认 | 新讨论不能丢，入队不等于开发已应用 |
| Decision gate | 问题有状态及解除条件 | 判断可恢复，不藏在某段聊天里 |
| 完成身份校验 | 校验 Task、Dispatch、sender 等 | 执行回报不能只凭一个任务 ID 信任 |
| 未知状态 | 区分 live、unverifiable、exited | 失联不能盲目启动第二个写者 |
| Automation precheck | 廉价 shell 检查可跳过计划运行 | xopc 用游标／指纹／范围预检，避免每条消息调用模型 |
| 运行快照及恢复 | 记录派发、结果、输出，启动后核对保留运行 | 重启后恢复同一事项，不能靠用户重新解释 |

Orca 的版本匹配 Skill guide 让 agent 组织任务、等待、回答和收尾；运行时保证权限归属、状态与投递。它说明业务方法可以用 Skill，但并不说明“模型遵循指令就不需要运行时代码”。

还需区分两点：scheduled automations 与 supervised orchestration 不是同一机制；旧 `Coordinator` 类中的自动分解尚未实现，且用户文档标记旧 scheduler 命令退役，不能把这个类作为现行通用自动编排能力的证据。

## 5. 必须进一步做好的完成语义

对用户当前工作，至少区分：

- 执行器接收了更新，还是已按新需求调整；
- agent 停止输出，还是代码已完成；
- 测试命令结束，还是约定验证通过；
- 分支有修改，还是与正确 Slack 事项关联；
- 代码可交付，还是已经合并／上线。

Orca 的身份与回报机制值得学，但 xopc 仍需自己的需求修订、验证证据和业务完成条件。不能把 worker 自报成功自动当作客观验收。

## 6. 不直接复制的部分

- 不做完整终端／IDE 控制台；用户主要查看事项及必要判断。
- 不默认多 Agent 比较、联邦调度、远程 PTY 和复杂分支拓扑。
- 不因每次 agent working → idle 都主动通知。
- 不把 Skill 当权限沙箱，也不把 worktree 当安全隔离环境。
- 不先复制 Plugin 生态。Orca manifest 的版本和能力声明可借鉴，但其接口也标记实验性，事件集合以 worktree／agent 为主，不是通用业务事件平台。

Scene 长期可作为增强 Extension 能力包的一部分；定义、用户激活、授权、凭据和运行历史仍分离，短期不用合并。

## 7. xopc 可以复用什么

已读基础：Scene 有持续实例、只读成果、证据、调度、来源健康和通知；Task／TaskRun 有契约、内部 Agent dispatch、等待和回执；Workflow 有 agent 节点、工具集和 Skill 资源。

真实缺口：Scene executor 仍是单回合、`tools: []` 的只读路径；Slack 变化到任务说明、开发会话及分支的闭环未打通；未确认可直接复用的完整外部 Codex 适配。

因此首要工作是受约束地连接现有能力：Scene → Task／TaskRun → 内部 Agent 或明确选择的执行器 → 工作区／分支 → 验证回执。不是再建设一个调度器，也不能简单给只读 Scene 加完整工具箱。

Workflow 顶层 Run 状态没有长期 waiting，不能假设已有跨天恢复；持续等待复用 Task／Scene。当前 Workflow → Task 回执路径中存在成功 verdict 与未验证 checks 并存，编码场景接入前需落实自己的完成证据规则。

## 8. 市场对照仍有意义，但不是本轮前置条件

“事件 + prompt + tools”不是独占能力：Slack 支持 AI workflow；Zapier 已将 agent 的 prompt、工具与推理纳入工作流步骤并复用历史和审批；Lindy 提供邮件准备及外部动作审批。[Slack](https://slack.com/help/articles/32843655109395-Use-AI-to-build-Slack-workflows)、[Zapier](https://help.zapier.com/hc/en-us/articles/47402591569805-Migrating-from-Agents-to-AI-by-Zapier)、[Lindy](https://www.lindy.ai/ai-email-writer)

但用户现在不是在寻找一个抽象市场定位，而是在反复承担消息搬运、盯线程和管理分支的成本。现有竞品有自动化能力不否定这项需求；真正要比较的是能否在他的实际环境中减少这些劳动。

BYOK 与本地状态控制有价值，也有配置和常在线成本。内部 Agent 不应让每个事项多出模型配置。电脑休眠／Gateway 关闭不能承诺持续运行，必须展示覆盖缺口和恢复。

## 9. 当前验证方式与之后的推广

当前直接用用户自己的真实 thread 和分支建立基线：复制次数、手动观察次数、重复补充指令、查分支时间、错配和返工。先做到给出线程后持续推进到可交付代码，并保护现有工作。

验证完整闭环后再推广：

1. 相同 Slack 开发痛点的其他个人／团队成员，检验是否仍需大量人工配置。
2. 同类开发闭环的其他消息来源，检验来源适配是否可复用。
3. 非编码事项，把代码产物换成文档／报告等交付物，检验通用 Task／等待／回执边界。

传播案例应是“线程补充被吸收、代码正确更新、分支对应关系清楚”，不是“同时启动十个 agent”。新增范围必须由实际使用收益驱动。

最终结论：**为用户自己的需求建设这条闭环有明确理由；能否增长到更广泛人群仍待后续证据。先解决个人问题，与保留通用扩展性可以同时成立。**

## 10. 主要本地证据

- [Orca 产品定位](/Users/micjoyce/develop/github/orca/README.md)
- [Orca automation 文档](/Users/micjoyce/develop/github/orca/docs/site/content/docs/cli/automations.mdx)
- [Automation 类型](/Users/micjoyce/develop/github/orca/src/shared/automations-types.ts)
- [Automation 执行](/Users/micjoyce/develop/github/orca/src/main/automations/headless-dispatch-runner.ts)
- [完成观察与恢复](/Users/micjoyce/develop/github/orca/src/main/automations/run-completion-watcher.ts)
- [Orchestration 文档](/Users/micjoyce/develop/github/orca/docs/site/content/docs/cli/orchestration.mdx)
- [版本匹配 Skill 指南](/Users/micjoyce/develop/github/orca/src/cli/bundled-skill-guides.ts)
- [生命周期校验](/Users/micjoyce/develop/github/orca/src/main/runtime/orchestration/lifecycle-reconciliation.ts)
- [生命周期测试源码](/Users/micjoyce/develop/github/orca/src/main/runtime/orchestration/lifecycle-reconciliation.test.ts)
- [旧 Coordinator 类](/Users/micjoyce/develop/github/orca/src/main/runtime/orchestration/coordinator.ts)
- [来源与执行上下文](/Users/micjoyce/develop/github/orca/src/shared/task-source-context.ts)
- [Plugin manifest](/Users/micjoyce/develop/github/orca/src/shared/plugins/plugin-manifest.ts)
- [xopc Scene 只读执行器](/Users/micjoyce/develop/github/xopc/src/scenes/agentExecutor.ts)
- [Task 内部 Agent 派发](/Users/micjoyce/develop/github/xopc/src/tasks/task-run-dispatcher.ts)
- [Gateway Agent 接入](/Users/micjoyce/develop/github/xopc/src/gateway/service.ts:695)
- [Task 等待信号](/Users/micjoyce/develop/github/xopc/src/tasks/task-signal-service.ts)
- [Workflow 定义](/Users/micjoyce/develop/github/xopc/src/workflows/domain/definition.ts)
- [Workflow 运行状态](/Users/micjoyce/develop/github/xopc/src/workflows/domain/run.ts)
- [Workflow 回执桥接](/Users/micjoyce/develop/github/xopc/src/tasks/task-workflow-coordinator.ts)
