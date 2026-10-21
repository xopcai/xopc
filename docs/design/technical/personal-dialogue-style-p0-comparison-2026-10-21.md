# Personal AI P0 修复与原基线对比

2026-10-21。被测模型固定 GPT-5.6 Sol，裁判与 EQ 模拟用户固定 GPT-6.1 Sol。候选 thinking off，裁判/模拟用户 low；单次采集，原始模型别名不等于锁定底层权重版本。

**结论：未达到全部预先注册的诊断门槛，不能宣称三类问题已全面解决。** 中文重点验证的加权偏好为 **58.33%**；这是同一个裁判交换展示顺序后的描述性结果，不是人类满意度或统计显著性结论。

本轮收益主要体现在重复收尾和局部澄清行为；中文过度解读的减少尚未稳定迁移到 EQ，整体自然度也没有提高。

## 1. 实际改动与验证边界

- 对缺失信息先判断是否实质改变答案、动作或授权；低风险创作可合理默认后直接完成，收件人/账号/破坏性操作仍须澄清。
- 不从一个情绪词推导隐藏动机或关系问题，不安慰用户未表达的担忧；被纠正后放下该推断，按当前具体需求回答。
- 用户接受已谈妥的计划、没有新问题时，简短回应并结束，不再提醒下一步、复述益处或追加追问；有新内容仍正常处理。
- 区分约定、执行和验证后的改善，不以一次同意宣布关系建立信任或事情已经解决。
- 旧画像只迁移完整匹配的生成规则，保留用户改写和引用；新增幂等迁移回归测试。

生产实现只改 [`prompts.ts`](/Users/micjoyce/develop/github/xopc/src/personal-agent/prompts.ts) 和共享 [`reply-style.ts`](/Users/micjoyce/develop/github/xopc/src/personal-agent/reply-style.ts)。A/B 其余生产源码、锁文件一致；测试文件另有一处改动。两轮使用全新默认画像和干净隔离会话；原基线与最终版画像发生变化的字段为 `instructions`。上游题库、原始评分提示和原 12 个 EQ 场景保持一致。

## 2. 中文固定对话验证：三类 P0

新增 30 个固定脚本，其中 24 个重点行为场景（各 8 个），另有 6 个必要澄清、详细交付、事实反驳控制场景。两边收到相同用户脚本，各自生成助手历史；隐藏期望没有交给候选。它不模拟真实用户的自适应回应，也不代表真实使用分布。

每对由 GPT-6.1 Sol 评两次，交换新旧的左右顺序，隐藏版本身份。每条问题必须附助手轮次和原文连续引文。主统计取两种顺序标出同一助手轮次的交集，同时保留并集作敏感性参考；这些仍是模型标注，不能称为独立人工确认。

| 行为 | 原版：受影响对话 | 新版：受影响对话 | 任一种顺序标出（原 → 新） |
|---|---:|---:|---:|
| 过度解读 | 3/8 | 1/8 | 4 → 1 |
| 非必要追问 | 0/8 | 0/8 | 0 → 0 |
| 重复收尾 | 4/8 | 2/8 | 4 → 3 |

重点 24 对：新版稳定胜 **4**、旧版稳定胜 **0**、稳定平 **18**、顺序不一致 **2**。加权偏好按胜 1、负 0、平及不一致各 0.5 计算；不一致保留，不追加择优裁判。两次调用来自同一模型，不是两名独立裁判。

控制场景：**无两种顺序共同判定的新增重大退化**。任一种顺序疑似新增重大问题的场景：无。零错误到零错误仅说明本轮未观察到退化，不能说已经证明该维度改善。已知 FollowBench `S11-L5` 的阻塞澄清是否移除：**是**。

预先注册门槛逐项：加权偏好至少 60%：`False`；过度解读及收尾在原有问题时减少、原为零时不增加：`{'overinterpretation': True, 'unnecessary_question': True, 'repeated_closing': True}`；非必要追问不增加：`True`；无新增重大控制退化：`True`。不因结果不理想而事后降低门槛。

### 改善与残留的具体证据

以下每类最多选一个改善例，同时列出所有两种顺序共同标注的新版残留，避免只展示正例。所有原文和相反/不一致判断均在逐例记录中。

