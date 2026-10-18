# xopc Cloud GPT-5.6 Sol 效率与偏好基线（M）

完整运行31个冻结场景×3轮，共93次。原评分器通过 85/93；状态分布：`{"passed": 85, "failed": 8}`。分维度及去标签辅助复核后的状态：`{"passed": 73, "failed": 8, "manual_review": 12}`。预算、场景与评分标准均未放宽。

## 工程改动与验证

1. 个人助手上下文保留完整配置审计，但给模型的配置事件只携带变化字段；姓名、角色变化不再重新注入未变化的语言和风格。配置不变时不重复添加配置事件，显式更改和撤销仍正常传递。
   S01历史失败时明确的英语偏好仍在模型输入中；身份更新事件却又携带未变化的primaryLanguage=zh和style=Formal。因此本轮修正信息投影及作用域，而不是假定偏好历史被清除。实际模型输入与各轮答案见targeted-efficiency-analysis.json。
2. 缩短执行阶段提示，优先读取用户指定输入和必要依赖，减少检查完成后的继续读取、验证和修饰。提示精简没有更改验证识别器、验证策略或评分要求。
   在同一离线状态样本中，初始/待验证/已验证提示分别从1066/1253/858字符变为462/319/937字符；完成阶段因补充安全复用说明而稍长。这是字符校准，不是实测token节省，也不能单独证明行为收益。
3. exec_command 增加显式 reuseVerification，仅在同一命令、目录及工作区版本具有有效成功证据时直接发布所需附件；返回明确标识未执行命令。工作区变化、缺失证据、失败检查均拒绝复用。正常执行默认行为保留。
4. 对指定 Cloud GPT-5.6 Sol 模型补齐实际 thinking=off 请求格式，使用 `thinking:{type:"disabled"}`；模型及供应商没有替换。

123项相关测试、38项现有评测框架测试通过，最终 Cloud wire 测试及 TypeScript 检查通过；完整源码由固定提交归档加补丁重建并逐一验证哈希。单例 skills 直接暴露只用于已获授权的隔离实验，不应用于生产默认配置。
Cloud专用静态prompt快照各14份，于本轮运行中从已冻结的真实源码补充生成，不能声称这份Cloud专用矩阵在首请求前已归档：静态system/persona模板与个人助手指令未变，差异在动态执行阶段提示、配置事件投影、工具说明/参数及验证复用。详见prompt-snapshot-audit.json；真实请求的prompt与完整输入另行逐次保存。原生成器带旧模型名称的静态矩阵仅为辅助快照，未进行那些模型的真实调用或回退。

## 实验与计量

模型固定为 `xopc-cloud/openai-codex/gpt-5.6-sol`，无回退。冻结种子、输入、初始文件、工具集合及原评分器。核心和增长场景沿用300秒/40请求/300000累计token；行为场景沿用180秒/12请求/30000累计token。
实际请求并发峰值 2，同一时间只运行1个任务；所有实际请求均核对模型标识和显式 thinking disabled。流式响应没有提供推理token明细，因此不能把SDK默认0当成实测0，也不能证明内部推理行为。

主实验记录模型请求 647 次、工具调用 592 次、总token 4,560,739；任务耗时合计 2030.2 秒，实验墙钟 2064.6 秒。通过项全部满足原预算。

预算使用Cloud响应的权威 `usage.total_tokens`。缓存拆分不可得：规范化input已包含未拆分缓存/其他输入，cacheRead/cacheWrite的协议0是占位值，不能当成实测缓存为0。价格目录的0同样是占位值，实际费用未获取，不能宣称免费；实际请求账单查询返回404，详见billing-receipts.json。

两次基础设施尝试均完整保留：main因总token漏计而中止，留下2通过/91连带错误；main-corrected因隔离副本OAuth刷新失效，留下42通过/1行为失败/50鉴权错误。之后获用户明确授权，采用正常OAuth续期，仅更新登录凭据，不改个人配置或会话；相同候选代码与31场景在main-auth-renewal完整重跑三轮，没有只重跑失败项。各次实际请求和token另列infrastructure-attempts.json，均产生真实模型请求与token消耗、费用未知，不能从归档中删去。
连同基础设施尝试与真实兼容性探测，总计1018次实际模型请求、7,270,593已知总token；其中一次HTTP400未提供usage，不能把其用量或费用算成实测0。合成配置探测不计入真实调用。所有真实阶段互不重叠，整体并发峰值2。详见experiment-accounting.json。

