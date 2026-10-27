# 电脑控制预览

通过 macOS 或 Windows x64 桌面应用，让 xopc 读取或操作一个应用窗口。预览功能需要本机应用授权，以及兼容的 GUI 模型或支持图像的主模型，建议从小范围、有人看护的任务开始。

[Windows 稳定性矩阵](https://github.com/xopcai/xopc/blob/main/docs/design/technical/windows-computer-reliability.md) 补充验证了回包丢失、私有驱动崩溃、隐藏控制界面和 Gateway 硬退出，并记录跨应用分阶段耗时。WinForms/WPF 样例与 Calculator 正向通过；Notepad 后台保存组合键仍受限，拒绝后停止，不改用全局输入绕过。CI 构建发布要求保持不变。

Windows 的 [安装后完整验证](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-windows-installed-validation.md) 覆盖正式 NSIS 安装、正常应用与包内 Gateway、认证会话 API、签名桌面 WebSocket、截图上传、真实聊天/GUI 模型、重启和卸载。在没有安装或运行 xopc 的交互账户构建安装包后，可运行 `node --import tsx scripts/run-computer-windows-installed-validation.mts` 复现；Authenticode 签名分发另行验收。

## 主模型可编程 UI 预览

Agent 可以通过 `computer_use` 的 `open` 选择 `planner: "agent"`，再用 `op: "exec"` 执行 UI 专用 JavaScript。此模式使用当前支持图像的主模型，无需另配 GUI 模型。默认 GUI 模式继续使用 `step/run`。每个包含输入的 exec 必须先观察，并在同一次 exec 内使用该快照；不可跨模型调用复制快照 ID。

程序复用现有 broker 和驱动，支持观察控件、精确定位、受保护输入、条件等待与结果验证。同一窗口串行操作；跨调用 JSON 状态只保存在内存，关闭后清理。截图仅注入当前模型请求，不写入会话数据库和诊断日志。无障碍文本和程序源码仍可能出现在普通会话历史中。

首轮 macOS 验证用固定脚本完成了两个真实测试窗口输入；这不代表真实模型任务性能或 Windows 新模式认证。详见[实施与基线记录](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-programmable-ui-validation-2026-10-27.md)。

原生输入诊断新增身份检查、动作校验、SDK 调用、返回校验及渲染等待的分段耗时。SDK 时间包含 RPC 和 OS 工作，不等于纯 OS 输入时间。可显式运行 `pnpm exec tsx scripts/benchmark-computer-input-live.mts 30`，或用 `1 program` 验证可编程链路。macOS 真实模型与网络成对实测使用 `pnpm exec tsx scripts/benchmark-computer-paired-live.mts 3`，需要 `DASHSCOPE_API_KEY`，只发送其临时测试窗口，并产生真实推理用量。详见[验证报告](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-network-paired-validation-2026-10-27.md)。

## Windows x64 预览

Windows 通过与 macOS 相同的本地 Broker 支持窗口观察、原生 UIA 按钮、文字和键盘输入。启用电脑控制，在设置中授权应用并选择兼容模型后，可以从计算器或临时原生文本框开始。部分应用不支持后台输入，对应动作会明确拒绝，不会静默切换到前台操作。

请在当前登录的交互桌面中运行。Session 0 服务、锁屏、UAC 确认及更高权限目标不在本预览的认证范围。Windows 无需设置 macOS 的辅助功能和屏幕录制权限。

文字输入要求当前观察中恰有一个 `inputAllowed: true` 的原生字段。xopc 通过 Windows UIA 补充密码框与只读属性，唯一匹配控件边界，并在真正输入前重新检查控件运行时身份及安全状态。密码框、禁用、屏幕外、只读、存在歧义或无法验证的字段需要手动输入。原生 `setValue` 替换整个字段；Windows ValuePattern 路径上的 `typeText` 追加文字，不假定插入光标位置。网页内容字段继续优先使用已有的浏览器工具。

键盘输入要求授权窗口内存在已验证的非密码焦点控件，执行前会重新检查焦点，并通过当前原生 token 后台投递。Windows 使用 `ctrl` 而非 `cmd`，Backspace 与 Delete 分开处理；全局及退出窗口的快捷键会被拒绝。部分应用框架不支持后台组合键，会返回明确拒绝；不会改用前台或全局输入重试。拖拽、右键菜单、混合 DPI 和广泛第三方应用兼容性尚未认证；ARM64 与完整签名安装包另行验收。macOS 原有能力保持不变。

开发者可先运行 `node scripts/setup-computer-driver.mjs`，再运行 `pnpm exec tsx scripts/run-computer-windows-validation.mts`。此手动验证会打开 Windows 计算器，清除当前表达式、计算 6 × 7 并验证 42，同时检查重复动作回执和停止行为。需要 Windows x64 交互会话，验证后保留计算器窗口，并将不含窗口内容的证据写入 `.cache/computer-windows-validation/result.json`。此验证不调用模型，也不代表 Gateway 网络链路或安装包已通过认证。

文字与真实模型验证使用 `pnpm exec tsx scripts/run-computer-windows-input-validation.mts [provider/model]`，默认沿用现有 `xopc-cloud/computer`。脚本创建并关闭独立 WinForms 窗口，先验证中文、emoji、多行追加、字段替换、End、Backspace 和密码框／只读拒绝，再让真实模型通过 ComputerRuntime 与本地 Broker 替换已有示例、按 End 并点击 Verify。应用必须同时读到准确文字和键盘事件，才会返回 PASS。GUI-Plus 可使用受控的 `set_value` 原生扩展，提供当前字段 ref 和完整替换文字。仅该临时窗口会发送给模型，调用按现有服务规则计费；凭据保留在原有存储中，会话、配置、数据库和证据隔离在 `.cache/computer-windows-input-validation/<run-id>/`。不伪造模型响应；端点传输使用进程内适配，因此不代表 Gateway 网络、其他应用或安装包已完成认证。

实测版本、模型请求次数与验证边界见 [Windows 输入验证记录](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-windows-input-validation.md)。

## 完成设置

1. 安装包含电脑控制功能的对应平台桌面版本。
2. 打开 **设置 → 集成 → 电脑控制**（`#/settings/computer-use`），启用控制。macOS 还需为 xopc 授予辅助功能和屏幕录制权限。
3. 允许需要使用的应用。建议先逐个授权应用。
4. 从已连接目录选择支持截图输入和工具调用的模型或兼容 GUI 模型并保存。自有密钥先连接对应服务商；使用 XOPC Cloud 时先登录并刷新目录。普通聊天的模型选择不会自动配置电脑控制。
5. 在桌面聊天中说：`读取飞书当前页面，不要点击。` 如果需要启动应用，请明确说：`打开飞书并读取当前页面。`

授权修改前，核对回答对应的应用与窗口。多个窗口或进程匹配时，选择实际目标。

如果返回 `COMPUTER_WINDOW_OTHER_SPACE`，目标窗口与聊天不在同一个 macOS 桌面空间。请退出全屏，或将聊天和目标窗口放在同一桌面并同时保持可见。点一下目标窗口后，再切回另一空间的全屏聊天，会让目标再次不可见；反复前置不能解决这种布局。

## 一次调用完成一个小目标

使用 `computer_use` 的 `run` 操作，提供当前窗口内已授权的小目标，以及可由原生界面验证的完成条件。运行时会连续执行多步，不必每个动作都返回主 Agent：

```json
{
  "op": "run",
  "goal": "在当前测试窗口按顺序点击 Start、Continue、Finish",
  "expect": { "kind": "text", "text": "PASS: Small goal complete" },
  "maxActions": 6
}
```

达到完成条件、模型交接、发生拒绝或触及预算时停止。`maxActions` 默认 6，支持 1–12 次输入，等待也计入预算；已完成动作之间若累计超过 120 秒则返回，现有会话、模型和重规划预算仍生效。`goal_limit` 表示尚未完成，模型自行声称成功也不算验证。目标文本在动作前已存在时，返回 `condition_present` 并停止，不据此声称完成导航。优先选择页面特有内容、字段精确值或选中状态。

动作后的截图只在本次调用内复用，最长五秒。每次输入仍经过本地授权及新的目标、界面状态校验；画面变化时按现有规则重新观察和规划。缓存画面在消费或调用结束时清零，不跨 Agent 轮次保留。同一窗口的输入仍按顺序执行。`step` 保持最多一次输入，`observe` 始终独立重新读取。

支持结构化工具调用的模型可在 `run` 内生成 2–6 步有条件的原生按钮计划。继续本地计划前，执行器最多追加三次动作后观察，直到连续两次状态一致；仍不稳定或观察失败时交接，保留已完成的回执，不重放输入。随后逐步核对完整的预期原生显示值，重新定位按钮的当前引用，然后执行原有的本地授权与执行前目标/状态校验。只有前一步明确完成、动作后状态与当前观察一致时，才继续下一步。控件缺失、重名、禁用、显示值不符、状态变化、只读或退出本次调用都会丢弃计划。计划不包含坐标、按键序列、任意文本输入或历史引用。部分 AX 文本仅用于完整静态文本值的正向匹配，不用于判断内容不存在或全局唯一。不支持该机制的模型继续逐步决策；模型预算按真实请求扣减，包括格式纠正，不按本地计划步骤扣减。

返回的 `run` 元数据包含执行次数、模型请求数、观察复用次数、`stabilityObservations` 稳定性观察次数、耗时、`phaseMs` 分阶段计时、`nativeMs` 原生校验/输入（含渲染等待）/动作后观察计时，以及停止原因。验证只覆盖指定条件，不证明无关业务结果。实测数据及范围见[计算器验证记录](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-small-goal-validation.md)。

## 自定义 OpenAI 兼容模型

自定义服务商使用 `openai-completions` 或 `openai-responses`，且模型配置包含 `input: ["text", "image"]` 时，会自动出现在电脑控制选择列表中，不限制服务商名称或模型型号。调用使用标准函数工具，由本地电脑控制服务校验并执行动作。模型仍可用于普通聊天和视觉识别。

OpenAI 兼容接口默认按支持函数工具处理；可以在 `models.json` 的模型定义或 `modelOverrides` 中设置 `supportsTools: false`，排除不支持工具调用的模型，也可以设置 `supportsTools: true` 显式声明支持。请确认服务实际支持图片和函数工具；列表展示不代表已经通过远端调用验证。电脑控制模型连接目前要求 HTTPS。

`computerUse.profile` 的显式配置仍优先。`openai-responses-computer-v1` 仅用于服务端确实支持原生 `computer` 工具的模型；普通视觉模型自动使用 `structured-tools-v1`，按所配置的 API 调用函数工具，无需原生 `computer` 支持。

在 xopc 的 OpenAI 服务商中通过 ChatGPT OAuth 登录，也可复用该绑定进行电脑控制。已用 `openai/gpt-6.1-sol` 完成真实截图识别和临时原生测试窗口按钮点击；详见[OAuth 实测记录](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-chatgpt-oauth-validation.md)。这不代表目录中每个模型都已经实测。

## 描述任务

说明应用、预期结果以及是否允许修改。只读请求不允许点击或输入。操作任务应给出可观察的完成条件，例如保存后的标题，并亲自检查应用最终状态。

视觉判断所需截图可能发送给选定的云端模型。截图临时使用，不建立桌面截图历史库。请避免在目标窗口展示无关敏感内容。

密码、验证码、支付和安全设置需要手动处理。终端和密码管理器不能作为控制目标。此预览尚未通过无人值守工作认证。

## 故障恢复

只有桌面明确确认“界面在派发输入前发生变化”、且没有执行回执时，运行时才会丢弃提案，重新观察和规划。`computer.maxRescuesPerSession` 是整个会话共享的救援上限，默认 1 次，允许 0–3 次，0 表示禁用。提高上限需要新建会话，降低立即生效。救援保留原目标、应用窗口、模型和本地授权检查；执行结果不确定、原生操作失败或截图未变化都不会触发自动重试。详见[有限救援边界](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-bounded-rescue.md)。

| 现象 | 处理 |
| --- | --- |
| 找不到模型 | 登录或重新连接服务商，刷新模型目录并选择兼容 GUI 模型 |
| 无法读取或控制窗口 | 检查 macOS 权限和应用允许列表 |
| 多个窗口匹配 | 选择或只保留需要操作的目标 |
| 桌面与 Gateway 不兼容 | 两端更新到同一构建并重启；停止独立运行的不兼容 Gateway |
| 桌面设备被撤销 | 点击重新注册桌面设备并在系统弹窗批准；应用控制权限仍需单独授予 |
| 模型或截图上传失败 | 保留诊断编号或请求编号，查看日志，修复原因后再试 |
| 操作可能已经生效 | 先检查应用再决定是否重复；结果不确定的操作不会自动重放 |

模型表示结束不等于文件保存或远端操作成功，应核对真实结果。切换到其它浏览器或应用工具前，先停止电脑控制。

只操作网站见[浏览器自动化](./browser-automations.md)；模型连接见[模型与服务商](./models.md)。

## 沉淀和复用已验证导航

可以让 xopc 记住已验证的原生导航流程，例如打开某个有唯一名称的标签页。保存是显式操作：`computer_use` 在 `close` 时传入 `saveFlowAs`，先确认释放桌面控制，再保存完整的原生激活／上下文菜单步骤；最后一步必须有原生选中状态或具体页面内容的正向验证。模型说“成功”不够，首版不保存含输入、坐标点击、快捷键、歧义控件、失败、人工接管或不确定执行的流程。

`flows` 列出同一 Agent、工作区中保存的名称和 ID；在 `step` 中提供 `flowId` 与当前任务目标及完成条件即可参考。每一步仍会重新观察、请求当前 GUI 模型规划、绑定新的控件引用，并经过现有本地授权、应用／设备范围和预算检查。历史流程不会自动授予发送、删除等权限，也不会触发不确定动作重试。`forget_flow` 可在本地删除记录。

流程使用现有私有 SQLite 数据库，重启后保留，30 天过期，每个 Agent／工作区最多 32 条。保存内容仅有名称、原生控件角色和标签、动作种类、历史条件、覆盖范围、应用和设备标识，不含截图、输入值、任务目标、坐标或旧元素引用。请使用不含敏感内容的名称和控件。选中条件只证明对应导航条件，不能证明保存、提交等完整业务成功。详见[保存与复用边界](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows.md)。

固定版本的 macOS 驱动无法证明整棵可访问性树完整。此类快照仍标为部分覆盖：只允许保存已观察到的原生控件提示和具体页面内容的正向证据，不据此证明控件不存在、名称唯一或选中状态。控件名称本身及操作前已出现的文字不算保存依据。详见[真实 TextEdit 验证](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows-live-validation.md)。

[真实 GUI-Plus 模型验证](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows-hosted-validation.md)使用实际供应商响应，覆盖保存、独立进程重启后复用、本地授权和丢失回执后不重试。GUI-Plus 的 xopc 提示协议支持用当前 `ref` 显式请求 `activate`／`show_menu`，动作仍需通过现有原生校验与授权；部分覆盖时不会把坐标自动转换为原生动作。

新保存的流程绑定经过认证的持久桌面设备身份，重启后即使网络连接 ID 改变，也可以在重新授权后复用；重新注册成另一设备不能继承该流程。没有设备身份的旧流程仍保留原连接限制。详见[真实 Gateway／桌面网络验证](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows-network-validation.md)。

## 原生文本编辑

原生编辑器在模型决策前进行有上限的稳定观察：最多采集六次，直到目标与完整状态重复出现；两次匹配不必相邻，避免光标闪烁与采样周期重合导致误判。执行前最多重新采样四次，但只有完整目标及未遮盖像素的状态摘要与决策时完全匹配，才会执行输入；持续变化仍按原有救援上限拒绝。通用工具模型的 `typeText` 必须带有落在当前唯一可编辑区域内的坐标，缺失或有歧义的目标在派发前只允许一次格式纠正。文本完成条件可使用窗口内原生编辑框的多行值作为正向证据；部分覆盖不能证明文本不存在、字段全局唯一或整个任务完成。

原生捕获恢复只针对同一进程、同一窗口的无效像素帧：最多捕获三次，每次间隔 100 毫秒并支持取消。身份不匹配或持续无效仍停止控制，不重放先前输入。SDK 的键盘和滚动错误返回会按拒绝处理，不再计为已完成输入。
