# Personal Agent 首句与渐进表达技术方案

> 状态：第一阶段已实现；后台逐段投递仍按测量门槛推进。日期：2026-10-12。
> 目标：降低用户看到首句的等待，同时让回复有自然的段落节奏。
> 范围：Personal Agent 主会话和后台结果回传，先落地 Web/桌面端。

## 当前实现

- Personal 主会话由服务端确定 `textSurface: 'conversation'`，在 run/start/delta 事件中下发；delta 重放也能恢复展示模式。
- Web/桌面端立即显示公开 pending 文本，消息结束或历史加载时保留 narration。thinking 和工具详情独立展示，复制/朗读包含已经公开的文字。
- 首批正文无需等待 Markdown scheduler 定时器，后续仍采用现有自适应批处理。碎片化 `NO_REPLY` 不会作为首句显示。
- 自然首句与短段落规则复用于主会话及后台 reply composer，并通过已有指令升级流程应用到现有 Personal Agent。
- EmbeddedRun 日志新增 `first_model_request` / `first_model_text`；后台 composer 日志新增改写、排队和持久化耗时。Gateway 首批文本耗时采用单调时钟。
- 前端保留最多 40 条不含原文的单调时钟测量。在开发模式控制台调用 `window.__xopcResponseLatencyMetrics()`，查看首批文字、首个正文绘制机会、完整首句和渲染延迟。首句使用保守标点启发式，仅作测量，不切分内容；已恢复历史不作为新请求计时。`first_useful_ms` 仍需人工回放标注。
- 2026-10-13：聊天渲染升级后移除旧构建回退开关，公开 conversation 文本统一即时展示；详见 [Web Chat 渲染方案](../web-chat-message-rendering-technical-design.md)。

已实现的是第一阶段展示与表达，以及阶段零的测量能力。未进行真实模型的 p50/p95 基准，因此本文件的秒级目标不是已验证性能。后台结果继续在完整 JSON 校验后投递，第二阶段的 NDJSON、段落持久化及迁移尚未实施；应先根据新增日志确定后台改写占比，再按下文方案推进。移动端与语音实时切句属于第三阶段。

## 1. 决策

采用“快速主会话 + 直接流式正文 + 工具边界上的自然补充”。默认不增加一个只负责开场的模型调用，不按句子重复调用模型，不人为设置停顿。

段落是表达单位，模型消息是生成单位，run 是执行单位：一个模型消息可以包含多个段落，一个用户请求可以经历主会话响应和后台结果回传。段落不创建新 Session、不触发新的模型调用，也不各自形成聊天气泡。

必须分别处理三类延迟：

1. 模型出字前：队列、会话准备、上下文、模型推理和服务商等待。
2. 出字后到可见：Realtime、前端分类、Markdown 调度与渲染。
3. 后台结果完成后：回复改写、校验、outbox 投递。

分段只能直接改善表达和渐进交付；不能保证模型更早生成第一 token。首句提速必须同时缩短前置路径并移除展示阻塞。

## 2. 已核对的现状

| 位置 | 当前行为 | 对方案的影响 |
|---|---|---|
| `src/personal-agent/reply-style.ts`、`communication.ts` | 已要求自然表达、关键结果优先、委派前一句意图、避免重复确认 | 在现有规则中细化首句和段落节奏，避免新增互相冲突的规则 |
| `src/personal-agent/prompts.ts` | 可使用注入的 specialist 快照直接创建任务 | 保留已有优化，不重新增加每次发现 Agent 的调用 |
| `src/personal-agent/service.ts` | 初始化选择支持 thinking off 的模型，初始会话设置为 off | 已有快速主会话基础 |
| `src/agent/session/session-config-service.ts` | Personal 会话允许独立设置，不继承普通 Agent 的固定 thinking 约束 | 当前不能假定始终强制 off；保留用户设置并记录有效配置 |
| `src/gateway/chat-stream/mapper.ts` | text delta 已直接输出；消息结束时按是否包含工具调用判定 narration/answer | 有文字与工具共存时，公开说明被归为 narration |
| `web/src/features/chat/messages/streaming.ts` | 新文本段默认 pending，结束时更新 presentation | 正文展示依赖终态分类 |
| `web/src/features/chat/messages/assistant-turn-view-model.ts` | answerContent 排除 pending/narration；过程内容受 reasoningLevel 控制 | 用户可能在模型消息结束前看不到正文首句 |
| `web/src/features/chat/messages/agent-messages.ts` | 历史消息也按工具存在与否推导 presentation | 只修改实时展示会造成刷新后布局变化 |
| `src/personal-agent/reply-composer.ts` | complete 调用返回整个 JSON，校验 text、sourceIds、limitationIds 和 URL 后投递 | 后台结果首段被整篇改写阻塞；不能直接透传未完成 JSON |
| `src/gateway/service/run-gateway-agent.ts` | 已记录首个 assistant_delta 与排队耗时 | 需补客户端可见时间、首句和后台结果交付指标 |

