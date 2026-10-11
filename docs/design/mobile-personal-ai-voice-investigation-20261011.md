# Personal AI 移动端实时语音无回复调查

调查时间：2026-10-11（Asia/Shanghai）。仅调查与验证，未修改语音运行代码或线上配置。

## 1. 当前通话的直接故障：实时 TTS 上游在就绪前关闭

本地 Gateway 日志中，18:49:47、18:50:00、18:50:41 的同一语音会话均出现：

- `TTS stream provider "xopc-cloud" failed`
- `Realtime voice response failed`
- 原因：`Platform voice disconnected before completion`

对应持久化输入包含普通问答和天气请求，不能把本次故障限定为工具调用之后才发生。

用现有授权、模型 `tts`、音色 `default` 和目录中的 `serviceVersion: 4` 发起短文本独立探测：

| 通路 | 实际结果 |
| --- | --- |
| WebSocket `/audio/speech/realtime` | 收到 `session.created`，约 1.69 秒后关闭：1011 / `Provider session closed`；未收到 `session.updated` 或音频，音频累计 0 字节 |
| HTTP `/audio/speech` | HTTP 200，返回 41,371 字节 `audio/mpeg` |

实时探测在服务就绪前失败，因此尚未发送待合成的文字。这次复现不依赖手机播放器、工具结果或 Agent 文本流。

普通合成成功只证明该模型的普通合成路径可用；不能据此断言实时路径的供应商授权、模型路由或会话配置也正确。平台 relay 的关闭原因定位到供应商连接结束，但还需线上 relay 的诊断记录和供应商关闭详情，才能确定更深一层原因。

Gateway 当前丢弃 WebSocket close code/reason，只保留通用错误（`src/voice/platform-streams.ts:34`），因此旧日志无法区分具体的供应商错误。Agent voice 在 TTS 失败后发送 `RESPONSE_FAILED` 和无音频的 `response.done`（`src/voice/realtime/agentEngine.ts:463`）；持久化的聊天结果仍可能可见。

## 2. 独立缺口：Personal AI 后台最终结果未连接实时播报

现有链路：

1. `PersonalReplyComposer` 整理最终文本。
2. 将文本作为 `task_result_delivery` custom 消息写入 transcript。
3. 发出 transcript 更新、`session.task-result` 和 `personal.reply.delivered` 通知。
4. 标记文本及通知已交付。

`src/gateway/service.ts:935` 的通知回调没有向活跃语音引擎提交这段最终文本。`canPublishReply()` 只检查通话是否空闲，并不执行播报。

实时 Agent 引擎只对所订阅运行的 `assistant_delta` 做语音合成；后台 composer 写入的 custom 消息不经过这个流。原有 `offerTaskUpdate()` 会再跑一次 Agent，当前 Personal request 的 result/failure/progress 更新又被 `TaskMainUpdateDelivery` 跳过，不能靠该入口自动补上播报。

所以：云端实时 TTS 修好之后，Personal AI 后台任务的最终结果仍存在“文字交付成功、没有实时语音通知”的风险。此缺口位于共享 Gateway，影响所有使用该链路的移动端，而非只影响鸿蒙。

## 3. 改动历史与归因边界

- `8cc40bd24`（10 月 9 日）：引入 Personal reply synthesis/composer，由结果 outbox 负责最终回复。
- `81c4f1ed4`（10 月 9 日）：Gateway 接入 composer 交付回调。
- `be6d4c2dc`（10 月 9 日）：增加前台对话与语音空闲门控，没有增加播报入口。
- 平台 `14ac999`（10 月 10 日）：改动公共语音产品路由及默认音色映射，值得与线上诊断关联排查；当前证据不足以认定此提交造成上游关闭。
- 本次顶部状态栏/胶囊修改没有修改实时 TTS、Agent voice 或音频播放链路。

后台播报缺口可从代码确认；当前实时 TTS 上游故障可从线上探测确认。两者须分别处理，不能用恢复一个问题代替另一个。

## 4. 验证与修复顺序

现有 4 个测试文件共 68 项通过：platform-streams、agentBroker、agentEngine-interruption、task-result-delivery。这些测试使用本地/模拟语音服务，且没有覆盖“真实云端实时 TTS”或“Personal composer 最终回复进入活跃通话”的完整链路。

建议依次处理：

1. 获取平台实时 relay 的失败诊断、实际供应商模型与关闭详情，恢复 `session.updated` → 音频 → 正常完成链路。
2. 给已持久化的 Personal 最终回复增加直接语音交付入口；复用现有最终文本，避免重新运行 Agent、重复执行工具或在聊天里生成第二份回复。
3. 以 delivery ID 去重并定义空闲、打断、重连及播报失败语义；文本交付成功与语音交付成功分开记录。
4. 补充普通问答、即时工具、后台工具、打断与重连的验证，确保产物显示和声音交付都完成。

鸿蒙设备当前未通过 HDC 连接；上述线上复现是在 Gateway 主机直接调用同一云端语音路径，未声称完成本轮真机复验。

## 5. Android 与 iOS 补充检查

代码链路检查确认两端也受上述共享问题影响：

