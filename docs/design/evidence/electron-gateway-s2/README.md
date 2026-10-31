# S2 验收证据（2026-10-31）

基于 main `ab82be00f`，产品源码 `5e9ec4a4e`；范围及限制见[实施记录](../../electron-gateway-s2-report.md)与[冻结契约](../../electron-gateway-s2-contract.md)。仅 macOS arm64 开发 Electron，不代表安装包、物理远端服务器或完整 P2a-1 发布验收。

## 基线和原预算

[原 S0 基线](../electron-gateway-p2a1-s0-s1/s0-local-baseline.json)保持不变；[本次 main 复现](./main-baseline.json)、[最终完整复测 1](./s2-complete-budget-1.json)及[复测 2](./s2-complete-budget-2.json)均 8/8 通过。每轮新启动/复用各 30 次、每模式每 API 129 个样本，沿用 `first-launch-heavy-v1` 和原预算，无诊断或额外计时前等待。原始耗时、环境、指纹和门槛均保留在 JSON 中；汇总见 [validation.json](./validation.json)。报告中的 dirty 状态来自当时待归档的文档/证据，不替代产物指纹核验。

## 最终功能验证

相关测试 865 项 / 108 文件通过，类型检查、Node/Web/Electron 构建通过；lint 0 errors / 5 个既有 warnings，dependency-cruiser 0 violations（其扫描范围不覆盖全部 Electron）。日志为同目录 `xopc-s2-complete-*.log` 与 `xopc-s2-final-build-*.log`；退出清理修订后 Electron 重构建见 `xopc-s2-cleanup-build-electron.log`。

- [SSH loopback](./s2-complete-ssh-e2e.json)、[HTTPS/WSS](./s2-complete-tls-e2e.json)：真实 Gateway、生产 main/preload/utility、身份绑定、HTTP/WS、隔离、111 项旧 IPC、崩溃与恢复；SSH 模式不包含外部登录或隧道管理。
- [不信任证书](./s2-complete-untrusted-e2e.json)、[错误主机名](./s2-complete-hostname-e2e.json)：明确 TLS 失败，无回退。
- [清理失败隔离](./s2-complete-cleanup-e2e.json)、[配置预览](./s2-complete-preview-e2e.json)、[原生安全存储](./s2-complete-keychain-e2e.json)。
- [本地两模式完整功能](./s2-complete-local-functional.json)：聊天、Realtime/SQLite、文件/PTY/浏览器、退出与重启规则。
- [移除 S2 专用资产后本地功能](./s2-missing-assets-local-functional.json)及[移除清单](./s2-missing-assets-manifest.json)：故障开发副本仍共享构建 Gateway/Web 和开发 SQL 映射，不是安装包故障验收。

HTTPS 使用独立 TLS 终止代理与真实 Gateway；测试 CA 仅注入测试启动器，不关闭证书/主机名验证，不宣称 Gateway 原生 TLS 已接入。

## 失败记录（未删除或覆盖）

| 证据 | 原因及处理 |
| --- | --- |
| [TypeScript](./xopc-s2-electron-check-2.log) | 导航事件联合类型不匹配 overload，改为分别注册 |
| [Host 单测](./xopc-s2-shell-tests-1.log) | fetch 未发送伪造 Host，改原始 HTTP 请求验证 403 |
| [首次 WS E2E](./s2-shell-first-e2e.json)、[日志](./xopc-s2-shell-e2e-1.log) | proof filter 缺少 WS scheme，修复后真实 WS/WSS 通过 |
| [首次 HTTPS fixture](./s2-shell-https-e2e.json)、[日志](./xopc-s2-shell-https-e2e.log) | Gateway 原生 TLS helper 未接监听器，明确采用 TLS 终止 fixture 重测 |

本轮没有正式性能预算失败，历史失败证据仍在原目录。所有凭据为已销毁测试 fixture 的合成凭据；首轮失败中保留 CLI 的合成 token 短预览，后续采集已统一脱敏。

## 复测入口

使用全新输出路径，避免覆盖证据：`node scripts/verify-electron-shell.mjs --output reports/<new>.json`，分别追加 `--tls`、`--tls --untrusted`、`--tls --wrong-host`、`--cleanup-failure`。本地入口为 `scripts/verify-electron-local-connection.mjs`，正式性能使用原 S0 文件作为 `--compare`，功能另加 `--functional`。原生安全存储与配置预览使用既有对应验证脚本。S3 聊天写入/业务状态隔离、S4 安装包/独立服务器/跨平台/长期运行尚未验收；没有远端 Host 或本机能力接入。
