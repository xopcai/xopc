# HarmonyOS implementation plan

User authorised autonomous implementation and self-verification on 2026-09-17. Routine implementation choices and phase transitions do not require further confirmation.

## Architecture

### UI acceptance correction (2026-09-17)

Physical-device feedback rejected the placeholder brand and simplified screens. API coverage is not mobile UI parity. Reopen visual/product acceptance using `apps/mobile-harmony/docs/mobile-ui-parity-audit.md`: shared brand assets, four-destination shell, main-chat/history/composer, Progress/Library, domain-specific details and grouped settings. Do not mark stage 4.7.1 complete until reference screenshots and interactions match on device. Existing protocol and storage verification remains valid only for its original scope.

First correction pass implements the brand, retained four-tab shell, Gateway-scoped main chat, independent detail navigation, real Progress/Library feeds, Inbox judgment routing, native settings subpages and keyboard-resize behavior. Its original evidence was a debug build, 69 host tests and CodeLinter; it did not establish full parity.

The subsequent Chat/dock/drawer-focused pass has 109 host tests, debug/release builds, zero CodeLinter diagnostics and repeatable paired-emulator UI evidence, including cold-restart draft persistence and root/detail isolation. An earlier Mate 60 signed update installed while the phone was locked; the USB target disconnected before final installation, so the final version and physical acceptance remain pending. See `apps/mobile-harmony/docs/chat-parity-checklist.md` for implementation details, evidence and explicit remaining gaps (realtime voice calls, rich-message parity, spotlight/attention/session-management and end-to-end mutation tests). Stages 4.3.1 and 4.7.1 are not fully accepted.

ArkUI ComponentV2 -> observed view models -> repositories -> typed Gateway client -> NetworkKit. Platform services provide cryptography, secure storage, scanning, files, audio and push. The application owns connection lifecycle and releases listeners/network resources on shutdown. System theme resources and Chinese/English strings are shared by views.

The next follow-up adds Markdown tables/safe links/code actions, call-ID tool-result grouping across history pages, the full Chat attention sheet action wiring with Gateway-scoped seen revisions, and mobile welcome starters derived from shared localized copy and parity-tested ranking. Evidence: 133 host tests (28 files), debug/release builds, empty CodeLinter report, and seven emulator journeys including editable starter prefill. The paired Gateway lacks an unseen attention fixture, so attention UI is explicitly skipped; rich-message/action fixtures, realtime voice, session management and physical acceptance remain open. See the follow-up section in `apps/mobile-harmony/docs/chat-parity-checklist.md`; these additions do not close stages 4.3.1 or 4.7.1.

The session-management follow-up replaces the inline history list with an independent native destination. It adds all-channel debounced search, virtualized calendar groups, explicit menu-to-multiselect interaction, rename/pin/archive actions, five-second single-delete undo, confirmed batch deletion, partial-failure retention and Gateway/async isolation. Host verification now has 152 passing tests across 30 files. See the session-management evidence in `apps/mobile-harmony/docs/chat-parity-checklist.md`; isolated mutation journeys, Agent avatars and physical/visual acceptance remain open, so stages 4.3.1 and 4.7.1 remain unaccepted.

## Four: file-level changes and dependencies

| ID | Stage / files | Dependencies | Acceptance |
|---|---|---|---|
| 4.1.1 | `apps/mobile-harmony/{build-profile,oh-package,hvigor/hvigor-config}.json5`, `AppScope`, `entry`, build runner | none | Unsigned HAP build with installed API 26; no secrets or machine paths tracked |
| 4.1.2 | Gateway device contract, device-auth types, platform parsers and contract fixture exporter | none | Harmony accepted, old platforms unchanged, invalid platform rejected |
| 4.2.1 | `model/`, `service/` invitation, crypto, credentials, HTTP/auth | 4.1.1, 4.1.2 | Known-answer signature tests, reject malformed invitations, secure persistence, refresh |
| 4.2.2 | Realtime client and repositories | 4.2.1 | Hello/tickets, subscription ACK, reconnect, gaps, teardown |
| 4.3.1 | Chat/session repository, view models and views | 4.2.2 | List/create/open/send/stream/abort/history/reset/delete with confirmation |
| 4.4.1 | Task/project/automation repositories and views | 4.2.1 | List/detail/create/edit/status/run flows match API |
| 4.5.1 | Notes/files/search repositories and views | 4.2.1 | CRUD, Markdown preview/edit, uploads/downloads, search, error states |
| 4.6.1 | Push provider/server integration and platform client, audio/settings | 4.3.1 | Push registration/delivery, voice record/transcribe/play, permissions, theme/locales |
| 4.7.1 | Contract/unit/UI tests, verification report and release runbook | all | Release build, lint/tests, real device validation evidence or explicit blockers |

