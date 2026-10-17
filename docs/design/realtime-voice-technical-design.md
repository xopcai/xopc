# Persistent voice technical design

Updated: 2026-09-11. See [product contract](./realtime-voice-prd.md) and [protocol v3](./realtime-voice-websocket-protocol.md).

## Ownership

`VoiceCallProvider` lives above route content in `AppShell`. Its target is an existing Chat `sessionKey`; its state owns the shared realtime hook and expanded/minimized surface. Composer dictation uses the same capture implementation independently. A module-level capture owner rejects competing microphone requests. The old composer-owned conversation hook and controls were removed rather than wrapped.

The transport's `sessionId` is a call connection identifier. It must not be used to create another Chat Session. The existing Chat metadata `sessionId` is frozen when a call ticket is issued and is checked when reading context or appending native transcript entries. Reset and deletion retain their existing reservation checks. Project preparation may create its initial Chat once before opening a call.

## Startup and cleanup

1. Resume the playback AudioContext from the user action.
2. `POST /api/voice/realtime/preflight` validates configuration, routes and Chat availability without opening an upstream socket or reserving the Chat.
3. Acquire microphone permission and stream. Issue the connection ticket through `/sessions`; the server reserves the Chat under its existing model-config lock.
4. Negotiate protocol v3 and authenticate the socket. For natural voice, load and freeze the current canonical context before opening the upstream connection.
5. Start PCM capture. Attempt tokens and an AbortController fence permission, connection and recorder completions after cancellation. Never flush a late recorder's pending samples.
6. On shutdown, abort the engine, await Agent cleanup and pending transcript/interruption writes, then release the reservation. Unexpected renderer disconnect uses the same cleanup path.

Microphone mute disables input tracks, gates capture callbacks and discards partial encoder frames. A bounded synthetic silence tail closes an in-flight server-VAD utterance; no muted microphone samples are uploaded. Playback remains enabled. Audio output acknowledgements and response IDs retain the existing interruption/backpressure protocol.

Stopping playback only discards queued audio for that response; it does not cancel durable Agent work. Explicit task cancellation is a separate control. Fresh speech can start a new turn while stale recognition results are fenced by the connection epoch and utterance sequence.

## Conversation endpoints and continuation

Provider `speech_stopped` and final transcription events mark an ASR segment, not necessarily a completed user turn. `TurnPolicy` waits for every started segment to finish transcription, joins segments in speech-start order, invalidates pending semantic decisions whenever speech resumes, and applies a bounded fallback when the semantic decision times out. Dictation retains its explicit commit behavior.

The default provider silence window is 1,200 ms; the pacing choices are 800/1,200/2,000 ms. Existing explicit values remain explicit values. Conversation completion also has a 1,200 ms minimum silence target and at least a 350 ms transcription-settling window. Conservative Chinese/English continuation hints (for example, “帮我查一下”, “因为”, “could you”, and ellipses) extend the post-provider-endpoint hold to 1,800 ms. This is a bounded lexical heuristic, **not** model-level semantic VAD. No silence timeout releases a turn while a started segment is still being spoken or awaits its final transcript.

- Assistant mode submits one durable Agent task with the combined text after the endpoint settles. Disconnecting or stopping playback only detaches voice output; only explicit task cancellation aborts the Agent run.
- Natural mode retains the certified Qwen3 server-VAD protocol. A response may be generated upstream, but its text, audio and completion are withheld until the turn settles. Continuation discards an unpublished reply without showing it or writing an assistant transcript. User segments retain their provider item IDs and remain in upstream conversation context. Existing audio queue limits still apply while output is withheld.
- Assistant-mode barge-in requires a non-empty final transcript before stopping audible playback. Bare server-VAD events and partial ASR hypotheses are insufficient because ambient noise and imperfectly cancelled speaker output can trigger them and partial text may later disappear. This is an evidence gate, not semantic noise/backchannel classification.
- Mute, manual stop, congestion reset and close invalidate pending endpoints and release discarded output waiters. A native transcription failure discards the uncertain input and reports a recoverable error rather than leaving the reply waiting indefinitely.

