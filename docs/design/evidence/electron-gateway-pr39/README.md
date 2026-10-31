# PR #39 CI 修复证据

对应[合并前验证报告](../../electron-gateway-pr39-merge-report.md)。原 S0、S1 及性能失败证据均保持不变。

| 文件 | 说明 |
| --- | --- |
| `xopc-pr39-shard4-full.log` / `xopc-pr39-shard4-failed.log` | 原 CI job 完整日志与失败 step 日志，包含 10000ms hook 超时 |
| `original-ci-failed-suites.json` | 原结果 JSON 的失败 suite 摘录，包含三项未执行测试、总计、原文件 SHA、run/job/artifact ID；不是原始全集 |
| `original-ci-resources.txt` | 原 CI 资源统计，退出码 1 |
| `xopc-pr39-browser-before.log` / `xopc-pr39-browser-after.log` | 本机系统 Chrome 与固定 Chromium 的三项集成测试对照；本机未复现原 CI 超时 |
| `xopc-pr39-related-tests.log`、`typecheck/lint/depcheck` 同前缀日志 | 687 项相关回归和静态检查 |
| `pr39-local-functional.json`、`pr39-preview.json`、`pr39-keychain.json` | 两种本地路径、预览 IPC 隔离、原生密钥存储 E2E |
| `pr39-frozen-budget.json` | 原采样、原预算完整 60 次复测，8/8；保留 raw 样本与产物指纹 |
| `validation.json` | 推送前本地检查摘要，最终 CI/merge 以 GitHub PR 为准 |
| `preexisting-document-edit.patch` | 本轮开始时未提交的文档文字串入，已恢复正确标识符 |

未放宽 10 秒 beforeAll、测试断言或产品 P95 门槛；浏览器自身启动改为更早的 8 秒截止，CI 显式安装锁文件对应的完整 Chromium。没有重试、跳过或将三项未执行测试算作通过。所有 E2E 输出使用新路径。仅 macOS 开发 Electron 本地验收，不代表远端/安装包/跨平台通过。
