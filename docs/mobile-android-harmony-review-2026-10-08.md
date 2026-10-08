# Android 与鸿蒙功能、页面和实时语音复核

- 基线：2026-10-04 鸿蒙 BRA-AL00 真机页面图谱 `docs/mobile-reference/README.md`，以及 2026-10-08 当前鸿蒙源代码。静态截图不能证明录音、网络和转场时序。
- Android：`apps/mobile-android` Debug，API 35 隔离模拟器 `emulator-5554`。本地 Gateway 可用，但该模拟器未完成 HTTPS 语音会话配对；模拟器运行结果不能等同于真机麦克风、蓝牙和扬声器验收。
- 判定：`通过`只用于本轮目标机实际完成的旅程；`未验`包括仅有代码或受控状态测试的路径。

## 功能与页面矩阵

| 旅程 | 鸿蒙参考 | 状态 | Android 本轮结论 |
| --- | --- | --- | --- |
| 五个主入口、底部输入、安全区与返回 | 图 01、02、04、15、24；`HomeView.ets` | 未验 | 五入口和随页输入已有。模拟器五入口布局用例与另一个运行中的仪器测试发生安装/进程冲突，测试进程崩溃；跨 Tab 滚动保持、深色和大字号仍需独占设备复测。 |
| 助手输入与消息 | 图 03、11–14、30；`ChatView.ets` | 未验 | Action/键盘互斥、消息详情/执行步骤、附件和引用入口已有；真实 Gateway 的长流输出、停止/重试及多媒体发送未验。 |
| 会话列表与管理 | 图 02；`SessionsView.ets` | 未验 | 搜索、分页、日期分组、任务子会话、选择/批量操作与分享已有；已连接同状态 UI、并发撤销和跨端切换恢复未验。 |
| 实时语音：自然/助手模式 | `VoiceCallView.ets`、`voiceCall.ets` | 未验 | 两种模式和麦克风/扬声器控制已有；本轮修复连续回复交接、播放尾音清空旧会话、音频中断/网络退避重连、后台暂停前台恢复和任务取消。协议/决策单测通过，真实双向音频未验。 |
| 实时语音页面 | `VoiceCallView.ets` 全屏/迷你窗 | 未验 | Android 原为阻塞弹窗；本轮增加可拖动迷你窗。展开态仍是 Material 弹窗，与鸿蒙全屏布局不同，**P2**；迷你窗手势和后台页面操作待设备验收。 |
| 语音输入、朗读、语音笔记 | 图 07–10；`voiceCapture.ets`、`chatReadAloud.ets` | 未验 | 录音/暂停/试听/转写、回复朗读、笔记录音均有代码；真机录音质量、音频焦点、后台处理/恢复未验。 |
| 进展、任务与项目 | 图 15–21；`WorkspaceView.ets`、`ProjectSpaceView.ets` | 未验 | 任务/项目列表与详情、项目会话、项目内笔记/自动化正在当前工作区完善；已连接项目归属及完整返回链未验。 |
| 工作流 | `WorkflowView.ets` | 未验 | 本轮增加“进展 → 工作流”列表、运行详情、阶段/Agent/结果、4 秒轮询与确认取消。Android 编译通过，Gateway 列表接口返回空列表；有运行数据的设备旅程未验。 |
| 自动化 | 图 22、23；`AutomationRunView.ets` | 未验 | 列表/详情/运行、创建编辑和结果页面已有；真实 Gateway 运行/取消及项目内入口未验。 |
| 笔记、文件与分享 | 图 04–10、31–35；`NotesView.ets`、`FilesView.ets` | 未验 | 笔记列表/编辑/语音、文件空间/预览与分享入口已有；录完笔记落地、复杂文件预览和跨端同步冲突需设备验收。 |
| 我的、Gateway 和设置 | 图 24–29；`PersonalView.ets`、`GatewayProfilesView.ets` | 未验 | 个人首页、连接探测、语言/主题/配色与分享中心已有；真实候选 Gateway 切换失败保留及同状态视觉未验。 |
| 推送通知 | 鸿蒙 `pushNotifications.ets` | 缺失 | Android 未发现设备推送注册、Gateway 推送 token 更新和通知导航闭环；Gateway `/api/devices/me/push` 当前只接受 `harmonyos` 平台，端到端 Android 推送还需 Gateway 平台/发送服务、Android 厂商推送凭据与真机验收，**P1**。 |
| 无障碍与状态恢复 | 图谱验收清单 | 未验 | 大字号、TalkBack、减少动画、深浅色、进程重启与弱网下五页面状态尚无本轮完整设备验收。 |

