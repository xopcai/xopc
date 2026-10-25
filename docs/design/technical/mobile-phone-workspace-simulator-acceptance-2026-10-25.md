# Android / iOS phone workspace — simulator acceptance

Date: 2026-10-25 (Asia/Shanghai). Reference: HarmonyOS physical-device single-control workspace from 2026-10-25. General native conventions follow the mobile parity skill's baseline; this report is scoped to Phone Use, not a complete five-tab release acceptance.

## Environment and method

- Android: running `emulator-5554`, Android 15. Installed the current Debug application and instrumented-test APK with replacement installation; no data clearing.
- iOS: iPhone 17 Pro simulator, iOS 26.4. Built the current Swift 6 Debug scheme and ran XCTest / Swift Testing / XCUITest.
- Gateway: the local working-tree implementation, with an actual registered Alibaba Cloud test phone and scrcpy H.264 media. Device interaction remained in Android Settings; no settings, accounts, messages or transactions were changed.
- Android live UI acceptance uses an independently approved native simulator pairing and temporary `phone.view` / `phone.control` grants. iOS live XCUITest uses the existing Debug loopback administrative acceptance bootstrap; a separate iOS simulator pairing integration test verifies real device signatures, permission downgrades and WebSocket proof. No authentication bypass was added to production clients.
- Test pairing material, raw UI evidence and signing/credential data remain in ignored local directories. Only the bounded results are recorded here.

## iOS results

| Journey | Result |
| --- | --- |
| Discover a phone while staying in chat | Passed in the real Gateway conversation. |
| Header phone entry / live native video | Passed; actual cloud Settings rendered. |
| Enter phone from focused composer | Passed; keyboard dismissed, unsent draft retained. |
| Single bottom action / More | Passed; only Take control / Return to AI persists below the image. |
| Takeover / cloud swipe / gesture isolation | Passed; human control remained active and the cloud swipe did not page to chat. |
| Text sheet | Passed for local draft entry and cancellation; no remote text submitted. |
| Release while keeping paused | Passed through More. |
| Stop confirmation | Passed for opening and cancellation. |
| Swipe back to chat / draft preservation | Passed, then the unsent test draft was removed. |
| Native pairing / signed REST / signed video upgrade | Passed in a separate simulator integration test. |
| Control → view → none permissions | Passed; view-only takeover rejected with 403, viewing ticket still allowed, then binding/name omitted after view revocation. |

Automated baseline: 104 Swift Testing cases passed; XCTest executed 13 cases with zero failures and one unrelated keyboard-fixture skip. Focused phone checks additionally cover four pointer/decoder/state unit cases, one native pairing/authorization integration case and one live UI journey. The final focused run passed all four phone unit cases and the live UI journey on the final sources. A separate native-pairing run passed signed access and the control → view → none sequence.

## Android results

The final Debug application and instrumented-test APK built successfully. All **62 JVM unit tests** passed. The final real-emulator instrumentation run passed **4 tests** (`OK (4 tests)`):

| Journey | Result |
| --- | --- |
| Independent native pairing and signed phone access | Passed against the actual Gateway. |
| Header entry and native H.264 viewing | Passed in the instrumented MainContent host. |
| Takeover / cloud swipe / gesture isolation | Passed. |
| Single control button / More / local text-sheet input and cancellation | Passed. |
| Release while keeping paused | Passed. |
| Primary-button handback | Passed after a second takeover. |
| Stop confirmation and cancellation | Passed after waiting for control handoff to finish. |
| Confirmation during control-epoch refresh | Passed in the explicit UI regression. |
| View-only hides manual actions | Passed in the component state test. |
| Restored assistance without old pixels | Passed; takeover remained actionable. |
| Return to chat | Passed; the header entry remained available. |

## Findings resolved during implementation

- iOS's existing floating-header accessibility identifier propagated to child buttons. A containing accessibility element now preserves distinct phone/search/options identities.
- Viewer/controller UUID isolation prevents closing a prior viewing stream from releasing newly acquired manual control.
- Phone entry dismisses the chat keyboard through the composer's own FocusState.
- Stop confirmation is scoped to the phone binding/session; an ordinary control-epoch refresh must not dismiss it. Confirm also verifies the captured session.
- Foreground polling ignores responses that started before a new control operation, preventing stale discovery/state from replacing a takeover result.
- Media-ready state is published on the first rendered frame rather than continuously invalidating the whole page for every video packet.

## Cleanup and limits

Temporary native phone grants are removed after each signed acceptance run. The cloud connection is disconnected after final verification. Test drafts and local text-sheet input are discarded. No user conversation, cloud instance or application data is deleted.

Not separately accepted in this run: remote text dispatch/password fields, long press, rotation, forced network-loss recovery, long-duration or burst video load, and complete dark-mode/accessibility-device coverage. Earlier HarmonyOS burst-decoder overload remains a separate tracked limitation. Successful functional video/control checks do not establish latency or performance guarantees.

## Gradle validation ledger

All commands ran through the managed `gradle-run` wrapper. The final bounded answers are:

- “Can the Android phone workspace compile and its unit tests pass?” — Yes; assembleDebug and testDebugUnitTest passed.
- “Do the pointer regressions pass and can the Android simulator acceptance test be packaged?” — Yes; pointer regressions passed and assembleDebugAndroidTest passed.
- “Can the simulator UI tests cover view-only, restored assistance and live control after the stream switches?” — The instrumented APK packaged successfully; the subsequent real emulator run passed all four tests.
- “Does the final Android phone workspace build with stable stop confirmation and stale-response guards?” — Yes; final application/test builds and 62 JVM cases passed, followed by the successful simulator UI run.

The wrapper workflow was finished after validation. Cleanup removed only wrapper-owned logs. An earlier long compilation was interrupted while investigating Kotlin analysis cost; all required final tasks were rerun successfully.

## Final evidence

All final phone checks passed. Android: 62 JVM cases and 4 emulator UI cases. iOS: 4 focused phone unit cases, 1 independently paired authorization integration case and 1 live UI journey. The earlier full iOS suite remained at zero failures, with one fixture-dependent skip described above. Final `git diff --check` passed.

Ignored local screenshots: `docs/mobile-reference/reviews/phone-workspace-2026-10-25/android-live.png` and `ios-live.png`. Temporary phone grants were verified removed for both latest simulator identities, and the dedicated cloud test connection was disconnected.
