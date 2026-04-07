# Electron desktop app

This repository ships an optional **Electron** shell that embeds the same gateway + React UI as the browser, with a locally spawned gateway process for packaged builds.

## Modes

| Mode | How it runs | Gateway |
|------|-------------|---------|
| **Packaged app** (`app.isPackaged`) | Main process starts the bundled CLI (`out/server/index.js`) with `gateway --foreground`, then loads `http://127.0.0.1:<port>/?token=…#/chat`. | Embedded child process; config under Electron `userData` (`xopcbot.json`). |
| **Dev: Vite + Electron** (`electron:dev`) | Renderer loads from the Vite dev server (`ELECTRON_RENDERER_URL`, e.g. `:5173`). API calls proxy to `localhost:18790` (see `electron.vite.config.ts`). | You usually run the gateway yourself (`pnpm dev -- gateway` or equivalent). |
| **Dev: static `file://` renderer** | No `ELECTRON_RENDERER_URL`, no embedded gateway bundle → `loadFile` to `out/renderer/index.html`. | No auto-start; connect manually or enable `ELECTRON_EMBED_GATEWAY=1` with a built server bundle. |

## First launch (packaged)

1. Main ensures config exists (`ensureGatewayConfigForElectron`): workspace + gateway token on disk.
2. A **loading screen** (data URL) appears while `/health` becomes ready.
3. The UI opens with the token in the query string (then stripped by the client). Use **Settings → Providers / Models** if chat cannot start (no API keys or no default model).

## Build commands (developers)

```bash
pnpm run build
pnpm run electron:vite:build
pnpm run electron:server:build
pnpm run electron:package
```

The error dialog on gateway startup failure references these steps.

## Related files

- `electron/main.ts` — window, embedded gateway lifecycle, loading URL.
- `electron/ensure-gateway-config.ts` — `userData` config + token.
- `electron/gateway-process.ts` — spawn CLI, health wait, shutdown.
- `electron/preload.ts` — `window.electronAPI` (files, search, startup/gateway events).