- **P0-VM05，改善例：原版，过度解读**：第 1 条回复“像是忽然看见了另一条“如果当初继续下去”的时间线。” 裁判依据：无依据地假定用户没有继续练琴，并将感慨套入另一种人生选择的叙事。 完整对照见 [forward](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VM05.forward.json) / [reverse](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VM05.reverse.json)。
- **P0-VM06，仍有残留：新版，过度解读**：第 1 条回复“先别急着否定自己——退回的是这版作业，不是你的能力。” 裁判依据：将沮丧推演为自我或能力否定，并针对用户未表达的担忧进行安慰。 完整对照见 [forward](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VM06.forward.json) / [reverse](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VM06.reverse.json)。
- **P0-VC01，改善例：原版，重复收尾**：第 2 条回复“好，明天就只改片头节奏，配乐下周再说。范围清楚，推进起来会顺很多。” 裁判依据：用户已确认收尾，仍完整复述既定安排并再次解释收窄范围的好处，未提供新信息。 完整对照见 [forward](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VC01.forward.json) / [reverse](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VC01.reverse.json)。
- **P0-VC02，仍有残留：新版，重复收尾**：第 2 条回复“备份后确认文件能正常打开，再送过去。” 裁判依据：用户已确认安排，末轮仍重复首轮已有的备份验证和送修步骤。 完整对照见 [forward](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VC02.forward.json) / [reverse](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VC02.reverse.json)。
- **P0-VC06，仍有残留：新版，重复收尾**：第 2 条回复“先挑十张，不纠结排序和封面。” 裁判依据：用户已接受安排并准备行动，再次重述已确定的选片数量和暂不考虑排序、封面的安排，没有新增信息。 完整对照见 [forward](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VC06.forward.json) / [reverse](/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1/judgments-scripted/P0-VC06.reverse.json)。

控制用例中的轻微问题也保留：比如拒绝无依据的动机指控后，仍可能把“迟到造成影响”写成未经确认的事实；不能把“无新增重大退化”说成控制回答完全正确。纯提示词约束并没有保证每次生成都符合规则。

## 3. EQ：原 12 段对话的行为与倾向

原 EQ 运行 11/12 场得到评分、1 场调用失败。失败发生在候选第3轮、没有完整分数；保留原部分轨迹，只对该场景作一次同参数从头补跑。以下比较采用补跑后的12场完整轨迹；原错误与原11场均值仍保存在JSON，不替换已评分场景，不挑选更高分。场景：EQ4-hand_pin_018_family_patron_jokes_6f98eca8。该次场景重启是额外披露的传输恢复，未修改生产提示词或按验证成绩调参。

| 行为 | 原版受影响对话 | 新版受影响对话 | 两种顺序共同标出的回复数（原 → 新） | 任一种顺序标出的对话数（原 → 新） |
|---|---:|---:|---:|---:|
| 过度解读 | 3/12 | 3/12 | 4 → 4 | 4 → 4 |
| 非必要追问 | 1/12 | 0/12 | 1 → 0 | 3 → 3 |
| 重复收尾 | 2/12 | 1/12 | 2 → 1 | 4 → 1 |
| 过早宣布解决/信任 | 1/12 | 0/12 | 1 → 0 | 1 → 0 |
| 内容或边界问题 | 1/12 | 0/12 | 1 → 0 | 2 → 0 |

整段轨迹盲评：新版稳定胜 **4**、旧版稳定胜 **1**、稳定平 **5**、顺序不一致 **2**。这是本地 P0 口径的比较，不是官方能力排名，也不能与中文 24 对混在一起以绕过其 60% 门槛。

具体看，parent 中原先的“convincing yourself”与“unbearable”等带预设的解读消失，裁判更偏好新版；chatbot 不再追问“丢掉权威还是被管理层审视”，但仍过于确定地推测同事沉默的原因。care home 的改进主要是减少无新增内容的尾部复述，原始自然度分仍为6。

也有反例：freelancer 从8轮变成5轮，盲评却稳定偏好旧版。新版将团队如何理解玩笑说成事实，并在已有可行约定后追问开玩笑的动机；这说明轮次更短不等于更好。**EQ 的过度解读受影响场景数没有下降；非必要追问在更宽的单顺序口径下也没有下降。重复收尾的减少更一致。** 因此不能宣布三类问题都已在多轮 EQ 中解决。

原版有 87 条助手回复，新版有 87 条；对话回合数受上游 persona 结束规则影响，少说几轮本身不等于更好。EQ 两边的模拟用户续话可能不同，以上是整段轨迹的描述性比较，不能当作同一历史前缀上的因果实验。

完整12场的上游 pointwise 自然真实感均值 **6.583 → 6.500**；临床/辅导式语体 **4.417 → 4.000**；贴合用户框架 **8.583 → 8.417**。这些是倾向画像，不能合成官方能力分；分析、建议、反驳和边界倾向不是一律越低或越高越好。

| 场景 | 原始自然度（原 → 新） | 助手轮数（原 → 新） |
|---|---:|---:|
| adult_child | 6 → 6 | 8 → 8 |
| applicant | 7 → 6 | 8 → 8 |
| board_member | 6 → 6 | 8 → 8 |
| chatbot | 6 → 6 | 8 → 8 |
| crisis_line_volunteer | 7 → 6 | 8 → 8 |
| direct_report | 6 → 7 | 7 → 6 |
| employee | 7 → 6 | 8 → 8 |
| family_member | 7 → 7 | 4 → 5 |
| freelancer | 7 → 7 | 8 → 5 |
| friend | 7 → 7 | 8 → 8 |
| junior_colleague | 7 → 7 | 4 → 7 |
| parent | 6 → 7 | 8 → 8 |

