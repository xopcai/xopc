# xopc mobile (Expo)

Gateway console companion: HTTP + SSE to your local or remote **xopc gateway** (`POST /api/agent`, `GET /api/sessions`, …).

## Requirements

- Node 22+ (repo standard), `pnpm install` at monorepo root
- A running xopc gateway with a reachable base URL (e.g. `http://192.168.1.10:8787`)

## MMKV and Expo Go

[`react-native-mmkv`](https://github.com/mrousavy/react-native-mmkv) uses native code. **Expo Go** does not ship this native module; the app falls back to in-memory storage (settings are lost on restart).

For persistent storage, use a **development build**:

```bash
pnpm exec expo prebuild
pnpm exec expo run:ios   # or run:android
```

## HTTP (cleartext) on Android

Local gateways often use `http://`. This app sets `android.usesCleartextTraffic: true` in `app.json` for development convenience.

## Scripts

| Command | Description |
|--------|-------------|
| `pnpm -C mobile start` | Expo dev server |
| `pnpm -C mobile run lint` | ESLint |
| `pnpm exec tsc --noEmit -p mobile/tsconfig.json` | Typecheck (or `pnpm run mobile:typecheck` from repo root) |

## Configure

Open **Settings** in the app: set gateway base URL (no trailing slash) and optional bearer token (must match `gateway` auth in `xopc.json`).
