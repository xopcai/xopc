# Persistent voice conversation delivery

Date: 2026-09-05. Repository: xopc. Each stage was implemented, reviewed and corrected before proceeding.

## Contract

One persistent Chat Session owns text and voice history. Starting or reconnecting a call never creates another Chat Session. Only explicit new-chat/reset operations change conversation identity. Transport call IDs identify connection lifetimes, not separate conversations.

## Stage 1 — independent call surface

Implemented an app-scoped call provider, fixed-size expanded dialog and minimized controls. Dictation stays in the composer. The old mixed conversation controls, engine query parameter and composer-specific hook were removed; all ordinary capture surfaces share the realtime hook without a compatibility wrapper. Microphone mute disables the input track and suppresses captured-audio upload while preserving playback. Gateway/account changes dispose capture.

Self-review fixes:

- Discard partial encoder buffers when muting; send bounded synthetic silence to close pre-mute VAD speech.
- Fence delayed permission, connection and recorder callbacks, including pending samples after cancellation and old dictation-stop callbacks after a new capture starts.
- Serialize microphone ownership; make conflicts visible in dictation as well as calls.
- Keep response state separate from captions; separate microphone/device errors from service setup errors.
- Allow an empty project preparation screen to create its initial Chat once before opening a call.

Initial stage validation: Web typecheck and 19 focused tests passed. Final tests additionally prove that a call survives initiating-page unmount, minimization and reopening, then reconnects with the original Chat key.

## Stage 2 — durable conversation continuity

Restored native speech into canonical context with actual user/assistant roles. Both direct context reads and the real embedded SQLite SessionManager hydration path use one projection. Native connections receive configured Agent name/instructions and bounded visible Chat history. Tool output and hidden reasoning are excluded; interrupted assistant output becomes an explicit marker in model context while the original record remains available for display.

Self-review fixes:

- Correct the separate embedded hydration path, which otherwise would have reintroduced custom speech as user messages.
- Validate frozen Chat identity before/after loading history and on persistence.
- Bound serialized JSON, including escaped multilingual text, to the platform's 8,000-character instruction envelope. Avoid quadratic truncation of very large individual messages.
- Await native transcript writes during engine close before releasing the Chat reservation.
- Emit transcript-updated notifications after native writes so Chat reloads saved speech.

Stage validation: 63 relevant tests passed and the opt-in paid-provider test was skipped; core typecheck passed. Tests cover actual SQLite hydration, speaker roles, interrupted text omission, history limits and pending writes at shutdown.

## Stage 3 — shared setup

Added capability preflight before microphone acquisition, shared service setup in Settings and the call window, collapsed native advanced settings, and a single composer call entry point. Conversation content uses the existing SQLite transcript. The default service choice configures input, realtime output and native voice together.

Self-review fixes:

- Preserve selected voice and advanced overrides when re-enabling the same service; clear incompatible route overrides when changing services.
- Reuse the shared input credential for native calls instead of duplicating secrets.
- Keep the server reservation until engine cleanup and pending transcript/interruption writes finish.
- Test authentication on creation and preflight through the actual lazy route dispatcher.
- Remove obsolete output-mute translations and rewrite the old fresh-call documentation.
- Remove three unnecessary assertions in the existing voice-diagnostics tests that blocked repository lint.

## Final verification

- Full backend/extension suite: **1,057 test files / 5,896 tests passed**, one opt-in paid-provider test skipped. This ran before the final focused cleanup.
- Final voice/session/settings/composer regression: **50 files / 336 tests passed**, one opt-in paid-provider test skipped. This includes the later cancellation and timing fixes.
- Lazy-route tests covered authenticated creation and preflight without creation. The history endpoint was subsequently removed with the redundant list.
- Node build, declaration generation and Web production build passed. Core typecheck, repository lint, docs check and `git diff --check` passed. Existing Web bundle-size/plugin timing warnings remain.
- Headless Chrome checked the real call components with synthetic microphone audio and mocked v2 provider responses: desktop and 390px mobile layouts, current captions, actual input-track mute, minimize/page navigation, microphone release and same-key reconnect. Screenshots were visually inspected; temporary preview files and server were removed.

## Acceptance boundaries

A persistent Chat does not imply an infinite provider connection. Network loss, renderer reload or configured call limits require an explicit new call in the same Chat. Context remains bounded; earlier excerpts can omit details. No automatic microphone reopening, transport replay, engine fallback or additional memory database was introduced.

Native voice receives configured identity/custom instructions and visible Chat history, not the complete Agent tool/system prompt or all profile Markdown. Exact heard-offset truncation inside the active native connection is not certified; interrupted text is omitted from later restored context.

