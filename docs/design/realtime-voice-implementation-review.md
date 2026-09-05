# Dual-engine voice implementation review

Date: 2026-09-05. Repositories: xopc and xopc-platform. Changes are local; no push, deployment, production credential change or model publication was performed.

## Phase 1 — isolate the existing Agent pipeline

- Extracted STT/Agent/TTS execution into `AgentVoiceEngine`; the session runtime owns transport/lifecycle only.
- Retained dictation, tools, approvals, TTS recovery and canonical Agent persistence.
- Self-review fixes: delayed upstream setup after close, final-utterance deduplication, bounded queued turns/speech/text, interruption fencing.
- Existing runtime/playback tests and new engine lifecycle tests pass.

## Phase 2 — explicit engine and protocol v2

- Conversation creation requires `agent` or `omni`; no engine parameter for dictation.
- Added response-tagged binary output with connection sequence validation.
- Self-review fixes: stale audio/text cannot affect the replacement response; old async capture callbacks cannot restart an ended call.
- Removed v1 wire handling/documentation and the unused semantic-VAD option. No compatibility branch or silent engine fallback remains.
- Protocol, client hook and existing Agent playback regression tests pass.

## Phase 3 — native Qwen conversation

- Added one certified native Qwen route, direct credentials or platform OAuth, server VAD and PCM streaming.
- Reused SQLite custom-message persistence with frozen session identity and correct speaker projection; native transcripts are not Agent instructions.
- Self-review fixes: API-key masking and masked-save preservation, reset/deletion write fencing, cancellation after provider generation has already completed, output queue bounds.
- Native engine, settings round-trip, history isolation and storage tests pass.
- Paid vendor verification passed: synthetic speech generated in memory → native engine → input transcript and audio reply. No microphone recording or raw audio files were created. Verified Qwen's actual cancellation-race error and usage detail field names.

## Phase 4 — platform relay and billing

- Added `/v1/audio/conversations/realtime`, nginx upgrade routing, scope/user checks, origin-bound debug tickets, connection bounds and existing upstream-pool admission.
- Added explicit four-modality pricing, call reservations, per-response usage deduplication and pending reconciliation.
- Self-review fixes: unavailable pool state, no automatic expiry refund for unknown native usage, atomic ledger/call settlement, rollback and duplicate-settlement protection, bounded usage drain after disconnect.
- Platform model-gateway suite: 144 tests passed, including actual local WebSocket relay lifecycle tests and administrator configuration/debug routes.

## Phase 5 — product surfaces and final regression

- xopc: mode selector and separate Omni settings within the existing Voice page.
- Platform: Conversation under model resources, four-rate publishing, pending settlement review and a native mode in the existing audio debug lab.
- Replaced PRD, technical design and protocol docs with the implemented contract; updated English/Chinese usage docs.
- xopc full regression run: 1,048 files / 5,847 tests passed; the opt-in vendor test is skipped by default and was run successfully separately. Subsequent added tests and changed modules passed focused reruns.
- Latest focused voice/config/client suite: 51 tests passed, one live test skipped by default.
- Platform workspace typechecks, tests and production builds passed. xopc Node/types/Web production build, typechecks, changed-source lint and docs check passed. Existing bundle-size warnings remain; no new build failure.

## Explicit release boundaries

- Real-device microphone/speaker echo, weak-network interruptions, background-tab suspension and long-call acceptance remain manual checks.
- Exact heard-audio context truncation is not certified; interrupted text may include unplayed content. The UI/documentation says so.
- Each native call starts fresh, without tools or imported Agent history. Switching engines requires ending the call.
- Managed native calls reserve a 100,000-token budget and cap customer charges at the reservation; any final-response overrun is platform cost. Missing usage stays pending for verified reconciliation.
- The platform deployment remains a single gateway writer, not active-active serving.
- Production enablement requires coordinated renderer/gateway deployment and explicit administrator publication of route/prices.
