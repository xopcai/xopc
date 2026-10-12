# Ada voice silence and stability investigation

Date: 2026-10-12 (Asia/Shanghai).

## Current failure

The connected Harmony device's 09:08 voice logs show an assistant reply finishing with zero buffered and played milliseconds. Gateway logs for the same response record `Platform voice disconnected before completion`. This reply failed before audio reached the phone; the evidence does not establish a renderer failure.

A fresh authenticated probe of the published `tts` model, service version 5, reproduced a WebSocket close after 1,680 ms: code 1011, reason `Provider session closed`, zero audio bytes. This confirms the upstream problem remains present after yesterday's investigation. The platform relay currently exposes a generic provider-close reason; the underlying supplier failure still requires platform diagnostics. No platform configuration or production deployment was changed.

## Implemented changes

- Personal reply delivery now offers the already persisted final text to the active assistant voice engine. It uses the existing PCM framing, synthesis queue and playback acknowledgements, without delegating another Agent run or writing another chat reply.
- Busy calls defer delivery through the existing result outbox retry policy. Delivery IDs deduplicate accepted replies within a call. Failure before any output audio remains retryable; interruption after audio has been submitted is consumed to avoid repeatedly speaking an interrupted result. This is submission/acknowledgement semantics, not proof of audibility.
- Text notifications remain available immediately. Asynchronous voice delivery keeps the outbox lease alive until completion. Successful acknowledgement of notification is recorded only after the callback resolves.
- Platform voice errors now retain the bounded WebSocket close code and reason for diagnosis.

These changes repair the independent missing final-reply speech path. They do not repair or mask the reproduced cloud synthesis failure, and do not establish that all observed instability is resolved.

## Validation

- Shared realtime voice, platform stream, Personal request and task result regressions: 243 passed, one live test skipped. The first concurrent run encountered a transient local WebSocket handshake 404; the serial rerun passed.
- Additional asynchronous notification lease regression: passed, including a simulated wait beyond the original lease and a concurrent drain attempt.
- Harmony voice call, playback, transport and recovery tests: 39 passed.
- Root typecheck passed on the final rerun. An earlier run was blocked by two errors in the concurrently edited MCP worktree file `src/agent/mcp/connection-setup.ts`; those errors were resolved outside this voice change.
- `git diff --check` passed. No Harmony source was modified, and no new HAP was installed.

The cloud provider failure prevents successful live end-to-end speech acceptance. Once the platform realtime TTS route is repaired, verify ordinary questions and background task replies on the connected device, including interruption, mute/resume and reconnect. Physical audio and long-call stability remain unverified for this change.

## Platform repair and deployment (09:29 update)

The user's subsequent Web call reproduced close 1011 and a setup HTTP 502 with diagnostic ID `445fb14a-2640-47a0-b83a-809674253f9d`. The production diagnostic confirms authorization and quota succeeded and the failure occurred at upstream setup.

A direct supplier probe of the selected `qwen3-tts-instruct-flash-realtime` route returned close 1007, `Model not exist.` The route was untested but the relay selected it ahead of existing validated routes. A separate Qwen Flash realtime probe reached configuration but failed synthesis with a supplier capacity error. The existing validated StepFun `stepaudio-2.5-tts` route returned 108,480 bytes of PCM and completed successfully.

The platform fix was pushed to `xopcai/xopc-platform` main:

- `831d3e4`: require validated realtime routes; record the supplier close code and classify unavailable models.
- `3fd7082`: fail over up to three validated routes during connection setup, with five seconds per attempt, before accepting any client text or audio. Reuse one credit reservation and preserve cancellation; do not replay submitted synthesis input.

Both changes are deployed to the production model gateway. Targeted source replacements preserved the server's existing billing changes; only the model gateway was rebuilt and restarted. Backups of the previous source and gateway bundles are under `data/backups/realtime-tts-831d3e4` and `data/backups/realtime-tts-3fd7082` on the server. No route publication, model pricing or database schema was changed for this repair.

Validation after the final deployment:

- Public health endpoint returned `{ "ok": true }`.
- Five consecutive authenticated requests to the same public `tts` model, service version 5, all completed: 98,880 / 83,520 / 127,680 / 96,960 / 120,000 PCM bytes; durations 3,679 / 3,046 / 2,911 / 3,410 / 2,931 ms.
- Clean platform model-gateway suite: 253 passed, one skipped; typecheck passed.
- Targeted voice regression on the primary platform workspace, including its existing billing modifications: 38 passed.

This supersedes the earlier upstream-blocked status: live cloud PCM output is restored. Browser/phone acoustic playback and sustained-call acceptance are still distinct from these server-side probes.

## STT regression repair and complete E2E (09:43 update)

The user's `9d6c48c9-eb4f-494d-8a0d-5e50d4e67a9d` diagnostic was a routing-stage STT 503. The previous admission change required a passed provider-model validation for STT as well as TTS, but none of the published realtime STT routes was validated. The TTS-only verification had missed this regression.

The STT validator also used silence but required a transcription result. A legitimate silence-only session may complete without any transcript. Commit `4db1222`, pushed to platform main and deployed, accepts STT negotiation plus normal finalization for that silent protocol probe. Premature close still fails, and TTS still requires audio output. This validates the STT protocol; it is not by itself a recognition accuracy test.

Before updating production validation state, a direct supplier test streamed a real speech fixture through `qwen-audio-3.1-asr-flash-streaming`. It recognized `请只回答你好。` and finalized normally. Only that tested model's validation status was changed from untested to passed; its original row and probe result are backed up at `data/backups/stt-validation-20261012.json`. Route publication, credentials and prices were retained. Source/bundle backups for the probe fix are at `data/backups/stt-probe-4db1222`.

Complete acceptance after deployment used the existing personal Agent (`personal-f815d4b478fa`) in disposable temporary conversations:

- `scripts/probe-gateway-voice-e2e.ts`: three consecutive real speech inputs, three final transcripts, three Agent replies (`你好。`) and three completed non-silent PCM responses, totaling 198,720 audio bytes. Playback ACKs are simulated by the protocol harness. The disposable conversation was deleted afterward.
- `scripts/voice-browser-live.mjs`: production React voice components in headless Chrome, a speech WAV supplied to the browser microphone, real worklet capture/uplink, real local Gateway and cloud STT/Agent/TTS, and the production WebAudio player. One final transcript and an audio reply completed; 857 uplink frames and 85,739 downlink wire bytes were observed. WebAudio scheduled 83 buffers in a running context, including 54 with nonzero samples. No cloud responses or audio were mocked. The test hung up and deleted its disposable conversation.
- Platform full suite: 256 passed, one skipped; typecheck passed. Primary workspace STT/lifecycle regressions, including existing billing changes: 22 passed. Root typecheck and diff checks passed; public platform health returned `{ "ok": true }`.

The browser test initially failed because its Vite compiler resolved from the repository root instead of the web package. The harness now runs from `web/`. The first multi-turn protocol attempt also caught the harness reusing a sequence counter across new utterance IDs; per-utterance sequencing was corrected before the passing runs.

These results establish real recognition, Agent execution, synthesis and browser playback scheduling. They do not certify physical speaker audibility or a new Harmony-device acceptance run.
