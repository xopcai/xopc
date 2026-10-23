# 三端 Chat 流式渲染优化落地记录

日期：2026-10-13。对应 [调研与阶段方案](./mobile-chat-rendering-research-2026-10-13.md)。

本轮已实现鸿蒙、Android、iOS 的流式提交合并、稳定渲染身份、局部新增文字动效、滚动协调和长内容展示限制。验证结果是代码、构建及功能回归证据；没有将模拟器结果解释为真机帧率、功耗或内存改善幅度。

## 1. 阶段与实际交付

| 阶段 | 已落地 | 验证边界 |
| --- | --- | --- |
| P0 契约与基线 | UTF-16 offset、重复包、缺口、多 messageId、持续小包、完成前 flush、语法分包、长回复、持久历史衔接的回归 fixture | 尚未采集三端真机帧时间、功耗及内存基线 |
| P1 稳定更新 | 首段立即提交；后续目标 32ms 合并提交；控制事件先 flush；稳定消息身份；完成时保留未确认文字；用户阅读暂停跟随 | 持续事件不会因为重复重置 debounce 而一直不显示；仍受平台线程调度影响 |
| P2 Markdown | 鸿蒙增量封存前缀与可观察片段；Android 后台 CommonMark 解析及稳定 AST 投影；iOS 后台块/行内解析与稳定 UUID；补内部/文件链接分流 | 保留各端原生解析器，未宣称完全一致的 CommonMark/GFM 能力 |
| P3 柔和输出 | 新增尾部范围约 180ms 渐显；旧内容不重复渐显；减少动态效果、离开前台、阅读/选择及过长文本停用装饰动效 | 真机参数调优与掉帧对比尚未完成；没有引入全消息 blur 或逐字永久节点 |
| P4 长内容 | 长代码与表格默认前 40 行、可展开；代码复制保留全文；固定表格列宽；列表续行缩进；后台缩略图与 iOS 有界图片缓存 | 展开后的内容仍需实际布局；尚未量化千条历史及大量图片场景 |

## 2. 数据与呈现规则

收到的数据与已显示的字符串分别管理，offset 对照“已显示 + 已缓冲”校验。重复包允许重叠验证后仅补剩余部分；缺口进入已有恢复机制。缓冲区在第一次小包后使用固定提交期限，后续事件追加数据，避免不断延期。消息结束、run_end、暂停及切会话按生命周期 flush 或清理，阻止旧会话事件污染新会话。

流式内容与持久历史通过 messageId/sourceIds 衔接。Android、鸿蒙保留展示身份映射；iOS 使用与持久消息一致的 messageId。run_end 不先删除最后文字再等待 REST；历史失败时仍能阅读最后回复。多段回答、narration 与最终回答分别按现有协议处理，避免重放再次出现已结束的 narration。

三端继续使用原生文本、链接、选择和媒体预览。新增动效仅作用于新增范围，原生文本仍执行必要的测量；这项优化不能使长文本排版成本变成常量。

## 3. 平台实现

### 鸿蒙

- [chatStreamBuffer.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/chatStreamBuffer.ets) 缓冲 delta，commit 时一次拼接；[chatViewModel.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/viewmodel/chatViewModel.ets) 管理提交期限和恢复生命周期。
- [markdownStreamParser.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/markdownStreamParser.ets) 在代码 fence 外的空行封存前缀，只重解析未封存尾部；编辑和 CRLF 回退完整解析。此规则只适用于当前不支持文档级引用定义的自研方言。
- [markdownProjection.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/common/markdownProjection.ets) 用 `@ObservedV2/@Trace` 保存 block/span，避免稳定 key 下内容不更新。封存对象直接复用，避免重复序列化已完成表格。
- [MarkdownView.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/MarkdownView.ets) 使用稳定片段、系统颜色动画、保守的追加边界检查、列表正文缩进、表格横滚与代码折叠。
- [ChatView.ets](/Users/micjoyce/develop/github/xopc/apps/mobile-harmony/entry/src/main/ets/view/ChatView.ets) 合并滚动请求，保留键盘动画期间的协调逻辑；文本选择暂停跟随。

### Android

- [ChatStreamBuffer.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/ChatStreamBuffer.kt) 保存多个消息段；[GatewayViewModel.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/GatewayViewModel.kt) 合并发布并按历史确认移除 live 内容。
- run 订阅启用 compact；接收 `assistant_message_end.presentation`，结束的 narration 移入进度展示。历史模型保存 sourceIds/renderId，避免聚合消息完成时换 key。
- [MarkdownContent.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/MarkdownContent.kt) 在 Default dispatcher 解析，用 source span 和语义 fingerprint 复用完成的 AST 块。引用定义变化会使依赖它的旧块更新，避免错误冻结文档前缀。
- [StreamingMarkdownText.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/StreamingMarkdownText.kt) 在绘制阶段读取动画值，按 TextLayoutResult 的新增范围绘制轻量遮罩；用 ICU 检查字形边界。动画不驱动 Markdown 重解析。
- [MainScreen.kt](/Users/micjoyce/develop/github/xopc/apps/mobile-android/app/src/main/java/ai/xopc/mobile/ui/main/MainScreen.kt) 用一个滚动协调器处理异步排版后的尾部变化。历史 prepend 先暂停跟随，再按 renderId 与带符号的 offset 恢复位置，防止与自动跳底竞争。
- 图片解码移到后台并采样；长代码复制全文；列表原生测量标记宽度以设置续行缩进，表格按相同列宽和 Markdown 对齐展示。

