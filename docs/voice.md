# Voice input and replies

xopc can turn voice messages into text (speech-to-text, or STT) and assistant replies into audio (text-to-speech, or TTS). Availability depends on the selected provider and client.

## Realtime calls

A Chat keeps one conversation across text and repeated calls. Click **Voice call** in Chat to connect immediately using the saved default. **Current assistant** retains Agent tools; **Native voice · no tools** is an explicit alternative under Voice service settings. Hanging up, reconnecting, or changing voice modes keeps the same Chat and its saved history. Only an explicit new Chat or reset starts a new conversation.

The call has its own window. Minimize it to keep talking while visiting other pages. **Mute microphone** disables capture upload and discards unfinished input while assistant playback continues; **End call** releases the microphone. Dictation buffers text until **Finish**, applies the configured cleanup, and inserts an editable draft without sending. **Cancel** leaves the original draft untouched, including cancellation during cleanup. Finalized text remains recoverable after a disconnect. The same Chat cannot run a text response and a call simultaneously.

Choose **XOPC hosted** or **Your API key** once under **Settings → Capabilities → Voice**. This configures dictation, Agent speech and natural conversation together, without changing ordinary message readout. Natural voice defaults to the shared input credential; independent endpoints, keys and instructions are optional advanced settings. If setup is missing, the call window links to Voice settings, with a return link to the original Chat. Capability validation precedes microphone permission; it does not prove a live provider connection will succeed.

Natural chat uses `qwen3-omni-flash-realtime`. Each connection restores the selected Agent's configured name/instructions and a bounded text projection of the same Chat's history. It has no tools. Older context may be excerpted; full records remain in Chat. Interrupted generated replies remain visible in records, but are omitted from subsequent model context because the exact portion heard is unknown.

Use the composer’s call button to start or continue voice in the same Chat. Network failure, a call time limit or a page reload ends the connection; start again to continue the conversation. Minimize/route navigation does not end it. There is no silent microphone reopening or automatic indefinite connection renewal.

Hosted natural calls require a published conversation route on XOPC Platform. Gateway and renderer must both support protocol v2. The platform relay must also accept `input_audio_buffer.clear`; ship its matching change before enabling the updated hosted client. See the [technical design](./design/realtime-voice-technical-design.md) and [delivery review](./design/persistent-voice-delivery.md) for implementation and verification limits.

## Where else voice works

- Web and desktop Chat can transcribe supported audio attachments.
- Telegram can transcribe voice notes and send audio replies when configured.
- Other channels may support one or both directions depending on their media capabilities.
- An Agent can create speech with the voice tool when TTS is enabled.

## Configure speech-to-text

### Realtime dictation and conversation

Open **Settings → Capabilities → Voice** and choose **XOPC hosted** or **Your API key** (Alibaba Qwen). Hosted voice requires a signed-in account and available realtime models. For Alibaba, dictation and conversation share the input credential; existing Edge message readout stays unchanged.

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

Voice uploads use `POST /api/voice/transcriptions` with multipart form data. WAV, WebM/Opus, Ogg/Opus, MP3, and MP4/M4A are accepted. The local provider reads PCM WAV directly and normalizes other containers to mono 16 kHz PCM with `ffmpeg`; install `ffmpeg` on the gateway host when using compressed input with local STT. If the binary is outside `PATH`, set `XOPC_FFMPEG_PATH` to its absolute path and restart the gateway. The official Docker image includes `ffmpeg`.

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

xopc can use supported cloud speech providers and configured local speech extensions. Cloud providers process audio according to their own policies and may charge per use. A local provider keeps processing on your device but requires compatible software and models.

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
| Local STT reports that the decoder is unavailable | Install `ffmpeg` on the gateway host, or upload PCM WAV |
| A long discussion is still finalizing | Keep the gateway running; saved segments and the original recording resume from durable state |
| Transcript uses the wrong language | Set the provider language when available or choose a more suitable model |
| Text replies work but audio replies do not | TTS is enabled and its trigger matches the current message |
| Telegram voice fails | Local Chat voice works first, then check the Telegram channel logs |
| Long replies are cut off | Shorten the response or increase the configured text limit within provider limits |

Use **Settings → Logs** or `xopc logs tail` to find the first provider error. Never share recordings or credentials in a support report unless you intend to disclose their contents.

## Interaction and validation

**Stop reply** clears playback and cancels the current response, invalidating queued and unfinished input. It does not send a message or undo completed tool actions. Tool progress and explicit clarification/connector approval controls appear in the call. Ambient speech does not answer a pending clarification. Calls opened from a task retain its existing task status and detail link.

The saved default is `voice.realtime.defaultEngine` (`agent` by default, or `omni`). A session creation request may omit `engine` to use it. Active calls keep their original route.

Run `node scripts/voice-browser-smoke.mjs` for production-component checks with Chrome synthetic microphone input and a fake gateway. Set `XOPC_VOICE_SMOKE_BROWSER` to another Chrome/Chromium executable if needed. This does not measure real acoustic quality. See [delivery and audio acceptance](./design/voice-experience-delivery.md).
