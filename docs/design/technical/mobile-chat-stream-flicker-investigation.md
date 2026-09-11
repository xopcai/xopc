# 移动端 AI 回复闪烁、消失与列表跳动调查

## 执行结论

本次调查以原生 Expo 移动端 `apps/mobile-expo` 为对象，检查的是当前工作树 `19a3af89bd7ca2c2a0669c5dd34aa20b18f5703d`，应用版本为 `0.0.49`。结论不是单一的“性能差”，而是三个问题叠加：

| 优先级 | 机制 | 与现象的对应关系 | 置信度 |
| --- | --- | --- | --- |
| P0 | 流结束后，用“查询更新时间变新”代替“服务端历史已包含本轮答案”的确认，随后清空本地流式消息 | 已显示的整段回复突然消失，稍后可能重新出现 | 很高；存在确定性代码路径 |
| P1 | 每 50 ms 更新 Markdown，同时为新增字符启动 150–200 ms 的淡入动画 | 字符尾部持续明暗变化，主观上像“一闪一闪” | 很高；配置和依赖实现均可直接验证 |
| P1 | FlashList 的可见内容锚定与每次内容高度变化后的手动 `scrollToEnd` 同时生效 | 换行、思考区收起、最终消息替换时列表漂移或跳动 | 高；当前代码中有两个滚动控制者 |
| P2 | 流式内容形成表格后，渲染器会从原生 CommonMark 整体切换到 JS Markdown；文本块 key 又由数组下标构造 | 特定 Markdown 内容出现整块重排、字体/间距突变 | 中高；切换路径确定，发生频率取决于回答内容 |
| P2 | 项目锁定的 Markdown 原生库为 `0.5.0`，早于其 Fabric 回收视图“旧 Markdown 闪现”修复 | iOS FlashList 复用单元格时可能短暂显示上一条内容 | 高（风险存在）；尚未在用户设备上采样确认 |

其中，P0 是“输出一段话，又不见了”的直接解释；P1 的两个机制共同解释“回复一闪一闪、整体 UI 很乱”。三者会互相放大：消息先以 `stream-*` 行显示，终态刷新时被删掉，稍后又以持久化行重新插入，列表回收、重新测量并再次对齐到底部。

### 实施状态

后续稳定性改动已经落地：Chat 自主动画全部关闭；流式文本以 100 ms 的离散提交更新；最终本地 assistant 只有在持久化历史确认覆盖完整文本、工具结果和 outcome 后才会清理；FlashList 负责流式增长时的底部锚定，手动滚动只处理用户明确点击和完成态内容收缩。图片裁剪的直接拖拽/缩放、录音电平和音频播放进度属于功能输入反馈，不使用自动补间动画，予以保留。

## 1. “已经显示的答案又不见了”是一个终态竞态

### 1.1 移动端的实际状态转换

流事件到达时，移动端把正在生成的 assistant 消息放在独立的 `streamingMsg` 中；页面再将它合并到服务端历史记录后展示。这个设计本身没有问题，问题发生在流结束后的确认条件：