以上是代码路径分析，尚未运行端到端延迟基准。静态截图不能证明生成策略或耗时。

## 3. 第一阶段：主会话尽早可见

### 3.1 表达策略

在既有 Personal reply style 中加入以下约束，同时保留用户表达偏好：

- 能直接回答：第一句给当前最有用的答案或判断，随后自然解释。简单问题允许一句结束。
- 需要实时核查或后台执行：先用一句具体意图回应，如“我先核对论文里的数值和它检验的对象。”然后立即执行，不在这句中编造结果或已开始的状态。
- 情绪对话：可以先回应具体感受，不能固定插入任务式开场。
- 通常每段 1–3 句，一个意思说完再换段。这个范围是写作指引，不是运行时硬截断。
- 首段避免标题、流程清单和重复用户问题；用户要求结构化输出时服从要求。
- 只在有新结论、影响结果的变化或必须用户决定时补充。不要按固定时间生成“还在处理”。
- 最后交付新增结果和必要证据，不重复已经说过的确认语；精确文本、代码、表格和完整列表按用户要求保留。

将“公开表达”与“内部推理”分开。模型 text 是公开话语；thinking delta、工具参数和原始工具结果不因本功能自动成为正文。

### 3.2 展示语义

为 Personal 会话使用服务端确定的展示模式，例如 `textSurface: 'conversation'`。这是新增的可选协议字段，具体命名实现时与 gateway-contract 统一。

- 服务端根据 Personal conversation 身份设置模式，不接受客户端任意提升。
- 在 assistant_message_start 就下发模式，使首个 delta 到达时无需等待 message_end。
- Personal 模式下 pending 文本立即进入对话正文；工具前后的公开话语保留在原位。
- narration/answer 继续用于现有生命周期与分析，但不再决定 Personal 公开 text 是否藏入过程区。
- 工具卡片、thinking、执行详情维持独立可折叠区域；避免同一文字在正文和过程区重复出现。
- 普通 Agent 会话维持原有语义；旧客户端可以忽略新增字段。
- 历史加载由同一服务端身份推导展示模式，实时和刷新后采用同一规则，不能依赖本地临时开关。

这里不增加“首句结束”模型事件。首句标点用于测量和语音切分，不用于阻塞文本展示。Markdown 空行就是自然段边界，messageId 仍表示原来的模型消息。

### 3.3 渲染

复用现有渐进 Markdown scheduler，测量后调整首批 commit：

- 首个普通文本 delta 立即进入可见区域，不等待完整句子或段落。
- 后续更新按渲染负载合并，初始候选窗口 30–60ms；以设备基准验证。
- 新段落随生成出现，不添加模拟打字耗时或固定停顿。
- 代码块、表格、链接仍走现有不完整 Markdown 处理，不能简单按标点拆分。
- 用户已向上滚动时保留阅读位置，不因新段出现强制跳到底部。
- abort 时保留已经可见内容并标识中止；message_end 是消息结束，不等于任务已成功。

### 3.4 首句之前的优化

保持单次主模型调用，避免额外分类 LLM 在它前面串行运行：

