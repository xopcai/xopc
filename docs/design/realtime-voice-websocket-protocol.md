# Realtime voice WebSocket protocol

> Status: Implemented
>
> Version: `1`
>
> Scope: Browser/Electron renderer to local xopc Gateway

## 1. Transport

- HTTP creates a voice session and one-use ticket.
- WebSocket text frames carry strict JSON control/events.
- WebSocket binary frames carry raw PCM.
- One socket carries one voice session and one input stream.
- Version 1 has no resume, event aliases, or binary envelope.
- Provider protocols are not exposed through this contract.

Constants:

```text
WebSocket path        /api/voice/realtime/v1/ws
Protocol version      1
Ticket lifetime       60 seconds
First-frame timeout   10 seconds
Control-frame limit   16 KiB
Binary-frame limit    64 KiB
Heartbeat interval    15 seconds
```

## 2. Create a session

```http
POST /api/voice/realtime/sessions
Authorization: Bearer <gateway token>
Content-Type: application/json
```

Request:

```json
{
  "purpose": "conversation",
  "sessionKey": "agent:main:webchat:default:direct:voice",
  "language": "zh"
}
```

Schema:

| Field | Type | Required |
|---|---|---:|
| `purpose` | `dictation \| conversation` | yes |
| `sessionKey` | string, 1..512 | conversation only |
| `language` | `zh \| en` | no |

Provider IDs, models, voices, base URLs, keys, and instructions are rejected as unknown fields.

Response:

```json
{
  "ok": true,
  "payload": {
    "sessionId": "01993e93-7f76-7b4c-8ad2-f72970b018e1",
    "ticket": "<opaque one-use value>",
    "ticketExpiresAt": "2026-09-04T10:01:00.000Z",
    "websocketPath": "/api/voice/realtime/v1/ws",
    "protocolVersion": 1,
    "purpose": "conversation",
    "inputMode": "server_vad",
    "bargeIn": true,
    "inputFormat": {
      "encoding": "pcm_s16le",
      "sampleRate": 16000,
      "channels": 1
    },
    "limits": {
      "maxBinaryFrameBytes": 65536,
      "maxSessionMs": 3600000,
      "idleTimeoutMs": 60000
    },
    "route": {
      "stt": {
        "provider": "alibaba",
        "model": "qwen-audio-3.0-asr-flash-streaming",
        "managed": false
      },
      "tts": {
        "provider": "alibaba",
        "model": "qwen3-tts-flash-realtime",
        "managed": false
      }
    }
  }
}
```

`route.tts` exists only for conversation. Route metadata is display-safe and never includes credentials or upstream URLs. `bargeIn` is the frozen session setting; the browser uses it to enable local speech ducking. Playback is cleared on authoritative `response.cancelled`, not on every `input.speech_started`.

Creation errors use the normal JSON error envelope:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `INVALID_REQUEST` | Strict request validation failed |
| 401 | gateway auth code | Gateway authentication failed |
| 404 | `SESSION_NOT_FOUND` | Conversation Chat does not exist |
| 409 | `SESSION_CONFLICT` | Chat is running or already has a voice reservation |
| 429 | `SESSION_LIMIT` | Outstanding ticket/session limit |
| 503 | `VOICE_DISABLED` | Realtime voice is disabled |
| 503 | `PROVIDER_UNAVAILABLE` | Streaming STT/TTS route is unavailable |

## 3. Envelopes

Client JSON:

```ts
interface VoiceClientMessage<T extends string, P> {
  protocolVersion: 1;
  messageId: string; // UUID
  type: T;
  sentAt: number;    // Unix ms
  payload: P;
}
```

Server JSON:

```ts
interface VoiceServerEvent<T extends string, P> {
  protocolVersion: 1;
  eventId: string;   // UUID
  seq: number;       // increasing, starts at 1
  type: T;
  sentAt: number;    // Unix ms
  sessionId: string; // UUID
  payload: P;
}
```

All objects are strict. Unknown fields fail validation. Client timestamps more than 60 seconds from the gateway close the socket. The runtime remembers up to 256 message IDs and ignores duplicates in that bounded window.

## 4. Authentication

The first frame must arrive within 10 seconds and must be:

```json
{
  "protocolVersion": 1,
  "messageId": "54ac5638-ef87-4d70-bd49-3352c9fc3782",
  "type": "session.start",
  "sentAt": 1788496800000,
  "payload": {
    "sessionId": "01993e93-7f76-7b4c-8ad2-f72970b018e1",
    "ticket": "<opaque one-use value>"
  }
}
```

