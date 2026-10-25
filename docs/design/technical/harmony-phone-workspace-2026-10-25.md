# HarmonyOS conversation phone workspace

## Scope

A conversation with an active Phone Use connection exposes a phone icon in its existing header. The conversation stays selected on first discovery. Tapping the icon or swiping left opens the phone page. A right swipe returns while viewing; manual control disables outer paging so phone gestures are never also navigation gestures.

The implementation uses the existing registered Android/cloud devices, Phone Runtime, ADB/scrcpy transport, assistance recovery and handback continuation. It does not provision cloud instances, distribute ADB credentials, stream audio or add multitouch.

## Modules

- `ChatView.ets` retains the conversation instance inside a two-page Swiper. Header discovery does not subscribe to pixels.
- `phoneViewModel.ets` owns foreground discovery, state refresh, control commands, assistance restoration and cleanup. Gateway/conversation/visibility generations fence asynchronous results; a late successful takeover is explicitly released.
- `phoneRepository.ets` uses signed device HTTP requests and transient, authenticated binary screenshot reads.
- `phoneStream.ets` uses an independent signed WebSocket, parses the existing 32-byte video envelope, and sends ordered single-pointer input. The normal conversation realtime transport remains separate.
- `phone_video.cpp` uses the native H.264 decoder with Surface output. Its bounded input queue and worker keep codec buffers off ArkUI rendering callbacks. Decoder errors or first-frame timeout switch to explicit screenshot mode.

The connection, task and control ownership states are separate. Viewing does not grant control. Returning or backgrounding while controlling releases manual ownership and leaves execution paused; explicit handback re-observes and resumes through the existing deduplicated Gateway path.

## Authorization

`phone.view` plus `sessions.read` permits viewing. `phone.control` additionally requires `sessions.write` and permits requesting exclusive control. Phone registration, credentials, settings and global device viewers remain administrator-only. Chrome principals cannot acquire mobile phone access through this surface.

The administrator sets Not allowed / View only / View and control in paired-device details. Existing scopes are preserved; existing devices receive no automatic new grant. Grants live in the existing `devices.scopes_json`; no schema migration is needed.

`authorizePhoneAccess` reloads current grants and Access Session validity for long-lived connections. Native tickets bind the device key, access identity through their validation closure, conversation/transcript/session association, purpose and interactive control epoch. Tickets expire after 30 seconds and are consumed once. Native upgrades use the existing CONNECT proof, while browser upgrades retain Origin checks. Only administrator browser requests keep the legacy ticket purpose default.

Manual input is checked again at dispatch, including inside queued Runtime operations. Read-only tickets cannot send input or cancel another client's gesture. Device removal and phone permission changes invalidate pending tickets and close existing sockets; periodic validation is a fallback. Closure releases held touches and manual ownership. Inputs already sent to a device cannot be undone.

## API

- New `GET /api/phone/conversations/:conversationId/summary`: safe header metadata and the current binding, excluding names and binding details when ungranted.
- Existing conversation status, frame, ticket and control endpoints are reused. Native frames and control requests require the expected transcript identity.
- Ticket requests add `purpose`, `expectedTranscriptId` and the interactive `epoch`.
- New administrator `PATCH /api/phone/device-access/:id` accepts only `access: none | view | control`, never arbitrary scopes.
- Compatibility advertises `mobilePhoneWorkspaceV1` and `phoneMediaProtocolVersion: 1`.

Native status responses omit UI facts, readings, trajectories, raw goals and operational payloads. Pixel buffers are transient and excluded from chat history and ordinary logs.

## Lifecycle and recovery

The active conversation continues receiving messages while its phone page is visible. State polling runs only in the foreground, with a slower header-discovery cadence and a faster phone-page cadence. Manual heartbeat remains separate. Switching Gateway, closing, backgrounding, losing authorization and geometry changes cancel input and invalidate stale work.

Persisted assistance is shown as reconnectable before requesting video; takeover restores the checkpoint, refreshes the new phone session binding, and only then opens video. Reconnecting video never replays input. Snapshot controls require a fresh frame and native verification. Task cancellation is explicit and separate from device disconnect.

## Validation

Targeted tests cover the real authenticated, lazy-loaded HTTP route path, grant escalation denial, transcript fencing, control epochs, revoked grants, signed native ticket binding, read-only streams, single-use tickets, stale asynchronous responses, late takeover cleanup and contain-coordinate mapping. Native and cloud rendering must additionally be accepted on a device whose signing profile and Gateway deployment support this build.

### Local verification result

- HarmonyOS service/UI-model suite: 124 files, 810 tests passed.
- Phone/runtime/route regression: 33 files, 495 passed and one skipped; an additional stale-video-cleanup/manual-grant regression was then added and the 59-test runtime file passed.
- Real HTTP listener tests exercised device-signed requests through `createHonoApp`, scope middleware and lazy route selection.
- Root TypeScript check, targeted ESLint and Web production build passed.
- Native C++ plus ArkTS Debug and Release unsigned HAP builds passed with DevEco SDK 26.
- CodeLinter found no diagnostics in the new phone source files. Its nine existing startup-icon recommendations include the main manifest and local historical fixture projects.
- Physical-device acceptance subsequently resolved the profile bundle-name mismatch and passed the core workflow on BRA-AL00 with an actual Alibaba Cloud test phone. Fast-touch queue overflow was fixed with ACK-paced pointer coalescing. See [physical-device acceptance](harmony-phone-workspace-device-acceptance-2026-10-25.md) for evidence, cleanup and untested cases.

## Phone-page control hierarchy

Keep one persistent bottom action: Take control / Return to AI. Returning to AI uses the existing handback command and continuation rules; More → End control, keep paused uses release. Put Back, text entry, pause/resume, reconnect and confirmed Stop in the native header More menu. Text input belongs in a separate sheet, scoped to the current phone session and cleared on dismissal or ownership loss. Viewing-only devices have no takeover action or manual-input menu items. The page uses existing semantic theme tokens, a compact title/status header and restrained rounded controls.
