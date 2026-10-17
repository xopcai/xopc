# xopc Agent benchmark：六个扩展场景与 Qwen 初始基线

日期：2026-10-17。新增独立开发套件 `xopc-agent-growth@0.1.0`，覆盖信息定位、执行收敛和多模块项目修改；原 `xopc-core@1.0.2` 保持冻结。没有修改生产 Agent 实现或针对这些任务调优提示。

当前默认模型已只读确认：`qwen-token-plan-cn/qwen3.8-flash`，默认 Agent 无模型覆盖。隔离 Gateway 使用 medium，每场景 3 次，共 18 次；最终 16/18 通过。所有试次保留，不选取各场景最优结果。

## 评测合同

- 每场景沿用 v1：300,000ms、40 次模型请求、300,000 个 provider-reported 总 token（含缓存）；未放宽预算。
- 复用现有 EvalRunner、GitCloneSandbox、Gateway/realtime 适配器、隐藏命令评分器、受保护路径检查、SQLite 轨迹及内容寻址证据。新增可选的评分时轨迹快照，用于检查实际成功验证回执；原用例不启用，原判分逻辑不变。
- 六个独立、可复现的 fixture commit；原 Git 历史在 Agent 执行前移除，模型工作区没有其他场景、参考解或隐藏评分器。项目案例是无外部依赖的多模块小应用，不宣称等同大型生产仓库。
- E01 要求既有交付正确且原文件不变，只能新增 report.md；E02/P01/P02 还要求新增回归测试能拒绝原始缺陷版本。报告长度沿用 v1 的完整性代理，不作为自然语言质量评分。
- 工具重复、显式读取路径及成功检查后的显式读写为诊断指标，不额外规定唯一工具顺序或武断的调用数量。大载荷从保留 artifact 恢复；不完整覆盖保留 null，不当成零。
- v1 兼容校准：参考解 10/10，故意错误解 0/10，suite hash 仍为 `b7335af765b54cee3c956b7ec7362925dd96c5b5d63f2acf305f30490c109cb5`。这不是一次新的 v1 模型基线。
- 新套件 suite hash：`df2333ee2f1ace2f135bf5d8ce8eef56bb0d72d836bd1842422df8994df88472`；source commit：`e565fa5675f315eae246d56f1643ae1e5072f841`，新增评测文件由 manifest sourceHashes 标识；正式实验 sourceDrift=false。
- 基线对应启动时冻结的 `e565fa567` 运行时快照。评测期间主工作区出现后续提交及其他 Agent/项目上下文开发，这些变化没有混入实验；16/18 不能解释为后续 HEAD 或当前未提交运行时改动的重测成绩。

## 三次运行的完整结果

| 场景 | 通过次数 | 各次状态 | 各次总 token | 各次模型请求 | 各次工具调用 |
| --- | --- | --- | --- | --- | --- |
| I01-active-dependency | 3/3 | passed, passed, passed | 147765, 242810, 171282 | 13, 18, 13 | 13, 17, 13 |
| I02-current-release | 3/3 | passed, passed, passed | 196337, 136806, 144678 | 14, 12, 13 | 12, 18, 13 |
| E01-verified-stop | 2/3 | failed, passed, passed | 219865, 149265, 219630 | 16, 12, 16 | 15, 12, 15 |
| E02-green-incomplete | 3/3 | passed, passed, passed | 178927, 120733, 198032 | 14, 10, 14 | 17, 15, 18 |
| P01-inventory-cache | 2/3 | budget_exceeded, passed, passed | 319265, 172483, 198160 | 22, 15, 14 | 22, 17, 13 |
| P02-ticket-labels | 3/3 | passed, passed, passed | 129207, 134900, 201531 | 11, 11, 15 | 15, 16, 21 |