The server atomically consumes the ticket. Unknown, expired, used, or mismatched tickets close with `4401` without disclosing the failed check.

After upstream STT is ready:

```json
{
  "protocolVersion": 1,
  "eventId": "204ee2d5-2725-471a-a659-6784de7d08b8",
  "seq": 1,
  "type": "session.ready",
  "sentAt": 1788496800150,
  "sessionId": "01993e93-7f76-7b4c-8ad2-f72970b018e1",
  "payload": {
    "purpose": "conversation",
    "inputMode": "server_vad",
    "inputFormat": {
      "encoding": "pcm_s16le",
      "sampleRate": 16000,
      "channels": 1
    },
    "route": {
      "stt": { "provider": "alibaba", "model": "qwen-audio-3.0-asr-flash-streaming", "managed": false },
      "tts": { "provider": "alibaba", "model": "qwen3-tts-flash-realtime", "managed": false }
    },
    "heartbeatIntervalMs": 15000
  }
}
```

The client must not send binary audio before `session.ready`.

## 5. Audio frames

### 5.1 Client to server

Every binary frame after readiness is:

```text
signed 16-bit little-endian PCM
mono
16000 Hz
non-empty, even byte length
maximum 65536 bytes
```

The normal target is 40 ms (1,280 bytes). The final dictation flush may be shorter.

### 5.2 Server to client

After `response.audio.started`, binary frames are mono PCM16 at 24 kHz for the active response. Version 1 allows one active response, so WebSocket order associates binary frames without an extra response ID.

The gateway splits output into frames of at most 24,000 bytes (500 ms) and allows at most 96,000 unacknowledged bytes (two seconds of audio, excluding the initial 80 ms scheduling allowance). The browser acknowledges playback through `response.audio.played`; fast synthesis waits for capacity rather than cancelling the response. Cancellation or disconnect immediately releases a blocked sender. A 15-second lack of playback progress fails the response.

No binary output may follow `response.audio.done`, `response.cancelled`, or a later response creation for the old response.

## 6. Client controls

### 6.1 `input.commit`

Ends and commits dictation input:

```json
{
  "protocolVersion": 1,
  "messageId": "29cfb4db-1aee-4556-820a-798039512261",
  "type": "input.commit",
  "sentAt": 1788496805000,
  "payload": {}
}
```

Conversation uses server VAD. Sending `input.commit` in conversation produces recoverable `INVALID_STATE`.

### 6.2 `response.cancel`

```json
{
  "protocolVersion": 1,
  "messageId": "fc4e7189-fe65-47a0-bd14-8ed2470d9209",
  "type": "response.cancel",
  "sentAt": 1788496807000,
  "payload": { "responseId": "resp_01993e96" }
}
```

The ID must match the active response. Otherwise the server returns recoverable `NO_ACTIVE_RESPONSE`.

### 6.3 `session.stop`

```json
{
  "protocolVersion": 1,
  "messageId": "15ee4b96-b6ea-4792-b5d2-934fa58f09d8",
  "type": "session.stop",
  "sentAt": 1788496810000,
  "payload": { "reason": "user_finished" }
}
```

Valid reasons: `user_finished`, `surface_closed`, `replaced`.

### 6.4 `session.ping`

Payload is `{}`. The server returns `session.pong` with payload `{}`. The browser sends it every 15 seconds and stops the timer when the socket closes.

### 6.5 `response.audio.played`

Payload: `{ "responseId": "resp_01993e96", "playedBytes": 24000 }`.

`playedBytes` is the cumulative, nonnegative, even PCM byte count actually played for this response. Send it when a scheduled audio source ends, never on enqueue or cancellation. Duplicate/older counts are ignored; a count exceeding sent audio closes the socket with `4400`. Acknowledgements for inactive response IDs are ignored. Normal response completion waits for playback acknowledgements so the next conversation turn does not overlap queued audio.

## 7. Input events

```ts
type InputEvent =
  | { type: 'input.speech_started'; payload: { utteranceId: string } }
  | { type: 'input.speech_stopped'; payload: { utteranceId: string } }
  | {
      type: 'input.transcript.delta' | 'input.transcript.final';
      payload: {
        utteranceId: string;
        revision: number; // positive, increasing per utterance
        text: string;     // maximum 32 KiB
        language?: 'zh' | 'en'; // final only in practice
      };
    };
```