- 默认使用兼容的快速模型和 off/低推理配置；尊重用户显式选择，不静默覆盖高推理设置。
- 主会话保留窄工具集，复杂工作沿用 personal_task/personal_request。
- 静态人格和表达规则稳定排列；复用已有缓存策略，不把时间、动态任务快照放入稳定前缀。
- 必要身份、权限、会话状态仍是前置依赖；可选记忆和能力快照优先使用已生成的有版本缓存，缺失时按实际需求补取。
- 必要上下文不能为了快而跳过。附件无法读取时先说明尚未取得内容，不能装作已经理解附件。
- Personal 长会话沿用现有 idle compaction，测量前置压缩是否阻塞；不另开会话或跳过 LLM 历史净化。
- 并行只用于独立只读准备/请求，存在执行依赖或外部写入的操作依照原有顺序。

模型仍可能先构造工具调用而不输出文字。提示词能提高首句出现概率，无法形成硬 SLA；产品应允许这种情况，显示真实工作状态，不能伪造 agent 发言。

## 4. 第二阶段：后台结果首段交付

第一阶段不修改后台 JSON 的完整校验。先记录 worker 完成到用户看到结果的延迟，再决定是否实施本阶段。

### 4.1 目标协议

将整篇 JSON draft 改为可逐段校验的记录流，例如 NDJSON：

```json
{"type":"paragraph","seq":0,"text":"先看最关键的结论……","sourceIds":["result"],"limitationIds":["status"]}
{"type":"paragraph","seq":1,"text":"这里还有一个需要区分的细节……","sourceIds":["result"],"limitationIds":["status"]}
{"type":"end","paragraphCount":2}
```

每条记录必须完整解析后才可发布，禁止将 JSON 碎片直接展示。限制记录大小、段落总数和总文本长度；序号、类型和终止记录严格校验。无法稳定生成记录流的模型降级到当前完整 draft 路径。

sourceIds/limitationIds 只是输出契约，不能证明事实正确；沿用已确认 worker 结果作为依据。逐段校验禁止新增来源 URL，最终核对完整请求覆盖。原始精确内容和附件由宿主保留，不交给模型重复改写。

部分完成/失败的必要限定由宿主根据已确认状态在首段之前显示，不能等模型最后才补。涉及关键不确定性的内容须在对应段内体现。

### 4.2 outbox 与存储

不得绕过已有任务版本、conversation revision、transcriptId、lease 校验：

1. 在原有 reply outbox 旁保存版本化段落草稿，键包含 deliveryId、generationId、seq，并设置唯一约束。
2. 每个完整段通过校验后，先持久化草稿，再沿现有会话追加/通知路径投递；投递映射保存 transcript entry id。使用既有投递自定义条目承载段落，避免伪造 pi 模型消息。
3. 客户端用 replyId/generationId/seq 归并为同一回复，重放按键去重；Realtime 丢包可从已持久化段恢复。
4. 首段发布前如果会话 revision 改变，可以放弃未显示草稿并基于最新上下文重写。
5. 首段发布后冻结该 generation 的已发布前缀。新用户输入到达时暂停未发布后缀，按现有会话可用性策略继续或中止；不能悄悄撤回、重写已经看过的段落。
6. 中断后标明结果未完整交付，重试只续投已持久化且尚未交付段。若剩余内容需要重新生成，必须作为显式后续补充，不能声称任意 LLM 重试能精确续写旧流。
7. 重复 worker 回传、重启和通知重试不能重做外部操作，也不能重复显示段落。

这部分需要 SQLite schema migration 和契约版本更新，实施时核对当前迁移版本，不预占版本号。实时通知不能作为唯一结果存储；任务 completed 与回复 delivered 继续分开。

### 4.3 降级

- 首段尚未展示时失败：沿用当前已记录结果 fallback。
- 首段已经展示后失败：保留前缀，追加明确的未完整交付说明和必要剩余原始结果；避免再发完整报告重复前缀。
- 精确文本、大型表格或结构化列表：允许整块校验后展示，不强求每种内容都拆段。
- 自然语音：复用现有语音路径按完整语义句送入 TTS，不能播放未校验后台 draft；停止同步取消尚未播放的队列。本方案不新建语音引擎。

