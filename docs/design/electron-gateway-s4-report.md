# S4 真实产物与 E2E 阶段记录

日期：2026-10-31。基于已合并 PR #41 的 `main@c8da81aa0280a3a45041bfbfa39c2f389d98b965`，新 worktree `gateway-p2a1-s4/xopc`、分支 `codex/gateway-p2a1-s4`。

后续更新：用户已授权完整方案。最新批次见[继续开发记录](./evidence/electron-gateway-s4/continuation-20261031/README.md)：新版包本地/远端fixture回归通过，原预算及原生恢复点击仍未验收。下文保留原批次结果，不混算新旧包；后续范围见[实施进度](./electron-gateway-execution-progress.md)。

**状态：主要功能和 macOS 安装包链路已验证，S4 尚未整体验收。原本地就绪预算仍有失败，原生恢复按钮点击 E2E、Windows 与正式公证渠道验证仍未完成。** 不推进 S5 或远端 Host/本机能力。

## 已实施的边界

范围和接口先冻结于 [S4 契约](./electron-gateway-s4-contract.md)。继续复用 S3 REST、receipt/run 和 Realtime，不新增 Gateway 路由、Endpoint、设备凭据或数据库迁移。本地 `main.ts`、Gateway 进程监督和原性能采样器源码未修改。

| 模块 | 交付 |
| --- | --- |
| 打包 staging / asar 检查 | 同时检查本地 SPA、远端页面/preload、Shell worker、所有运行 chunks、Gateway workers 与完整 SQL；逐字节对照构建产物及 canonical SQL，不仅检查文件存在。保留原 125 MiB 依赖体积上限 |
| 远端资源定位 | 真实包保留禁用 file 协议额外权限的 fuse；将远端的7个页面/preload资源解包到真实文件目录，并在远端入口定位。修复“asar 内存在但 file:// 无法加载”的实际故障 |
| 远端启动失败恢复 | 独立本机原生对话框，不依赖远端页面/preload/凭据；由用户明确选择重新启动到本地或退出，取消不自动切换 |
| Shell / 聊天限流 | 身份预检429返回可恢复的 `SHELL_UPSTREAM_THROTTLED`，不误报契约错误并撤销会话；提交前限流保留草稿，不自动POST。原签名/API限额、逐请求身份核验及证书校验不变 |
| 安装包测试工具 | Renderer CDP 驱动真实可执行文件，保留禁用主进程 Node inspection 的 fuse；无开发 out/dist 链接或客户端资源根注入。记录整体应用摘要与资源路径 |
| 服务端测试 | 可重建的 Linux text-only bundled Gateway Docker fixture；另在用户指定的独立服务器部署隔离实例，使用真实证书及实际模型 |

正式包依赖检查为 58.25 MiB；367 项必需资源及659个实际运行文件通过检查。缺远端文件、缺 lazy chunk、SQL 内容不匹配、错误 UI 入口均受资源门禁约束。

## 测试与产物

- 最终相关回归：**590 项 / 64 文件通过**；类型检查通过；Lint 为0 errors / 5项既有 warnings；依赖检查0 violations；CLI import guard通过。
- 完整 Node/Web/main/preload/native/Gateway/extensions 构建及 DMG/ZIP 生成通过。普通候选包通过 Developer ID 签名验证；公证因缺认证配置被跳过，不能记为正式分发渠道通过。
- 从 DMG 挂载复制到仓库外干净目录运行。客户端清除开发 URL、SQL/UI/template 等资源映射及 NODE_OPTIONS，实际资源来自包内；原生 helper 使用包内资源。
- 最终正常应用摘要：`887d7aa714f198eb9648912bf86654e0c9e8c0d50a048993612a444c9b4da18c`，1422个文件；相关 E2E 前后摘要相同。故障包独立标记，不与正常候选包混算。

