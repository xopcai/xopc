# 复用模式 config API P95 排查与修复

日期：2026-10-31；产品修复提交 `5eb228844`、`12e094a35`，验收工具补充 `e9879e25a`。本轮仅排查本地性能与验收口径，没有推进 S2、接入远端 Host 或改变本地认证/IPC/工作区行为。

## 结论与根因

确认存在采样解释问题，以及两个实际的启动期 CPU 热点：

1. 历史 API P95 混合了不同启动阶段。每模式的 129 个请求，包含 30 个“每窗口首个测量请求”和首个窗口后续的 99 个连续请求。约 60ms 的首请求数量跨过 P95 排位边界时，混合 P95 会从几毫秒跳到约 60ms。这不是稳态 API 时延，不能仅凭一次通过或失败判断回归。
2. 存在真实的启动期事件循环阻塞。新窗口请求 `/api/automation-runs/product-events` 时，自动化 HTTP bundle 会构建完整 ProductDispatcher，为笔记、任务、设置、Agent 等未被该路由使用的能力同步生成 JSON Schema 和契约摘要。旧路径首次处理约 36–41ms，CPU 工作阻塞其他 HTTP 请求进入处理器。慢 config 调用约 54–69ms，其中 config 处理器自身约 7–9ms；其余主要发生在进入处理器前，与该自动化路由的同步初始化重叠。

修复将自动化 HTTP 路由改为只注册已有的自动化 read/write/draft 定义，不改全局 ProductDispatcher。相同诊断下，自动化事件路由首次处理约 15–22ms，8 个窗口的首个 config 调用约 6.6–43.1ms。没有给 config 加缓存，没有删除/延迟 UI 功能，没有延长超时或加入等待来压低指标。

3. 第一个修复后的第二轮完整复测暴露另一热点：reuse config 38.4ms 已通过，但 sessions P95 30.5ms 超过原 25ms 上限。sessions 处理器约 0.65–1.3ms，重叠的 `/api/providers/meta` 却约 45.6–56.3ms。该路由为每个 provider 重复规范化并扫描整个模型目录、重复计算精选 provider 列表；推荐模型也先排序整个目录再过滤。

第二处修复将目录计数和精选集合改为每请求计算一次，推荐模型先按原条件过滤再用原比较器排序。没有跨请求缓存，认证状态仍实时读取。8 窗口诊断的首个 config 约 6.8–24ms、sessions 约 1.1–2.9ms；捕获到的 provider-meta 完整响应约 15–31.8ms。未捕获完成的请求不记为零。诊断仅用于定位，正式门槛仍由关闭探针的完整运行判定。

## 基线复现性与身份

原版对照使用独立构建目录，保留修改前的 Node/Web 产物，按 main `f5b4b660` 的原 Electron index/build config 重建。`out/main`、`out/preload`、`dist` 的 3040 个文件整体摘要为 `9cd6976b16302c72f0023258aa13e85919a1811b545ad309df13729148ab87d2`，与 S0 冻结记录完全一致；不是只比 main.js 或检查源码提交。

本轮原版 60 次运行全部通过，reuse config P95 为 9.5ms；此前同产物对照曾为 60.5ms，S1 候选曾为 62.3–65.2ms。结合首请求/后续请求的分布与请求时间线，确认原混合统计对启动竞态敏感，不能把全部差异归因于 S1，也不能用“环境噪声”豁免门槛。所有历史失败记录保持不变。

服务端诊断仅在 Node 运行的 reuse 模式显式启用。用响应 requestId、单调耗时和墙钟关联客户端与服务端，记录路径、状态及 CPU 时间，不记录认证头、Cookie、body 或 query。服务端进程 CPU 时间包含同一进程的并发工作，不冒充函数独占 CPU 采样。

首轮 CDP 诊断会在计时前附加调试连接，改变请求与初始化的相对时序，因此不用于正式验收；后续探针不在计时前增加 CDP/等待。另一次 spawn 诊断因 Electron 子进程未加载 NODE_OPTIONS 探针而缺少日志，该失败保留并明确归为探针不可用；现在服务端探针仅允许显式 `--diagnostics --mode reuse`。

## 采样与验收工具修正

- 保留原 `first-launch-heavy-v1` 的请求顺序、数量、从 fetch 开始到 JSON 读取完成的计时语义。正式比较仍为新启动/复用各 30 次、每模式 129 次 API 调用，未改变权重或剔除首请求。
- 新增 `firstMeasuredPerLaunch` 和 `subsequentInFirstLaunch` 分组统计，原混合 P95 仍独立保留并参与原门槛比较。分组统计不作为替代门槛，也不称为所有窗口的稳态指标。
- 报告明确记录采样版本、模式和诊断状态；比较前核对完整启动样本、重复/缺失/失败、每窗口调用数量及 raw API timings 与 API summary 的一致性。历史 schema 1 只有满足原始数量的记录才允许作为同口径基线。
- 诊断运行不允许参与验收比较；即使 `runs/operations` 相同，改变窗口权重也会拒绝比较。不能通过多加快请求、改写 summary 或少跑某种模式得到通过。
- 正式输出文件已存在时，启动 Electron 前即拒绝，保护失败证据。测试验证旧文件内容不变。
- 除原 Electron 完整摘要外，新增 Gateway、Web、可选 packaged server 和 SQL 资源的前后指纹；运行中任何相关产物变化均使验收失败。

