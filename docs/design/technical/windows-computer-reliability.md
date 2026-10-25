# Windows Computer Use：故障注入、应用矩阵与耗时

日期：2026-10-25。环境：Windows x64 build `10.0.26200`，Cua Driver / SDK `0.36.0`。

## 结果与修复

本轮使用真实 Windows 驱动、生产 `DesktopEndpointHost`、Gateway HTTP 与 WebSocket。输入由固定测试步骤产生，没有调用模型，没有更改 CI 工作流、打包器、签名要求或发布流程。

真实网络故障用例通过：

1. 原生文字输入完成后，代理丢弃结果并断开连接。应用自身确认文字已经写入；桌面端只派发一次输入，重连后不重放。
2. 终止当前私有 Cua 守护进程。下一次观察失败即撤销旧授权，旧会话不能继续输入；确认停止后可建立新会话。
3. 隐藏测试用本地控制界面。旧授权立即失效，恢复显示不会恢复旧动作。
4. 硬退出测试 Gateway 进程，再打开同一隔离数据库。桌面端自动重连，设备 principal 保留，旧动作没有重放。

修复了两个生产问题：

- 原生观察失败，以及输入前复查失败时，原先可能仍保留 ready 状态或旧观察。现在会撤销旧授权并停止驱动；已经完成输入、仅后续观察失败时，仍保留 completed 回执，避免重放。
- RPC shutdown 没有返回时，原先可能永远到不了宿主进程清理。现在 RPC 清理有 750 ms 等待预算，宿主停止及启动回收分别有 3 s 预算。宿主停止失败不会伪装成功：保留宿主引用、隔离驱动，明确返回 `COMPUTER_DRIVER_CLEANUP_UNCONFIRMED`；只有显式清理成功后才允许再启动。异步掉线、隐藏界面等路径会处理清理失败，避免未捕获的 Promise 拒绝。

模拟故障补充覆盖 shutdown 永不返回、宿主停止永不返回、宿主停止拒绝、原生对象销毁抛错、清理失败后重开、观察失败、输入前复查崩溃，以及后台清理错误处理。相关回归 **480 项通过、9 项跳过**；根项目类型检查与 Electron main/preload 构建通过。

## 应用矩阵

| 应用/框架 | 结果 | 独立验证与边界 |
|---|---|---|
| WinForms 原生样例 | 连续 3 轮通过 | 应用自身读取文字、End 键事件、Verify 次数；密码框和只读框保持原状 |
| WPF 原生样例 | 显式准备窗口后连续 3 轮通过 | 同样使用应用自身状态；后台焦点点击路径未认证，不能据此声称所有后台操作可用 |
| Windows Calculator | 通过 | 原生显示为 42；5 次原生按钮操作，重复 actionId 不再执行 |
| Windows Notepad | **能力受限** | 文字和 End 的派发收到完成回执；后台 Ctrl+S 被拒绝，控制停止、没有重放、未验证保存成功 |

WPF 和 WinForms 是受控框架样例，Calculator 和 Notepad 是实际系统应用，不把它们统一宣称为广泛第三方兼容性。

Notepad 最初还出现过输入前观察变化。测试支持最多两次重新观察，但只在 `COMPUTER_OBSERVATION_CHANGED` 且没有输入回执时重新定位当前目标，并使用新的动作 ID；不是重用旧坐标。原生键盘拒绝或任何未知派发不进入该分支。生产 Runtime 原有的观察变化恢复预算保持不变。

Notepad 的 `Ctrl+S` 限制没有通过全局键盘注入或自动切换前台绕过。已补上明确的恢复提示：在本地检查并手动完成按键操作，不重放原动作。本轮未完成 Notepad 后台保存能力的认证。

## 分阶段耗时

以实际执行的 Driver 方法计时，P50/P95 使用 nearest-rank，保留样本数与失败次数。下面是一次批次的观察调用统计：

| 应用 | 观察样本 | P50 | P95 | 观察占矩阵总耗时 |
|---|---:|---:|---:|---:|
| WinForms 样例 | 72 | 854 ms | 873 ms | 82.0% |
| WPF 样例 | 72 | 760 ms | 780 ms | 77.6% |
| Calculator | 16 | 897 ms | 952 ms | 55.7% |
| Notepad 受限用例 | 22 | 905 ms | 923 ms | 73.6% |

WinForms 三轮分别约 23.3 / 23.9 / 23.9 秒，WPF 三轮约 21.5 / 21.2 / 22.9 秒。包含显式取证、全状态稳定采样、派发前复查和派发后观察，因此不是用户任务延迟基准。生产 `run` 已经复用近期的派发后观察，本轮没有把矩阵中的额外观察开销算作生产性能退化。

网络故障批次的停止调用 P50 为 481 ms、P95 为 3020 ms，共 16 个样本，包含故障清理。SDK 启动、原生查询、截图和 UIA 读取仍包含在 Driver 对应方法中；当前数据不能进一步证明某个子步骤占了多少时间。开发用 tsx Gateway 冷启动也不等于打包 Gateway 启动时延。

下一步性能优化应先细分观察内部的身份检查、UIA 元数据读取、截图和编码，再考虑复用只读辅助进程；每次输入前的 PID/HWND、原生身份、焦点、密码/只读状态及完整状态复查必须保留。不通过缓存旧授权或放宽像素比较来换取速度。

## 复现与证据

```powershell
node scripts/setup-computer-driver.mjs
node --import tsx scripts/run-windows-reliability-validation.mts
# 可分开运行，减少排查某类问题时的启动成本
node --import tsx scripts/run-windows-reliability-validation.mts --network-only
node --import tsx scripts/run-windows-reliability-validation.mts --matrix-only
node --import tsx scripts/run-windows-reliability-validation.mts --matrix-only --app=notepad
```

需要登录的 Windows x64 交互桌面。脚本只操作自行创建的原生样例和临时 Notepad 文档；若已有 Calculator/Notepad 窗口，会跳过对应系统应用。Calculator 测试窗口会保留，已有窗口不会被清空。临时样例会关闭；现代 Notepad 可能把文档交给另一 PID，清理辅助脚本只关闭命令行会话中包含本次唯一临时文档路径的进程。

配置、数据库、应用状态和原始计时位于 `.cache/windows-reliability-<uuid>/`。测试截图只在内存及真实上传链路中使用，不写入持久证据。脱敏汇总包含实际执行 bundle 和结果文件的 SHA-256：[故障、矩阵与耗时证据](./evidence/windows-computer-reliability-2026-10-25.json)。

尚未覆盖长时间浸泡、混合 DPI、多显示器、锁屏/RDP、提权窗口及所有第三方应用。本轮也不重新认证模型、安装包或签名升级链路；这些范围保留原有的独立验证记录。
