# xopc Android (native)

This is the standalone Kotlin/Jetpack Compose Android client. It is not the generated Android directory of `apps/mobile-expo`.

Status: **in progress**. The five top-level destinations, signed Gateway pairing and Keystore credentials, realtime Assistant/Conversations data path, local-first drafts, streaming run UI, and several Progress journeys are implemented. Progress includes Task and Project basics plus automation list/detail/run, create/edit/delete, run controls and timeline. Notes has an authenticated list/search/filter/paging/detail path, multi-draft encrypted local text capture, existing-note revision/conflict handling, debounced text autosync with in-flight edit reconciliation, a versioned More menu for pin/archive/tags and confirmed deletion, version-history preview with confirmed restoration into an encrypted draft, and 24-hour note-link sharing with reachability, copy and Android Sharesheet. QR, preview, Share Center, rich authoring, voice and files remain open. The current implementation and remaining parity gaps are tracked in [the native parity plan](../../docs/mobile-android-native-parity.md); a compiled app is not a full HarmonyOS parity claim. Connected Gateway mutation E2E and visual acceptance still remain open.

The primary five-tab dock uses the HarmonyOS compact rounded hierarchy and brand mark, with light/dark resources. Switching tabs retains saveable local UI state. The Assistant Action panel has a reduced-motion-aware enter/exit transition. This is a partial visual alignment, not a connected-state acceptance.

## Build

The Android 26+ adaptive launcher icon now uses the HarmonyOS Human–AI Loop mark, with a monochrome themed-icon layer. Android 12+ uses the platform splash screen; Android 8–11 uses a matching window background. Both select the HarmonyOS light/dark launch mark and surface colors. The older Android Studio starter icon assets remain in the source tree but are not selected on the supported API range.

Open `apps/mobile-android` in Android Studio, or run `./gradlew :app:assembleDebug` in this directory. The application ID is `ai.xopc.xopc` (the same as the former Expo Android app); minimum Android API is 26. No secrets or local SDK path should be committed.

Release APK and AAB builds require the existing Production Android keystore through Gradle properties `XOPC_UPLOAD_STORE_FILE`, `XOPC_UPLOAD_STORE_PASSWORD`, `XOPC_UPLOAD_KEY_ALIAS`, and `XOPC_UPLOAD_KEY_PASSWORD` (or their `ORG_GRADLE_PROJECT_` environment equivalents). Missing signing inputs fail release builds rather than producing an unsigned artifact. Version code starts at 79, above the Expo app's current 78, and must increase for each subsequent release. No local app-data migration is implemented; users upgrading from Expo may need to pair again.

GitHub Actions runs native debug build and unit tests on changes to this app. A `mobile-android-v*` tag builds a Production-signed APK and AAB, checks the signing certificate, uploads both as Actions artifacts, and publishes the APK, AAB, and SHA-256 checksums in GitHub Releases. Manual workflow runs build artifacts without publishing a release. The workflow reuses the existing `ANDROID_PRODUCTION_*` secrets. It does not upload to Google Play. The separate Expo iOS TestFlight workflow is unchanged.

Run `./gradlew :app:testDebugUnitTest :app:connectedDebugAndroidTest` with an Android emulator for protocol, Keystore, Gateway-session and UI tests. The authenticated client requires a Gateway mobile pairing link from a configured HTTPS route; it never connects to plain HTTP.

Use `XOPC_Android_Test_API_35` for instrumented tests and `Pixel_7_API_35` for the live paired-Gateway journey. Both AVDs use the locally installed API 35 image. Although test preferences and Keystore aliases are isolated, the earlier combined instrumentation/reinstall sequence on one AVD returned the app to the unpaired screen. A later APK update on the separate live AVD, without instrumentation, preserved both the Gateway credential and selected conversation. Keep the two AVDs separate for future validation.

## Parity contract

The current HarmonyOS app under `apps/mobile-harmony` is the behavior and information-architecture reference. Gateway APIs are authoritative for data and protocol behavior. See [native parity plan](../../docs/mobile-android-native-parity.md) for the complete scope and acceptance gates. A compiled shell is not a parity claim.
