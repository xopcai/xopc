# 回复关键路径 await 审查与优化（2026-10-29）

## 结果

落地三项优化：个人助手跳过不适用的工作区 Git 快照；用户上下文检索与图片读取并行；Webchat 附件仅在流式入口规范化一次。

没有更换模型、调整 thinking、修改生产配置或发起真实模型请求。未改变需要等待的权限检查、持久化和编码验证。已有标题生成、记忆学习和 Gateway 自动语音继续使用原有后台通路。

## 审查范围与依赖

调用链为 `runGatewayAgent` → `runProcessDirectStreaming` → `runDirectAgentTurn` → `runEmbeddedTurnForSession` → `runXopcEmbeddedTurn`，并检查了上下文、附件、验证和完成通知的实现。

| 环节 | 判定 | 原因或改动 |
|---|---|---|
| 会话元数据、身份与恢复状态 | 保留等待 | 后续路由、恢复和权限依赖它们 |
| `initSessionTurn` / reset | 保留等待 | 新 transcript 必须先确定，不能让读取跨越 reset 边界 |
| workspace → model → thinking 恢复 | 保留顺序 | thinking 校验依赖已恢复的模型；异常时避免运行部分更新的会话 |
| Gateway 附件准备 → 流式入口附件准备 | **合并一次** | 两层调用的是相同持久化/URI 解析，Gateway 直接传递已限量的原始输入 |
| 音频转写 → 构造用户消息 | 保留等待 | 转写正文、原音检查和媒体提示屏蔽都依赖转写结果 |
| 绑定来源解析 → 构造用户消息 | 保留等待 | 引用标题、冻结来源和权限检查必须在消息装配前完成 |
| `prepareUserTurnContext` → `hydrateUserTurnForLlm` | **并行** | 前者检索记忆和知识，后者从媒体存储读取/处理图片，两者没有数据依赖 |
| 内存 provider 初始化 | 已有复用，保留等待 | `MemoryManager.initializeAll` 已按 session 缓存初始化 Promise |
| 插件运行时权限刷新 | 保留等待 | 结果决定 Agent 是否重建及可用 Skill/MCP；不能延后到模型请求之后 |
| MCP、启动上下文、前台压缩 | 保留必要等待 | 决定请求可用能力和上下文预算，本次没有把必要上下文移出请求 |
| 仓库指令读取 → runner 创建 | 保留等待 | runner 构造需要正确的作用域指令 |
| 个人助手工作区验证快照 | **移除无效工作** | `personal_main` 的持久化执行策略已排除直接修改工作区的工具，无需为它运行编码快照 |
| transcript append / turn outcome | 保留等待 | 维持有序持久化和完成事件的可靠语义 |
| 自动标题、记忆学习 | 已在后台 | 调用点为入队/调度，没有额外阻塞性 await 可移除 |
| Gateway 自动 TTS | 已在后台 | Gateway 提供 `onDeferredAudio`，音频经独立事件交付；其他依赖流内音频的调用者保留等待 |
| completion hooks / TaskJudge | 保留等待 | 当前完成协议允许它们读取及更新运行中任务，直接后台化可能与下一轮或任务 finalize 竞争 |

这些判断按数据和状态依赖做出，没有把所有相邻的 await 都机械改成并行。

## 实现细节

### 个人助手工作区快照

原来所有执行都会进入 `RunVerification.open`，读取 Git root、HEAD、diff 和未跟踪文件；初始化摘要、工具前后、完成检查和终态摘要也可能再次计算快照。

现在由 `run-turn.ts` 在**工具已按执行策略过滤之后**，仅为 `executionToolPolicy.surface === 'personal_main'` 关闭工作区追踪。通用 Agent、Request worker 保持追踪；`required: true` 强制保留快照，即使调用者请求关闭追踪也不能绕过编码验证。

`trackWorkspace: false` 不产生 workspace revision，也不生成验证通过的证据。原有 transcript 检查点仍保留。未来如果个人助手获得直接写工作区能力，必须同步复审这项策略。