1. `onResult` 先把思考和工具块标记为结束并刷新一次 UI，然后调用 `finalizeMessage`。见 [`use-chat-session.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-session.ts#L565-L579)。
2. `finalizeMessage` 立即停止 streaming、设置 `awaitingSessionRefresh=true`，并异步拉取最新 50 条历史。见 [`use-chat-session.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-session.ts#L333-L356)。
3. 页面把“查询缓存的 `dataUpdatedAt` 大于流结束前时间”定义为 `sessionRefreshComplete`。它没有检查刷新结果是否真的含有本轮 assistant 消息、同一 `turnId`，甚至没有检查答案文本是否存在。见 [`use-chat-page.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-page.ts#L269-L271)。
4. 一旦该条件成立，页面调用 `clearAllState()`；后者会将 `streamingMsg` 清为 `null`。见 [`use-chat-page.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-page.ts#L294-L297) 和 [`use-chat-session.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-session.ts#L244-L261)。
5. 如果这次刷新读取到的是旧快照，展示数据只剩服务端旧历史；本地刚刚完整显示的 assistant 行立即消失。

这里的关键错误是：**“缓存被更新”不是“本轮最终答案已经持久化并可读取”的证明。**

### 1.2 为什么立即刷新可能读到旧快照

服务端的 transcript 通知采用 fire-and-forget：收到 transcript update 后，`syncEmbeddedTranscriptUpdate()` 被启动但没有 `await`；紧接着就会调用 `onSessionTranscriptUpdated`。见 [`src/agent/service.ts`](../../../src/agent/service.ts#L227-L239)。真正写入 SQLite 发生在异步 store mutation 内。见 [`src/session/store.ts`](../../../src/session/store.ts#L572-L585)。

与此同时，Gateway 在流生成器结束后马上发送终止事件并完成 realtime topic。见 [`run-gateway-agent.ts`](../../../src/gateway/service/run-gateway-agent.ts#L209-L238)。这条链路没有等待前述 fire-and-forget 的 SQLite 同步全部完成。

因此，下列顺序在当前实现中是合法的：

```text
assistant 文本已通过 realtime 完整到达手机
    → Gateway 发送 run_end
    → 手机立刻 GET 最新会话历史
    → SQLite 的最终 assistant 行尚未写入
    → GET 返回旧历史，但 React Query 的 dataUpdatedAt 仍然更新
    → 手机认定刷新完成并清空 streamingMsg
    → 已显示答案消失
    → 后续 session.updated / 再刷新后，持久化答案重新出现
```

这也解释了为什么问题是“有时候”发生：它取决于数据库写入、事件循环、网络往返和设备渲染的相对时序。慢网络并不会自动避免竞态；只要刷新响应仍先于最终 transcript 可见，问题就会发生。

### 1.3 确定性状态回放

用当前的消息合并与清理条件做纯状态回放，可以稳定得到下面的 UI 序列：

| 时刻 | 服务端历史 | `streamingMsg` | 屏幕结果 |
| --- | --- | --- | --- |
| 生成中 | 用户消息 | `已显示的答案` | 用户消息 + 答案 |
| `run_end` 后的旧快照 | 用户消息 | 被 `clearAllState` 清空 | 只剩用户消息，答案消失 |
| SQLite 完成后的下一次刷新 | 用户消息 + assistant | 空 | 答案重新出现 |

`reconcileMessageRows()` 无法补救中间状态，因为旧快照里根本没有 assistant 行可供对齐；而重新出现的持久化行通常又有不同的 row key，进一步触发 FlashList 的卸载、回收和布局调整。

### 1.4 Web 端已经有更稳健的同类实现

Web 端在终止事件到达时，会先把完整的 live bubble 原子提交进本地 `messages`，再清除 streaming 状态；400 ms 后才做服务端回读。见 [`use-chat-session-streaming.ts`](../../../web/src/features/chat/session/use-chat-session-streaming.ts#L101-L134)。store 的 `finalizeStreamingTurn` 会把最终 assistant 追加/合并到 committed messages 后再进入 idle。见 [`chat-session-store.ts`](../../../web/src/features/chat/session/chat-session-store.ts#L380-L400)。

这说明协议数据足以在客户端完成无缝终态提交；当前缺口主要是移动端没有移植这套“本地先提交、服务端后校正”的语义。

## 2. “一闪一闪”来自过密更新与更长的淡入动画

移动端每 50 ms 将累计的流式内容 clone 到 React state。见 [`use-chat-session.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-session.ts#L86) 和 [`use-chat-session.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-session.ts#L197-L225)。assistant 文本把 `isStreaming` 直接传给 `MarkdownView`。见 [`MessageBubble.tsx`](../../../apps/mobile-expo/src/features/chat/MessageBubble.tsx#L269-L285)。内容不超过 8192 字符时，`MarkdownView` 会明确打开原生库的 `streamingAnimation`。见 [`MarkdownView.tsx`](../../../apps/mobile-expo/src/features/chat/MarkdownView.tsx#L303-L323)。

官方 API 说明该选项会让新追加的尾部字符淡入，且默认值本来是 `false`。[^1] 但项目主动将它打开。锁定版本 `react-native-enriched-markdown@0.5.0` 的本地原生实现显示：

- Android 新字符从 alpha 0 开始，在 150 ms 内渐显；
- iOS 渐显持续 200 ms，每次新更新会先取消上一次渐显，再对新的尾部范围重新开始。

因为 React 刷新间隔只有 50 ms，一次动画期间理论上会进入 3–4 次新内容更新。用户看到的不只是“文字逐字出现”，而是持续的透明度重置；在换行、粗体、列表、代码块等重新布局时尤其明显。

更长的回答还会遇到另一层开销。该库的公开问题记录显示，流式 Markdown 每次更新会随整篇文档长度增加解析/布局成本，5 KB 以上可能成为主要开销；报告中的复现频率是约 60 次/秒。[^2] xopc 虽然限制到约 20 次/秒，但使用的是更早的 `0.5.0`，且仍然在每次提交时处理整个增长中的文档。因此，短回答以透明度闪动为主，长回答会进一步叠加掉帧和布局延迟。

## 3. 列表同时有两个“保持底部”的控制者

`MessageList` 为 FlashList 开启了 `maintainVisibleContentPosition` 和 `startRenderingFromBottom`。见 [`MessageList.tsx`](../../../apps/mobile-expo/src/features/chat/MessageList.tsx#L30-L34) 和 [`MessageList.tsx`](../../../apps/mobile-expo/src/features/chat/MessageList.tsx#L362-L390)。FlashList 官方文档说明，该机制用于内容变化时保持滚动位置，并且默认启用；它同时提供 bottom threshold 负责聊天场景的自动跟随。[^3]

但当前自定义 hook 也在控制同一件事：只要内容高度变化超过 1 px，并且用户仍被认为位于底部，就在下一帧执行一次无动画 `scrollToEnd`。见 [`use-chat-list-scroll-follow.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-list-scroll-follow.ts#L59-L66) 和 [`use-chat-list-scroll-follow.ts`](../../../apps/mobile-expo/src/features/chat/use-chat-list-scroll-follow.ts#L116-L125)。

流式 Markdown 每次换行都会改变末行高度，于是可能发生：

```text
Markdown 重新测量高度
    → FlashList 先按 maintainVisibleContentPosition 调整锚点
    → onContentSizeChange 触发
    → 下一帧自定义 hook 再 scrollToEnd
    → 用户看到一帧漂移、随后又被拉回底部
```

这不是纯理论风险。FlashList 仍有公开的 chat/variable-height 跳动问题：在动态高度与特定更新时间组合下，会出现至少一帧的错误位置。[^4] 当前回答每 50 ms 增长、Markdown 动态换行、思考/工具区结束时收起，正是高频触发这些边界条件的场景。

版本历史还显示，`8776f7785` 同时做了两件相关修改：

- 把 Markdown flavor 从 GitHub 改为 CommonMark，减少每次更新重建多个原生子视图；这是合理的减负。
- 移除了 FlashList 的 `autoscrollToBottomThreshold: 0.08` 和 `animateAutoScrollToBottom: false`，并把自定义 hook 从“只在内容缩小时手动跟随”改为“每次内容增长或缩小时都手动跟随”。

后一项等于把持续跟随职责从 FlashList 部分搬到 JS，但没有关闭 FlashList 的可见内容锚定，因而形成双控制者。

## 4. 渲染器整体切换与旧版本回收缺陷会放大混乱感

### 4.1 表格一旦成形，整条消息会更换渲染器

为了避免原生 GFM 表格崩溃，移动端检测到“表头行 + 分隔行”后，会从原生 `EnrichedMarkdownText` 切换到 JS `react-native-markdown-display`。见 [`markdown-render-safety.ts`](../../../apps/mobile-expo/src/features/chat/markdown-render-safety.ts#L19-L46) 和 [`MarkdownView.tsx`](../../../apps/mobile-expo/src/features/chat/MarkdownView.tsx#L247-L282)。

在流式过程中，消息开始可能只是普通文本；当模型后来补出 `| --- |`，判定会突然从 false 变为 true。React 随即卸载原生 Markdown、挂载 JS Markdown，整块高度、段落间距、字体测量都可能变化。这能解释“包含表格时特别乱”，但不能解释所有普通文本的消失，因此属于放大器而不是主因。

另外，assistant 文本节点的 key 是 `text-${i}`，其中 `i` 是内容块数组下标。见 [`MessageBubble.tsx`](../../../apps/mobile-expo/src/features/chat/MessageBubble.tsx#L257-L285)。当思考、工具和文本块的顺序在 live/persisted 合并时变化，MarkdownView 可能被当成新节点重挂载。

### 4.2 当前原生 Markdown 版本早于一个直接相关的闪烁修复

项目实际锁定的是 `react-native-enriched-markdown@0.5.0`。该库在 2026 年 7 月合并了 Fabric 回收视图修复：iOS 的回收视图会保留上一次 mount 的样式和 md4c flag，导致下一次 props 重绘前短暂显示旧 Markdown。[^5] 这个修复进入了 `v1.0.0`。[^6]

xopc 恰好把 Markdown 原生视图放在 FlashList 的可回收单元格内，因此缺陷的前置条件成立。它很可能解释滚动或行替换时的“旧内容一闪”，尤其是 iOS；但没有设备录屏与原生 profiler 采样，不能把用户所见的全部闪烁都归因于这个库缺陷。

不建议直接把依赖版本数字改到最新版后结束。`v1.0.2` 移除了 Expo config plugin，并把功能配置迁移到应用 `package.json`，属于需要原生构建验证的破坏性变更。[^7]

## 5. 为什么 `0.0.49` 仍然会出现

`0.0.49` 对应提交 `d1bc8368c`，该提交本身只是将移动端版本从 `0.0.48` 提升到 `0.0.49`。它没有修改聊天终态、Markdown 或列表代码。

同日较早的 `55dca49d1` 修复了移动端用户消息 delivery 状态，并增强了 Web 端 assistant grouping；但当前移动端仍保留“任意较新的历史缓存更新后清空 live assistant”的条件。也就是说，最新版本确实可以正确发送用户消息，同时仍然存在 AI 回复终态丢失与视觉抖动，两者并不矛盾。

## 6. 建议的修复顺序

### P0：先保证内容永不消失

1. 将 Web 的 `finalizeStreamingTurn` 语义移植到移动端：收到成功终态时，把完整 live assistant 原子提交到本地 committed messages，然后再清 streaming 标志。
2. 不允许 `dataUpdatedAt` 单独触发清理。只有服务器快照能够按 `turnId` / assistant segment id / canonical message id 确认包含本轮最终消息时，才用服务器行替换本地终态行。
3. 在服务器侧强化顺序：终止事件和 `session.updated` 至少应建立在最终 transcript append 已完成之后；或者终止事件携带可校验的最终 assistant payload 和 transcript revision。即使服务器强化，客户端仍需容忍旧快照，不能把正确性完全交给网络时序。

### P1：消除主要闪烁和列表争抢

1. 默认关闭流式 Markdown 淡入，至少先做 A/B 验证；如保留，必须尊重“减少动态效果”，并避免 50 ms 一次重启更长动画。
2. 将流式 UI flush 合并到 80–120 ms 或按 animation frame/可见性自适应；首先测量，目标不是盲目降低 token 实时感。
3. 列表只能有一个持续跟随控制者。优先恢复 FlashList 的 `autoscrollToBottomThreshold` + `animateAutoScrollToBottom:false`，并移除内容每次增长后的手动 `scrollToEnd`；或者明确关闭 FlashList anchoring 后完全由自定义 hook 负责，不能两者并存。
4. 评估升级 FlashList 与 enriched-markdown，但分别做升级，不要把依赖升级和状态修复揉成一个难以归因的改动。

### P2：收口边界抖动

1. assistant 文本块使用协议级稳定 segment id，而不是内容块下标作为 React key。
2. 流式过程中固定一种渲染策略：例如 live 阶段使用稳定的纯文本/轻量 Markdown，完成后一次性切换到富 Markdown；或者让表格 fallback 的选择在整轮开始后保持不变。
3. 对思考/工具区的自动收起做一次性、可预测的布局过渡，避免和终态消息替换、滚动跟随发生在同一帧。

## 7. 必须补上的回归测试与验收标准

### 自动化测试

1. **终态旧快照测试（必需）**：live assistant 已有完整文本；收到 `run_end`；第一次历史刷新不含 assistant；断言答案仍在；第二次刷新含持久化 assistant；断言文本无中断、row identity 稳定、无重复。
2. **延迟矩阵**：人为注入 transcript 可见延迟 `0 / 100 / 400 / 1000 ms`，上述断言全部成立。
3. **滚动所有权测试**：流式内容高度连续增长时，每个布局周期只允许一种自动定位路径；用户上滑后不能被拉回底部。
4. **渲染器测试**：普通文本、列表、未闭合代码块、完成代码块、流式表格分别验证 MarkdownView mount 次数和 row key 稳定性。
5. **回收测试**：长会话上下滚动复用 cell，断言不会短暂展示上一条 Markdown，重点覆盖 iOS Fabric。

### 设备验收

- iOS 和 Android 各至少一台中低端真机，使用 release build，而不是只看开发模式。
- 场景包括：短纯文本、超过 5 KB 的长回答、中文列表、代码块、表格、工具调用、思考区、弱网、断线恢复。
- 录制 60 fps 屏幕视频，同时记录 React commit 次数、`onContentSizeChange` 次数、`scrollToEnd` 次数、JS/UI FPS 和最终 transcript revision。
- 通过标准：完整答案从第一次可见到持久化确认之间始终存在；不存在上一条内容闪现；用户停留在底部时没有可见的逐帧上下跳；用户上滑后不会被自动拉回。

实施后已运行完整移动端测试：146 个测试文件、784 项测试全部通过；同时通过 ESLint、移动端 TypeScript 检查和 agent stream client 类型检查。新增的终态确认测试覆盖旧快照、同 turn 的部分文本、完整持久化答案、无 turn id 的旧记录、工具结果以及跨用户轮次误匹配。原生渲染和列表回收仍需按设备验收矩阵做真机视觉确认。

## 8. 调查边界

当前环境没有已连接的 Android 设备或已启动的 iOS Simulator，因此本报告没有伪造 FPS、掉帧比例或设备录屏结论。P0 结论来自可确定执行的状态路径和纯状态回放；P1/P2 结论来自当前应用配置、锁定依赖的原生实现、提交历史以及上游已确认问题。下一步应先用上述回归测试固定 P0，再用真机 A/B 将各个视觉放大器逐项隔离。

## 来源

[^1]: Software Mansion, [Enriched Markdown API Reference — `streamingAnimation`](https://github.com/software-mansion/enriched-markdown/blob/main/docs/API_REFERENCE.md#streaminganimation).
[^2]: Software Mansion, [Streaming markdown re-parses entire document on every update — Issue #391](https://github.com/software-mansion/enriched-markdown/issues/391).
[^3]: Shopify, [FlashList usage — `maintainVisibleContentPosition`](https://shopify.github.io/flash-list/docs/usage/#maintainvisiblecontentposition).
[^4]: Shopify, [Chat screen maintainVisibleContentPosition jump/glitch — Issue #2018](https://github.com/Shopify/flash-list/issues/2018).
[^5]: Software Mansion, [Reset cached style state in Fabric prepareForRecycle to stop stale-markdown flicker — PR #482](https://github.com/software-mansion/enriched-markdown/pull/482).
[^6]: Software Mansion, [Enriched Markdown v1.0.0 release notes](https://github.com/software-mansion/enriched-markdown/releases/tag/v1.0.0).
[^7]: Software Mansion, [Enriched Markdown v1.0.2 release notes](https://github.com/software-mansion/enriched-markdown/releases/tag/v1.0.2).
