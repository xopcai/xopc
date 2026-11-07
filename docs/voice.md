# Voice input and replies

xopc can turn voice messages into text (speech-to-text, or STT) and assistant replies into audio (text-to-speech, or TTS). Availability depends on the selected provider and client.

## Call or dictate

Use **Voice call** to talk with Ada in the current conversation. The Gateway automatically chooses an action-capable realtime voice engine when configured, with the existing recognition → Agent → synthesis engine as the compatible fallback. Engine overrides, models and voices remain under advanced call settings; choosing an engine is not a required dialing step. **Dictation** remains separate: it creates an editable draft without sending it.

## Realtime calls

Repeated calls share the same conversation, confirmed user profile, Ada persona, memory permissions and bounded recent context. Everyday speech and tentative expressions stay in a hidden voice stream; they do not appear sentence by sentence in main Chat. Ada can place substantial explanations, settled decisions, useful drafts and explicitly requested content in Chat as natural assistant messages. Actual delegated task results are retained independently of the call connection. There is no required call card or end-of-call summary.

The hidden stream remains in SQLite for context continuity and permitted memory learning. It is not automatically deleted, and normal Chat pagination excludes it. A reset starts a new transcript; late publications cannot cross the reset. Interrupted generated speech is not treated as a reply the user fully heard. Typed Chat updates are synchronized into an active native call as quoted context, without replaying requests as new actions.

Configure voice in **Settings → Capabilities → Voice**. For Higgs, configure the Boson key and select Higgs as the natural voice model. Ada's **Edit profile → Voice calls → Advanced call settings** can override the automatic engine, model and voice. Service capability checks precede microphone permission; they cannot prove a live provider connection will succeed.

Ada delegates explicit actions to the existing Agent, retaining its tools, permissions and on-screen approval controls. A task runs while conversation continues, and Ada reports the actual result during a quiet gap. Stopping speech and cancelling execution are separate actions. Hanging up does not cancel work: its result remains in Chat, and redialing restores running voice tasks in the same transcript. Cancellation cannot undo already completed effects. Ordinary speech cannot approve a pending permission request.

The call has its own window. Minimize it to keep talking while visiting other pages. **Mute microphone** disables capture upload and discards unfinished input while assistant playback continues; **End call** releases the microphone. Dictation buffers text until **Finish**, applies the configured cleanup, and inserts an editable draft without sending. **Cancel** leaves the original draft untouched, including cancellation during cleanup. Finalized text remains recoverable after a disconnect. An automatic native call can begin while an existing Agent task is running; the fallback Agent engine still requires the execution lane to be available.

Choose **XOPC hosted** or **Your API key** once under **Settings → Capabilities → Voice**. This configures dictation, Agent speech and natural conversation together, without changing ordinary message readout. Natural voice defaults to the shared input credential; independent endpoints, keys and instructions are optional advanced settings. If setup is missing, the call window links to Voice settings, with a return link to the original Chat. Capability validation precedes microphone permission; it does not prove a live provider connection will succeed.

With your Alibaba key, natural chat uses the configured compatible realtime model. XOPC Cloud uses the catalog’s public realtime service and available voices. Connections restore the selected Agent's configured name/instructions and a bounded text projection of the same Chat's history. Higgs and compatible Qwen 3.5/3.8 realtime routes can delegate actions to the existing Agent; hosted routes enable actions only when their published manifest advertises tools. Other routes remain conversational. Older context may be excerpted; full source rows remain stored. Interrupted generated replies are omitted from subsequent model context because the exact portion heard is unknown.

Action-capable natural calls expose task execution, status, cancellation and selective Chat publication to the realtime model. The Agent retains its existing tools and approval rules. A task returns an accepted status before completion, continues while you talk, and sends its result back for spoken reporting during a quiet gap. Interrupting playback or ending the call does not cancel execution. Say explicitly that you want to cancel the task, or use **Cancel task**. Cancellation cannot undo completed actions. Approval questions retain their explicit on-screen controls; ambient speech is not approval.

Use the composer’s call button to start or continue voice in the same Chat. Network failure, a call time limit or a page reload ends the connection; start again to continue the conversation. Minimize/route navigation does not end it. There is no silent microphone reopening or automatic indefinite connection renewal.

Hosted natural calls require a published conversation route on XOPC Platform. Gateway and clients must all support protocol v3. See the repository's [protocol](https://github.com/xopcai/xopc/blob/main/docs/design/realtime-voice-websocket-protocol.md), [mobile technical design](https://github.com/xopcai/xopc/blob/main/docs/design/mobile-voice-technical-design.md), and [delivery review](https://github.com/xopcai/xopc/blob/main/docs/design/mobile-voice-technical-design.md) for implementation and verification limits.

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

Calls have one product entry. Session requests normally omit `mode` for automatic engine selection (`voice.realtime.defaultEngine=auto`). Advanced overrides retain `assistant` and `natural` for compatibility. Active calls keep their selected engine until reconnecting.

Run `node scripts/voice-browser-smoke.mjs` for production-component checks with Chrome synthetic microphone input and a fake gateway. Set `XOPC_VOICE_SMOKE_BROWSER` to another Chrome/Chromium executable if needed. This does not measure real acoustic quality. See [delivery and audio acceptance](https://github.com/xopcai/xopc/blob/main/docs/design/mobile-voice-technical-design.md).

## Technical reference

See [Voice runtime reference](./reference/voice-runtime.md) for latency metrics, segmentation, and connection preparation.