官方 pointwise 评分与本地 P0 行为标注分开保留，不改写上游结果。英文角色扮演、公开角色上下文作为每轮用户前缀、固定回合预算以及裁判和模拟用户同模型，均限制外推。没有官方配对排名或真实用户验证。

## 4. FollowBench：全量回归与评分错误

| 版本 | HSR | SSR | CSL / 5 | 调用/评分错误 |
|---|---:|---:|---:|---:|
| 原基线 | 73.33% | 87.91% | 3.033 | 0 |
| 新版原始运行 | 78.67% | 91.27% | 3.367 | 0 |

最终运行无需补评分。 原始失败与补评结果分开列示；不把 API 错误归为风格缺陷，也不把有评分错误的原运行说成全部成功。

原基线失败 → 新版通过：18 题；原通过 → 新版失败：10 题；最终仍未评分：0 题。逐题 ID 均保存在 JSON。一次文学风格判分的波动不能全部归因于 P0 改动；旧题面的隐藏累计约束、年代冲突和文体主观阈值仍存在，不据此重算“真实通过率”。

通过项按原审计主因分布为 `{'mixed_or_uncertain': 4, 'refusal_or_alternative': 4, 'benchmark_primary': 4, 'visible_execution_gap': 6}`。这意味着 HSR 收益中也包含评分争议及拒绝/替代行为的波动，不能全部计作真实对话风格提升。

新增失分也不能一概推给 benchmark：例如 `S06-L5` 更偏列举文风特质和承诺，实际叙事较弱；`S17-L4` 仍把达西作为外部比较对象；`S23-L5` 对明确场景细节覆盖不足；`S01-L3` 出现缺乏线索支撑的海边解释。这些是值得保留的执行/证据问题，和文学文体阈值、时代冲突、模仿拒绝等失分一起逐例保留，不以总分上涨掩盖。

## 5. 第一版反例、停止与方法调整

第一版在原 30 个中文诊断脚本上未达到门槛：重点 24 对中，新版稳定胜 3、旧版稳定胜 3、平 13、展示顺序不一致 5；过度解读的共同标注从 1/8 增至 3/8，重复收尾从 3/8 降至 2/8，非必要追问为 0/8 → 0/8。其完整基准运行在完成前停止，保留全部部分结果，不拼入最终成绩。

这促使第二版增加“不要安慰未表达的担忧”“情绪词不是隐藏动机的证据”，并删除收口示例中再次复述计划的暗示。**第一版的诊断题已成为开发数据。** 第二版使用新冻结的 30 个中文场景；冻结之后未再依据验证成绩改提示词。此调整偏离第一版计划中不再调参的约定，已在 `p0-refinement-plan.json` 明确披露；不是把同一版本按得分重跑并择优。

另外，一次初始运行因发现复制了现存个人画像、与原基线的全新默认画像不一致而提前停止。该运行也单独保留，不纳入最终对比。所有中断、错误、顺序不一致及负向结果均未删除。没有从失败用例中挑选最好的回答拼接成绩。

## 6. 测试与可复现材料

- Personal 相关 12 个测试文件、156 项测试通过；项目类型检查通过；风格 adapter 类型检查和 7 项 Python 协议/聚合测试通过。
- [机器可读完整对比](personal-dialogue-style-p0-comparison-2026-10-21.json)：含逐例结果、各维度交集与并集、原始/补充评分及未通过门槛。
- [原始基线报告](personal-dialogue-style-baseline-2026-10-21.md)；[失败审计与原优化方案](personal-dialogue-style-failure-audit-2026-10-21.md)。
- 最终生产快照：`8f6bb49ae6562e5399a7484b01c373012bad3fe0`；源码哈希 `8b20f67397f770e342174dabba0601ea10a0be5fba6184a50c6534d25c4a1ce6`；运行结束源码变化：`False`。
- 最终原始运行：`/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-gpt56-gpt61-2026-10-21-v1`；原基线：`/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/baseline-gpt56-gpt61-2026-10-21-v1`。
- 中文新验证、冻结计划、源差异与全部盲评：`/Users/micjoyce/develop/github/xopc/.xopc-evals/personal-style/p0-refined-comparison-2026-10-21-v1`。
- 新中文固定脚本 SHA-256：`23c4e72521365533db6fe876dd97566daf73ed22cdcafa820296e4c093839103`。

费用回执不可用，费用记为 unknown/null，不依据模型目录零价格声称免费。本轮只有单次采集和单一裁判模型；达到诊断门槛也不等于三类问题从此不再出现。真实中文日常使用与独立人工校准仍需后续验证。
