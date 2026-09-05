# Persistent voice technical design

Updated: 2026-09-05. See [product contract](./realtime-voice-prd.md) and [protocol v2](./realtime-voice-websocket-protocol.md).

## Ownership

`VoiceCallProvider` lives above route content in `AppShell`. Its target is an existing Chat `sessionKey`; its state owns the shared realtime hook and expanded/minimized surface. Composer dictation uses the same capture implementation independently. A module-level capture owner rejects competing microphone requests. The old composer-owned conversation hook and controls were removed rather than wrapped.

The transport's `sessionId` is a call connection identifier. It must not be used to create another Chat Session. The existing Chat metadata `sessionId` is frozen when a call ticket is issued and is checked when reading context or appending native transcript entries. Reset and deletion retain their existing reservation checks. Project preparation may create its initial Chat once before opening a call.

## Startup and cleanup

1. Resume the playback AudioContext from the user action.
2. `POST /api/voice/realtime/preflight` validates configuration, routes and Chat availability without opening an upstream socket or reserving the Chat.
3. Acquire microphone permission and stream. Issue the connection ticket through `/sessions`; the server reserves the Chat under its existing model-config lock.
4. Authenticate the v2 socket. For native voice, load and freeze the current canonical context before opening the upstream connection.
5. Start PCM capture. Attempt tokens and an AbortController fence permission, connection and recorder completions after cancellation. Never flush a late recorder's pending samples.
6. On shutdown, abort the engine, await Agent cleanup and pending transcript/interruption writes, then release the reservation. Unexpected renderer disconnect uses the same cleanup path.

Microphone mute disables input tracks, gates capture callbacks and discards partial encoder frames. A bounded synthetic silence tail closes an in-flight server-VAD utterance; no muted microphone samples are uploaded. Playback remains enabled. Audio output acknowledgements and response IDs retain the existing interruption/backpressure protocol.

Manual response cancellation invalidates queued Agent voice turns and unfinished STT utterances observed before the stop. It resets pending-turn capacity while keeping the existing cleanup chain intact. Fresh speech after the stop can start a new turn; stale recognition results cannot advance the queue. Automatic barge-in retains the new spoken turn.

## Shared conversation context

Native final speech remains a `voice_omni_transcript` custom transcript entry with its actual speaker role and call/item IDs. `voiceTranscriptMessage` projects it into an ordinary user or assistant message. Both `buildSessionContextForLlm` and `storedRowsToFileEntries` use that projection, so direct context reads and the real embedded Agent hydration path agree. There is no separate memory database or turn-end transcript rewrite.

An interrupted assistant row remains visible for audit, but its generated words are replaced by a clear interruption marker in model input. Invalid speaker roles are rejected. The synthetic assistant projection carries zero usage because it is historical context, not a new billed Agent request.

Native startup instructions include the selected Agent's configured name/custom instructions, concise spoken behavior, the no-tools boundary and JSON-quoted history. Hidden reasoning and tool results are excluded. Recent user/assistant text gets most of the available space; earlier turns get explicitly incomplete excerpts. The entire instructions value stays within the existing platform relay's 8,000-character envelope. Excessive custom instructions fail with guidance to shorten them instead of silently discarding conversation history.

This design uses `session.instructions` in the initial `session.update`. It does not inject unsupported conversation items, repeatedly update a locked relay session, or invent a provider resume token. Alibaba's [client-event reference](https://www.alibabacloud.com/help/en/model-studio/client-events) documents initial instructions; its current conversation-item support is insufficient for arbitrary historical user/assistant item injection. The bounded quoted context is an application-level continuation, not transport replay.

Native voice does not hydrate the full Agent tool/system prompt or every profile Markdown file. It receives configured identity/instructions and visible conversation history. Exact heard-offset truncation inside an already-open native provider session is not certified; the interruption marker applies to subsequent restored context.

## Transcript metadata

Calls persist conversation content, with no separate lifecycle journal or history endpoint. Previously stored `voice_call` metadata remains excluded from Chat display, canonical LLM projection and embedded hydration.

## Service setup

`configureRealtimeService` is shared by Settings and the call's first-use form. It enables input, realtime output and native voice for the selected service. It preserves ordinary message-readout settings and existing credentials. Re-enabling the same service preserves advanced overrides; changing services clears incompatible native overrides. Native direct credentials resolve from explicit native override, then shared Alibaba input key, then the existing DashScope credential service. Secrets remain on the gateway; ticket responses expose only safe route metadata.

No automatic engine fallback, old hook alias, second transcript writer, new memory hierarchy or legacy protocol adapter is introduced.

## Verification limits

See [delivery review](./persistent-voice-delivery.md) for executed checks. Synthetic browser audio and local mocked WebSockets cannot establish real microphone permissions in packaged Electron, echo cancellation, perceived latency, paid-provider availability or platform billing correctness. This change does not modify or deploy xopc-platform.
