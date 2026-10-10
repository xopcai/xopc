# Voice input and replies

xopc can turn voice messages into text (speech-to-text, or STT) and assistant replies into audio (text-to-speech, or TTS). Availability depends on the selected provider and client.

## Realtime calls

A Chat keeps one conversation across text and repeated calls. Click **Voice call** in Chat to connect immediately using the saved default. **Current assistant** retains Agent tools; **Native voice · no tools** is an explicit alternative under Voice service settings. Hanging up, reconnecting, or changing voice modes keeps the same Chat and its saved history. Only an explicit new Chat or reset starts a new conversation.

In **Current assistant** calls, delegated Task questions and selected results can become a separate Agent reply during a quiet gap. Routine progress stays on the Task card. A user utterance takes priority, and an interrupted update remains in the Chat record. Native voice does not run this Task update path.

The call has its own window. Minimize it to keep talking while visiting other pages. **Mute microphone** disables capture upload and discards unfinished input while assistant playback continues; **End call** releases the microphone. Dictation buffers text until **Finish**, applies the configured cleanup, and inserts an editable draft without sending. **Cancel** leaves the original draft untouched, including cancellation during cleanup. Finalized text remains recoverable after a disconnect. The same Chat cannot run a text response and a call simultaneously.

Choose **XOPC hosted** or **Your API key** once under **Settings → Capabilities → Voice**. This configures dictation, Agent speech and natural conversation together, without changing ordinary message readout. Natural voice defaults to the shared input credential; independent endpoints, keys and instructions are optional advanced settings. If setup is missing, the call window links to Voice settings, with a return link to the original Chat. Capability validation precedes microphone permission; it does not prove a live provider connection will succeed.

With your Alibaba key, natural chat uses the configured compatible realtime model. XOPC Cloud uses the catalog’s public realtime service and available voices. Each connection restores the selected Agent's configured name/instructions and a bounded text projection of the same Chat's history. It has no tools. Older context may be excerpted; full records remain in Chat. Interrupted generated replies remain visible in records, but are omitted from subsequent model context because the exact portion heard is unknown.

Use the composer’s call button to start or continue voice in the same Chat. Network failure, a call time limit or a page reload ends the connection; start again to continue the conversation. Minimize/route navigation does not end it. There is no silent microphone reopening or automatic indefinite connection renewal.

Hosted natural calls require a published conversation route on XOPC Platform. Gateway and clients must all support protocol v3. See the repository's [protocol](https://github.com/xopcai/xopc/blob/main/docs/design/realtime-voice-websocket-protocol.md), [mobile technical design](https://github.com/xopcai/xopc/blob/main/docs/design/mobile-voice-technical-design.md), and [delivery review](https://github.com/xopcai/xopc/blob/main/docs/design/voice-experience-delivery.md) for implementation and verification limits.

## Where else voice works

- Web and desktop Chat can transcribe supported audio attachments.
- Telegram can transcribe voice notes and send audio replies when configured.
- Other channels may support one or both directions depending on their media capabilities.
- An Agent can create speech with the voice tool when TTS is enabled.

## Configure speech-to-text

### Realtime dictation and conversation

Open **Settings → Capabilities → Voice** and choose **XOPC hosted** or **Your API key** (Alibaba Qwen). Hosted voice requires a signed-in account and available speech/realtime services. Voice names follow the display language; select from the current catalog rather than copying a supplier voice ID. For Alibaba, dictation and conversation share the input credential; existing Edge message readout stays unchanged.

Choose a conversation voice, then use **Test voice**. The test opens the microphone only after a click, displays a real final transcript, plays a fixed sample through the native streaming speech provider, and asks you to confirm that you heard it. It does not create a chat or call an Agent. **Not tested** means a route is configured, not that a live connection has succeeded. Testing may incur provider usage. When only input is configured, use **Test dictation**.

After testing, open Chat and use the microphone for dictation or the call button for voice conversation. Voice assistant mode also requires a working Agent model. **Read messages aloud** controls ordinary message readout separately. Settings are grouped into **Speaking & listening**, **Input & display**, **Audio devices**, **Voice service**, and **Troubleshooting**. Voice/pacing/language are listening preferences; cleanup and message readout are input/display options; providers and fallback live under service. Captions and microphone selection are saved on this browser; output follows the system device.

### Audio attachments and message channels

In the Gateway console, open **Settings → Capabilities → Voice**:

1. Open **Voice service → Technical settings** and enable speech-to-text.
2. Choose a provider and model.
3. Add the provider credential if it is not already configured.
4. Save and upload a short test recording in Chat.

The setup is working when the message shows an accurate transcript and the Agent answers the spoken request.

### Audio input contract

Voice uploads use `POST /api/voice/transcriptions` with multipart form data. WAV, WebM/Opus, Ogg/Opus, MP3, and MP4/M4A are accepted. Provider extensions receive the same audio input contract and can adapt it to a user-managed local or OpenAI-compatible transcription service.

Discussion capture keeps the compressed original recording as recoverable evidence and sends speech-aware WAV segments for live text. Segments close on a pause after at least four seconds, are capped at fifteen seconds, and pure silence is skipped. If live text is incomplete, the original is decoded into bounded chunks and transcribed sequentially instead of loading a long recording into one STT request.

## Configure text-to-speech

1. Expand **Read messages aloud** on the same Voice settings page and enable text-to-speech.
2. Choose a provider, model, and voice.
3. Choose when audio is created:

| Mode | Behavior |
| --- | --- |
| Off | No automatic audio replies; the voice tool can still be used if enabled |
| Always | Convert eligible text replies to audio |
| Inbound voice | Reply with audio only after the user sends voice |
| Tagged | Create audio only when the response explicitly requests it |

