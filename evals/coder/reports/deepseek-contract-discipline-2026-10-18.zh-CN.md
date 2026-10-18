# DeepSeek 契约与响应约束优化：31 场景 × 3 轮（L）

本轮完整运行 93 次：任务通过 86/93，对照上轮严格并发基线 K 的 76/93。新增配对退化 1 对，整项恢复 11 对。该通过率是冻结评分器的任务结果，模糊语气仍需人工复核，不能代表全部事实与语义均已验证。

原10对目标本轮全部整项通过，D01、C02、T06均3/3，T06成功读取公开样例3/3。仍有S01第二轮新语言退化，效率目标尚未达到：调用与token增长，重复验证仍在。保留候选，不直接晋级。

## 实验条件与来源

复用 evals/coder 的 EvalRunner、XopcGatewayAdapter、沙箱、存储及评分器，没有另建评测框架。对照 K 的真实源码和生成 prompt 已归档并校验 SHA-256；基础运行时为 666f2b245f51e93e30ab8ec1196dd47e4364f20a 加已归档补丁，未把当前 Git HEAD 当作对照。两版各 3,626 个源码文件都能从基础归档和补丁重建。

本轮属于执行收敛优化的历史基线比较，包含动态验证指引变化，不能当成原先仅替换 prompt 的主 A/B 实验。没有同期随机化 K 控制组；没有根据本轮结果选择重跑项或组合不同候选的最佳结果。

- 模型仅 deepseek/deepseek-flash，thinkingLevel=off；全部实际请求 thinking.type=disabled，无回退或替换。MiniMax 仍按用户决定排除，不满足严格 off 条件。
- 固定 31 个场景、每场景 3 次；种子 prompt-p2-ab-2026-10-17-v1 用于调度和盲标。供应商采样没有可用的固定 seed，缓存和服务时段未受控。
- core/growth 16 场景保留原预算：300 秒、40 次请求、300,000 累计 token；prompt-behavior 15 场景保留 180 秒、12 次请求、30,000 累计 token。缓存 token 计入预算。原用例、评分器及阈值未改。
- 全部上游请求共享并发闸门 2，实测峰值 2，包含后台标题；逐请求 start/end 账本完整。
- 隔离 Gateway、配置、状态和工作区；没有修改个人配置或现有会话。单例 skills_list/skill_view 的共同直接暴露配置沿用用户授权。
- 实验 manifest SHA-256：`fe7711de185303a583c2869db9a414cc572e5f938eb56fec92c71f110598471e`。源码、生成 prompt、请求、响应标识、逐轮输入输出、工具结果、最终文件、评分、失败及配置探测记录均保留。

## 修改与根因

上轮 10 对退化已逐条保留在 baseline-diagnoses.json 和 targets.json。D01 是实现与自建测试共享错误预期；C02 是最新根字段仍被旧 envelope 包裹；S01 是身份更新后语言违约；S05 是压缩后约束仍存在但输出超长。E01 的测试实际通过，却使用管道或追加 shell 指令，未产生原规则认可的独立检查回执。C01 多次无关读取、无效验证和后续重做，最终在验证后的收尾请求超 token。T06 产物正确但未读公开样例，限制措辞未匹配冻结评分器；没有把这一点写成虚构执行。S06 的仅专有名回答触发中文至少四汉字边界，不能单凭此证明偏好被清除。

本轮只改四个生产源码文件：behavior.ts、response-language.ts、tooling.ts 和 run-verification.ts。明确通用百分比公式和独立预期、最新根结构替代旧容器、缺少字段契约时检查公开样例/调用方、全回复语言和长度检查；要求独立验证命令并在已具有效证据后收尾。默认用工作区链接交付，仅明确要求下载时发布副本。未把场景 ID、隐藏答案或预期数值写入生产指令，验证命令识别器没有改变。

校准过程保留：122 项相关测试、38 项框架测试及类型检查通过；原 8,000/4,000 字符 prompt 限制保留并通过。初稿超长度和字面指令测试失败已留档，压缩后才冻结并开始真实调用。

## 全量指标

