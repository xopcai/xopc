# Realtime voice WebSocket protocol v3

Updated: 2026-09-11. The source of truth is `packages/realtime-protocol/src/voice.ts` and `voice-audio.ts`.

## Goals

Protocol v3 is the only public realtime voice protocol. Mobile, Web, and desktop use the same REST negotiation, JSON controls, and framed PCM transport. There is no v2 alias, raw-PCM compatibility path, or advertised socket-resume contract.

A call has two product modes:

- `assistant`: speech-to-text → the selected Agent → text-to-speech. Tools and durable Agent work are available.
- `natural`: a native speech model with no Agent and no tools. Its configured instructions are the only prompt input beyond the bounded Chat context.

Internal route diagnostics may still name the implementation `agent` or `omni`; clients select a product `mode`, never an engine.

## REST negotiation

Create and preflight use the same strict body:

```json
{
  "purpose": "conversation",
  "mode": "assistant",
  "sessionKey": "agent:main:webchat:default:direct:voice",
  "language": "zh",
  "supportedProtocolVersions": [3],
  "mediaPreferences": ["websocket-pcm"]
}
```

- `purpose` is `dictation | conversation`.
- Conversation requires `sessionKey`; `mode` is optional and defaults to the configured product mode.
- Dictation rejects `mode`.
- Unknown fields, credentials, provider URLs, model selection, and prompt overrides are rejected.
- `POST /api/voice/realtime/preflight` validates availability without allocating a ticket or provider connection.
- `POST /api/voice/realtime/sessions` returns a one-use ticket, call `sessionId`, positive `connectionEpoch`, `/api/voice/realtime/v3/ws`, input format, limits, route diagnostics, and media `{transport:"websocket-pcm",codec:"pcm_s16le",frameDurationMs:20}`.

Conversation creation validates the authoritative SQLite Chat identity. A new connection gets a new call ID and epoch while reusing the same durable Chat. There is deliberately no socket replay or provider-session resume.

## Connection and control envelopes

The first client control is `session.start` with the returned `sessionId` and ticket. Audio starts only after `session.ready`, which repeats the selected mode, epoch, media contract, route, and heartbeat interval.

Every JSON envelope uses protocol version 3, a UUID message/event ID, Unix-millisecond `sentAt`, and a strict payload. Server events additionally carry a positive connection-local JSON `seq` and the call `sessionId`. Clients reject wrong sessions and sequence gaps. The gateway bounds clock skew, frame sizes, and replayed client message IDs.

Client controls:

| Type | Payload | Meaning |
| --- | --- | --- |
| `input.commit` | `{}` | Finish dictation; invalid for conversation |
| `input.mute` | `{muted}` | Stop capture and discard partial input without stopping playback |
| `response.stop_playback` | `{responseId}` | Stop rendering this response and detach its voice stream |
| `task.cancel` | `{taskId}` | Explicitly cancel the durable Agent run |
| `response.audio.played` | `{responseId,playedDurationMs}` | Cumulative audio actually rendered |
| `session.metric` | `{responseId,metric,durationMs}` | Bounded receipt/stop timing diagnostic |
| `session.ping` | `{}` | Heartbeat; gateway returns `session.pong` |
| `session.stop` | `{reason}` | End the call connection |

Stopping playback, ending a call, and cancelling a task are separate operations. An Agent task continues after playback stops or the socket closes. Only `task.cancel` aborts it. Completed tool effects are never rolled back by a voice control.

## Binary media frames

Both directions use one `XOP3` binary envelope. Header numbers are big-endian; PCM samples remain signed 16-bit little-endian.

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 4 | Magic `XOP3` |
| 4 | 1 | Protocol version, `3` |
| 5 | 1 | Kind: `1` uplink, `2` downlink |
| 6 | 1 | Codec: `1` = PCM S16LE |
| 7 | 1 | Flags: uplink start/end bits |
| 8 | 4 | Connection epoch |
| 12 | 4 | Direction-local sequence |
| 16 | 8 | Media timestamp in milliseconds |
| 24 | 2 | Duration, exactly `20` |
| 26 | 2 | UTF-8 ID byte length |
| 28 | 4 | PCM payload byte length |
| 32 | variable | ID, then PCM payload |

Uplink IDs are `utteranceId`; downlink IDs are `responseId`. Uplink audio is exactly 640 bytes per frame (16 kHz mono, 20 ms). Downlink audio is exactly 960 bytes per frame (24 kHz mono, 20 ms). The gateway converts arbitrary provider chunks to exact downlink frames and pads only the final incomplete frame with silence. Wrong epochs, malformed lengths, and sequence gaps are protocol errors; duplicate or older uplink frames are ignored.

## Turn and response events

Speech/transcript events retain utterance ID and monotonic revision. The gateway additionally emits:

- `turn.decision`: complete, incomplete, backchannel, or wait, with confidence and decision source.
- `turn.committed`: the exact turn accepted for response generation.
- `response.created`, text/audio lifecycle events, `response.done`, and `response.cancelled`.
- `task.created`, `task.activity`, and `task.done` for durable Agent work.
- `response.clarification` for explicit user input or approval; ambient speech never approves an action.
- `session.error`, `session.closed`, and `session.pong`.

The turn policy combines optional semantic decisions with a bounded deterministic fallback. Stale asynchronous decisions cannot commit a newer utterance. Short backchannels and incomplete phrases extend the listening window rather than creating accidental turns.

## Flow control and weak networks

- The client serializes capture enable/disable and tags every audio frame with epoch, utterance, sequence, and monotonic capture time.
- Mobile pauses capture when queued input reaches the degraded threshold instead of growing latency indefinitely. It resumes after recovery; critical overflow reports `INPUT_DROPPED` and starts a fresh utterance.
- Gateway/provider writes are serialized and bounded. Old input is cleared on mute, interruption, or overflow so recovered networks cannot upload stale speech.
- Downlink playback uses a bounded unacknowledged-duration window. Acknowledgements describe heard duration rather than transport bytes.
- Late frames for stopped responses, prior epochs, or old sequences cannot reopen playback.

Reconnection creates a fresh ticket and epoch in the same Chat. It restores durable Chat context, not transport buffers. Agent input uses a stable task identity so disconnecting during work does not submit the request twice.

## Native audio boundary

The mobile native module owns communication-mode capture and playback. It exposes route capabilities, interruption/route events, local speech candidates, duck/resume, and rendered progress. Android uses communication audio routing with available acoustic echo cancellation/noise suppression. iOS uses the voice-processing audio path. Half-duplex routes suppress capture while playback is active; full-duplex routes use local near-speech detection to duck first and wait for server confirmation before final interruption.

## Security and observability

Tickets are sent only in the first control frame. Provider credentials stay in the gateway/platform boundary. Logs and diagnostics contain bounded timings, queue ages, route state, counts, provider names, and diagnostic references—not audio, tickets, keys, or full transcripts.

`GET /api/voice/realtime/status` returns `enabled`, `defaultMode`, provider-route diagnostics, and explicit capabilities for dictation, assistant, natural, supported languages, barge-in, and media transports. This is configuration preflight, not proof of a successful live provider connection.

Close codes: `1000` normal, `1001` gateway stopping, `4400` invalid protocol/media, `4401` authentication/readiness, and `4429` concurrency.