## 语言偏好与执行开销

| 场景 | 轮次 | 冻结评分 | 语言 | 风格 | 恢复 | 请求 | 工具 | 总token |
|---|---:|---|---|---|---|---:|---:|---:|
| S01-standing-en | 1 | passed | passed | manual_review | not_applicable_or_not_scored | 4 | 1 | 21517 |
| S02-standing-zh | 1 | passed | passed | passed | not_applicable_or_not_scored | 3 | 1 | 16592 |
| S03-turn-restore | 1 | passed | passed | manual_review | passed | 4 | 0 | 15343 |
| S04-change-revoke | 1 | passed | passed | manual_review | not_applicable_or_not_scored | 6 | 0 | 26893 |
| S05-compacted-restore | 1 | passed | passed | manual_review | passed | 6 | 0 | 16527 |
| S06-identity-fields | 1 | passed | passed | passed | not_applicable_or_not_scored | 4 | 0 | 10963 |
| S01-standing-en | 2 | passed | passed | manual_review | not_applicable_or_not_scored | 4 | 1 | 21520 |
| S02-standing-zh | 2 | passed | passed | passed | not_applicable_or_not_scored | 3 | 1 | 16640 |
| S03-turn-restore | 2 | passed | passed | manual_review | passed | 4 | 0 | 15288 |
| S04-change-revoke | 2 | passed | passed | manual_review | not_applicable_or_not_scored | 6 | 0 | 26799 |
| S05-compacted-restore | 2 | passed | passed | manual_review | passed | 7 | 0 | 16666 |
| S06-identity-fields | 2 | passed | passed | passed | not_applicable_or_not_scored | 4 | 0 | 10991 |
| S01-standing-en | 3 | passed | passed | manual_review | not_applicable_or_not_scored | 4 | 1 | 21501 |
| S02-standing-zh | 3 | passed | passed | passed | not_applicable_or_not_scored | 3 | 1 | 16619 |
| S03-turn-restore | 3 | passed | passed | manual_review | passed | 4 | 0 | 15365 |
| S04-change-revoke | 3 | passed | passed | manual_review | not_applicable_or_not_scored | 6 | 0 | 26815 |
| S05-compacted-restore | 3 | passed | passed | manual_review | passed | 6 | 0 | 16614 |
| S06-identity-fields | 3 | passed | passed | passed | not_applicable_or_not_scored | 4 | 0 | 10976 |

未被识别的成功测试式脚本 15 次；同轮同命令检查重复（含跨版本）10 次。跨版本重复可能是补充交付文件后原策略要求的重新验证，不能全部算浪费。

同版本重复成功操作候选 14 次，其中重复通过的检查 2 次；显式复用验证发布 0 次。此统计排除了 executionPerformed=false 的复用，工具调用总数仍完整计入。 本轮真实轨迹没有触发显式验证复用，该机制的跳过执行行为仅由单元测试直接验证，不能声称它已贡献本轮实测节省。 另需查看verification-order-analysis.json：它单列成功但未被原验证策略识别的测试式脚本，以及同轮跨版本重复检查，防止只看同版本重复次数而低估开销。

可用附件回执 4，源码/测试附件 0，同来源同工作区版本重复回执 0。完成验证后仍调用工具的模型响应 6 次；不能把全部后续工具自动认定为浪费，追加要求和实际缺项仍需完成。

仍有残留：F01第1轮成功执行未被识别的Python脚本后，又为outputs重跑并重复原命令；新显式复用参数未使用，原验证策略仍要求有效测试。全部4个发布回执来自F01#1和F02#2，用户没有明确请求下载，属于额外发布候选。重复读取集中在需求追加或恢复后的sales.csv。详见residual-efficiency-findings.json；没有将这些诊断改为新的评分器。

模型尝试未注册工具 0 次。记录代理拒绝 30 次，目的分布 `{"session-title": 30}`；这些未转发请求与模型非法工具尝试分别统计。

详细读取路径、命令、重复验证、发布回执和收尾请求见request-context-analysis.json、semantic-tool-overhead.json、publication-analysis.json、closing-analysis.json及逐轮完整轨迹。

## 全部失败与历史差异