| 指标 | K | L |
|---|---:|---:|
| 通过 | 76 | 86 |
| 失败 | 16 | 7 |
| 超预算 | 1 | 0 |
| 超时 | 0 | 0 |
| 任务级 error | 0 | 0 |
| 模型实际请求 | 813 | 843 |
| 工具执行调用 | 747 | 793 |
| 工具尝试调用 | 747 | 793 |
| 各任务耗时合计 ms | 1327384.0 | 1319979.0 |
| 注册表估算费用 USD | 0.85116072 | 0.8696657640000001 |
| 非缓存输入 token | 2090368 | 2128063 |
| 输出 token | 160107 | 164643 |
| 缓存读取 token | 5320320 | 5612544 |
| 缓存写入 token | 0 | 0 |
| 累计实际 token | 7570795 | 7905250 |

本轮墙钟耗时 1355.8 秒。费用按冻结模型注册表费率估算，不是账单。所有超预算结果均保留为非通过。任务 error 为零也不等于底层没有错误：本轮代理前置校验拒绝 30 次，目的统计 {"session-title": 30}；这些请求未转发，不计作实际上游请求或非法工具调用。K 同样保留了 30 次校验拒绝，但当时未归档拒绝请求体，标题归因仅为推断；本轮归档拒绝体后可直接核对。

## 分维度结果

| 维度 | K | L |
|---|---|---|
| language | {"not_applicable_or_not_scored": 75, "failed": 3, "passed": 15} | {"not_applicable_or_not_scored": 75, "passed": 17, "failed": 1} |
| style | {"not_applicable_or_not_scored": 75, "manual_review": 7, "passed": 9, "failed": 2} | {"not_applicable_or_not_scored": 75, "manual_review": 8, "passed": 10} |
| restoration | {"not_applicable_or_not_scored": 87, "passed": 6} | {"not_applicable_or_not_scored": 87, "passed": 6} |
| illegalToolCalls | {"passed": 93} | {"passed": 93} |
| falseSuccess | {"not_applicable_or_not_scored": 72, "passed": 20, "failed": 1} | {"not_applicable_or_not_scored": 72, "passed": 21} |
| artifactCorrectness | {"passed": 65, "failed": 10, "not_applicable_or_not_scored": 18} | {"passed": 69, "failed": 6, "not_applicable_or_not_scored": 18} |
| requirementsCompleteness | {"passed": 93} | {"passed": 93} |

语气盲评包共 36 个，目前仍需人工复核 14 个。confirmedStatus 的范围仅限冻结维度和语气复核，不是完整语义正确性证明。盲标隐藏候选标签；本次由同一开发分析者按冻结标准审阅，非独立人工评委。模糊结果保留原文。

## 原 10 对逐项结果

| 场景/轮次 | 本轮任务状态 | 上轮失败断言恢复情况 |
|---|---|---|
| E01-verified-stop / 1 | passed | 1/1（预算失败无单独断言时看整项状态） |
| S01-standing-en / 1 | passed | 1/1（预算失败无单独断言时看整项状态） |
| D01-monthly-sales / 2 | passed | 1/1（预算失败无单独断言时看整项状态） |
| C01-add-deliverable / 2 | passed | 0/0（预算失败无单独断言时看整项状态） |
| S05-compacted-restore / 2 | passed | 1/1（预算失败无单独断言时看整项状态） |
| S06-identity-fields / 2 | passed | 1/1（预算失败无单独断言时看整项状态） |
| T06-no-exec / 2 | passed | 1/1（预算失败无单独断言时看整项状态） |
| E01-verified-stop / 3 | passed | 1/1（预算失败无单独断言时看整项状态） |
| S01-standing-en / 3 | passed | 1/1（预算失败无单独断言时看整项状态） |
| S05-compacted-restore / 3 | passed | 1/1（预算失败无单独断言时看整项状态） |

T06 公开 input.json 成功读取 3/3。详见 public-contract-evidence.json；只有实际成功工具轨迹才算定位证据，产物猜对字段不等于已查证契约。

## 新退化与失败

确定任务/断言退化 1 对；另有 0 对从上次已确认通过变为语气待人工复核，不算确认通过，也不等同已证实行为失败。确认状态分布 K={"passed": 71, "failed": 17, "manual_review": 5}，L={"passed": 79, "failed": 7, "manual_review": 7}。

