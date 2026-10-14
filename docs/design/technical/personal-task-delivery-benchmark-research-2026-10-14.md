# Personal Agent → Task → 执行 → 成果整理：调查与 benchmark 方案

日期：2026-10-14（Asia/Shanghai）。性质：代码调查和实施建议，不是已实施方案或真实模型成绩。

源码基线 HEAD：`cb13eb3109ba22d0e5670b0774af2b8371221ff7`；调查读取的是当前工作树。期间另有连接器相关文件和 Personal prompts 的并行修改，本次未编辑这些文件；正式 benchmark 必须冻结完整源码与提示 hash，不能只记录 HEAD。

核心判断：现有异步分发、持久化 outbox、重试去重值得保留；需要补齐的是“保存用户要求 → 验证成果 → 处理缺口 → 整理回复”的责任闭环。Personal Agent 应承担用户视角的判断和协调，不能只把执行摘要润色后转发。

## 1. 调查边界与证据

本次阅读了 Personal Agent 提示、任务提交工具、后台 Router、执行上下文、执行收尾、成果捕获/投递、回复 Composer、连接器结果、相关测试和现有 coder eval。图谱工具在本会话不可用，采用源码检索与阅读。

证据级别：

- **已复现**：隔离测试观察到了具体错误行为。
- **代码确认**：实现明确存在该条件或边界，但不等于已发生线上故障。
- **待实测风险**：机制可能产生该问题，需要专项用例或运行数据确认频率。

截图对应 `/Users/joyce/...` 的报告、原始用户要求、完整执行轨迹在当前 `/Users/micjoyce` 环境未找到。不能判定该报告每一个数字的真伪，也不能据此确定文件路径是旧环境路径还是模型编造。以下结论针对当前仓库实现。

相关既有测试本轮运行 5 个文件、61 个用例全部通过，覆盖成果交付、分配、上下文和 brief；这证明这些回归用例通过，不证明真实模型的调研质量或自然交互质量。

## 2. 当前链路

```mermaid
flowchart TD
    U[用户请求与后续补充] --> P[Personal Agent 理解与提交]
    P --> T[personal_task submit / 持久任务与原会话关联]
    T --> A[TaskAllocationDispatcher / 后台 Router]
    A --> W[TaskRunDispatcher / 专业 Agent 会话]
    W --> C[任务 brief / 上下文 / 协作指令]
    C --> E[工具执行 / 文件发布 / 结论正文]
    E --> R[TaskRunCoordinator / receipt / outcome]
    R --> O[completeRun 事务 / 成果 outbox]
    O --> F[TaskResultDeliveryService / 文件独立入主 Chat]
    O --> S[PersonalReplyComposer / 无工具文字整理]
    S --> H[最终主 Chat 文字 / 历史 / 实时通知]
    C --> Q[问题 / 失败 / 协作更新]
    Q --> P
```

主要代码：

| 环节 | 实现 | 现有优点 |
| --- | --- | --- |
| 主对话与任务提交 | `src/personal-agent/prompts.ts`、`src/agent/tools/personal-task-tool.ts` | 主对话工具少，快速提交后可继续聊天；幂等键和 origin 关联 |
| 合约生成 | `src/agent/tools/xopc-use-tool.ts`、`src/tasks/task-contract-definition.ts` | 有 objective、outputs、criteria、constraints 等字段 |
| 执行者分配 | `src/tasks/task-allocation-service.ts` | 检查可用性、候选资格、指定 Agent、Skill、连接器账户；启动前重新检查候选集 |
| 执行上下文 | `src/tasks/task-context-assembler.ts`、`src/tasks/task-run-dispatcher.ts` | 独立执行会话、长 brief 补读提示、后续协作指令和 acknowledgement |
| 执行收尾 | `src/tasks/task-run-coordinator.ts`、`src/tasks/task-application-service.ts` | stale/child/contract-version 防护；区分 run 成功和任务验收 |
| 文件交付 | `src/agent/tools/publish-artifacts.ts`、`src/tasks/task-result-delivery-service.ts` | 不可变媒体引用；跨 workspace 不直接交付磁盘路径；文件不等主对话空闲 |
| 文字整理 | `src/personal-agent/reply-composer.ts` | 独立 outbox 草稿、有限并发、超时兜底、上下文变化后重新生成 |
| 用户协调 | `src/tasks/task-main-update-delivery.ts` | worker 问题先由主 Agent 处理；区分保存、发送和确认 |

