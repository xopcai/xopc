# Electron 连接改造 P0 / P1 实施与验证报告

初次日期：2026-10-30；review 更新：2026-10-31。分支：`codex/gateway-connection-p0-p1`。

## 初次 P0/P1 阶段记录

已完成本轮 macOS 本地连接基线、依赖盘点和 P1 本地连接抽象；远程功能未实现。现有本地 Gateway UI、Cookie、Realtime、启动/复用/退出、路径与权限策略继续使用原链路。完整跨平台、签名安装包和远程发布门槛仍未验收，不以本轮结果替代。

- P0：基于提交 `f362d177861508aac0e6785ddc5afda3c94bf656`，生产 main/preload 与真实 Gateway，新启动与复用各 30 次，60/60 通过。每模式 config/session 各 129 个计时样本；依赖位置和未来远程禁用项见[盘点](./electron-connection-p0-inventory.md)。
- P1：再次执行相同启动与接口采样，60/60 通过；8/8 个预先设定的比较门槛通过。数据表明本轮测量范围内无超预算回归，不能据此证明所有场景或长期稳定性。
- 完整功能 E2E：新启动与复用各一轮，均通过 Cookie API、真实签名 DesktopHost、持久输入 receipt、Realtime 会话事件、聊天主区域回复渲染、原生文件读写/越界拒绝、真实 PTY 命令与 cwd、嵌入浏览器实际加载和关闭。
- 回归测试：桌面 34 文件/322 项；启动与恢复页 2 文件/18 项；Gateway 认证/兼容/Realtime/lazy-bundle 4 文件/67 项；Endpoint WS 集成 1 文件/2 项；现有 Bridge 与远程暴露约束 2 文件/7 项。合计 416 项通过。
- 根项目及 Electron 类型检查通过；Electron 构建通过，Node/Web 构建产物用于两阶段相同的 Gateway/UI。`git diff --check` 通过。

## 本次 review 修复与新增验证

- 重启流程以连接 epoch 和内嵌 runtime 快照校验管理权限；每次异步边界后复核，连接已替换时停止旧重启流程。并发重启直接拒绝，失败后释放重启锁。
- 重启时复用正常启动的认证/兼容性与端口检查。保存的新端口已有兼容服务时复用并标为 external-local，不启动第二个进程，也不接管其停止权。
- 强制停止后仍无法确认退出时，报错并保留自有进程句柄供后续清理；重启不会继续把未确认停止的进程当作外部服务。
- E2E 去除继承的产品路径、凭据与运行时注入；使用独占布局锁、验证已有链接、异步超时、有限诊断和受控失败清理。测试开始/结束校验 Electron 完整构建摘要，报告显式标记 dirty worktree 和 artifact source ref。
- 最终功能 E2E 除原路径外，还验证自有服务重启后的聊天持久化/Host 重连，以及外部服务重启被拒绝后仍然可用。
- review 回归：桌面 325 项、脚本支持 7 项、Gateway HTTP 67 项、启动/Bridge/远程暴露约束 25 项、Endpoint WS 集成 2 项，合计 426 项通过。类型检查、Electron 构建、完整 lint 与 depcheck 均通过；lint 有 5 条既有警告且配置仍不覆盖 Electron TS。

性能方面，两次使用原 P0 参考值的 review 复测都出现 sessions API P95 边缘超标：25.4ms 和 25.0ms，上限 24.7ms，其他 7 项通过。保留完整失败记录，不能把先前 P1 的 8/8 通过当成最终版本的无条件稳定性结论。原 P0 采用的环境继承规则与隔离修复后的脚本不同，后续使用同一最终隔离脚本对原始代码和最终代码配对测量；相对 5% 与绝对容差保持原值，不删除超标样本，不以复测替代反例。

### 同脚本配对结果（2026-10-31）

从原提交 `f362d177861508aac0e6785ddc5afda3c94bf656` 导出独立的临时源码副本，构建原始 Electron main/preload；未改动当前 worktree 的候选源码和构建。两边共享未修改的 Gateway/Web dist 与依赖，用同一份最终隔离脚本、同一运行时、相同采样数串行测量。原始 Electron 源码与 git 对象逐文件校验，构建摘要见 manifest。容差公式仍为 `max(5%, 原绝对容差)`。

两组各 60/60 通过，配对的 8/8 指标通过。sessions 的 spawn P95 两边均为 24.6ms；原始版本 reuse P95 为 19.0ms，而旧批次曾为 3.8ms，说明跨批次波动必须保留在结论中。该结果支持当前同条件下未发现超预算退化，不能证明前两次超标只是环境原因，也不能抹去旧参考下的失败或保证长期稳定性。

