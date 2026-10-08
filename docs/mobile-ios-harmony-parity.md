# iOS 与鸿蒙功能及交互差异审查

- 日期：2026-10-08（Asia/Shanghai）
- 基线：`docs/mobile-reference/README.md` 的鸿蒙 BRA-AL00 截图（2026-10-04）、鸿蒙 `view`/service/viewmodel 与 iOS SwiftUI 源码、近期鸿蒙变更。
- 验证：Xcode 26.4.1、iOS 26.4 iPhone 17 Pro 模拟器、本地 Gateway `127.0.0.1:18790`。未连接鸿蒙真机。

## 功能矩阵

| 功能与路径 | 鸿蒙实现 | iOS 现状与本轮结果 |
| --- | --- | --- |
| 五个主 Tab 与底部输入 | `HomeView.ets` | 已有；模拟器连接 Gateway 后可见 |
| 固定个人 Agent 会话 | `SessionsView.ets`、`PersonalAgentAvatar.ets` | 本轮新增固定入口、名称/头像与 Gateway 状态；单测通过，跨端复用待验 |
| 会话列表、搜索、归档、删除 | `SessionsView.ets` | 已有；个人 Agent 已排除普通归档/删除菜单 |
| 对话发送、队列、停止、附件、引用 | `ChatView.ets`、`ChatActionPanel.ets` | 主要路径已有；本轮修正发送时丢失 `delivery` 参数；实时收发待完整端到端验证 |
| `/` 命令和 Skill 联想面板 | `chatPaletteViewModel.ets` 调用 `/api/commands`、`/api/skills` | 本轮新增 Gateway 目录获取、输入筛选和点选填入；基础 UI 旅程通过。鸿蒙支持光标中段匹配，iOS 目前只匹配开头 `/`，**细节差异 P2** |
| 消息详情、执行步骤、语音朗读 | `ChatExecutionDetailView.ets` 等 | iOS 有对应页面，设备交互待复测 |
| 语音通话与语音笔记 | `VoiceCallView.ets`、`NativeNoteEditor.ets` | iOS 有实时通话、录音、待上传恢复、转写；音频设备待复测 |
| 笔记列表、编辑、附件、讨论 | `NotesView.ets`、`DiscussionNoteView.ets` | iOS 有主要页面；鸿蒙 `/api/notes/sync` 离线同步模型未实现，**P2** |
| 任务验收标准与证据 | `WorkspaceView.ets` | 本轮按合同版本及证据区分通过/失败/待核对，增加产出与注意事项；真实任务数据待验 |
| 任务对话入口和消息 | `POST /api/tasks/:id/conversation`、`POST /api/tasks/:id/inputs` | 本轮新增创建/复用入口；iOS 发送前读取会话任务归属，拦截重置、清空、归档等命令。新版 iOS session command 与鸿蒙任务专用输入端点的凭证/消息契约不同，iOS 仍从普通 session command 端点发送，**服务端保护范围差异 P1**；正常 AI 回复未实测 |
| 项目列表、详情、任务编辑 | `ProjectSpaceView.ets` | iOS 已有主要页面，任务/项目状态联动待验 |
| 自动化列表、创建、运行、取消、重跑 | `AutomationRunView.ets` | iOS 已有；本轮加入关联工作流入口 |
| 工作流列表、详情、阶段、Agent 工作、取消 | `WorkflowView.ets` | 本轮新增完整页面/API；本地 Gateway 空列表可见，实际运行态待验 |
| 文件空间、最近文件、目录、搜索、上传、预览/编辑 | `FilesView.ets` | 本轮补“最近文件”入口；其余主要路径已有。`/api/files/resolve` 的路径解析入口未对齐，**P2** |
| 分享中心与文件分享 | `ShareCenterView.ets`、`chatMediaShare.ets` | iOS 有列表、撤销、延期和系统分享；对话产出的一键服务端分享 `/api/shares/auto`、结果页缺失，**P2** |
| Gateway 多配置、探测与切换 | `GatewayProfilesView.ets` | iOS 已有，本地 Gateway 直连可用；配对流程待验 |
| 系统/明/暗主题与语言 | `SettingsView.ets` | iOS 已有系统/明/暗和中英语言；鸿蒙五套颜色方案缺失，**P2** |
| 推送注册、停用、通知导航 | `pushNotifications.ets`、`notificationNavigation.ets` | iOS 只有系统通知设置入口；APNs token 注册、Gateway `/api/devices/me/push`、通知确认/跳转未实现，**P1**；需要 iOS 推送能力配置和 APNs 环境 |
| 端点工具/设备能力注册 | `realtimeClient.ets` 调用 `/api/endpoint-tools/principals` | iOS 未发现对应注册路径，**P2**；需先确认 iOS 支持的设备工具范围 |
| 发送气泡飞行动效 | 鸿蒙近期 `ChatView.ets` | iOS 仅有乐观消息行，**视觉差异 P3**；需尊重“减少动态效果” |

## 本轮验证

1. `xcodebuild` iPhone 17 Pro 模拟器编译通过，`XopcMobileTests` 的 Swift Testing **69 项通过**；文件传输集成测试在无 token 的单测执行中跳过。
2. `simctl launch` 向 App 注入本地 Gateway 测试变量后，已看到主界面及“进展 → 工作流”空状态。截图见 `workflows-empty.png`。当前 Gateway 工作流运行数为 0，阶段、取消与结果未实测。
3. `xcodebuild` 不会把 shell 环境的 `XOPC_E2E_GATEWAY_TOKEN` 自动传进模拟器 UI runner。使用模拟器 `launchctl` 设置测试环境后，“进展”、“我的/设置/Gateway/文件”与新增的 `/` 联想 UI 旅程通过；最近文件改动后，“我的/设置/Gateway/文件”再次通过。进展用例已改为只点击真实任务、项目和自动化行，避免空状态被误当详情。
4. 使用本地 Gateway 创建并清理隔离测试任务，验证了任务会话创建、`context-summary` 归属，以及鸿蒙任务专用输入对 `/new` 的保护性拒绝。工作流运行数为 0，运行态无法实测。