状态汇总：`{"passed":16,"failed":1,"error":0,"timed_out":0,"budget_exceeded":1}`。观察到的总 token：3281676，包含失败试次已完成响应；被中断但未返回的请求可能不在 provider usage 中。费用是目录估值，不能当作实际账单。

## 未通过试次的证据

- E01-verified-stop / candidate：failed；AssertionError [ERR_ASSERTION]: Only the requested report may be added to the completed task。
- P01-inventory-cache / candidate：budget_exceeded；产物检查通过，但执行状态未通过，保留预算或执行失败判定。

## 能力缺口与下一步

- **E01：无改动任务仍会过度验证。** 首次运行保持了既有文件，却遗留未被要求的 `verify.test.cjs`。轨迹显示先用复合命令执行已有测试，随后为取得独立验证回执反复创建、删除临时测试，最终违反只新增报告的要求。后两次通过，但仍消耗 149,265 和 219,630 token；不能把一次通过当作已经解决收敛问题。
- **P01：正确修复后的验证开销不稳定。** 首次产物通过全部隐藏行为与保护路径检查，却在 22 次请求、319,265 个已完成响应 token 后因预算中止。轨迹包含多次归档原始实现、复制回归测试及过滤日志的调用；后两次分别以 172,483、198,160 token 通过。下一轮应优先检查验证命令组合、重复自证和最终交付的上下文开销，保留原评分与预算。
- 信息定位、发现绿色测试遗漏的需求、标签筛选兼容性各自为 3/3。它们建立了初始能力参照，后续修复 E01/P01 时应作为同套回归，避免为了更早停止而漏掉真实缺陷。

后续建议先优化通用的已有测试复用和验证收尾策略，再重跑全部六场景三次；不在运行时加入场景 ID、具体输出答案或针对测试文件名的分支。本轮只建立评测与基线，未实施上述 Agent 优化。

## 校准和试验记录

- 框架类型检查及 34 项测试通过，包含原 v1、适配器及隔离测试。六场景校准覆盖正确解、无产物完成声明、典型错误实现、受保护文件改写、无验证回执，以及 E01 额外无关文件。
- 预运行 `.xopc-evals/qwen-agent-growth-v0.1.0/` 在 I01 执行期间主动中止：复核发现 E01 对额外新文件的限制尚未进入评分器。在 E01 执行前补齐检查，保留此中断证据，未将其作为正式评分或可靠性样本。原数据库的 running 状态保留，不伪造终止判分。
- 正式运行 `.xopc-evals/qwen-agent-growth-v0.1.0-final/benchmark/` 使用补齐并冻结后的同套场景完成全部 18 次。初始校准、冻结校准和中断预运行分别保留；更细的错误实现控制由可重复的自动化测试覆盖，测试输出见 `/tmp/xopc-growth-final-check.log`。
- 主工作区未运行个人会话；临时 Gateway、会话和状态使用现有清理逻辑。冻结 worktree 将评测与同期其他开发隔离。

## 解释边界与证据

云端缓存与生成存在波动，三轮按序执行，不把缓存命中差异当作代码优化收益。这是六个开发场景各三次的初始基线，不能证明生产可靠性，也不是保留集或跨模型排名。与 v1 不合并总分，不用低成本抵消正确性失败。完整轨迹中的显式路径不是底层所有文件 I/O 的审计，重复调用也不必然代表无用；判断根因需要结合具体结果。此次尚不覆盖异步 Personal 链路、运行中需求变更、Gateway 崩溃恢复或认证附件下载。

- 套件与任务合同：`evals/coder/suites/xopc-agent-growth/README.md`。
- 版本化校准：`evals/coder/baselines/xopc-agent-growth-v0.1.0-calibration.json`。
- 完整 Qwen 基线：`evals/coder/baselines/xopc-agent-growth-v0.1.0-qwen.json`；试验历史：`xopc-agent-growth-v0.1.0-history.json`。
- 原始 manifest、fixture.bundle、evals.db、轨迹、diff 和评分日志：正式实验目录。