Do not switch the current certified Qwen3 model to Qwen3.5-only semantic VAD or depend on `create_response: false` without separately certifying the model and relay. The configured hosted route acknowledged the existing automatic-response configuration during testing, but did not acknowledge the manual-response configuration. No protocol fallback or model migration is included here. Unheard generated native content may still exist inside the current provider session; deleting/truncating that provider-side history is not certified.

Live output verification (2026-09-19): session acknowledgement alone does not certify reply generation. A synthetic 16 kHz PCM greeting was transcribed by `qwen3-omni-flash-realtime` through both the hosted route and direct DashScope, but no response-start event arrived; a hosted call remained silent for more than 75 seconds. Directly requesting a response reported an already-active response. The same local engine and input completed twice through the hosted `stepaudio-3-realtime-preview` route with text and nonempty PCM output. These observations describe the tested service state, not a permanent model limitation. The engine now closes with `OMNI_RESPONSE_START_TIMEOUT` if a committed turn receives no response-start event within 30 seconds, including the platform request reference for diagnosis. `scripts/probe-omni-output.ts` exercises live output with caller-provided synthetic PCM and simulated playback acknowledgements; it does not certify physical speaker playback or change saved configuration.

## Shared conversation context

Natural-mode final speech remains a `voice_omni_transcript` custom transcript entry with its actual speaker role and call/item IDs. `voiceTranscriptMessage` projects it into an ordinary user or assistant message. Both `buildSessionContextForLlm` and `storedRowsToFileEntries` use that projection, so direct context reads and the real embedded Agent hydration path agree. There is no separate memory database or turn-end transcript rewrite.

An interrupted assistant row remains visible for audit, but its generated words are replaced by a clear interruption marker in model input. Invalid speaker roles are rejected. The synthetic assistant projection carries zero usage because it is historical context, not a new billed Agent request.

Natural-mode startup instructions include the selected Agent's configured name/custom instructions, concise spoken behavior, the no-tools boundary and JSON-quoted history. Hidden reasoning and tool results are excluded. Recent user/assistant text gets most of the available space; earlier turns get explicitly incomplete excerpts. The entire instructions value stays within the existing platform relay's 8,000-character envelope. Excessive custom instructions fail with guidance to shorten them instead of silently discarding conversation history.

This design uses `session.instructions` in the initial `session.update`. It does not inject unsupported conversation items, repeatedly update a locked relay session, or invent a provider resume token. Alibaba's [client-event reference](https://www.alibabacloud.com/help/en/model-studio/client-events) documents initial instructions; its current conversation-item support is insufficient for arbitrary historical user/assistant item injection. The bounded quoted context is an application-level continuation, not transport replay.

Natural voice does not hydrate the full Agent tool/system prompt or every profile Markdown file. It receives configured identity/instructions and visible conversation history. Exact heard-offset truncation inside an already-open provider session is not certified; the interruption marker applies to subsequent restored context.

## Transcript metadata

Calls persist conversation content, with no separate lifecycle journal or history endpoint. Previously stored `voice_call` metadata remains excluded from Chat display, canonical LLM projection and embedded hydration.

## Service setup

`configureRealtimeService` is shared by Settings and the call's first-use form. It enables input, realtime output and native voice for the selected service. It preserves ordinary message-readout settings and existing credentials. Re-enabling the same service preserves advanced overrides; changing services clears incompatible native overrides. Native direct credentials resolve from explicit native override, then shared Alibaba input key, then the existing DashScope credential service. Secrets remain on the gateway; ticket responses expose only safe route metadata.

No automatic engine fallback, old hook alias, second transcript writer, new memory hierarchy or legacy protocol adapter is introduced.

## Verification limits

See [delivery review](./persistent-voice-delivery.md) for executed checks. Synthetic browser audio and local mocked WebSockets cannot establish real microphone permissions in packaged Electron, echo cancellation, perceived latency, paid-provider availability or platform billing correctness. This change does not modify or deploy xopc-platform.

