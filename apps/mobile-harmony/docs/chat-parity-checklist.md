# Chat / dock / drawer parity

Baseline: `apps/mobile-expo/src/features/chat/ChatScreen.tsx`, the components it composes, and `CapsuleTabBar.tsx`. Updated 2026-09-18 per user direction: opening a conversation switches the main Chat in place, retaining the drawer and dock; it must not push an embedded detail Chat. The historical verification entries below describe the earlier implementation, not the current navigation contract. This checklist is an acceptance inventory, not a completion claim.

| Area | Acceptance |
| --- | --- |
| Drawer | Left overlay; edge swipe; scrim/back/close dismissal; keyboard dismissal; dated, paginated history; selected indicator; search; new conversation; in-place selection with per-conversation drafts |
| Dock | Chat / Progress / Library / You; active capsule; attention badge; no dock under keyboard, action panel or drawer; destination back restores original tab |
| Header | Model title and picker; agent picker creates an isolated conversation; conversation actions sheet; conversation-scoped files; drawer remains available on every conversation |
| Composer | Multiline draft retained per conversation; panel; documents/photos/camera; attachment chips; voice capture; context references; project/environment scope; send/stop; queue next / steer |
| History | Loading/empty/error/retry; older-page anchoring; follow streaming only at bottom; markdown and media; thinking/tool rendering; copy/edit/retry/save-to-note/regenerate/read-aloud |
| Inputs | Queue polling and realtime invalidation; versioned edit/cancel; idempotent retries; no cross-conversation late result |
| Context | Project/local/worktree switch creates a new conversation; references; directory picker with lock state; context explanation |
| Attention | Clarification choices/free text/agent decides/cancel; pending attention opens correct destination |
| Voice | Dictation/record preview/transcribe; read aloud; continuous reading; assistant/natural voice call capability gating |
| Recovery | Gateway reconnect/error; resume active run; hidden root and detail realtime ownership; navigation during requests; background cleanup |

Verification must distinguish host tests, compiled ArkUI, emulator UI evidence and physical-device evidence. Use an isolated gateway fixture for message/queue/action mutations; do not send test prompts or cancel runs on the user's paired gateway.

## 2026-09-17 implementation and verification pass

Implemented in this pass:

- Independent, dated/paginated drawer data, profile shortcuts, search/new conversation, edge swipe, scrim/back dismissal, selected row indicator.
- Four-tab selection capsule with reduced-motion support, attention badge, keyboard/drawer/action-panel avoidance; root/detail conversation ownership preserved.
- Model and agent sheets, per-agent model preference for new sessions, scoped conversation files; project/local/worktree changes create a new conversation, selecting the existing scope is a no-op.
- Draft persistence scoped by Gateway and conversation, notes/tasks/workspace references, `/` command/skill palette and `@` file/note palette; local binary attachments and temporary file URIs are intentionally not persisted, matching Expo.
- System photo/camera/document pickers; image history preview and attachment download; versioned queue edit/cancel, send-next and steer, clarification choices/free text/agent decision/cancel.
- Copy/edit/save note/regenerate/read aloud, source-context versions retained on regeneration; structured history, collapsible thinking/tools, initial bottom scroll and older-page anchoring. Read-aloud cancellation releases request/player/cache resources on navigation/background.
- Fixed a device-observed reconnect loop: valid payload-free Gateway events were rejected by the native client. Added a regression test and verified that the connecting banner no longer remains on the emulator. Queue updates on the same active run no longer clear streamed text.

Evidence:

| Gate | Result |
| --- | --- |
| Harmony host tests | 109 passing across 24 files |
| Debug / release ArkTS HAP build | Both passed |
| CodeLinter | Zero error/warning diagnostics |
| Canonical brand / exported contract checks | Passed |
| Paired Pura 90 Pro emulator | Automated UI checks passed: drawer and dock visibility, model sheet, accessory panel, all four tab selections, keyboard avoidance, slash palette, cold-restart draft restoration, main draft retained after history detail |
| Screenshots / UI trees | Ignored local `.test/chat-ui/`; root, drawer, models, panel, palette, detail; `result.json` records assertions |
| Mate 60 | An earlier debug update installed without clearing data, but launch was blocked by the lock screen. At final signed-package installation the USB target was disconnected; the final version has not been installed or physically verified |

