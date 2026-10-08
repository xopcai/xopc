# Native iOS app

The SwiftUI app uses the existing `ai.xopc.xopc` App ID. Its Xcode project is generated from `project.yml` with XcodeGen.

The app icon uses the HarmonyOS artwork with a slightly smaller ring, matching Android’s visible launcher proportions. Regenerate it with `pnpm run assets:brand -- --target=ios`. The static launch screen uses HarmonyOS's light and dark `launch_logo.svg` variants on matching `surface` colors through the iOS asset catalog and `LaunchScreen.storyboard`.

## Local build

```bash
cd apps/mobile-ios
xcodegen generate
xcodebuild -project XopcMobile.xcodeproj -scheme XopcMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO build
```

## TestFlight

The [Native iOS TestFlight workflow](../../.github/workflows/mobile-ios-testflight.yml) runs the Swift checks and unit tests, archives the Release app on a macOS runner, verifies the signed IPA, and uploads it to App Store Connect. It runs when a `mobile-ios-vX.Y.Z` tag is pushed, or manually with a version and an optional upload toggle. Manual builds with upload disabled still produce a downloadable IPA artifact.

The workflow uses the existing iOS distribution secrets for the **main app only**:

- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64` and `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_MAIN_BASE64`
- `APP_STORE_CONNECT_API_KEY`, `APP_STORE_CONNECT_API_ISSUER`, and `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`

The main provisioning profile must identify `${APPLE_TEAM_ID}.ai.xopc.xopc`. No share extension or widget target is currently included, so their profiles are not needed. Version `X.Y.Z` comes from the tag or manual input; each workflow attempt uses its GitHub run number and attempt as `CFBundleVersion`.

The workflow can run only after the native app directory and its assets are committed. TestFlight availability follows App Store Connect processing and any account-level compliance requirements.
