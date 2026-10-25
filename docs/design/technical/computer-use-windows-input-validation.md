# Windows Computer Use：文字、键盘与真实模型验证

日期：2026-10-25。状态：本地 Windows x64 实测通过，范围限定于下述原生测试应用。

## 验证结果

环境为 Windows build `10.0.26200`、x64、Electron `45.0.0`、Cua Driver / SDK `0.36.0`。沿用已连接的 `xopc-cloud/computer`（GUI-Plus profile），不切换服务商，不伪造模型回复。

最终验证使用 **4 次真实模型请求、3 次实际输入**：

1. 模型通过 `set_value` / 当前字段 ref，把已有示例替换为 `Windows 输入验证 OK`。
2. 模型提出 End 键，由 Broker 将键盘事件投递至已验证的 Message 控件。应用的 KeyUp 事件记录 `End`，并在窗口显示该结果。
3. 模型点击 Verify 一次。应用自行读取文本、键盘事件与点击计数，全部匹配才显示 `PASS: Windows input verified`。

一次模型格式纠正没有下发输入。报告记录零未知派发、零救援重试、一个已验证条件；结束后控制已释放。最终结果来自原生应用状态，不以模型的完成声明或驱动成功回包代替验证。

原生前置测试还验证了字段替换、中文与 emoji、多行追加、End、Backspace、密码框与只读字段拒绝写入，以及重复动作返回原回执而不再次输入。

完整测试耗时约 92.6 秒，其中真实模型任务约 45.6 秒；这是一次完整性验证的实测，不是跨应用性能基准。

证据：[脱敏 JSON 报告](./evidence/computer-use-windows-input-2026-10-25.json)。报告包含该次实际执行的打包验证脚本 SHA-256，不包含截图、输入内容、模型回复或凭据。

## 输入边界

- 用 Windows UIA 补充 `IsPassword`、可写状态、可见性、控件运行时身份和窗口内焦点；辅助读取不返回字段值。
- 将 Cua 当前观察中的字段与原生控件边界唯一匹配。兼容 WinForms 多行控件在不同 UIA 代理中呈现为 Edit / Document 的差异。
- 密码、只读、禁用、屏幕外、存在歧义或元数据缺失的字段不允许文字输入；无法验证的字段值不进入结构化文字上下文。截图仍包含授权窗口的可见内容。
- `setValue` 替换字段值，Windows ValuePattern 上的 `typeText` 追加文字；不假定光标插入位置。GUI-Plus 的 `set_value` 扩展要求当前 ref 和完整 text，省去坐标和选择快捷键。
- 键盘输入绑定当前窗口内已验证的焦点控件及其私有 Cua token。实际派发前重查原生身份和安全状态；文字类按键与组合键不能绕过可写字段检查。
- Win / macOS cmd 别名、系统及退出窗口快捷键保持拒绝。投递明确使用后台模式；不支持的后台组合键返回拒绝，不自动切换前台或全局注入。
- 保留原有完整观察摘要与像素摘要比较、应用/窗口授权、单动作回执和未知输入不重放规则。Windows 进程与窗口检查合并重复的只读查询，未省略派发前安全检查。

## 复现

在登录的 Windows x64 交互桌面运行，确保所选模型已经连接：

```powershell
node scripts/setup-computer-driver.mjs
pnpm exec tsx scripts/run-computer-windows-input-validation.mts
```

可在末尾指定另一个已配置的 `provider/model`，不自动回退。默认调用现有 XOPC Cloud Computer，按通常规则产生模型用量。

脚本编译、打开并关闭自己的 WinForms 测试程序。测试配置、SQLite、原生应用状态、验证脚本和结果位于 `.cache/computer-windows-input-validation/<run-id>/`；凭据留在原有存储中。只有临时测试窗口的截图发送给模型。诊断回复文件仅包含该测试的合成内容；截图不写入证据文件。

实现与测试入口：

- [Windows 原生安全元数据](../../../electron/computer/windows-native.ts)
- [字段绑定与脱敏](../../../electron/computer/windows-input.ts)
- [Cua 驱动适配](../../../electron/computer/cua-driver.ts)
- [原生测试应用](../../../scripts/computer-input-fixture.cs)
- [验证启动器](../../../scripts/run-computer-windows-input-validation.mts)
- [真实模型验证](../../../scripts/verify-computer-windows-input.mts)

## 范围与回归

此闭环使用真实模型、ComputerRuntime、真实 Broker / Cua / Windows 和应用自身的状态检查；端点传输使用进程内适配，不代表 Gateway HTTP/realtime 网络或签名安装包已认证。

后续已增加独立的 [Gateway 网络与安装后真实模型验证](./computer-use-windows-installed-validation.md)，沿正式会话 API、生产应用入口和 NSIS 安装流程检查完整链路。签名分发状态单独记录。

本次不扩展为所有 Windows 应用、所有后台组合键、混合 DPI、多会话/RDP、提权目标或 ARM64 的兼容性声明。macOS 路径保留，相关模拟回归通过；本 Windows 环境没有执行 macOS 真机测试。

相关自动化测试共 504 项通过。根项目与 Web 类型检查、Web 与 Electron 主进程/preload 构建通过。