Repeat the non-mutating Gateway UI checks with an empty main draft, no active main run, and an already paired emulator:

```sh
HDC_PATH=/path/to/hdc node --experimental-strip-types apps/mobile-harmony/scripts/verify-chat-ui.mts 127.0.0.1:5555
```

The script edits only local starter and `/` drafts, verifies draft persistence across an emulator app restart, and removes them. It never submits a chat input, changes a model, deletes a conversation or cancels Gateway work. Screenshots may contain existing history: keep them local and out of Git.

## Follow-up: rich text, tools, attention and welcome

- Native Markdown now renders horizontally scrollable tables (alignment, escaped/code pipes, missing cells), task-list markers, list indentation, strikethrough, code-language headers and explicit code copying. HTTP(S) links require a tap and display the actual target before opening in the system handler; executable/file/credentialed links remain inert. Markdown images are links, not implicit remote downloads. Streaming updates invalidate changed render keys.
- Persisted tool calls/results are grouped by call ID, including out-of-order parallel results and older-page boundaries. Completed/error states, arguments, expandable full results and output attachments are retained. Ambiguous/orphan results stay visible; results never cross a user-turn boundary.
- Chat attention opens a three-item sheet with unseen-first ordering, internal destinations, review details enriched from `decisions`, gated approval controls, retry/acknowledge actions, pending/error feedback and a Progress destination. Local seen revisions are encrypted and Gateway-scoped; changed items reappear. Mutation responses after navigation cannot update a different screen.
- Empty-chat starters reuse the Expo English/Chinese copy through `scripts/export-welcome.mts`. Native selection covers empty/directory/project/task contexts, task attention/failure/review/next steps, project blockers/recovery, Agent specialization and date-seeded exploration. Tests compare native results directly with the shared ranker across 364 context/agent/language/date cases. Shipped Agent names are localized; custom names are retained. Context-fetch failure keeps usable suggestions and exposes retry. Tapping a starter fills an editable draft only.

Follow-up evidence:

| Gate | Result |
| --- | --- |
| Host tests | 133 passing across 28 files |
| Debug / release HAP | Passed |
| CodeLinter | Empty diagnostic report |
| Brand, Gateway contract, generated welcome copy | Current |
| Paired phone emulator | Seven journeys passed, including three directory starters, prefill without send, clearing the test draft and the prior dock/drawer/navigation/persistence checks |
| Attention UI | Explicitly skipped: paired Gateway has no unseen attention fixture. Action and destination behavior is host-tested, not claimed as device-tested |
| Remaining device coverage | Rich Markdown/tool fixtures, approval/retry writes and task/project welcome variants still need an isolated Gateway/device journey; current smoke tests do not cover them |
| Physical phone | Not connected; no new physical-device installation or acceptance claimed |

The UI runner now waits for loaded content and the actual keyboard/dock state, rather than sampling during animation. It records running/failed/passed status so stale results cannot masquerade as a successful latest run. The emulator emitted platform autofill-library/state-management diagnostics; no app crash was observed, but this is not a claim of zero runtime error logs.

## Follow-up: conversation search and management

- Drawer search now opens an independent `SessionsView` navigation destination instead of replacing the root Chat view. Returning through a history detail preserves the manager and main draft. Removed the old inline history/actions UI.
- Matches the current Expo search baseline: all channels (no `channel=webchat` restriction), trimmed 250 ms debounced search, submit/clear, calendar groups, relative timestamps, message counts and pinned/archived indicators. Current Expo does not expose separate channel/status filter chips; no new filter semantics were invented.
- Native virtualized rows support tap-to-open and a 300 ms long press that opens a menu, not selection. Explicit multi-select exposes archive/unarchive, pin, one-item rename and confirmed batch deletion. Rename and pin/unpin are also directly available from the row menu.
- Single deletion uses Expo's 5-second undo deadline. Batch operations serialize requests, block duplicates, retain only failed targets for retry and do not replay successful items. Selected later-page rows survive refresh, page offsets count raw records, stale queries/disposed views cannot overwrite newer state, and delayed/batch writes cannot follow a Gateway switch.
- Skeleton/empty/error/retry states reuse native components and theme resources. Batch controls use a neutral capsule with small icons rather than filled primary buttons. English/Chinese strings are included.

