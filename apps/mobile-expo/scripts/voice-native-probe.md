# Android native voice regression probe

Build and install the current Android development app, start Metro, and keep the app in
the foreground. Grant microphone permission when prompted. Stop any active voice call
first. The probe runs the production `NativeAudioSession` and Kotlin module through
Hermes, with generated PCM tones; it does not connect to a gateway or upload recordings.

From the repository root, using `agent-device` 0.20.10:

```sh
pnpm dlx agent-device@0.20.10 cdp target list --url http://127.0.0.1:8081
pnpm dlx agent-device@0.20.10 cdp runtime eval --expr "$(<apps/mobile-expo/scripts/voice-native-probe.js)"
```

Allow the probe to complete, then inspect its status and individual cases:

```sh
pnpm dlx agent-device@0.20.10 cdp runtime eval --expr '[__voiceNativeProbe.stage, __voiceNativeProbe.error, __voiceNativeProbe.capturedFrames, __voiceNativeProbe.stopped].join(" | ")'
pnpm dlx agent-device@0.20.10 cdp runtime eval --expr '__voiceNativeProbe.cases.map(x => [x.id, x.expectedBytes, x.playedBytes, x.elapsedMs].join(":")).join(" | ")'
```

Pass criteria: `stage` is `passed`, captured frames are nonzero, `stopped` is `true`,
and each case's played bytes match expected bytes. Cases cover a half-second reply,
10 ms of audio, the full two-second window, resuming the same response after starvation,
and a new short response after interruption/flush. This checks native playback-head
acknowledgements, not sound quality or speech recognition.

On an API 35 emulator, the original player accepted a 24,000-byte half-second reply
but acknowledged zero played bytes after two seconds; a 96,000-byte reply did play.
Android's streaming start threshold defaults to its buffer capacity. Reducing the
effective buffer lowers that threshold without reallocating the buffer or discarding
queued audio. The application still enforces the two-second outstanding-audio limit.
See [AudioTrack buffer sizing](https://developer.android.com/reference/android/media/AudioTrack#setBufferSizeInFrames(int)).

An end-to-end speech/AI test additionally requires normal device pairing with the target
gateway and a speech source. Passing this probe alone does not prove a cloud call works.