| 模式 | 指标 | 同脚本原始版本 | 最终版本 | 原公式允许上限 | 结果 |
| --- | --- | --- | --- | --- | --- |
| spawn | readyMs P95 | 1914.90 ms | 1905.08 ms | 2014.90 ms | 通过 |
| spawn | configMs P95 | 45.80 ms | 48.20 ms | 50.80 ms | 通过 |
| spawn | sessionsMs P95 | 24.60 ms | 24.60 ms | 29.60 ms | 通过 |
| spawn | rssMiB P95 | 1018.16 MiB | 1018.45 MiB | 1069.06 MiB | 通过 |
| reuse | readyMs P95 | 903.00 ms | 906.05 ms | 1003.00 ms | 通过 |
| reuse | configMs P95 | 59.00 ms | 61.20 ms | 64.00 ms | 通过 |
| reuse | sessionsMs P95 | 19.00 ms | 2.30 ms | 24.00 ms | 通过 |
| reuse | rssMiB P95 | 678.83 MiB | 678.59 MiB | 712.77 MiB | 通过 |

复跑可将原提交的独立构建根目录传入 `--artifact-root <baseline-root> --artifact-source-ref <commit>`，在默认候选 worktree 上用 `--compare <new-baseline-report>` 比较。根目录需包含对应 src/SQL 资源、out/main/preload 和 dist；dev 布局映射、共享 runner 锁与构建一致性校验仍然生效。Windows 的进程树验收独立实现，当前 runner 在 Windows 上显式拒绝运行；需要特权的符号链接单测在那里跳过。

## P1 变更

1. 新增 `electron/gateway/local-connection.ts`：仅支持本地 mode 的连接描述、origin、管理归属、epoch，以及不含凭据的不可变元数据。保留旧 `{port,token}` 调用接口，返回凭据副本。
2. Gateway 进程模块登记 embedded/external-local 归属；重新登记外部连接时清除旧 embedded 重启权限。真正的停止权仍依赖自己持有的 ChildProcess，元数据不会授予杀进程权力。
3. 启动探测、兼容检查、主窗口 URL、DesktopHost、文件、终端和退出影响查询复用本地 origin 构造。URL 仍为原 loopback 地址，没有改认证、协议、超时、权限或数据库。
4. 加入连接边界与所有权测试。将既有但未纳入桌面项目的 terminal-ipc/quit-impact 测试接入，避免实际修改的调用方漏测。
5. 新增可复跑的真实 Electron 测量/E2E 脚本及确定性推理 fixture，新增 `test:electron:local-connection` 命令。

没有新增 Shell Server、远程 profile/认证/执行、UI Cookie 替换、数据库迁移或工作区同步。后续远程仍按 P2a 只读、P2b 可靠执行与独立认证的门槛推进。

## 初次性能对比（历史数据）

新启动包含 Electron 进程树与其 Gateway；复用模式的资源快照只包含 Electron 进程树，独立 Gateway 不在该树中，两种模式不可直接比较 RSS。P95 预算为基线加 `max(5%, 已冻结绝对容差)`；绝对容差分别为启动 100ms、接口 5ms、RSS 32MiB。

| 模式 | 指标 | P0 | P1 | 允许上限 | 结果 |
| --- | --- | --- | --- | --- | --- |
| spawn | readyMs P95 | 2166.95 ms | 1997.45 ms | 2275.29 ms | 通过 |
| spawn | configMs P95 | 48.30 ms | 47.10 ms | 53.30 ms | 通过 |
| spawn | sessionsMs P95 | 19.70 ms | 20.10 ms | 24.70 ms | 通过 |
| spawn | rssMiB P95 | 1023.61 MiB | 1025.09 MiB | 1074.79 MiB | 通过 |
| reuse | readyMs P95 | 1034.61 ms | 913.84 ms | 1134.61 ms | 通过 |
| reuse | configMs P95 | 67.00 ms | 59.80 ms | 72.00 ms | 通过 |
| reuse | sessionsMs P95 | 3.80 ms | 2.70 ms | 8.80 ms | 通过 |
| reuse | rssMiB P95 | 689.31 MiB | 677.16 MiB | 723.78 MiB | 通过 |

CPU 只采集快照，未完成稳态 CPU/长期泄漏验证。机器存在其他开发活动，非严格隔离的性能实验；保留所有正式测量样本，不能把耗时下降归因于本次抽象带来优化。

## 测试条件与限制

