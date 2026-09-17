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

- US1: Open unpaired app, paste/scan valid invitation, approve on Gateway, confirm connection survives restart. Invalid/expired/untrusted invitations stay disconnected.
- US2: Create conversation, send input, observe streamed output, background/resume, verify no duplicates. Abort stops the current run.
- US3: Create/update task, associate project, change status, verify on existing mobile/Gateway.
- US4: Create/edit automation, run manually, inspect execution outcome.
- US5: Create/edit/search/delete note, upload and preview file, refresh from another client.
- US6: Record audio, deny/regrant permission, transcribe, play; tap push to correct conversation.
- US7: Offline launch/resume, token expiry/revocation, route failure, WS gap and server upgrade preserve clear recoverable UI states.

Capture screenshots for initial/key/final states and collect redacted hilog. Test phone first, then foldable/tablet layout if available. Keep application bundle ID provisional until Huawei registration; no store publishing is implied by implementation.