## Test stories

### Chat re-audit continuation (2026-09-22)

Use `apps/mobile-harmony/docs/chat-parity-audit-20260922.md` as the current scenario inventory. Under the existing autonomous authorization, implement continuous read-aloud completion tracking and RN speech text/language semantics, then bounded Gateway/conversation-isolated secure history-head seeding with network-wins guards and mutation invalidation. Follow with image editing, audio ownership, richer previews and stream recovery. Keep host/build/device evidence distinct; do not touch unrelated Gateway/Expo changes or reset existing working state.

File preview continuation: translate Expo `AttachmentRenderer` and `FilePreviewModal` behavior into Harmony without editing Expo. Group ordinary attachments into a bounded compact list; keep audio separate; route image/Markdown/text/HTML/audio/video/binary explicitly; preserve extracted-text fallback and share/download. HTML must remain local and isolated with CSP, JavaScript/storage/file access disabled and navigation intercepted. Verify with classification/security fixtures, lint, debug/release/ohosTest builds, then non-mutating device UI evidence when HDC is available.

Share continuation: align Chat and Files managed-file sharing with Expo `/api/shares/auto`; never expose authenticated Gateway media URLs or replace governed links with temporary phone cache URIs. Resolve only explicit file IDs, `xopc-file:` IDs, or session-scoped workspace paths. Show link reachability before copy/system share and keep download separate. Share history/revoke/extend, note/session shares, QR/embedded preview, directory confirmation and system-to-xopc intake remain separate incomplete scenarios until implemented and verified.

Share continuation result (2026-09-22): implemented the remaining app-side scenarios. Personal → Shared links lists active/inactive governed records and supports preview, 1/3/7-day extension and confirmed revocation. Sessions use a fingerprinted preview before immutable snapshot creation; notes pin the requested version; directories require an explicit browsable-folder versus ZIP choice. All result surfaces share QR, copy, outbound system share and same-origin ArkWeb preview behavior. `ShareExtensionAbility` receives system text/link records, filters low-value/OTP content, masks sensitive previews, and requires an explicit save-to-note or new-chat action. Evidence: 325 host tests / 50 files, successful Debug HAP build and clean changed-source CodeLinter. HDC reported no connected target, so system share-panel discovery and complete physical interaction acceptance remain open under 4.7.1.

### RN Chat audit follow-up (2026-09-18, user approved)

Implement the reviewed differences in order, then perform a separate correctness/security/performance review. No Gateway schema changes or Expo edits. Preserve paired-device data.

1. Display contract: port RN user-text scrubbing to `common/chatDisplay.ets`, compare shared fixtures, wire history and message actions without mutating stored content.
2. History/scroll: automatic top pagination, concurrency/error guards, row-offset anchoring, preserve loaded pages on snapshot refresh, virtualized rows with identity-safe rendering.
3. Actions/audio: neutral secondary action styling, copy-code action, right-aligned user actions, unified pause/resume/retry, audio deduplication.
4. Attachments: composer image previews, full-resolution bounded image preview, Markdown preview, safe sharing/download, bounded request dedup/cache with Gateway isolation and lifecycle tests. Do not enable arbitrary active HTML without sandboxing.
5. Stream/render: replace full JSON clones with typed copy-on-write projection, stable Markdown rendering identities, test previous snapshot immutability and rich state transitions.
6. Verification/review: host fixtures, debug/release builds, lint, emulator UI fixtures and non-mutating physical journeys where available; record incomplete capabilities explicitly rather than marking full parity from build success.