预算保持 S0 原值和规则：P95 上限为 S0 + max(5%, 预定绝对容差)，启动 100ms、API 5ms、RSS 32MiB。reuse config 上限仍是 **53.30000001192093ms**，没有改用本轮新的较宽基线；也没有用原版本轮 9.5ms 替换历史基线。

## 契约与本地行为验证

新增 `src/automations/api/dispatcher.ts`，仍调用同一组 `registerAutomationReadCapabilities`、`registerAutomationWriteCapabilities` 和 `registerAutomationDraftCapabilities`。既有认证、scopes、输入/输出校验、revision 和幂等执行机制不变。路由地址不变，lazy-bundle 仍为 automations；增加 product-events 的映射断言及附近负例覆盖。

测试比较窄 dispatcher 与完整 dispatcher 的全部自动化描述、摘要、权限、HTTP/CLI/Agent surface；验证无 scope 拒绝、无效参数拒绝，并用旧完整 dispatcher 的已提交回执在新 HTTP dispatcher 中重放，确认不再次排队执行。

650 项相关测试通过（74 文件：desktop/scripts/automations/lazy/provider-meta 641 项，presentation 9 项）；完整类型检查、Node/Web/Electron 构建通过，根 lint 0 errors/5 个既有 warnings，dependency-cruiser 0 violations。根 lint/依赖图不覆盖全部 Electron 模块，这项限制不变。

provider-meta 路由测试核实每请求只读取一次模型/精选目录、下一请求看见目录变化以及认证字段保持不变。推荐模型测试以旧的“先排序再过滤”算法为对照，覆盖当前所有 provider 和 1/4/20 三种条数，输出顺序一致。

真实 Electron 功能 E2E 覆盖新启动和复用的 Cookie、聊天、Agent/SQLite/Realtime、文件边界、PTY、浏览器、自有重启持久化、外部服务拒绝重启及损坏远端 profile 不影响本地。新增真实认证 lazy-route 检查：product-events 未登录 401、已登录读取 200、无效 limit 400；providers/meta 未登录 401、已登录 200，目录数量与认证字段形态有效。预览 111 个旧 IPC 的 invoke/send/MessagePort 隔离以及原生 safeStorage 跨进程验证也通过。

## 正式复测

仅自动化修复的第一轮完整复测为 8/8，reuse config 35.0ms；第二轮为 7/8，reuse sessions 30.5ms 超过 25ms，不能据 config 通过宣布完成。该失败引导了上述 provider-meta 修复，失败原始数据保留。包含两处修复（`12e094a35`）的两轮完整复测均为 **8/8**。每轮新启动/复用各 30 次，共 120 次；关闭诊断、不增加等待、不改变原请求权重，两轮使用完全相同且运行前后未变的产物。

| 模式/指标 P95 | 冻结上限 | 完整复测 1 | 完整复测 2 |
| --- | --- | --- | --- |
| spawn readyMs | 2140.48ms | 2026.33ms | 1998.80ms |
| spawn configMs | 52.60ms | 27.40ms | 33.00ms |
| spawn sessionsMs | 31.60ms | 7.10ms | 19.70ms |
| spawn rssMiB | 1077.64MiB | 1024.25MiB | 1015.73MiB |
| reuse readyMs | 1102.21ms | 998.15ms | 1062.46ms |
| reuse configMs | 53.30ms | 37.70ms | 37.90ms |
| reuse sessionsMs | 25.00ms | 10.10ms | 12.70ms |
| reuse rssMiB | 719.53MiB | 701.75MiB | 702.91MiB |

分组仅用于解释混合 P95，不替代上表的验收门槛。以下均为 reuse 模式；首请求 30 个、首窗口后续请求 99 个：

| 产物/批次 | config 混合 P95 | config 首请求 P95 | config 后续 P95 | sessions 首请求 P95 |
| --- | --- | --- | --- | --- |
| S0 冻结 | 48.3ms | 67.6ms | 4.3ms | 32.7ms |
| 原版本轮复现 | 9.5ms | 64.1ms | 4.9ms | 20.0ms |
| 两处修复复测 1 | 37.7ms | 48.1ms | 4.9ms | 20.5ms |
| 两处修复复测 2 | 37.9ms | 43.9ms | 4.4ms | 20.5ms |

[证据索引](./evidence/electron-gateway-config-p95/README.md)列出诊断、原版产物证明、原始时序、失败报告、测试/构建日志及两轮最终报告；[验收摘要](./evidence/electron-gateway-config-p95/validation.json)记录对应提交、原始基线 SHA 和实际产物指纹。开发中曾将目录计数变量放错作用域，导致 provider-meta 测试返回 500，已修复并保留失败及重跑日志。此前 S1 与原版超标证据未改动。

本轮关闭当前 macOS 开发运行范围的本地性能阻塞，S0/S1 已实现范围的功能与冻结性能门槛通过；不将其扩展为完整 P2a-1 或跨平台发布验收，不推进 S2。

正式复测必须不带诊断参数，并选新的输出文件：

```bash
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --compare docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-local-baseline.json --output reports/config-p95-new-run.json
```

诊断与正式测量不得并行，且不能在其运行期间重建产物。用户电脑仍存在其他开发活动，非严格隔离性能实验；两轮通过也不保证所有环境或未来每一批都通过。签名安装包、Windows/Linux、真实远端、24 小时运行和 OS 实际重启接力的既有未覆盖项不变。