| 验证 | 结果 / 证据 |
| --- | --- |
| 正常安装包本地 spawn/reuse | 聊天、Cookie API、Realtime、文件读写/越界拒绝、PTY、浏览器、自有重启、退出和复用服务所有权通过；`s4-installed-local-candidate-final.json` |
| 缺远端 HTML 故障包本地 spawn/reuse | 同样完整功能通过，损坏的远端 profile 不被本地读取/迁移；`s4-fault-ui-local.json` |
| 安装包 → Docker Gateway | 100次正常输入、历史分页、停止核实、断线/gap、45秒半开、丢回执、进程/worker重启、A/B隔离与真实本地 relaunch通过；`s4-installed-docker-paced-100.json` |
| 安装包 → 独立服务器 SSH | 实际 Agent + DeepSeek 模型、receipt、重开历史且只提交一次、本机能力封锁/无设备登记、无客户端数据库/工作区、清理通过；`s4-physical-ssh-actual-history.json` |
| 安装包 → 独立服务器 HTTPS/WSS | 使用有效公共证书，实际模型和同样的历史/隔离检查通过；`s4-physical-tls-actual-2.json` |
| 独立服务器数据归属 | Node26.12.1 / Linux x64 / SQLite3.54.0，应用 schema262、integrity_check=ok、设备列表为空；`s4-server-audit-final.json`。SQLite user_version=0 不是项目 schema 版本 |
| 原生恢复 | 3项逻辑回归通过，故障包实际显示对话框且选择前无本地初始化；CUA点击被驱动拒绝，实际按钮点击/返回本地未通过验收，保留失败 |

正常100次输入按测量前记录的5000ms间隔运行，每次仍受原30秒断言期限约束，原限额不变。此前无间隔100次负载在第27次触发限额，其失败单独保留；不与正常节奏混算，不声称100次无间隔输入均成功。两项429回归先失败、修复后通过。

独立服务器为用户指定的 `47.253.245.60`，与最初 `xl.xopc.ai` 的解析目标不同。测试使用该服务器已有有效证书的 `tg.xopc.ai`。19443公网不可达时，在用户明确授权后临时修改测试域名的 Nginx 转发以完成443验证；测试后恢复字节摘要 `077b3843cf9887f6960df1348d88d39a8de34af2ceac73694d7860d2120455db`，停止隔离进程并删除临时凭据/目录，原18790 Gateway仍为原PID且健康。真实模型使用用户授权的 DeepSeek 凭据；未写入仓库或证据。当前模型目录返回 `deepseek-flash`，测试配置复用已有 deepseek compatibility 的关闭思考行为，参见[官方模式说明](https://api-docs.deepseek.com/guides/thinking_mode/)。

## 原预算：仍为阻断项

保留 S0 文件及 SHA-256 `e752bb4b97f54e4713d8ecc8b6f8cd302d3e80d044099b0397dfe113d0f45746`，采样器、first-launch-heavy-v1权重、每模式30次及每API129样本、阈值、计时窗口均未变。未删除 native helper 或加计时前等待来通过预算。

| 完整运行 | 结果 |
| --- | --- |
| 第1轮 | 7/8；reuse RSS P95=721.41 MiB，上限719.53；存在并行打包/测试干扰，保留为失败，不作最终接受依据 |
| 候选第2轮 | 6/8；spawn ready=2341.48ms、reuse ready=1343.92ms，均超原上限；API/RSS通过 |
| 原 main 重建对照 | 6/8；spawn ready=2151.63ms、reuse ready=1137.67ms，同样超原上限；API/RSS通过 |
| 候选第3轮 | 6/8；spawn ready=2188.73ms、reuse ready=1365.85ms，仍超原上限；API/RSS通过 |

原就绪上限仍为 spawn **2140.48ms**、reuse **1102.21ms**。原 main 对照由 Git archive 重建，main/preload 摘要与已验收 S3 的 `b339d7c…` / `aa655f9…` 完全一致，与候选使用相同完整 dist/native 和依赖。历史样本进程数为5/4，完整资源下两个版本均为6/5；实测新增子进程为原生 `voice-hotkey-helper`。此前只从 asar 提取而缺完整项目资源的对照没有就绪，属于无效对照准备，另存失败。

上述结果证实了历史/完整产物的环境差异，**尚未充分分离原生 helper、环境波动与 S4 构建拆分的启动影响，不能据此认定候选无启动劣化，更不能覆盖原预算失败。** 后续需在保持完整本地功能的条件下完成因果归因和实质修复；在原门槛通过前，S4不能关闭。

## 证据与未完成项

原始测试/构建/性能/错误日志与全部阶段报告位于 [S4证据目录](./evidence/electron-gateway-s4/README.md)。历史 S0/S1、S2、S3和PR41证据未修改；只对新归档进行凭据脱敏。

S4仍缺：本地原就绪预算闭环、原生恢复按钮实际点击E2E、Windows及其他声明平台实际包、正式公证/渠道策略，以及完整A01–A10各环境组合。安装包性能也不能用开发 Electron 数据冒充。S5的24小时、100次连接循环、完整故障网络矩阵及升级/回退均未开展；这些证据不能替代完整P2a-1发布验收。

可复跑命令及失败分类见证据 README。测试交付包保存在本机 `reports/s4-delivery/`（不提交二进制）；运行路径、摘要、服务器差异和回收记录保留在JSON中。