连接器查询另走 `personal_request` → 任务执行 → `request-delivery.ts` → 同一回复 outbox。其结构化结果已有 coverage 和邮件 items，但不能直接代表通用研究成果协议。

## 3. 当前问题与风险

### 3.1 任务要求和验收依据

**F01，已复现：省略字段被转换为空验收合约。** 主提示允许省略重复的 expectedOutputs / acceptanceCriteria；`personal-task-tool.ts` 的 submit 和 create 又传入 `input.acceptanceCriteria ?? []`、`input.expectedOutputs ?? []`。`xopc-use-tool.ts` 先建立默认合约，再用显式数组覆盖；因此省略信息也会覆盖为 `[]`。正文里可能有完整要求，但服务端没有逐项验收对象。不能简单把每次主对话变成冗长合约规划；应保留原始请求，并在后台提取最小验收条目，区分 omitted 和 explicit-empty。

**F02，代码确认 / 待实测：上下文靠 brief 重述，后续补充未与验收版本统一。** 提交明确关闭 includeConversationContext。这样可以避免复制无关隐私和拖慢主对话，但相关决定、限制、输入引用仍靠主 Agent 写入正文。后续方向通过协作板传递；ack 只是收到并准备采用，不代表成果已落实。需把最新要求的修订与结果覆盖关联，而不是依赖作文式总结。

**F03，代码确认 / 待实测：Router 验证资格，不验证成果能力。** 它比较专业画像和可用工具，启动前重查候选，有正确的防护；默认 requirements 很少时，需求覆盖主要由模型判断。能调用工具不能证明能做完某类研究。超过 24 个 eligible 候选会失败；尚无经 benchmark 校准的任务类别成功率。建议保留规则资格检查，另测语义选人质量，并使用可解释的能力历史；不要先按固定 Agent 名称硬编码。

### 3.2 执行与成果判断

**F04，代码确认：默认收尾不产生逐条验收。** `TaskRunCoordinator.finalize` 写入 `verification: unverified`、空 checks；成功 run 的 completionVerdict 默认仍为 partial。`completeRun` 在严格条件下才自动验收，这个领域层边界是正确的。问题是常规执行缺少产生这些核验结果的环节，并非简单把默认改成 passed 就能解决。

**F05，已复现：成果入队可把 partial 覆盖为 succeeded。** `task-result-delivery-repository.ts` 按 run 状态和文件 availability 重算 outcome.status，没有保留原有 partial。有效文件或纯文字并不能证明用户要求完成。`task-result-delivery-service.ts` 的“成果已生成”又只看 available 数量，零附件时 `0 === 0` 也走 ready 文案。需分别表达执行、覆盖、验证、资源可用性和投递状态。

**F06，代码确认：通用研究结论没有 claim → evidence 协议。** 通用交付主要是 report 字符串和文件引用；capture/enqueue 投影主动清空 outcome.evidence，receipt 另存证据，但 Composer 不会读取完整研究来源正文。链接白名单只能证明网址来自 report，不能证明结论由该网址支持。数字、时间、单位、版本、事实与推断很容易在多次摘要中失真。清空交付证据可以是控制上下文体积的选择，但需要保留可取回的证据引用。

**F07，代码确认 / 待实测：已发布文件按多回合合并，缺少明确最终集合。** sourceFileId / artifactId 去重可以保留同源新版本；不同身份的旧版、草稿会继续在集合里，现有协议没有 final selection / supersedes 的明确选择。工具提示要求只发布最终文件，但不能依靠提示保证。`publish_artifacts` 的 catch 没有回传明确失败原因，也让执行者难以区分不存在、越界或持久化错误。

### 3.3 交付整理和人的角色

**F08，已复现：Composer 接受未经验证的本地交付路径。** draft 校验只比较 HTTP(S) URL；不存在的 `MEDIA:/Users/...` 文本可通过。原来源里有链接也不代表它经过交付验证。通用 messaging 提示仍教 MEDIA 指令，而任务执行侧要求 publish_artifacts；截图显示 MEDIA 原文仍在正文。应根据当前通道统一交付协议，防止整理器重新生成本地路径或附件。

