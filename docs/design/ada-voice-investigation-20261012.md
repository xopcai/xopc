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
