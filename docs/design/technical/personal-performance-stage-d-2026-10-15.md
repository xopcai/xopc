# Personal AI 阶段 D：链路观测、性能预算与回归门禁

日期：2026-10-15。范围为服务端实现、隔离真实 Gateway 链路和故障回归。代码尚未提交或部署，未重启生产 Gateway。

## 观测与预算

`PersonalPerformance` 记录有限集合的阶段和状态，保留最近 4,096 条诊断样本，并写入现有结构化日志。没有新增主对话工具、固定模型调用、前台文档解析或前台 Router。记录字段只包括身份、阶段、耗时和受限错误类别，不保存工具参数、提示词或文件正文。

- 主对话：`inputId`、`conversationId`、`runId`、首次非空 assistant text、整轮完成；排队时间包含在输入到文字的服务端耗时内。客户端另外从认证 HTTP 提交开始计时，在真实 WebSocket 收到第一段非空 assistant text 时停止。
- 工具：真实 `toolCallId`、工具名、受限 command、Task、执行 Run 和 assignment epoch；区分成功、待处理、取消和失败。桥接层的补丁格式拒绝也入账，避免只在 execute 内采样漏掉协议拒绝。
- 交付：原成果卡持久化、Composer 文字持久化、忙碌兜底分开统计；结果身份携带成果版本、契约版本和指令序号。
- 审计：门禁从隔离 SQLite 联结 input → run → contract/work revision → instruction/ack → delivery/transcript，并汇总模型调用、token 和可用的估算费用。ack 与采用核验仍分别保存，不相互替代。

初始预算集中于 `src/personal-agent/performance.ts`：主对话 p95 相对同环境空闲组最多增加 10%；submit/revise 本地操作 p95 100 ms、p99 300 ms；热读取 p95 150 ms；原成果到聊天 p95 1,000 ms；忙碌兜底目标 6,000 ms。小样本提交、修订、原成果交付只报告 smoke 耗时，不冒充有统计支持的 p95/p99。

`latencyDistribution` 使用 nearest-rank，保留最大值和全部尾部观察；`assessMainResponseBudget` 至少要求比较双方各 40 个样本，失败或缺少首文字会影响门禁。仅有两次 ping 不再足以宣称 p95 通过。

门禁区分业务完成、RT 预算、可追踪失败和最终恢复：拒绝错误输入不是业务成功，也不要求模型从不产生被拒绝的调用。所有失败仍保存；相同失败参数原样再试、无来源依据的结论或最终未通过验收不能作为恢复通过。`zeroToolFailures` 独立披露，不由恢复成功改写成零失败。

## 三次既有失败与修复

阶段 C 的原始证据是 `personal-task-revision-live-2026-10-15.json` 和对应隔离数据库。

1. `call_00_klRXUTwgJhmQSYg4Ciov7883` 对变量输出目录执行 `rm -rf`，命中新行破坏性命令规则。保留拦截，明确“未执行”，指导使用新输出目录并移除清理操作，禁止换写法绕过。没有削弱沙箱来让 smoke 变绿。
2. 来源 `src-script-run` 把输入命令、真实 stdout 和退出提示混为一个摘录。单靠提示在 D 第一轮仍复现。新增 `toolCallId + excerptRange`：工具回执返回真实输出的 Unicode 范围，宿主从当前执行中成功、已持久化的读取结果提取原文。范围限定 1–1,000 个字符，拒绝越界、伪造 ID 和失败读取；旧的精确摘录保持兼容。来源绑定后仍执行独立 claim/验收核验，范围身份不证明事实必然成立。
3. `call_00_SGadYOQG5EoRPU9MPyEC0091` 在默认 `/bin/sh` 使用 `<(...)`，报错前已有文件写入。Unix 宿主exec_command 执行先运行同一 shell 的 `-n` 语法预检，失败时不启动真实命令。保留显式 bash 的选择，也不自动重放已有副作用。该预检不声称验证 Docker、Windows、依赖安装或运行时语义。

