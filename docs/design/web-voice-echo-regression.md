# Web voice playback echo regression

Validated on 2026-10-08 with local Google Chrome.

The WebUI previously used microphone RMS (`speaking`) to reduce assistant output
from gain 1.7 to 0.255. Speaker echo can exceed the same threshold as human speech,
so playback repeatedly attenuated itself even though the server did not cancel
the response. Microphone levels now update only the meter. Playback stops on
server-confirmed cancellation or the explicit Stop reply action.

Both assistant and natural voice engines continue to require a finalized,
non-echo transcription for an audible interruption. They now retain the text
available at speech onset for up to 30 seconds (256 candidates maximum), so
provider transcription delayed beyond the normal 3-second playback tail is
still checked against that playback. Each candidate is consumed on final
transcription and cleared on input reset, mute, failure, and session close.
Cancellation refreshes the recent playback tail to protect against sound still
reaching the microphone after Stop reply.

## Reproducible validation

```sh
XOPC_LOG_LEVEL=fatal pnpm exec vitest run \
  web/src/features/voice/realtime/__tests__ \
  src/voice/realtime/__tests__ --exclude '**/*.live.test.ts'
node scripts/voice-browser-smoke.mjs
pnpm -C web run type-check
pnpm run typecheck
```

The browser script uses production React call/settings components, the actual
capture AudioWorklet, resampler, protocol decoder, WebSocket client, and Web Audio
PCM player. An isolated simulated gateway supplies deterministic events. Chrome
receives a loud synthetic microphone WAV. The regression asserts that microphone
frames reach the uplink, raw VAD does not attenuate playback, all one second of
output is acknowledged, and no unsolicited stop is sent. It also checks manual
stop, mute, navigation, narrow-screen layout, clarification, and dictation.
Set `XOPC_VOICE_SMOKE_BROWSER` to the Chrome executable when needed.

The same browser regression failed against the original hook with
`Speaker echo ducked assistant playback`, and passed against the fixed hook.
Engine tests cover delayed echo, imperfect ASR echo, playback completion,
cancellation, and genuine user interruptions. Native engine tests communicate
with an actual local upstream WebSocket server with deterministic provider events.
Type checks and lint for changed TypeScript files passed.

This validates application behavior with simulated media/providers. It does not
measure acoustic echo cancellation on physical speakers, Bluetooth devices,
Safari, or a live cloud provider. Finalized-ASR interruption trades some response
latency for avoiding cancellation from raw energy/VAD; exact human repetition of
recent assistant text remains ambiguous to the existing text echo classifier.
Physical-device acceptance should include loud speaker playback, deliberate
Chinese/English interruption, delayed provider transcription, Bluetooth device
switching, and a sustained call.

## Reference approaches

- [LiveKit noise and echo cancellation](https://docs.livekit.io/transport/media/noise-cancellation/)
  describes microphone pickup of speaker output, its effect on turn detection,
  browser WebRTC cancellation, and optional enhanced input processing.
- [LiveKit turn-taking tuning](https://docs.livekit.io/agents/logic/turns/tuning/)
  treats interruption handling separately from turn detection and input processing.
- [OpenAI realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
  documents speech-driven interruption and handling unplayed output audio.

The existing browser echo cancellation, noise suppression, and gain control
constraints remain enabled. No additional media service or dependency is needed
for this fix.