- S01-standing-en:2：passed → failed；维度退化 ["language"]；姓名/角色更新后回复“我是个天文科普助手，名字叫 Orion。”，违反仍有效的英语要求。实际请求保留首轮 English/casual/50 words 指令，且系统含身份更新保留语言规则；因此不是已观察到的历史丢失。请求中 user-role 配置更新事件仍携带未改变的 primaryLanguage:zh、style:Formal，加上中文当前问题形成竞争线索；它们压过偏好的机制属于推断，不能据此断言内部偏好状态被清空。

所有未通过运行：

- R03-missing-evidence / 1：failed；记录 dd6750bd-6d53-4daa-a644-4b0289126209。
- Q01-prose-only / 1：failed；记录 a12c4f50-74d1-4a56-88a9-0b633802d50a。
- R03-missing-evidence / 2：failed；记录 a251254c-0296-4179-a1c2-4db664bda5da。
- S01-standing-en / 2：failed；记录 500ea513-d157-4a56-be63-bca369cb7854。
- Q01-prose-only / 2：failed；记录 45bd3046-afe5-4b6d-8739-e74abde9512d。
- R03-missing-evidence / 3：failed；记录 11a517b2-c702-48d2-8b96-8f953536f6f8。
- Q01-prose-only / 3：failed；记录 05f3af02-8f0c-4cbd-88a8-5d8490210728。

补充语义/事实复核（不修改冻结分数）：

- {"caseId": "S05-compacted-restore", "repetition": 2, "runId": "129eac09-ef06-42db-a6a7-9af962b9ee1e", "status": "manual_review", "scope": "Supplemental scientific wording only; frozen scores unchanged", "note": "潮汐解释使用 far side least 和 Sun adds about half the Moon pull，水凸与引潮力表述含糊；NOAA区分总引力与引潮力，并描述两侧水凸。保留原文人工复核，不自动认证科学表述完全准确或改变冻结评分。", "sources": ["https://oceanservice.noaa.gov/education/tutorial_tides/tides02_cause.html", "https://oceanservice.noaa.gov/education/tutorial_tides/tides03_gravity.html"]}
- {"caseId": "S03-turn-restore", "repetition": 1, "runId": "80a0b45c-d4d6-4fe3-b0be-4da3d59a10a6", "status": "manual_review", "scope": "Supplemental scientific wording only; frozen scores unchanged", "note": "金星高温说明将 sulfuric acid clouds 与温室效应并列，因果措辞有简化；NASA同时提及浓厚二氧化碳大气、云和温室效应，不能据此认定已证明事实错误。保留原文待人工复核。", "sources": ["https://www.nasa.gov/technology/nasa-studies-cubesat-mission-to-solve-venusian-mystery/"]}

## 调用、发布和收尾开销

| 诊断项 | K | L |
|---|---:|---:|
| 可复用成功操作 | 7 | 9 |
| 同版本重复已通过检查 | 2 | 3 |
| 可用发布回执 | 153 | 73 |
| 源码/测试附件 | 25 | 12 |
| 同源同版本重复回执 | 8 | 2 |

以上是轨迹诊断指标：源码附件可能是用户明确要求的重现脚本，重复操作也可能有新需求或时效理由，不能把所有计数自动称为无关/浪费。完整上下文见 publication-analysis.json、semantic-tool-overhead.json、closing-analysis.json。全部 93 次指标为主；matched-costs.json 中双边通过子集仅为事后描述，不能据此挑选结果。

效率目标尚未达到：请求增加30次，工具调用增加46次（约6.16%），token增加334,455（约4.42%）。75对双边均通过样本中，工具619→649、token6,044,751→6,347,496，也在增长；不能仅用完成任务变多解释。该事后子集不能替代全量结论。

