# 下一轮输入建议 P0 实现与验证

日期：2026-10-13。状态：已实现并完成以下验证。

交互修订：根据用户反馈，移除填入、关闭和开启按钮及其本地开关，只保留 placeholder 和按 Tab 填入。下方浏览器验证记录为初版历史，当前修订通过相关回归测试、类型检查及 Web 构建验证。

## 已交付行为

- 普通聊天与个人助理在成功 turn 后、输入框空闲且完全为空时展示一条下一轮输入建议。
- 按 Tab 只填入草稿；用户随后发送。空输入 Enter 不发送 placeholder。
- 当前轮运行、排队、语音、IME、消息编辑、附件、引用、审批/澄清等待和页面加载时抑制建议。
- 个人助理的普通名称提示不再遮住有效建议，特殊页面和运行态仍保持各自指引。
- Esc 可隐藏本条建议；输入框不增加按钮、菜单或本地开关。旧版按钮保存的关闭偏好不再抑制建议。
- 建议缓存和反馈独立于 transcript；缓存 30 分钟，负结果同样缓存；反馈去重并在后续缓存写入时清理 30 天以前记录。

## 实现边界

输入调度器发布最终输入状态后通知建议服务，只有打开的 composer GET 才启动预测，不为后台所有会话自动调用模型。输入接收即取消旧预测；版本检查覆盖 conversation、transcript、run、输入 revision、transcript cursor、Agent、语言和实际模型引用。reset/delete 的通知也会使客户端重新核验。

首版只读取当前会话中有限的 user/assistant 文本，经 `buildSessionContextForLlm` 处理，排除工具结果、thinking 和审计行。使用一次模型调用，允许返回 null；没有引入跨会话用户理解、关系排序或外部连接器读取。模型优先使用 fast intent，未配置时沿用本会话 modelOverride，再回落至 Agent 的聊天模型。调用走现有凭据解析和用量记录，输出上限 200 tokens，总等待上限 3 秒，全局最多两个预测工作项。

接口：

- `GET /api/sessions/:conversationId/next-turn-suggestion?locale=zh|en`
- `POST /api/sessions/:conversationId/next-turn-suggestion-feedback`
- sessions topic 的 `session.next-turn-suggestion.changed` 事件；重连或 gap 后通过 REST 恢复。

SQLite migration 为 `248_next_turn_suggestions.sql`。预测内容不会写入 transcript、FTS 或聊天消息计数；删除会话级联清理缓存与反馈。

## 自动测试

后端 79 个通过：

```sh
XOPC_LOG_LEVEL=fatal pnpm vitest run \
  src/gateway/next-turn-suggestions/__tests__/http.test.ts \
  src/gateway/next-turn-suggestions/__tests__/service.test.ts \
  src/gateway/service/__tests__/session-input-coordinator.test.ts \
  src/gateway/service/__tests__/agent-runner-interruption.test.ts \
  src/gateway/hono/routes/__tests__/lazy-bundles.test.ts --project=component
```

包括缓存重用、locale 隔离、TTL、reset/new input 后迟到结果、失败/取消/挂起、队列、忽略 abort 的 provider 超时、反馈去重、会话删除和 transcript 隔离。

HTTP 测试使用监听 loopback 的真实 HTTP server、生产 auth/scope middleware 和 production lazy fallback；用本地 OpenAI-compatible SSE fixture 经实际 provider 调用链生成建议，验证未认证 401、真实 matcher、200 token 上限、无工具、单次调用、邻近 404、参数与反馈校验。不是直接注册 route module 后绕过 lazy matcher 的测试。

前端 49 个通过：

```sh
XOPC_LOG_LEVEL=fatal pnpm vitest run \
  web/src/features/chat/composer/__tests__/use-next-turn-suggestion.test.tsx \
  web/src/features/chat/composer/__tests__/chat-composer-input-suggestion.test.tsx \
  web/src/features/chat/__tests__/composer-editor-wire.test.ts \
  web/src/features/chat/composer/__tests__/chat-composer-input-delete.test.tsx \
  web/src/features/chat/composer/__tests__/use-composer-actions.test.tsx --project=web
```

包括异步草稿保护、会话/语言切换、reset/输入 revision、重连、忽略旧版开关偏好、填入与提交反馈、Tab 的附件/引用/IME/队列守卫，以及删除产生的 caret BR 归一化。明确保留主动输入的换行和空格。

## 初版浏览器验证（按钮交互已按用户要求移除）

使用真实 `ChatComposer` 组件、现有 VoiceCall context、Router、样式与 IndexedDB 身份，在临时 Vite 页面通过 headless Chrome 验证。网络响应采用受控 fixture，未发送生产聊天或调用付费模型。

- 普通聊天 Tab 填入；个人助理固定 placeholder 下动态建议仍可展示。
- 空 Enter 不提交；点击填入不提交；用户随后发送时文本一致，反馈为 shown / accepted / submitted。
- 迟到建议保留已有草稿；删除最后字符后恢复建议。
- streaming 隐藏、关闭再开启、reset 后隐藏。
- 390px 触屏布局无横向溢出、不显示 Tab 文案；IME 和引用时隐藏，触屏按钮可填入。

临时测试页面验证后已清理。浏览器 fixture 与 HTTP fixture 分别验证 UI 和服务边界；未用生产账户做真实模型质量评估。预测相关性和 P1 个性化增益仍需后续真实样本评估。

## 构建与静态检查

`pnpm run typecheck`、Web production build、Node build，以及修改的聊天文件 ESLint 均通过。Web build 有现有的 chunk size / dynamic import 提示，没有构建失败。

## 2026-10-14：删除后重复 Tab

Tab 填入只采纳草稿，不再关闭建议。输入时保留缓存，仅隐藏展示；全部删除时立即恢复同一条建议，可再次 Tab，无需请求或重新生成。删除已采纳草稿会清除提交归因；成功发送或 Esc 隐藏后，本条建议保持隐藏。编辑期间继续监听输入 revision、reset 和过期，旧建议不会因删除草稿重新出现。

相关回归测试共 24 项通过，涵盖实际 `ChatComposerInput` 的三次连续 Tab → 浏览器删除 → Tab、部分删除、清空后手写消息、拒绝提交后保留草稿、成功提交、主动隐藏、新输入与过期。验证重复采纳只请求一次，保持 placeholder＋Tab，无额外按钮。

```sh
XOPC_LOG_LEVEL=fatal pnpm vitest run \
  web/src/features/chat/composer/__tests__/use-next-turn-suggestion.test.tsx \
  web/src/features/chat/composer/__tests__/chat-composer-input-suggestion.test.tsx \
  web/src/features/chat/composer/__tests__/use-composer-actions.test.tsx --project=web
```

本次 Web 构建（含 TypeScript 检查）和修改文件 ESLint 通过。
