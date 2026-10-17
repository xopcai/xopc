# 移动端 Chat 流式渲染与交互性能调研

日期：2026-10-13。源码基线：`9267a80ae`。范围：鸿蒙 → Android → iOS，覆盖 AIMessage 增量输出、Markdown、消息列表、滚动、图片和流式结束后的历史衔接。

本轮是源码审查、官方资料核对与部分逻辑回归，未修改移动端运行时代码，未进行三端真机性能录制。文中的优化目标是拟定的验收口径，不是已测得的性能收益。按此前上下文，将语音中的“MHZ 输出”理解为 AIMessage 流式输出。

## 1. 结论与优先顺序

三端都有优化需求，但现状不同。三端外层消息列表已经使用按需创建的容器；主要改进机会集中在消息内部更新、实时到历史的衔接，以及布局和滚动的协调。优先完成稳定性与更新成本治理，再加入局部尾部动效。

| 平台 | 已有基础 | 源码确认的改进点 | 建议优先级 |
| --- | --- | --- | --- |
| 鸿蒙 | ArkUI V2；`List + Repeat.virtualScroll`；消息、语义 part ID；compact 历史和流；分页锚点、暂停跟随、前后台恢复 | delta 复制所有 live blocks，重算聚合文本；变化的整段 Markdown 重解析；Span、表格 key 含文字；滚动采用重置式 50ms 延迟 | 首个试点：更新调度、稳定片段、滚动协调 |
| Android | `LazyColumn` 和历史消息 key；原生 CommonMark/GFM；compact 历史；重连和前台恢复；分页锚点 | delta 更新大的 `ConnectionUiState`；`remember(markdown)` 对变化的全文无复用；单个 liveText；实时订阅没有 compact；图片同步解码 | 第二个落地：流投影、尾部状态、解析与图片线程 |
| iOS | iOS 17+ Observation；`LazyVStack + ForEach`；compact 实时流；图片后台缩略解码；前台恢复 | 流式纯文本、历史才 Markdown；历史重解析生成新 UUID；history 没有 compact；terminal 等待 REST 衔接；messages 数组在 MainActor 逐事件变化 | 第三个落地：身份和最终衔接先行，再加流式 Markdown |

推荐共同方向：可靠事件处理 → 有界的显示提交 → 稳定的消息/片段模型 → 原生 Markdown 渲染 → 布局完成后的单一滚动协调 → 仅新内容的轻量动效。

Web 已落地的稳定身份、增量订阅、有限积压和复杂内容按需加载原则可以复用。React、DOM、Streamdown、CSS 动画实现不能直接移植到原生；Web 的节点数和提交耗时也不能代替移动端帧率证据。

## 2. 鸿蒙：已有虚拟化，重点是 live 消息内部

### 2.1 实际更新链路

`chatViewModel.event` → `reduceChatStream` → `@Trace liveRow / streaming / thinking / tool` → `chatPresentationRows` → 虚拟消息行 → `ChatMessageContent` → `MarkdownView` → Text/Span → 消息高度回调和滚动跟随。

源码证据：

- [chatViewModel.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/viewmodel/chatViewModel.ets:550)：offset 缺口触发恢复，正常事件立即发布 liveRow 和派生文本；未见专门的显示合并队列。
- [chatStream.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/chatStream.ets:6)：复制 live row，并 map 所有 blocks、activityTools；文本增量只修改一个目标 block。
- [chatRichContent.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/chatRichContent.ets:199)：每次 refresh 重新 filter/map/join text、thinking、tools。
- [chatPresentation.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/chatPresentation.ets:22)：保留历史对象基础，但复制列表；遇到历史尾行与 live 同 turn 时还要合并投影。
- [ChatView.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/ChatView.ets:1349)：外层已有 conversationId + row.id 的 key、virtualScroll、cachedCount(3)。不需要再次做一套整页虚拟化。

这些代码证明存在逐事件分配和派生计算；是否已造成明显掉帧、占比多大，需要 Frame trace 判断。不能从整行替换直接推断所有历史行都重新创建。

