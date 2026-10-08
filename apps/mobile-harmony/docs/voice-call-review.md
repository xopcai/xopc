# Harmony continuous voice call investigation

Date: 2026-10-08.

## Implementation

`VoiceCallView` uses `XopcVoiceCall`. The call materializes the existing conversation, checks realtime availability/preflight, creates a v3 voice session, starts native AudioKit capture/playback, and connects an authenticated WebSocket. Natural mode uses the native realtime model; assistant mode uses streaming STT, the existing Agent run and streaming TTS.

The microphone captures mono PCM16 at 16 kHz. `XopcVoiceCallTransport` serializes 640-byte / 20 ms uplink frames. Gateway engines use provider speech events and `TurnCoordinator` to commit user turns. Downlink audio is mono PCM16 at 24 kHz; `PcmFrameBuffer` emits 960-byte / 20 ms frames and pads the last frame. Speech detection and turn commitment belong to the server, rather than the client's transport utterance UUID.

The Harmony client acknowledges audio **buffered by the renderer** to avoid blocking server output. Gateway `AudioPlaybackWindow.drain()` therefore gates server completion on buffering, whereas native `AudioRenderer.drain()` gates audible completion. These are separate boundaries. AudioKit timestamp behavior was checked against the installed SDK API declarations and the [official renderer guide](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/using-audiorenderer-for-playback).

## Confirmed defects and changes

1. A fully played response was not released synchronously when `response.done` arrived. The client always launched another asynchronous drain. A next response arriving before its callback was cancelled by the active-response guard. Completion now checks the already played duration.
2. Server completion can precede native drain. A legitimate second response arriving during that gap was also cancelled and its audio discarded. The client now buffers its ordered response events and audio until the old playback finishes, then replays them. Buffering has byte and entry limits; overflow invokes playback recovery. The guard still rejects unsolicited overlap before the server finishes the active response.
3. Session release preserved the old response ID, counters and congestion timer. A recovered session could consequently cancel all new replies. Release now invalidates old callbacks and clears response, task, clarification, approval, pending reply and congestion state.
4. A rejected renderer write from flushed playback could trigger recovery of the current call. Write failures now check both call and playback generations. While a native drain is running, timestamp polling is stopped so it cannot advance ownership before drain completes.

Stopping playback invalidates old audio before promoting a pending response. Diagnostic logs record response IDs and transitions without transcripts or credentials.

## Validation

The new host tests reproduced three failures against the original call implementation before changes: already played completion, second reply during drain, and stale ownership after release. Regression coverage includes three consecutive replies, stopping old playback with a reply queued, pre-completion overlap protection, and rejected writes after flush. Existing playback tests cover stalled timestamps, renderer drain, and flushing while drain is outstanding.

Harmony host tests and selected Gateway agent/omni, interruption, playback, media, turn-policy and PCM-frame tests pass. Debug and release HAP builds pass; the project has existing SDK/deprecation/capability warnings and no configured default signing identity.

No HDC device was connected and no DevEco UI verification MCP was available. Host tests use platform mocks and cannot certify real microphone input, echo cancellation, route changes, physical playback or actual provider latency. A device acceptance run remains necessary: at least ten alternating turns in assistant and natural modes, a second utterance near the previous audio tail, interruption, mute/resume, network recovery, and earpiece/speaker/Bluetooth switching. Correlate client `XopcVoice` response transitions with Gateway `Voice:Agent` / `Voice:Omni` logs.
