# Persistent voice technical design

Updated: 2026-09-11. See [product contract](./realtime-voice-prd.md) and [protocol v3](./realtime-voice-websocket-protocol.md).

## Ownership

`VoiceCallProvider` lives above route content in `AppShell`. Its target is an existing Chat `sessionKey`; its state owns the shared realtime hook and expanded/minimized surface. Composer dictation uses the same capture implementation independently. A module-level capture owner rejects competing microphone requests. The old composer-owned conversation hook and controls were removed rather than wrapped.

The transport's `sessionId` is a call connection identifier. It must not be used to create another Chat Session. The existing Chat metadata `sessionId` is frozen when a call ticket is issued and is checked when reading context or appending native transcript entries. Reset and deletion retain their existing reservation checks. Project preparation may create its initial Chat once before opening a call.

## Startup and cleanup

1. Resume the playback AudioContext from the user action.
2. `POST /api/voice/realtime/preflight` validates configuration, routes and Chat availability without opening an upstream socket or reserving the Chat.
3. Acquire microphone permission and stream. Issue the connection ticket through `/sessions`; the server reserves the Chat under its existing model-config lock.
4. Negotiate protocol v3 and authenticate the socket. For natural voice, load and freeze the current canonical context before opening the upstream connection.
5. Start PCM capture. Attempt tokens and an AbortController fence permission, connection and recorder completions after cancellation. Never flush a late recorder's pending samples.
6. On shutdown, abort the engine, await Agent cleanup and pending transcript/interruption writes, then release the reservation. Unexpected renderer disconnect uses the same cleanup path.

Microphone mute disables input tracks, gates capture callbacks and discards partial encoder frames. A bounded synthetic silence tail closes an in-flight server-VAD utterance; no muted microphone samples are uploaded. Playback remains enabled. Audio output acknowledgements and response IDs retain the existing interruption/backpressure protocol.

Stopping playback only discards queued audio for that response; it does not cancel durable Agent work. Explicit task cancellation is a separate control. Fresh speech can start a new turn while stale recognition results are fenced by the connection epoch and utterance sequence.

## Conversation endpoints and continuation

Provider `speech_stopped` and final transcription events mark an ASR segment, not necessarily a completed user turn. `TurnPolicy` waits for every started segment to finish transcription, joins segments in speech-start order, invalidates pending semantic decisions whenever speech resumes, and applies a bounded fallback when the semantic decision times out. Dictation retains its explicit commit behavior.

The default provider silence window is 1,200 ms; the pacing choices are 800/1,200/2,000 ms. Existing explicit values remain explicit values. Conversation completion also has a 1,200 ms minimum silence target and at least a 350 ms transcription-settling window. Conservative Chinese/English continuation hints (for example, “帮我查一下”, “因为”, “could you”, and ellipses) extend the post-provider-endpoint hold to 1,800 ms. This is a bounded lexical heuristic, **not** model-level semantic VAD. No silence timeout releases a turn while a started segment is still being spoken or awaits its final transcript.

- Assistant mode submits one durable Agent task with the combined text after the endpoint settles. Disconnecting or stopping playback only detaches voice output; only explicit task cancellation aborts the Agent run.
- Natural mode retains the certified Qwen3 server-VAD protocol. A response may be generated upstream, but its text, audio and completion are withheld until the turn settles. Continuation discards an unpublished reply without showing it or writing an assistant transcript. User segments retain their provider item IDs and remain in upstream conversation context. Existing audio queue limits still apply while output is withheld.
- Assistant-mode barge-in requires a non-empty final transcript before stopping audible playback. Bare server-VAD events and partial ASR hypotheses are insufficient because ambient noise and imperfectly cancelled speaker output can trigger them and partial text may later disappear. This is an evidence gate, not semantic noise/backchannel classification.
- Mute, manual stop, congestion reset and close invalidate pending endpoints and release discarded output waiters. A native transcription failure discards the uncertain input and reports a recoverable error rather than leaving the reply waiting indefinitely.

