# Realtime voice product requirements

> Status: Implemented
>
> Date: 2026-09-04
>
> Scope: Gateway Web UI and Electron renderer

## 1. Product decision

xopc provides two realtime voice actions on one media-session foundation:

1. **Realtime dictation** streams microphone audio to Qwen STT, shows partial text, and inserts only final text into the composer. The user edits and sends it normally.
2. **Voice conversation** sends final speech to the existing xopc Agent, streams Agent text through Qwen TTS, and plays PCM audio while the answer is generated.

The only conversation pipeline is:

```text
Qwen streaming STT -> existing xopc Agent turn -> Qwen streaming TTS
```

Voice is an input/output surface around the existing Agent. It does not create another assistant runtime, transcript store, permission model, or provider-owned conversation mode.

## 2. User value

Realtime dictation removes the record-upload-wait cycle while keeping consequential text reviewable. Voice conversation provides hands-free interaction without losing the selected Agent's personality, tools, memory, model configuration, approvals, or session history.

## 3. Product surfaces

### 3.1 Dictation

The existing microphone button starts dictation.

- Microphone permission is requested after the click.
- Partial recognition replaces the current unconfirmed phrase.
- A final phrase is inserted into the editable composer.
- Confirm stops capture and commits the remaining upstream audio.
- Cancel discards unconfirmed audio and text.
- Dictation never submits a Chat message automatically.
- Uploaded voice attachments remain a separate one-shot product, not a realtime fallback.

### 3.2 Voice conversation

The waveform button beside the microphone starts a conversation bound to the current Chat session.

- The composer surface shows microphone level, latest transcript, response text, elapsed time, and response state.
- Qwen server VAD completes each spoken turn automatically.
- The user can mute output, interrupt the current response, or end the conversation.
- When automatic interruption is enabled, speaking while an answer is active cancels the Agent/TTS response and clears queued playback.
- The microphone stays active until the user ends the session or a bounded limit is reached.

A conversation cannot start on a new/unsaved Chat, while that Chat already has an Agent run, or while another voice conversation is reserved for it.

## 4. Credential routes

Provider selection comes only from existing capability settings.

| Provider ID | Route | Credential handling |
|---|---|---|
| `alibaba` | Local gateway connects directly to DashScope | `DASHSCOPE_API_KEY` or provider config remains server-side |
| `xopc-cloud` | Local gateway connects to the XOPC Platform relay | Existing XOPC account token authenticates the relay; platform owns upstream credentials |

The renderer receives only provider/model names and a `managed` marker. It never receives provider keys, platform tokens, provider headers, or upstream URLs.

## 5. Configuration

Configuration has one source per concern:

```text
tools.media.audio   STT provider, key, URL, language, and fallback
messages.tts        TTS provider, key, URL, model, and voice
voice.realtime      session behavior only
```

`voice.realtime` contains:

- `enabled`, default `false`;
- `silenceDurationMs`, default `700`, bounds `300..2000`;
- `idleTimeoutMs`, default `60000`;
- `maxDictationMs`, default `600000`;
- `maxConversationMs`, default `3600000`;
- `bargeIn`, default `true`.

Qwen Audio 3.0 streaming recognition uses server VAD. A manual-turn option is deliberately absent because that model/protocol does not provide a true manual segmentation mode. `input.commit` ends dictation; it is not a second conversation mode.

## 6. Functional requirements

### 6.1 Capture and recognition

- Capture one microphone track with echo cancellation, noise suppression, and automatic gain control requested.
- Convert audio to mono PCM16 little-endian at 16 kHz with a stateful resampler.
- Send binary frames no larger than 64 KiB.
- Show only the newest revision of a partial/final utterance.
- Never persist partial recognition or raw audio.
- Stop tracks, capture worklets, playback nodes, timers, and sockets on every exit path.

### 6.2 Agent execution

