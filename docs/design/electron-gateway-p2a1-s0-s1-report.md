# P2a-1 S0/S1 实施与验收记录

日期：2026-10-31。分支：`codex/gateway-p2a1-s0-s1`。worktree：本会话原 P0/P1 worktree，基于已合并 main `f5b4b660` 新建分支，保留并提交了本次评审后的方案更新。

## 已交付边界

S0 已冻结当前 macOS 开发运行范围的接口/入口、身份依据、版本、预算和本地基线；S1 已实现独立连接配置预览及能力隔离，功能测试与 E2E 通过。**后续已修复本地启动期热点，两轮复测均通过原冻结 8/8 门槛；当前 macOS 开发运行范围的 S0/S1 验证完成，不推进 S2。** 详见[本地 P95 排查与复测](./electron-gateway-config-p95-investigation.md)，下文保留原批次失败记录。 没有远端 Shell、上游连接、远端聊天、Host 或本机能力，本阶段不能宣称完整 P2a-1 已通过。

S0 文档与证据提交：`3f8c721bc`。S1 初始候选：`a45a405a2`；端口释放和默认入口依赖隔离补丁：`c5dbb7e20`，原批次验收以此产品源码为准；后续本地性能修复为 `5eb228844`、`12e094a35`，最终复测指纹另见排查报告。完整实施范围见 [S0 冻结清单](./electron-gateway-p2a1-s0-scope.md)，后续步骤见[主方案](./electron-local-remote-gateway-plan.md)。

## 入口与本地保护

正常启动不变：`out/main/index.js` 仍进入原本地 main，不加载新 profile、凭据存储或远端窗口。预览需显式传入 `--gateway-connections`：

```bash
pnpm run electron:vite:build:package
pnpm exec electron out/main/index.js --gateway-connections
```

预览必须冷启动；若已有同一用户目录的实例，请先正常退出。它提供连接配置的保存/选择/移除、退出和显式返回本地入口，选择只得到 `remote-chat-unavailable`，从不产生认证/身份已验证或聊天就绪状态。返回本地采用退出并以干净参数重启，不把原 argv 中的文件、深链或远端标志转给本地 intake。

预览在加载 local main 前分流，因此不调用共享 config/workspace 初始化、Gateway 启动、DesktopEndpointHost、语音/隧道/托盘/桌宠或 Web EndpointToolBridge。它不加载 Web 聊天页面，不存在 Renderer Host fallback。原本地生命周期、Cookie、IPC、默认超时和进程所有权均未修改。

新静态配置页和受限 preload 在 Electron 构建时发射至 `out/preload`，由 index 明确传入资产位置，避免动态 chunk 的相对路径假设。现有 pack-dir 会复制整个 `out/preload`，但尚未据此声称真实安装包验收通过。

## 状态、存储与安全边界

- 新状态仅位于 Electron `userData/gateway-connections-v1/`，与本地 `~/.xopc` 数据分开；配置仅存 remote profile 和随机凭据引用，不保存活动连接或未验证 gatewayId。
- origin 仅接受规范 origin，direct 要求 HTTPS；显式 SSH 仅接受 loopback HTTP，始终标为 remote。拒绝 userinfo、路径、query/hash、非 loopback SSH 和未知字段。
- 凭据使用 Electron 45 的异步 safeStorage，Linux 拒绝 basic_text/unknown 后端，不明文回退；8KiB 凭据、20 profile、128KiB 配置及 16KiB IPC 请求上限。主进程公共快照只返回 hasCredential；不会返回 token、ciphertext 或 credentialRef。
- 串行变更与 epoch 防止旧/并发请求覆盖新状态。目标 origin/transport 改变不继承旧凭据；重启不自动激活。配置写入临时文件、fsync 文件后原子替换；损坏文件保留并进入恢复状态。
- 加密/存储操作 15s 截止；若可能有磁盘提交仍在进行，进入需要重启核实的隔离错误状态，拒绝后续变更，不假报写入未发生或自动重试。底层文件系统 I/O 不承诺可强制取消；迟到的完整落盘结果由新进程重新读取核实。不是执行租约或网络 exactly-once 实现。
- 清理未引用的加密凭据，覆盖“凭据写入后、配置提交前崩溃”的孤儿；损坏元数据时不擅自清理凭据，无法安全恢复则维持禁用。
- 预览使用独立内存 partition、sandbox/contextIsolation、禁止网络/frame/object 的 CSP；权限请求/检查均拒绝，禁止下载、导航、新窗口、webview 和拖放导航。
- 主进程独立 IPC 边界只允许配置命名空间，核验登记 WebContents、精确配置文档 URL 和顶层 frame；旧 invoke/send/MessagePort 默认拒绝。该边界只安装在预览运行时，不改变本地原有来源判断；即使误注册旧 handler 也在副作用前拒绝。导航、崩溃或关闭后撤销授权。

