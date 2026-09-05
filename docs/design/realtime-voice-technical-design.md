# Realtime voice technical design

Updated: 2026-09-05. [PRD](./realtime-voice-prd.md) · [WebSocket protocol](./realtime-voice-websocket-protocol.md)

## Ownership

```text
Browser / Electron
  capture + resampler + PCM player + voice session client
    ↕ protocol v2
VoiceRealtimeRuntime
  tickets, authentication, bounds, session reservation, lifetime
    ├─ AgentVoiceEngine → existing streaming STT → existing Agent → streaming TTS
    └─ OmniVoiceEngine  → Qwen native realtime audio
                            direct DashScope OR XOPC Platform
```

The engine interface has only start, appendAudio, commit, cancel, acknowledge and close. The runtime does not perform business turns. Engine implementations do not allocate browser tickets or own gateway authentication. No generic provider framework or runtime fallback chain is added.

| Component | Implementation |
|---|---|
| Wire schemas and binary codec | `packages/realtime-protocol/src/voice{,-audio}.ts` |
| Session lifecycle | `src/voice/realtime/runtime.ts` |
| Existing Agent pipeline | `src/voice/realtime/agentEngine.ts` |
| Native pipeline / route resolution | `src/voice/realtime/{omniEngine,omniRoute}.ts` |
| Output flow control | `src/voice/realtime/audio-playback-window.ts` |
| Capture / playback | Existing PCM capture, resampler and `PcmPlayer` |
| Platform relay and usage | `apps/model-gateway/src/omni-{relay,repository}.ts` in xopc-platform |

## Preflight and configuration

Creation clones config, validates the selected engine, checks Chat existence/busy state, freezes credentials/routes and issues a one-use ticket. The web input acceptance path and call creation share the existing per-session configuration lock.

Agent resolves the existing STT/TTS providers and requires actual streaming PCM support. Omni resolves only `voice.realtime.omni`; it never resolves STT/TTS or invokes the Agent.

```json
{
  "voice": {
    "realtime": {
      "enabled": true,
      "omni": {
        "provider": "alibaba",
        "model": "qwen3-omni-flash-realtime",
        "voice": "Cherry",
        "instructions": "You are a friendly voice companion. You cannot execute tools."
      }
    }
  }
}
```

This is a config fragment. Direct credentials use `apiKey` or the existing DashScope auth resolver / `DASHSCOPE_API_KEY`. Managed mode uses `provider: "xopc-cloud"` and existing XOPC OAuth. The optional `baseUrl` is a full realtime WSS URL for DashScope, or the platform router base for managed mode.

Only certified DashScope hosts and the native realtime path are allowed in direct mode. The platform also derives the upstream realtime path from its administrator-owned DashScope connection. No client-supplied upstream URL is accepted by the relay.

## Agent engine

The existing streaming STT adapter produces revisions and final utterances. Final utterance IDs are deduplicated. One serialized conversation tail runs normal webchat Agent turns; barge-in cancels the current response before the next turn.

Agent text is shown immediately and segmented deterministically at punctuation or a 120-character boundary for streaming TTS. TTS cancellation shares the response AbortSignal. Normal Agent persistence remains unchanged; interrupted replies retain the existing bounded audit entry.

Dictation uses the STT portion only; its commit ends input, and final text is returned to the composer.

## Native engine

1. Open one Qwen realtime WebSocket.
2. On `session.created`, configure text/audio modalities, PCM formats, a supported voice, instructions, `gummy-realtime-v1` input transcription and server VAD.
3. Wait for `session.updated` before declaring local readiness.
4. Append base64 PCM chunks to Qwen; the browser protocol itself remains binary.
5. Map speech boundaries, final input transcription, response creation, audio transcript deltas, audio deltas and completion into local events.
6. Decode output, apply playback-window backpressure and tag each binary frame with response ID.
7. On interruption, abort pending audio, clear the active response and reject late data. Cancel the upstream generation for an explicit user cancellation only while it is still generating.
8. On disconnect/error, terminate the upstream and release waits.

The certified Qwen endpoint can return `invalid_request_error / Conversation has none active response` when completion races with cancellation. Only that exact error after a locally issued cancellation is ignored. Other errors remain fatal.

Server VAD controls automatic responses. There is no manual native commit, semantic-VAD setting, tool registration or session resumption.

## Playback and cancellation

Connection, input capture and response playback are distinct lifetimes. A provider generation can finish while local audio remains queued. The active response is retained until playback acknowledges it, allowing interruption of tail audio.

