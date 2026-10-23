# Benchmark 驱动 Harness 自我迭代：第一阶段实施与验收

最后更新：2026-10-24。状态：用量修复维持原范围内通过；最新三轮 v7 延迟候选均拒绝，v3 提交 10,631ms 已过 20s 门槛，首答 5,870ms、ping 5,565ms 仍未过 5s，方向转发参数错误也保留。历史失败及 token 缺口不回写，第一阶段仍进行中（见第 9 节）。对应[建设方案](./benchmark-driven-harness-evolution-plan.md)。本文件持续记录实际交付，不把校准或历史成绩当作当前模型能力提升。

## 1. 工作包进度

| 工作包 | 当前状态 | 已交付 | 后续验收边界 |
|---|---|---|---|
| S1-01 注册与协议 | 首版完成 | 场景/能力/owner/L0–L2 registry；执行、评分、有效性、晋级分开；16 个登记族含计划项；取消用量独立登记，不冒充 Personal 质量 | 扩展 owner 分工与更多原生评分协议 |
| S1-02 统一证据 | 首版完成 | 显式来源导入；只读源 SQLite；可重建索引；幂等版本记录；4 类 importer；来源缺失/损坏可见 | 大规模索引 SQL 优化、完整产物归档哈希、结构化复核/重评分 lineage |
| S1-03 Dashboard | 五视图首版可用 | 能力概览、运行中心、证据/run 详情、成对比较、改进记录；分页、筛选、链接、SSE 游标恢复 | 更细粒度能力趋势、统计区间、多条件过滤与自动导出 |
| S1-04 并发调度 | 本地并发与真实传输试点验收通过 | worker 作业/资源互斥、依赖波次、取消/暂停/恢复、独立 attempt、总时间/请求预算、共享 generation/judge/父级额度及跨 campaign 公共 broker | 已补 Cloud 逐请求 ID/总 token 一致性与正常尾部复验；中断 unknown、owner 心跳/接管和 CPU grader 单独额度仍明确保留；当前不宣称生产级分布式调度 |
| S1-05 收敛/交付试点 | 校准与真实试点均已运行 | C01/C02、E01/E02/P01、F01/F02 正负校准，以及 Personal P0 8 项；真实模型计划生成/独立 Gateway 入口 | H02 三次通过；Personal 新批次已在 7 分钟内交付，独立检查 15/15；三项延迟超门槛（见第 8 节） |
| S1-06 候选闭环 | 首个配置候选拒绝闭环完成 | 40→8 轮单变量候选；调用前登记；开发/独立验证；不可变拒绝决策、证据链接与 Dashboard | 不是模型或生产质量提升；用量修复已在新的 H02 家族通过范围内采用；原 8 轮候选和宽批次拒绝不变 |

第一阶段整体仍为进行中。当前交付先解决“跑起来、看得见、证据不混淆”，没有自动合并、部署或创建定时任务。

## 2. 主要实现落点

- [统一索引与查询](../../evals/control/store.ts)、[证据规范化和匹配](../../evals/control/evidence.ts)、[能力注册](../../evals/control/registry.ts)。
- [作业调度与 checkpoint](../../evals/control/campaign.ts)、[通用 TaskScheduler](../../evals/coder/packages/runner/src/scheduler.ts)。
- [请求池](../../evals/control/request-pool.ts)、[隔离子进程 fetch instrumentation](../../evals/control/request-preload.mjs)。
- [Dashboard HTTP/SSE](../../evals/control/server.ts)、[前端](../../evals/coder/apps/web/public/index.html)。沿用 `pnpm run eval:coder:web`，默认本机 4310。
- [试点计划](../../evals/control/plans/stage-one-pilot.json)、[真实模型计划生成](../../evals/control/live-plan.ts)、[运行手册](../../evals/control/README.md)。
- 原 benchmark CLI 增加固定子集选择、concurrency 和原子进度；suite 输入/预算/评分契约不变。真实 direct-agent 单 Gateway 保持串行，多 Gateway 由 campaign 并发，避免共享 profile 污染。

## 3. 首轮实际验收记录

### 3.1 证据导入

首次按显式来源清单导入 9 份历史证据：Personal P0/P1/P2、live mixed，Qwen core/growth，FollowBench/EQ，以及 memory 基线。均读取成功。首次试点后另有 4 份新证据。所有来源库保持只读，导入不会执行 EvalStore migration。

运行中有源码/索引协议增量开发，原导入版本保留；刷新生成新的规范化版本。历史来源身份不完整时显示 unknown，不自动补齐猜测。原始 EQ 12 场保留特征；FollowBench 的 2 项原评分错误仍为 incomplete，不与另存的补判结果静默拼接。

