# Realtime voice WebSocket protocol v2

Updated: 2026-09-05. Source of truth: `packages/realtime-protocol/src/voice.ts` and `voice-audio.ts`.

## Transport

- Create via `POST /api/voice/realtime/sessions`, authenticated with the existing gateway token.
- Connect to `/api/voice/realtime/v2/ws`.
- One socket owns one call connection (`sessionId` on the wire). The durable Chat is identified by `sessionKey`; reconnecting creates a new call ID in the same Chat. There is no transport replay/resume or engine switching inside an open connection.
- Only v2 is accepted. Update renderer and gateway together; no v1 alias/adapter exists.
- JSON control frames: at most 16 KiB. Binary frames: at most 64 KiB.
- Ticket lifetime: 60 seconds. First-frame authentication: 10 seconds. Ping interval: 15 seconds.

## REST lifecycle

- `POST /api/voice/realtime/preflight` accepts the creation body and returns `{ok:true}` after the same capability and session checks. It creates neither a ticket nor a reservation, and opens no provider socket.
- `POST /api/voice/realtime/sessions` creates a one-use ticket and reserves the Chat until expiry or call cleanup. Start capture only after capability preflight; upload only after `session.ready`.
- Call lifecycle metadata is stored in the containing Chat transcript and excluded from model input. Native speech is restored with actual user/assistant roles on reconnect. Pending transcript writes finish before the reservation is released.

## Creation

```json
{"purpose":"conversation","engine":"omni","sessionKey":"agent:main:webchat:default:direct:voice"}
```

`purpose` is `dictation | conversation`. Conversation requires `sessionKey`; optional `engine: agent | omni` overrides the saved `voice.realtime.defaultEngine` (default `agent`). Dictation forbids engine. Optional `language: zh | en` is an STT hint; native language follows the audio/model instructions. Unknown fields, including credentials, model, voice, instructions and URLs, are rejected.

Response: `{ok:true,payload:{sessionId,ticket,ticketExpiresAt,websocketPath,protocolVersion,purpose,inputMode,bargeIn,inputFormat,limits,route}}`.

- `protocolVersion`: 2; `inputMode`: `server_vad`.
- `inputFormat`: `{encoding:"pcm_s16le",sampleRate:16000,channels:1}`.
- `limits`: `{maxBinaryFrameBytes:65536,maxSessionMs,idleTimeoutMs}`.
- Route is exactly one of:
  - `{engine:"dictation",stt:ProviderRoute}`
  - `{engine:"agent",stt:ProviderRoute,tts:ProviderRoute}`
  - `{engine:"omni",omni:ProviderRoute}`
- `ProviderRoute = {provider:string,model:string,managed:boolean}`. No key or URL is returned.

Errors: 400 invalid request; 401 unauthenticated; 404 missing Chat; 409 active/queued/reserved Chat; 429 limits; 503 disabled or unavailable provider. No implicit engine fallback occurs.

## JSON envelopes

```ts
type ClientEnvelope<T, P> = {
  protocolVersion: 2;
  messageId: string; // UUID
  type: T;
  sentAt: number; // Unix milliseconds
  payload: P;
};
type ServerEnvelope<T, P> = {
  protocolVersion: 2;
  eventId: string; // UUID
  seq: number; // positive, connection-local JSON event sequence
  type: T;
  sentAt: number;
  sessionId: string; // UUID
  payload: P;
};
```

Objects are strict. Client clock skew is bounded to 60 seconds. A bounded window of 256 client message IDs suppresses retransmitted controls.

First control: `session.start` with `{sessionId,ticket}`. Invalid, used, expired or mismatched tickets close with 4401. Do not upload audio until `session.ready`, whose payload is `{purpose,inputMode,inputFormat,route,heartbeatIntervalMs:15000}`.

## Audio frames

