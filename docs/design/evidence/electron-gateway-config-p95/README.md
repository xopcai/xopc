# 本地 config P95 排查证据

对应[排查报告](../../electron-gateway-config-p95-investigation.md)。S0 原始基线及此前 S1 失败继续保存在 `../electron-gateway-p2a1-s0-s1/`，本目录不替换它们。

| 文件 | 用途 |
| --- | --- |
| `config-p95-control-artifact-proof.json` | 原版 3040 文件产物整体摘要与 S0 一致的证明 |
| `config-p95-original-reproduction.json` | 原版 30 spawn + 30 reuse 完整复现；本轮通过，不抵消历史失败 |
| `config-p95-diagnostic-1.json` | 早期 CDP 诊断，时序被调试连接影响，不作为验收 |
| `config-p95-diagnostic-2.json` | **失败**：spawn 子进程未加载 HTTP 探针；保留错误，不归为产品故障 |
| `config-p95-diagnostic-3.json` | 早期 reuse HTTP 诊断，仅按路径/墙钟关联 |
| `config-p95-exact-control-diagnostic.json` | 原版 reuse 请求 ID/HTTP 时间线 |
| `config-p95-fixed-diagnostic.json` | 仅自动化修复的诊断，保留 provider-meta 热点 |
| `config-p95-fixed-frozen-budget-1.json` | 仅自动化修复，完整复测 8/8 |
| `config-p95-fixed-frozen-budget-2.json` | **失败**：仅自动化修复，reuse sessions P95 30.5ms > 25ms；7/8 |
| `config-p95-provider-fixed-diagnostic.json` | 两处修复后的诊断；不作为验收 |
| `config-p95-complete-frozen-budget-1.json` / `config-p95-complete-frozen-budget-2.json` | 两处修复后两轮完整复测，各 60 次、8/8 通过原门槛 |
| `validation.json` | 最终检查、提交、基线 SHA、产物与预算摘要 |
| `config-p95-complete-functional.json` | 最终产物的本地新启动/复用功能 E2E、真实认证路由验证 |
| `p2a1-s1-preview-e2e.json` | 配置预览及 111 个旧 IPC 的三个传输入口隔离 |
| `p2a1-s1-native-keychain-e2e.json` | 原生密钥存储跨进程验证，不使用 mock-keychain |
| `xopc-p95-provider-tests.log` | **失败**：开发中目录计数变量放错作用域导致路由 500；已修复 |
| `xopc-p95-provider-tests-2.log` | 上述作用域问题修正后的测试结果 |
| `xopc-p95-final-*.log` | 最终类型、650 项相关测试、三种构建、lint 与依赖检查 |
| `xopc-p95-complete-*.log` | 最终功能、预览、密钥存储及完整性能复测日志 |

正式性能报告使用 `first-launch-heavy-v1`，关闭探针；每轮各 30 次启动/复用，每模式 129 次 config 和 sessions 请求。诊断只能解释热点，不替代原预算或改变采样权重。运行报告包含原始样本和产物前后指纹。性能报告在运行开始时先写入 `passed:false`，只有 `finishedAt` 和完整 comparison 存在才视作完成。