### 3.2 并发速度

首次冻结工程验收：`.xopc-evals/control/concurrency-acceptance-20261023-v1.json`。

| 条件 | 实际完成 | 耗时 | 观察并发 |
|---|---|---|---|
| 串行 | 8/8 | 5317.78 ms | 1 |
| 并发 4 | 8/8 | 1441.11 ms | 4 |

耗时比 0.271，通过 ≤0.60 工程目标。测量包括 Git 工作区准备、400ms 受控 mock、diff、真实评分与清理。没有真实模型请求；不能解释为生产或模型推理提速 73%。

另外，两个独立本地 broker 和 Node 子进程合计 8 次实际本地流式 HTTP fetch，公共父级额度 2 的实测峰值为 2；直到 EOF 才释放，最终 active/queued 为 0。这是传输/并发集成证据，不是 provider 全调用覆盖证明。

### 3.3 收敛与交付首轮

首次运行：`.xopc-evals/control/stage-one-pilot-20261023-v1/campaign.json`，2026-10-23；四项作业全部通过，源码未变，active/queued 最终为 0。

| 作业 | 实际检查 | 首次耗时 | 结论 |
|---|---|---|---|
| convergence-core | C01/C02，reference 与 broken 共 4 次 | 1863 ms | 正负校准通过 |
| convergence-growth | E01/E02/P01，共 6 次 | 2867 ms | 正负校准通过 |
| delivery-core | F01/F02，共 4 次 | 1940 ms | 正负校准通过 |
| delivery-p0 | Personal P0 8 项 | 4003 ms | 8/8 确定性回归通过 |

14 次 oracle 控制不是模型成绩；broken 的预期失败不能误记成产品失败。P0 运行真实 SQLite/认证 HTTP 交付约束，但 worker/reviewer 仍脚本化。

### 3.4 测试与失败处理

新增控制面测试覆盖幂等导入、不可变源、部分/未知/漂移、EQ 特征、资源互斥、暂停/取消/排空、请求额度、真实子进程流式 fetch、HTTP 只读/路径边界、SSE 重放、依赖失败、缺失证据阻断及恢复不替换有效失败。

首次扩大回归：原 18 文件中 16 过、2 失败；两处均因旧 live Gateway 夹具含已删除的 `workflows` 字段，被当前严格 schema 拒绝。已仅移除评测 seed 的旧字段，修复后的两个文件 5 项全部通过；未更改生产 schema 来迁就旧夹具。后续最终验证见下方追加结果，首次失败不删除。

## 4. 当前限制与剩余验收

1. **已销项的用量差额与正常尾部**：已独立复验 E01/E02、F01/F02 和新结构 H02。总量沿用 Cloud 原始 `total_tokens`，逐请求 ID 与账本关联；不再按不完整分量重算总量。详情见第 7 节。
2. **中止采集修复通过，历史缺口保留**：新取消试验两次均保留 aborted 并完整取得 total/input/output，逐请求对账差额 0。旧超时的一次请求现有 settled/charged=0 回执，但无 token；本轮首个取消试验也留下 unknown。两项历史 token 不补零，完整累计 token 与账单仍 unknown。
3. **L2 整体验收尚未通过**：新 mixed 421,191ms 完成交付并通过独立 15 项内容检查；v6 原评分失败保留，三个既定延迟门槛仍失败（25,167/20,000ms、9,992/5,000ms、5,666/5,000ms）。下一候选应改善提交和前台响应；不增加超时、不放宽门槛。
4. **独立验收边界**：H02 新日志重放结构已在候选代码不变的条件下完成三次封存运行；被评 Gateway/子进程受 OS 路径权限约束，宿主 grader 在模型结束后判定。未建立跨账号/远端 evaluator 服务；本轮没有启动通用 optimizer。
5. **调度与覆盖范围**：真实父级峰值 4、judge 峰值 1；独立批次结束 active/queued 为 0。仍不声称任意 SDK、native HTTP、WebSocket、跨机器失联接管都已覆盖。中断未知值不会转成成功或自动重放。
6. **评分协议**：H01 的额外文件规则未在公开契约明确，其原 2/3 分数保留并附 blocking protocol review，当前投影 validity=unknown。H02 是另一结构家族，不是修改原题后重跑。后续新版本必须先公开完整契约、校准并封存。

第一阶段的评测基础、真实 L1 用量修复、独立复验和采用/拒绝记录已具备；由于 Personal 延迟未过、历史最终用量仍未知与旧评分协议待复核，整体仍标进行中，不把局部 promoted 解释为所有产品场景通过。

## 5. 首批基础设施增量验收（真实调用之前）