Verification: 152 host tests across 30 files; debug/release HAP and CodeLinter passed (empty diagnostic report); brand/contract/welcome generated checks are current. Eight Pura 90 Pro emulator journeys passed, including manager navigation, search/empty/clear, long-press menu, rename cancellation, explicit selection, batch-delete confirmation cancellation and detail→manager→main return with the original draft intact. The temporary slash draft was cleared. Screenshots/UI trees/results remain ignored in `.test/chat-ui/`. Attention UI is still explicitly skipped because the paired Gateway has no unseen attention fixture. Tests exercise API paths, all-channel queries, paging, search races, rename failures, partial batches, refresh failures, undo deadlines, navigation and Gateway isolation using mocks. No real conversation mutations were used for verification. Mate 60 is not connected; no new physical-device acceptance is claimed.

Session-specific remaining acceptance: committed rename/pin/archive/delete flows against an isolated paired test Gateway; custom/DiceBear Agent-avatar rendering (rows currently use a native conversation symbol); matched screenshots in both locales/themes and physical-device acceptance. The first empty-search UI assertion used a punctuation-separated phrase; Gateway FTS intentionally joins its tokens with OR, so it matched existing `xopc` history. The test now uses a single random token without changing Gateway search semantics.

The final bounded app-process hilog sample contains `CONCUR apply qos failed` and `HCF DestroyAlg25519* Invalid input parameter` diagnostics. No crash occurred during the eight UI journeys; their underlying cause is not established by this pass. Treat runtime-log cleanup as remaining investigation, not a zero-runtime-errors result.

## 2026-09-18 composer layout correction

Reference: the user's two screenshots and the current Expo `ChatComposer.tsx` / `composer-layout.ts`.

- Empty drafts use one compact row: microphone, editor, plus. Send appears only for a non-whitespace draft, attachment or reference; stop remains available during a run.
- Project/environment scope is inside the rounded shell with a divider. Horizontal shell inset is 12vp, scope height 36vp, editor minimum 40vp / maximum 120vp, tool circles 36vp and send circle 44vp with a 22vp symbol. The editor remains the same node when the first character expands the toolbar.
- Voice mode replaces the editor, closes the keyboard, and keeps bounded recording/preview/transcription controls inside the shell. Switching back requests focus only after the editor remounts. Existing tap-to-record, preview and explicit transcription behavior is retained; Expo's hold/slide voice gestures are **not** claimed as aligned by this layout change.
- Added host coverage for compact/expanded/payload rules and emulator UI assertions for measured dimensions, first-keystroke focus, send visibility and voice/keyboard switching. The new UI assertions have **not run successfully yet**: the available Pura 90 Pro emulator is unpaired. Do not equate those assertions with acceptance evidence.
- Host suite: **160 tests / 31 files passed**. Debug, release and locally signed debug HAP builds passed. CodeLinter report was empty. Existing compiler capability/throw warnings remain; no zero-compiler-warning claim.
- User reported reconnecting Mate 60. macOS detects a HUAWEI HDC USB device, but after restarting HDC and retrying the known target the device list still contains only the emulator. The new package is **not installed on Mate 60** and visual/keyboard/microphone acceptance remains pending USB debugging authorization and a paired Chat screen. No user messages or remote data were changed.

Subsequent reconnection: Mate 60 `9CN0223C27020749` became available over USB. The signed composer correction package (SHA-256 `a262d44d67a632f299be44ba3b4e724f359ec1e8ae139e07145afbe8eafc611a`) installed successfully with `install -r`, and `EntryAbility` started successfully. The captured UI tree contains the unpaired connection page and the active Scan Kit QR scanner, not Chat. Pairing/scanning was left untouched. This supersedes the installation blocker above, but does **not** complete composer visual/keyboard/voice acceptance; the user must finish pairing and open Chat first.

## 2026-09-18 keyboard focus and welcome correction

