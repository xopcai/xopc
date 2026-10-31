# S0/S1 与本地性能修复 review

日期：2026-10-31；审查基线 `origin/main=f5b4b660`；修复提交 `28ee6729c`、`ade849998`。

## 范围与结果

复核 S0 冻结、S1 连接配置预览、IPC/凭据隔离、自动化 HTTP dispatcher 和 provider 元数据优化，以及采样/证据工具。代码图 MCP 本会话不可用，按 diff、源文件和调用/路由关系核对。原本地默认入口仍直接加载 local main，预览需显式 `--gateway-connections`。本轮另修复本地启动就绪检测的轮询等待，详见下文；没有实现 S2、Shell、上游认证/HTTP/WS、远端 Host 或本机能力。

## 已修复的 review 发现

| 发现 | 影响 | 修复与证据 |
| --- | --- | --- |
| P2：IPC 防线遗漏 prepend 注册方法 | 虽然预览当前未注册旧工具，意外通过 `prependListener` / `prependOnceListener` 注册的旧 handler 能绕过统一授权包装，破坏默认拒绝约束 | 同时包装这两种注册方法；拒绝调用时关闭 MessagePort。单测验证未授权 handler 无副作用、合法 once 只执行一次；真实 Electron 111 个旧 IPC 的 send/MessagePort 覆盖这些注册方式 |
| P2：性能比较仅核对 API 原始数据 | 修改 ready/RSS 汇总仍能参与预算比较；OS 或嵌入 Electron/Node 版本变化也未被拒绝 | 所有汇总从 raw 样本重算并严格比对，拒绝空值/负值/非有限值；报告内外 runtime 一致且 OS release 相同。原 S0 和此前两份通过报告也通过加严校验，不改其数据/预算 |
| P2：部分 E2E 固定输出可覆盖失败 | 预览和原生密钥存储每次写同一个报告，后续通过可能抹去失败 | 三个 runner 共用独占 `wx` 创建输出；支持 `--output` 新路径，已有文件启动前拒绝。并发及失败内容保留测试通过；未完成运行只留明确 `passed:false` 的占位报告 |

新增回归用例在旧实现上 **9 failed / 26 passed**，修复后同组 **35 passed**。新增独占输出并发测试随后包含在完整相关回归中。失败日志原样保留，不把开发期的预期失败当成最终通过。

未提交的排查文档有一处文字串入并打断数字和编号，修复为原来的 `54–69ms`；编辑前 patch 单独保留。它不构成推进后续阶段的授权。

## 性能复测中新增的失败与修复

首轮 review 后完整测量 `s1-review-frozen-budget-1.json` **7/8**：spawn ready P95 2327.23ms > 原上限 2140.48ms，其余七项通过（reuse config 40.4ms、sessions 11.3ms）。自动串行流程在失败后停止，没有运行第二轮，更没有据此 push。该失败报告和日志保留。

该失败时本地 `out/main/main.js` 仍与 S0 同摘要 `c30fadfb…994c2`，但字节相同不能豁免运行门槛。独立的 12 次启动诊断记录原来的主进程认证请求、生命周期日志及导航时间线：较慢启动的 config 轮询比快启动多一至两次约 250ms 间隔。随后 8 次诊断加入独立认证观察，部分样本在观察到认证成功后仍等待约 40–89ms 才由主进程再次检查。两组诊断会改变时序，只用于解释等待机制，不当作正式验收，也不能据此认定全部启动延迟都来自轮询。

`ade849998` 将产品 `waitForGatewayReady` 的重试间隔从 250ms 缩短到 100ms，减少实际打开工作区的等待。仍先通过配置 token 的 `/api/config`，再通过原严格兼容检查；不更改 120s 总超时、2s 请求超时、复用/进程所有权或正式采样的等待点。约 1 秒的启动中会多进行几次 loopback 探测，这个成本计入实际 E2E 和性能测量。没有为了通过测试而改报告公式或等待条件。

新增行为用例验证 API 从拒绝变为接受认证后能在 150ms 内完成严格兼容检查并返回，旧实现 **1 failed / 13 passed**；修复后包含在 687 项回归中。该处确实修改了本地 main 产物，最终产物摘要以新验收记录为准，不再沿用原来的“本地 main 字节未变”结论。

## 检查与验收

相关测试：**687 项 / 78 文件通过**，包含 desktop、scripts、automations、lazy-bundle、provider-meta、provider presentation，以及关联 Electron 入口测试。完整类型检查、Node/Web/Electron 构建通过；lint 0 errors / 5 个既有 warnings，depcheck 0 violations。根 lint/依赖检查覆盖范围仍不等于全部 Electron 模块。

本地新启动/复用功能 E2E、预览能力隔离（111 个旧 IPC，含 prepend 注册）、原生 safeStorage 跨进程加解密均通过。最终两轮完整性能复测均 **8/8**，共 120 次启动/复用。只接受原 S0 的 `first-launch-heavy-v1`、30 spawn + 30 reuse、每模式每 API 129 次采样及原来的 8 项预算；不删慢样本，不增加计时前等待，不改变基线或容差。

证据目录：`evidence/electron-gateway-s0-s1-review/`。原 S0 冻结和此前所有失败/通过证据保持不变，新增记录独立保存。所有产品修复后的正式测量不得与构建、测试、诊断并行。

当前验证范围仍为 macOS arm64 开发 Electron。签名安装包、Windows/Linux、24 小时运行、OS 实际 relaunch 接力和真实远端链路尚未验收，不能把 S0/S1 通过扩展为完整 P2a-1 发布通过。

## 最终冻结预算复测

| 模式/指标 P95 | 原冻结上限 | 最终复测 1 | 最终复测 2 |
| --- | --- | --- | --- |
| spawn readyMs | 2140.48ms | 1981.92ms | 1985.09ms |
| spawn configMs | 52.60ms | 29.30ms | 29.90ms |
| spawn sessionsMs | 31.60ms | 19.80ms | 6.50ms |
| spawn rssMiB | 1077.64MiB | 1019.59MiB | 1018.19MiB |
| reuse readyMs | 1102.21ms | 974.46ms | 983.37ms |
| reuse configMs | 53.30ms | 35.80ms | 39.60ms |
| reuse sessionsMs | 25.00ms | 11.20ms | 19.20ms |
| reuse rssMiB | 719.53MiB | 703.44MiB | 704.69MiB |

两轮相同产物、运行前后指纹不变。最终本地 main SHA256 为 `5201aa55a81c9ee73a3569253d729a5e49d98a6b4c6efa178b316d0cac0ab36a`，源码修复为 `ade849998`；Node/Web 本轮未再改产品源码。完整原始数据和版本见[验收摘要](./evidence/electron-gateway-s0-s1-review/validation.json)与[证据索引](./evidence/electron-gateway-s0-s1-review/README.md)。

当前范围内已无未修复的阻塞发现，可以提交 PR 供 CI 与人工 review；不合并，不推进 S2。两轮通过不承诺未来所有批次或其他平台必然通过。