Client → gateway remains raw mono signed PCM16 little-endian, 16 kHz, nonempty/even byte length, max 65536 bytes. Target capture frame is 40 ms; dictation flush can be shorter.

Gateway → client uses this binary envelope. Integer header fields are unsigned big-endian; PCM remains little-endian.

| Offset | Bytes | Meaning |
|---:|---:|---|
| 0 | 4 | Magic 0x584f5032 (`XOP2`) |
| 4 | 4 | Connection-local audio sequence, starts at 1 |
| 8 | 4 | UTF-8 response-ID length, 1..160 bytes |
| 12 | ID length | UTF-8 response ID |
| 12 + ID length | Remainder | Nonempty even-length PCM16, mono 24 kHz |

Total frame size ≤65536 bytes; current server PCM chunks ≤24000 bytes. Audio sequence is independent of JSON event sequence and does not reset per response.

Reject malformed frames or discontinuous sequences. Discard a well-formed frame whose response ID is no longer active. Do not infer audio ownership from whichever response happens to be displayed.

## Client controls

| Type | Payload | Behavior |
|---|---|---|
| `input.commit` | `{}` | Dictation only; conversation returns recoverable INVALID_STATE |
| `response.cancel` | `{responseId}` | Cancel active generation/playback; stale ID returns NO_ACTIVE_RESPONSE |
| `response.audio.played` | `{responseId,playedBytes}` | Cumulative PCM bytes actually played for this response |
| `input.mute` | `{muted:boolean}` | Conversation only; discard pending input without cancelling playback |
| `session.metric` | `{responseId,metric,durationMs}` | Bounded client timings: speech_end_to_audio_received or local_stop; diagnostic only |
| `session.ping` | `{}` | Server replies session.pong |
| `session.stop` | `{reason}` | reason = user_finished, surface_closed or replaced |

Playback acknowledgement is nonnegative/even. It excludes header and ID bytes. Duplicate/older counts are ignored; counts beyond sent PCM close with 4400. Never acknowledge queued, discarded or cancelled audio. Inactive response acknowledgements are ignored.

## Server events

| Type | Payload |
|---|---|
| `input.speech_started`, `input.speech_stopped` | `{utteranceId}` |
| `input.transcript.delta`, `input.transcript.final` | `{utteranceId,revision,text,language?}` |
| `response.created` | `{responseId}` |
| `response.activity` | `{responseId,toolCallId,toolName,status}`; running/completed/failed |
| `response.clarification` | `{responseId,requestId,question,choices?}`; existing clarify HTTP endpoint handles explicit answers |
| `response.text.delta` | `{responseId,delta}` |
| `response.text.done` | `{responseId}` |
| `response.audio.started` | `{responseId,format:{encoding:"pcm_s16le",sampleRate:24000,channels:1}}` |
| `response.audio.done` | `{responseId}` |
| `response.done` | `{responseId,audio,finishReason}` |
| `response.cancelled` | `{responseId,reason}` |
| `session.pong` | `{}` |
| `session.error` | `{code,message,recoverable}` |
| `session.closed` | `{reason}` |

Transcript text is a complete revised hypothesis, not an append-only suffix. Revisions are positive and increasing per utterance. Native mode currently emits final input transcription, not speculative partials.

Response text deltas are append-only, tagged by response ID. Ignore stale IDs. `finishReason` is completed, text_only or audio_partial; partial/text-only recovery applies to the Agent/TTS pipeline. Native provider failure ends the call.

Cancellation reason is barge_in, client_cancelled or session_closed. Clear playback immediately on cancellation; late old-response data cannot reopen playback.

## Ordering and completion

1. session.ready precedes browser audio.
2. response.created precedes output for that response.
3. response.audio.started precedes its first binary audio frame.
4. Text and audio can interleave.
5. In Agent mode, input.transcript.final triggers the Agent turn.
6. In native mode, the provider controls turns; input transcription may arrive asynchronously relative to response creation.
7. Provider generation completion is internal. Native response.done waits for queued audio and playback acknowledgement. Do not equate generated text with audio actually heard.
8. A response remains interruptible while local audio is queued.
9. Terminal close/error releases upload, playback, upstream and timers.

