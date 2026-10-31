# S4 证据索引

后续完整方案授权及新一批构建隔离、安装包回归、失败和性能对照见[继续开发记录](./continuation-20261031/README.md)。旧批次清单与结果保留。

本目录保留2026-10-31的构建、功能、失败、对照及原预算结果。汇总见 [validation.json](./validation.json)，阶段解释见 [S4记录](../../electron-gateway-s4-report.md)。**不是完整S4/P2a-1验收通过声明。**

## 当前候选与通过项

普通候选是 Developer ID 签名的 macOS arm64 DMG/ZIP；公证未完成。应用逐文件摘要 `887d7aa714f198eb9648912bf86654e0c9e8c0d50a048993612a444c9b4da18c`，相关 E2E 前后相同。安装介质另存工作区 `reports/s4-delivery/`，不提交二进制。

- `s4-installed-local-candidate-final.json`：普通候选本地新启动/复用、聊天、Cookie、Realtime、文件/边界、PTY、浏览器、重启与退出所有权。
- `s4-fault-ui-local.json`：缺远端页面故障包仍通过上述本地功能；故障包与正常包摘要不同。
- `s4-installed-docker-paced-100.json`：100次输入（5000ms间隔）、分页、停止、gap/45秒半开、丢回执、进程/worker崩溃、A/B隔离、真实本地 relaunch。
- `s4-physical-ssh-actual-history.json` / `s4-physical-tls-actual-2.json`：独立服务器、真实模型、一次POST、重开服务器历史、本机能力封锁与设备列表不变。
- `s4-server-audit-final.json`：独立服务器Node/SQLite/应用schema、完整性、空设备列表及原Gateway健康检查。
- `xopc-s4-related-final.log`：590项 / 64文件通过。其余 final typecheck/lint/depcheck/imports 日志分别保留。
- `xopc-s4-package-candidate.log`：完整包校验；`xopc-s4-signature-candidate.log`：签名校验。原依赖体积预算未提高。

## 失败与限制（不覆盖）

| 文件/前缀 | 含义 |
| --- | --- |
| `s4-local-budget-1/2/3.json` | 原S0预算失败。第1轮存在并行负载；第2/3轮就绪P95超标，均保留 |
| `s4-source-control-full-native.json` | 原main重建的完整资源对照，同样6/8，不能据此排除S4影响或改写原预算 |
| `s4-main-control-full-native.json` | 从asar提取而缺完整项目资源的无效对照，0个有效完成样本，不用于性能结论 |
| `s4-source-control-processes.json` | 原main完整资源运行的只读进程观察，包含原生voice helper |
| `s4-installed-chat-ssh-1/2.json` | 真实包加载asar内远端页面失败，修复前实际证据 |
| `xopc-s4-remote-layout-before.log` | 新资源门禁拒绝旧包的7个缺少解包资源 |
| `s4-installed-chat-ssh-3.json` | 主要远端功能通过，测试末尾误用未认证请求检查本地受保护API而失败，随后修正测试 |
| `s4-installed-local-1/2/3/4/5.json` | 依次保留主进程inspect fuse不兼容、测试轮询/就绪条件、初次引导遮挡等失败；第6轮及最终候选通过 |
| `s4-installed-docker-100-final.json` | 无间隔负载触及身份签名限额并被误报为契约错误；不与正常节奏的100次混算 |
| `xopc-s4-throttle-before.log` / `after.log` | 2项429回归修复前失败、修复后通过，限额/证书/逐请求身份核验未放宽 |
| `s4-installed-docker-tls-100-1.json` | 正式fuse下环境变量自签CA注入不成立，拒绝连接；不关闭证书检查，改用独立服务器有效证书验收 |
| `s4-physical-tls-actual.json` | 临时Nginx准备脚本不兼容服务器Python版本，未正确切换测试入口；后续重试成功并恢复原配置 |
| `s4-native-startup-recovery*.json` | 原生恢复界面可见、选择前无本地初始化；CUA未激活/超时，按钮点击没有计为通过。独立bundleId/ad-hoc仅用于标记故障实例，不代表正式签名包 |
| `xopc-s4-docker-build*.log` | 标准Docker构建准备中的网络/工具链失败。实际验收用text-only bundled fixture，不将其当作标准生产镜像通过 |

最初 `xl.xopc.ai` 的默认SSH账号失败，随后root可登录；用户指定的 `47.253.245.60` 为另一台服务器。前者的Node26下载校验成功但缺libatomic，系统安装尝试退出137、未安装该RPM；后者已有该库，隔离Node26实际运行通过。两个临时目录均已清理。相关早期终端输出在本聊天工具记录中，本目录不伪造不存在的原始日志。

## 复跑

始终为每次运行指定新的输出名，脚本拒绝覆盖已有证据。先完整构建：

```sh
pnpm install --frozen-lockfile
pnpm run electron:build
node scripts/verify-electron-asar-deps.mjs /absolute/path/to/xopc.app
node scripts/build-electron-gateway-fixture.mjs --output reports/unique-fixture-build.json
node scripts/verify-electron-installed-local.mjs --app /absolute/path/to/xopc.app --output reports/unique-local.json
node scripts/verify-electron-remote-chat.mjs --app /absolute/path/to/xopc.app --gateway-container xopc:s4-bundled-gateway --normal-inputs 100 --input-interval-ms 5000 --half-open --output reports/unique-remote.json
node scripts/verify-electron-installed-gateway.mjs --app /absolute/path/to/xopc.app --connection /private/operator-connection.json --output reports/unique-external.json
node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --compare docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-local-baseline.json --output reports/unique-original-budget.json
```

外部配置形状：`{"origin":"https://test-gateway.example","transport":"direct","credentialFile":"/private/temporary-owner-token"}`；SSH为显式HTTP loopback与 `transport:"ssh"`，凭据文件0600。服务器先配置可用实际模型。截图/媒体/工具输出不代替真实模型回复；默认断言消息为 `S4_REMOTE_MODEL_OK`。

Docker fixture是隔离文件系统、无宿主目录挂载的Linux服务端，使用相同Gateway bundle及直接依赖；生命周期脚本禁用，不覆盖服务器原生PTY/Browser或远端Host，不代替物理WAN、标准Docker发布镜像或Windows验收。

原预算复测必须在构建、功能E2E及其他负载结束后单独运行。保留原S0权重/阈值，不删除native helper或移动计时点来取得通过。所有凭据仅临时使用，新归档已脱敏并扫描；旧阶段证据不改写。