### 上下文与媒体并行

原来先等待用户上下文完成，再读取当前轮图片。现在在模型状态已恢复后同时开始，通过 `Promise.allSettled` 等待两者结束，再装配模型输入。

保留图片顺序、来源图片、动态系统上下文和任务协作指令。任一分支失败都不启动模型；另一分支先完成清理，避免上下文准备跨越 turn 退出后继续修改会话状态。多个失败仍优先报告原来先执行的上下文分支错误。

纯文本请求几乎没有图片读取成本，因此此项的主要收益在图片输入与上下文检索同时存在时，不将受控测试收益外推到所有聊天。

### 附件只规范化一次

Gateway 保留附件数量上限，将原始附件交给既有流式入口。`prepareInboundAttachments` 的媒体 URI 校验、Note 附件解析、大小限制及持久化继续在该入口执行。

无效附件现在在已注册执行的流式入口失败，走相应的错误和会话占用清理；回归测试覆盖有效/无效附件的终态和占用释放。另保留真正发生在注册前的初始化失败测试，保证该异常路径仍发布 run 终态。

## 验证与收益

### 真实 Git/文件系统离线基准

使用临时 Git 仓库、32 个未跟踪文本文件，每个场景先预热，再交替执行修改前后策略各 20 次。仅执行工作区验证阶段，不包含模型、网络或生产数据。基准脚本在结束时清理临时目录。

以下是最终一次运行结果；绝对值会受机器负载和仓库大小影响。

| 场景 | 原阶段 P50 | 优化后 P50 | 每轮阶段节省 P50 | 模型请求前快照阶段 P50（原 → 新） |
|---|---:|---:|---:|---:|
| 纯文本、无工具 | 122.53 ms | <0.01 ms | 122.52 ms | 60.62 ms → <0.01 ms |
| 一次 personal_task | 190.46 ms | 0.02 ms | 190.44 ms | 62.46 ms → <0.01 ms |

表中只包含被移除的验证快照阶段。个人助手仍有其他准备、模型和传输成本；这些数字不是整轮回复或首字耗时，不代表整体降低相同比例。非 Git 工作区原本也会尝试 Git 探测，但本基准没有测量该场景。

原始样本：[reply-preparation-benchmark-2026-10-29.json](./evidence/reply-preparation-benchmark-2026-10-29.json)。

### 并行与去重验证

- 使用受控时钟运行原串行准备过程和新的真实入口：上下文注入等待 200 ms、图片读取注入等待 120 ms；准备从 **320 ms 降至 200 ms**。这是依赖调度验证，不是线上测量。
- 上下文/图片分别失败时，验证另一分支在 turn 退出前完成、没有模型调用或后续学习调度。
- 有效附件使用真实媒体持久化代码，验证 Gateway 到流式入口仅规范化一次；无效 URI 验证错误终态、run controller 和会话占用均正确清理。
- 验证显式要求编码校验时仍执行快照，未设置关闭选项时仍执行快照。

### 回归

12 个测试文件、**116 项测试通过**：直接入口、实时流、单次调用、附件及语音、图片输入、个人助手工具边界、Gateway 生命周期和工作区验证。

根项目 TypeScript 检查、修改的运行时代码与测试 ESLint、`git diff --check` 均通过。基准脚本通过 tsx 实际执行；仓库 ESLint 当前不包含 `.mts` 脚本。

## 复现

```bash
pnpm exec tsx scripts/benchmark-reply-preparation.mts \
  --output /tmp/xopc-reply-preparation-benchmark.json

pnpm exec vitest run \
  src/agent/service/__tests__/direct-turn-preparation.test.ts \
  src/agent/coding/__tests__/run-verification-surface.test.ts \
  src/gateway/service/__tests__/run-gateway-agent.test.ts
```

改动尚未运行在用户的 Gateway 实例中。更新实际运行版本后，使用现有真实请求计时比较准备阶段和首字延迟；本次结果不宣称线上端到端提速已经得到验证。
