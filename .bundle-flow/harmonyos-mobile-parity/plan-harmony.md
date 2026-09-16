# HarmonyOS implementation plan

User authorised autonomous implementation and self-verification on 2026-09-17. Routine implementation choices and phase transitions do not require further confirmation.

## Architecture

ArkUI ComponentV2 -> observed view models -> repositories -> typed Gateway client -> NetworkKit. Platform services provide cryptography, secure storage, scanning, files, audio and push. The application owns connection lifecycle and releases listeners/network resources on shutdown. System theme resources and Chinese/English strings are shared by views.

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
