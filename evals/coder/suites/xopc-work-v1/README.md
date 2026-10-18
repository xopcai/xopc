# xopc-work-v1 1.0.1

独立的 6 题工作能力扩展；原 xopc-core 10 题、xopc-agent-growth 6 题和 prompt-behavior 15 题不变。仅复用 EvalRunner、GitCloneSandbox、现有 command/unchanged 评分器和 XopcGatewayAdapter 多轮 hooks，没有新建评测框架。

| 题号 | 任务与交付 | 确定性验收 | 单次预算 |
|---|---|---|---|
| W03 | 多文件对账、可重跑流水线、差异行与来源 | 独立计算、去重、孤儿、UTC 范围、改变输入重新执行 | 300秒 /40请求 /300000 token |
| W05 | 跨 store/catalog/cache 的库存缺陷修复 | 冻结输入、重复预订、拒绝超卖、非法参数、无关缓存保留；新增测试抓住原缺陷 | 900秒 /60请求 /500000 token |
| W07 | 三轮队列需求变更，代码/测试/报告/产物一致 | 每轮输出快照，最终排序/过滤边界，不修改输入 | 900秒 /60请求 /500000 token |
| W08 | 已完成工作独立验收、及时停止 | 隐藏行为断言、已有文件零修改、只新增审计文档、只一次成功验证 | 300秒 /40请求 /300000 token |
| W09 | 恢复部分成功的数据导出 | 评测器持有服务与回执，已完成行零重发、503有界重试、无丢行、最终远端与本地交付一致 | 900秒 /60请求 /500000 token |
| W12 | 多轮决策更新、单轮语言覆盖、真实历史压缩后交接 | 最新决策、源文件保护、覆盖轮零编辑、恢复英文/字数/无标题、实际压缩证据 | 900秒 /60请求 /500000 token |

各题 correctness、requirements、verification、scope 分别为 required grader，W12 另有 continuity。任一维度失败均不能通过，超预算不能算通过。token 使用 Cloud authoritative total_tokens，包含辅助请求；缓存细分与实际费用不可得时记为 unknown，不能用目录的零价格当作免费。

隐藏代码仅在任务停止后注入并删除；W09 服务运行在评测器进程，由评测器输出可信 ledger。校准参考程序保存在 calibration/，不进入 agent fixture。校准用的是合成轨迹，不能算模型成绩。测试覆盖参考解通过、错误产物、缺失验证证据和额外文件失败，共 36 次合成任务（包含有用测试文件和等价报告表述的正例）；另验证传输上限与 Cloud token 口径。

报告长度/关键词只是 smoke 检查，不证明所有自然语言事实与论证质量。基线会保留原文并生成待复核材料。英文检测无法严格区分所有使用拉丁字母的语言。W08 v1 只有真正完成的实例；“假绿”由原 E02 提供，后续可在新版本加入匹配实例。W09 验证本地确定性服务和最终恢复，并不模拟操作系统杀进程后的每个原子写窗口，也不证明远程业务系统的完整幂等性。W12 是四轮压缩任务，不代表数日长会话。合成小项目与单一固定样本限制外推。

## 运行

在独立、固定 commit 的工作区中复用依赖，确保正常 OAuth 续期已获授权；不复制可轮换的 refresh token 作为独立凭据来源。只在隔离工作区应用 `scripts/work-baseline/shared-tool-exposure-fixture.patch`，以保留原 singleton skills 场景的工具暴露条件，生产默认不变。

从仓库根目录执行：

```sh
node --import tsx evals/coder/scripts/work-baseline/prepare.mjs ABSOLUTE_OUTPUT_DIRECTORY
node --import tsx evals/coder/scripts/work-baseline/run.mjs ABSOLUTE_OUTPUT_DIRECTORY --preflight-only
node --import tsx evals/coder/scripts/work-baseline/run.mjs ABSOLUTE_OUTPUT_DIRECTORY
```

默认阶段分别是 preflight/main；目录必须不存在，防止覆盖。基础设施重跑以 `PROMPT_AB_PREFLIGHT_TAG` 或 `PROMPT_AB_LIVE_TAG` 指定新的目录，原记录保留。真实执行冻结 37 题×3 次，单任务串行，全部实际模型请求（含标题）共享并发上限 2；固定 Cloud Sol、off，禁止回退。无模型探测的 F01 中间文件由探测器生成，只用于校验故障注入路径，不参与真实模型成绩。

## 1.0.1 评分器修复

原 31 题及新题的 task、followUps、fixture、预算均不变。W07 删除未在题干要求的 owner 关键词检查，仍检查逐轮实际选择范围与最终产物、排序、回归测试和报告。W03/W05/W07/W09 允许额外 `.test.mjs` 测试文件；纯验收 W08、纯文档 W12 仍禁止额外测试脚本。其余断言不变。语义与测试相关性仍须人工复核，不自动确认完整质量通过。

首版冻结记录完整保留；修复版使用 `--work-only` 对全部新 6 题重新跑三轮，先无模型配置探测，再真实执行。不能只重跑失败项。

配置探测会在完整用例之后追加 W03，验证 W12 身份更新不会遗留到下一题；默认探测共38次，`--work-only` 探测共7次。真实基线仍为37题×3次（或显式选择新6题×3次），不追加探测题。每个普通任务开始前重置并用数据库核验固定 profile，防止跨题初始条件污染。