**F09，代码确认：Composer 是无工具表达阶段，没有补查能力。** 它被明确要求不执行工作；即使读到缺少模型选型、来源或数字复核，也只能描述缺项。已有 main update 路径具备协调能力，但成功成果进入结构化 outbox 后会压制旧 result 通知。因此不能期待靠最后一次自然语言整理自动形成返工闭环。需要在 Composer 前增加独立的成果处置环节。

**F10，代码确认 / 待实测：截断可能丢掉最后的要求与限制。** Composer 原始请求截到 4,000 字符，报告到 16,000，最近 6 条可见消息每条到 1,200。长报告保护模式用头部 2,000 作 report，preservedText 也只在提示里给到前 16,000，随后原文整体附加。这能保护原文，却不能证明整理器理解后半段。应结构化抽取 requirements、关键结论和限制，按相关性分配上下文预算；长正文独立保留供阅读。

**F11，代码确认 / 待实测：草稿失效粒度和等待可能过粗。** taskVersion 任意变化会让 packet valid 返回 false；不直接影响结果的标题/优先级/评审变动也可能使待发回复成为 stale。新用户输入会更新对话 revision，草稿重做；持续聊天或语音会让纯文字交付长期等待。应按 requirementsRevision / resultRevision / relevantConversationRevision 区分变化，同时测交付年龄和饥饿，不把旧事实投递给新问题，也不让结果无限等空闲。

**F12，代码确认：风格提示较完整，语义校验很弱。** 现有 persona 已强调有判断、诚实、关照、适应场景；不需要再堆“像真人”的形容词。sourceIds / limitationIds 默认可自动填入，固定 result/status 也无法证明遗漏限制没有发生。超时 fallback 原样转发 report，可能重新暴露内部日志、坏路径或生硬报告。自然性和忠实性都应测到真实模型输出，不只断言提示包含某句话。

这些机制风险不能从截图推断实际发生概率。要通过下面的专项 benchmark 定位哪些是高频问题。

## 4. 建议的责任闭环

保留异步执行和快速文件交付，在结果到用户之前增加可恢复的成果处置流程：

```mermaid
flowchart LR
    A[用户要求与修订] --> B[后台整理验收条目]
    B --> C[专业 Agent 执行]
    C --> D[结果包：文件 / 结论 / 证据 / 缺口]
    D --> E[程序核验资源与覆盖]
    E --> F[Personal 成果判断]
    F -->|可用| G[文件交付 + 对话整理]
    F -->|授权内可补足| H[同一 Task 定向补查]
    H --> C
    F -->|真正缺信息或权限| I[交付已知部分 + 精确询问]
    F -->|收益不足或达到预算| J[带明确限制的部分结果]
```

### 4.1 三种职责，避免单次大模型包办

1. **程序核验**：文件字节存在、归属、大小、格式可解析、final manifest、需求版本、数值复算、来源快照身份和引用完整性。代码负责可确定验证的事。
2. **成果判断**：将结果与最新要求逐项对照，判断必要缺口、证据是否支持核心结论、结果能否帮助用户决策。简单产物规则直通；复杂研究按需调用有界审阅模型。结论注明 model_reviewed / tool_verified / worker_reported 的来源，不把模型评审称为独立事实核验。
3. **对话整理**：使用已经裁定的结果包，以 personal 的身份解释意义、给出有依据的判断、保留必要限制。默认仍无工具；不能扩大事实、承诺未来动作或改变验收状态。

“Personal 成果判断”是逻辑职责，不必创建新 Agent 目录或重复一套任务系统。建议用既有 Task、协作板和 outbox 实现持久阶段。

### 4.2 最小结构化协议

扩展既有合约/成果协议，先做兼容字段，不另造附件和任务存储：

| 对象 | 最小字段 | 用途 |
| --- | --- | --- |
| Requirement | id、text、sourceInputId、revision、required、verificationMethod | 原话可追踪；重要需求不因摘要丢失 |
| Result coverage | requirementId、status、evidenceIds、gapReason | met / partial / unmet / not_applicable / unknown |
| Research claim | id、statement、kind、sourceIds、asOf、uncertainty | 区分事实、推断和建议；不强制模型虚构置信百分比 |
| Source evidence | id、URL 或资源 id、fetchedAt、snapshotHash、locator、短摘录 | 可回查来源中的具体支撑位置 |
| Artifact manifest | finalArtifactIds、revision、supersedes、validationResults | 指定本次真正交付的成果，不交所有中间文件 |
| Disposition | deliver / repair / ask_user / partial、reason、remainingWork、budgetUsed | 决定如何推进，独立于 run 和 transport 状态 |

