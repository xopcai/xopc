# Google Play release readiness

Updated: 2026-09-04

## Current release

| Item | Status |
| --- | --- |
| Package | `ai.xopc.xopc` |
| Version | `0.0.26` (`versionCode` 26) |
| Artifact | `apps/mobile-expo/dist/android/xopc-android.aab` (local release asset, Git-ignored) |
| Build result | Signed release AAB built successfully on 2026-09-04 |
| Target API | Android 16 / API 36 |
| Architectures | arm64-v8a |
| Firebase client | Valid configuration for `ai.xopc.xopc` |
| Android App Link | `https://link.xopc.ai/.well-known/assetlinks.json` deployed and verified |
| Business model | Free, no ads, no purchases or subscriptions; user-operated gateways only |

## Remaining gates

1. Create and verify the personal Google Play developer account, including the one-time registration fee and Android device verification if requested.
2. Add an in-App report/flag action for offensive AI-generated responses and a developer-controlled report handling path.
3. Remove broad Android contacts permission and retain only user-driven system contact selection, unless Play Console approves broad access as core functionality.
4. Capture Android phone screenshots and finish the Play Store listing with the prepared icon, feature graphic, copy, privacy policy, App access instructions, and declarations.
5. Upload the AAB to internal testing, run smoke tests, then create a closed test.
6. If the personal account was created after 2023-11-13, keep at least 12 testers opted in continuously for 14 days and apply for production access.
7. Create the production release after Google grants production access.

Listing copy and draft declarations are in `apps/mobile-expo/google-play/metadata.md`. Review credentials must remain only in Play Console.