## 5. 度量与验收

服务端统一记录 conversationId、runId、deliveryId、modelRef、有效 thinking、上下文规模、缓存命中信息（服务商提供时）、phase。避免日志包含原始私人文本。

分开测量：

| 指标 | 定义 |
|---|---|
| queue_ms | 输入接收到 run 开始 |
| preparation_ms | run 开始到首次模型请求 |
| model_first_text_ms | 首次模型请求到首次 text delta |
| first_visible_ms | 客户端发送输入到首个公开正文被绘制 |
| first_sentence_ms | 客户端发送输入到首个完整语义句可见 |
| first_useful_ms | 首个实际满足请求的信息可见，按场景回放人工标注 |
| render_lag_ms | 客户端收到 delta 到对应内容绘制 |
| result_first_paragraph_ms | worker 结果就绪到结果首段可见 |
| result_complete_ms | worker 结果就绪到完整结果可见 |

服务端和客户端分别使用单调时钟计算各自耗时，不直接相减不同机器的墙钟。后台端到端指标通过同步的追踪/观测方案估算，并标识误差。缺少首句的中止请求单独计数，不从分位数中悄悄排除。

建议初始目标（不是当前性能承诺）：

- 同一模型、固定网络和上下文规模下，主会话 first_sentence p50 ≤ 1.5s、p95 ≤ 3s。
- 首个 text 到正文显示，桌面端 render_lag p95 ≤ 100ms。
- 第一阶段对照基线 first_visible 明显降低，完整回答耗时不得因额外开场调用增加。
- 第二阶段先以后台首段延迟较完整交付基线下降 30% 为实验目标，同时保持质量与投递可靠性。

分层报告冷/热启动、短/长上下文、直接回答/委派、不同模型和 thinking 配置。自然度、首句相关性、重复率、状态误报、来源保留与完整性由回放评审验证，不仅比较 TTFT。

必要验证：

- Personal 第一 delta 在 message_end 前可见；reasoning off 不隐藏公开正文。
- 有工具调用的文本不在终态从正文消失，刷新、重连和历史加载一致。
- 普通 Agent 的原有行为保持；thinking 和工具细节不意外泄露。
- 中文句子、英文缩写、代码、表格、链接、单句回答和 NO_REPLY 不被错误切分/展示。
- 背景逐段投递覆盖重复、乱序、断线、重启、lease 过期、版本变化、用户中断、无 end 和非法来源 URL。
- 带认证的真实 Gateway + Web 回放，以及慢模型/延迟工具场景；仅 mapper 单元测试不能证明首句可见。

## 6. 实施顺序与边界

1. P0：基准埋点与回放，确认隐藏 pending、上下文准备、模型等待和后台 composition 的占比。
2. P1：Personal 专属即时正文模式、首句表达规则、实时/历史一致、首批渲染调优。沿用主会话 transcript 写入路径，不增加 turn-end save。
3. P2：若后台 composition 占比显著，再实施逐段校验、持久化和 outbox 投递；需数据库迁移及跨客户端兼容。
4. P3：其他移动端、语音节奏按同一语义适配；启用前分别验证。

发布用独立功能开关，P1 与 P2 分别灰度。P1 回退不改变 transcript；P2 回退仍须能读取已投递段落。没有新增 REST API 的必要，扩展现有 realtime/会话投递契约即可。

暂不采用双模型抢先开场：它会增加成本、上下文同步、重复与承诺不一致。若优化后仍由高推理主模型主导等待，先让用户明确选择快速主会话模式；只有测量证明需要且开场内容有可验证边界时，再单独设计双路协调。

## 7. 参考

- [Claude：Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)：模型推理配置与延迟的关系，具体支持情况需按服务商/模型校验。
- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：独立工作并行及复杂度/延迟权衡。

实现以仓库当前 pi、模型适配层与配置为准，不将单一服务商参数直接当成跨供应商能力。
