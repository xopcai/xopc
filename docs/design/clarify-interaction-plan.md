# Clarify 结构化交互与移动端实现

日期：2026-10-15。状态：共享协议、服务端、Web、Android、iOS、鸿蒙已实现。

本文描述保留的 v1 单题与审批行为。多问题 v2 的当前实现与验证见 [Clarify 多问题交互](./clarify-multi-question-design.md)。

## 协议

只提供结构化格式，不转换旧字符串选项、不接受客户端 answer 字段、不使用文字匹配授权。

普通问题：

```json
{
  "kind": "input",
  "question": "部署到哪里？",
  "interactionMode": "compose",
  "choiceDetails": [
    { "id": "stage", "label": "测试环境", "description": "用于验收，不影响线上用户" },
    { "id": "prod", "label": "生产环境", "description": "面向正式用户" }
  ],
  "recommendedChoiceId": "stage"
}
```

回答使用原有 POST /api/clarifications/:id/responses：

```json
{
  "action": "answer",
  "expectedVersion": 1,
  "idempotencyKey": "unique-attempt-id",
  "response": { "choiceId": "prod", "text": "今晚 22 点后执行\n部署前先备份" }
}
```

choiceId 和 text 可独立填写，至少一项有效；自定义文字最多 8,000 个 UTF-16 码元。服务端查找原始选项标题并生成供模型读取的文本，同时保留原始结构。数据库中的 answer 是宿主生成的结果，不是客户端兼容字段。

审批由宿主构造 kind=approval、approval 元数据（operation、target、impact、argumentsPreview）和绑定精确操作的 approvalKey；客户端提交 action=answer + decision=approve/deny。移除 Allow once/Deny 字符串映射以及 approveValue/denyValue。过期审批不得消费，批准仅消费一次。取消任务和让助手决定仍分别使用 action=cancel/agent_decide，审批拒绝 agent_decide。

协议修改要求服务端与各客户端同步更新。本次不重写历史数据或删除用户历史记录。

## 普通澄清交互

- quick：点击选项立即提交。用户输入内容或点击“选择并补充”后，选项只更新选择，统一提交。
- compose：选择、补充、切换或清除选择后再提交；也允许只写自定义答案。
- 推荐只显示标记，不预选或自动发送。选项显示标题和说明，选中状态有明确标记。
- 多行编辑、长度反馈、提交中禁用、失败保留草稿。同一问题刷新保留草稿，新问题隔离状态。
- Web：Enter 换行，Ctrl/Cmd+Enter 提交；输入法组词期间不提交；Esc 不取消整个任务。
- 移动端：键盘回车换行，使用明确提交按钮；卡片内容内部滚动，支持窄屏。

## 审批交互

独立展示操作、目标、影响、脱敏参数、一次性范围和到期状态；用户显式批准或拒绝。不提供自定义答案、推荐或“让助手决定”。客户端错误不会转为默认批准。

## 各端实现

| 端 | 实现 |
|---|---|
| Web / Electron | 主聊天、侧聊、语音使用 ClarifyPrompt；共享结构化响应；Electron 复用 Web |
| Android | 新增 ClarificationRepository 和 ClarificationCard；补普通聊天快照、事件刷新、重进恢复、轮询和提交；语音复用同卡片；切换网关取消请求；重试保留幂等键 |
| iOS | ClarificationModels、GatewayCommands、AssistantState 和语音模型同步协议；聊天和语音共用 ClarificationCard；独立审批、多行编辑、推荐、到期禁用和稳定重试键 |
| 鸿蒙 | 新增 model/clarification.ets 和共享 ClarificationCard；聊天 ViewModel 和语音服务提交同结构，保留重试键并防止旧响应清除新问题 |
| 浏览器扩展 | 同步结构化协议与组合输入；移除自动响应审批，改为显式批准或拒绝 |
| Telegram / CLI / TUI | 同步结构化选项和审批决定；不保留旧字段转换。Telegram 的按钮仍为即时回答，未新增组合草稿；CLI compose 可分步收集补充 |

普通问题使用现有 SQLite data_json 保存新增字段，无需表迁移。主聊天持久化等待与侧聊内存等待各自保留生命周期。GET 快照、流事件、语音事件均透传同样的展示字段。

## 验证

- 核心、Web、流客户端、扩展、侧聊、语音及真实 HTTP Gateway：15 个文件、199 项测试通过。
- 真实浏览器使用生产组件和 Hook，连接鉴权 Gateway、SQLite 和恢复队列，覆盖组合提交、自定义回答、快捷选项、审批，以及服务端收到但客户端丢失响应后的幂等重试。执行宿主由测试控制，未调用外部模型或部署真实服务。
- Android：Debug APK 构建通过；模拟器 7 项测试通过，覆盖组合提交、快捷回答、显式审批、到期禁用及澄清事件刷新。
- iOS：模拟器完整测试套件 102 项通过，包含结构化回答与审批决定编码。
- 鸿蒙：未签名 Debug HAP 构建通过；宿主完整测试 114 个文件、746 项通过（含澄清与语音）；未做鸿蒙真机交互验收。
- TypeScript 检查、Web 生产构建及改动文件 lint 通过。

浏览器复现：

```bash
XOPC_LOG_LEVEL=fatal pnpm exec tsx scripts/test-clarify-interactions.mts
```

脚本使用独立临时数据库和端口，退出时清理测试入口与服务。截图保存在脚本报告的临时目录，可通过 CHROME_EXECUTABLE_PATH 指定浏览器。

Android 通过 gradle-run 管理执行，验证问题与结果：

- “Does the Android debug app compile with the structured clarification UI and protocol?”：通过。
- “Do Android clarification UI tests pass for compose, quick selection, explicit approval and expiry on the emulator?”：通过。

验证结束后关闭本次启动的模拟器，gradle-run finish 仅清理其管理的日志。