### Rich Chat completion (2026-09-18)

User requested deep scenario parity, including thinking, tools, deliverables and images. Continue under existing autonomous authorization. Source of truth: Expo `session-message-parser`, `assistant-turn-view-model`, `AssistantStepsBlock`, `ToolUseBlock`, `AssistantDeliverablesCard`, `AttachmentRenderer` and gateway-contract / agent-stream-client. No backend or Expo edits planned.

1. Extend `model/chat.ets`, `common/chatProtocol.ets`; add `common/chatRichContent.ets`, `common/chatStream.ets`: typed ordered blocks, tool identities/results/details, reviews, media, authoritative outcome, product references. Preserve existing text fields for actions. Merge assistant fragments without crossing user/turn boundaries. Tests include partial pages, duplicate/replayed events, unknown blocks and malformed metadata.
2. Replace live string-only rendering in `chatViewModel.ets` and `ChatView.ets` with the same rich row projection as history. Keep snapshot recovery conservative (do not append deltas already persisted); retain terminal content until successful history reload. Cover command, patch, review, outcome, progress and thinking-end events.
3. Add `ChatMessageContent.ets`, `ChatStepsView.ets`, `ChatDeliverablesView.ets`; extend tool/media/Markdown views. Calm timeline, reasoning preferences, safe expandable input/output, artifact availability, product routing, image preview and safe authenticated media reads. No credential-bearing external links.
4. Add deterministic rich-chat host fixtures and emulator UI acceptance with isolated data. Build, lint, run all Harmony tests, then signed device acceptance when available. Record each coverage level honestly; voice-call parity is a separate outstanding capability, not implicitly accepted by message rendering tests.

Order: protocol → stream → presentation/media → regression/device evidence. Retain all existing composer, keyboard dismissal and main-page conversation navigation contracts. Rollback is a corrective app build, never a database migration. Keep unavailable media recoverable and never report inferred/generated files as authoritative deliverables.

Pass evidence: rich projection/presentation implemented, 204 host tests / 35 files and 5 native rich-message fixtures pass; debug/release/signed debug builds pass and CodeLinter is empty. Device/real-service acceptance is still open, as are the explicit remaining capabilities in `apps/mobile-harmony/docs/chat-parity-checklist.md`. Mate 60 was not connected at this pass; do not close 4.3.1 or 4.7.1.

Attachment follow-up: normalize Expo historical speech aliases, render attachments/references after a successful send, allow bounded safe document data previews, fetch before save-picker creation and reject malformed/oversized HTTP bodies. Filter empty execution steps and add conservative recovery/replay regression cases. Introduce `service/chatMediaPlayback.ets` with explicit native audio lifecycle, progress/pause and stale-callback/resource cleanup guards. Evidence is 229 host tests / 36 files and 7 native fixtures, including synthesized WAV playback/progress/pause/cache cleanup and offline text preview. Actual video/remote transfers/real WSS resume/phone acceptance remain separate open gates.

- US1: Open unpaired app, paste/scan valid invitation, approve on Gateway, confirm connection survives restart. Invalid/expired/untrusted invitations stay disconnected.
- US2: Create conversation, send input, observe streamed output, background/resume, verify no duplicates. Abort stops the current run.
- US3: Create/update task, associate project, change status, verify on existing mobile/Gateway.
- US4: Create/edit automation, run manually, inspect execution outcome.
- US5: Create/edit/search/delete note, upload and preview file, refresh from another client.
- US6: Record audio, deny/regrant permission, transcribe, play; tap push to correct conversation.
- US7: Offline launch/resume, token expiry/revocation, route failure, WS gap and server upgrade preserve clear recoverable UI states.

Capture screenshots for initial/key/final states and collect redacted hilog. Test phone first, then foldable/tablet layout if available. Keep application bundle ID provisional until Huawei registration; no store publishing is implied by implementation.
