# Mate 60 physical-device verification — 2026-09-17

## Environment

- Device: HUAWEI Mate 60, phone, API 24 (`OpenHarmony-6.1.1.120` reported by HDC).
- App: `ai.xopc.mobile`, version `0.1.0`, version code `1`.
- Packaged minimum API: `60100023`; target API: `260000026`.
- Tools: DevEco Studio / command-line-tools 26.0.0.821.
- Debug Profile updated with user approval; the connected device is included.
- Local signing backup: Git-ignored `signing/build-profile.mate60.local.json`.
- Build: `entry/build/default/outputs/default/entry-default-signed.hap`.

## Observed results

| Check | Result |
| --- | --- |
| USB authorization / HDC connection | Passed after phone-side authorization |
| Debug signed build | Passed; compiler capability/exception warnings remain |
| Installation using `hdc install -r` | Passed; no uninstall or data-clear command used |
| Start `EntryAbility` | Passed; `start ability successfully` and running app process |
| Initial connection page | UI tree contains title, invitation input, scan, connect and settings controls |
| Installed bundle version and minimum API | Confirmed through bundle manager |

Startup error-level logs include framework messages from WMS (`WindowInfoReporter` singleton) and UIAbility (`JsUIAbility call js, withResult failed: 5`). The app remained running and produced its initial UI tree; these messages are not yet classified as benign or resolved defects. No app crash was established by the sampled logs. This is not a crash-free certification.

## Pending

Interaction testing was paused when the captured screen no longer matched the previously observed connection-page tree. A screenshot unrelated to that page was removed from the host and phone; it is not part of this record. Settings interactions, cold restart, update/data preservation, native instrument tests, Gateway pairing, streaming/abort, files, microphone and push delivery are not claimed as passed.

## Later Chat / dock / drawer pass

An intermediate signed debug update installed with `hdc install -r` without a data-clear command. Launch returned `10106102` because the phone was locked. The user was asked to unlock the screen; no automated unlock or security-setting change was attempted.

The final signed debug package built successfully, but final installation returned `E001005 Device not found or connected`: the Mate 60 USB target was no longer available. This final package is not claimed as installed. Current host and paired-emulator results, plus explicit implementation/acceptance gaps, are in `chat-parity-checklist.md`.

Signing secrets and device identifiers are excluded from this document. The tracked build profile was restored to its portable, unsigned configuration after building; the signed output and local signing backup remain available. Existing unrelated web changes were left untouched. No production database was migrated and no application was published.

## Physical acceptance retry after session-management implementation

- The Mate 60 reconnected and reported model `BRA-AL00`, API 24. Existing app startup succeeded without a lock-screen error.
- Before the update, its UI tree showed the unpaired connection page with an empty invitation field. There was no paired Gateway available on this phone to exercise Chat.
- Rebuilt the latest sources with the previously authorized local debug signing Profile. Hvigor reported `BUILD SUCCESSFUL`; signing was injected in memory using `HARMONY_DEBUG_SIGNING_PROFILE`, without changing tracked build profiles or printing secrets.
- Latest signed HAP SHA-256: `5871a873de2b8965f962eb1d6f5b43bbe1ce59452e9ba5245f3effd5556fbd1a`.
- `hdc install -r` reported successful replacement, and `aa start` reported `start ability successfully`. No uninstall, data clearing, permission auto-grant or persistent test-mode change was performed.
- The post-update UI tree again contained the Chinese connection title, invitation input, scan/connect controls and Settings. Local evidence: ignored `.test/mate60-before.json` and `.test/mate60-latest.json`.
- USB disconnected before the screenshot and Settings interaction commands could execute. Those commands returned `E001005`; target-specific reconnect and an HDC server restart did not restore the connection (`list targets` was empty). No new screenshot or Settings interaction is claimed.

**Acceptance remains partial:** installation/startup/connection-page UI passed. Chat, dock, drawer, search/selection, keyboard behavior, pairing persistence, media, voice, push and runtime-log inspection still require a connected/unlocked phone and completed Gateway pairing. The user has been asked to complete pairing on the intended Gateway and reconnect USB debugging. No real conversations were mutated.

## Governed sharing acceptance — 2026-09-23