- Submit only a non-empty final transcript.
- Use the same embedded webchat turn path as typed Chat.
- Keep one Agent response active per voice session.
- Preserve existing tools, approvals, model routing, session config, and SQLite transcript synchronization.
- Reject a voice conversation when the Chat is already running instead of starting concurrent Agent turns.

### 6.3 Speech and playback

- Send visible Agent text deltas immediately.
- Commit TTS input only on deterministic punctuation or a 120-character bound.
- Synthesize one phrase at a time to preserve order and cancellation.
- Accept only mono PCM16 at 24 kHz from realtime TTS.
- Begin playback with an 80 ms jitter allowance and limit unplayed audio to two seconds through playback acknowledgements; fast synthesis waits rather than truncating replies.
- When automatic interruption is enabled, duck playback on local speech energy; clear it after confirmed barge-in or manual interruption. Keep manual interruption available until local playback finishes.
- A TTS failure keeps the text response visible and leaves the voice session recoverable.

### 6.4 Lifecycle and limits

- HTTP creates a one-use, 60-second ticket; the ticket is sent only in the first WebSocket JSON frame.
- First-frame authentication must finish in 10 seconds.
- Maximum connected sessions: 50 globally and 2 per authenticated principal.
- Maximum one voice conversation per Chat session.
- Selected config/provider/model/voice is frozen when the ticket is created.
- There is no socket resume or mid-session provider failover.
- Provider/client backpressure fails explicitly instead of silently dropping arbitrary audio.

## 7. Transcript and retention

Dictation is not durable until the user sends the edited composer content.

Conversation input and assistant output use the normal Agent/SQLite transcript path. When barge-in or manual cancellation interrupts an answer, xopc appends one bounded audit context row containing response ID, reason, generated character count, and whether interruption occurred while thinking or speaking.

Raw PCM, provider messages, partial transcripts, credentials, and guessed playback offsets are never stored.

## 8. Error behavior

| Failure | User-visible result |
|---|---|
| Realtime disabled or provider missing | Session creation fails and links to Voice settings |
| Microphone permission/device failure | Capture does not start; existing draft remains |
| STT setup/runtime failure | Confirmed text remains; capture and socket close |
| Chat/session conflict | Conversation is rejected with HTTP 409 |
| Agent/TTS response failure | Text produced so far remains; conversation returns to listening |
| Input/output backpressure | Active media work is cancelled with a bounded error |
| Client disconnect or gateway shutdown | Provider sockets and Agent/TTS abort signals close |

## 9. Delivery phases

### Phase 1 — realtime dictation

Delivered: protocol schemas, authenticated media WebSocket, ticket lifecycle, direct Alibaba and managed XOPC Cloud streaming STT, browser PCM capture/resampling, partial/final projection, configuration, and limits.

### Phase 2 — voice conversation

Delivered: canonical Agent integration, deterministic phrase segmentation, native Alibaba and XOPC Cloud Qwen streaming TTS, bounded PCM playback, mute, interruption, barge-in, one-response/session-conflict invariants, interruption audit rows, and latency logs.

## 10. Acceptance

- API keys and access tokens never enter renderer-visible payloads.
- Dictation final text remains editable and is never auto-sent.
- Conversation input/output persists only through the canonical Chat path.
- A response can be interrupted without reconnecting the STT session.
- TTS failure does not remove generated text.
- Session end releases media tracks, timers, browser audio nodes, provider sockets, and abort controllers.
- Protocol tests, feature tests, root/Web type checks, lint, and production build pass.

## 11. Non-goals

WebRTC, telephony, meetings, diarization, camera input, voice cloning, raw-audio retention, offline full-duplex mode, Qwen Omni Realtime, socket resumption, and mid-session provider switching.

## 12. Related documents

- [Technical design](./realtime-voice-technical-design.md)
- [WebSocket protocol](./realtime-voice-websocket-protocol.md)
- [Existing voice documentation](../voice.md)