- 最终全量评测回归：19 文件、57 项全部通过，类型检查通过；包含 17 项控制面/runner 定向检查。首次 2 项旧夹具失败及其修复仍保留。
- 第一阶段试点 v1/v2/v3/v4 均保留为不同工程迭代记录，均为四作业通过；最后 v4 耗时 6000ms，源码指纹未变，队列与请求租约全部排空。v2/v3 与扩大回归重叠，不能用其时延作性能对比。
- 浏览器已实际检查运行中心的实时进度、最终状态、证据列表和比较入口；API 集成检查只读限制、路径边界及 SSE cursor 重连。
- 证据规范化 v2 修正 memory 终态服务错误：执行完整性可为 complete，质量仍是 unavailable，错误仍留在计划分母。不同版本索引记录保留，不能把 184 次已结束运行误写成 181 次，也不能把 3 次错误认作正确答案。
- 控制面源码继续保持类型检查；本批未执行新的收费模型调用。

最终结果摘要：[第一阶段工程验收证据](./technical/evidence/harness-stage-one-2026-10-23.json)。原始本地记录位于 `.xopc-evals/control/`，首次失败与所有增量批次均保留。

## 6. 真实模型试点与候选拒绝闭环（本次新增）

### 6.1 调用前冻结

- 模型：复用已有 XOPC Cloud 凭据与本地目录，固定 `xopc-cloud/openai-codex/gpt-5.6-sol`、reasoning `low`。不使用会变化的 `auto/advanced` 路由；不复制 refresh token。
- 唯一候选变量：隔离评测 Agent 的 `runtime.maxTurns` 从 40 改成 8。生产默认配置未改动。基线和候选在每个阶段使用同一冻结源码、fixture、grader、模型与预算。
- [预登记](../../evals/control/plans/convergence-turn-cap-registration.json)在 11:27:41 UTC 首次执行之前落盘；开发 E01/E02，独立验证 F01/F02；不因 holdout 失败追加调参或质量重试。
- 门禁：候选四项全通过、无质量回退、调用与用量一致，provider 总 token 至少减少 20%。160 次物理请求、20 分钟原计划上限、并发 2。
- 本地来源冻结：开发 `3e9a489dbc9f27016bcfc75b9c7ada8eb2ad6651d1fad829134811ee794e09ee`；独立验证 `76a4d024948f1ee7384bbd6a383e56a7ce0b32af03e5f60f10fcee6946361f70`。验证采用修复后的调度和 ledger 导出；每个阶段内 baseline/candidate 源码相同，均无 source drift。

### 6.2 真实成绩

| 阶段 | Baseline（40 轮） | Candidate（8 轮） | 独立判定 |
|---|---|---|---|
| E01 / E02 开发 | 2/2 | 1/2 | E02 候选产物检查通过，但执行状态为 error，不能按成功计算 |
| F01 / F02 独立验证 | 2/2 | 1/2 | F02 候选同样产物检查通过、执行为 error；F01 通过 |
| 合计 | 4/4 | 2/4 | 不晋级 |

隐藏 grader 在 Agent 结束后注入并执行，原文件保护检查独立于模型自述。验证是跨套件、未参与候选调整的两个已有合成任务；不是新建封存盲测，也不是独立模型 judge。不同阶段任务结构和多轮恢复要求不同，但一轮样本不足以估计生产成功率或统计显著性。

### 6.3 请求与用量对账

| 作业 | HTTP 请求 / runtime 行 / 任务响应 | 辅助调用 | 缺尾部响应 | 已观测 HTTP tokens | 已完成 runtime tokens | 已观测差额 |
|---|---|---|---|---|---|---|
| development-baseline | 21 / 21 / 19 | 2 | 1 | 158,817 | 145,505 | 13,312 |
| development-candidate | 17 / 17 / 15 | 2 | 1 | 128,195 | 107,459 | 20,736 |
| validation-baseline | 24 / 24 / 22 | 2 | 0 | 190,921 | 164,937 | 25,984 |
| validation-candidate | 22 / 22 / 21 | 1 | 0 | 178,505 | 140,233 | 38,272 |

共 84 次物理请求、77 次任务响应、7 次标题辅助调用。82 次有尾部 HTTP 用量，2 次缺失。已观测 HTTP 总计 656,438 tokens；这不是完整消耗总数。完整 baseline/candidate 总 token、降幅、最终金额均 unknown，不用部分观测算收益。验证轮 46 次请求 start/end 与账本完整匹配，但 token 不一致；差额未擅自归为 cache/重试/费用，也未回写历史账本。

