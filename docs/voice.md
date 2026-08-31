# Voice input and replies

xopc can turn voice messages into text (speech-to-text, or STT) and assistant replies into audio (text-to-speech, or TTS). Availability depends on the selected provider and client.

## Where voice works

- Web and desktop Chat can transcribe supported audio attachments.
- Telegram can transcribe voice notes and send audio replies when configured.
- Other channels may support one or both directions depending on their media capabilities.
- An Agent can create speech with the voice tool when TTS is enabled.

## Configure speech-to-text

In the Gateway console, open **Settings → Capabilities → Voice**:

1. Enable speech-to-text.
2. Choose a provider and model.
3. Add the provider credential if it is not already configured.
4. Save and upload a short test recording in Chat.

The setup is working when the message shows an accurate transcript and the Agent answers the spoken request.

### Audio input contract

Voice uploads use `POST /api/voice/transcriptions` with multipart form data. WAV, WebM/Opus, Ogg/Opus, MP3, and MP4/M4A are accepted. The local provider reads PCM WAV directly and normalizes other containers to mono 16 kHz PCM with `ffmpeg`; install `ffmpeg` on the gateway host when using compressed input with local STT. If the binary is outside `PATH`, set `XOPC_FFMPEG_PATH` to its absolute path and restart the gateway. The official Docker image includes `ffmpeg`.

Discussion capture keeps the compressed original recording as recoverable evidence and sends speech-aware WAV segments for live text. Segments close on a pause after at least four seconds, are capped at fifteen seconds, and pure silence is skipped. If live text is incomplete, the original is decoded into bounded chunks and transcribed sequentially instead of loading a long recording into one STT request.

## Configure text-to-speech

1. Enable text-to-speech on the same Voice settings page.
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