## 验证结果与证据

| 检查 | 结果与边界 |
| --- | --- |
| S0 本地基线 | 新启动/复用各 30 次通过；每模式 129 次 config 和 sessions 请求（首实例 100 次，随后 29 个实例各一次），冻结 P95 预算与原始数据，不等同于稳态 API 时延 |
| S0 功能 E2E | 两种模式的 Cookie、Agent/SQLite/Realtime、渲染聊天、文件边界、PTY、浏览器、自有重启持久化及复用拒绝重启通过 |
| S1 类型/回归 | 完整 `pnpm run typecheck`、63 文件 489 项 desktop/scripts 测试通过；包括损坏/重复/超限配置、加密失败/超时、串行与旧 epoch、孤儿凭据、invoke/send/port 拒绝及端口回收 |
| 构建/静态检查 | `electron:vite:build:package` 通过；根 lint 0 errors/5 个既有 warnings；depcheck 0 violations。根 lint/depcheck 不覆盖全部 Electron 文件，不能当作新增 Electron 模块完整 lint/依赖审计；以类型、回归和实际运行补充 |
| 预览 E2E | 真实生产入口/受限 preload：保存/选择、旧 epoch、导航拒绝、111 个旧 IPC × invoke/send/MessagePort，副作用计数 0；无上游请求、共享配置初始化或自动激活；损坏配置可恢复。本轮本机能力始终禁用 |
| 原生密钥存储 E2E | 直接启动 Electron，不使用 Playwright launcher 的 mock-keychain/password-store 参数；native async safeStorage 加密、跨进程解密验证及删除清理通过。UI/IPC 预览 E2E 使用的 Playwright flags 单独标注，不冒充原生密钥存储验收 |
| S1 本地功能 E2E | 两种模式通过；故意写入损坏远端 profile，本地不读取/迁移它 |
| 预览资产完全缺失 | 在临时构建副本中删除 connection-entry chunk、受限 preload、配置 HTML/JS；本地两种模式完整功能 E2E 通过，包括损坏远端 profile。使用开发依赖/SQL 资源映射，仍不是安装包测试 |
| 最终本地产物边界 | 删除默认 index 的新 node:path 静态依赖，将资产路径解析移至预览模块；最终本地 `out/main/main.js` 与 S0 字节相同，SHA256 均为 `c30fadfb96852518e2d98a43ac30ac5b2649e6a7a7e449fde6dbf736dee994c2`。入口仍有显式分支，字节相同不能替代性能/运行验证 |

固定版本：xopc/Web `0.0.437`，Node `26.12.1`，Electron `45.0.0`（内嵌 Node `24.22.0`），Realtime v2、Endpoint v2（后者仅本地既有路径，远端禁用）；macOS arm64，内核 `25.6.0`。旧 Gateway 组合和完整 UI/API manifest 未验收。

### 原批次性能反证与当时状态（保留失败证据）

初始 S1 候选的两批完整对照各 60 次功能运行成功，但均有 1/8 性能项超标：reuse configMs P95 分别为 65.0ms、62.3ms，S0 为 48.3ms、冻结上限 53.3ms，其余 7 项通过。失败样本保留，预算未放宽。

随后独立构建原 main `f5b4b660` 进行对照；其入口 SHA 和完整 main/preload 树摘要与 S0 完全一致（树摘要 `24518a8ba1fddaff20a703878f7b47eec219c9b62abdd38c97c20f43745cdd67`），Node/Web 源码未变。同脚本原版对照也出现 reuse configMs P95 60.5ms 超标，其余 7 项通过。这证明原冻结测量在本轮环境中并非稳定可复现，不能据此单独归因于 S1；也不能据此宣布 S1 无回归。

原始分布中，首实例连续请求与后续新窗口首请求混合进同一 P95，部分后续首请求约 60–70ms；该统计同时包含启动流量与调度影响，不是 Gateway 稳态服务时延。未人为等待来压低指标、未删除慢样本、未重置基线或用新的较宽基线替代冻结门槛。

原批次最终 `c5dbb7e20` 产品补丁的 60 次运行全部功能成功，但性能仍为 7/8：reuse configMs P95 65.2ms 超过冻结上限 53.3ms。**本批次功能交付完成，性能门槛保持未通过，阶段验收未完成。** 后续需先解决原基线的复现性与采样解释，不能只反复重跑等到偶然通过；若需要重设计采样，应独立评审并分别报告启动阶段与稳态口径、同环境旧/新配对及误差，保留现有冻结失败证据，不能通过只改测试把本轮标绿。

