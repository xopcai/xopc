# Voice runtime reference

## First-audio latency

In Current assistant mode, Alibaba TTS prepares its WebSocket session in parallel with Agent generation and reuses that connection for the segments of one reply. Each subsequent segment waits for the provider's `response.done` boundary. Completing or interrupting a reply releases the connection; preparation sends no text. Other streaming providers keep their existing synthesis path unless they implement connection preparation.

The first complete sentence can be spoken immediately. If no sentence is ready after 300 ms, the gateway tries a short phrase boundary (comma or whitespace, after at least 12 characters), keeping the remaining text for later synthesis. It does not force a split inside a word, code block, table, incomplete link or inline code. A reply without a safe boundary still waits for more text or the end of the turn.

Gateway logs record `first_response_text`, `first_speech_phrase`, `response_tts_ready`, `first_synthesis_requested`, `first_tts_text_submitted` (prepared routes), and `first_response_audio`. Compare `textToPhraseMs`, `phraseToSubmitMs`, and `submitToAudioMs` for the same `responseId` to distinguish segmentation, connection waiting and synthesis. The DashScope transport also records `setupMs` and `synthesisMs`.

Web/desktop clients report `speech_end_to_audio_received` and `speech_end_to_audio_scheduled`. The latter includes the AudioContext scheduling delay; it is an estimated start time, not a measurement of physical speaker output. Compare cold and subsequent replies using p50/p95, and test interruption and audible continuity alongside latency. Automated fake-provider tests verify ordering and cleanup; actual provider/network latency requires live calls.

Native clients also report `speech_end_to_audio_buffered`: the first frame accepted by AudioTrack (Android), scheduled on AVAudioPlayerNode (iOS), or written to AudioRenderer (HarmonyOS). This measures application queuing and playback submission, not physical speaker output. New metrics are advertised by the existing voice preflight endpoint; updated clients omit them when connecting to an older gateway. Legacy receipt timing remains available.

Android requests low-latency AudioTrack playback and, on API 31+, a one-frame (20 ms) start threshold while retaining its existing buffer capacity. iOS requests a 10 ms audio I/O buffer, a 20 ms capture tap, and reuses the playback format; actual hardware buffering depends on the route. HarmonyOS reads microphone data in 20 ms chunks rather than waiting for a larger hardware buffer. These preferences require real-device checks with speaker, headset and Bluetooth routes to measure the actual latency and continuity.

[Return to the voice guide](../voice.md).
