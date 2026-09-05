# Voice input and replies

xopc can turn voice messages into text (speech-to-text, or STT) and assistant replies into audio (text-to-speech, or TTS). Availability depends on the selected provider and client.

## Realtime calls

Enable realtime voice under **Settings → Capabilities → Voice**. On an existing Chat, choose **Voice assistant** (STT → Agent → TTS, with tools) or **Natural chat · no tools** (native Qwen audio), then start the call. The microphone button remains editable dictation.

Natural chat has separate settings on the same page. Choose XOPC Platform to use your existing XOPC login, or DashScope to use your own key / `DASHSCOPE_API_KEY`. The certified model is `qwen3-omni-flash-realtime`. It does not require STT/TTS configuration. Each call starts fresh and does not import Agent history.

For managed calls, a platform administrator must first configure **Models and routes → Conversation**, select an existing DashScope connection with a healthy key, explicitly set four token prices, and publish the route. **Debug audio → Natural conversation** tests that same relay. Missing usage requires manual reconciliation rather than an automatic refund.

End a call before changing engines. Mute silences the speaker, not the microphone. Interrupted transcripts can include generated text that was not played. Update the renderer and gateway together for protocol v2.

See the [voice PRD](./design/realtime-voice-prd.md) and [technical design](./design/realtime-voice-technical-design.md) for limits and verification boundaries.

## Where else voice works

- Web and desktop Chat can transcribe supported audio attachments.
- Telegram can transcribe voice notes and send audio replies when configured.
- Other channels may support one or both directions depending on their media capabilities.
- An Agent can create speech with the voice tool when TTS is enabled.

## Configure speech-to-text

### Realtime dictation and conversation

Open **Settings → Capabilities → Voice** and choose **XOPC hosted** or **Your API key** (Alibaba Qwen). Hosted voice requires a signed-in account and available realtime models. For Alibaba, dictation and conversation share the input credential; existing Edge message readout stays unchanged.

Choose a conversation voice, then use **Test voice**. The test opens the microphone only after a click, displays a real final transcript, plays a fixed sample through the native streaming speech provider, and asks you to confirm that you heard it. It does not create a chat or call an Agent. **Not tested** means a route is configured, not that a live connection has succeeded. Testing may incur provider usage. When only input is configured, use **Test dictation**.

After testing, open Chat and use its microphone for dictation or voice conversation. Conversation also requires a working Agent model. **Read messages aloud** controls ordinary message readout separately. **Advanced settings** contains language, pause duration, input providers, fallback, and transcript cleanup.

### Audio attachments and message channels

In the Gateway console, open **Settings → Capabilities → Voice**:

1. Expand **Advanced settings** and enable speech-to-text.
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