| 场景 | 轮次 | 状态 | 错误或评分证据 |
|---|---:|---|---|
| R03-missing-evidence | 1 | failed / failed | Result must match independently frozen facts |
| I02-current-release | 1 | failed / failed | {"language": "not_applicable_or_not_scored", "style": "not_applicable_or_not_scored", "restoration": "not_applicable_or_not_scored", "falseSuccess": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "artifactCorrectness": "failed", "requirementsCompleteness": "passed"} |
| S01-standing-en | 1 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S03-turn-restore | 1 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "passed", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S04-change-revoke | 1 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S05-compacted-restore | 1 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "passed", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| R03-missing-evidence | 2 | failed / failed | Result must match independently frozen facts |
| S01-standing-en | 2 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S03-turn-restore | 2 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "passed", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S04-change-revoke | 2 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S05-compacted-restore | 2 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "passed", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| Q01-prose-only | 2 | failed / failed | {"language": "not_applicable_or_not_scored", "style": "not_applicable_or_not_scored", "restoration": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "failed", "requirementsCompleteness": "passed"} |
| R02-conflicting-source | 3 | failed / failed | Result must match independently frozen facts |
| R03-missing-evidence | 3 | failed / failed | Result must match independently frozen facts |
| I01-active-dependency | 3 | failed / failed | {"language": "not_applicable_or_not_scored", "style": "not_applicable_or_not_scored", "restoration": "not_applicable_or_not_scored", "falseSuccess": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "artifactCorrectness": "failed", "requirementsCompleteness": "passed"} |
| E01-verified-stop | 3 | failed / failed | {"language": "not_applicable_or_not_scored", "style": "not_applicable_or_not_scored", "restoration": "not_applicable_or_not_scored", "falseSuccess": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "artifactCorrectness": "failed", "requirementsCompleteness": "passed"} |
| S01-standing-en | 3 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S03-turn-restore | 3 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "passed", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S04-change-revoke | 3 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "not_applicable_or_not_scored", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |
| S05-compacted-restore | 3 | passed / manual_review | {"language": "passed", "style": "manual_review", "restoration": "passed", "illegalToolCalls": "passed", "falseSuccess": "not_applicable_or_not_scored", "artifactCorrectness": "not_applicable_or_not_scored", "requirementsCompleteness": "passed"} |

main-corrected 中 R03-missing-evidence 第2轮：真实响应只调用read_file一次，读取sources.json成功；随后模型直接声称写文件工具失败，没有write_file/apply_patch请求或失败证据。result.json和report.md未创建，原评分器ENOENT失败。属提前放弃及无证据的失败归因，不能标成基础设施失败或选择性重跑。
main-auth-renewal 中 R03-missing-evidence 第1轮：main-auth-renewal第1轮算术与空值正确，但missing写为[ttsCents]，冻结精确契约要求[tts]。自建测试通过不代表隐藏契约通过；保留失败，不改评分。
main-auth-renewal 中 I02-current-release 第1轮：真实请求工具集合包含write_file、apply_patch、exec_command，且没有写入失败轨迹；模型正确定位deployment.json与2026-10活动发布契约，却将“保护已有文件”与“没有写入工具”混淆，声称无法创建result.json/report.md后提前结束。保留未交付失败，属于能力边界误判而非基础设施错误。
main-auth-renewal 中 Q01-prose-only 第2轮：Q01第二轮只编辑并回读report.md，没有额外脚本或文件；新增句子接在原段落末，冻结快照要求空行后单独成段。保留原段落边界评分失败，不放宽断言。
main-auth-renewal 中 R02-conflicting-source 第3轮：R02第三轮将vendor B的primary-b（0.03元/分钟→180分/小时）误用为vendor A证据，主张按便于单位转换选择primary-b，并把a/b不同供应商记录视为同主体冲突。任务要求vendor A，正确来源primary-a为120分/小时。自建测试验证了自身错误假设，隐藏独立断言检出错误；属于证据主体混淆和事实错误，不是仅格式问题。
main-auth-renewal 中 I01-active-dependency 第3轮：I01第三轮只成功读取workspace.json和活动服务service.json两次，未创建result.json/report.md，随后直接表示未能在本轮完成。实际仅4次模型请求、21048总token、13.8秒，均远低于原预算，没有真实写入工具失败证据。属于提前放弃和交付缺失。
main-auth-renewal 中 E01-verified-stop 第3轮：E01第三轮正确核对数据并通过现有npm test，但把验证既有deliverables/report.md当作完成交付，未创建要求的根report.md即结束。没有额外断言脚本，仍属遗漏用户明确要求；检查通过不代表任务完成，少调用不能抵消未交付。

