# Voice runtime reference

## First-audio latency

In Current assistant mode, TTS connection preparation starts on recognized speech onset, before the input is committed. No text or Agent work is submitted speculatively. Alibaba reuses one connection for the segments of a reply and waits for the provider's `response.done` boundary. XOPC Cloud prepares the first connection and uses independent connections for later segments, preserving prefetch without assuming vendor-specific flush boundaries. Mute and input discard release unused preparation; completion, interruption and hangup release the reply's connections.

The first complete sentence or Chinese clause of at least six characters can be spoken immediately. If no safe boundary is ready after 120 ms, the gateway tries a short phrase boundary, keeping the remaining text for later synthesis. It does not force a split inside a word, code block, table, incomplete link or inline code. A reply without a safe boundary still waits for more text or the end of the turn.

Recognition owns the configured silence interval. Complete finalized input has a 40 ms event-ordering grace period, without a second minimum-silence floor. Incomplete phrases retain their longer continuation hold. Web playback requests interactive latency with a 20 ms first-frame scheduling lead. Speech onset reversibly ducks playback; substantial non-echo partial transcripts stable for 180 ms can stop the old reply. Only finalized input is submitted to the Agent. Stopping playback continues to leave durable background tasks running unless explicitly cancelled.

## Voice execution and history

`voice.realtime.assistant` accepts an optional `model`, a `thinkingLevel` (default `off`), and `historyTokens` (default 4000 estimated history tokens, configurable from 1000 to 16000). The model override applies only to voice turns. It does not replace the conversation's text model or remove tools. Explicit streaming recognition can select Alibaba or XOPC Cloud independently of batch transcription.

Voice requests retain system instructions, complete recent user turns and the entire current execution, including tool results and steering inputs. A fitting prior compaction summary is retained. Older rows remain in SQLite and accessible through recall/search; the provider receives an explicit notice when history is omitted. This is an ephemeral provider projection, not a transcript rewrite or a second session. The current execution can exceed the history budget. A fitting projected request avoids foreground compaction of unrelated older history.

Ada uses a per-turn spoken prompt that retains identity, workspace instructions, safety, trust, memory access and task coordination. Ordinary text prompts are unchanged.

## Shared user identity

Natural voice pins a separate owner-profile snapshot before selecting optional memory and history. Text Chat and voice read the same confirmed profile assertions, including the preferred name; voice also carries available role, pronouns, timezone and locale. Names are never inferred from filesystem usernames, prior assistant guesses, or a user's question about a suggested name. Missing profile fields remain explicitly unknown and can be recalled through the Agent when permitted.

The profile is bounded to 800 characters, independent of optional context planning and query relevance, and respects owner identity, per-session privacy, per-agent permissions and assertion validity. Long optional memory items are skipped individually rather than discarding the whole snapshot; confirmed facts and working assumptions remain separate. Retrieval uses the canonical session Agent id. Shared Chat and refreshable persona snapshots update the active native context without requesting speech. Revoked memory sources, privacy changes or a transcript reset invalidate the call; reconnect to obtain a permitted snapshot. These checks run locally and add no model call when a confirmed profile value is already available.

The confirmed identity checkpoint follows quoted history, so historical assistant guesses cannot take the last position in the restored instructions. Native voice transcript rows also participate in the existing background learning queue as logical user/assistant evidence. Stored rows and evidence identifiers are preserved; interrupted assistant text uses the shared omitted-reply projection. Recovery uses canonical routing defaults for owner conversations with empty routing JSON, while keeping owner, scope, consent and write-policy checks. Learning remains off the response path and follows the configured idle interval and review policy.

## Natural voice actions

Action-capable realtime routes advertise `agent_execute`, `agent_task_status`, `agent_cancel` and `chat_publish`. Higgs supports these tools; compatible direct Qwen 3.5/3.8 realtime routes and hosted manifests with `voice.tools=true` also enable them. Older models and hosted routes advertising `tools=false` retain the no-action instruction and do not receive function schemas.

Only completed function calls from a successful response execute, after turn commitment and transcript persistence. Tool-call ids are deduplicated, and identical task submissions in one user turn share a single durable input. The broker supplies the existing conversation/transcript identity and per-voice execution policy. The original native transcript is recorded once; the generated delegation instruction and Agent execution are retained as hidden source-tagged entries, never as direct owner statements. Full tool output is not copied into the realtime context.

Submission returns a task id and running status without waiting for completion. Background event delivery owns task progress and the terminal outcome; playback cancellation does not abort it. Closing a call detaches delivery; terminal task publications persist independently. Redial restores running voice tasks under the same conversation and transcript. Explicit cancellation is scoped to these owned tasks and cannot undo already-completed effects. Status reads do not start another Agent turn. Approval questions are rebound to the next spoken response for existing native clients; approval still uses the existing explicit controls.

Completed results enter the realtime session as bounded, quoted reference data and request a new spoken response only when current playback and user speech have settled. They are not resubmitted as Agent instructions. Status is scoped to the Agent turn: its completion does not by itself prove the user's objective succeeded; the actual result and its limitations remain authoritative. Errors, suspension and unknown delivery outcomes are reported distinctly from success. Each call retains at most 256 function calls and 32 submitted tasks; result text is capped at 8000 characters per task.