**Inbound voice** is a good starting point because normal text conversations remain text.

## Provider choices

xopc can use supported cloud speech providers and configured speech extensions. STT is disabled by default, and xopc does not bundle a local inference engine or model manager. To keep transcription on your device, install an extension that connects to your own local or OpenAI-compatible service. Cloud providers process audio according to their own policies and may charge per use.

Use environment variables or the credential controls in the UI; do not put real keys into documentation examples. Exact configuration keys are listed in [Configuration reference](./reference/configuration.md).

## Test safely

- Start with a recording under 15 seconds.
- Speak clearly and avoid sensitive content during setup.
- Confirm the selected language and voice.
- Test in local Chat before relying on a messaging channel.
- Check usage limits before enabling automatic TTS for every reply.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Audio uploads but no transcript appears | STT is enabled, the file format is supported, and the provider credential is valid |
| A local STT extension rejects the audio format | Check the extension and local service format requirements |
| A long discussion is still finalizing | Keep the gateway running; saved segments and the original recording resume from durable state |
| Transcript uses the wrong language | Set the provider language when available or choose a more suitable model |
| Text replies work but audio replies do not | TTS is enabled and its trigger matches the current message |
| Telegram voice fails | Local Chat voice works first, then check the Telegram channel logs |
| Long replies are cut off | Shorten the response or increase the configured text limit within provider limits |
| A call reply stops while playing through speakers | Check voice interruption and response errors in Gateway logs. Verify microphone echo cancellation is available and try a headset to distinguish acoustic echo from an unexpected new response |

Use **Settings → Logs** or `xopc logs tail` to find the first provider error. Never share recordings or credentials in a support report unless you intend to disclose their contents.

## Interaction and validation

Calls allow a short continuation window before answering. The default response pacing uses 1,200 ms of provider silence; common unfinished Chinese/English phrases get additional waiting time. Resuming speech discards a reply that has not yet been shown or played. During audible playback, detected microphone activity first lowers the volume; a finalized user utterance can then interrupt when barge-in is enabled. Speech matching the current playback is ignored. Natural voice requests the next upstream reply only after the turn settles, so an unconfirmed detection cannot replace the current audio. With barge-in disabled, the next reply waits until playback is acknowledged. This is pause/continuation and playback-aware interruption handling, not full acoustic speaker identification. The policy runs on the gateway and applies to mobile, web and desktop; deploy the updated gateway for connected clients to receive it.

**Stop reply** immediately clears playback and detaches the current voice rendering. A durable Agent task continues in the Chat; use the separate **Cancel task** action to abort it. Neither action sends a new message or undoes completed tool effects. Tool progress and explicit clarification/connector approval controls appear in the call. Ambient speech does not answer a pending clarification. Calls opened from a task retain its existing task status and detail link.

Calls use the product modes **Current assistant** (`assistant`) and **Natural voice · no tools** (`natural`). Session requests may omit `mode` to use the configured default; clients cannot select an internal provider engine. Active calls keep their original mode.

Run `node scripts/voice-browser-smoke.mjs` for production-component checks with Chrome synthetic microphone input and a fake gateway. Set `XOPC_VOICE_SMOKE_BROWSER` to another Chrome/Chromium executable if needed. This does not measure real acoustic quality. See [delivery and audio acceptance](https://github.com/xopcai/xopc/blob/main/docs/design/voice-experience-delivery.md).

## First-audio latency

In Current assistant mode, Alibaba TTS prepares its WebSocket session in parallel with Agent generation and reuses that connection for the segments of one reply. Each subsequent segment waits for the provider's `response.done` boundary. Completing or interrupting a reply releases the connection; preparation sends no text. Other streaming providers keep their existing synthesis path unless they implement connection preparation.

The first complete sentence can be spoken immediately. If no sentence is ready after 300 ms, the gateway tries a short phrase boundary (comma or whitespace, after at least 12 characters), keeping the remaining text for later synthesis. It does not force a split inside a word, code block, table, incomplete link or inline code. A reply without a safe boundary still waits for more text or the end of the turn.

Gateway logs record `first_response_text`, `first_speech_phrase`, `response_tts_ready`, `first_synthesis_requested`, `first_tts_text_submitted` (prepared routes), and `first_response_audio`. Compare `textToPhraseMs`, `phraseToSubmitMs`, and `submitToAudioMs` for the same `responseId` to distinguish segmentation, connection waiting and synthesis. The DashScope transport also records `setupMs` and `synthesisMs`.

Web/desktop clients report `speech_end_to_audio_received` and `speech_end_to_audio_scheduled`. The latter includes the AudioContext scheduling delay; it is an estimated start time, not a measurement of physical speaker output. Compare cold and subsequent replies using p50/p95, and test interruption and audible continuity alongside latency. Automated fake-provider tests verify ordering and cleanup; actual provider/network latency requires live calls.

Native clients also report `speech_end_to_audio_buffered`: the first frame accepted by AudioTrack (Android), scheduled on AVAudioPlayerNode (iOS), or written to AudioRenderer (HarmonyOS). This measures application queuing and playback submission, not physical speaker output. New metrics are advertised by the existing voice preflight endpoint; updated clients omit them when connecting to an older gateway. Legacy receipt timing remains available.

Android requests low-latency AudioTrack playback and, on API 31+, a one-frame (20 ms) start threshold while retaining its existing buffer capacity. iOS requests a 10 ms audio I/O buffer, a 20 ms capture tap, and reuses the playback format; actual hardware buffering depends on the route. HarmonyOS reads microphone data in 20 ms chunks rather than waiting for a larger hardware buffer. These preferences require real-device checks with speaker, headset and Bluetooth routes to measure the actual latency and continuity.
