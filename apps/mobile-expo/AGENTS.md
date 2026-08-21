# Repository Guidelines

## Project Overview

`apps/mobile-expo` is the Expo mobile client for the xopc gateway. It connects to a user-hosted gateway over HTTP/WebSocket, supports LAN-first routing, and pairs with FRP by QR code. Before changing Expo or React Native code, confirm Expo `~56` in `package.json` and use the SDK 56 docs.

## Project Structure & Module Organization

- `app/` contains Expo Router routes. Keep files thin and delegate to feature screens.
- `src/features/` contains domains such as `chat`, `notes`, `inbox`, `gateway`, and `sessions`.
- `src/components/`, `src/hooks/`, `src/query/`, `src/stores/`, `src/storage/`, `src/theme/`, `src/i18n/`, `src/api/`, and `src/sync/` contain shared UI, data, state, persistence, tokens, messages, clients, and sync logic.
- `../../packages/realtime-client/` owns the persistent realtime WebSocket client; `../../packages/agent-stream-client/` dispatches agent run events.
- `plugins/` contains Expo config plugins; prefer plugins over generated `android/` or `ios/` patches.

Use `@/*` for `src/*` imports. This app targets iOS and Android only; do not add browser targets, `.web.*` modules, or Web compatibility branches.

## Build, Test, and Development Commands

Use Node.js 22+ and the repository root pnpm version. This app is managed by the root workspace; do not add a separate mobile lockfile or `packageManager`.

- `pnpm install`: from the repository root, install dependencies.
- `pnpm -C apps/mobile-expo start`: start Expo.
- `pnpm run android:mobile`, `pnpm run ios:mobile`: run native targets from the root.
- `pnpm run mobile:lint`: run ESLint.
- `pnpm run mobile:typecheck`: check the app and agent stream package.
- `pnpm run mobile:test`: run Vitest.
- `pnpm run mobile:test:stream`: test the agent stream package.

For persistent MMKV storage, use a development build: `pnpm -C apps/mobile-expo exec expo prebuild`, then `pnpm -C apps/mobile-expo run ios:no-proxy` or Android.

## Coding Style & Architecture Rules

Use TypeScript, React 19, React Native 0.85, Expo Router, React Query, zustand, and react-native-paper. Do not add separate navigation stacks, alternate fetch patterns, or duplicate gesture primitives.

Server data must go through React Query and `src/query/`; do not fetch gateway data from `useEffect`. User text must use `useMessages()` and `src/i18n/locales/`. Do not hardcode visual values; use `useTheme()` and `src/theme/tokens.ts`. Prefer `Pressable`.

## UI & List Interaction Rules

Follow `DESIGN.md`: calm, content-first, restrained, token-driven UI. Minimum touch targets are 44x44.

All scrollable lists share this contract: tap opens, swipe left uses `SwipeableRow`, long press enters multi-select with `LIST_DELAY_LONG_PRESS` (300 ms), and multi-select disables swiping. Reuse `useListSelection`, `ListSelectionCheckbox`, and `BatchActionBar`. Single delete needs undo; batch delete needs `BatchDeleteConfirmDialog`. Notes open at `/items/:id`; chat uses `/chat/[k]`.

## Testing Guidelines

Use Vitest for parsing, cache behavior, sync, route strategy, and other pure logic. Place tests near code in `__tests__/`, for example `notes-local.test.ts`. Run realtime and agent stream tests when touching their workspace packages.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style subjects such as `feat(page): ...`, `feat: ...`, and `chore: ...`. Keep commits scoped. Do not commit or open PRs unless asked. PRs should include summary, tests, linked issues, and UI screenshots.

## Security & Configuration

Do not commit secrets, `.env` files, gateway tokens, pairing tokens, or API keys. Do not upgrade Expo SDK or major dependencies unless requested. After changing `app.json`, native network settings, or config plugins, run `expo prebuild --clean` and rebuild.