`delta.text` is the provider's complete current hypothesis, not an append-only suffix. The client replaces the prior hypothesis and ignores stale revisions. Partial text is never submitted to the Agent or persisted.

In conversation, a non-empty `input.transcript.final` starts exactly one normal Agent turn.

## 8. Response events

### 8.1 Creation and text

```ts
{ type: 'response.created'; payload: { responseId: string } }
{ type: 'response.text.delta'; payload: { responseId: string; delta: string } }
{ type: 'response.text.done'; payload: { responseId: string } }
```

Text deltas are append-only and individually limited to 32 KiB. The durable Chat timeline remains authoritative.

### 8.2 Audio

```ts
{
  type: 'response.audio.started';
  payload: {
    responseId: string;
    format: { encoding: 'pcm_s16le'; sampleRate: 24000; channels: 1 };
  };
}
// zero or more binary PCM frames
{ type: 'response.audio.done'; payload: { responseId: string } }
```

### 8.3 Completion

```ts
{
  type: 'response.done';
  payload: {
    responseId: string;
    finishReason: 'completed' | 'text_only' | 'audio_partial';
    audio: boolean;
  };
}
```

- `completed`: normal response; `audio` indicates whether audio was produced.
- `text_only`: no audio was produced, including TTS failure before first audio.
- `audio_partial`: some audio was sent before response synthesis failed.

Completion events do not replace the browser's playback state. If local sources remain scheduled when a completion event arrives (including error completion), keep the speaking state and manual interruption available until they drain. Manual interruption clears local audio immediately, even if the server has already completed the response.

### 8.4 Cancellation

```ts
{
  type: 'response.cancelled';
  payload: {
    responseId: string;
    reason: 'barge_in' | 'client_cancelled' | 'session_closed';
  };
}
```

After cancellation, the server fences late Agent/TTS data and sends no later text or audio for that response. The client clears queued playback.

## 9. Session events

```ts
{ type: 'session.pong'; payload: {} }
{
  type: 'session.error';
  payload: { code: string; message: string; recoverable: boolean };
}
{ type: 'session.closed'; payload: { reason: string } }
```

Implemented error codes include:

| Code | Recoverable | Meaning |
|---|---:|---|
| `EMPTY_UTTERANCE` | yes | Dictation commit produced no final text |
| `NO_ACTIVE_RESPONSE` | yes | Cancel ID does not match active response |
| `INVALID_STATE` | yes | Valid message used in the wrong session state |
| `RESPONSE_FAILED` | yes | Agent or TTS response failed; text remains |
| `PROVIDER_UNAVAILABLE` | no | STT setup failed |
| `PROVIDER_ERROR` | no | Active STT failed |
| `INVALID_AUDIO` | no | PCM frame shape is invalid |
| `AUDIO_BACKPRESSURE` | no | A bounded media queue cannot keep up |

Non-recoverable errors are followed by `session.closed` when the socket is still writable.

## 10. Ordering

Dictation:

```text
session.ready
input.speech_started
input.transcript.delta *
input.speech_stopped
input.transcript.final
client input.commit
session.closed
```

Conversation response:

```text
input.transcript.final
response.created
response.text.delta *
response.audio.started?
binary audio *
response.text.done
response.audio.done?
response.done
```

Text and binary audio may interleave after `response.audio.started` because stable phrases are synthesized while later Agent text is generated.

Barge-in:

```text
response.cancelled(reason=barge_in)
input.speech_started
input.transcript.delta *
input.speech_stopped
input.transcript.final
response.created(new responseId)
```

## 11. WebSocket close codes

| Code | Meaning |
|---:|---|
| 1000 | Normal session close |
| 1001 | Gateway stopping |
| 4400 | Invalid JSON/protocol frame or clock skew |
| 4401 | Authentication/readiness violation |
| 4429 | Per-principal concurrency limit |

## 12. Security rules

- Tickets never appear in URLs.
- Ticket hashes, not raw tickets, are stored server-side.
- A ticket cannot change principal, purpose, Chat, limits, or provider route.
- JSON is strict and bounded; binary audio shape is checked before provider forwarding.
- Credentials, authorization headers, raw PCM, and full transcripts are excluded from protocol logs.
- A disconnected socket cannot resume; the client creates a new ticket/session.