开发冻结启动器在结束时强停未完成标题请求，留下两个租约，后续验证未能发出物理请求。已中断原 campaign 并保留失败、unknown、日志和数据库。在剩余 122 次额度内，仅重启此前零模型请求的验证作业；没有重跑/替换任何质量失败。修复包括：最多 15 秒辅助请求排空、停止后 allowlist ledger 导出、OS 确认死 PID 后回收本地与父租约。修复后验证耗时 118,647ms，真实请求峰值 2，最终 active/queued 均为 0。

首轮 ledger 使用只读 sidecar 采集，明确 `finalSnapshotGuaranteed:false`；验证轮由启动器在 Gateway 停止后导出，值为 true。云端回执未建立有效关联，账单保持 unknown；模型请求以外的凭据刷新、目录读取不计为推理请求。

### 6.4 决策与工程验收

候选 `ffe5f466-bd4b-44eb-b2e6-f3e7336fa513` 已持久化 **rejected**，理由包括开发/独立验证各一次未正常结束、首次基础设施中断、用量差异及收益无法证实。没有修改生产默认值。决策不可覆盖；新假设或修复后的复验必须创建新候选。

- [三路对账与门禁](../../evals/control/reconciliation.ts)、[流式 usage 投影](../../evals/control/wire-usage.mjs)、[启动器](../../evals/coder/scripts/run-github-eval.mjs)和 Dashboard 已接通。
- Dashboard 改进记录展示分阶段成绩、HTTP/runtime/任务响应计数、辅助调用、未知尾部、token 差额、拒绝理由和原证据链接；运行中心保留首次 interrupted/invalid 与验证 failed/valid 的区别。
- 全量 Coder Evals：21 文件、63 项通过，类型检查通过；新增对账、辅助请求、差额保留、决策不可变与死进程跨 broker 回收检查。
- 补充尾部缺失回归后，对账文件 4/4 定向通过；部分 HTTP 用量不能变成完整总量。浏览器实查拒绝状态、四阶段成绩、用量差额与证据链接；本地文档链接和 diff whitespace 检查通过。
- 新增回收测试首次暴露父/子 broker 同时回收的竞态，已让上游租约 owner 指向 broker 进程并通过回归；没有放松 alive-owner 保护。

本次可审计摘要：[真实模型闭环验收证据](./technical/evidence/harness-stage-one-live-2026-10-23.json)。原始决策 `.xopc-evals/control/live-cycle-20261023/decision.json`，开发与验证输出均保留。下一优先项是修复用量协议并另建候选复验，再建设封存的新结构验证家族。

## 7. Token/尾部修复与真实复验（本次新增）

### 7.1 根因与实现

真实诊断响应出现 `prompt_tokens=386`、`completion_tokens=156`、`total_tokens=7454`。SDK 将总量重算为 542，忽略服务端给出的总量，造成差额。响应没有足够字段证明差额属于 cache，因此不反推 cache。

- [Cloud 原始总量投影](../../src/usage/cloud-wire.ts)使用 SDK 的局部 fetch 扩展读取未改写的响应，在 terminal event 与 completion result 进入 Agent/账本前保留服务端总量。已接入 embedded、普通 stream 和 one-shot 路径；模型正文、工具调用和保护条件不变。
- [独立 wire 投影](../../evals/control/wire-usage.mjs)保存数字 raw usage，与运行时账本及任务响应事件对照。物理 request ID、Cloud request ID、usage-event ID 三方匹配，避免只看总和相等。角色信息只在进程内 fetch metadata 传递，不增加发送给模型的 header 或 prompt。
- [正常退出](../../evals/coder/scripts/run-github-eval.mjs)同时等待 ledger 与 HTTP tails，并确认稳定空闲；进程退出同步记录 interrupted；[死 owner 补记](../../evals/control/terminal-audit.ts)只追加 usage unknown 的终态，不伪造成功。无 EOF/usage 的强制中断不可能仅靠客户端恢复已付消耗。
- [停止后导出](../../evals/control/runtime-usage.mjs)打开新只读连接，修复 Personal 在 `service.stop()` 关闭旧连接后导出报错。已对真实停止的隔离 DB 重新读取 59 行，与只读恢复结果逐字一致；没有重跑质量失败。

### 7.2 预登记、批次与实际结果

固定 L1 模型仍为已有配置可用的 `xopc-cloud/openai-codex/gpt-5.6-sol` / low；Personal 复用已有 Personal/router/worker/review 配置，所有实际模型和操作记录在隔离 ledger 中。源码快照独立冻结，不受并行 phone 开发影响。

