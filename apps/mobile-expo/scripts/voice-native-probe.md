# Native voice regression probe

Build and install the current iOS or Android development app, start Metro, and keep the app in
the foreground. Grant microphone permission when prompted. Stop any active voice call
first. The probe runs the production `NativeAudioSession` and Swift/Kotlin module through
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
and a new short response after interruption/flush, speaker/system output selection, and
capture/playback in a second call. Capture waits up to two seconds for a native frame,
failing immediately on an interruption. This checks native playback
acknowledgements, not sound quality or speech recognition.

On an API 35 emulator, the original player accepted a 24,000-byte half-second reply
but acknowledged zero played bytes after two seconds; a 96,000-byte reply did play.
Android's streaming start threshold defaults to its buffer capacity. Reducing the
effective buffer lowers that threshold without reallocating the buffer or discarding
queued audio. The application still enforces the two-second outstanding-audio limit.
See [AudioTrack buffer sizing](https://developer.android.com/reference/android/media/AudioTrack#setBufferSizeInFrames(int)).

An end-to-end speech/AI test additionally requires normal device pairing with the target
gateway and a speech source. Passing this probe alone does not prove a cloud call works.

## iOS verification — 2026-09-07

Environment: Xcode 26.4.1, iPhone 17 Pro simulator, iOS 26.4, current-source Debug build
with normal simulator signing. The generated local project's marketing version is older
than the package version; this is a source-build test, not validation of a distributed IPA.

```sh
xcodebuild -workspace apps/mobile-expo/ios/xopc.xcworkspace -scheme xopc \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/xopc-ios-voice-build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
```

Use `--session ios-voice` before `cdp` and select the iPhone target when both platforms
are running. Do not disable signing: SecureStore requires the simulator entitlements.

Before the fix, the engine stopped on its initial hardware format negotiation; both the
probe and a cloud call paused with `route_lost` and no microphone frames. Retrying the
call repeated the failure. iOS also resolved the first microphone permission request
while AppState was still `inactive`, causing a separate `background` startup failure.

After the fix, resetting microphone permission and accepting the system prompt passed:

| Native playback case | Expected / acknowledged PCM bytes |
| --- | --- |
| Short reply | 24,000 / 24,000 |
| 10 ms reply | 480 / 480 |
| Full two-second window | 96,000 / 96,000 |
| Stream before gap | 4,800 / 4,800 |
| Stream after gap, cumulative | 9,600 / 9,600 |
| New response after flush | 24,000 / 24,000 |
| Speaker output | 24,000 / 24,000 |
| System output | 24,000 / 24,000 |
| Second call | 24,000 / 24,000 |

All four capture checks received native PCM; no interruption occurred and the probe
released the audio session. The first cloud regression against `https://xl.xopc.ai`
returned the test phrase transcription and an AI response, with 211,200 received bytes
and 211,200 native playback-acknowledged bytes. Cloud recognition used synthetic speech
PCM injected at the production call transport, not a recording of a person speaking
into the simulator microphone. No credentials or raw recordings are stored here.
The final rebuilt native module plus the permission fix passed another cloud call:
`response.done` received, 76,800 / 76,800 bytes, transcription present, and AI text
`I can hear you clearly.` visible in the call screen. The production call controller
was started from Hermes for these isolated diagnostic sessions; cloud responses and
native audio were not mocked.

The expanded call was visible above the native settings sheet, and tapping the compact
bar reopened it without dropping the connection. The iOS window overlay replaces the
root Modal presentation that UIKit rejected while a native-stack modal was present.
Automated checks: 722 mobile tests (132 files), mobile typecheck and lint passed.

Limits: these checks do not establish physical iPhone microphone quality, Bluetooth
route behavior, acoustic echo cancellation quality, or TestFlight/release-build behavior.
Real device removal and interruption still pause capture. A format change with
unacknowledged output also pauses rather than falsely acknowledging discarded speech.

References: [Apple audio engine configuration notification](https://developer.apple.com/documentation/foundation/nsnotification/name-swift.struct/avaudioengineconfigurationchange),
[Expo SDK 56 audio](https://docs.expo.dev/versions/v56.0.0/sdk/audio/),
[react-native-screens FullWindowOverlay](https://github.com/software-mansion/react-native-screens#fullwindowoverlay).

## Android output volume — 2026-09-07

Android now explicitly selects the built-in speaker for automatic output when no external
output is connected, matching iOS's existing `defaultToSpeaker` behavior. Wired/USB/Bluetooth
outputs remain system-selected unless the user explicitly selects Speaker. Device additions
release the automatic speaker override; explicit Speaker selection persists until disabled.
The activity's volume keys target `STREAM_VOICE_CALL` throughout a call, including listening
gaps. Stop/failure restores the prior activity volume-key stream and audio mode. The older
Android speakerphone API also restores its prior state. No PCM gain, stream-volume write,
media-stream substitution, or echo-cancellation bypass is introduced.

Verification used the API 35 Pixel 7 emulator and a rebuilt Debug APK:

- Before: the call registered no preferred communication device. This emulator nevertheless
  defaulted to its speaker, so it did **not** reproduce a physical handset's low earpiece volume.
- After: `dumpsys audio` showed the app's speaker route client and both preferred and active
  communication output as `speaker`, even with no reply playing.
- A volume-up key changed voice-call volume 3 → 4 while media volume stayed at 5. The test
  restored the original voice-call volume afterward.
- All nine native PCM playback cases passed, all four capture checks received frames, and
  the probe stopped cleanly. No microphone frames were uploaded to a gateway.
- All 11 Kotlin tests passed (including three new output-policy cases), as did 733 mobile
  tests, mobile typecheck and lint. The APK build passed using the installed JDK 17 and the
  existing Gradle 9.3.1 wrapper. JDK 21 triggered an unrelated Foojay toolchain download error;
  no project dependency or wrapper version was changed to work around it.

Physical HarmonyOS/Android loudness, connected-headset routing, and Android API <31 still
require device acceptance. This change only modifies Android; iOS already defaults to the
speaker and no iOS amplification change was made without evidence of attenuation. Native
changes require a rebuilt Android app, not a gateway update or a JS-only update.

References: [Android output and volume controls](https://developer.android.com/media/platform/output),
[communication-device selection](https://developer.android.com/reference/android/media/AudioManager#setCommunicationDevice(android.media.AudioDeviceInfo)).