On 2026-09-07 the updated native engine was also exercised against the configured XOPC hosted Qwen3 route using 16 kHz mono synthetic PCM, the existing 700 ms setting, and a 1.1-second inserted pause. “Could you” followed by “tell me what two plus two is?” and “帮我查一下” followed by “明天下午去上海的高铁” each produced two final user segments but only one published assistant reply, after continuation finished. Neither test published early text/audio or reported a session error. The harness received and acknowledged 526,080 / 1,032,960 PCM output bytes respectively. Acknowledgements here are synthetic, not evidence of phone speaker playback. These checks did not deploy the gateway at `xl.xopc.ai`, use a physical microphone, or repeat the iOS/Android simulator suite.

## Echo handling and audible interruption

The 2026-10-08 Web fix removed microphone-RMS ducking (gain 1.7→0.255), which could attenuate playback in response to its own speaker echo without a server cancellation. Microphone RMS updates the meter; playback stops on server-confirmed cancellation or explicit Stop reply. Existing browser echo cancellation, noise suppression and gain control remain enabled.

Assistant and natural interruption require finalized, non-echo transcription. Speech-onset playback text is retained for up to 30 seconds and 256 candidates, beyond the normal three-second playback tail, to classify delayed ASR. Final transcription consumes each candidate; reset, mute, failure and close clear it. Cancellation refreshes the recent playback tail. Final-ASR gating trades latency for fewer false interruptions; exact repetition of assistant text remains ambiguous.

The production React/worklet/resampler/protocol/WebAudio browser harness with an isolated simulated Gateway and loud synthetic microphone WAV failed on the old hook (`Speaker echo ducked assistant playback`) and passed after the fix. It checks uplink, unattenuated acknowledged output, no unsolicited stop, manual stop, mute, navigation, narrow layout, clarification and dictation. Engine tests cover delayed/imperfect echo, completion, cancellation and genuine interruption; local native WebSocket providers are deterministic.

```sh
XOPC_LOG_LEVEL=fatal pnpm exec vitest run web/src/features/voice/realtime/__tests__ src/voice/realtime/__tests__ --exclude '**/*.live.test.ts'
node scripts/voice-browser-smoke.mjs
pnpm -C web run type-check
pnpm run typecheck
```

Set `XOPC_VOICE_SMOKE_BROWSER` to the Chrome executable if needed. Historical type/lint checks passed. This simulated-media validation does not establish physical-speaker echo cancellation, Bluetooth switching, Safari support, live provider availability or sustained-call acoustics. Those remain separate acceptance cases, including Chinese/English interruption and delayed transcription.