进一步实测定位并修复了补丁末尾正常换行被误拒绝，以及非 Git 工作区被重复执行 Git 审查的问题。补丁仍拒绝错误控制行和尾部说明；非 Git 返回 unavailable/complete=false，明确没有完成 Git 审查，改走实际文件和固定基线核验，不初始化 Git 或伪造审查结果。只读输入仍不可原地修改，执行者必须写入独立输出。

主对话输入读取也进入单独审计：旧规则“without pre-reading every input”被理解为可先读部分输入。强化明确委派时先 submit 的规则，并升级已有生成指令；已有成果追问仍保留 personal_result 的范围读取能力。最终门禁如实记录实际轻量读取次数、字符与耗时，要求本轮输入读取累计不超过 100 ms、单次返回不超过 12,000 字符，不把快速的 requiresSpecialist 元数据回包误当作已解析完整输入。该 smoke 阈值不替代主对话端到端 p95。

异步命令也接入同一来源协议：仅 managed_job 中 status=success 且 exitCode=0 的最终回执可作为来源，并返回真实 toolCallId 与宿主范围。运行中、失败、取消及列表回包均排除；原 running exec_command 不能冒充完成证据，日志路径不被当作跨工作区读取授权。执行者不必为了证据重跑完成命令。

## 可复现实验

```sh
XOPC_STAGE_D_LIVE=1 pnpm exec tsx scripts/personal-performance-live-smoke.mts
pnpm exec tsx scripts/personal-result-read-benchmark.mts
pnpm exec tsx scripts/check-personal-performance.mts \
  docs/design/technical/personal-performance-live-2026-10-15.json \
  docs/design/technical/personal-performance-regression-2026-10-15.json
```

真实模型与原有凭据锁、隔离 SQLite/工作区、随机认证 token、运行中的 Gateway HTTP 和 WebSocket。临时配置及其迁移备份退出时删除；保留合成材料和数据库供只读审计。生产数据与配置不被修改。

三次热身后分别采集 40 次空闲、40 次后台执行期间主对话，输入混合确认、计算、文字改写和简短建议，记录完整回答并检查最基本的内容正确性。之后完成同 Task 修改、旧版下载、新版严格单点替换、最终两文件、采用核验和热读取。采样期间不运行本地回归或构建；其后才启动检查。

这比较同一源码下的空闲与后台负载；顺序采样、增长的会话历史、模型缓存和网络均会影响结果。它不是修改前后两个代码版本的对照，也不是生产 p95。最终脚本含 90 秒等待，用于保证后台执行覆盖样本；不把人工等待解释为业务性能退化。

探索失败摘要保留如下（无引用的中间运行 JSON 已于 2026-10-29 清理，最终证据保留，原文件可从 Git 历史恢复）：run 1 来源摘录失败；run 2 来源引用通过、两版成果成功，但主对话预读断言失败，并暴露补丁/非 Git 审查问题；run 3 在本地回归与基线启动重叠后作废，其配置已清理。均不算最终通过证据。run 4 又暴露了 managed_job 的完成回执未进入来源集合；定位修复期间源码指纹发生变化，sourceChangedDuringRun=true，同样不计为通过。

## 最终结果

最终证据为 [真实链路原始样本](./personal-performance-live-2026-10-15.json)、[读取基准](./personal-performance-live-2026-10-15-reads.json)、[回归结果](./personal-performance-regression-2026-10-15.json)、[验收门禁与关联审计](./personal-performance-live-2026-10-15-acceptance.json)。门禁全部通过，运行期间及运行后源码指纹变化均为 0，临时配置及其备份残留为 0。

| 指标 | 空闲 | 后台执行 |
| --- | --- | --- |
| 真实客户端首文字样本 | 40 | 40，全部与后台执行重叠 |
| 首文字 p50 | 965.80 ms | 945.85 ms |
| 首文字 p95 | 1,095.26 ms | 1,109.04 ms |
| 首文字 p99 / 最大值 | 1,476.32 ms | 1,199.44 ms |
| 整轮完成 p95 | 1,351.26 ms | 1,328.78 ms |
| 失败 / 缺少首文字 | 0 | 0 |

