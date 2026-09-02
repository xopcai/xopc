# xopc Mobile

English | [简体中文](./README.zh-CN.md)

Expo mobile client for the [xopc](https://github.com/xopcai/xopc) gateway. The native app connects over HTTPS/WSS and pairs each phone as an independently revocable device.

The mobile client is designed as a calm, content-first workspace for notes, inbox triage, assistant conversations, and automation control. Visual and interaction standards live in [DESIGN.md](./DESIGN.md).

## Quick Links

- Main project: [xopcai/xopc](https://github.com/xopcai/xopc)
- Mobile app guide: [xopc docs - Mobile app](https://xopcai.github.io/xopc/mobile-app)
- Remote access guide: [xopc docs - Remote access](https://xopcai.github.io/xopc/remote-access)
- Design language: [DESIGN.md](./DESIGN.md)

If xopc helps you keep long-running AI work moving across terminal, web, desktop, mobile, and messengers, please star the main repo: [github.com/xopcai/xopc](https://github.com/xopcai/xopc).

## How the App Connects

1. Start `xopc gateway` on the machine that has your xopc config and model credentials.
2. Configure at least one secure route: XOPC Secure Link, Tailscale Serve, or your own HTTPS reverse proxy.
3. In the gateway console, open **Settings -> Endpoint tools -> Mobile access** and create a pairing QR code.
4. Scan the QR code in the app. Pairing links expire after 10 minutes and can be used once.

The app verifies the gateway's Ed25519 identity before exchanging credentials. It keeps the short-lived access token only in memory and stores the rotating, device-signed refresh credential in SecureStore. There is no manual gateway URL, shared bearer token, or cleartext LAN mode.

## Tech Stack

| Area | Stack |
|---|---|
| Runtime | Expo SDK 56, React Native 0.85, React 19 |
| Routing | Expo Router |
| Server state | TanStack React Query |
| Client state | Zustand |
| Storage | react-native-mmkv for non-secret state; SecureStore for device credentials |
| UI | react-native-paper plus project design tokens |
| Gestures and motion | react-native-gesture-handler, react-native-reanimated |
| Keyboard | react-native-keyboard-controller |
| Lists | FlashList for long/high-update lists |
| Validation | zod, react-hook-form |
| Tests | Vitest |

## Repository Layout

```text
app/                         Expo Router routes
src/                         Features, components, API, query, theme, stores
src/theme/                   Design tokens and Paper theme mapping
src/i18n/                    Localized message bundles
src/storage/                 MMKV state and SecureStore device credentials
../../packages/realtime-client/    Shared realtime WebSocket client
../../packages/agent-stream-client/ Agent stream event dispatcher
plugins/                     Expo config plugins
app.json                     Expo native configuration
eas.json                     EAS build profiles
```

## Requirements

- Node.js 22+
- pnpm from the repository root `packageManager`
- A running xopc gateway for real device usage
- Xcode and CocoaPods for iOS native builds
- Android Studio / Android SDK for Android native builds

## Install

```bash
pnpm install
```

## Development

```bash
pnpm run dev:mobile
```

Common scripts:

| Script | Description |
|---|---|
| `pnpm run dev:mobile` | Start the Expo dev server |
| `pnpm -C apps/mobile-expo run start:no-proxy` | Start Expo with proxy environment variables cleared |
| `pnpm run android:mobile` | Build and run Android |
| `pnpm run ios:mobile` | Build and run iOS |
| `pnpm -C apps/mobile-expo run ios:no-proxy` | Build and run iOS with proxy variables cleared |
| `pnpm run mobile:lint` | Run ESLint on `app` and `src` |
| `pnpm run mobile:typecheck` | Type-check the app and realtime workspace packages |
| `pnpm run mobile:test` | Run the Vitest suite |
| `pnpm run mobile:test:stream` | Run agent stream client tests |

## Pair a Device

Mobile routes must be HTTPS origins. The gateway can publish any combination of:

- XOPC Secure Link.
- Tailscale Serve.
- A configured HTTPS reverse proxy origin.

The signed pairing payload contains the gateway identity and currently available secure routes. The app tries them sequentially and remembers the last successful route. Writes are never sent to multiple routes concurrently.

For Universal Links/App Links to open the installed app, `link.xopc.ai` must serve an Apple `apple-app-site-association` entry for `<APPLE_TEAM_ID>.ai.xopc.xopc` and an Android `assetlinks.json` entry for package `ai.xopc.xopc` with the production signing certificate fingerprint.

## Expo Go vs Development Builds

Expo Go is useful for quick UI iteration, but it does not include every native module used by this app.

`react-native-mmkv` requires native code. In Expo Go, the app falls back to in-memory storage, so settings are lost after restart. For persistent storage and native networking behavior, use a development build:

```bash
pnpm -C apps/mobile-expo exec expo prebuild
pnpm -C apps/mobile-expo run ios:no-proxy
# or
pnpm run android:mobile
```

Run `pnpm -C apps/mobile-expo exec expo prebuild --clean` after changing `app.json`, config plugins, native permissions, or native networking settings.

## Push Notifications

The app uses Expo Push Service for task alerts. **Task notifications** default to disabled. After the user explicitly enables them in settings, the app requests system permission, stores the user's intent in MMKV, and registers its Expo token with the gateway; the user still controls the system permission. Tapping an alert opens the related chat or automation.

The gateway stores device registrations in its local SQLite database and sends alerts for Tasks that need input or are blocked, plus failed automations. Task-completion alerts are disabled by default and can be enabled through the device preferences API.

Before distributing a build, complete these account-side steps (do not commit credentials or credential files):

1. In Expo/EAS, ensure this project's ID matches `app.json` and build a development or production client; Expo Go is not a valid push-notification test target on Android.
2. For Android, create the Firebase Android app with package ID `ai.xopc.xopc`, then configure FCM v1 credentials in the Expo project credentials. Save the downloaded client configuration as `apps/mobile-expo/google-services.json` (Git-ignored), or configure an EAS file environment variable named `GOOGLE_SERVICES_JSON`. GitHub Android releases also require the Base64-encoded file in the repository secret `GOOGLE_SERVICES_JSON_BASE64`. Run `pnpm -C apps/mobile-expo run verify:android-push` to validate its package and required fields.
3. For iOS, enable Push Notifications for `ai.xopc.xopc` in the Apple Developer portal and configure an APNs key or profile in EAS credentials. Test on a physical iPhone or iPad.
4. Make sure the gateway host can make outbound HTTPS requests to `https://exp.host`; device-to-gateway traffic uses the paired secure route.

After the first credential setup or any native notification config change, rebuild the app:

```bash
pnpm -C apps/mobile-expo exec expo prebuild --clean
pnpm -C apps/mobile-expo run build:android:preview
pnpm -C apps/mobile-expo run build:ios:preview
```

## Native Network Security

The app accepts HTTPS/WSS gateway routes only. Android is built with `usesCleartextTraffic: false`; iOS has no ATS local-network exception. `app.json` declares the verified `https://link.xopc.ai/connect` App Link and the matching iOS associated domain. After changing these settings, run `pnpm -C apps/mobile-expo exec expo prebuild --clean` and rebuild the native app.

## iOS CocoaPods and Proxy Notes

If `expo run:ios` hangs on `Installing CocoaPods...`, system HTTP proxies can slow `pod install` and trigger Node `[UNDICI-EHPA]` warnings.

This repo provides:

- `plugins/with-ios-cocoapods-mirror.js`, which injects a Tsinghua CocoaPods Specs mirror during prebuild.
- Scripts that clear proxy environment variables and prefer Homebrew's `pod`.

Recommended flow:

```bash
pnpm -C apps/mobile-expo exec expo prebuild
pnpm run pods:install
pnpm -C apps/mobile-expo run ios:no-install
```

One-step alternative:

```bash
pnpm -C apps/mobile-expo run ios:no-proxy
```

## Android Release Builds

Release builds use `expo-build-properties` to reduce install size:

- `arm64-v8a` only.
- R8 minification.
- Resource shrinking.

Build a local release APK:

```bash
ANDROID_KEYSTORE_PATH="/secure/path/xopc-upload.jks" \
ANDROID_KEYSTORE_PASSWORD="..." \
ANDROID_KEY_ALIAS="..." \
ANDROID_KEY_PASSWORD="..." \
pnpm -C apps/mobile-expo run build:android:local
```

This command runs Expo prebuild and Gradle locally and produces:

- `dist/android/xopc-android.apk` for direct installation or a GitHub Release.
- `dist/android/xopc-android.aab` for Google Play.

Android release builds require the production keystore. The prebuild step injects the Gradle
configuration through `plugins/with-android-release-signing.js`; credentials are supplied only
through environment variables and must not be committed.

Tags matching `mobile-expo-v*` trigger `.github/workflows/mobile-expo-release.yml`. The workflow
builds a preview APK and production APK/AAB artifacts directly on GitHub Ubuntu runners without
EAS Build. Manual runs can select `preview`, `production`, or `both`. It requires these GitHub
Actions secrets:

- `ANDROID_PREVIEW_KEYSTORE_BASE64`
- `ANDROID_PREVIEW_KEYSTORE_PASSWORD`
- `ANDROID_PREVIEW_KEY_ALIAS`
- `ANDROID_PREVIEW_KEY_PASSWORD`
- `ANDROID_PRODUCTION_KEYSTORE_BASE64`
- `ANDROID_PRODUCTION_KEYSTORE_PASSWORD`
- `ANDROID_PRODUCTION_KEY_ALIAS`
- `ANDROID_PRODUCTION_KEY_PASSWORD`

The workflow uploads `xopc-android-preview` (APK) and `xopc-android-production` (APK + AAB).
Tag-triggered GitHub Releases use the production APK.

Reuse the Android keystore from previous EAS builds. Changing it prevents upgrades over existing
installs, and Google Play rejects updates signed with the wrong upload key.

EAS profiles:

| Script | Output |
|---|---|
| `pnpm -C apps/mobile-expo run build:android:preview` | Internal Android APK |
| `pnpm -C apps/mobile-expo run build:android:production` | Android App Bundle |
| `pnpm -C apps/mobile-expo run build:ios:preview` | Internal iOS build |
| `pnpm -C apps/mobile-expo run build:ios` | Local production iOS IPA, output to `dist/xopc.ipa` by default |
| `pnpm -C apps/mobile-expo run build:ios:eas` | EAS production iOS build |
| `pnpm -C apps/mobile-expo run submit:ios` | Submit latest production iOS build |
| `pnpm -C apps/mobile-expo run submit:ios:direct` | Upload local `dist/xopc.ipa` directly, or pass an IPA URL/local path |

### One-command iOS TestFlight release

When the App Store Connect API key is configured locally, run:

```bash
APPLE_TEAM_ID="TEAMID1234" pnpm run mobile:release:ios:testflight
```

This runs the mobile quality checks, regenerates the iOS project, builds and validates the
production IPA, and uploads it to TestFlight. By default, the private API key is read from
`~/.appstoreconnect/private_keys/AuthKey_<APP_STORE_CONNECT_API_KEY>.p8`. To build without upload:

```bash
UPLOAD_TO_TESTFLIGHT=0 APPLE_TEAM_ID="TEAMID1234" pnpm run mobile:release:ios:testflight
```

The `Mobile iOS TestFlight` GitHub Actions workflow supports manual one-command builds/uploads.
Tags matching `mobile-expo-v*` automatically build and upload the production IPA to TestFlight,
while retaining the `xopc-ios-production` artifact for 30 days. It requires these secrets:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_API_KEY`
- `APP_STORE_CONNECT_API_ISSUER`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_MAIN_BASE64`
- `IOS_PROVISIONING_PROFILE_SHARE_BASE64`
- `IOS_PROVISIONING_PROFILE_WIDGET_BASE64`

When signing assets are first configured or renewed, use EAS to generate production credentials
for the main app, Share Extension, and Widget Extension, download them locally, then sync them to
GitHub Secrets in one command:

```bash
pnpm -C apps/mobile-expo exec eas credentials -p ios
pnpm run mobile:configure:ios:github
```

Choose `production`, sign in to Apple, configure App Store credentials for every target under
`Build Credentials`, then use
`credentials.json: Upload/Download credentials between EAS servers and your local json` to
download them. The sync script validates each profile's bundle ID and never prints certificate
contents or passwords.

Low-level local iOS build example:

```bash
DEVELOPMENT_TEAM="TEAMID1234" pnpm -C apps/mobile-expo run build:ios
pnpm -C apps/mobile-expo run submit:ios:direct
```

`build:ios` synchronizes the marketing version from `app.json` and uses the current timestamp as
the iOS build number by default; pass `IOS_BUILD_NUMBER=123` when you need a fixed value.

If the Apple team grants the API key access to Cloud-managed Distribution Certificates, Xcode can
also fetch signing assets automatically:

```bash
APP_STORE_CONNECT_API_KEY="KEY_ID" \
APP_STORE_CONNECT_API_ISSUER="ISSUER_ID" \
DEVELOPMENT_TEAM="TEAMID1234" \
pnpm -C apps/mobile-expo run build:ios
```

The current package ID is `ai.xopc.xopc`. If you previously installed a build under `com.anonymous.xopcapp`, uninstall it separately; Android treats it as a different app.

## Quality Checks

Before handing off a change:

```bash
pnpm run mobile:lint
pnpm run mobile:typecheck
pnpm run mobile:test
```

If you changed `packages/agent-stream-client`, also run:

```bash
pnpm run mobile:test:stream
```

## License

MIT, matching the xopc main repo unless stated otherwise.