Physical microphone/Electron permission behavior, acoustic echo cancellation, subjective latency and live paid-provider/platform billing were not exercised in this delivery. No production configuration, platform code, route publication or deployment was changed.


## Follow-up — native disconnect during interaction

The reported 2026-09-05 07:11:35 UTC log was `Voice:Omni / OMNI_PROTOCOL_ERROR`. The earlier `STT:Factory / groq` warning is from an independent STT configuration path; native conversation does not invoke that STT pipeline. The original catch-all log did not retain the internal cause, so that historical event cannot be conclusively attributed from the log alone.

A local regression reproduced the same fatal code and user message with valid audio: a ten-second reply arriving faster than playback overflowed the old four-second upstream queue. Fixed by separating a one-minute bounded upstream buffer from the existing two-second client playback window. Overflow or stalled playback now interrupts only the affected reply, emits a recoverable warning and keeps the call connected. Cancellation still fences queued and late old-response audio.

Fatal errors now distinguish connection rejection, closure, invalid audio/transcripts and protocol failures, with a diagnostic reference. HTTP upgrade rejection status and WebSocket close codes are logged without upstream bodies, keys, audio or transcript text.

Verification: the reproduction failed before the fix; after the fix, 63 realtime engine/client tests passed (one paid-provider test skipped), including fast long replies, queued interruption, overload followed by another turn, stalled acknowledgement recovery and muted-call recovery. Existing global-provider tests cover minimize/navigation continuity. Production build and changed-source lint passed. No live paid-provider call or production restart was performed for this follow-up.

## Follow-up — Agent voice interruption stability

The reported `Realtime TTS aborted` stack originates in `agentEngine.close` after `session.stop`. Caller cancellation was incorrectly logged as provider failure. Realtime calls already set `allowFallback: false`, so “trying next” was misleading in that path; ordinary streaming callers could also continue their fallback chain after cancellation.

Corrections:

- `GatewayAgentRunner.runAgent` delegates generator return/throw to its inner stream. Early exit now runs cleanup instead of leaving the Chat marked active.
- The thinking-event coalescer observes rejection of its prefetched read even while a consumer is paused. Actual consumers still receive errors when awaiting that read. The new cancellation test reproduced an unhandled `AbortError` before the fix.
- Cancelled gateway runs publish cancelled status rather than provider-error status, including early consumer exits.
- Agent voice awaits pending TTS cleanup and interruption audit writes before advancing or releasing the call reservation. Cancelled replies cannot flush late text-completion events or play a late-ready stream.
- Streaming TTS checks caller cancellation before preparation/provider calls, after provider readiness and in its failure path. It releases late-ready streams, avoids fallback and warning logs on caller cancellation, and only says “trying next” when another provider is actually available.
- DashScope cancellation uses `AbortError`, closes normally and fences late provider messages.
- Session model settings persist before lazy Agent creation; runtime mutation is attempted only when an instance exists. Selecting a model in a new or previously native-only Chat no longer produces the absent-instance warning.

Validation: backend/extension suite passed 5,917 tests with one opt-in paid test skipped before the final prefetch correction. Final targeted gateway, Agent/session, STT/TTS, native voice and frontend capture regression passed 157 tests with one opt-in paid test skipped. Production build passed; final core changes also passed Node rebuild, typecheck and changed-source lint. Physical microphone, remote service behavior and a production restart remain outside this local verification.

## Follow-up — remove redundant call list

Removed the composer call-history list and its per-record Continue actions. All calls already resume the same Chat, so timestamps and durations did not identify independently resumable conversations. Removed the dedicated history API, lifecycle writer, folding code, translations and history-specific mode override. The call button and app-scoped call controls remain the entry points. Persisted metadata stays excluded from conversation display and model input; saved speech and pending-write cleanup remain intact.

Validation for this removal: 7 focused test files / 68 tests passed, covering Chat context projection, embedded hydration, runtime reservation cleanup, lazy-route authentication and app-scoped voice controls. Core typecheck, Node/declaration/Web production build, changed-source lint, docs check and diff whitespace check passed.

## Follow-up — stop unexpectedly submits the next utterance

Reproduced with automatic barge-in disabled, matching the local configuration: stopping the active reply released the conversation chain, which immediately ran queued transcripts and a late final from unfinished speech. Manual cancellation now invalidates queued inputs and unfinished utterances observed before the stop, resets queue capacity, and retains cleanup ordering. New speech remains accepted in the same call; automatic barge-in behavior is unchanged. The regression first failed with both stale inputs reaching the Agent, then passed after the fix. The actual call-button test also verifies that interruption sends only response cancellation, without committing input or closing capture.

Validation: 14 focused test files / 73 tests passed; one paid-provider test skipped. Core typecheck, Node build, changed-source lint, docs check and diff whitespace check passed. No live microphone retest or gateway restart was performed.
