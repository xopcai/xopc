# Unified platform voice

## Execution contract

The platform owns supplier credentials, routing, billing, provider protocol conversion and publication. Gateway clients use the `xopc.voice` manifest from `/v1/models`; Electron, WebUI, iOS and Android consume the same Gateway catalog and Voice v3 session protocol. No client model-name or supplier allowlist is needed for newly published models satisfying the contract.

The manifest is version 1 and declares `serviceVersion`, supported modes, voices, audio formats, session limits and interaction capabilities. Unsupported manifest versions or formats cannot be selected. File recognition, streaming recognition, file speech, streaming speech and native conversation are separate capabilities:

| Mode | Platform endpoint | Gateway setting |
| --- | --- | --- |
| transcription | `/v1/audio/transcriptions` | `tools.media.audio.providers.xopc-cloud.model` |
| transcription.stream | `/v1/audio/transcriptions/realtime` | `voice.realtime.stt` |
| speech | `/v1/audio/speech` | `messages.tts.providers.xopc-cloud` |
| speech.stream | `/v1/audio/speech/realtime` | `voice.realtime.tts` |
| conversation | `/v1/audio/conversations/realtime` | `voice.realtime.omni` |

Public streaming input is mono PCM16 at 16 kHz; output is mono PCM16 at 24 kHz. Platform adapters convert supplier formats, including StepFun conversation input at 24 kHz. Clients never perform supplier-specific negotiation. Streaming connections carry the catalog service version; a changed publication rejects stale negotiation with HTTP 409 instead of substituting a model. Existing direct BYOK/local providers remain independent supported paths, not compatibility fallbacks for managed voice.

## Settings and device behavior

`GET /api/voice/catalog` returns available models, current selections, catalog version and a settings revision. `POST /api/voice/catalog/refresh` refreshes the platform catalog and reports failure if only stale data is available. `PUT /api/voice/selection` requires the last settings revision and validates mode/model/voice before saving. Conflicting updates return 409. Mutating endpoints require `voice.configure`; existing devices without that grant must be explicitly reauthorized.

WebUI/Electron and mobile expose all five selectors and model-specific voices. Settings are shared by devices connected to that Gateway and apply to subsequent calls. An unavailable selection remains visible for correction; refreshing does not silently replace it. Gateway catalogs continue to follow the existing background sync lifecycle.

The browser and native transports share `VoiceReceiveState`, validating connection epoch, event/audio ordering and readiness. Locally cancelled responses suppress late audio immediately. Audio is never replayed after reconnect. Device-specific microphone, permissions, playback and audio-focus code stays in each device runtime.

## Validation and release

Automated coverage includes authenticated lazy HTTP routes, revision conflicts, refresh failure, permission scopes, discovery of unknown suppliers, model persistence, real local WebSocket STT/TTS flows, managed conversation negotiation/cancellation, shared receive-state validation and mobile query/transport behavior. Typechecks cover Gateway, WebUI and mobile; production WebUI and platform builds were also exercised.

Release the platform contract first, then Gateway and clients together. Refresh the catalog and select models independently for each mode. Ordinary ASR/TTS publication does not imply streaming or realtime support. Failed provider validation remains unpublished.

Before calling this production acceptance complete, run real-account tests on WebUI, Electron, iOS and Android: microphone permissions, ordinary recognition/readout, live dictation, assistant speech, native conversation, interrupt, network loss, mute, audio route changes and background/foreground transitions. These device and supplier E2E checks have not been completed by the local automated suite. No production deployment is implied by this document.
