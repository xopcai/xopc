# HarmonyOS phone workspace — physical-device acceptance

Date: 2026-10-25 (Asia/Shanghai)

## Environment

- Physical device: BRA-AL00; reported system `OpenHarmony-7.0.0.105`.
- Installed the current native HAP over the existing `ai.xopc.xopc` app without uninstalling or clearing data. Existing pairing resumed.
- The local Gateway was refreshed from its earlier process to the working-tree implementation; its existing database schema already matched, so no database upgrade was needed.
- Target: existing registered Alibaba Cloud test phone, using the actual ADB/scrcpy transport and native H.264 decoder.
- All device interaction stayed in Android Settings. No application settings, accounts, messages or transactions were changed.

## Signing diagnosis

The initial `9568329` installation failure was traced in device BMS logs to a bundle-name mismatch: the old local debug profile covered `ai.xopc.mobile`, while this app is `ai.xopc.xopc`. The existing 2026-10-24 debug provisioning profile covers the correct app and connected device and matches the existing IDE signing key. Using that profile resolved installation. No signature validation was bypassed and no signing material was added to version control.

## Results

| Check | Evidence / result |
| --- | --- |
| Existing header phone entry | A dedicated conversation received Phone Use; the phone icon appeared while the conversation remained selected. |
| Native live video | Actual cloud Settings pixels rendered through the native decoder; screenshot fallback was not active in the successful manual-control test. |
| Takeover | UI displayed human control; Gateway reported `controlOwner: human`, `status: paused`. |
| Continuous swipe | Settings scrolled and Gateway recorded a completed human `swipe`. |
| Tap and Back | A tap opened About phone; the phone-page Back action returned to Settings. Gateway recorded a completed human `tap`. |
| Gesture isolation | A horizontal gesture during takeover stayed in the phone page and was not interpreted as outer paging. |
| Return to conversation | System Back returned to chat; Gateway reported no human owner and a paused task. |
| Two-way paging and draft | Left/right paging worked in viewing mode and retained the unsent draft; the test draft was removed afterward. |
| Assistance and explicit handback | A bounded read-only task requested human assistance. Takeover and Done/continue handed back control, and the original conversation acknowledged completion. |
| Background release | Human ownership was confirmed before Home; backgrounding released ownership and kept the task paused. |
| View-only authorization | The view-only explanation appeared and the takeover button was absent. |
| Revoking active control | Downgrading an actively controlling device released manual ownership and left execution paused. |
| Removing view access | Cloud pixels and phone metadata were cleared and an authorization explanation replaced them. |

The generic Settings-only live-video screenshot is retained locally at:
`apps/mobile-harmony/.test/phone-workspace-device/paced-swipe.jpeg`.
It is intentionally excluded from source control. Device identifiers, pairing links and signing material are not part of this report.

## Defect found and fixed

Fast physical touch events originally accumulated faster than cloud input could be acknowledged, causing the bounded WebSocket input queue to close with code `4408`. Waiting for a successful local `send()` did not provide transport backpressure.

`XopcPhonePointerQueue` now permits one unacknowledged pointer at a time, coalesces intermediate MOVE events, preserves the last MOVE and final UP, drops stale ACKs after cancellation, and bounds ACK wait time. A regression test feeds 400 MOVE events while an ACK is outstanding. Physical swipe and tap then completed without losing control.

Additional fixes add safe stream-close diagnostics, cover stale pixels while video is unavailable, and avoid displaying a transient stream disconnection as an unconfirmed phone operation. The navigation regression expectation now reflects dismissing the phone workspace before leaving the conversation.

## Automated checks

- HarmonyOS suite: 125 files, **814 tests passed**.
- Targeted signed HTTP / stream Gateway checks: **6 tests passed**.
- Updated native C++ / ArkTS Debug HAP build and installation passed.
- Gateway TypeScript check passed.

## Cleanup and limits

The temporary phone grant was restored to its original `none` value. The test phone connection was explicitly disconnected. The dedicated conversation was retained as `鸿蒙 Phone Use 真机验证 · 2026-10-25` for review. User data and the cloud instance were not deleted.

This acceptance covers the core chat/phone workflow on one physical device and one real cloud phone. Manual text entry, long press, password-field behavior, rotation and deliberate network-loss recovery were not separately accepted on-device in this run. Snapshot fallback was observed during the initial failing input test; snapshot-mode input was not independently benchmarked. This is functional acceptance, not a latency or long-duration performance benchmark.

## Follow-up: minimal phone controls

The phone workspace now keeps one bottom action: **Take control / Return to AI**. A neutral, rounded handback button distinguishes ongoing manual control from the accent-colored takeover action. The compact header groups device name and status; its More menu contains Back, text entry, release while keeping the task paused, pause/resume, reconnect, and destructive Stop. Text entry uses a dismissible native sheet and clears its draft on dismissal or loss of control. Stop retains explicit confirmation. An existing control owner can hand back even while video is unavailable.

The updated Debug HAP was built, signed and installed over the existing physical-device app. The HarmonyOS regression suite still passes **814 tests in 125 files**. Physical checks confirmed the single bottom action, context-sensitive More menu, text-sheet draft entry and dismissal, release while keeping paused, reconnect, menu Back, handback returning the session to ready/no human owner, and the Stop confirmation/cancel flow. No cloud text was submitted in this follow-up; text dispatch remains outside this acceptance.

A rapid sequence of three swipes exposed an intermittent `PHONE_VIDEO_DECODER_OVERLOADED` transition. The native packet queue reached its bound, closed the stream and released manual ownership. Reconnecting through More restored video and allowed takeover again. This remains an open video burst-handling issue; the new layout is accepted, but burst/long-duration video stability is not. Rotation and deliberate network-loss tests also remain outstanding.

Screenshot of the revised controls with live cloud Settings is retained locally as `apps/mobile-harmony/.test/phone-workspace-device/minimal-controls.jpeg` (ignored). Temporary device grants were restored and the dedicated test connection was disconnected after testing.