R01-price-comparison / 2：开始读取 quoted.csv、invoice.json、retry-source.mjs、sales.csv 及 Git，均非当前价格任务的必要输入。初始产物把 B 成本写成216分且报告正文算出3.60元；独立按公开来源计算的检查识别360分，随后修正产物与报告。正确性最终恢复，但无关读取、未识别的普通node检查、探查和多次重写产生额外往返。 指标变化：{"modelRequests": 13, "toolCalls": 10, "durationMs": 17275.0, "catalogEstimatedCost": 0.009660743999999994, "totalTokens": 180381}
E01-verified-stop / 3：先全面读文件、校验和及inline重算，再运行 node --test test/summary.test.mjs 和 npm test；package.json 的 npm test 同样覆盖唯一 test/summary.test.mjs，语义上重复验证，单靠同命令检测未捕捉这一点。后来又执行两次校验和操作。原冻结评分通过，但开销增加。 指标变化：{"modelRequests": 11, "toolCalls": 11, "durationMs": 10228.0, "catalogEstimatedCost": 0.002455944, "totalTokens": 104441}
C01-add-deliverable / 3：先运行普通node verify.cjs，未提供原规则要求的行为检查回执，再改为 node:test。初始和追加需求两个阶段都在独立检查+review完成后，仅为了outputs附件声明又执行同一通过命令；这是未能停止的明确实例。两次必要的需求变更验证不算重复，两个额外发布用验证单列。 指标变化：{"modelRequests": 7, "toolCalls": 5, "durationMs": 9596.0, "catalogEstimatedCost": 0.003951912000000009, "totalTokens": 102810}

验证完成后继续调用工具的请求5→6，同版本重复已通过检查2→3；虽然没有收尾超预算，停止指引仍未稳定生效。C01第三轮为outputs附件重跑两次是明确残留。源码附件含用户要求的重现脚本，不能全部归为无关。

## 31 场景 × 3 轮配对明细