| 批次/作业 | 质量结果 | 真实请求 | 已知最终 usage | 已观测 tokens | 对账结论 |
|---|---|---|---|---|---|
| convergence E01/E02 | 2/2 | 19 | 19 | 150,023 | 逐请求、总量和任务事件一致，差额 0 |
| delivery F01/F02 | 2/2 | 25 | 25 | 209,837 | 同上，差额 0 |
| H01 content-addressed | 原评分 2/3，协议复核 | 48 | 48 | 431,171 | 用量一致；不能据协议疑点宣称模型退化或晋级 |
| Personal mixed | 0/1，超时 | 59 | 58 | 1,657,628（部分） | 58 次逐请求差额 0；1 次 interrupted 最终用量 unknown |
| 新 H02 idempotent ledger | 3/3 | 44 | 44 | 400,368 | 逐请求/总量/任务事件一致，差额 0，无未知尾部 |

两批验收共 195 次物理请求，194 次有已知最终用量；这些已知请求均逐项一致，已观测合计 2,849,027 tokens。195 次的完整总量与最终金额仍 unknown。另有 3 次短协议探针和 7 次旧源码诊断请求，单独保存，不混入修复后的验收成绩。

宽批次预算 240 请求/25 分钟；新 H02 批次另预登记 80 请求/10 分钟，实际 44 次、221,319ms。实际模型请求父级峰值分别为 4 和 2，judge 峰值 1；后者结束 active/queued 均为 0。两个批次按先后执行，不把独立 broker 的额度冒称为全账户硬额度。

### 7.3 新结构独立验收与门禁

H01 第三次将 `release.test.mjs` 放入 release，数值与字节 digest 正确，但 hidden grader 禁止额外文件；公开契约没有明确该限制，也未明确 report 的长度门槛。原评分/文件不改写，另保存 protocol review，review-aware 证据投影将其 validity 设为 unknown；比较与晋级不能静默使用该证据。曾运行的旧 Dashboard parser 产生的旧投影也保留；重启后发布 review v2，以新 revision 为当前状态。

之后没有沿 H01 输出调优 Agent。固定相同的运行时修复 hash，另建 [H02 日志重放家族](../../evals/coder/suites/xopc-ledger-holdout/suite.yaml)：首次 ID 去重、完整重复行计数、不完整尾行、checkpoint 删除恢复、明确 out 目录只含两个文件、report 最低长度。事先冻结三次重复，不替换失败。reference、重复入账、尾部虚构、缺输出、越界附件控制均已校准。

评测 Gateway 通过 macOS `sandbox-exec` 启动；原仓库与冻结仓库的 suite/grader 目录均禁止读写，子进程继承边界。真实读拒绝启动探针及独立写拒绝探针均通过；评分宿主不在该 sandbox 内。其他平台不降级成无隔离执行。该措施约束被评进程，不等于跨账号的远程 optimizer 安全服务。

H02 三次全部通过，44 个 HTTP 请求与 44 个 ledger 行和 41 个任务响应匹配，另 3 次标题调用均计入；400,368 tokens 全量一致。首条可评分结果距 campaign 启动 82,208ms；HTTP 占用 189,282ms、工具占用 4,455ms、grader 占用 139ms，跨度有重叠，不能相加当墙钟耗时。44 次 admission 排队合计 4ms、最大 1ms；源事件原样保留，统计仅为本机描述。

### 7.4 决策、Dashboard 与原证据

- 宽批次改进 `e6d4aaeb-501e-4ef4-ac4c-f89a172dc65b` 为 **rejected**：H01 有评分协议疑点，Personal 超时且一项 usage 未知；没有降低门禁。恢复 ledger 和部分已知总量修正作为 supplement 追加，原 decision hash 不变。
- 新结构批次 `3fe5edbe-c794-4b7d-820a-6561c8264cc7` 为 **promoted（仅用量/退出采集修复范围）**。它没有批准 8 轮候选，没有证明效率/模型质量普遍提高，也没有发布或修改生产最大轮次默认值。
- 最初 `ffe5f466-bd4b-44eb-b2e6-f3e7336fa513` 的拒绝，以及两份原 campaign JSON，SHA-256 均核对未变。原失败、评分、日志、DB、protocol review 和 unknown 全部保留。
- Dashboard 展示范围内采用和历史拒绝、每请求身份/数字差额、unknown、协议复核、追加证据、队列与耗时。已重启验证持久记录，并验证 SSE 恢复；提供 metadata-only `export`，不发布或导出原始个人轨迹。

### 7.5 本次验收结果与未通过项