首文字 p95 比值 1.01258，即增加约 **1.26%**，通过 10% 预算。80 个被测输入全部通过 run_id 对应到各自一次真实模型调用，没有增加固定模型轮次。确认和算术回答逐项检查，改写和建议检查存在实际回答；这不是全面的语义质量评估。

| 链路与读取 | 实测 |
| --- | --- |
| submit / revise 本地耗时 | 13.34 / 13.59 ms，分别是单次 smoke |
| 原成果卡到聊天持久化 | 两次分别 16 / 20 ms；不称为生产 p95 |
| 正文热读 | 50 次全部 ready，p95 1.52 ms |
| 发布报告附件热读 | 50 次全部 ready，p95 0.54 ms；单次正文最多 4,000 字符 |
| 固定旧版 / 新版尾部搜索 | 分别找到 CEDAR / MAPLE 核对码，沿用原版本读取权限 |
| Task / 根 Run / 工作修订 | 1 / 2 / 1 |
| 初版 / 修订版 | succeeded / succeeded；v2 指向 v1 |
| 新版最终附件 | 仅 report.md、changelog.txt |
| 修改与投递状态 | applied、verification=passed，修改消息 confirmed |
| 旧版 / 新版下载字节 | 旧版保持不变，新版严格只替换指定核对码 |
| 受限输入副本 / 物化误调用 | 4 / 0 |
| 主对话输入预读 | 最终实测 0 次、0 ms |
| 来源摘录拼接重试 | 0；真实使用 20 个宿主范围引用 |
| 业务链路耗时 | 219,068 ms，包含 90 秒合成等待；另有基线和热身时间 |

读取基准在同一条已完成真实链路的保留数据库与媒体上运行权限检查后的本地 API：先等待准备完成，再逐次断言 ready；正文与附件分开测量，准备等待不计入热读。未生成新任务、模型调用或成果。

最终仍有 **1 次已恢复的工具失败**：`publish_task_result` 的 `call_00_ACUdRH7Dc4srfroIU5O74671` 提供越界的引用范围，被宿主在核验前拒绝。执行者纠正后完成，未原样重试；不称为零工具失败。此前的命令文本拼接、破坏性清理拦截和 shell 写入后语法失败在最终运行中未复现；语法副作用防护另有实际进程回归。

忙碌兜底在本次真实模型运行中未触发，因此六秒预算的覆盖明确标为 injected_clock_regression：三项同时完成、主对话持续不可用、5.1 秒模拟时钟推进，检查实际持久化及竞争去重，不冒充真实负载 p95。

完整场景记录 122 次模型调用，input_tokens 227,855、cache_read_tokens 1,480,704、output_tokens 14,521。92 次有 model_catalog 估算合计 USD 0.048844；另 30 次定价 unknown，不能据此推断实际总扣费。调用、耗时和定价覆盖均在审计 JSON 中，不以首文字变快掩盖后台成本。

34 个回归文件、434 项测试通过；根 typecheck、修改运行时代码及相关测试 ESLint、完整 Node/类型/Web/浏览器扩展构建通过。构建保留既有动态导入、chunk 与插件耗时提示。源码未提交、未部署到生产。

## 回归边界

故障回归覆盖三次连续已完成任务修订与四个不可变版本、多任务同时完成、前台持续忙碌、5.1 秒模拟时钟下的六秒兜底预算、迟到 Composer 去重、429 的有界恢复、断线/重启/幂等、reset/取消/撤权、来源权限、物化哈希和明确最终清单。故障注入与真实模型采样分别标注，不混入 p95 样本。

本轮没有四端真机验收，也没有制造真实提供方限流或独立长事务数据库锁来宣称完整生产容量验收；多任务与时限故障使用上述回归场景。服务端与 Web 构建不等于 Android/iOS/HarmonyOS 真机验证。生产长期 SLO、更多格式/体积、提供方配额竞争与独立 SQLite 写者压力仍需对应环境的持续测量。
