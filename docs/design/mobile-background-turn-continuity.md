# Mobile background transitions preserve assistant turns

## Cause

HarmonyOS `EntryAbility.onBackground` intentionally stops the realtime socket, releasing foreground device operations. Foreground startup reconnects and resumes topic cursors. This behavior predates device request proof v1.

Device removal/reconnection also invalidates native external tool declarations. Previously `EmbeddedSessionRunnerPool` responded to every invalidation with `abortEmbeddedRun` and immediate runner disposal. Because every materialized device tool subscribes to directory invalidation, an ordinary assistant response could be aborted even when no device tool was currently running. The realtime socket-close handler itself does not cancel the durable session input.

## Change

Invalidations now distinguish connection changes from authorization changes. A connection change marks an acquired runner stale; it continues the current turn and is disposed on release. Idle runners are refreshed immediately, and stale runners are not reused. Individual external calls still resolve current authorization, connection identity and contract revision; pending device operations still fail on disconnect.

Explicit device revocation and binding changes retain immediate abort behavior. Principal revocation subscriptions survive socket removal, and both device self-revocation and owner-managed revocation notify those subscriptions even when the endpoint is offline. The endpoint registry emits authorization invalidation before an explicit disconnect; physical socket removal emits ordinary connection invalidation. Request signatures, replay checks and client lifecycle behavior remain unchanged.

## Evidence, 2026-10-13

- The regression test failed against the original implementation: connection invalidation immediately increased eviction count during a live assistant stream.
- The patched test preserves the response for connection invalidation and still aborts for authorization invalidation.
- Real native-device integration tests verify explicit disconnect propagates authorization invalidation, and socket removal propagates connection invalidation.
- Related backend tests: 7 files, 48 tests passed, plus three targeted active-turn invalidation cases (including disconnect followed by revocation). Harmony lifecycle/recovery tests: 3 files, 71 tests passed. Signature/realtime security tests: 2 files, 21 tests passed. TypeScript checking and ESLint passed.
- Physical device: BRA-AL00, `ai.xopc.mobile`, connected to `qm.xopc.io`. A test turn before the patch was persisted as `cancelled`.
- After the patch, BG4 output was visible (`BG4-001`) while the stop button remained active. The application went to Home for 3 seconds and then returned via EntryAbility. The same run remained `running` after return and subsequently reached `completed`; `E2E_BG_COMPLETE_4` appeared in the UI, with no network warning.
- BG4 conversation: `79e70f85-0600-4215-bb15-e4c666d502f8`; run: `1b9f7053-5a19-4eac-9f07-52b5cbe2654e`.

The installed Gateway 0.0.378 received a focused patch for runner invalidation, endpoint/principal revocation notifications and the existing device revocation routes. Source changes are also present in this repository. Original installed modules are backed up on the server under `/var/lib/xopc/background-turn-hotfix-20261013`; the service was restarted only after checking no active session-input runs. A future package deployment should include this source fix rather than overwrite it with the original behavior.

A second physical-device test (BG6) entered Home after the beginning of a response and stayed in the background until the server reported `completed`. After returning, `E2E_BG_COMPLETE_6` was visible, the stop button was absent and no network warning appeared. The same conversation's BG6 input was accepted once. Run: `d3ab7076-e546-40f0-af8d-96643ea2972a`.

| Acceptance case | Result |
| --- | --- |
| Background and return during reply | Physical-device pass (BG4, 3-second background) |
| Reply completes while background | Physical-device pass (BG6) |
| Cursor replay, gap recovery, completed-run reconciliation | Harmony host regressions pass |
| Device-tool disconnect reports an execution error | Backend invocation-service regressions pass |
| Disconnect followed by revocation aborts the turn | Targeted active-turn regression pass |
| Screen lock, Wi-Fi/cellular network switching | Not physically exercised in this run |

This validation covers short background transitions on the connected phone. It does not guarantee uninterrupted mobile sockets while suspended, nor complete device-local tools after the device disconnects; server-owned generation and durable recovery remain independent of those sockets.

Installed-code smoke verification also confirmed an offline principal revocation invokes its subscriber once and released subscribers receive no further notifications. Gateway health after the final patch returned `status: ok, ready: true`.

## Android and iOS follow-up

Android `GatewayViewModel.onForeground` replaces a suspended realtime job while retaining the watched run and cursor, then queries durable history and active-run state. Cancelling `RealtimeClient.run` closes its transport but does not call the agent-abort API. Consequently the shared server fix covers the same failure path for Android; no Android client lifecycle rewrite was necessary.

