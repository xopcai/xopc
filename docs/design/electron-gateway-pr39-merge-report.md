# PR #39 CI 与合并前验证

日期：2026-10-31；PR：https://github.com/xopcai/xopc/pull/39。

## 原始检查结果与修复

原 head `85986f68c91ec517bcf2d2a05aaa9ecfadf47c2c`，main `f5b4b660`。原 CI run `41165579564` 的 shard 4 失败，汇总 Test 因依赖结果失败；其余测试分片、类型/lint、依赖检查、React Doctor、构建和 Harmony 契约检查通过。首次检查没有 review 提交、inline 评论或 Conversation 评论。

失败为 `src/browser/recordings/__tests__/record-replay.integration.test.ts` 的 beforeAll 超过 **10000ms**；三项测试因此未执行，不能将它们计作通过。原日志未细分 listen 与浏览器启动耗时，不能仅据此断言具体 Chrome 内部故障。检查代码确认两处环境缺口：测试硬编码 runner 自带的 `chrome`，workflow 未显式安装该浏览器；Playwright 默认启动截止长于外层 hook，超时后底层启动可能仍继续。

修复 `a4d406814`：CI 显式运行 `pnpm exec playwright-core install --with-deps --no-shell chromium`，使用锁文件 Playwright 对应的浏览器；测试使用 `channel: 'chromium'` 的完整浏览器，并设 8000ms 启动截止，使失败能在原 10000ms hook 前给出浏览器诊断并清理。没有增加 retry、跳过用例或延长 hook/测试/产品性能预算。

本机旧 Chrome 版本三项测试通过（总耗时 6.76s），修复后的固定 Chromium 也三项通过（2.88s）。本机不能复现原 CI 超时，因此这两组结果仅作为环境依赖修正的本地验证，不冒充 Ubuntu CI 根因的完整复现；修复有效性以新 head 的全部 CI 结果为准。

## 本地验证

- 687 项相关回归 / 78 文件通过；浏览器录制/回放集成另 3 项通过。
- 完整类型检查通过；lint 0 errors / 5 个既有 warnings；dependency-cruiser 0 violations。
- 本地新启动/复用 E2E、111 个旧 IPC 的三个传输方式隔离（含 prepend 注册）、原生 safeStorage 跨进程验证通过。
- 本次仅改 CI 与测试，不改本地/远端产品运行时代码。未重建产品：核实当前 Electron/Gateway/Web/SQL 产物指纹与上次两轮 8/8 完整验收一致；原构建记录继续保留。新 CI 另执行完整构建门槛。

原冻结基线与所有历史失败文件保持不变；每模式 30 次启动、每 API 129 个样本，关闭诊断，预算公式与绝对容差不变。本轮完整性能对照 **8/8 通过**，新启动/复用各 30 次，共 60 次。

## 证据与边界

[证据目录](./evidence/electron-gateway-pr39/README.md)保留原 shard 4 的完整/失败日志、失败 suite 的原始 JSON 内容及资源统计，另保留本机前后对照、相关测试、E2E 与原预算复测。原测试结果全集的 SHA 与 artifact ID 记录在摘录中，摘录不伪称全部原文件。

排查文档有一处未提交的 `zoProductDispatcher` 文字串入，已恢复准确的 `ProductDispatcher`，编辑前 patch 单独保存；未变更历史失败证据。

S2、Shell、远端聊天、Host 和本机能力保持未实施。本地 E2E 范围仍为 macOS arm64 开发 Electron；不扩展为安装包、跨平台、长时间运行或真实远端验收。

## 本轮原预算性能复测

| 模式/指标 P95 | 原冻结上限 | 本轮 |
| --- | --- | --- |
| spawn readyMs | 2140.48ms | 1916.43ms |
| spawn configMs | 52.60ms | 33.80ms |
| spawn sessionsMs | 31.60ms | 7.20ms |
| spawn rssMiB | 1077.64MiB | 1022.20MiB |
| reuse readyMs | 1102.21ms | 960.19ms |
| reuse configMs | 53.30ms | 9.40ms |
| reuse sessionsMs | 25.00ms | 19.50ms |
| reuse rssMiB | 719.53MiB | 705.39MiB |

本文件为修复推送前的验证快照，尚不宣称新 head 的 CI 已通过或 PR 已合并。最终检查和合并状态以 PR #39 为准；合并只能在新 head 所有门槛通过、review 无阻塞后进行。

## 新 CI 暴露的浏览器平台兼容缺口

修复后 head `1a82f758f` 的 CI run `41167887273` 在四个分片的浏览器安装前置步骤失败，job `124439297650` 完整日志保留。明确报错：`Playwright does not support chromium on ubuntu26.04-x64`。`ubuntu-latest` 已转为 Ubuntu 26.04，前述补丁漏掉了浏览器与 runner 系统的兼容约束，因此单独固定浏览器尚不足以修复 CI。此次失败在任何测试执行前发生，不计作产品测试通过或原预算性能失败。

追加将测试分片 runner 固定到 `ubuntu-24.04`，该平台存在于当前锁定 Playwright 的浏览器下载与 nativeDeps 映射中；保留固定 Chromium、8 秒 launch / 10 秒 hook 和全部测试，不修改其他不使用浏览器的 runner。最终仅接受追加修复后新 head 的所有 CI 结果。

本机按原分片命令 `VITEST_MAX_WORKERS=2 pnpm run test:all --shard=4/4` 完整重跑：**467 文件 / 3177 测试全部通过，0 skipped**，原失败的三个录制/回放测试均实际执行。它补充了整组并发场景的本地验证，不能代替 Ubuntu CI。