| 模式/指标（P95） | S0 | 冻结上限 | 最终 S1 | 结果 |
| --- | --- | --- | --- | --- |
| spawn readyMs | 2038.55ms | 2140.48ms | 2036.97ms | 通过 |
| spawn configMs | 47.60ms | 52.60ms | 43.50ms | 通过 |
| spawn sessionsMs | 26.60ms | 31.60ms | 25.20ms | 通过 |
| spawn rssMiB | 1026.33MiB | 1077.64MiB | 1023.69MiB | 通过 |
| reuse readyMs | 1002.21ms | 1102.21ms | 1084.45ms | 通过 |
| reuse configMs | 48.30ms | 53.30ms | 65.20ms | 未通过 |
| reuse sessionsMs | 20.00ms | 25.00ms | 19.90ms | 通过 |
| reuse rssMiB | 685.27MiB | 719.53MiB | 685.42MiB | 通过 |

单机存在其他开发活动，非严格隔离的性能实验；不能把启动或内存下降归因于本次修改，也不能以原版对照超标为理由自动豁免冻结门槛。

### 预跑修复

真实预览第一次启动因入口模块顶层等待 app.whenReady 而超时，已改为异步启动、让 Electron 入口完成求值；失败记录保留。安全复查修复被拒 MessagePort 的显式关闭，并验证 once listener 正确释放。以上均已在最终产品源码上复跑回归/构建/预览与原生密钥存储 E2E。

### 可复跑命令与原始记录

准备 Node/Web 资源后，执行 `pnpm run typecheck`、`pnpm exec vitest run --project=computer-desktop --project=scripts` 和 `pnpm run electron:vite:build:package`。Node 构建会清理 dist，必须补齐 Web 构建；预览脚本也必须先完成 main/preload 构建。

```bash
node scripts/verify-electron-connection-preview.mjs
node scripts/verify-electron-connection-keychain.mjs
node scripts/verify-electron-local-connection.mjs --runs 1 --operations 100 --functional --output reports/p2a1-s1-functional-rerun.json
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --compare docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-local-baseline.json --output reports/p2a1-s1-comparison-rerun.json
```

验收脚本依次运行；不要并行运行或覆盖已保留证据。最后一条目前预计可能因已记录的性能门槛返回非零，不能忽略退出码。原生 keychain 脚本只使用隔离测试数据；系统后端不可用时应失败，不得加入 mock-keychain 来取得通过。

- [验证汇总与产物身份](./evidence/electron-gateway-p2a1-s0-s1/s1-validation.json)
- [最终预览 IPC E2E](./evidence/electron-gateway-p2a1-s0-s1/s1-preview-e2e.json)与[原生密钥存储 E2E](./evidence/electron-gateway-p2a1-s0-s1/s1-native-keychain-e2e.json)
- [最终本地功能 E2E](./evidence/electron-gateway-p2a1-s0-s1/s1-final-local-functional.json)与[缺失预览资产/损坏 profile E2E](./evidence/electron-gateway-p2a1-s0-s1/s1-missing-assets-local-e2e.json)
- [最终性能未通过记录](./evidence/electron-gateway-p2a1-s0-s1/s1-final-comparison.json)
- [首轮性能反证](./evidence/electron-gateway-p2a1-s0-s1/s1-local-comparison.json)、[复测反证](./evidence/electron-gateway-p2a1-s0-s1/s1-local-comparison-repeat.json)与[原版对照反证](./evidence/electron-gateway-p2a1-s0-s1/s0-control-comparison.json)
- [预览启动超时记录](./evidence/electron-gateway-p2a1-s0-s1/s1-preview-startup-failed.json)

## 明确未覆盖

没有真实远端 HTTPS/WSS、SSH 网络、远端身份认证、Shell 代理、聊天协议降级或设备权限验收；这些分别属于 S2/S3 与 P2a-2。当前已有持久 Gateway 身份，但公开 challenge 不能代替认证后身份发现，后续需只读认证契约，不能偷用创建 mobile/Chrome pairing 的接口。

没有签名安装包、Windows/Linux、24 小时运行或跨版本发布/回退验收。本地测量仍使用开发 Electron 和已记录的 SQLite/dev dist 测试映射；不能据此消除 P0/P1 的打包布局限制。预览 E2E 的 OS relaunch 被替换为参数/退出请求断言，真实本地路径另外通过完整本地 E2E 验证；尚未验证操作系统实际重启接力。

本轮不 push、不创建 PR、不合并，不继续 S2。未通过的完整 P2a-1 门槛继续保持待实施/待验收，不以本批次通过代替。