Gateway playback window: 96000 unacknowledged PCM bytes (two seconds). Native upstream generation has a separate bounded queue of 2,880,000 PCM bytes (one minute), since generation can run ahead of playback. Native queue overflow or a 15-second playback acknowledgement stall cancels that reply and emits recoverable `session.error` with `RESPONSE_FAILED`; the call stays connected for the next turn. This does not silently discard audio and mark the reply complete. Fatal service/protocol errors include a specific code and diagnostic reference.

Native microphone upload allows one WebSocket write at a time, with at most 65,536 pending PCM bytes (about two seconds, including the in-flight write). Brief stalls preserve queued PCM order. Overflow discards pending input, clears the provider input buffer, fences stale transcripts/responses and emits recoverable `INPUT_DROPPED`; the client warns the user to repeat that input. Audio resumes after the clear acknowledgement. Mute, manual interruption and close discard queued input too. A write stalled for ten seconds ends the call with `OMNI_UPLOAD_TIMEOUT`. The clear acknowledgement deadline is five seconds, extended to fifteen when an upload is still in flight. Diagnostic logs include provider, endpoint hostname and pending bytes, without credentials or audio.

## Close codes and security

1000 = normal; 1001 = gateway stopping; 4400 = invalid frame/clock; 4401 = auth/readiness; 4429 = concurrency.

Tickets appear only in the first control frame, not URLs. Provider credentials stay in the local gateway or platform. Logs exclude tickets, keys, raw audio and full transcripts. A new connection requires a new ticket. It restores application-owned Chat context through bounded initial instructions, rather than resuming a provider-owned socket.

## Platform boundary

The platform socket is a separate server-to-server Qwen protocol relay:
`/v1/audio/conversations/realtime?model=qwen3-omni-flash-realtime`.

It accepts bearer authorization with models:invoke, or origin-bound administrator debug subprotocol tickets. It allows a single certified session.update, base64 PCM input_audio_buffer.append, input_audio_buffer.clear and response.cancel. The input-clear event requires the matching platform relay update. It rejects browser-v2 envelopes, tool registration, manual generation and arbitrary item mutation. This boundary reuses the native engine's Qwen adapter; it is not another browser protocol.

## Settings diagnostics (HTTP)

These authenticated endpoints test Agent STT/TTS, not native Omni:

- GET /api/voice/realtime/status returns {ok:true,payload:{enabled,defaultEngine,stt,tts,omni}}. Missing routes are null; routes contain provider, model, managed and optional TTS voice. This is configuration preflight, not live verification.
- POST /api/voice/realtime/preview returns {ok:true,payload:{audio,sampleRate:24000}} with base64 mono PCM16 from a fixed localized sample. It is rate limited, capped at 960,000 bytes and 20 seconds, accepts no arbitrary text or credentials, and returns 503 for missing output or 502 for synthesis/format/size failure.
- GET /api/voice/tts-voices?purpose=realtime&provider=…&model=… resolves Agent conversation output credentials independently of message readout.

Input diagnostics use the normal v2 dictation session without a Chat or Agent invocation.

Input cancellation has an explicit generation boundary. Agent cancellation/muting replaces only the STT stream, fences old callbacks and drops old queued turns; resumed audio has a bounded two-second reset buffer. Native cancellation/muting clears upstream input and rejects late input/replies until clear acknowledgement and fresh speech. A missing native clear acknowledgement ends the call with a specific diagnostic after five seconds. Neither path injects synthetic silence or replays discarded audio.

Client timing samples are self-reported, deduplicated and capped at 512 per call. They measure audio receipt/local playback cancellation, not physical speaker output or acoustic end-of-speech latency.