汇总：13 项中通过 0、部分通过 0、失败 0、缺失 1、未验 12。此计数反映本轮证据，不抹去历史受控状态测试。发布阻塞为推送缺失，以及实时语音未完成真机稳定性验收。

| 差异与进入步骤 | 鸿蒙参考 | Android 证据 | 预期 / 实际 | 严重度 |
| --- | --- | --- | --- | --- |
| 进展 → 工作流 → 运行详情 | `WorkflowView.ets` | Android 本轮增加 `ProgressScreen.kt` 入口、`WorkflowScreen.kt` 与 `WorkflowRepository.kt` | 代码和编译已对齐；需使用含运行数据的 Gateway 在设备上验收列表、详情、取消与返回 | P1 验收 |
| 系统推送 → 打开通知 | 鸿蒙 `pushNotifications.ets`、`notificationNavigation.ets`；Gateway `device-push.ts` 仅支持 `harmonyos` | Android 仅设置通知项，未找到 token 注册和通知路由 | 通知可注册、确认并跳到对应对象；目前链路缺失，Gateway 也尚不接受 Android 注册 | P1 |
| 助手 → 实时语音 → 收起 | 鸿蒙 `VoiceCallView.ets` 全屏/迷你窗 | Android `MainScreen.kt` 本轮增加 `voice-call-mini`，设备交互未验 | 迷你窗可拖动且页面仍可操作；展开态仍是弹窗 | P2 |

## 实时语音稳定性

鸿蒙近期处理了“第二条回复到达时，第一条仍在扬声器排空”的竞争条件。Android 原实现收到 `response.created` 就替换活动回复 ID，会丢弃第一条尾音；`response.done` 后也没有把后续回复缓存在当前播放完成之后。本轮在 `RealtimeVoiceController.kt` 加入有界顺序缓冲，只有当前回复播完、取消或主动停止后才交接下一条；释放时清掉回复 ID、队列、序号和任务状态，避免旧回调污染新通话。阻塞式 `AudioTrack.write` 返回后会核对播放代次，避免被冲掉的旧音频继续回报播放进度。

网络、音频采集/播放和焦点中断按 0.5、1、2、4、8 秒最多五次重试；协议错误与时长上限不会自动重试。上行队列达到约 120 ms 音频量时临时静音，超过约 300 ms 音频量或持续 180 ms 未恢复则以 `INPUT_DROPPED` 暂停并要求用户重说，避免悄悄补发过期语音；用户主动静音在拥塞恢复后仍保持。退后台释放设备并保留通话目标，回前台重新建会话；手动结束会阻止待执行重连。服务端确认用户插话且会话允许打断时，播报在 60 ms 内降到 25%，停止后 120 ms 恢复；这不等同于本地近讲检测。通话使用 Android 通信音频模式和对应权限，释放时恢复原音频模式；错误显示为中英文可读提示。迷你窗提供展开、拖动和结束，设备手势仍待复测。

仍需真机验收：自然与助手模式各至少 10 次交替发言，前一条尾音附近立刻发言、打断、静音/恢复、断网恢复、蓝牙/听筒/扬声器切换、切后台/回前台，以及连续回复文本与音频是否一致。需关联 Android 语音事件与 Gateway `Voice:Agent` / `Voice:Omni` 日志；模拟器单测不能证明声学链路稳定。

## 待处理优先级

1. **P1**：工作流页面/运行详情设备验收；推送注册与通知跳转；真实语音通话设备验收若发现断流或丢回复须阻止发布。
2. **P2**：语音展开态全屏布局；项目归属与多媒体真实 Gateway 旅程；深浅色、大字号、TalkBack、弱网/进程恢复。

本报告随本轮复测更新；历史实现记录见 `docs/mobile-android-native-parity.md`，不能将旧的受控状态测试写成当前版本的完整端到端通过。

## 本轮验证记录

- 托管 Gradle `:app:compileDebugKotlin` 与定向 `:app:testDebugUnitTest`（`VoiceReplyHandoffTest`、`VoiceUplinkCongestionTest`、`VoiceProtocolTest`）通过；这些覆盖连续回复缓冲、拥塞阈值和协议数据，未覆盖真实音频硬件。
- 托管 Gradle `:app:assembleDebug` 通过，工作流入口和语音界面已进入 Debug APK；尚无有效设备端断言可宣告交互通过。
- 本地 Gateway 的 `/api/voice/realtime/status` 返回可用状态，`/api/workflows/runs?limit=50` 返回空列表。Android 测试模拟器未与 HTTPS 语音 Gateway 配对，无法由此证明通话稳定性。
- 五入口滚动仪器测试与另一个并行仪器测试在同一模拟器安装/执行时冲突，测试进程崩溃，未得到有效断言结果；需独占模拟器复测。