## 后续优先级

1. P1：iOS 推送注册与通知导航；统一任务会话的 Gateway 输入契约，让服务端保护覆盖 iOS session command。
2. P2：联想光标中段匹配、笔记同步、文件路径解析、对话产出服务端分享、颜色方案及端点工具能力。
3. P3：发送动效，鸿蒙真机与 iOS 设备复核键盘、安全区、无障碍和暗色视觉。

**iOS 尚未达到鸿蒙全部功能与交互对齐。**

## 2026-10-08 语音、图片与附件专项复核

本节以当前鸿蒙 `ChatView.ets`、`voiceCapture.ets`、`voiceCall.ets`、`chatReadAloud.ets`、`ChatMediaView.ets` 和 iOS 对应 SwiftUI 实现为准。2026-10-04 的鸿蒙真机截图只覆盖入口及部分静态状态；本节动态行为来自代码核对，未连接鸿蒙真机。用户提到的“破损的 AI / 实时绘画”名称尚不明确；两端聊天 Action 面板未找到独立的实时绘画入口，不能据此判断该能力已经对齐。

| 路径 | 鸿蒙现状 | iOS 本轮处理与状态 |
| --- | --- | --- |
| 实时语音通话 | 自然对话、工具助手两种模式；连接、静音、扬声器、恢复、实时字幕 | 已有对应模式和主要控制；代码核对，通话音频链路仍需真机验收，**未验** |
| 聊天语音输入 | 录音、试听、转文字或发送语音；最长 120 秒 | 原有录音、暂停与转写，本轮增加完成后的试听和 120 秒录制上限；模拟器“打开 → 录音 → 完成 → 试听 → 关闭”通过，真实麦克风音质与转写仍未验，**部分通过** |
| AI 回复朗读 | `/api/voice/speech` 分段播放，预取下一段，系统媒体会话与后台播放 | 原有手动朗读与暂停/继续/停止；本轮增加下一段预取、锁屏媒体信息与系统播放/暂停/停止/段内定位控制。隔离会话的模拟器用例覆盖开始朗读、显示播放栏与停止；后台与锁屏实播仍需真机验收，**部分通过** |
| AI 回复自带音频 | 仅新回复在流完成后自动播放；历史加载不重播，切换语音模式会中断 | 本轮新增完成边缘触发的自动播放及离开/切换时停止；还修正 Gateway 历史转换遗漏 assistant `media` 的问题，避免音频附件在历史读取时消失。设备实播未验，**未验** |
| 图片发送 | 相册、相机、发送前缩略图与删除 | iOS 入口和草稿缩略图已有；相机在模拟器不可用，真机未验，**未验** |
| 文件发送 | 单个不超过 10 MiB，合计不超过 20 MiB，最多 10 个 | 原为单个 32 MiB、无总量校验；本轮按鸿蒙聊天合同校验，并保留笔记附件自身限制。单测通过，发送端到端未验，**部分通过** |
| 聊天图片预览 | 多图切换、放大缩小、手势缩放，加载高分辨率预览 | 本轮加入多图切换、缩放与较高清晰度解码；隔离图片历史会话的“缩略图 → 预览 → 关闭”模拟器用例通过。多图手势仍需实图真机验收，**部分通过** |
| 聊天文件预览 | 文本、Markdown、HTML、音视频、二进制提取文本、下载、分享；受管文件支持编辑 | 原聊天内非媒体附件不可点；本轮新增聊天及消息详情中的附件读取、文本与 Markdown 应用内预览、受限 WebKit HTML 预览、其他格式 Quick Look 预览和提取文本回退，受管路径可经 `/api/files/resolve` 解析。模拟器发现 Quick Look 对 `.txt` 显示空白，改用应用内文本预览后同一用例通过，截图保存在忽略的 `docs/mobile-reference/reviews/ios-2026-10-08/`。长按受管附件可进入现有文件详情编辑/下载，或调用 `/api/shares/auto` 创建链接。HTML 内嵌脚本被禁用，部分依赖脚本的文档呈现可能与鸿蒙不同；受管附件编辑与分享 UI 未经设备验收，**部分通过，P2** |
| 聊天语音附件 | 历史语音可播放，并支持音频文件来源 | iOS 原仅 `media://` 语音可播放；本轮扩大到受管文件与会话路径，**代码对齐、设备未验** |

本轮 iOS 编译、新增模型/附件限额单测 7 项、Gateway 历史转换测试 35 项，以及模拟器聊天录音试听、隔离图片预览、隔离文本附件预览、隔离会话朗读控件 UI 用例通过；聊天 Action 面板入口用例也通过。本地 Gateway 的 `/api/voice/speech` 返回音频 200。在现有会话文件空间中上传隔离的测试文本文件，验证 `/api/files/resolve` 返回同一资源且内容可读取；还验证 `/api/shares/auto` 可为受管文件创建分享，随后撤销分享并删除文件。为 UI 验收导入的隔离媒体会话在测试结束后删除。多图手势、受管文件编辑/分享 UI 和 AI 音频自动播放尚未完成真实数据端到端验证，不能称为完全对齐。
