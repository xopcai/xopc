# S4 继续开发：构建隔离、安装包回归与预算对照

基于 `d1ed18f05` 继续开发。用户已授权后续完整阶段，实施顺序见[进度文档](../../../electron-gateway-execution-progress.md)。本批仍未通过 S4，不据此开放远端 Host/本机能力。

## 修订与验证

- 远端入口直接使用打包契约规定的解包目录，消除与本地资源解析器的构建耦合。本地 `out/main/main.js` 与原 main 重建对照 SHA-256 均为 `b5d9fa570e7cd51048de289559d1d95090e7a292e604c7a33cbc4e61cde59da0`；本地 preload 也相同。原生 helper 保留，本地源码、采样器和预算未修改。
- 恢复 E2E 的进程识别支持任意安装目录和空格，精确匹配应用可执行文件，排除其他应用和 Gateway 子进程。修复原工具只能清理 `/tmp` 下实例的问题，增加针对性回归。
- **140 项 / 12 文件通过**，Electron 类型检查通过。定向 Electron lint 被现有配置忽略，不计作覆盖；仓库标准 lint 通过（0 errors、5项既有 warnings）。签名打包及实际资源比对通过，658个运行文件匹配，依赖58.25 MiB，原125 MiB上限不变。公证仍因缺配置跳过。
- 新包摘要 `fb6211d562e459c90a6fb09ecb9cf3874e56b93e09045fe3374d932c850025ae`。本地 spawn/reuse 功能回归通过；远端 SSH loopback fixture 聊天/历史、停止、gap与45秒半开恢复、丢回执、进程与worker崩溃、A/B隔离及实际返回本地通过，测试前后包摘要一致。

远端成功测试使用同机独立 Gateway 和确定性模型，不替代独立物理服务器、实际模型、公共证书或100次输入验收。此前独立服务器结果属于旧包，不移植成新包通过记录。新包自签 TLS fixture 失败为 `GATEWAY_TLS_FAILED`，保留失败，未绕过证书校验。

## 原预算

完整运行均使用原采样器：每模式30次、first-launch-heavy-v1、每API129样本，原S0及阈值不变。首次候选尾部采样期间有 CUA 文档工具调用，单独保留；之后预先登记候选→原main串行对照，期间无构建、功能测试或UI自动化。

| 记录 | 结果 | spawn ready P95 | reuse ready P95 |
| --- | --- | --- | --- |
| `s4-local-budget-isolated-graph-1.json` | 7/8 | 2017.65ms，通过 | 1135.84ms，失败 |
| `s4-isolated-pair-candidate-1.json` | 6/8 | 2450.35ms，失败 | 1143.62ms，失败 |
| `s4-isolated-pair-control-1.json` | 8/8 | 1999.01ms，通过 | 991.60ms，通过 |
| 原就绪上限 | 不变 | 2140.48ms | 1102.21ms |

三次API和RSS均通过。额外10次reuse诊断为959.65–1024.33ms，未复现尾部延迟；诊断有插桩且样本不足，不用于预算验收。原main此前也有失败，但本次对照通过。不能用历史对照失败或静态字节一致宣布候选通过，也不能由一次顺序对照认定唯一根因。**本地性能阻断项未关闭**，仍需隔离时序/环境与候选入口影响。

## 原生恢复未验收

两轮故障包均显示原生对话框，选择前无本地SQLite/workspace初始化。CUA按键返回 `procNotFound`，独立非tmp路径的点击及后续状态/截图返回 `timeoutReached`。实际按钮动作和返回本地未验收。`s4-native-recovery-cua-errors.json` 为本聊天工具结果摘录，对应应用断言失败独立保留。故障包是独立bundleId/ad-hoc签名，不是正式产物；没有用其他输入技术或测试桩冒充实际点击。

## 证据与重跑

`manifest.json` 保存main/preload/原基线及新交付介质摘要，不覆盖旧清单。JSON从原报告解析后逐字符串脱敏，测量值不变；日志保留构建、测试及预算输出，仅去掉末尾多余空行；原始日志仍在本机。

```sh
node scripts/verify-electron-installed-local.mjs --app /absolute/path/to/new/xopc.app --output reports/new-local.json
node scripts/verify-electron-remote-chat.mjs --app /absolute/path/to/new/xopc.app --half-open --output reports/new-remote.json
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --compare docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-local-baseline.json --output reports/new-budget.json
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --artifact-root /absolute/path/to/original-main-control --artifact-source-ref c8da81aa0280a3a45041bfbfa39c2f389d98b965 --compare docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-local-baseline.json --output reports/new-control.json
```

预算须在构建和功能测试结束后单独运行，保留全部失败和对照，不重复挑选通过样本。原生恢复需要可操作对话框的CUA环境。平台、公证、安装包性能、新包独立服务器复验及S5等缺口仍未标为完成。