| 场景 | 轮次 | 上次 K | 本次 L | 确认状态 K/L | 请求变化 | 工具变化 | token 变化 | 初始文件一致 |
|---|---:|---|---|---|---:|---:|---:|---|
| R01-price-comparison | 1 | passed | passed | passed/passed | +4 | +3 | +38735 | True |
| R02-conflicting-source | 1 | passed | passed | passed/passed | +0 | +2 | -1420 | True |
| R03-missing-evidence | 1 | failed | failed | failed/failed | +1 | +2 | -8140 | True |
| D01-monthly-sales | 1 | passed | passed | passed/passed | +0 | +0 | -10432 | True |
| D02-quoted-csv | 1 | passed | passed | passed/passed | +0 | -4 | -19476 | True |
| D03-exact-money | 1 | passed | passed | passed/passed | -2 | -2 | -21474 | True |
| C01-add-deliverable | 1 | passed | passed | passed/passed | -2 | -1 | -42289 | True |
| C02-replace-scope | 1 | failed | passed | failed/passed | +3 | +7 | +34555 | True |
| F01-lost-artifact | 1 | passed | passed | passed/passed | +0 | +5 | +7261 | True |
| F02-transient-read | 1 | passed | passed | passed/passed | -2 | -4 | -21186 | True |
| I01-active-dependency | 1 | passed | passed | passed/passed | +4 | +5 | +45205 | True |
| I02-current-release | 1 | passed | passed | passed/passed | +5 | +7 | +47199 | True |
| E01-verified-stop | 1 | failed | passed | failed/passed | -4 | +1 | -48342 | True |
| E02-green-incomplete | 1 | passed | passed | passed/passed | +0 | +0 | +4938 | True |
| P01-inventory-cache | 1 | passed | passed | passed/passed | +0 | -5 | +9555 | True |
| P02-ticket-labels | 1 | passed | passed | passed/passed | +3 | +3 | +58864 | True |
| S01-standing-en | 1 | failed | passed | failed/manual_review | +0 | +0 | +181 | True |
| S02-standing-zh | 1 | passed | passed | passed/passed | +0 | +0 | +421 | True |
| S03-turn-restore | 1 | passed | passed | passed/passed | +0 | +0 | +28 | True |
| S04-change-revoke | 1 | passed | passed | manual_review/manual_review | +0 | +0 | +60 | True |
| S05-compacted-restore | 1 | passed | passed | manual_review/manual_review | +0 | +0 | -18 | True |
| S06-identity-fields | 1 | passed | passed | passed/passed | +0 | +0 | -139 | True |
| T01-none | 1 | passed | passed | passed/passed | +0 | +0 | -14 | True |
| T02-read-only | 1 | passed | passed | passed/passed | +0 | +0 | -73 | True |
| T03-skills-list | 1 | passed | passed | passed/passed | +0 | +0 | -168 | True |
| T04-skill-view | 1 | passed | passed | passed/passed | +0 | +0 | -48 | True |
| T05-publish-only | 1 | passed | passed | passed/passed | +0 | +0 | -89 | True |
| T06-no-exec | 1 | passed | passed | passed/passed | -1 | -2 | -5679 | True |
| T07-no-review | 1 | passed | passed | passed/passed | +0 | +0 | -122 | True |
| T08-no-status | 1 | passed | passed | passed/passed | +0 | +0 | -70 | True |
| Q01-prose-only | 1 | failed | failed | failed/failed | -1 | -1 | -6126 | True |
| R01-price-comparison | 2 | passed | passed | passed/passed | +13 | +10 | +180381 | True |
| R02-conflicting-source | 2 | passed | passed | passed/passed | +2 | -1 | +26091 | True |
| R03-missing-evidence | 2 | failed | failed | failed/failed | -3 | +0 | -24634 | True |
| D01-monthly-sales | 2 | failed | passed | failed/passed | +5 | +3 | +73035 | True |
| D02-quoted-csv | 2 | passed | passed | passed/passed | +1 | +1 | +3200 | True |
| D03-exact-money | 2 | passed | passed | passed/passed | -2 | -2 | -24363 | True |
| C01-add-deliverable | 2 | budget_exceeded | passed | failed/passed | -3 | -3 | -46038 | True |
| C02-replace-scope | 2 | passed | passed | passed/passed | -3 | +1 | -40110 | True |
| F01-lost-artifact | 2 | passed | passed | passed/passed | +1 | +2 | +3505 | True |
| F02-transient-read | 2 | passed | passed | passed/passed | +0 | -5 | -23937 | True |
| I01-active-dependency | 2 | passed | passed | passed/passed | -1 | -1 | -21267 | True |
| I02-current-release | 2 | passed | passed | passed/passed | -2 | -2 | -4461 | True |
| E01-verified-stop | 2 | passed | passed | passed/passed | +0 | +6 | -1435 | True |
| E02-green-incomplete | 2 | passed | passed | passed/passed | +2 | +4 | +43479 | True |
| P01-inventory-cache | 2 | passed | passed | passed/passed | +3 | -3 | +47738 | True |
| P02-ticket-labels | 2 | passed | passed | passed/passed | +1 | +7 | +8883 | True |
| S01-standing-en | 2 | passed | failed | manual_review/failed | +0 | +0 | +162 | True |
| S02-standing-zh | 2 | passed | passed | passed/passed | +0 | +0 | +334 | True |
| S03-turn-restore | 2 | passed | passed | passed/passed | +0 | +0 | +34 | True |
| S04-change-revoke | 2 | passed | passed | manual_review/manual_review | +0 | +0 | +216 | True |
| S05-compacted-restore | 2 | failed | passed | failed/manual_review | +0 | +0 | +68 | True |
| S06-identity-fields | 2 | failed | passed | failed/passed | +0 | +0 | -144 | True |
| T01-none | 2 | passed | passed | passed/passed | +0 | +0 | -42 | True |
| T02-read-only | 2 | passed | passed | passed/passed | +0 | +0 | -104 | True |
| T03-skills-list | 2 | passed | passed | passed/passed | +1 | +1 | +4055 | True |
| T04-skill-view | 2 | passed | passed | passed/passed | +0 | +0 | -168 | True |
| T05-publish-only | 2 | passed | passed | passed/passed | +0 | +0 | -12 | True |
| T06-no-exec | 2 | failed | passed | failed/passed | +1 | +2 | +5670 | True |
| T07-no-review | 2 | passed | passed | passed/passed | +1 | +0 | +5297 | True |
| T08-no-status | 2 | passed | passed | passed/passed | +0 | +0 | -33 | True |
| Q01-prose-only | 2 | failed | failed | failed/failed | +0 | +0 | -77 | True |
| R01-price-comparison | 3 | passed | passed | passed/passed | +0 | +0 | +4599 | True |
| R02-conflicting-source | 3 | passed | passed | passed/passed | +3 | +5 | +28299 | True |
| R03-missing-evidence | 3 | failed | failed | failed/failed | -4 | -6 | -52836 | True |
| D01-monthly-sales | 3 | passed | passed | passed/passed | +2 | +4 | +20106 | True |
| D02-quoted-csv | 3 | passed | passed | passed/passed | -3 | -4 | -48172 | True |
| D03-exact-money | 3 | passed | passed | passed/passed | +1 | +4 | +24053 | True |
| C01-add-deliverable | 3 | passed | passed | passed/passed | +7 | +5 | +102810 | True |
| C02-replace-scope | 3 | passed | passed | passed/passed | +5 | +5 | +70462 | True |
| F01-lost-artifact | 3 | passed | passed | passed/passed | +0 | +3 | +18286 | True |
| F02-transient-read | 3 | passed | passed | passed/passed | -2 | -2 | -23990 | True |
| I01-active-dependency | 3 | passed | passed | passed/passed | -6 | -4 | -77126 | True |
| I02-current-release | 3 | passed | passed | passed/passed | +2 | +1 | +27662 | True |
| E01-verified-stop | 3 | failed | passed | failed/passed | +11 | +11 | +104441 | True |
| E02-green-incomplete | 3 | passed | passed | passed/passed | -1 | -7 | -5926 | True |
| P01-inventory-cache | 3 | passed | passed | passed/passed | -7 | -3 | -101165 | True |
| P02-ticket-labels | 3 | passed | passed | passed/passed | -3 | -4 | -34350 | True |
| S01-standing-en | 3 | failed | passed | failed/manual_review | +0 | +0 | +129 | True |
| S02-standing-zh | 3 | passed | passed | passed/passed | +0 | +0 | -317 | True |
| S03-turn-restore | 3 | passed | passed | passed/passed | +0 | +0 | +80 | True |
| S04-change-revoke | 3 | passed | passed | manual_review/manual_review | +0 | +0 | +80 | True |
| S05-compacted-restore | 3 | failed | passed | failed/passed | +0 | +0 | -114 | True |
| S06-identity-fields | 3 | passed | passed | passed/passed | +0 | +0 | -139 | True |
| T01-none | 3 | passed | passed | passed/passed | +0 | +0 | -200 | True |
| T02-read-only | 3 | passed | passed | passed/passed | +0 | +0 | -74 | True |
| T03-skills-list | 3 | passed | passed | passed/passed | +0 | +0 | -135 | True |
| T04-skill-view | 3 | passed | passed | passed/passed | +0 | +0 | -58 | True |
| T05-publish-only | 3 | passed | passed | passed/passed | +0 | +0 | -22 | True |
| T06-no-exec | 3 | passed | passed | passed/passed | +0 | +1 | +356 | True |
| T07-no-review | 3 | passed | passed | passed/passed | +0 | +1 | +826 | True |
| T08-no-status | 3 | passed | passed | passed/passed | +0 | +0 | -50 | True |
| Q01-prose-only | 3 | failed | failed | failed/failed | +0 | +0 | -80 | True |