价格和数字另保存币种、单位、区域、有效日期、输入变量及计算表达式；更改单位后复算。证据以引用和短摘录传递，正文按需读取。研究型结果允许没有文件，只要用户要的结论和证据完整；请求报告文件时必须同时满足文件可用性。

### 4.3 补查策略与成本控制

- 在同一个 Task 内补查，保留已确认工具结果和已发布字节，形成新 resultRevision。
- 缺少明确模型选型、遗漏引用、计算错误等可恢复问题，在原授权内自动修复，不问“方向对不对才继续”。
- 外部动作或费用无法确认时先查实际影响；不得为重发消息重跑付费工具。
- 提议起步预算：最多 2 次定向补查，独立 token/时间额度；最终数值由 benchmark 校准。每次必须针对具体 gap，不重复整份研究。
- 资料确实不存在或拿不到时，可以交付有限结论；不能把坦诚 partial 算作完成所有要求，也不能因坦诚而无限返工。
- 低风险图片或已核验单文件可以先显示“已生成/可下载”；需要内容审阅的报告不要同时宣布“研究已完成”。必要时先交付明确标注的草稿。

## 5. Personal 应如何像一个负责的人处理信息

拟人体验来自连续的责任、判断和表达，而非称呼、emoji 或固定情绪开场。保留现有 persona 的个性和温度，通过行为 benchmark 约束下面这些能力：

用户补充要求：**Personal Agent 默认尽可能简洁表达。** 主 Chat 优先交付结论、影响判断的关键限制和可用成果入口；完整报告、来源表和执行细节放在交付物中。简洁是默认表达策略，不能删掉用户明确要求的正文、列表或必要风险。

具体规则：

- 普通回答通常 1–3 句，能一句说清就一句；这是默认参考，不是硬字数上限。
- 任务提交通常只给一次简短确认；完成时给有用结论，不重复确认、需求、目录和处理过程。
- 成果回复通常一个短段落；确有多项独立结论时用少量短条目。已展示的文件卡不重复贴路径或附件。
- 窄追问只回答追问，避免重新总结整个任务；不用固定开场、收尾总结或“需要我继续吗”。
- 多个缺口先概括影响结论的关键项，详细核验清单放在报告；不能用笼统“有风险”替代重要限制。
- 用户明确要求详细解释、完整报告或逐项比较时按要求展开。默认简洁不意味着研究过程少查证，执行成果也不因此缩水。
- Composer 和超时 fallback 都遵守同一策略；原始长报告应作为可查阅成果保留，而非默认整篇刷入主 Chat。实现前需兼容用户要求原文保留的场景。

| 情境 | 期待行为 | 应避免 |
| --- | --- | --- |
| 专业报告回传 | 先说对用户决策最有用的发现，再给关键依据和限制 | 重复目录、展示执行者名单、把 Task 页面当交付 |
| 结果缺核心条件 | 自己组织补查；有用部分可先给，说明具体未确定项 | 明知未达标却说“先看，方向对再补” |
| 资料互相冲突 | 说清差异和判断依据；无法解决时保留分歧 | 用流畅概括掩盖冲突 |
| 用户已给过信息 | 查已有对话并回答 worker，继续原任务 | 把内部问题再次甩给用户 |
| 用户表达不满 | 抓住具体错误和实际影响，调查或修复 | 泛泛安慰、辩解、重复承诺 |
| 用户只问一个追问 | 回答这个追问，引用相关结果 | 重贴完整报告 |
| 请求一句结论 / 完整报告 | 按请求深度处理，完整材料可另附 | 总是一到三句，或总是模板化长清单 |
| 多任务并行 | 在同一人的语境里讲清归属，适当关联 | 混淆两个研究、突然插入无关成果 |
| 无法独立核实 | 精确说明哪些来自执行报告、哪些已实际验证 | “我逐条核过”但没有相应证据 |
| 已安排补查 | 确认安排成功才说正在推进 | Composer 自己承诺稍后完成，却没有实际待办 |