以下仅为不同模型的历史对照，不能据此推断代码优化的因果收益。

| 模型与版本 | 冻结通过 | 模型请求 | 工具调用 | 累计总token | 任务耗时合计（秒） |
|---|---:|---:|---:|---:|---:|
| 历史DeepSeek L | 86/93 | 843 | 793 | 7905250 | 1320.0 |
| 本轮Cloud Sol M | 85/93 | 647 | 592 | 4560739 | 2030.2 |

失败或提前放弃会减少总体调用，不能据总量下降认定效率提高。另按双方都通过的相同场景/轮次对照：

| 子集 | 配对数 | 请求 历史/本轮 | 工具 历史/本轮 | 总token 历史/本轮 |
|---|---:|---|---|---|
| matchedFrozenPass | 82 | 727/581 | 683/529 | 6871550/4138949 |
| matchedConfirmedPass | 71 | 671/524 | 681/527 | 6646145/3919621 |

与历史DeepSeek L按场景和轮次配对，共93对；4对存在冻结评分、断言或非法工具次数方面的负向差异，3对冻结任务状态变好。所有负向差异逐项列于new-regressions-analysis.json；全部失败的根因及原始评分证据见all-failure-analysis.json，全部配对见paired-results.md；全部请求、工具或token增长的配对另列resource-increases.json。

另有4对从已确认通过变为语气待复核：S03-turn-restore#1、S03-turn-restore#2、S03-turn-restore#3、S05-compacted-restore#3。这些项不自动算通过，也不能在缺少明确证据时算作确定的语气失败。

历史参考是另一个模型，且缓存、供应商及运行时间不同。这些差异不能归因于本轮代码优化，也不能把“本轮未发现”表述为证明完全无退化。此次结果建立新的Cloud模型基线，没有同模型修改前对照。

## 分维度评分

| 维度 | 状态分布 |
|---|---|
| language | {"not_applicable_or_not_scored": 75, "passed": 18} |
| style | {"not_applicable_or_not_scored": 75, "manual_review": 12, "passed": 6} |
| restoration | {"not_applicable_or_not_scored": 87, "passed": 6} |
| falseSuccess | {"not_applicable_or_not_scored": 72, "passed": 21} |
| illegalToolCalls | {"passed": 93} |
| artifactCorrectness | {"passed": 67, "failed": 8, "not_applicable_or_not_scored": 18} |
| requirementsCompleteness | {"passed": 93} |

上表保留原评分/导出的维度映射。核心与增长场景的correctness是复合断言，requirementsCompleteness映射了非correctness类别，不能把其中的93次passed理解为93次所有需求均完成。I01、I02、E01的缺少交付证据已单列在results.json的supplementaryMissingDeliverableEvidence中，仍保留原失败评分。行为场景才有原始独立要求完整性与虚假成功断言；其余能力误判另列定性证据，未新增事后评分器。

自然语言盲评共36项，仍待人工复核19项；模糊结果保留原文，不自动算通过。若由本轮代理辅助复核，属于去标签的辅助判断，并非独立人工评审。

## 结果归档与局限

manifest、两版真实源码与生成prompt、源码/用例/评分器哈希、环境预算、逐轮输入输出、实际响应标识、工具调用及结果、最终产物、评分、原始错误与重跑记录均保留在独立目录。results.json可机器读取，trajectory.jsonl保留逐轮事件；artifact-index.json及SHA-256覆盖完整归档。凭据检查不输出密钥，个人配置和现有会话未修改；OAuth登录凭据的正常续期由用户明确授权。

三次重复仍是小样本。未拆分缓存/推理用量、未知费用、记录代理缓冲与生产流式行为差异，以及历史跨模型比较均限制结论。原评分器的用词/段落边界限制完整保留，没有根据本轮结果修改断言。

完整归档：`/Users/micjoyce/develop/github/xopc/.xopc-evals/cloud-sol-efficiency-2026-10-18`

归档索引 SHA-256：`42e13458136669f8308d2e5e261fb3fe3b7452d8ea5af000826f7e2a5da5678d`。