### 2.2 Markdown 稳定性与成本

[MarkdownView.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/MarkdownView.ets:107) 的 `@Computed blocks` 调用全文 `markdownBlocks(content)`。`@Computed` 能缓存不变输入，尾部 content 改变时仍需重算。[markdown.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/markdown.ets:33) 将全文规范化、split 成行，并创建新的块；块 id 是当次解析的序号。

行内还有独立的 `markdownSpans(content)`；块解析为找图片也会扫描行内语法。普通文字、列表、未闭合代码/表格持续增长时，已有前缀重复参与计算。随着文字增长，固定大小 delta 的全文重解析会使累计工作量越来越大，实际耗时须测量。

关键身份问题在 [MarkdownView.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/MarkdownView.ets:76)：Span key 包含 `span.text` 和 href；表格行 key 序列化所有单元格，单元格 key 也包含文字。内容增长会改变身份。块层 `id + kind` 比全文 key 更稳定，但序号仍不能表达语法改变后的片段身份。

**不能只删除 key 中的 text。** 当前 Span 是普通对象，ForEach 的身份更新承担了一部分刷新职责。需要先建立可观测的 span/片段或能更新参数的渲染边界，再改为稳定 key，并验证文字确实更新。否则可能把节点重建改成尾部不更新。官方 V2 文档要求使用实际创建的 `@ObservedV2` 实例和 `@Trace` 属性实现嵌套属性观测；展示模型宜独立于网络 DTO。[OpenHarmony V2 状态管理](https://raw.githubusercontent.com/openharmony/docs/master/en/application-dev/ui/state-management/arkts-new-observedV2-and-trace.md)

### 2.3 滚动与长内容

[ChatView.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/ChatView.ets:347) 在消息变化时 updateReplySpace，然后取消旧定时器、50ms 后跟随到底。这是滚动延迟，不是文本合帧。高频事件持续到来时可能反复推迟该路径；已有区域变化补偿逻辑，也可能帮助跟随，需要联合录制确认。

保留现有用户滚动来源判断、历史分页锚点、首次定位重试和 composer 留白。将“消息更新、图片高度变化、键盘高度变化”交给一个协调器，在布局可用时做一次定位，避免多个入口竞争。持续流不能无限重置跟随期限。

代码块目前是全宽普通 Text，未见横向滚动设置；表格已有横向 Scroll，但所有行在单个消息内部创建。外层虚拟列表无法减少一个超长可见消息内部的全部布局工作。优先补代码横向阅读和长内容明确的展开策略；超大表格/代码再评估分区渲染，避免短内容承担复杂度。

鸿蒙的第一阶段宜采用稳定 row/part 展示对象，保持已完成 blocks 实例，只更新 active part 的可观测文本/revision；原始文本、复制内容和协议 offset 继续保持完整。平台已有 V2 能力，无需先迁移框架。Repeat 官方指南要求同一数据项保持一致 key，长列表支持可见范围按需加载。[OpenHarmony Repeat](https://raw.githubusercontent.com/openharmony/docs/master/en/application-dev/ui/rendering-control/arkts-new-rendering-control-repeat.md)

## 3. Android：保留 CommonMark，改变更新和解析入口

### 3.1 实时状态与解析

[GatewayViewModel.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/GatewayViewModel.kt:2528) 将每个 assistant_delta 拼入 liveText，然后更新大的 ConnectionUiState。历史消息对象大多可保留，但 Chat 容器读取 liveText，滚动与留白 effect 也依赖它。

当前 liveText 只保存一个 messageId 的文本：messageId 改变时 previous 变为空串。多 segment 输出需要依赖历史刷新来衔接；它缺少鸿蒙那样的 live parts 容器，应先用 fixture 验证“前段保存延迟 + 后段开始”的可见完整性。

[MarkdownContent.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/MarkdownContent.kt:78) 的 `remember(markdown)` 可以复用不变历史，变化的 liveText 会重新执行 `markdownParser.parse`。新 AST 节点也使基于 `remember(node)` 的行内结果失效。块列表是 Column + forEach，没有领域片段 key。

保留 CommonMark + GFM tables/strikethrough 和原生 Text/AnnotatedString。优先把解析从 Composable 主线程入口移到显示投影层，产出稳定的渲染 DTO；按 source revision、part identity 缓存已完成块；active tail 以有界频率更新。后台解析结果用 conversation/transcript/run/revision 校验后再提交，旧结果不能覆盖新文本。CommonMark 官方说明 Parser 配置可以复用且支持多线程调用；共享可变 AST 和更新渲染状态仍应由应用控制。[commonmark-java](https://github.com/commonmark/commonmark-java)

项目 Kotlin 2.3.20，Compose compiler plugin 已启用。Strong skipping 自 Kotlin 2.0.20 默认开启，不能仅凭 List 参数类型就断言整个列表每个 delta 重组。应查看 compiler reports、实际 recomposition 和 trace；不建议批量添加 `@Stable`、`@Immutable` 掩盖可变模型。[Android Strong skipping](https://developer.android.com/develop/ui/compose/performance/stability/strongskipping)

### 3.2 协议、滚动和图片

- [RealtimeClient.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/gateway/RealtimeClient.kt:69)：run 的 subscribe item 只有 topic/afterSeq，未传 `view: compact`。历史已使用 compact，实时端需要在协议回归后补齐，仍保留 seq/gap/replay；不要另建 topic。
- [MainScreen.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/MainScreen.kt:2592)：底部定位等待 frame，再 scrollToItem/scrollBy；依赖 liveText 的 LaunchedEffect 持续变化时会取消重启。还应测量 row height → state map → replySpace → scroll 的反馈链。
- [MainScreen.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/MainScreen.kt:2750)：已有 LazyColumn 消息 key；保留。live row 当前使用常量 `live-output`，迁移时应与 run/segment 身份和最终消息匹配。
- [ChatMessageContent.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ChatMessageContent.kt:318)：缩略图解码在 remember 中同步执行。remember 减少重复次数，但首次解码仍在组合调用路径。
- [ChatMessageContent.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ChatMessageContent.kt:418)：大图预览直接 decodeByteArray，缺少该处缓存。建议后台解码、按目标像素采样、结果缓存与取消；先定位大图出现时的主线程长任务。

普通 Markdown 代码块已有横向滚动；表格用各单元格独立 widthIn，不能保证不同内容长度的同列宽一致。需用公共列宽模型，兼顾字体缩放、空单元格、中文和长 URL。

Android 官方建议计算结果缓存、稳定 lazy key、缩小状态读取范围；高频纯视觉变化应尽可能在 layout/draw 阶段读取。这里的文字改变确实需要文字测量，不能用 graphicsLayer 绕过文本布局。[Compose 性能实践](https://developer.android.com/develop/ui/compose/performance/bestpractices)

## 4. iOS：先消除纯文本到 Markdown 的突变

### 4.1 已有 Observation，但流式和历史不是同一条渲染路径

[AssistantState.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/AssistantState.swift:5) 已是 `@MainActor @Observable`，无需再建议从 ObservableObject 全面迁移。每个 delta 定位 live message、校验 UTF-16 offset 并修改 messages 数组中的 text。[事件处理](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/AssistantState.swift:297)

live TimelineMessage 默认 `markdownParts = []`；流式更新只追加 text。[MessageBubble.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/MessageBubble.swift:198) 在没有 parts 时使用 `Text(verbatim:)`。结束后 reload 历史，[AssistantTimeline.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/AssistantTimeline.swift:41) 才执行 MarkdownBlock.parse。

因此 iOS 当前没有逐 delta 全文 Markdown 解析的问题，却有流式阶段显示标记、结束后结构改变的问题：标题、代码、表格、图片可能在结束后改变高度和样式。应让同一套稳定 part 模型覆盖 live 和 durable；完成时保留节点，只改变完成状态/补充元数据。

### 4.2 Markdown 身份和历史数据

[MarkdownBlocks.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Core/Models/MarkdownBlocks.swift:238) 的 MarkdownPart.init 每次生成 UUID；表格行/单元格同样生成 UUID。因此 UUID 在一份已解析模型内稳定，但历史再次解析后不稳定。History reload 会重建所有 assistant parts，ForEach 可能重建视图和图片状态。这需要内容 revision 缓存及 stable part id 的 reconciliation，而不是把 UUID 换成全文 hash（全文变化仍会改变身份）。

[GatewayClient.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Core/Networking/GatewayClient.swift:213) 请求 history 仅传 limit=50，没有 view=compact；服务端只在明确 compact 时走 compact 投影。实时 run 已 compact。统一 history 时要重新核对 WireMessage 解码、详情获取、turn 分页与游标语义，不能只加 query 后认为完成。

历史转换在 AssistantState 的 MainActor 调用路径执行，整页重解析可成为长任务候选。缩小读取到单独 live row/part，可避免高频 messages 数组变化扩散至 timeline 的派生工作；实际哪些 body 重新运行由 Instruments 确认。Apple 建议用更新因果关系和长 body 更新来定位，而不是根据状态模型外形判断开销。[WWDC25 SwiftUI 性能](https://developer.apple.com/videos/play/wwdc2025/306/)

### 4.3 列表、图片和版本边界

[AssistantView.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/AssistantView.swift:329) 已有 LazyVStack、消息 ID、暂停跟随、composer 留白；多个 onChange 分别触发 scrollTo，宜统一到一次布局后的跟随请求。[ChatScrollInteraction.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/ChatScrollInteraction.swift:8) 在 iOS 18 使用 scroll phase，iOS 17 有手势回退。必须保留最低 iOS 17 可用路径。

[MarkdownImageView.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/MarkdownImageView.swift:124) 已使用后台 ImageIO 缩略解码和请求身份，不应重复做“移出主线程”的工作。后续重点是 part 稳定后避免重建触发重复加载、共享缓存，以及紧凑缩略图按实际展示尺寸解码；当前 maxPixel 使用 1600 × displayScale，紧凑模式也走这一上限。

iOS 可评估 Swift 官方 `swift-markdown` 替换自研块语法分析：它基于 cmark-gfm，提供持久化的线程安全值类型语法树，但不等于自带流式 append parser 或原生 Chat UI。需先用统一 fixture 验证语法、包体、最低版本和解析耗时，锁定版本；不能把库替换作为身份问题的自动解决方案。[Swift Markdown](https://github.com/swiftlang/swift-markdown)

## 5. 三端共享的设计边界

### 5.1 接收完整事件，合并显示提交

协议 ingest 必须及时处理 seq、UTF-16 offset、重复 replay、缺口、message_end、run_end、abort、工具与确认事件。保持权威文本和已接收游标；显示可以稍后提交，不能拿“已显示长度”校验新 delta。

在语义 reducer 与原生 UI 之间加一个单一显示调度器：

1. 同一个 run/segment 的文本 delta 顺序累积；在下一个显示提交窗口合并发布。初始可试 16–33ms，压力场景可放宽至约 50ms，最终以真机结果决定。
2. 不使用无限重置式 debounce；连续事件仍需按最长等待期限提交。安静时不保留空转 ticker，也不强制 120Hz 解析文字。
3. 首段尽快显示，建议以收到事件到首个可见字形 p95 ≤ 50ms 为初始目标；正文显示积压上限初始设 250ms，超限扩大批次/取消装饰动画追平。
4. terminal 先 flush，再做完成 reconciliation；abort 显示已接收前缀；切会话、换 transcript、重置和后台切换取消旧任务。
5. 若控制显示字符边界，使用 grapheme cluster，避免切开 emoji、组合字符和换行。协议 offset 仍按当前服务端 UTF-16 契约处理。

这些数值是建议的起测参数。文字提交频率与屏幕刷新率独立：例如 30 次/秒的文本提交，配合平台插值绘制，仍可有连续视觉效果；无需每个刷新周期重新解析 Markdown。

### 5.2 稳定展示模型和语义尾部

约定 conversation/transcript/run/message/part 身份，区分 identity 与 revision。已完成消息保持模型和渲染片段；列表只在新增、删除、分页、重排时改变结构；文字在 active part 内更新。

鸿蒙用专门的 V2 可观测展示类；Android 用每个 live part 的 State/Flow 或稳定不可变快照；iOS 用每 row/part 的 Observation 状态。保留 DTO 与存储协议，不把平台观察机制序列化到网络数据中。

Markdown projection 输出：稳定前缀 blocks、仍可能变形的语义尾部、引用定义依赖，以及完成状态。尾部可以从段落变为表格/标题或补齐行内链接；reconciliation 尽量保持领域 part 身份，必要结构切换只影响相关片段。

不能直接按空行拆分并永久冻结：引用式链接、Setext 标题、列表/引用续行、fence 和表格都可能跨边界影响语义。第一版可采用合并后的全文解析 + 未变前缀 diff/cache，把收益先放在 UI 身份和重建范围；随后再为声明支持的语法加入增量尾部解析。完成时完整解析校验，允许更新受影响前缀但不重新播放渐显。

对单个很长的未闭合段落/代码，尾部仍可能越来越大。应减少提交频率、后台解析、复用行内/布局结果并提供明确的长内容查看方式。多加外层列表虚拟化不能解决这一类开销。

### 5.3 动效应作用于新增范围

先做调度和身份，再对 active message 的新增文字做轻量 opacity 渐显或局部尾部遮罩。初始可试 150–250ms，最多保留一个或少量活动视觉层。尾部区域是实际布局末端新增的文字范围，不能用整个气泡底部固定条带替代，否则多行和代码会出现错误遮罩。

采用平台绘制/动画能力，动画状态尽量不使整段 Markdown 重新解析。Android 用 draw/graphicsLayer 局部状态；SwiftUI 将 animation/transaction 限于新增范围；鸿蒙优先系统动画 API。避免逐字创建永久节点、大范围 blur 和全消息透明度反复归零。原生文本的 append 仍需要必要的测量，动效只是视觉层。

历史、replay、前台恢复和滚回旧内容默认直接显示；减少动态效果、不可见页面、重负载、文字选择时停用装饰效果。持续输出可优先局部渐显，精确字形遮罩只有在能力和性能都验证后再启用。系统动画接口通常更适合常见动画，仍需针对本应用测量。[鸿蒙动画实践](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-animation-usage-guide)

### 5.4 滚动、完成衔接和其它 Chat 交互

每端一个 ScrollCoordinator，处理跟随/用户阅读/历史 prepend/键盘布局变化。把连续事件转换成一个待执行请求，在文字、图片和留白布局稳定后执行；用户拖动、选择、查看详情时暂停自动跟随。跳回最新是明确操作。保留位置用 row ID + 相对 offset，不能依赖变化的序号。

流式完成采用“同一展示节点升级为已保存消息”：最终 REST 成功前保留最后文本；持久消息确认后原地 reconcile。Android 当前 run_end 清空 liveText 后才刷新历史，存在网络较慢时暂时空缺的代码路径；iOS terminal 等待 reload 才完成切换，需以状态 flush 与历史补充解耦。重连/缺口恢复仍沿用近期修复，不把全部正常流强制切回 snapshot 轮询。

图片/附件解析、缩略图、媒体加载单独排队；有界缓存和并发限制；占位尽量保留尺寸；请求身份包含 gateway/conversation/source，切会话取消旧结果。长回复过程中同时打开键盘、输入、上滑历史、展开代码、预览图片，是同等重要的验收场景。

### 5.5 Markdown、链接和排版契约

保留各端原生渲染，定义跨端能力矩阵和同一批 fixture。Android 的 CommonMark 和鸿蒙/iOS 自研块解析不是同一语法实现；短期明确支持段落、软换行、标题、列表、引用、代码、GFM 表格/删除线、图片和产品链接，长期再扩大兼容。不要在三端继续零散增加互不一致的正则分支。

当前已发现的差异：

- 鸿蒙有内部 route/file 分流、外部 HTTP(S) 确认与失败提示，可作为行为基线。[messageLink.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/messageLink.ets:8)
- Android Markdown 安全过滤允许 HTTP/HTTPS，但 Chat openLink 外部路径仅处理 `https://`：HTTP 链接会呈现可点击样式后无动作。需明确统一的产品策略，支持则打开，不支持则不要生成可点击样式并给出反馈。[链接入口](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/MainScreen.kt:2545)
- iOS Markdown 行内使用 `Text(.init(text))`，当前 Chat Markdown 路径未找到内部产品 route/file 的 openURL 拦截；系统文本链接能力不能代替应用内导航。需验证 xopc://、#/、工作区文件和普通外链，并补统一 dispatcher。[MarkdownBodyView.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/MarkdownBodyView.swift:90)
- Android inline Markdown image 当前输出 alt 文字，独立媒体附件另有图片渲染；鸿蒙/iOS 支持 inline image。要区分附件展示和 Markdown 图片能力，避免三端误判为已完全一致。
- 三端列表标记目前多为文字前缀，续行缩进要做 hanging indent 验收；代码保持等宽、横向可读、原文复制；表格列宽跨行一致，字体放大后可横滚；标题与正文层级、段间距、引用宽度按移动端设计系统核对。

链接先判断内部产品目的地和工作区文件，再走外部打开。原始 URI、查询和 fragment 不应被渲染片段切分损坏；不把 Gateway 授权信息附加到外部目标。已存在的图片来源与凭据边界要保留。半截流式链接在补齐前按文本显示，补齐后局部变为链接；完成/replay 不能重置点击和选择状态。

## 6. 分阶段落地建议

| 阶段 | 工作与平台顺序 | 出口条件 |
| --- | --- | --- |
| P0 基线与契约 | 三端可重放 fixture；先鸿蒙 Frame，再 Android、iOS trace；整理身份、UTF-16 offset、compact 能力、链接和排版矩阵 | 固定场景、设备/刷新率/构建配置；能区分网络、解析、UI 更新、布局和呈现时间 |
| P1 稳定更新 | 鸿蒙合并提交 + stable part 展示模型 + 滚动协调；Android compact run、terminal 保留与多 segment；iOS stable Markdown identity 与 history 衔接 | 连续事件不饿死；无重复/缺字；恢复结果正确；流式完成无空缺；旧节点状态保留 |
| P2 Markdown 性能与能力 | 鸿蒙缓存/前缀 reconciliation；Android 解析移出组合路径、稳定 AST 投影；iOS live/durable 共用 renderer，评估标准 parser；补链接和列宽等差异 | 流式与最终语义一致；旧前缀不重建；长回复边输入边滚动无明显退化 |
| P3 轻量动效 | 先在鸿蒙实测合适的尾部范围和时长，再移植 Android/iOS；增加减少动态效果、不可见、选择与压力降级 | 新内容柔和、旧内容不重播；加入动效后掉帧/积压/功耗不显著劣化 |
| P4 长会话与富内容 | 单消息长内容预算；Android 后台图片采样；三端缓存/并发/尺寸；大量历史和 prepend；键盘/详情/媒体交互 | 1000 行、长代码/表格、图片列表可用；内存有界；阅读锚点稳定 |

P1 已能带来更平稳的输出节奏。P2 完成后再做 P3，避免把动画绑定到不稳定节点。P4 中 Android 同步解码问题可提前处理，不必等全部动效结束。

每端新路径通过后，删除被替代的逐 delta 展示发布、内容型 key、重复滚动触发和双 renderer 分支。仍有用途的共享 Markdown 入口、协议恢复、平台版本适配不能误当 legacy 删除。无需长期并存两套 Chat 渲染器或加全局回滚开关。

## 7. 验收方法与本轮验证

### 7.1 场景与记录

| 类别 | 固定输入/操作 |
| --- | --- |
| 输出节奏 | 均匀小 delta；100ms–1s 的突发包；慢网/断网后 replay；run_end 前仍有待显示数据 |
| 内容长度 | 100/300/1000 消息；20KB/100KB 单回复；单个长段落；长代码、超长行；多列和多行表格 |
| 语法边界 | fence/链接/强调/表格分隔线分包；列表/引用续行；引用式链接在末尾定义；中文、ZWJ emoji、组合字符 |
| 完整性 | narration → answer 分类；多个 messageId；重复和缺失 offset；abort；后台/前台；切会话/reset；完成历史延迟/失败 |
| 页面交互 | 流式中输入、键盘开合、上滑、加载旧历史、选择/复制、图片加载/预览、代码横滚、字体放大、减少动态效果 |
| 链接 | 内部 note/task/project/session/file；带转义/中文/括号的 URI；外部 HTTP/HTTPS；片段；无效目的地和失败反馈 |

使用可控事件 replay，分开记录 `receivedAt → displayCommit → layout/present`；解析完成和 opacity 动画结束另记。UI 状态赋值时间不是首个可见字形时间。先比较相同设备、构建、刷新率、数据集下的前后结果，再讨论跨端一致性。

初始性能目标：60Hz/120Hz 分别参考 16.7ms/8.3ms 帧周期，文字解析与业务更新只占其中一部分；至少报告 p50/p95/p99、超时帧比例、最大连续丢帧、主线程长任务、display backlog、峰值内存与图片重复请求。不能用平均 FPS 掩盖突发卡顿，也不能把系统主动降刷新率误判为应用丢帧。绝对门槛在 P0 真实基线后锁定；功能正确性要求零丢字、零重复和无越会话提交。

平台测量方式：

- 鸿蒙：DevEco Profiler Frame + ArkUI Inspector，检查 CustomNodeUpdate、DirtyNodeUpdate、Measure/Layout、节点创建、AreaChange 与滚动泳道；真实设备 Release/profile 配置。官方给出基于 Frame trace 的页面卡顿定位流程。[华为 ArkUI 滑动卡顿分析](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-performance-53)
- Android：可分析的接近 Release 构建，Macrobenchmark FrameTimingMetric + Perfetto，辅助 compiler report / recomposition；frameOverrunMs 仅 API 31+，低版本另用适配测量。当前 release 未开启 minification，第一轮须保持前后构建一致，R8/Baseline Profile 单独评估。[Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)、[帧时间指标](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics)
- iOS：真实设备 Instruments Time Profiler、Hitches/Hangs、Allocations；工具与系统支持时用 Instruments 26 的 SwiftUI 更新因果图；iOS 17 最低版本也做功能/流畅度回归，不为使用新工具抬高最低系统。[WWDC25 Instruments](https://developer.apple.com/videos/play/wwdc2025/306/)

平台指南共同指向减少无关更新、稳定身份和实测回归；没有资料能证明某个固定渐显时长是所有原生 Chat 的通用标准。[Apple 身份与更新性能](https://developer.apple.com/videos/play/wwdc2023/10160/)

### 7.2 本轮完成情况

- 阅读三端实时事件、状态、Markdown、列表、滚动、图片与相关历史接口，核对官方 ArkUI、Compose、SwiftUI 和解析库资料。
- 鸿蒙 host 回归：6 个文件、49 个测试通过，覆盖 markdown、messageLink、chatCompactStream、chatPresentation、chatReplySpace、chatHistoryScroll。这些证明现有纯逻辑用例通过，不等于 ArkUI 节点复用、点击或帧率验收。
- 没有 Android/iOS 构建、模拟器 UI 验收或三端真机性能数据；未修改移动端源码。
- 近期前后台恢复报告已有各端验证记录，但不是本轮长回复性能基线，须保留现有修复并补相同场景回归。[前后台恢复与验证](../mobile-background-turn-continuity.md)

开始实施时，先完成鸿蒙 P0/P1，用同一组事件与交互场景证明提交有界、历史稳定、滚动不争抢。再按上述差异落实 Android 和 iOS，避免三端机械复制同一套 renderer 或动画参数。
