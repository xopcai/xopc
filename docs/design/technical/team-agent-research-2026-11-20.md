# Grok Bot 团队协作调研与 xopc 取舍

2026-11-20。依据 xAI 官方文档、发布记录、公开用户配方、同类产品的官方技术资料和 xopc 当前检出代码。结论来自资料与静态走查，未实测 Grok Bot，也未运行 xopc 端到端场景。

## 结论

xopc 可以先在 Project 里做一条可重复的团队工作链。Personal 负责接单和向用户交付，具备不同能力与权限的 Agent 按依赖执行独立任务，项目承载目标、过程、结果和验收。优先做「项目周报」纵切，以证据覆盖、交付质量、成本、恢复和通知数量决定是否扩大范围。团队角色配置、多人共享及通用 Agent 互发消息各自有独立需求和成本，可依据试点结果排期。

## Grok Bot 怎么做

| 层次 | 公开可确认的做法 | 对 xopc 的启发 |
| --- | --- | --- |
| Bot 身份 | 用户给 Bot 指定职责，维护技能、记忆、文件、连接和例程。官方文档描述个人 Bots 使用共享的持久云电脑，具有浏览器、文件系统和终端。 | 角色配置可复用 Agent 和 Skill。工作连续性可由已有项目、引用和任务状态承载。共享电脑降低配置成本，也扩大共用登录态、文件冲突和误写的影响范围。 |
| 多 Bot 交接 | 官方示例由一个 Bot 定时取数，一个写活动草稿，一个对照数据和品牌资料审阅，最后给人处理。1.0 演示了在 Slack 讨论中由 Research Bot 带上 Copy Bot 延续任务。 | 用户可以按成果和阻塞理解分工。把已核验的数据或稿件交给下游，并让人从原入口找到结果。 |
| 主动工作 | Routines 将重复任务固化为可设时运行的工作。1.0 还描述监测项目、发现待办、跟进未完成工作和邀请人决策。 | 把发现、执行授权和提醒分开。观察可先形成有证据的草稿，稳定后登记为 Project Automation，真正需决定时再进入 Feed。 |
| 面向多人共享 | Team Bots 可发布给指定人群，各用户有自己的对话和私人笔记。共享 Bot 使用用户已连接的插件时有同意流程。Slack 和 Teams 是协作入口。 | 这是多用户访问、记忆隔离和委派授权能力，需要独立验证。首版个人项目里的多 Agent 已能验证工作链是否有价值。 |
| 最后一公里 | 长工作先确认收到，问题和审批有卡片，运行有可查看的状态，完成后交付到约定位置。 | 先把迟到结果、部分成果、外部动作审批和成果回传做准确。状态摘要与任务链接通常比完整过程流更适合用户入口。 |