- Root cause: `conversation()` replaced the welcome scroll with a blank whenever the keyboard was visible. Message-list touches only closed the accessory panel, leaving the editor focused.
- Keep the welcome scroll mounted during keyboard changes. Existing window `RESIZE` and weighted message/welcome content shrink the viewport without translating the header; overflowing cards remain scrollable. No hard-coded keyboard height or additional page offset is introduced.
- Welcome/message-area touch-down dismisses editing, clears focus, cancels delayed composer refocus and closes composer overlays. Draft text is retained. Keyboard avoidance state continues to come from the window event, restoring the dock when the keyboard closes.
- Added `scripts/verify-chat-keyboard.mts`: explicit device target, three focus/dismiss cycles, header/content retention, composer position restoration and untouched draft assertions. It performs no text entry, sending or Gateway mutation; evidence stays in ignored `.test/chat-keyboard/`.
- Build and host verification: signed debug HAP passed; 164 tests across 32 files passed; CodeLinter returned no diagnostics. The package installed on Mate 60 without clearing data. This pass's physical UI check is pending: launch returned `10106102` because the device is locked; the UI runner stopped at its missing-Chat guard. Earlier composer checks do not establish acceptance for this keyboard correction.

Physical follow-up after unlock (2026-09-18): Mate 60 passed three focus/dismiss cycles on the welcome page and three on a populated history detail. The welcome/message surface stays at y=295px; the composer rises above the keyboard and returns to its original position after a content tap; focus becomes false. All three welcome cards remain visible while typing, and the main dock returns only on the main page. A direct message-text tap also dismissed focus/keyboard. Tapping a starter with the keyboard open filled a 60-character editable draft, retained focus and did not start a run; only that test draft was cleared. Returned to the original main Chat page. Evidence: ignored `.test/chat-keyboard/{welcome-result.json,result.json,welcome-open.jpeg,welcome-closed.jpeg,open.jpeg,closed.jpeg,body-tap.json}` and `.test/card-prefill.json`. The first run sampled the transient loading list before welcome mounted; the runner now waits for loaded starters/message items before taking its baseline. This supersedes the lock-screen verification blocker above. Coverage is the Mate 60 system keyboard in portrait, not third-party keyboards or foldable layouts.

## 2026-09-18 main-chat navigation correction

- User-directed behavior replaces the earlier detail-stack design: every `chat` route selects the Chat tab and clears secondary destinations. History drawer, session manager, attention and notification conversation routes share that entry point. Only one Chat view is mounted; the drawer and main dock remain available on selected history.
- Selection requests carry a revision, so opening the same requested ID again after a newly created conversation still works. Selection waits for an in-flight send to finish; switching cancels local voice/read-aloud, closes overlays and invalidates old context/queue/clarification view models. Existing conversation-scoped draft storage saves/restores text and references without sending.
- Main selection is persisted locally through the existing serialized secure store. New history resets the previous agent/project immediately, stale startup restoration cannot overwrite the selected conversation, and stale creation cannot clear its loading state.
- Host verification: 170 tests / 32 files passed. Signed debug HAP built and installed without clearing data. Final CodeLinter scan returned no diagnostics.
- `scripts/verify-chat-navigation.mts` covers in-place history selection, selected-row state, tab round trips, session-manager handoff and per-conversation draft restoration, using no Gateway mutations. It requires an empty draft, no active current run and the selected conversation visible in the drawer. After the user unlocked Mate 60, selected an existing visible history fixture and **passed all three journeys**: another history opens with the drawer/dock intact, selecting it again and switching tabs preserve selection, and opening the original fixture through the session manager restores its local draft on the main Chat. Only the temporary `navigation-draft-check` text was removed; no messages, conversations or Gateway settings were changed. Evidence remains ignored in `.test/chat-navigation/result.json` and corresponding UI trees/screenshots. The earlier attempts stopped before typing because the initial empty conversation was outside visible history and the phone locked.
- Updated the existing emulator UI runner to assert main Chat/dock and use explicit history selection instead of Back to restore its test conversation. The full emulator runner has not been rerun for this change.

## Still open — do not mark full Chat parity complete

- Natural/assistant realtime voice calls (PCM v3 transport, interruptions, audio routing and capability gating), continuous automatic reading, inline audio/video playback and recorded-voice management.
- Session-management mutation/device/avatar acceptance described above; core search/menu/multi-select implementation is present.
- Full rich-message fidelity: review/artifact cards, complete ordered streaming-content blocks, inline Markdown image previews and every Markdown block supported by Expo. The native renderer remains a subset, despite the table/link/tool improvements above.
- Matched Expo/Harmony screenshots in both languages/themes and real-device acceptance. The UI pass above does not exercise camera, microphone, TTS provider output or mutations on the user's Gateway.
- Isolated end-to-end send/stream/stop/steer, clarification and queue-conflict scenarios remain a separate acceptance gate; their host-mocked tests are not claimed as physical end-to-end evidence.
