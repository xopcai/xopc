# Unified phone text input

Android text entry is a device capability, not a model prerequisite. AutoGLM, structured phone models and browser takeover use the same guarded `typeText` dispatch. Alibaba Cloud ADB and local USB/emulator ADB use the same implementation. Future cloud SDK drivers can implement `PhoneDriver.execute(typeText)` and `textInputStatus` using native vendor input (`provider-native`).

## Strategy and ownership

- `textInput=auto` (default): conservative ASCII goes through Android `input text`; other text uses a SHA-256 pinned scrcpy 3.3.3 server in **control-only** mode on Android 7+.
- `textInput=manual`: all remote text commits are refused before dispatch. The Agent pauses with `needs_user` / `text_input_required`. The user takes over and types with the phone's own keyboard, then explicitly hands back.
- No keyboard APK is installed, enabled or selected. An OEM/app that disallows paste is handled through manual takeover, not broader device permissions.
- Settings → Phone Use → Manage phone exposes the automatic-input preference and read-only capability diagnostics. Diagnostics report SDK and verified server availability; they do not claim an app accepts pasted text. Missing server assets point to the existing managed dependency repair flow.

## Clipboard and privacy

The Unicode channel writes only the supplied string and requests paste. It does not request the phone's original clipboard and does not enable clipboard autosync. Supplied text may remain in the phone clipboard, replacing its previous contents; this is disclosed next to the preference. Password fields are refused before any clipboard write. Text is encoded as UTF-8 protocol data, never interpolated into shell arguments. Input text, clipboard payloads and scrcpy process output are not logged.

## Confirmation and recovery

The sequence is: fresh authorized app and focused non-password editor → setup → one paste with a sequence ID → matching clipboard ACK → native UI confirmation of the entered text. ACK alone is insufficient because the Android/app clipboard operation can fail. The driver discards verification frames afterwards.

Setup failures return `PHONE_TEXT_INPUT_UNAVAILABLE` before sending text. Lost ACKs, disconnects or absent UI evidence return `PHONE_TEXT_INPUT_UNCONFIRMED`. There is no fallback paste or automatic retry after uncertain dispatch. The Agent yields a recoverable `needs_user` state and keeps the session available for inspection. Existing manual ownership is retained when the user submits text and verification fails. The UI preserves the draft, asks for inspection and leaves handback explicit. Session and app policies, control epochs and input serialization remain enforced.

Text uses a separate short-lived transport so video degradation or scrcpy encoder failure does not require ADB Keyboard. Cleanup closes only its own socket, process, forwarding rule and temporary server file.

## Verified on 2026-10-24

- Alibaba Cloud Android 12, without ADB Keyboard installed: AutoGLM opened 应用宝, focused the search field and entered `高德地图`. Native UI verification passed; no download or installation was performed. Session closed afterwards.
- Local Android 15 AVD through host ADB: entered `高德地图😀` in Settings search; native UI text matched and the selected input method remained unchanged. The test-created AVD was stopped afterwards.
- Regression coverage includes split/mismatched ACKs, disconnect/abort, bounded device messages, password/unfocused-field refusal, unavailable channels, UI verification failures, manual-only policy, manual ownership retention, authenticated provider diagnostics and settings controls.

Protocol reference: [scrcpy Controller v3.3.3](https://github.com/Genymobile/scrcpy/blob/v3.3.3/server/src/main/java/com/genymobile/scrcpy/control/Controller.java).