- Android `RealtimeVoiceController` 接收 Gateway 的 response 事件和 PCM 音频；`response.done(audio=false)` 时设置 `NO_RESPONSE_AUDIO`。聊天端的 `session.task-result` 回调仅调用 `refreshSelectedHistory()`，不向通话播放器提交最终文本。
- iOS `RealtimeVoiceCall` 同样消费 Gateway response 事件和 PCM 音频；`response.done(audio=false)` 时设置 `NO_RESPONSE_AUDIO`。`AssistantState.observeTaskResults()` 收到结果事件后仅刷新成果和历史，未连接通话播报。
- 两端的手动朗读是独立入口，不能补偿 Personal AI 后台最终回复没有发送实时 response/audio 的问题。

额外确认 iOS 对可恢复错误的处理与另外两端不一致：

1. Gateway 在当前 TTS 失败时发出 `session.error`，payload 为 `code: RESPONSE_FAILED, recoverable: true`。
2. iOS 的 `RealtimeVoiceEvent.Payload` 已解码 `recoverable`，但 `RealtimeVoiceCall.handleSession()` 的 `session.error` 分支忽略它，始终调用 `pause()`。
3. `pause()` 释放 transport 和 audio；`VoiceRecoveryPolicy.shouldReconnect("RESPONSE_FAILED")` 返回 false，因此进入 paused 状态，不能自动继续同一场通话。
4. Android 的相同分支在 `recoverable=true` 时只记录错误；鸿蒙亦只记录错误，保留通话。

定位：`apps/mobile-ios/XopcMobile/Features/Assistant/RealtimeVoiceCall.swift:412`；对应 Android 分支位于 `RealtimeVoiceController.kt:346`。建议将可恢复的单次回复错误与需要释放连接的会话错误分开处理，并补充事件注入测试，验证下一轮仍能收到和播放音频。

本节结论来自代码追踪和已复现的共享服务错误，未进行 Android/iOS 真机通话复现，也未修改两端语音运行代码。


## 6. 移动端首次连接失败与重连排查（19:20 更新）

本轮在代码和故障注入测试中确认以下问题，尚未取得 Android 真机同次失败日志，因此不能断言每次用户观察到的失败均由其中某一项触发。

- 三端直连失败后会使用同一 ticket 连接备用 WebSocket 地址。Gateway 在收到 session.start 时即消费 ticket，并不等待 session.ready；握手后断开或等待 ready 超时后重用票据必然失效。
- Android 的 withTimeout 超时属于 CancellationException，原实现将其重新抛出，未进入 fail() 和自动恢复。
- 鸿蒙初始化失败直接 paused，不执行自动恢复；手动 resume 可与旧音频/会话释放重叠，备用连接也缺少旧 socket 身份隔离。
- iOS 15 秒超时覆盖 REST 准备和音频初始化，留给 WebSocket 的时间不足；恢复阶段再次失败被 pause 的 recovering 条件忽略。release 还可能先取消正在执行它的 receive/capture/timeout 任务，导致后续 HTTP 取消旧会话失败。
- Gateway 在 engine.close 尚未完成前移除 activeSessions，导致并发的 cancelSession 无法等待旧会话 reservation 释放。真实 WebSocket 回归测试通过阻塞中断记录保存复现并验证此问题。

已修复：

1. 三端只在 session.start 尚未发送时复用票据降级；握手后失败走有上限的恢复，释放旧会话，领取新 ticket。恢复尝试交替使用直连和代理地址。
2. ready 等待改为 30 秒；Android 超时转换为 CONNECT_TIMEOUT 并保留真正的调用者取消。iOS 总超时从音频初始化之后开始，给两条地址留出 65 秒上限。
3. 三端 CONNECT_TIMEOUT 进入最多 5 次恢复，退避为 0.5、1、2、4、8 秒；永久协议/权限错误不因此变为可恢复。
4. 鸿蒙 resume 等待 cleanup 并清除自动重试定时器；传输层按 socket 身份过滤过期回调，握手期间的 fatal error 直接结束初始化并保留错误码。
5. iOS 恢复期间允许再次失败进入下一次重试；清理完成后再取消自身任务，并给接收/发送任务增加连接代次隔离。recoverable session.error 现在保留通话，修复第 5 节指出的问题。
6. Gateway 保留正在清理的会话所有权，并让重复 shutdown/cancel 等待同一个清理 Promise。

验证：Android testDebugUnitTest + assembleDebug 成功（专门补充超时/调用者取消区别测试，Gradle 包装器日志已清理）；鸿蒙 33 项语音传输/恢复/播放回归通过，签名 HAP 构建成功；iOS 模拟器 9 项语音协议测试及编译通过；Gateway 针对连接/取消/播放的 19 项回归、实时语音完整回归 169 项通过（1 项跳过），根项目 typecheck 通过。

Android adb 和鸿蒙 hdc 当前均未连接真机，未完成本轮真机通话复验。前述云端 TTS WebSocket 1011 失败和 Personal AI 最终回复未接入播报链路仍是独立问题，本轮连接修复不声称解决它们。
