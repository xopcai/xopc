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
