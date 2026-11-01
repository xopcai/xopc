# 本地连接与 S0/S1 验收索引

本 PR 仅包含 P0/P1 本地连接抽象、S0 基线冻结、S1 连接配置预览/能力隔离及已确认的本地性能修复。S2、远端聊天和 Desktop Host 不在本 PR 范围。

## 必须保留的验收输入

- [P0 原始基线](../electron-connection-p0-p1/p0-local-baseline.json)：P0/P1 的原始对照数据。
- [S0 冻结基线](./s0-local-baseline.json)：后续性能比较的原始时序与统计，SHA256 `e752bb4b97f54e4713d8ecc8b6f8cd302d3e80d044099b0397dfe113d0f45746`。
- [冻结约束](./s0-freeze.json)：每模式30次启动、首窗口100次操作、原8项P95预算和产物身份；上限与容差不变。
- [旧 IPC 清单](./s0-legacy-ipc-inventory.json)：预览 E2E 脚本的直接输入，不能作为临时报告删除。

P95仍按原 `first-launch-heavy-v1` 混合口径判断；首请求/后续请求分组只用于解释，不替代原门槛。诊断运行不能用于验收，失败不能通过改权重、重写summary或放宽预算消除。

## 历史结果与边界

已确认启动期自动化 HTTP dispatcher 初始化过宽、provider元数据重复扫描目录的CPU热点；相应修复保留原权限、响应语义和请求级实时认证，不引入跨请求缓存。历史macOS开发运行的功能/冻结预算复测结果随原档案保留，不据此承诺安装包、跨平台、真实远端或长测验收。

必须保留的失败包括 config/sessions P95超限、启动/IPC验证失败，以及 PR #39 的浏览器hook超时、Ubuntu/Chromium兼容缺口和native PTY加载失败。修复未延长原hook、启动、停止或产品预算；旧失败不追溯改为通过。

本轮仅整理文档：过程报告、重复JSON、构建/诊断/CI日志和临时patch移出PR差异，原件完整保存在下述远端Git快照，不永久丢弃失败证据。上述四个验收输入保持逐字节不变。本轮不重跑应用E2E，不冒称新运行时验收通过。

## 原始档案

[清理前完整文档与失败证据](https://github.com/xopcai/xopc/tree/backup/pr42-before-doc-cleanup-20261101-091934789/docs/design)；标签 `backup/pr42-before-doc-cleanup-20261101-091934789` 指向清理前提交 `0919347892034b652965734afc65d435a22fc921`。

档案包含 P0 依赖盘点、阶段报告、S0范围、P95调查、review/PR39报告，以及 `electron-connection-p0-p1`、`electron-gateway-config-p95`、`electron-gateway-p2a1-s0-s1`、`electron-gateway-s0-s1-review`、`electron-gateway-pr39` 五组原始证据。可按原路径从该标签查看或导出，无需把原始日志重新加入产品分支。

## 复现入口

先按仓库说明构建产物，使用全新报告路径；不能在测量期间重建产物，诊断与正式测量不并发。该脚本使用隔离状态，不操作日常配置：

```sh
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 \
  --compare docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-local-baseline.json \
  --output reports/local-connection-new-run.json
node scripts/verify-electron-connection-preview.mjs
node scripts/verify-electron-connection-keychain.mjs
```

原生确认需要实际本机交互；开发运行不代替正式安装包/平台矩阵验证。整体架构与后续阶段见[主方案](../../electron-local-remote-gateway-plan.md)。
