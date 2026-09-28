# HarmonyOS recent changes parity for Android and iOS

Status: confirmed by the user's instruction to inspect recent HarmonyOS work and align Android/iOS.

## Scope

Use the native HarmonyOS implementation and the recent product feedback as an audit source, while preserving the existing React Native architecture shared by Android and iOS. Do not reimplement capabilities already present in Expo.

The concrete gaps are: workspace search/filter/count hierarchy, richer task/project/automation list presentation, user-message references below primary text, and image-only composer thumbnails without file metadata. Existing local-session materialization, Agent selection race guards, attachment persistence, retry/error display, and first-send recovery remain authoritative in Expo.

## Contract and architecture

No Gateway API change. React Query remains the data boundary; task/project/automation filtering is local over the loaded collection. Chat history storage order remains unchanged; only presentation order changes. Image composer previews keep preview/edit/remove behavior and accessible labels while hiding visual filenames.

## Delivery and recovery

Implement in shared React Native source so both platforms receive the same behavior. Verify with focused Vitest coverage, TypeScript, ESLint, Android Gradle compilation, and iOS xcodebuild where the local toolchain is available. Rollback is a client code revert; no data migration is involved.