- 根目录最终 `pnpm run typecheck` 通过；途中和冻结快照的全库检查曾被并行 phone 开发的 tuple 类型问题阻断，原日志保留，该模块未由本次任务修改。
- Coder Evals 最终全量 25 文件、76 项通过；包含协议复核版本、逐请求错配但总和相等、未知终态不抹去部分观测、退出终态、死 PID、post-stop 只读导出、封存 grader 正负控制等。
- 运行时定向 5 文件、16 项通过；使用真实 SDK 对假的流式 HTTP 验证原先的 812→7,852 修正、terminal event/result 一致，以及缺失 usage 不复用前次总量。
- 追加复核阻断对比（包括旧 evidence ID）与 supplement 之后，控制面定向 11 文件、36 项通过；旧原始评分和决策内容不变。
- metadata-only 导出、本地文档链接、JavaScript 语法与 diff whitespace 均完成检查。后续表格显示补充的已知部分用量，不改原决策。

仍未通过的范围只有清晰保留：Personal mixed 交付质量（0/1）、该次强制中断的 provider 最终用量，以及 H01 的旧协议复核。Cloud receipt 实查 `404/not_found`，不能把金额或截断请求记作零。应另立 Personal 交付收敛候选并要求 provider 提供中断最终用量/可查询回执；本地代码无法追溯补造该数据。整体 `phaseOneComplete` 保持 false，范围内用量修复已接受。

机器可读记录：[token/尾部修复验收](./technical/evidence/harness-stage-one-usage-tail-2026-10-23.json)。


## 8. Personal 超时与取消请求分项用量复验（2026-10-23）

汇总见[本轮便携验收证据](./technical/evidence/harness-stage-one-personal-convergence-2026-10-23.json)。原始记录位于 `.xopc-evals/control/`，新增输出目录，不覆盖第 6/7 节的任何 trial、数据库、HTTP 日志或不可变决定。

### 8.1 修复与协议

- 旧 mixed 的多数内容已正确，评审却要求本次 `publish_task_result` 提供尚未返回的自身回执。现在向评审提供宿主直接观测的本次提交及 claim/source 绑定，明确它只能证明关联，不能证明事实正确、未来交付成功。错误价格的真实负例仍被拒绝。
- 错误 `excerptRange` 返回对应真实 toolCallId 与合法范围，避免只报通用跨度错误而盲目重试。范围、原文、逐条审查门禁不放宽。
- Cloud 逻辑取消仍传给 SDK；物理流最多排空 15 秒以获得尾部 usage。修复取消与预取并发导致提前结束采集的竞态；尾部可见时覆盖 SDK 的 total/input/output 零默认值。没有最终 usage 的失败/中止事件在账本保留 null。正常流仍沿用 SDK 分项和 provider 原始 total。
- v6 断言将已隐藏的 routine allocation custom 行当普通 assistant 文本，并要求原始 agent ID 而非显示名，因此新批次原评分仍失败。未来 adapter **v7** 改读带 taskId/selectedAgentId 的结构化执行状态，补齐源码指纹，并让失败报告保留全部已观测耗时。新协议未用于回改原评分，20s/5s/5s 延迟门槛不变。

### 8.2 真实执行与独立验证

Personal 保留当前 `xopc-cloud/auto` Personal、router、worker 与 reviewer 配置；取消试验使用已有可用 `xopc-cloud/openai-codex/gpt-5.6-sol` / low。没有修改生产模型配置。

| 新输出批次 | 结果 | 物理请求 | 已知 provider tokens | 未知 usage |
|---|---|---:|---:|---:|
| personal-convergence / personal | 421,191ms 内交付；原 v6 整体评分 0/1 | 38 | 784,950 | 0 |
| personal-convergence / cancellation | 取消/预取竞态暴露，失败保留 | 1 | unknown | 1 |
| cancellation-drain | 两次 aborted 均采到最终总量；SDK 分项零值单列为后续问题 | 2 | 474 | 0 |
| cancellation-components | 两次 aborted，总量及输入/输出分项全部对齐 | 2 | 474 | 0 |
| personal-independent-verified / inspection | 独立内容检查 15/15，含真实错误价格负例 | 1 | 1,000 | 0 |

本轮共 44 次受控物理请求，43 次具有最终 usage，逐请求总量差额均为 0；已知部分 786,898 tokens，完整总量仍 unknown。另有 1 次未挂 HTTP instrumentation 的前置独立审查，仅列 diagnostic，不混入验收请求分母。所有新 campaign 结束时 active/queued 为 0、无 source drift；Personal 在冻结源码运行，后续两个短批次由受控运行的指纹确认未漂移。

最终两次取消分别为 input=34、output=203、total=237；取消后约 1.49/1.55 秒返回，终态仍为 aborted。新 `assess-verification` 支持 cancellation 的终态、15s+2s 容差、指纹、逐请求身份、total/input/output 门禁；原预登记文件可重复生成同一晋级结论。

