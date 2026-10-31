# S0/S1 review 证据索引

对应[review 报告](../../electron-gateway-s0-s1-review.md)。原 S0、S1 和前轮性能排查记录未被替换。

| 文件 | 用途 |
| --- | --- |
| `xopc-s1-review-regressions-before.log` | 旧实现的新回归用例：9 failed / 26 passed |
| `xopc-s1-review-regressions-after.log` | IPC/汇总校验修复后同组 35 passed |
| `xopc-s1-review-readiness-before.log` | 原 250ms 轮询未满足就绪通知用例：1 failed / 13 passed |
| `s1-review-frozen-budget-1.json` | **失败**：轮询修复前完整复测 7/8，spawn ready P95 2327.23ms 超标 |
| `s1-review-startup-diagnostic.json` | 12 次 spawn 生命周期/主进程请求诊断；不作验收 |
| `s1-review-startup-probe.json` | 8 次 spawn，另加独立认证观察；不作验收 |
| `s1-review-local-functional.json`、`s1-review-preview.json`、`s1-review-keychain.json` | 初次 review 修复后、轮询修复前的三组 E2E |
| `s1-review-final-local-functional.json` | 最终产物：本地新启动/复用、认证路由、聊天/Realtime/SQLite、文件/PTY/浏览器、重启与所有权 |
| `s1-review-final-preview.json` | 最终产物：111 个旧 IPC 的 invoke/send/MessagePort 隔离，含 prepend 注册方式 |
| `s1-review-final-keychain.json` | 最终产物：原生 safeStorage 跨进程加解密及清理 |
| `s1-review-final-frozen-budget-1.json`、`s1-review-final-frozen-budget-2.json` | 最终产物两轮完整正式测量，关闭诊断；原始样本、原预算、产物前后指纹 |
| `validation.json` | 最终版本、检查与两轮比较摘要 |
| `xopc-s1-review-*.log` | 各次测试、构建、诊断和 E2E 日志；`*-final*` 为启动轮询修复后的结果 |
| `xopc-s1-review-preexisting-doc.patch` | 修正未提交文档文字串入前的原始 patch；不是推进 S2 的指令 |

正式测量仍是每轮 30 spawn + 30 reuse，每模式每 API 129 次、原 `first-launch-heavy-v1` 请求权重和计时语义。failed 报告始终保留，不以诊断或分组指标替代 8 项冻结门槛。当前仅 macOS 开发 Electron；没有远端、安装包、跨平台和长时间运行验收。