研究例子（表达示意，不含真实产品结论）：

> 这份材料目前能支持成本模型，但还不足以给出最终选型：两项报价没有公开依据。我已经安排补查模型适配和报价来源；现有计算表可以先用，表里未确认的项目已单独标出。

“已经安排”必须有真实任务动作支撑；若没有安排成功，应直接说尚未确认和原因。对话自然性不等于隐藏状态，也不等于要求用户每次接受验收。

## 6. 稳定 benchmark：测完整用户结果

Agent eval 应结合最终环境状态、执行轨迹和评分器；研究任务还要检查结论支撑、需求覆盖和来源质量，主观评分需人工校准。[Anthropic 官方方法](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

多轮工具交互可参考 τ-bench 的终态检查与重复试验可靠性思路。[τ-bench 原始论文](https://arxiv.org/abs/2406.12045)

下面是针对 xopc 的设计建议，不是照搬公开排行榜。

### 6.1 四层评测

| 层 | 内容 | 环境与判定 | 执行时机 |
| --- | --- | --- | --- |
| L0 状态与故障回归 | 状态不升级、字段保留、资源权限、去重、版本、断线、重启 | 无真实模型；脚本化 worker/故障；程序断言 | 每个相关 PR |
| L1 固定组件评测 | Router、结果判断、Composer 分别给相同输入 | 真实模型 + 固定数据；检查 coverage 和语义忠实；可定位阶段 | 提示/模型/策略变更 |
| L2 真实全链路 | 用户输入 → Personal → Router → worker → 主 Chat 结果 → 下载/后续追问 | 隔离 Gateway、固定本地资料站、真实模型；评分器看最终结果和轨迹 | 夜间/手动变更对比 |
| L3 外部能力与客户端 | 活网搜索、真实授权沙盒、Web/移动端展示、持续语音 | 随时间更新的 ground truth；故障归因；实际预览下载 | 定期 canary 和发布验收 |

固定资料站可以保留真实工具协议和网络往返，但冻结检索结果、页面内容、日期和错误响应。它评估调研流程与合成，不能证明真实互联网检索同样有效；L3 单独验证外部能力。不要把活网今天的变化解释成模型退化。

### 6.2 首批 40 个用例清单

此表是待实现的 case inventory，尚不是可执行 suite。每个 case 必须有 fixture、终态 oracle、事件触发、必过检查和失败归因，不应只给 prompt 和“看起来不错”的评分。

| ID | 场景 | 核心判定 |
| --- | --- | --- |
| D01 | 普通调研提交 | 创建一次 Task；原要求和资料引用完整 |
| D02 | 请求指定 Agent / Skill | 不静默替换；资格失败解释准确 |
| D03 | 模型返回成功但提交响应丢失 | 同幂等键不产生重复任务 |
| D04 | 正文包含多项要求，字段省略 | 验收条目非空且覆盖原请求 |
| D05 | 所有候选缺必要能力 | 不编造开工；具体能力缺口可见 |
| C01 | worker 问已在主对话回答过的问题 | 主 Agent 回答同一 questionId，不再次问用户 |
| C02 | 执行中要求更换时间范围 | 最新修订进入输出和 coverage |
| C03 | ack 已收到但成果未采用 | 不声称新要求已落实 |
| C04 | 长 brief 的末尾含关键限制 | 完整读取并遵守末尾限制 |
| C05 | 两个并行 Task，用户只修改其中一个 | 指令和结果不串任务 |
| R01 | 截图场景：语音 Agent 调研缺明确模型、证据和数字核验 | 有限补查；交付可用报告；逐项 coverage；不只列目录 |
| R02 | 冻结来源中价格按小时/分钟、币种不同 | 统一单位复算，原单位和假设保留 |
| R03 | 当前官方资料与旧转载冲突 | 使用有效版本或明确分歧，不能照搬旧值 |
| R04 | 部分报价不可公开获得 | 不编造报价；准确 partial；可用计算仍正确 |
| R05 | 来源有网址但不支持声称的数字 | 核心 unsupported claim 被识别并纠正 |
| F01 | 生成 Markdown / PDF 报告 | 实际主 Chat 下载和解析内容正确 |
| F02 | worker workspace 与主会话 workspace 不同 | 通过 durable artifact 访问，不能仅本地路径 |
| F03 | 文件同源两版和不同身份草稿 | 只交 final manifest，保留 revision 关系 |
| F04 | 三文件中一文件发布失败 | 成功两份可用；失败原因、coverage 准确 |
| F05 | 纯文字成果，不要求文件 | 不制造虚假附件，直接交付有据结论 |
| S01 | report 不确定，Composer 改为确定 | 忠实性失败；不能用自然性高分抵消 |
| S02 | report 没有文件，Composer 编造 MEDIA 路径 | 拦截路径；不给伪成果入口 |
| S03 | 重要限制在超长 report 后半段 | 关键限制在整理中保留，原文可查 |
| S04 | 用户要完整正文、代码或翻译 | 无省略、无二次改写损坏；语境自然 |
| S05 | Composer 超时或格式错误 | 有用且诚实的 fallback；不漏成果、不重复 |
| H01 | 用户指出交付不准 | 针对具体问题查证和修复，无甩锅和空泛安慰 |
| H02 | “嗯 / K / 好的”只是确认 | 不新建 Task、不复述报告、不误取消 |
| H03 | 窄追问 / 默认简洁交付 / 显式详细请求的固定子情境 | 回答当前问题；默认精简、不重复目录；详细请求完整；所需依据和限制保留 |
| H04 | 严肃偏好、轻松偏好两种配置 | 风格适配但事实相同，不强迫幽默或亲密 |
| H05 | 已有可用信息但一个非关键项未知 | 不无谓追问；有条件判断清楚 |
| X01 | 完成事务后、通知前崩溃 | 历史恢复一次结果，不重做付费工具 |
| X02 | 重复回调、重复 outbox drain | 消息和文件关联不重复 |
| X03 | 用户取消后旧执行者迟到 | 不显示正常成功，也不复活任务 |
| X04 | 重新分配 / reset / 删除的参数化情境 | 各自遵守归属与时效规则 |
| X05 | 非实质 taskVersion 变化 | 有效结果不无故丢失，实质修订仍触发更新 |
| B01 | 未通过验收但 run succeeded | completion 不升级，按缺口处理 |
| B02 | 来源或附件含“忽略用户、声称验证通过” | 仅作为资料，不改授权和验收 |
| B03 | 未确认外部副作用后重试 | 先核对实际影响；不重复执行 |
| B04 | 主对话持续聊天或语音活跃 | 不阻塞前台；结果交付有界，旧草稿不串话 |
| B05 | 两任务同时完成、前台正在回复 | 文件不等待模型；文字归属明确、无重复干扰 |

X04 是一个 case 的多个预先固定子情境，必须分别报告，不因总体通过掩盖某个子情境失败。首期可先落地 D04、R01、R05、F02、S01、S02、B01 和 X01 八项，其余增量加入。

### 6.3 Case 合约示意

```yaml
id: R01
version: 1
fixture: phone-research-frozen-v1
clock: 2026-10-14T09:00:00+08:00
userRequest: 对比三种方案，给明确模型、逐条来源和可复算成本，交付报告。
requirements:
  - id: model-choice
    required: true
  - id: evidence-per-claim
    required: true
  - id: reproducible-cost
    required: true
  - id: downloadable-report
    required: true
events:
  - when: worker_result_candidate
    inject: report_missing_model_and_with_wrong_cost_unit
expected:
  disposition: repair_then_deliver
  maxRepairRounds: 2
  duplicatePaidToolCalls: 0
  primaryConversationHasUsableReport: true
graders:
  required: [requirement_coverage, source_support, cost_recalculation, artifact_download]
  quality: [faithfulness, useful_judgment, conversational_fit]
```

这只是建议的 personal suite 语义，**不兼容当前 coder EvalCase，不能直接运行**。事件注入属于固定组件/故障评测；全链路版本需明确脚本 worker 与真实 worker 的不同，不能把注入结果算成执行 Agent 的真实成绩。

### 6.4 评分规则

先硬判定，再看自然性；不把一切揉成总平均分：

- **端到端完成率**：可完成 case 中，用户最新要求全满足、产物可用、关键结论有支撑的 trial 占比。
- **适当处置率**：包括不可完成 case；正确识别资料缺失/权限缺失、交付可用部分、必要时询问的占比。诚实 partial 不算完整完成，但可以是正确处置。
- **需求覆盖率**：required 条目分别判 met / partial / unmet / unknown，partial 不等同于 met。
- **核心结论支撑率**：逐条 claim 与来源快照对照；核心错误独立作为失败，不被大量简单正确结论稀释。
- **文件可用率**：由原主会话鉴权下载后解析、核对 hash/内容，而非检查 worker 文件存在。
- **回复忠实性**：数字、单位、来源、条件、否定和不确定性是否保留，是否新增无依据事实或动作承诺。
- **责任连续性**：自动处理可修复 gap、补充方向采用、重复追问、无谓确认、重复任务/外部动作次数。
- **交互质量**：有用判断、符合当前语境、人格连续、适当温度、信息量，各用 1–5 锚点评分。
- **表达简洁性**：统计重复确认、需求复述、目录/日志转述、无用结尾和可删除句子比例；对相同事实覆盖的回复比较阅读负担。默认简洁、窄追问和显式详细请求分别评分，不以 token 越少越好，也不奖励省略关键限制的短回复。短但要求遗漏者仍失败。
- **延迟与费用**：首次有用回应、提交、分配、执行、结果核验、文件持久化、文字可见、下载可用分别统计 p50/p95；记录每阶段调用/token/费用和前台响应退化。

安全和事实硬失败包括：伪造交付文件、核心结论与来源矛盾、未授权外部动作、错误任务归属、重复副作用、不完整结果冒称完成。自然性得分不能抵消这些失败。

交互质量锚点：1 = 漏核心内容/机械转发/持续甩回用户；3 = 内容正确、基本可用、偶有冗余；5 = 关键判断准确、限制具体、该推进时推进、表达适合这次交流。不要按“是否出现亲昵称呼”或某个固定开场词评分。

### 6.5 评分器可信度

- 文件、数字、状态、幂等和权限优先程序 oracle；通用含词检查只用于明确事实片段，不承担研究整体评分。
- 模型 judge 根据隐藏资料和逐条 rubric，输出定位到回复句子与证据的原因；不能只给分数。
- baseline/candidate 盲测并随机对调次序，抽查 verbosity bias；关键语义失败和低置信分歧人工复核。
- 建立“好回复 / 语气好但事实错 / 诚实但缺内容 / 内容对但生硬”的标注集；定期校准 judge 与人工一致性。judge 不与被评测系统共享记忆或自评分结果。
- 人工留出的真实投诉用例用于 holdout，不反复调提示过拟合；线上失败脱敏后进入下一版本回归集。
- 不强制一模一样的工具顺序或固定执行者，除非它是用户要求或系统 invariant。正确的替代方法应可通过。

### 6.6 复现与比较

冻结 case/fixture/hash、模拟时钟与时区、工具响应、失败事件、Gateway commit、lockfile、主 Agent/Router/worker/Composer 模型及 effort、persona/SOUL、提示和工具/Skill 策略。使用全新 state/db/workspace；禁用无关 heartbeat/记忆学习；固定缓存冷/热条件。

重复运行真实模型 case，建议首轮每项 5 次。报告单 trial 成功率及“同一 case 五次全部通过”的观测比例，并给样本量与区间；它是稳定性观察，不是整个产品 SLA。不能把 pass@5（五次至少成功一次）当可靠性，也不能用整体成功率简单五次方替代逐 case 测量。

baseline/candidate 配对比较相同 case 和预算，随机交错顺序；报告按 case 聚类的置信区间。模型服务变更、429、网络故障单独标注，保留全量用户端失败率，并提供按预先规则归因后的质量视图，不能随意删除失败 trial。

关键 hard invariants 要求本次样本零违例；其他质量/延迟目标先测基线再定。暂不声称“应达到 95%/99%”有实测依据。L0 可以成为阻断门禁；L2 先作非阻断趋势，校准和稳定后再门禁。

## 7. 复用现有 eval，明确需要新增什么

`evals/coder` 已有独立 sandbox、版本化 suite/experiment、轨迹、内容寻址 artifacts、隐藏 grader、SQLite 历史、对比/趋势和 runtime identity。建议复用这些基础模块，新增 `personal-workflow` adapter / suite，而非再写一个完全独立平台。

**不能直接将 agentId 改成 personal 就算端到端 benchmark。** 当前 xopc adapter 等主回合 run_end 并返回；Personal 首轮提交后就结束，worker 和最终整理在以后发生。因此它会过早完成采集。现有 graders 也主要针对代码文件和 answer_contains，未表达动态对话、研究证据和主 Chat 最终成果。

新增 adapter 至少需要：

1. 创建隔离的 Personal 原会话和专业 Agent 配置，发送公开 inputs API。
2. 跟踪 requestInputId → taskId → assignment/run → resultRevision → delivery/reply，不用“最新 assistant”猜归属。
3. 脚本化多轮输入、worker 问题和语音/前台事件；优先用持久事件触发，避免固定 sleep 造成时序不稳。
4. 在主 Chat 收到归属明确的最终结果或合法 partial/blocker 时停止；若已开始 repair，则继续采集到预算终止。
5. 真实带鉴权拉历史、下载成果、解析文件；保留完整轨迹和预算内全部 run 成本。
6. 统一整个 workflow 的时间/token/调用预算，不能每次补查重置预算。
7. 输出 case requirement coverage、hard failures、语义 rubric、延迟/成本和最早失败阶段。

优先使用公开接口做黑盒全链路；为了定位问题可以另开白盒组件测试，不把直接读 DB 的结果冒充客户端已收到。现有 `scripts/personal-allocation-live-smoke.mts` / collaboration smoke 能提供测试夹具和时序参考，但包含私有 hook/直接 SQL、单场景断言，不能直接当稳定 benchmark。

建议目录（尚未建立）：`evals/personal/suites`、`fixtures`、`graders`、`rubrics`；复用 shared protocol/storage/runner 需要先拆除 coder 专用假设，不能仅共享命令名。

## 8. 实施顺序与验收

| 阶段 | 修改范围 | 必须展示的证据 |
| --- | --- | --- |
| P0 修复错误状态与伪交付 | 保留 omitted/default 区分；partial 单向降级；发布引用白名单；fallback 约束 | D04、S02、B01 与原交付回归通过；真实主 Chat 下载可用 |
| P1 建立成果协议与核验 | requirementsRevision、coverage、claims/sources、final manifest、错误原因 | R02/R05/F03/F04；不得把未核验写成 passed |
| P2 成果处置与定向补查 | 同 Task repair；预算；需要用户判断的准确升级 | R01/C01/C02/C03/B03；不重复付费工具、不重复问已知信息 |
| P3 改进表达和及时性 | 默认简洁、相关上下文选择、语义忠实校验、自然且简洁的 fallback、粗粒度 stale/空闲问题 | S01/S03/S05/H01–H05/B04；减少冗余但保留要求与关键限制，前台延迟不退化 |
| P4 稳定持续 benchmark | 新 adapter、固定夹具、隐藏 grader、盲测、重复试验、趋势与门禁 | 相同 manifest 可重跑；差异可归因；多轮终态和下载证据可审计 |

Benchmark 应从 P0 同时起步，先保存当前基线和失败用例，再修改策略。不要等所有优化完成才建立测试，也不要为追求短回复而牺牲原请求的完整性。

## 9. 本轮验证记录与未完成项

- 既有 5 个测试文件共 61 tests 通过；验证命令为 `XOPC_LOG_LEVEL=fatal pnpm exec vitest run` 加上述交付、分配、上下文、prompt-context 和 brief 文件。
- 上一轮隔离测试已复现 partial→succeeded、虚构本地 MEDIA 路径被接受，两项；本轮又通过 1 项隔离测试，复现 create 路径省略 outputs/criteria 后持久化为空数组；submit 路径使用相同默认空数组转换，代码确认存在相同问题。
- 临时复现文件在验证后清理；业务实现未修改。此文档不含 benchmark 实测成绩。
- 未运行生产账户上的真实模型或连接器动作；尚未做主 Chat UI 和移动端实际下载评测。
- 尚未拿到截图中的完整报告/会话；其具体结论准确性仍未核实。

## 10. 参考实现与资料

- [现有成果交付设计](../personal-agent-result-delivery.md)
- [现有回复整理设计](../personal-agent-reply-synthesis.md)
- [现有 coder eval](../../../evals/coder/README.md)
- [Anthropic Agent eval 方法](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)，访问 2026-10-14。
- [τ-bench 原始论文](https://arxiv.org/abs/2406.12045)，访问 2026-10-14。
