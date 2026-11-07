# Voice runtime reference

## First-audio latency

In Current assistant mode, TTS connection preparation starts on recognized speech onset, before the input is committed. No text or Agent work is submitted speculatively. Alibaba reuses one connection for the segments of a reply and waits for the provider's `response.done` boundary. XOPC Cloud prepares the first connection and uses independent connections for later segments, preserving prefetch without assuming vendor-specific flush boundaries. Mute and input discard release unused preparation; completion, interruption and hangup release the reply's connections.

The first complete sentence or Chinese clause of at least six characters can be spoken immediately. If no safe boundary is ready after 120 ms, the gateway tries a short phrase boundary, keeping the remaining text for later synthesis. It does not force a split inside a word, code block, table, incomplete link or inline code. A reply without a safe boundary still waits for more text or the end of the turn.

Recognition owns the configured silence interval. Complete finalized input has a 40 ms event-ordering grace period, without a second minimum-silence floor. Incomplete phrases retain their longer continuation hold. Web playback requests interactive latency with a 20 ms first-frame scheduling lead. Speech onset reversibly ducks playback; substantial non-echo partial transcripts stable for 180 ms can stop the old reply. Only finalized input is submitted to the Agent. Stopping playback continues to leave durable background tasks running unless explicitly cancelled.

## Voice execution and history

`voice.realtime.assistant` accepts an optional `model`, a `thinkingLevel` (default `off`), and `historyTokens` (default 4000 estimated history tokens, configurable from 1000 to 16000). The model override applies only to voice turns. It does not replace the conversation's text model or remove tools. Explicit streaming recognition can select Alibaba or XOPC Cloud independently of batch transcription.

Voice requests retain system instructions, complete recent user turns and the entire current execution, including tool results and steering inputs. A fitting prior compaction summary is retained. Older rows remain in SQLite and accessible through recall/search; the provider receives an explicit notice when history is omitted. This is an ephemeral provider projection, not a transcript rewrite or a second session. The current execution can exceed the history budget. A fitting projected request avoids foreground compaction of unrelated older history.

Ada uses a per-turn spoken prompt that retains identity, workspace instructions, safety, trust, memory access and task coordination. Ordinary text prompts are unchanged.

## Measuring the 1.5-second target

Use `node --import tsx/esm scripts/benchmark-voice-latency.mts PCM16_16KHZ_FILE AGENT_ID ROUNDS` against a running gateway. It creates and cleans up a disposable conversation by default. The optional fourth argument uses an existing conversation and appends real turns: use a database snapshot for comparisons involving Ada's actual history. Existing conversations are never deleted by the benchmark.

The fixture is paced at 20 ms and its final voiced PCM frame anchors the clock, so recognition endpoint waiting is included. Silence continues to feed the recognizer while waiting. Output includes endpoint, commit, model and TTS delays and nearest-rank p50/p95. Playback ACKs are simulated; results measure audio receipt, not physical speaker output. Small sample percentiles do not establish a production SLO. Cold starts, failures, interruptions and real devices require separate acceptance.

Gateway logs record `first_response_text`, `first_speech_phrase`, `response_tts_ready`, `first_synthesis_requested`, `first_tts_text_submitted` (prepared routes), and `first_response_audio`. Compare `textToPhraseMs`, `phraseToSubmitMs`, and `submitToAudioMs` for the same `responseId` to distinguish segmentation, connection waiting and synthesis. The DashScope transport also records `setupMs` and `synthesisMs`.

Web/desktop clients report `speech_end_to_audio_received` and `speech_end_to_audio_scheduled`. The latter includes the AudioContext scheduling delay; it is an estimated start time, not a measurement of physical speaker output. Compare cold and subsequent replies using p50/p95, and test interruption and audible continuity alongside latency. Automated fake-provider tests verify ordering and cleanup; actual provider/network latency requires live calls.

Native clients also report `speech_end_to_audio_buffered`: the first frame accepted by AudioTrack (Android), scheduled on AVAudioPlayerNode (iOS), or written to AudioRenderer (HarmonyOS). This measures application queuing and playback submission, not physical speaker output. New metrics are advertised by the existing voice preflight endpoint; updated clients omit them when connecting to an older gateway. Legacy receipt timing remains available.

Android requests low-latency AudioTrack playback and, on API 31+, a one-frame (20 ms) start threshold while retaining its existing buffer capacity. iOS requests a 10 ms audio I/O buffer, a 20 ms capture tap, and reuses the playback format; actual hardware buffering depends on the route. HarmonyOS reads microphone data in 20 ms chunks rather than waiting for a larger hardware buffer. These preferences require real-device checks with speaker, headset and Bluetooth routes to measure the actual latency and continuity.

[Return to the voice guide](../voice.md).