### iOS

- [ChatStreamBuffer.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/ChatStreamBuffer.swift) 使用 UTF-16 缓冲校验；[AssistantState.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/AssistantState.swift) 管理 flush、终止与前后台恢复。
- [MarkdownBlocks.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Core/Models/MarkdownBlocks.swift) 保留块、表格行和单元格 UUID；[MarkdownBodyView.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/MarkdownBodyView.swift) 让 live/durable 使用相同展示路径。
- [StreamingMarkdownText.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/StreamingMarkdownText.swift) 后台解析 AttributedString，保留前缀，仅对新增字符范围渐显；过长段落直接显示。
- [AssistantView.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/AssistantView.swift) 合并滚动请求，异步内容实际高度变化后补跟随；拖动、长按阅读取消待执行滚动。
- [MarkdownImageView.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Features/Assistant/MarkdownImageView.swift) 按展示尺寸后台生成缩略图，缓存上限 64 项/16MiB，身份包含 gateway、conversation、source 和尺寸。
- 历史请求启用 compact，保留原有 50 的分页请求上限；本轮没有减少可请求的历史范围。应用内会话链接只取一页 compact 元数据来确定会话所属 Agent。

## 4. 链接与排版核对

鸿蒙保留原有内部路由、工作区文件、外链确认和失败提示。Android 修复 HTTP 外链无动作，HTTP/HTTPS 进入确认流程，文件链接进入已有认证预览路径；补自动化的路径和查询形式。iOS 新增 [MessageLink.swift](/Users/micjoyce/develop/github/xopc/apps/mobile-ios/XopcMobile/Core/Models/MessageLink.swift) 与统一 openURL 分流，支持笔记、任务、项目、会话、自动化运行、受管理文件和工作区文件，普通 HTTP(S) 由系统打开。外部网页即使路径类似产品路由，也保持外链属性。



## 5. 已删除的旧路径

- Android 删除旧 `appendDelta` 及其 32KB 静默截断，删除单独的 live-output 文本渲染分支，改为同一消息呈现列表；liveText 只剩派生状态。
- 鸿蒙删除 Markdown 计算 getter 中的重复解析，删除文字/JSON 内容型 block、span、行和单元格 key；合并重复滚动请求。
- iOS 删除 pending 的原始 Text 与持久 Markdown 双展示路径，以及整条 pending 气泡变淡；不再于更新时重新生成全部 Markdown UUID。
- 原有协议恢复、共享 Markdown 入口、减少动态效果和媒体预览保留。辅助状态和测试按职责拆文件，避免留两套实现。

## 6. 验证记录

| 平台 | 验证 | 结果 |
| --- | --- | --- |
| 鸿蒙 | host Vitest 全量 | 113 文件、741 测试通过；最后的渲染/流式/键盘定向回归 3 文件、83 测试通过 |
| 鸿蒙 | Hvigor debug assembleHap | 构建通过；当前没有连接的 hdc 设备，未做安装与真机视觉验收 |
| 鸿蒙 | 项目既有 CodeLinter 配置 | 修改的 ArkTS 无相关诊断；保留启动图标尺寸 suggestion，含测试副本共 9 条 |
| Android | managed Gradle wrapper：`:app:testDebugUnitTest :app:compileDebugAndroidTestKotlin :app:lintDebug` | 47 单元测试通过，设备测试编译及 lint 通过；没有 lint Error，现有 Warning/Hint 不等于零告警 |
| Android | `:app:connectedDebugAndroidTest`，隔离 API 35 模拟器 | 2 项持续输出/上滑/历史分页测试，11 项 Markdown/复制/链接/compact 事件测试通过 |
| iOS | xcodebuild test，iPhone 17 Pro Simulator | ChatRendering、MarkdownBlocks、FeatureState、AssistantRecovery、GatewayModels、ChatImageSource、AppRoot 共 7 suites、55 tests 通过 |
| iOS | SwiftLint | 无本次新增诊断；保留未修改 RealtimeVoiceCall 的复杂度提示 |

Gradle 验证问题及回答：

1. “Android 流式渲染修改后的单元测试、编译和 lint 是否通过？”——通过，任务见上表。
2. “Android 流式输出时的尾部跟随、上滑阅读和历史分页是否正常？”——2 项定向设备测试通过；发现并修复分页与跟随竞争。


后续验收仍需在鸿蒙、Android、iOS 真机上固定刷新率与构建配置，重放 20KB/100KB 回复、长段落、展开后的长代码/表格、图片与大量历史，记录帧时间、显示积压、峰值内存和功耗，再调整合并间隔与动效参数。
