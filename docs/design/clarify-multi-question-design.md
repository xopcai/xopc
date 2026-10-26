# Clarify 多问题交互

更新：2026-10-26。Web/Electron、Android、iOS、HarmonyOS 主聊天均已实现。三端真机经过真实 Gateway 的完整联调验收尚未执行。

本文是当前实现、共享契约和验证入口的统一说明。原单题与审批协议见 [Clarify 结构化交互](./clarify-interaction-plan.md)。

## 设计决策

在现有 `clarify` 工具上增加版本化多问题能力，复用原有持久化 wait、回答事务和恢复队列。借鉴 Codex 的分题填写与统一提交交互，保留 xopc 自己的 SQLite 恢复机制。当前需求不引入 A2UI runtime、通用组件 Catalog 或第二套交互引擎。

一次批次包含 1–3 个独立问题，题型为单选或自由文本。推荐项只作提示；选择只更新草稿，用户完成所有问题后显式提交。支持前后切题、补充说明、自定义回答和草稿恢复。整批委托助手决定或取消任务各使用一次明确操作。审批保持独立的批准/拒绝界面，不进入多题分支。

## 契约与能力协商

事实来源：

- `packages/gateway-contract/src/clarification-questions.ts`：题目、答案、规范化与校验。
- `packages/gateway-contract/src/clarifications.ts`：wait 和回答的版本化结构。
- `packages/gateway-contract/fixtures/clarification-v2.json`：Web 与三端共用的 JSON 样例。

Gateway 的 `GET /api/health` 返回 `clarificationVersions`。客户端明确探测到版本 2 后，在普通主聊天输入中附加：

```json
{"interactionCapabilities":{"clarificationVersions":[1,2]}}
```

能力在已验证 endpoint 的输入上下文中冻结并持久化，不作为授权信息。不支持或探测失败时保留原 v1 请求形状；Android/HarmonyOS 已持久化输入的重试保留原能力声明。CLI、聊天渠道、语音及 ephemeral 入口继续使用 v1。

一个 v2 wait 保留原 conversation、transcript、来源 run、状态与 checkpoint，增加 `schemaVersion: 2` 和有序 `questions`。顶层 `question` 是服务端生成的摘要，不能当成完整单题提交。`schemaVersion` 是结构版本，`version` 是乐观锁版本。

复用现有接口：

```text
GET  /api/sessions/:conversationId/clarification
POST /api/clarifications/:id/responses
```

回答示例：

```json
{
  "schemaVersion": 2,
  "action": "answer",
  "expectedVersion": 1,
  "idempotencyKey": "stable-submission-id",
  "answers": [
    {"questionId":"channel","choiceId":"blog"},
    {"questionId":"frequency","choiceId":"weekly"},
    {"questionId":"direction","text":"Engineering notes"}
  ]
}
```

`agent_decide` / `cancel` 携带 `schemaVersion: 2`，不携带 `answers`。v1 仍使用 `response` 或审批的 `decision`；服务端拒绝向 v2 wait 提交旧回答格式。

## 校验与受理

- 每题必须恰好有一份答案；未知或重复 questionId、未知 choiceId、漏题、空回答和未知字段会使整批被拒绝。
- 单选允许 choiceId 加补充文本，也允许仅填写自定义文本；文本题不能带 choiceId。
- question ID 为 1–64 个 ASCII 字母、数字、下划线或短横线；批次内唯一。header / question 最长 24 / 1,000 个 UTF-16 单元；单选有 2–10 个唯一选项，label / description 最长 120 / 500。
- 每题回答最多 2,000 个 UTF-16 单元，最多三题；JSON 请求最多 32 KiB。恢复摘要包含问题、标题、选项标签和回答，使用现有估算器校验最多 2,000 tokens。原生端对应校验摘要最多 8,000 个 UTF-16 单元。

服务端按原题顺序规范化答案，以 schemaVersion、action 和稳定题目/选项身份计算响应身份。同键同规范化内容返回原结果，同键不同内容冲突。