Reference approaches retained from the investigation: [LiveKit echo cancellation](https://docs.livekit.io/transport/media/noise-cancellation/), [LiveKit turn taking](https://docs.livekit.io/agents/logic/turns/tuning/), and [OpenAI realtime conversation handling](https://developers.openai.com/api/docs/guides/realtime-conversations).

## Durable voice input identity and missing replay

ASR turn numbers restart across calls. The old `voice:<transcriptId>:<turnId>` identity could deduplicate a new utterance to an earlier completed run; after Gateway restart its in-memory terminal replay might be missing, leaving the phone thinking indefinitely. Agent voice inputs use `voice:<transcriptId>:<voiceSessionId>:<inputGeneration>:<turnId>`: retries within a call stay stable while new calls and resets remain distinct. System task updates keep their stable delivery identity.

A terminal input without a terminal event in the subscribed history is rejected through recoverable engine error handling, finishing the response instead of waiting forever. Playback cancellation does not cancel durable Agent work.

Historical verification on 2026-10-09: broker/interruption suites 30 tests and engine/runtime/media/playback suites 21 tests passed, with root typecheck and Node build. A focused server hotfix on Gateway 0.0.363 at `qm.xopc.io` backed up the installed modules under `/var/lib/xopc/voice-hotfix-20261009`, restarted the Gateway and received HTTPS health 200; it did not clear database or phone state and was not an npm release. Regular releases must include the source repair rather than overwrite it.

The existing Harmony installation rejoined with new call UUIDs in durable IDs and three completed Agent runs. Two replies reported completed buffered/played durations of 4,800/4,080ms; another queued behind playback. These demonstrate phone event/renderer progress, not independently measured subjective acoustics. Speech-stop→first-audio was 6,629/4,948ms; receipt→buffer 47/29ms and receipt→first playback progress 149/55ms. Two samples are not a baseline or SLO; most observed delay preceded client receipt and excluded provider endpoint latency.

## Platform voice failure and recovery evidence, 2026-10-12

This section records the Loopi investigation's historical fixes and acceptance scope. It does not describe a new deployment.

- Initial Harmony logs showed zero buffered/played output and `Platform voice disconnected before completion`. An authenticated public TTS v5 probe closed after 1,680ms with 1011 and zero audio. This located the failure before phone rendering; it did not prove a renderer defect.
- Independently, persisted Personal final replies were connected to the active assistant voice synthesis queue and playback acknowledgements without another Agent run or duplicate chat reply. Busy calls defer through the result outbox; delivery IDs deduplicate within a call. Failure before output is retryable, but interrupted output already submitted is consumed to avoid repeated speech. The outbox lease lasts until asynchronous delivery resolves; text delivery stays available. Bounded provider close codes/reasons are retained for diagnostics.
- Initial regressions: 243 passed/one live test skipped after serial rerun of a transient local handshake 404; asynchronous lease regression passed; Harmony playback/transport/recovery 39 passed. Typecheck and diff checks passed. These did not by themselves repair cloud TTS or establish physical audibility.

### Platform repair and its STT regression

Production diagnostic `445fb14a-2640-47a0-b83a-809674253f9d` located TTS failure at upstream setup after authorization/quota. The selected unvalidated `qwen3-tts-instruct-flash-realtime` returned close 1007, `Model not exist.` Another Qwen route hit capacity; validated StepFun `stepaudio-2.5-tts` produced 108,480 PCM bytes.

Platform main commits `831d3e4` and `3fd7082` were deployed: require validated realtime routes, retain supplier diagnostics and try up to three validated setup routes, five seconds each, before accepting input. One credit reservation and cancellation are preserved; submitted synthesis is not replayed. Prior source/bundles were backed up under `data/backups/realtime-tts-831d3e4` and `data/backups/realtime-tts-3fd7082`. Existing billing changes were preserved; route publication, prices and schema were unchanged.

Five public TTS v5 probes then completed with 98,880/83,520/127,680/96,960/120,000 PCM bytes in 3,679/3,046/2,911/3,410/2,931ms. Platform gateway tests recorded 253 passed/one skipped, plus 38 targeted primary-workspace regressions and typecheck. These were server probes, not phone acoustics.

Diagnostic `9d6c48c9-eb4f-494d-8a0d-5e50d4e67a9d` then exposed STT 503: the admission change also required STT validation, but no published STT route was validated. A silence-only validator wrongly required transcription. Deployed commit `4db1222` accepts successful STT negotiation and normal silent finalization, still rejects premature close and still requires TTS audio. This validates negotiation, not recognition accuracy.

A separate real-speech probe of `qwen-audio-3.1-asr-flash-streaming` recognized `请只回答你好。` and finalized. Only that tested model's validation status changed. Its original row/probe backup is `data/backups/stt-validation-20261012.json`; source/bundle backup is `data/backups/stt-probe-4db1222`. Credentials, publication and prices were retained.

### End-to-end evidence and remaining acceptance

- `scripts/probe-gateway-voice-e2e.ts`: three real utterances, final transcripts, Agent replies (`你好。`) and completed non-silent responses, totaling 198,720 PCM bytes. Playback ACKs were simulated; disposable conversations were deleted.
- `scripts/voice-browser-live.mjs`: production React/worklet/WebAudio in headless Chrome with speech WAV input, actual Gateway/cloud STT/Agent/TTS and no mocked audio or responses. Observed 857 uplink frames, 85,739 downlink wire bytes and 83 scheduled buffers (54 nonzero); one transcript/reply completed, then the test hung up and removed its temporary conversation.
- Final platform suite: 256 passed/one skipped; primary STT/lifecycle 22 passed, typecheck/diff and public health passed. The browser harness was corrected to resolve Vite from `web/`; the multi-turn harness reset sequence counters per utterance before the passing runs.

These later results supersede the initial upstream-blocked status and establish recognition, execution, synthesis and browser playback scheduling. They do not certify physical speaker audibility, a new Harmony acceptance run or long-call stability. Existing unresolved device-entry investigation remains in [Harmony voice authentication investigation](./harmony-voice-auth-investigation-20261015.md).