独立检查只读原 DB，并用克隆 DB 运行模型审查和新 Gateway：四份最终文件可经原 conversation 的鉴权路径下载，匿名请求均 401，鉴权请求均 200，内容与哈希一致；下载的脚本在禁止联网和外部写入的 sandbox 中复算得到 150/210/+40%，与最终 CSV 相同；新增 change_notes 标记存在；丢失的旧报告 publication ID 不在最终清单；错误 100.00 CNY/h 价格被真实 reviewer 拒绝。原报告/DB 哈希前后不变。这是事后独立补充验证，**不是新的未见质量 holdout，也不改变旧 trial 评分**。

### 8.3 晋级、拒绝与人可见状态

- Personal 修复首轮 `1f7404fc-bfb3-40c3-8ad7-ef0034987cee`：**rejected**。交付超时已不再出现，但 v6 协议问题、三个实测延迟失败及首个取消 unknown 保留；独立验证以 supplement 追加。
- 中止用量修复 `8efaa3dc-f9a6-46f5-9b27-3c0c27b1e0f9`：**promoted，仅限有限排空与可观测用量分项**。2/2、474 tokens、逐请求与分项一致、空闲收尾。没有据此晋级 Personal 整体质量或旧 8 轮候选。
- Dashboard 增加 Personal 分项验收面板，显示内容 15/15、实际总交付耗时和未通过的三项延迟；读取最近一个包含 audit 的 supplement，避免后加账单回执把已有对账显示回退成旧值。取消用量归入独立 `cloud-cancellation-accounting` 登记族，避免它的 2/2 被误读为 Personal mixed 通过。
- 38 次 Personal 调用的权威账单回执全部 settled，共 **2,447,160 credit-micro**；本轮全体请求没有完整结算回执，因此整体金额仍 unknown。旧中止请求回执重查已 settled、charged=0、预留全额返还，但不含 token；零收费不能证明零消耗。本轮首次取消失败请求回执仍 404。均追加到原决定，不改源库。

### 8.4 验证与未销项

运行时/评审定向回归 6 文件 35 项通过；含真实 HTTP 预取取消、15 秒上限、SDK 零默认值不写作实际用量、错误价格证据不能由提交行为自证。控制面检查 12 文件 40 项通过，覆盖分项不匹配、取消被替换为成功、源码变化和超时拒绝；根目录 typecheck 通过。完整 coder 回归 26 文件 80 项通过；Dashboard 浏览器实查可见分项验收、2/2 取消晋级和原拒绝，SSE 重启后恢复。旧决定、campaign 和本轮失败报告的哈希核对均未变化。

剩余：Personal 提交/首答/ping 三项延迟优化及 v7 全链路预登记复验；原 H01 协议复核；历史两次被截断请求的最终 token 仍需上游可查询用量。`phaseOneComplete=false`，不靠删除失败或假设零消耗完成验收。


## 9. Personal v7 固定门槛延迟迭代（2026-10-24）

[本轮完整便携证据](./technical/evidence/harness-stage-one-personal-latency-2026-10-24.json)记录三份预登记、冻结源码、真实配置、不可变拒绝与只读诊断。三轮**顺序执行**，避免试验之间争用同一模型额度。三轮全量 v7 评分为 0/3，不丢弃任何失败，不重跑未改动候选来寻找偶然通过。

### 9.1 实施内容

- 新增 `personal_task` 的显式 `useOriginalRequest=true` 提交路径：只从当前 conversation 的 active message 读取原文，宿主完整绑定到 Task brief，保留 handoff 原请求、sourceRefs、显式 Agent/Skills 与幂等键。无 active input 则拒绝，不从别的会话或任意历史猜测。上下文依赖请求仍支持完整 description。
- Personal 提示要求目标短、提交后仅确认已保存状态，不再重述整个任务；精确短答仍由现有模型生成，没有预置 ping 文本或确定性 echo。
- Personal 工具概览去除重复长描述；提供给模型的完整工具 schema、权限与安全规则保留。
- v1/v2 暴露首次调用漏 `command` 的纠正开销。v3 将命令联合展开为等价的普通字符串 enum、拆平 submit 分支；缺失命令、非法命令、缺必需参数仍被真实 SDK validator 拒绝。第三轮首次提交不再纠正，但后续方向变更仍有一次漏字段，因此未证明整个接口可靠性通过。
- 新增 [固定门槛评估器](../../evals/control/personal-latency.ts)与 `eval:control assess-personal-latency --candidate-root <frozen-source>`：联合验证预登记先于执行、候选文件哈希、v7 mixed 完整分母、原始 trial 成败、20s/5s/5s/10min 和本地 250ms、逐请求用量及空闲收尾。放宽门槛、仅延迟过但原 trial 失败、源码变化或缺失尾部均拒绝。