iOS pauses local run observation when inactive and reconciles history/run state when active. Device endpoint sockets can also disconnect while suspended, so the shared server fix covers iOS. A separate receipt race was reproduced in `AssistantState.resumeConversation`: the early return for an in-flight send happened before setting `isForeground = true`. If the receipt arrived after returning to the app, `followRun` still saw background state and skipped observation. The foreground flag now restores before the early return, preserving the original send's subscription ownership without resending input.

The new iOS regression failed before the change and passed afterward. It verifies resumed output, a single send, and zero abort calls while the receipt is pending across a background/foreground cycle. All 95 iOS simulator tests passed. Android `:app:testDebugUnitTest` passed through the managed Gradle wrapper. Three parameterized real-runner/native-device catalog tests cover Android, iOS and HarmonyOS disconnect/reconnect during an assistant response; the complete integration file passed 15 tests. Android/iOS physical-device acceptance and installation of the iOS client change were not performed in this follow-up.

## Client foreground recovery, 2026-10-12

The following client fixes and simulator/host results predate the 2026-10-13 server and Harmony-device evidence above. Later short-background device passes do not certify the remaining screen-lock, network-switch or Android/iOS physical-device cases.

### 问题与根因

鸿蒙 App 在 AI 输出过程中进入后台后，EntryAbility 会停止实时连接，回前台会启动连接；但 ChatView 的前台监听只恢复连接等待提示。聊天依赖连接事件间接恢复，缺少主动的前台恢复入口。

chatViewModel.recover() 还会无条件开启 snapshotMode。历史读取成功后清除实时输出，而之后的 assistant_delta 只更新活动状态、触发历史读取。尚未写入历史的回复无法继续显示，表现为对话中断。

iOS 的文字聊天没有 scenePhase 恢复入口；流断开后只轮询运行是否完成，不再订阅文字输出，且网络读取第一次失败就结束恢复。打开已在运行的会话也只读取 activeRun，没有订阅其输出。

Android 的实时连接有重试循环，但没有前后台恢复入口，也没有在连接成功后主动核对选中会话的历史与 activeRun。后台失效的 socket 可能持续等待超时，后台已结束的运行也可能保留旧状态。

### 修复

- 鸿蒙：前台主动恢复聊天；先恢复 Gateway 的前台状态，再通知页面。普通重连保留同一运行的实时内容，继续接收增量；仅真正缺失事件前缀时使用历史快照恢复。已入库的文本片段按 messageId 去重，恢复中的结束事件不会被旧查询复活。后台完成会重新取最终历史。
- iOS：文字聊天订阅随前台和页面可见性恢复，后台取消客户端观察但不终止服务端运行。流断开后核对运行、保留未入库内容、重新订阅；短暂网络失败继续重试。用观察代次、会话和 transcript 身份隔离旧请求、旧事件；按消息片段识别重放，避免重复文本。新增对打开已运行会话的订阅。
- Android：ON_STOP/ON_START 接入恢复；回前台替换失效连接并刷新历史和运行状态，保留同一 run 的回放游标与输出。系统个人工具调用仍在进行时保留其连接。每次重连成功都核对聊天；历史与实时片段去重，重放可接续重叠文本，缺失前缀不会清空已经显示的回复。结束事件与运行查询之间增加旧结果保护。
- Android lint 额外发现定位调用的权限异常处理缺口，已在 getCurrentLocation 与 requestSingleUpdate 调用点捕获 SecurityException，沿原有 PERMISSION_DENIED 路径返回；同时将 Compose 回调与语义中的资源读取移至 stringResource，并声明相机硬件为可选。

### 验证

- 鸿蒙：112 个测试文件、731 项 host 测试通过；其中 chatViewModel 57 项，包括前台续流、后台完成、离线历史保留和恢复中的结束事件；debug HAP 构建通过。
- iOS：FeatureStateTests 与 AssistantRecoveryTests 共 15 项通过，覆盖前台恢复、后台完成、历史暂时不可用、断线自动订阅、旧会话事件隔离；SwiftLint 通过。
- Android：38 项单元测试通过；专用 API 35 模拟器上 ForegroundRecoveryTest、RunStreamEventTest 与输入栏交互共 6 项通过，覆盖连续两次前后台切换、重叠重放及操作面板。
- Android lint：整理定位权限、Compose 资源访问和可选相机声明后，lintDebug 通过。

当前 HDC 没有连接设备，鸿蒙真机后台/前台操作验收尚未执行。iOS 验证为模拟器上的状态与网络流测试；Android 验证包含实际 Activity 生命周期，尚未使用真实 Gateway 进行三端真机长回复验收。以上验证不代表已发布或安装到用户手机。
