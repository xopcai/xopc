# Computer Use：截图稳定性与真实模型网络验收

日期：2026-10-27。承接 [第一阶段实施与原生基线](computer-use-programmable-ui-validation-2026-10-27.md)。

## 本次实现

继续复用 `CuaComputerDriver → ComputerBroker → DesktopEndpointHost → Gateway endpoint-tools → ComputerRuntime`，主模型脚本仍使用 pi-codemode 的 QuickJS worker，没有另建驱动或执行服务。

截图失败时只重采同一个 PID、进程身份和窗口 ID。最多四次采样，间隔 100/300/900 ms；拒绝已隐藏、离开当前 Space、身份或几何变化的窗口。驱动在失败响应中可以省略 AX 边界：此时使用同一窗口的原生边界固定恢复范围，并在有效帧返回后再次核对 AX 边界。无效像素不会交给模型，输入不会因为重采而重放。执行前的完整像素摘要和目标检查保留；因光标闪烁重采时增加可取消的 100 ms 间隔。新增 capture attempts/invalid/recovered/exhausted 计数。

现场遇到的上游错误包含 ScreenCaptureKit 的 “changed identity while capture was prepared”。这和上游捕获准备过程的窗口身份校验相符，但不足以证明全部故障都源于缓存。保持原有 0.36.0 驱动与 SDK，不通过升级、整屏截图、掩盖光标或取消校验来规避问题。参考 [固定版本的 macOS 捕获源码](https://github.com/trycua/cua/blob/cua-driver-rs-v0.36.0/libs/cua-driver/rust/crates/platform-macos/src/capture.rs)。

真实主模型还暴露了三个集成边界：

- `snapshotId` 是单次 exec 内的状态，不能复制到下一次模型调用。工具说明现在明确要求每个输入脚本先观察，在同一 exec 中使用该快照和 refs；五秒有效期不放宽。
- provider transcript hygiene 会规范化工具调用 ID。临时截图现在先按原始 host ID 投影，再随工具结果一起做规范化，避免原始 ID 与规范化 ID 不匹配而静默丢图。新增包含下划线、短横线 ID 的回归用例，并检查持久消息和调试载荷仍不包含像素。

此外，Node Buffer 的 slice 是共享视图，原生帧清零会连带破坏临时截图。现使用独立 Uint8Array 复制，并用真实 Buffer 源清零回归验证，防止模型收到损坏图片。

脚本错误增加最长 1000 字符的异常信息，帮助主模型修正程序；不输出宿主堆栈。原有权限、动作预算、顺序执行、异常停机和去重路径继续复用。

## 基准方法与边界

临时原生 Cocoa 应用每轮重新启动，字段为空、计数为 0。两种模式做同一任务：字段替换为 `XOPC NETWORK VERIFIED`，Increment 恰好点击一次，检查字段和计数后释放控制。独立 Swift Timer 写应用自身的字段和计数到临时 oracle；判定不能由模型自述或截图变化代替。

主模型为真实 DashScope `qwen3.5-plus`，实际发起推理。GUI 基线运行现有 `planner:gui` 的 `run/step/observe(question)` 路径；其独立 GUI 执行器也配置为同一个模型及 `structured-tools-v1`。候选运行 `planner:agent + exec`，由主模型现场编写程序。比较针对执行架构，不包含更换不同模型权重带来的差异，也不是对 Codex 产品性能的实测。

每轮使用新会话、新应用进程；三组成对交替顺序。脚本不提供完成任务的固定程序。Agent 模式禁止调用 GUI 路径；验收还要求在实际模型 HTTP 请求中看到主模型图片输入。失败结果保留；确认控制已释放后可以继续下一次全新应用进程的独立试验。不确定派发或释放失败则停止整组，不自动重放同一试验。

网络路径复用生产的身份注册、签名 WebSocket hello、一次性 realtime ticket、工具调用及结果、HTTP 截图上传。透明 loopback proxy 只计数，本次不注入故障。无 Bearer 的设备列表请求返回 401，带 Bearer 返回 200。单独的公开输入验收使用实际 `/api/sessions/:conversationId/inputs` 及 input-state 路由；架构成对计时则由测试 IPC 启动真实 embedded turn，以保持两组完全相同的工具集合与提示词。

测试数据、SQLite、模型配置、应用与 Electron userData 均位于新的临时目录。最终验收使用真实 OS keychain 加密身份；早期因系统授权窗口改用临时内存身份的探索数据不混入正式结果。证据文件排除 endpoint claim/token、签名私钥、API key、像素和完整模型响应。Token 记录来自服务端 usage；费用未知，保留 null。`headersMs` 仅表示收到响应头的时间，不能当成完整推理耗时。

## 原生输入稳定性复测

两轮各 30 次 setValue，60/60 通过，零失败。第二轮 186 次截图尝试，未出现无效帧；这组数据证明当前样本内稳定，不能单独证明已覆盖无效帧恢复分支。恢复、缺失 AX 边界、身份/几何变化及取消由回归用例覆盖；网络运行中的真实恢复计数另见证据。

| setValue 分段 | 第一轮 P50 / P95（ms） | 第二轮 P50 / P95（ms） |
| --- | ---: | ---: |
| 原生输入总时长 | 544.8 / 561.7 | 555.2 / 592.5 |
| 身份检查 | 2.2 / 3.3 | 2.5 / 4.3 |
| SDK 调用 | 341.5 / 358.8 | 351.7 / 387.6 |
| 渲染宽限 | 201.1 / 201.3 | 201.3 / 202.3 |

SDK 调用与 200 ms 渲染宽限仍是输入主体。这两轮为进程内 broker 复测，不能当作 Gateway 网络耗时。

## 三组成对结果

以下为完成修复和统一恢复说明后的固定三组；此前探索失败单独保存在证据中，不合并均值。两种模式均 3/3 通过独立 oracle，Agent 每轮均有被模型服务接受的主模型图片请求，且没有调用 GUI 执行器。

| 组 | 原 GUI 模式（s） | 主模型 exec（s） | 耗时降低 |
| --- | ---: | ---: | ---: |
| 1 | 97.112 | 45.046 | 53.6% |
| 2 | 73.840 | 35.694 | 51.7% |
| 3 | 106.853 | 39.567 | 63.0% |
| 平均 | **92.602** | **40.102** | **56.7%** |

| 三轮合计 | 原 GUI 模式 | 主模型 exec |
| --- | ---: | ---: |
| 全部实际模型请求 | 46 | 18 |
| 其中主模型 / GUI 模型 | 27 / 19 | 18 / 0 |
| 主模型有效图片请求 | 0 | 4 |
| 输入 Token | 268,326 | 132,372 |
| 输出 Token | 9,415 | 4,457 |
| HTTP 截图上传 | 26 | 19 |
| WebSocket 工具调用 | 98 | 49 |

Agent 平均约快 2.31 倍；总模型请求减少 60.9%。主要收益来自减少独立 GUI 推理和主模型往返，不是原生输入本身变快。第三轮 GUI 触发了一次 `COMPUTER_UI_UNSTABLE`，随后重新观察并完成任务；这次失败及全部恢复耗时、请求均计入结果。Agent 三轮没有工具失败。

全局 HTTP 计数很重要：会话重开后，最后一份 runtime report 只含新会话。例如第三轮 GUI 实际有 7 次 GUI 请求，而最后 report 记录 5 次。本报告采用整个试验期间实际请求计数，避免遗漏恢复成本。表中 Token 同样来自完整试验的服务端 usage。

三组成对网络共看到 2 次成功 principal 注册请求、1 次 ticket、1 次 WebSocket hello、45 次截图上传和 147 次工具调用，没有注入或观测到结果丢弃。最终 capture 计数为 123 次、无效帧 0、恢复 0、耗尽 0。因而本次正式组未覆盖现场无效帧恢复；不能把 0 次故障写成“所有截图故障已被消除”。

回执中保留的输入时序样本里，GUI / Agent 的截图上传均值分别约 5.2 / 4.8 ms，动作 endpoint 往返均值约 1718 / 1627 ms，后者包含原生检查、输入、渲染及上传。这是本机 loopback 网络，不代表跨主机或 WAN 延迟。GUI 重开前的输入时序可能不在最后 report 内，因此这些局部样本不用于反推整轮的完整阶段占比。

## 公开 Gateway 会话输入验收

通过生产 `POST /api/sessions/:conversationId/inputs` 提交同一原生任务，使用真实 AgentService、会话准备/排队、主模型、computer_use 与桌面 endpoint，不通过测试 IPC 直接执行任务。临时代理工具白名单仅包含 `computer_use` 和 `tool_manual`，独立 oracle 文件不在工具权限内。

结果：提交 HTTP **202**；45 次真实 HTTP input-state 查询后，输入状态为 **completed**；耗时 **45.259 s**；8 次真实主模型请求，其中 1 次包含有效图片，GUI 执行器请求 0。期间桌面网络有 6 次截图上传、16 次工具调用。独立应用读数为精确字段值且计数 1，桌面 session 状态 stopped。生产 OS keychain 身份、签名连接与真实截图链路均参与此次验收；本次结果单独记录，不混入架构成对均值。

## 复现与证据

- 成对：`pnpm exec tsx scripts/benchmark-computer-paired-live.mts 3`。
- 公开输入入口：`XOPC_PAIR_MODE=agent XOPC_PAIR_PUBLIC=1 pnpm exec tsx scripts/benchmark-computer-paired-live.mts 1`。
- 需要 macOS 图形会话、已有原生驱动及权限、`DASHSCOPE_API_KEY`；会启动和关闭临时 Cocoa 应用、连接实际模型并产生真实推理用量。
- 原始元数据、原生 60 次输入时序、正式六轮与探索失败见 [JSON 证据](evidence/computer-use-network-paired-2026-10-27.json)。不发布模型生成的完整程序、模型响应、像素或鉴权信息。

这是一台机器、一个原生 fixture、同一模型的三组成对试验；它验证真实主模型和现有 Gateway 传输上的执行路径及该任务收益，不代表所有业务应用、平台、复杂视觉任务或生产可靠性门槛已经通过。早期缺少主模型图片、损坏图片、遗漏 await、超时及跨模式回退的结果均按失败或不合格探索样本保留。

## 代码验证

最终相关回归 **514 通过、9 跳过**，包括截图、Buffer 独立复制、规范化工具 ID、程序恢复提示及已完成输入证据的保留。Node/Electron 类型检查、基准脚本按各自 Node/Electron 环境类型检查、Node 构建（保留既有输出）、Electron 服务端构建及打包布局的 QuickJS worker smoke 均通过。
