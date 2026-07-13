# xopc Mobile

English | [简体中文](./README.zh-CN.md)

Expo mobile client for the [xopc](https://github.com/xopcai/xopc) gateway. The app connects to a user-hosted gateway over HTTP/WebSocket, with LAN-first routing and optional FRP remote access after QR pairing.

The mobile client is designed as a calm, content-first workspace for notes, inbox triage, assistant conversations, and automation control. Visual and interaction standards live in [DESIGN.md](./DESIGN.md).

## Quick Links

- Main project: [xopcai/xopc](https://github.com/xopcai/xopc)
- Mobile app guide: [xopc docs - Mobile app](https://xopcai.github.io/xopc/mobile-app)
- Remote access guide: [xopc docs - Remote access](https://xopcai.github.io/xopc/remote-access)
- Design language: [DESIGN.md](./DESIGN.md)

If xopc helps you keep long-running AI work moving across terminal, web, desktop, mobile, and messengers, please star the main repo: [github.com/xopcai/xopc](https://github.com/xopcai/xopc).

## How the App Connects

1. Start `xopc gateway` on the machine that has your xopc config and model credentials.
2. Open the gateway console and go to **Settings -> Remote access**.
3. Choose a route: LAN, FRP public tunnel, Tailscale Serve, or your own HTTPS reverse proxy.
4. Pair the mobile app with the gateway QR code, or enter the gateway base URL and optional bearer token in app settings.

Remote access uses LAN-first routing. When FRP is enabled, broker-terminated TLS serves `*.frp.xopc.ai`; remote API calls use HTTPS plus the gateway bearer token after QR pairing.

## Tech Stack

| Area | Stack |
|---|---|
| Runtime | Expo SDK 56, React Native 0.85, React 19 |
| Routing | Expo Router |
| Server state | TanStack React Query |
| Client state | Zustand |
| Storage | react-native-mmkv, with web/local fallback |
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
src/storage/                 MMKV and fallback storage
../../packages/gateway-sse-client/ Workspace package for gateway SSE parsing
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
| `pnpm -C apps/mobile-expo run web` | Start Expo web |
| `pnpm run mobile:lint` | Run ESLint on `app` and `src` |
| `pnpm run mobile:typecheck` | Type-check the app and SSE workspace package |
| `pnpm run mobile:test` | Run the Vitest suite |
| `pnpm run mobile:test:sse` | Run SSE client tests |

## Configure the Gateway

Open app settings and configure:

- Gateway base URL, without a trailing slash.
- Optional bearer token, matching gateway auth in `xopc.json`.

Examples:

```text
http://192.168.1.44:18790
https://your-name.frp.xopc.ai
https://xopc.example.com
```

The app can probe available routes from gateway settings and prefers LAN when `/health` succeeds.

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

The app uses Expo Push Service for task alerts. Once a paired gateway is configured, enable **Task notifications** in the app settings. The app requests permission only from that explicit action, registers its Expo token with the gateway, and opens the related chat or automation when an alert is tapped.

The gateway stores device registrations in its local SQLite database and sends alerts for goals that need input or are blocked, plus failed automations. Completion alerts are disabled by default and can be enabled through the device preferences API.

Before distributing a build, complete these account-side steps (do not commit credentials or credential files):

1. In Expo/EAS, ensure this project's ID matches `app.json` and build a development or production client; Expo Go is not a valid push-notification test target on Android.
2. For Android, create the Firebase Android app with package ID `ai.xopc.xopc`, then configure FCM v1 credentials in the Expo project credentials. Keep `google-services.json` out of Git.
3. For iOS, enable Push Notifications for `ai.xopc.xopc` in the Apple Developer portal and configure an APNs key or profile in EAS credentials. Test on a physical iPhone or iPad.
4. Make sure the gateway host can make outbound HTTPS requests to `https://exp.host`; device-to-gateway traffic continues to use the paired LAN or remote URL.

After the first credential setup or any native notification config change, rebuild the app:

```bash
pnpm -C apps/mobile-expo exec expo prebuild --clean
pnpm -C apps/mobile-expo run build:android:preview
pnpm -C apps/mobile-expo run build:ios:preview
```

## Native Networking Notes

Local gateways often use plain HTTP on a LAN IP, such as `http://192.168.1.44:18790`. Expo Go and installed native builds can behave differently because native builds use this app's own bundle ID, permissions, and network policy.

### Android HTTP Cleartext

Android 9+ blocks HTTP by default. This project enables LAN HTTP through `expo-build-properties` with `android.usesCleartextTraffic: true`.

After changing native network settings:

```bash
pnpm -C apps/mobile-expo exec expo prebuild --clean
pnpm run android:mobile
```

If LAN works in Expo Go but fails in a dev-client or release APK, rebuild the Android app. Cleartext settings are applied at prebuild time.

### iOS Local Network and ATS

The iOS config in `app.json` includes:

- `NSAppTransportSecurity.NSAllowsLocalNetworking`, allowing HTTP to local IPs.
- `NSLocalNetworkUsageDescription`, required for the iOS Local Network privacy prompt.

On first LAN access, iOS asks whether the app may find devices on the local network. Expo Go and the installed xopc app have different bundle IDs, so allowing Expo Go does not grant access to the standalone app.

If LAN is unreachable after install:

1. Open **Settings -> Privacy & Security -> Local Network** and enable **xopc**.
2. Confirm the phone and gateway are on the same Wi-Fi.
3. Open gateway settings in the app and re-detect the route.

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
pnpm -C apps/mobile-expo exec expo prebuild --clean
pnpm -C apps/mobile-expo run android:release
```

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

Local iOS build example:

```bash
DEVELOPMENT_TEAM="TEAMID1234" pnpm -C apps/mobile-expo run build:ios
pnpm -C apps/mobile-expo run submit:ios:direct
```

`build:ios` uses the current timestamp as the iOS build number by default; pass `IOS_BUILD_NUMBER=123` when you need a fixed value.

To let Xcode fetch signing assets automatically, reuse the App Store Connect API key environment variables from the direct submit script:

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

If you changed `packages/gateway-sse-client`, also run:

```bash
pnpm run mobile:test:sse
```

## License

MIT, matching the xopc main repo unless stated otherwise.