## 局限与留档

三次重复仅提供有限样本；供应商随机性、时间、缓存和响应 ID 不受控。没有独立留出集，已对这批场景进行多轮开发，有过拟合风险。历史配对改善不能证明修改的单项因果效应。冻结语言判定会把某些其他拉丁语言当英语；短专有名存在中文阈值边界；限制说明和纯文档段落快照也存在字面匹配边界，均未放宽。所有这些问题与真实行为问题分别说明。

未注册工具调用依据真实模型 tool_calls 及当次注册集合核对；虚假成功依据实际工具结果和最终文件核对。纯文档编辑额外文件见 final-audit.json。未经独立事实审核的通过项不能解释为所有用户要求均已语义认证。

完整结果 results.json、trajectory.jsonl、逐轮 provider 请求/响应、workspace-final、评分明细、失败、预检和错误均在同一隔离归档目录；已脱敏。artifact-index.json / .sha256 在最终审计后封存。修改与基线保留为候选，未自动合并 main。

归档目录：`/Users/micjoyce/develop/github/xopc/.xopc-evals/deepseek-contract-discipline-2026-10-18`。封存索引 SHA-256：`86f77d6d34e2cf246ea5e05fe656158f8df14be1e02a96b3c00eed61d79c753d`，共 6492 文件。