在现有 SQLite 事务中完成 wait 更新到 queued、保存结构化答案和受理身份、插入一个 `clarification_resume` 及显示摘要。失败时整体回滚；不走会替代当前 wait 的普通输入提交路径。消费恢复项时继续校验 transcript、状态与目标 revision，防止 `/new` 或新输入后恢复旧任务。

202 只表示受理，后续运行结果另行观察。显示摘要与 LLM 恢复上下文分离，避免重复注入答案。数据保存在现有 wait JSON 中，无新增表或数据库版本升级。

## 客户端实现

| 客户端 | 主要位置 | 草稿与重试 |
| --- | --- | --- |
| Web/Electron | `web/src/features/chat/clarification/`、`composer/clarify-prompt.tsx` | IndexedDB 按 Gateway/身份/端点/会话/wait/version 隔离；临时会话使用内存；冻结提交、合并并发请求 |
| Android | `gateway/ClarificationRepository.kt`、`ui/main/ClarificationWizard.kt`、`GatewayViewModel.kt` | Android Keystore 加密存储；存储键包含 Gateway/设备和全局唯一 wait/version，并做 SHA-256；持久化完整提交体 |
| iOS | `Core/Models/ClarificationModels.swift`、`Core/Networking/GatewayCommands.swift`、`Features/Assistant/ClarificationCard.swift`、`AssistantState.swift` | Keychain 保存草稿和完整提交体；使用已认证设备身份隔离，避免 access token 刷新丢失草稿 |
| HarmonyOS | `model/clarification.ets`、`view/ClarificationWizard.ets`、`viewmodel/chatPromptViewModel.ets` | 复用加密 RDB 草稿库；按 Gateway/设备/会话/wait/version 隔离；串行保存并校验连接版本 |

网络结果不明确时保留原 idempotencyKey 和完整请求体，锁定已提交答案，只重试原批次。受理后清理当前草稿及尝试记录。新 wait/version 使用新的草稿空间；快照和实时事件使已解决、替代或跨端抢先处理的表单失效。

修复了 Web 执行过快、订阅前 run 已结束时误把 suspended 当作 success 的竞态：恢复路径会查询持久化 clarification。

`XOPC_CLARIFY_MULTI_QUESTION=false` 关闭新批次生成；已有 v2 wait 的读取和回答保留。回退时不能把未完成 v2 wait 原地改为 v1。

## 验证记录

| 检查 | 本次结果 |
| --- | --- |
| 共享契约、Gateway/SQLite、Web 相关回归 | 13 个文件、143 项通过，含受理失败回滚 |
| 生产 WebUI E2E | 真实 Gateway、HTTP/WS、工具发现和 SQLite；仅模型响应受控；覆盖三题、推荐未预选、刷新恢复、375px 窄屏、双击去重、一次恢复和历史重读 |
| Node/Electron 类型、声明文件、Node/Web 构建、Web lint | 通过 |
| Android Debug APK | 构建成功 |
| Android v2 JVM / Compose 卡片 | 6 项协议测试、API 35 模拟器 5 项交互测试通过 |
| iOS 模拟器 ClarificationV2 / GatewayModels / FeatureState | 36 项通过；1 项既有真实 Keychain 用例因无签名而取消；新存储逻辑通过注入适配器验证 |
| iOS 改动文件 SwiftLint | 无诊断 |
| HarmonyOS clarify、草稿、聊天、实时连接 | 5 个文件、82 项通过 |
| HarmonyOS Debug / Release HAP、CodeLinter | 无签名构建成功；源码 lint 无诊断 |

WebUI E2E 入口：

```bash
pnpm run test:web:clarification:e2e
```

默认报告和截图位于 `/tmp/xopc-clarification-browser`，可通过 `XOPC_CLARIFY_EVIDENCE` 指定目录。测试使用独立临时配置和数据库。

单独运行契约包 typecheck 仍有既有的 `sessions-backend-contract.test.ts:65` / `SessionListItem.usage` 错误，已在 HEAD 基线复现；本次未修改该无关测试。

待补发布验收：三端真机与真实 Gateway 联调、后台/杀进程恢复、真实中文 IME、横屏/窄屏/无障碍、跨端同时回答和 `/new` 替代。现有自动化不替代这些设备验收。
