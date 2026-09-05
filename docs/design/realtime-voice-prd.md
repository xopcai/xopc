# Realtime voice PRD

Updated: 2026-09-05. Scope: gateway console / Electron renderer and XOPC Platform relay.

## Product decision

One voice surface supports independent dictation and two explicitly selected conversation engines.

| Action | Pipeline | Tools and Agent memory |
|---|---|---|
| Dictation | Microphone → streaming STT → editable composer | No automatic submission |
| Voice assistant (`agent`) | STT → existing xopc Agent → streaming TTS | Existing tools, approvals and session context |
| Natural chat (`omni`) | Microphone → Qwen Omni → audio reply | No tools; fresh provider conversation per call |

These are supported product capabilities, not migration fallbacks. Choose the conversation mode before starting. There is no automatic downgrade, live engine switch or socket resume.

## User journeys

1. Open Settings → Capabilities → Voice and enable realtime voice.
2. For the voice assistant, configure streaming STT and streaming PCM TTS.
3. For natural chat, configure the Omni connection separately: XOPC Platform login or a local DashScope key.
4. Open an existing Chat. Choose Voice assistant or Natural chat next to the call button.
5. Speak naturally; server VAD detects turns. The call shows microphone level, the latest input text, response text, elapsed time and listening/thinking/speaking state.
6. Mute controls speaker output, not microphone capture. Interrupt stops current playback; End releases capture and the connection.
7. To use tools, end natural chat and explicitly choose Voice assistant.

Microphone permission is requested only after a user action. Final dictation text remains editable and is not sent automatically. Audio attachments and message read-aloud remain independent features.

## Configuration and credentials

- STT settings remain under `tools.media.audio`; TTS under `messages.tts`.
- Session limits and barge-in remain under `voice.realtime`.
- Native model, voice, instructions, provider and optional credentials/endpoint are under `voice.realtime.omni`.
- Supported native model: `qwen3-omni-flash-realtime`.
- Direct mode resolves the local key or the existing DashScope credential.
- Managed mode uses the signed-in XOPC token; the platform resolves its upstream key.
- The session payload contains only safe route metadata. The authenticated settings UI receives masked keys; unchanged masked values preserve stored secrets.
- Configuration changes affect new calls only.

## Conversation ownership and history

One voice reservation exists per Chat, including an outstanding connection ticket. An active or queued Agent input prevents call creation. The normal web input/edit routes reject competing submissions during a reserved voice call.

Agent mode keeps the existing canonical Agent transcript writer. Natural chat stores only final user text and generated assistant text, using existing SQLite custom-message entries and call/item identifiers. It does not create an Agent run or synthetic tool results. These entries render with their actual speaker roles but are excluded from Agent model context; the two engines do not silently share conversational memory.

An interrupted assistant entry is marked as interrupted and may contain text that was never played. Native provider context is not truncated to an exact heard offset; that capability is not certified. Reset/deletion invalidates the saved session identity so delayed native writes cannot recreate a deleted conversation or pollute a new one.

Raw audio, partial transcripts and provider payloads are not retained.

## Platform administration

Models and routes → Conversation configures the certified model against an existing DashScope provider connection. Administrators explicitly set four credits-per-million-token rates: text input, audio input, text output, audio output.

The audio debug lab offers native conversation through the production relay, with one-use origin-bound debug tickets, a two-minute limit, microphone consent, event-type history and a diagnostic ID. It does not validate an external device, acoustic echo cancellation or a native OAuth grant.

Incomplete usage appears under Pending usage reconciliation. An administrator verifies provider billing, enters credits/tokens and a reason, then confirms settlement. No unknown usage is silently treated as free.

## Limits and errors

| Condition | Behavior |
|---|---|
| Disabled, missing credentials or unsupported native model | Fail preflight; link to Voice settings |
| Existing Chat run, queued input or voice reservation | HTTP 409 |
| Permission/device failure | No capture; draft preserved |
| Agent/TTS response failure | Existing recoverable text-only/partial-audio behavior |
| Native provider failure | End call with error; no switch to Agent |
| Slow receiver / malformed frames | Bounded failure and cleanup; never discard arbitrary middle frames |
| Disconnect | Close upstream, stop media, release runtime reservation |
| Missing platform usage | Hold credit reservation pending reconciliation |

Limits: 50 connections globally, two per principal, mono PCM16 input at 16 kHz and output at 24 kHz. Runtime defaults are 10 minutes for dictation, 60 minutes for conversation and 60 seconds idle; managed Omni additionally caps calls at 30 minutes and reserves a 100,000-token budget.

## Acceptance and delivery gates

1. Extract Agent execution behind the engine boundary and rerun existing voice tests.
2. Add explicit engine selection and protocol v2 tagged audio; reject malformed or stale response data.
3. Add the native engine, final transcript projection, credential handling and interruption tests.
4. Add platform authorization, allowlisted relay, independent pricing, durable usage and reconciliation.
5. Add settings/debug surfaces; run regression tests, typechecks, lint and builds.
6. Perform an opt-in paid synthetic-speech vendor round trip. Separately verify real microphone, speaker echo, weak network and mobile/browser suspension before release.

No WebRTC, telephony, meetings, camera input, voice cloning, automatic tool bridge, silent fallback or compatibility protocol is included.

See [technical design](./realtime-voice-technical-design.md), [wire protocol](./realtime-voice-websocket-protocol.md) and [usage](../voice.md).

## Agent voice setup and diagnostics

The settings retain shared service/key setup, independent Agent conversation voice, interruption control and an explicit audio test. Readout and advanced input settings remain collapsed. Configuration is unverified until final transcription and user-confirmed playback; this verifies neither the Agent model nor the native Omni route. Changes invalidate verification. Microphone access requires user action.