- Built and installed the signed debug HAP on the connected Mate 60 with `hdc install -r`; pairing and application data were preserved. Installed HAP SHA-256: `fa2bee065185530da90e3671afbc37f221a81d3ae0682b7257f9812c11faf327`.
- Sharing history loaded an existing active file share. The action sheet exposed preview, extension and revocation; destructive or state-changing actions were not confirmed.
- The share result displayed its public URL and expiry, rendered a scannable QR code, loaded the same-origin public page in ArkWeb, and opened the HarmonyOS system share sheet. No third-party target was selected.
- The system share sheet registered xopc as an inbound target and launched `ShareExtensionAbility`. This exposed a process-boundary defect: the extension wrote the intake only to its own `:share` process, so the main process could not display it.
- The defect was fixed by serializing the title and shared values into the `EntryAbility` Want. The main process validates and reconstructs the intake before publishing it to the observed UI state. A post-fix device Want with the same payload shape displayed the full inbound sheet with link classification, preview, save-to-note, new-chat analysis and ignore actions. The test payload was ignored, so it created no note or conversation.
- Bundle manager inspection confirms the installed `ShareExtensionAbility` still advertises `ohos.want.action.sendData`. Sampled logs showed the share extension lifecycle and no xopc JS crash or app freeze.
- Host verification: 50 test files / 327 tests passed. The signed debug HAP built successfully after one ArkTS syntax correction and was reinstalled successfully.
- The temporary 10-minute screen-off override used during UI automation was restored. No app data was cleared, no share was revoked or extended, and no test message was sent.

Local evidence is kept under ignored `.test/device-share-20260923/`, including the history list, action sheet, QR, ArkWeb preview, system share sheet and post-fix inbound preview screenshots/UI trees.
## Chat message layout and result density (2026-09-23)

- Installed the signed Debug HAP over the existing app without clearing pairing or session data.
- Confirmed short user messages render as a compact right-aligned light-accent bubble with the copy/edit actions aligned beneath it.
- The first max-width-only implementation clipped long user text on the right; this was rejected during device inspection and replaced with an explicit adaptive width (short messages) / 82% width (long or attachment messages) contract so text wraps.
- Confirmed an eight-file assistant deliverable block now renders a 3-row preview with a count header and `查看另外 5 项产出` control instead of an eight-row full-height card.
- No message was sent, no attachment was opened/shared, and no conversation data was modified.
- Evidence: `.test/chat-message-layout-20260923/compact-results-ready.jpeg`, `.test/chat-message-layout-20260923/user-message-4.jpeg` (the latter documents the rejected clipped intermediate build).

## Thinking and tool work-log parity (2026-09-23)

- Rebuilt and installed the signed Debug HAP after aligning the Harmony execution disclosure with the WebUI work-log hierarchy. Latest installed HAP SHA-256: `56449aa525c359c32bbf9c20d4b54f072c2b31bea3c8138dc9b7b83a2734f5c5`.
- Host verification passed: 52 test files / 334 tests; Hvigor completed the signed Debug build successfully. Existing capability/exception warnings remain and were not hidden.
- Installation and `EntryAbility` startup succeeded without uninstalling or clearing app data. No message was sent and no conversation, tool result or attachment was mutated.
- The first post-launch capture showed the app reconnecting. The phone then auto-locked before the real conversation and disclosure could be visually inspected. Final compact-row appearance and expand/collapse interaction therefore remain pending an unlocked screen; the lock-screen capture is not acceptance evidence.
- After unlocking again, the existing `总结下所有笔记内容` turn confirmed the compact collapsed row and successful expansion without exposing raw thinking. The first expanded build still showed raw tool IDs, which was rejected and replaced with WebUI-aligned semantic titles. The same follow-up tightened the header overflow control and conversation-settings sheet and removed continuous reading from that sheet. This final package installed successfully, but installation returned the phone to its lock screen before the revised tool titles and sheet could be captured.
- The rejected expanded state was addressed further: known tool IDs no longer fall through to raw names, semantic tools no longer expose raw input/output JSON in the normal UI, and consecutive successful read-only actions of the same semantic kind collapse into one `×N` row. Failed and running actions remain separate. All 337 host tests passed and a clean signed Debug build succeeded (SHA-256 `778d940fcd8708ff2297e01e878ef6890f2889eae99300b591377d38c80eaaa1`). After reconnect, `hdc install -r` and `EntryAbility` startup succeeded without clearing data. The compact header and settings sheet were captured; the sheet contains only Agent, Model, New Chat and Conversation Files. The Gateway currently reports `NO_VERIFIED_ROUTE`: a read-only host probe confirmed the phone's previously paired tunnel route is unavailable while the currently persisted tunnel route is healthy. Existing messages therefore did not load, and the latest semantic/grouped work-log rows are not yet claimed as visually accepted. Evidence: ignored `.test/chat-tool-groups-20260923/`.