Do not switch the current certified Qwen3 model to Qwen3.5-only semantic VAD or depend on `create_response: false` without separately certifying the model and relay. The configured hosted route acknowledged the existing automatic-response configuration during testing, but did not acknowledge the manual-response configuration. No protocol fallback or model migration is included here. Unheard generated native content may still exist inside the current provider session; deleting/truncating that provider-side history is not certified.

## Shared conversation context

Natural-mode final speech remains a `voice_omni_transcript` custom transcript entry with its actual speaker role and call/item IDs. `voiceTranscriptMessage` projects it into an ordinary user or assistant message. Both `buildSessionContextForLlm` and `storedRowsToFileEntries` use that projection, so direct context reads and the real embedded Agent hydration path agree. There is no separate memory database or turn-end transcript rewrite.

An interrupted assistant row remains visible for audit, but its generated words are replaced by a clear interruption marker in model input. Invalid speaker roles are rejected. The synthetic assistant projection carries zero usage because it is historical context, not a new billed Agent request.

Natural-mode startup instructions include the selected Agent's configured name/custom instructions, concise spoken behavior, the no-tools boundary and JSON-quoted history. Hidden reasoning and tool results are excluded. Recent user/assistant text gets most of the available space; earlier turns get explicitly incomplete excerpts. The entire instructions value stays within the existing platform relay's 8,000-character envelope. Excessive custom instructions fail with guidance to shorten them instead of silently discarding conversation history.

This design uses `session.instructions` in the initial `session.update`. It does not inject unsupported conversation items, repeatedly update a locked relay session, or invent a provider resume token. Alibaba's [client-event reference](https://www.alibabacloud.com/help/en/model-studio/client-events) documents initial instructions; its current conversation-item support is insufficient for arbitrary historical user/assistant item injection. The bounded quoted context is an application-level continuation, not transport replay.

Natural voice does not hydrate the full Agent tool/system prompt or every profile Markdown file. It receives configured identity/instructions and visible conversation history. Exact heard-offset truncation inside an already-open provider session is not certified; the interruption marker applies to subsequent restored context.

## Transcript metadata

Calls persist conversation content, with no separate lifecycle journal or history endpoint. Previously stored `voice_call` metadata remains excluded from Chat display, canonical LLM projection and embedded hydration.

## Service setup

`configureRealtimeService` is shared by Settings and the call's first-use form. It enables input, realtime output and native voice for the selected service. It preserves ordinary message-readout settings and existing credentials. Re-enabling the same service preserves advanced overrides; changing services clears incompatible native overrides. Native direct credentials resolve from explicit native override, then shared Alibaba input key, then the existing DashScope credential service. Secrets remain on the gateway; ticket responses expose only safe route metadata.

No automatic engine fallback, old hook alias, second transcript writer, new memory hierarchy or legacy protocol adapter is introduced.

## Verification limits

See [delivery review](./persistent-voice-delivery.md) for executed checks. Synthetic browser audio and local mocked WebSockets cannot establish real microphone permissions in packaged Electron, echo cancellation, perceived latency, paid-provider availability or platform billing correctness. This change does not modify or deploy xopc-platform.

On 2026-09-07 the updated native engine was also exercised against the configured XOPC hosted Qwen3 route using 16 kHz mono synthetic PCM, the existing 700 ms setting, and a 1.1-second inserted pause. “Could you” followed by “tell me what two plus two is?” and “帮我查一下” followed by “明天下午去上海的高铁” each produced two final user segments but only one published assistant reply, after continuation finished. Neither test published early text/audio or reported a session error. The harness received and acknowledged 526,080 / 1,032,960 PCM output bytes respectively. Acknowledgements here are synthetic, not evidence of phone speaker playback. These checks did not deploy the gateway at `xl.xopc.ai`, use a physical microphone, or repeat the iOS/Android simulator suite.