- 主机 macOS arm64，系统内核 `25.6.0`，控制脚本与复用 Gateway 使用 Node `26.12.1`；Electron `45.0.0` 内嵌 Node `24.22.0`，其自启动 Gateway 继承该运行时。两阶段保持同样组合。内嵌 Node 与项目引擎要求的长期适配需单独核实，本轮不升级运行时。
- 使用真实生产 main/preload 构建，但运行于开发 Electron，不是签名安装包。基线原报告的 artifactSha256 是入口文件摘要；P1 另存 main/preload 完整文件清单摘要，不能把入口摘要误认为全包摘要。
- 所有 state/userData/workspace/端口/token 均为隔离 fixture，未访问日常 `~/.xopc`，未更改日常 Gateway 或系统权限。功能测试只在临时授权工作区操作；模型响应由本地确定性 SSE fixture 提供，实际 Agent/SQLite/UI/IPC/WS/PTY 未替换。
- 本轮未执行有真实桌面副作用的键鼠控制、系统权限授予、语音/OAuth、真实外部推理、Windows、24/72 小时持续运行或一周灰度。
- 独立 Gateway 复用 E2E 验证已有本机客户端/服务端边界；Bridge 测试覆盖监听 HTTP/WS 的认证签名调用。没有实际 VPS、HTTPS/SSH 网络或新远程 Electron 功能的验收，不能声明远端桌面已可用。
- ESLint 当前配置不覆盖这些 Electron TS 文件，执行会给出 ignored 警告；未把它计为有效 lint 通过，使用类型检查、实际构建、回归和 E2E 作为本轮证据。

## 预跑发现及未掩盖的问题

完整 Electron 预跑发现既有非打包构建的两项资源布局约束：SQLite schema 默认定位到 split chunk 目录、开发 CLI 从 split chunk 计算为 `out/dist`。测试脚本分别指定仓库 schema 资源目录、创建 ignored `out/dist -> ../dist` 测试链接并在结束后清理；没有修改产品路径代码。由此测量的是带明确测试资源布局的构建，不能视为无辅助的安装包启动通过。这两项需要后续独立开发/打包布局验收。

功能脚本预跑还修正了过时 runId 假设、订阅 topic、过早检查推理请求和首次引导遮罩处理；最终使用当前 receipt/会话事件与正常跳过按钮，且在聊天 main 区域断言回复。早期失败保留在 ignored reports 中，未将其当作通过样本；正式 P0/P1 各 60 次的完整记录分别保留，没有删除正式失败样本。测试失败时只回收本测试实例及其子进程，独立复用服务单独清理。

## 复跑与证据

准备：`pnpm install --frozen-lockfile`、`pnpm run build:node`、`pnpm run build:web`、`pnpm run electron:vite:build:package`。不得让两份测量脚本在同一 worktree 同时运行。

```bash
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --output reports/p0-local-baseline.json
# 在实现改动并重新构建 Electron 后执行：
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --compare reports/p0-local-baseline.json --output reports/p1-local-comparison.json
node scripts/verify-electron-local-connection.mjs --runs 1 --operations 100 --functional --output reports/p1-functional-final.json
```

首条基线命令应在对应基线提交运行；在改动后的代码上重新执行会产生新的基线，不能冒充本报告 P0。

- [P0 原始测量](./evidence/electron-connection-p0-p1/p0-local-baseline.json)
- [P1 原始测量与比较门槛](./evidence/electron-connection-p0-p1/p1-local-comparison.json)
- [最终功能 E2E](./evidence/electron-connection-p0-p1/p1-functional-final.json)
- [P1 构建与运行时代码摘要](./evidence/electron-connection-p0-p1/p1-build-manifest.json)

回退本轮 P1 连接抽象不需要数据库降级；临时测量状态在脚本退出时清理。完整产品回退、安装包与跨平台测试仍按主方案门槛执行。

## Review 证据索引

- [最终 E2E（含重启与外部服务保护）](./evidence/electron-connection-p0-p1/review-functional.json)
- [同脚本原始版本](./evidence/electron-connection-p0-p1/review-paired-p0.json)
- [同脚本最终版本与比较](./evidence/electron-connection-p0-p1/review-paired-p1.json)
- [旧参考第 1 次超标记录](./evidence/electron-connection-p0-p1/review-performance-legacy-1.json)
- [旧参考第 2 次超标记录](./evidence/electron-connection-p0-p1/review-performance-legacy-2.json)
- [Review 验证摘要](./evidence/electron-connection-p0-p1/review-validation.json)

JSON 的 samples 仅压缩排版，每个样本保留全部数值与状态。原始 P0/P1 文件是初次阶段历史，最终 review 以本索引、当前构建 manifest 和覆盖限制共同解释。