[xAI 产品文档](https://docs.x.ai/grok-bot/overview) · [Grok Bot 1.0 发布说明](https://x.ai/news/grok-bot-1-0) · [产品更新日志](https://x.ai/changelog/bot) · [Bot 配置与模板](https://docs.x.ai/grok-bot/bots) · [数据与持久环境条款](https://x.ai/legal/grok-bot-terms)

### 消息、运行环境与记忆边界

- **消息**。Grok Bot 原生群聊可以加入 2–6 个 Bot，提供共享目标和可见交接。普通消息由参与者判断谁回应，提及或回复可明确接收者。Bot 也可私下把工作交给另一 Bot，记录出现在各自聊天里。Slack 的交接可通过已接入 Slack 的 Team Bot，它有自己的应用和 handle。对 xopc，可以用 Project 任务列表提供可见交接，用任务级问题和回答处理例外，先验证用户是否仍需要专门群聊。[官方协作文档](https://docs.x.ai/grok-bot/chat-and-collaboration)
- **运行环境**。同一账户的个人 Bots 共用文件、浏览器登录态与命令行凭据，各 Bot 有自己的屏幕，每块屏幕同一时刻只能执行一个电脑操作任务。Team Bot 在私聊中使用该用户的电脑，在共享对话中则使用 Bot 专属的共享电脑。对 xopc，项目资料可共享引用，环境与授权仍应按执行任务控制。[电脑与应用](https://docs.x.ai/grok-bot/computer-and-apps) · [Team Bots](https://docs.x.ai/grok-bot/team-bots)
- **配置、权限和学习**。Team Bot 的 Owner 和 Manager 管理共享设置。Collaborator 可以使用和教它，影响所有用户的学习建议需由 Owner 或 Manager 审核。私聊内容对其他用户和管理员隔离。用户连接以本人身份行动，共享连接则显式使用共享账户。对 xopc，团队记忆若进入后续范围，应区分个人偏好、可共享项目决策和正式流程，并为进入共享知识的内容保留来源和授权。[Team Bots](https://docs.x.ai/grok-bot/team-bots) · [审批与隐私](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- **主动与复用**。Skill 记录怎么做，Routine 记录何时做，可按时间或事件触发。主动建议主要由 Primary Bot 发出，用户接受后按该请求执行，Team Bot 可因例程所需权限在对应线程请求帮助。这与 xopc 的 Personal、Skill、Automation、任务等待和 Feed 有直接对应。[Skills 与 Routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) · [主动工作规则](https://docs.x.ai/grok-bot/initiative)

公开资料足以确认上述产品行为和权限规则。内部队列、Agent 寻址、调度拓扑、记忆存储、重试和去重机制仍缺少可验证的公开实现。

**公开用户配方。** Tim Scheuer 的 GTM 团队用 Chief of Staff 和组长路由，专职 Bot 各有一项工作，Content Room 承载必要讨论，把交付目标、输入、Skill 和限制交给 Claude Code/Codex 执行。作者将例程从十条减到一条，也把自己认为质量不足的制作环节改为专门执行器。另一个开源配方让各 Bot 调用本机工具，在授权目录与分支里工作，回报变更、测试和待决问题，推送或合并留给人确认。两者都是作者公开的配置，能说明哪些规则可由使用者表达，无法证明 Grok 内部实现或普遍收益。对 xopc 最有价值的证据是角色要有清晰输入、输出和权限，长期运行要减少例程与唤醒次数。[GTM 角色与交接](https://github.com/timscheuerai/grokbot-gtm-team) · [本机执行配方](https://github.com/reichenbach/grokbot-agent-bots)

## 同类系统提供的实现参照

| 参照 | 协作单位和机制 | 适用条件与成本 |
| --- | --- | --- |
| [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) | Lead 和独立 teammate 会话、共享任务表、依赖、认领及点对点消息。 | 适合需要同伴同步、可独立分工的工作。并行改同一文件、恢复和状态协调更复杂。xopc 可以优先借任务依赖与独立上下文。 |
| [Anthropic Research](https://www.anthropic.com/research/multi-agent-research-system) | Lead 拆分开放式研究，多个独立上下文并行找证据，Lead 汇总。 | 适合搜索面宽、分支能独立探索的任务。原文报告其内部评测相对单 Opus 4 高 90.2%，也报告多 Agent 相对普通聊天约 15 倍 token。这是两个不同基线，需在 xopc 用同模型、同来源、配平预算的基线测净收益。 |
| [OpenClaw Session Tools](https://docs.openclaw.ai/concepts/session-tool) | 以 Gateway 会话为地址，分别提供跨 Agent 发消息和子运行能力。可把发送权限限定到指定 Agent，将历史访问独立控制。 | 适合灵活联络和可寻址的常驻 Agent。发送成功只表达消息层结果，业务承诺、产物权限和成功条件仍要由上层定义。 |

三类机制可叠加。短时并行的价值主要是独立探索，持久团队的价值主要是长任务接续和权限分工，聊天通道的价值主要是处理例外。对 xopc，是否需要独立权限、可恢复状态或独立验收，比分工角色的数量更适合用作拆任务的判断标准。

## xopc 现有底座和缺口

| 环节 | 当前代码可见能力 | 试点需验证或新增 |
| --- | --- | --- |
| 前台和后台 | Personal 提交持久 Task 后由后台分配。Router 选一个符合模型、工具、Skill 和材料要求的执行者，再由运行队列处理。另有有界的 `delegate_task`，可带独立上下文做研究、审查等短委托。 | Project 级的任务编排授权和预算。常规交办继续由当前分配，根据独立成果和职责才拆 Task。 |
| 项目和任务图 | Project 有默认 Agent、目标和 workspace。Task 持久保存父任务和依赖。依赖服务检查环和阻塞，Project 已有任务图和运行投影。 | 配置谁可承担项目角色。验证策划、审阅和回传能从父任务追溯，状态由实际依赖及成果投影。 |
| 交接与恢复 | 任务协作记录有进度、问题、指令、确认和结果，持久投递。运行有租约及恢复。结果回传核对运行、当前要求、分配代次和指令序号。 | 当前依赖解锁以先行任务关闭且结果为 done 为准。跨任务还需显式固定接受的上游结果及证据引用，并在执行/交付前确认版本。对已开始的下游，旧结果失效要有可读状态。 |
| 验收与主动入口 | 已有任务验收和签收、Project 绑定 Automation、首页观察草稿、项目阻塞和下一步投影。 | Loop Feed 试点仅投影待决、实质阻塞和可签收交付，保留原 Task 链接。普通进度可在项目查看，Feed 抑制重复并记录用户是否处理。 |
| 授权与环境 | 分配阶段检查候选和连接账户，任务上下文引用固定材料，委派权限受父权限约束。项目支持本地目录和托管 worktree。 | 有效授权取用户授权、项目范围、任务范围与执行者权限的交集。Agent 通过受控产物引用交接，写仓库任务用独立 worktree，发布由现有动作授权承接。 |

[现行 Personal 后台分配与已知限制](../foreground-agent-task-orchestration.md#personal-单层后台分配现行契约与设计差异) · [委派工具](../../../src/agent/tools/delegate-tool.ts) · [项目模型](../../../src/projects/types.ts) · [任务依赖](../../../src/tasks/task-dependency-service.ts) · [协作记录](../../../src/tasks/task-collaboration-repository.ts) · [成果回传](../../../src/tasks/task-result-delivery-service.ts) · [项目运行视图](../../../src/tasks/project-operating-view-service.ts) · [首页观察草稿](../../../web/src/features/tasks/home-observation-card.tsx)

## 首个试点：一个项目的一份周报

选择已有项目，固定一周、目标和获准来源。由 Personal 提交并承接最终汇报。两个只读分支分别整理 PR/Issue 与项目讨论/决策。依赖边将两个分支的成果交给汇总任务，汇总稿需要把完成、进行中与证据不足分别写清，并可定位来源。最后执行事实核验。首版可用短时 reviewer，只有在需要独立权限、恢复或有单独待办时才给 reviewer 建 Task。用户从原对话或 Project 打开同一份版本化周报，按需要修改或签收。先手动触发，同一流程稳定后再从项目 Automation 定时触发。

最小交接包含目标及子任务身份、要求版本、执行者、输入与上游结果引用、预期产物和验收条件、授权范围。持久记录准备完成、需要用户输入、交付、作废等实际状态。Agent 输出提供候选计划及事实说明，Gateway 校验依赖、启动权限、状态转换和回传。初始试验建议最多同时运行两个取证分支，限制自动修订轮次，沿用前台和后台资源隔离测试口径。

失败演练包括一支来源断开、执行中调整周报范围、上游结果被替换、Gateway 在写入成果和回传之间重启、同一 Automation 触发重复提交。预期分别是明确部分覆盖和原任务续跑、旧运行不覆盖当前成果、下游引用可核对、成果只交付一次、一次计划只创建一套工作。发布另设批准，影响未知时走核对。最终结果和通知应能追溯原请求。

### 如何决定值不值得做大

1. **A/B/C 分开测。** A 是同一 Agent 在一个任务里做完全程。B 是同一 Agent 加短委派并行。C 是持久任务图与项目角色。固定来源、任务和验收标准，记录相同模型配置下的总 token 与工具消耗，另做预算相当的对照。
2. **对照质量和运营指标。** 盲审证据覆盖、事实错误、重要遗漏和首稿验收率。比较耗时、成本、用户介入、通知条数，以及故障至少一次恢复后的重复交付和过期结果。单 Agent 按同样的故障、来源与版本规则评估。
3. **按结果扩范围。** 若 B 已提供相近质量和耗时，保留短委派。若 C 在真实项目中稳定减少人工追问、恢复成本，或明确改善来源覆盖、独立审核和跨周期接续，再加项目角色模板与例程编辑。多人共享、直接同伴消息和第三方执行器，分别用实际用例验证需求。

近期 xopc 周报记录的三条线已经对上这个场景。Agent 体系有任务结果与人工验收，Project 有自动化配置归属，Loop Feed 相邻能力已有观察到草稿。对外最直观的验收是用户从一条项目观察出发，经过执行和决策，最终在同一目标下找回带来源和验收状态的交付物。周报也明确记载该闭环仍待验证。[验收相关提交](https://github.com/xopcai/xopc/commit/8c2d3bf0f41071886c6e7d46ac735bb6ef6e1727) · [项目自动化归属](https://github.com/xopcai/xopc/commit/74e0f353fb6280a1ab57f2149464926cb8d03f55) · [观察草稿入口](https://github.com/xopcai/xopc/commit/1b7f93becb4ef2ec6bd1842615f4f3b907df12f5)