The shared window allows 96,000 unacknowledged PCM bytes (two seconds). Output chunks are at most 24,000 PCM bytes. Lack of playback progress for 15 seconds fails the response. Native unsent audio is additionally capped at 192,000 bytes; input/upstream buffers are bounded. Overflow fails explicitly.

The client checks binary sequence and response identity; late audio or text from a cancelled response cannot affect its replacement. Capture attempts are generation-fenced, so a delayed permission, connection or recorder callback cannot revive an ended call.

Browser echo cancellation is requested, not guaranteed. Local speech energy ducks output; confirmed server speech or manual interruption clears it.

## Persistence and context isolation

Native final transcripts use `SessionIndex.appendTranscriptCustomMessageEntry` → the existing SQLite writer. They carry `voice_omni_transcript`, call ID, provider item/response ID, role and interruption status. The frozen session identity is checked inside the storage mutation before append.

Native entries render in Chat as user/assistant messages but are excluded by `buildSessionContextForLlm`; raw audio and partial text are not stored. The companion starts fresh each call and does not automatically import Agent history, memory or tools.

Generated text is not proof of played audio. On interruption the UI labels the transcript accordingly. We do not issue an undocumented provider context-truncation operation or claim exact heard-context restoration.

## Platform relay and settlement

Endpoint: `WS /v1/audio/conversations/realtime?model=qwen3-omni-flash-realtime`.

Authorization uses the existing bearer token with `models:invoke`, active-user check, concurrency/rate limits and a healthy enabled key in an available upstream pool. Debug access uses a separate one-use ticket bound to administrator, origin, capability and model. Tickets never appear in URLs.

The relay permits one strict `session.update`, PCM append and response cancel. It rejects tools, manual response creation and arbitrary conversation mutations. Existing provider-pool admission also applies.

Tables:

- `model_omni_route`: certified model, existing provider connection, enabled state and four prices.
- `model_omni_call`: call identity, price snapshot, reservation, settlement state/reason.
- `model_omni_usage`: one usage row per call/response; primary key deduplicates completion events.

Usage is taken from Qwen's `input_tokens_details` / `output_tokens_details`. Text/audio detail totals must match the reported input/output totals. Unrecognized or missing usage is not zero.

Credits = ceil(sum(modality tokens × frozen modality price) / 1,000,000). Calls reserve 100,000 tokens at the highest modality price and stop after reaching that reported budget or 30 minutes. A final response can exceed the admission estimate; customer charges never exceed the reserved amount, and that excess is platform cost.

On close, the relay stops admitting input, requests cancellation where applicable and allows a bounded 1.5-second usage drain. Missing/in-flight usage, uncompleted speech or input without a usage-bearing response leaves the call pending and its credit reservation held. Startup marks interrupted running calls pending. This assumes the existing single gateway writer deployment, not active-active multi-instance serving.

Known settlement and manual reconciliation update the shared reservation/credit ledger and Omni state in one SQLite transaction. Repeated settlement cannot charge again. The generic reservation expiry reaper must not refund running/pending native calls.

The native relay has independent pricing; it never adds STT minutes or TTS character fees. No prices or upstream keys are auto-published during migration.

## Operations and verification

Platform diagnostics expose call ID, route, authorization/quota stage, handshake/first-result timing, audio volume and settlement outcome. No raw audio, provider payload, transcript or secret is logged.

Automated gates cover engine regression, tagged frames, late-response fencing, session identity, masked secrets, provider policy, origin-bound tickets, duplicate usage and pending reconciliation. The opt-in `XOPC_LIVE_OMNI=1` test generates a short synthetic speech fixture in memory and verifies native input transcription plus audio output using the actual vendor.

Real microphone/speaker echo, interruptions under weak networks and suspended browser tabs require device acceptance. Push, deployment and production price publication are separate operations.

## Agent output selection and diagnostics

Optional voice.realtime.tts selects the Agent conversation provider (alibaba or xopc-cloud) and voice independently of message readout. Without it, Agent output inherits the message speech route; only streaming PCM qualifies. Direct output uses the fixed realtime model, defaults to Cherry, and resolves credentials from the input provider slice, then DASHSCOPE_API_KEY, then the speech provider slice. Managed output uses an available streaming PCM catalog model. Omni does not use this selection.

Settings preflight uses the same Agent route resolvers as call creation. The fixed preview disables fallback and has a 20-second deadline and 960 KB PCM limit. Combined diagnostics use dictation plus preview, never an Agent or Omni call. Resources close on cancellation, configuration changes, departure and unmount.
