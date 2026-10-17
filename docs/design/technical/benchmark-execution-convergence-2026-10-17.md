# xopc benchmark v1：C01 / C02 执行收敛与交付优化

日期：2026-10-17（Asia/Shanghai）。最终 Qwen 实测 **10/10**，上一轮合并基线为 **8/10**。C01、C02 均在原预算内通过，全部场景无超预算、错误或超时。

## 不变的评测合同

- 套件：`xopc-core@1.0.2`，10 个原场景及原后续输入；同一 fixture commit `073bc27b5bd88e55c0f947236e3e126a66388e8c`。
- 模型：`qwen-token-plan-cn/qwen3.8-flash`，medium，每场景 1 次。对照和候选的实际 runtime identity 均已核对；旧超预算行的身份从保留的原始事件恢复核对，不推测缺失的汇总字段。
- 每场景：300,000 总 token（包括缓存）、40 次模型请求、300,000ms。评分器、命令识别规则、验证成功门槛和预算均未放宽。
- suite hash：`b7335af765b54cee3c956b7ec7362925dd96c5b5d63f2acf305f30490c109cb5`。评分器及 suite 文件哈希与对照一致。
- 使用相同运行时代码底本的隔离 worktree；相对上一轮仅修改 `run-verification.ts`、`run-turn.ts`、新增 `projectEvidence.ts`，以及 `exec-command.ts`、`publish-artifacts.ts`。依赖锁文件一致，最终 `sourceDrift=false`，排除了共享目录同期桌面宠物等功能改动。

## 根因与修改

1. **验证完成并没有形成明确的结束条件。** 原回执仅声明无需补查，模型仍继续读取邻近输入、添加表头校验、润色报告并再次检查。现在按实际验证状态提供实现、待验证、已验证三个阶段的临时系统提示；满足当前要求后应交付并结束，具体未满足要求或真实缺陷仍允许修复，任何文件修改仍使旧验证失效。
2. **旧完整审查会重复占用上下文。** 模型输入现在用后续完整审查的相同首尾行表示重复部分，保留早期差异行；相同文件、相同完整读取结果可引用后面的完整副本。投影限定在同一用户回合，不丢弃命令回执、失败、截断读取、混合媒体或跨用户回合的基线。原始轨迹不被改写，循环检测改用未经投影的原始 Agent 状态。
3. **自建测试只验证模型自己选择的结构。** 一轮 C02 在预算内给出了正确数值，却输出数组；R03 额外添加字段，均被原评分器拒绝。补充通用 JSON 合同指导：根据用户要求检查容器、精确字段、标量与精度，不擅自按输入分组生成集合，也不以自己生成的结构作为正确性依据。没有向运行时加入场景 ID、参考答案或具体字段期望。
4. **校验和发布的工具说明互相诱发额外调用。** `exec_command.outputs` 原描述只指本命令创建的文件，模型先发布部分结果，再用 `publish_artifacts` 收尾；实际上现有实现可以在成功校验后捕获此前写好的所有文件。现在明确推荐在最终独立检查上一次声明全部交付物，回执逐项列出发布状态，仅缺失、变化或捕获失败的文件才需另行发布。真实持久附件仍生成，失败的检查不会发布。

## 两个重点场景

| 场景 | 原判定 → 新判定 | 总 token：原 → 新 | 模型请求：原 → 新 | 工具调用：原 → 新 |
| --- | --- | --- | --- | --- |
| C01-add-deliverable | budget_exceeded → passed | 313,374 → 198,768 | 20 → 16 | 20 → 14 |
| C02-replace-scope | budget_exceeded → passed | 322,625 → 138,592 | 20 → 10 | 20 → 11 |

两项合计 token：635,999 → 337,360，减少 **47.0%**；模型请求 40 → 26；工具调用 40 → 25，减少 **37.5%**。此前 C01 在首轮就被中断，新轮实际完成了追加需求。

- 在读取/命令参数中显式提及额外 fixture 的文件数（每场景去重后相加）：8 → 0。生成的校验脚本也已检查，仅读取任务数据和交付结果；该计数本身不是任意间接 I/O 的语义证明。
- 每个用户回合首次 workspace review 后的 write_file/apply_patch 调用：5 → 0。此指标只统计调用顺序，不把它等同于所有验证成功后的真实修改，也不覆盖任意 shell 副作用。
- 最终两项都用独立检查的 outputs 捕获最终文件，publish_artifacts 调用均为 0；没有去掉实际持久化。仍应保留失败修复和真正必要的复验，不承诺所有任务下冗余调用永远为零。

## 全套结果

| 场景 | 最终判定 | 总 token | 模型请求 | 工具调用 |
| --- | --- | --- | --- | --- |
| R01-price-comparison | passed | 76,407 | 7 | 8 |
| R02-conflicting-source | passed | 87,746 | 7 | 7 |
| R03-missing-evidence | passed | 182,189 | 13 | 11 |
| D01-monthly-sales | passed | 124,186 | 10 | 9 |
| D02-quoted-csv | passed | 100,981 | 8 | 8 |
| D03-exact-money | passed | 111,275 | 9 | 8 |
| C01-add-deliverable | passed | 198,768 | 16 | 14 |
| C02-replace-scope | passed | 138,592 | 10 | 11 |
| F01-lost-artifact | passed | 151,037 | 12 | 13 |
| F02-transient-read | passed | 143,623 | 13 | 12 |

全套 token：1,751,921 → 1,314,804，减少 **25.0%**。模型请求 129 → 105；工具调用 127 → 101，减少 **20.5%**。

## 验证与完整试验历史

- 隔离最终快照的 135 项相关测试、类型检查及相关 lint 通过。真实 AgentSession 集成测试验证模型上下文精简、原始轨迹不变、重复循环提示仍生效；单元测试覆盖失败、截断、多媒体、跨回合基线及变更后验证失效。
- 附件测试验证：预先写好的文件可以随独立成功检查一起持久化，原文件内容不变；失败的检查不产生发布结果。
- `.xopc-evals/qwen-core-v1-execution-convergence/benchmark/`：首份完整诊断为 8/10，无预算超限，但 R03 多字段、C02 数组容器失败。
- `.xopc-evals/qwen-core-v1-execution-contract/benchmark/`：为修复循环检测受投影影响而主动中止，作为中断诊断保留，不计入最终比较。
- `.xopc-evals/qwen-core-v1-execution-contract-final/benchmark/`：完整 9/10；C02 独立产物检查已通过，但仍在发布收尾时超预算，保持失败。
- `.xopc-evals/qwen-core-v1-verification-delivery/benchmark/`：本报告的完整最终实验，10/10。没有选取各轮最优场景，没有重判旧失败。
- 旧基线：`evals/coder/baselines/xopc-core-v1-qwen-context-optimized.json`；新基线：`evals/coder/baselines/xopc-core-v1-qwen-convergence.json`。历史见 `xopc-core-v1-history.json`；对比明细见 `.xopc-evals/qwen-core-v1-convergence-comparison.json`。

这是不同代码修订各一次的开发对照，不能合并成重复可靠性样本；云端缓存与生成具有波动，耗时不用于宣称稳定加速。没有进行消融对照，不能把收益单独归因于某条提示或文本投影。工具计数指模型可见调用，不能代表底层文件系统请求数。较大的工具结束事件存在载荷截断，重复调用细分保留覆盖缺口，不把缺失当零。当前仍只覆盖直接 Agent 工作区执行，不代表 Personal 异步交付链路或生产可靠性。