## Selective Chat and automatic routing

Clients normally omit `mode`. Global `voice.realtime.defaultEngine=auto` and Ada's optional `enginePreference=auto` choose an available action-capable native engine before dialing, otherwise the Agent engine. Explicit advanced overrides retain `agent`/`omni` globally and `assistant`/`natural` on session requests. No mid-call engine migration is attempted.

Raw native speech uses hidden `voice_omni_transcript` rows; voice Agent execution uses `metadata.voiceConversation`. UI history, display indices and Chat pagination omit these while model context, exports and permitted learning retain the evidence. Internal delegated instructions are excluded from owner identity evidence and native history reconstruction. No second visible conversation or database migration is introduced.

`chat_publish` creates an assistant `voice_chat_message`, with conversation/transcript-scoped deterministic identity. Retries do not duplicate content and late results cannot write after reset. Native delegated results publish from the durable Agent finish path even after hangup. Fallback Agent task results also publish when a real tool ran, unless useful content was already published. Small talk does not auto-publish. Voice run events use a private `voice-run:<runId>` topic, while global completion refreshes Chat. Already composed background personal replies can be offered to native playback without another Agent turn.

Shared Chat updates are locally coalesced and injected as quoted reference data, without `response.create`; this does not execute historical requests. Native publication receipts request speech only when no audio accompanied the original response. Selection runs inside the conversational model rather than a separate blocking summarizer.

## Measuring the 1.5-second target

Use `node --import tsx/esm scripts/benchmark-voice-latency.mts PCM16_16KHZ_FILE AGENT_ID ROUNDS` against a running gateway. It creates and cleans up a disposable conversation by default. The optional fourth argument uses an existing conversation and appends real turns: use a database snapshot for comparisons involving Ada's actual history. Existing conversations are never deleted by the benchmark.

The fixture is paced at 20 ms and its final voiced PCM frame anchors the clock, so recognition endpoint waiting is included. Silence continues to feed the recognizer while waiting. Output includes endpoint, commit, model and TTS delays and nearest-rank p50/p95. Playback ACKs are simulated; results measure audio receipt, not physical speaker output. Small sample percentiles do not establish a production SLO. Cold starts, failures, interruptions and real devices require separate acceptance.

The benchmark defaults to automatic routing. Set `XOPC_VOICE_BENCHMARK_MODE=natural` and optionally `XOPC_VOICE_BENCHMARK_BACKEND=higgs` for native conversation. Set `XOPC_VOICE_BENCHMARK_ACTION=1` for a task fixture: the benchmark waits for task completion and subsequent result audio, and reports speech-end-to-task-submission and speech-end-to-task-completion separately from first audio. Use only explicitly harmless test actions. The script cancels unfinished diagnostic tasks on failure. `native_response_created`, `native_transcript_confirmed`, `native_audio_received`, `natural_task_submitted` and `natural_first_audio` logs distinguish native generation, confirmation, upstream audio and local forwarding. The accepted Higgs endpoint is 180 ms; two 120 ms experiments dropped valid turns and were rejected. Confirmation has a 1500 ms availability deadline, not a fixed delay. Current live samples do not establish the 1500 ms goal; see the [measurement report](../design/ada-voice-latency-20261107.md).

Gateway logs record `first_response_text`, `first_speech_phrase`, `response_tts_ready`, `first_synthesis_requested`, `first_tts_text_submitted` (prepared routes), and `first_response_audio`. Compare `textToPhraseMs`, `phraseToSubmitMs`, and `submitToAudioMs` for the same `responseId` to distinguish segmentation, connection waiting and synthesis. The DashScope transport also records `setupMs` and `synthesisMs`.

Web/desktop clients report `speech_end_to_audio_received` and `speech_end_to_audio_scheduled`. The latter includes the AudioContext scheduling delay; it is an estimated start time, not a measurement of physical speaker output. Compare cold and subsequent replies using p50/p95, and test interruption and audible continuity alongside latency. Automated fake-provider tests verify ordering and cleanup; actual provider/network latency requires live calls.

Native clients also report `speech_end_to_audio_buffered`: the first frame accepted by AudioTrack (Android), scheduled on AVAudioPlayerNode (iOS), or written to AudioRenderer (HarmonyOS). This measures application queuing and playback submission, not physical speaker output. New metrics are advertised by the existing voice preflight endpoint; updated clients omit them when connecting to an older gateway. Legacy receipt timing remains available.

Android requests low-latency AudioTrack playback and, on API 31+, a one-frame (20 ms) start threshold while retaining its existing buffer capacity. iOS requests a 10 ms audio I/O buffer, a 20 ms capture tap, and reuses the playback format; actual hardware buffering depends on the route. HarmonyOS reads microphone data in 20 ms chunks rather than waiting for a larger hardware buffer. These preferences require real-device checks with speaker, headset and Bluetooth routes to measure the actual latency and continuity.

[Return to the voice guide](../voice.md).