### 9.2 真实结果

模型继续使用当前已配置的 `xopc-cloud/auto` Personal、router、worker 和 reviewer，session thinking 维持原设置。未修改用户模型配置。下表耗时为本批次观测，不作跨日或小样本因果/SLA 结论。

| 批次 | 提交（≤20,000ms） | 提交后首答（≤5,000ms） | ping（≤5,000ms） | 完整交付 | 判定 |
|---|---:|---:|---:|---:|---|
| 上轮 v6 参考 | 25,167 | 9,992 | 5,666 | 421,191ms | 原拒绝保留 |
| v7-v1 | 18,138，通过 | 7,207，失败 | 5,640，失败 | 307,616ms | rejected：首次工具漏命令及延迟未过 |
| v7-v2 | 28,418，失败 | 6,852，失败 | 7,459，失败 | 未交付 | rejected：参数错误、OAuth 刷新失败、整体对账未过 |
| v7-v3 | 10,631，通过 | 5,870，失败 | 5,565，失败 | 296,713ms | rejected：首答/ping 与方向转发参数错误 |

v1 的 7 项研究检查通过，v3 的 8 项研究检查通过；两者实际错误价格负例均被拒绝，模型生成的四份文件经原 Chat 鉴权下载。v7 原全量评分仍因主对话工具参数错误等断言失败，不能把这些局部检查记作完整 v7 通过。v2 没有完整交付，不将其 failure 解释为所有内容推理不合格。

三个 improvement：

- v1：`060806bf-4a60-45e2-a283-0f73e09caff5`。
- v2：`c4dc2d9c-342a-4940-a8b2-ef8692a213b3`。
- v3：`c9ed040b-4969-4651-88b3-6f3f36c0b587`。

原始 `verification.json` 不可覆盖；后续逐调用耗时和保留证明通过 `latency-analysis-supplement.json` 追加。Dashboard 三张候选卡显示全部四个延迟项及其门槛，提交过线与整体拒绝同时可见。

### 9.3 调用对账与失败保留

| 批次 | 物理模型请求 | runtime 事件 | 已知 provider tokens | 物理最终 usage 缺失 |
|---|---:|---:|---:|---:|
| v1 | 35 | 35 | 720,948 | 0 |
| v2 | 27 | 32 | 592,388 | 0 |
| v3 | 40 | 40 | 737,788 | 0 |

共 102 次实际模型 HTTP 请求、2,051,124 个已观测 provider tokens，已知逐请求用量均相符。v2 另有 5 个未对应物理请求的运行时事件：4 个记录 `OAuth refresh failed for xopc-cloud: fetch failed`，1 个在最终快照仍 running。它们单列为未分发/未完成事件；不补零、不当作成功模型请求。因此 v2 全量请求/账本门禁仍失败，全部运行的财务总额仍 unknown。

前台 ping 的本地准备仅数百毫秒，主要耗时在物理模型 HTTP 请求。请求参数与上游代码检查只能确认现有 off 的显式投影边界，不能据此宣称已修好远端推理/服务延迟；本轮没有修改上游服务或模型设置。后续需要减少前台往返和明确协调 API，再以同门槛复验，不能靠反复抽样或把完成时延改成首 token 时延过线。

每轮结束后，把隔离 DB、产物 media、日志、输入和 worker 工作区复制到该轮 `retained-private-evidence/`；原 DB 和副本哈希一致，配置与 credentials 不复制。原 trial、HTTP JSONL、源 SQLite、失败测试日志均保留；没有改写第 6–8 节历史证据。raw 仅保存在本地 ignored 目录，不提交原始会话。

### 9.4 验证与剩余项

- 运行时及提示回归：5 文件 75 项通过；额外 Personal 产品回归 3 文件 15 项通过。
- 控制面/runner：13 文件 45 项通过；完整 coder 回归 27 文件 85 项通过。根目录 typecheck 通过。
- Dashboard 浏览器实查确认三轮拒绝、完整 v7 原失败及四项固定门槛同屏可见；本地元数据已导出，原决定、历史失败及保留数据库哈希核对均未变化。
- v3 冻结候选使用 `Type.Unsafe` 表达同一 JSON enum，当前源码改用 `Type.String` 修正跨 TypeBox 版本的 TS 推断；已断言两者 provider JSON schema 深度相同、实际 SDK 的接受/拒绝行为相同。该修正没有新模型行为或替换真实试验。

剩余仍明确：首答与 ping 的 5s 门槛、协调工具参数可靠性、v2 credential/运行收尾异常，以及此前 token 缺口与旧评分协议。`phaseOneComplete=false`。本轮只确认提交项已有达标样本，没有晋级任何整体 Personal 延迟候选。
