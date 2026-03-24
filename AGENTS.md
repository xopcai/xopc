# AGENTS.md - xopcbot Development Guide

> Guide for AI assistants working on this repository.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Quick Start](#quick-start)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Model Registry](#model-registry-architecture)
- [Code Style](#code-style-guidelines)
- [Key Patterns](#key-patterns)
- [Common Tasks](#common-tasks)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Web UI](#web-ui)
- [Debugging](#debugging)
- [Troubleshooting](#troubleshooting)
- [When Making Changes](#when-making-changes)

---

## Project Overview

**xopcbot** (`@xopcai/xopcbot`) is a personal AI assistant on Node.js + TypeScript: CLI, HTTP/WebSocket **gateway**, and a **React** gateway console (`web/`). Channels (e.g. Telegram) load as extensions; additional backends appear in config/registry as the project evolves.

| Metric | Value |
|--------|-------|
| Core | TypeScript on Node.js **>= 22** |
| LLM layer | **20+** providers via `@mariozechner/pi-ai` |
| Tests | **vitest** (`src/**/__tests__/*.test.ts`) |

---

## Quick Start

```bash
pnpm install
pnpm run dev -- <command>    # no build required for dev CLI
pnpm run build               # production compile
pnpm test
```

Examples: `pnpm run dev -- agent -i` · `pnpm run dev -- agent -m "Hello"`

---

## Tech Stack

| Area | Stack |
|------|--------|
| Agent | `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai` |
| CLI | `commander` |
| Config | `zod` |
| Tools (schemas) | `@sinclair/typebox` |
| Gateway console | **React** + Vite + Tailwind v4 (`web/` package) |
| Tests | `vitest` |

---

## Project Structure

**Runtime (`src/`)** — main areas agents touch:

| Path | Role |
|------|------|
| `agent/` | `AgentService`, tools, memory, orchestration |
| `channels/` | `ChannelPlugin`, manager, inbound/outbound, `plugins/bundled.ts` |
| `gateway/` | HTTP/WebSocket server, API for UI |
| `cli/` | Commands (self-registration via `registry`) |
| `config/` | Schema, loader, paths |
| `providers/` | `resolveModel`, API keys, pi-ai bridge |
| `session/` | Conversation session store |
| `bus/` | Message bus |
| `extension-sdk/` | `@xopcai/xopcbot/extension-sdk` helpers |

Also present (follow local patterns): `acp/`, `auth/`, `commands/`, `cron/`, `daemon/`, `routing/`, `stt/`, `tts/`, `utils/`, `markdown/`, `infra/`, `errors/`, `heartbeat/`, `extensions/` (core hooks), etc.

**Gateway console (`web/`)** — React SPA (Vite + Tailwind v4): hash router, REST + SSE to the gateway, Zustand + SWR. Production build outputs to `dist/gateway/static/root` (same static root the gateway serves).

**Extensions (`extensions/`)** — workspace packages (e.g. `telegram` → `@xopcai/xopcbot-extension-telegram`).

---

## Model Registry Architecture

`src/providers/index.ts` sits on **`@mariozechner/pi-ai`**: resolve models, map API keys from config/env, expose provider lists to CLI/UI. Provider list and categories live in **`PROVIDER_META`** (e.g. common / specialty / enterprise / oauth). Keys load at process start—restart after credential changes.

| Function | Purpose |
|----------|---------|
| `resolveModel(ref)` | Model id + optional `provider/` prefix |
| `getApiKey` / `isProviderConfigured` | Auth from config or env |
| `getAllProviders` / `getModelsByProvider` | Discovery for UI |

Details: [docs/models.md](./docs/models.md).

---

## Code Style Guidelines

- **Comments:** English only; minimal—non-obvious logic, edge cases, exported APIs (JSDoc).
- **Naming:** `camelCase` (code), `PascalCase` (types/classes), `UPPER_SNAKE_CASE` (constants), `_unused` for unused params, `_privateMethod` for private helpers.
- **Imports:** external deps → internal absolute → relative (blank lines between groups). Example in repo: `src/agent/tools/*.ts`.
- **Files:** `camelCase.ts` sources; `*.test.ts` tests; `*.types.ts` for dedicated type modules.

---

## Key Patterns

### CLI self-registration

`src/cli/commands/<name>.ts` calls `register({ id, factory, metadata })`; wire the module from `src/cli/index.ts`.

### Tools (Typebox)

```typescript
const MyToolSchema = Type.Object({ param: Type.String() });
export const myTool: AgentTool<typeof MyToolSchema, {}> = {
  name: 'my_tool',
  parameters: MyToolSchema,
  async execute(toolCallId, params, signal, onUpdate) {
    return { content: [{ type: 'text', text: '…' }], details: {} };
  },
};
```

Register in `AgentService` / tools index as existing tools do.

### AgentService

`MessageBus` + `AgentService` with `workspace`, `model`, optional `braveApiKey`; `await agent.start()`.

### Channels

Implement `ChannelPlugin` (`src/channels/plugin-types.ts`). Bundled list: `src/channels/plugins/bundled.ts`. Telegram: `extensions/telegram` (`@xopcai/xopcbot-extension-telegram`), re-exported from `src/channels/telegram/index.js`.

**Access:** DM policies `pairing` \| `allowlist` \| `open` \| `disabled`; group `open` \| `disabled` \| `allowlist`. See [Configuration](#configuration).

### Telegram draft streaming

```typescript
import { DraftStreamManager } from '@xopcai/xopcbot-extension-telegram/draft-stream.js';
```

---

## Common Tasks

| Task | Steps |
|------|--------|
| New CLI command | `src/cli/commands/<name>.ts` + register + import in `src/cli/index.ts` |
| New tool | `src/agent/tools/<area>.ts` → export from `src/agent/tools/index.ts` → wire in `AgentService` |
| New provider | Prefer upstream **`pi-ai`**; else OpenRouter / Vercel AI Gateway for custom bases. See [pi-ai](https://github.com/mariozechner/pi-ai). |
| New channel plugin | `ChannelPlugin` + optional `defineChannelPluginEntry` → `bundled.ts` if shipping in core |
| New gateway console screen | `web/src/pages/<name>.tsx` or `web/src/features/<area>/`; register route in `web/src/app.tsx`; follow [Web UI](#web-ui). |
| Dependencies | **`pnpm` only** — never commit `package-lock.json` (use `pnpm-lock.yaml`). |

---

## Configuration

**Default path:** `~/.xopcbot/config.json` (override with `XOPCBOT_CONFIG`).

| Section | Purpose |
|---------|---------|
| `providers` | LLM API keys |
| `agents.defaults` | Default model, limits, temperature |
| `channels` | Telegram and other channel configs |
| `gateway` | HTTP/WebSocket |
| `cron` | Scheduled jobs |
| `extensions` | Enable/disable extensions |

### Telegram (multi-account sketch)

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "botToken": "…",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        }
      }
    }
  }
}
```

`dmPolicy` / `groupPolicy` / `streamMode` (`off` \| `partial` \| `block`) — full examples in repo docs or tests.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, … | Provider keys (at least one LLM key needed to run agents) |
| `BRAVE_API_KEY` | Web search tool |
| `TELEGRAM_BOT_TOKEN` | Telegram (if not only in config) |
| `XOPCBOT_CONFIG` | Config file path |
| `XOPCBOT_WORKSPACE` | Workspace directory |
| `XOPCBOT_LOG_LEVEL` | `trace` … `fatal` (default `info`) |
| `XOPCBOT_LOG_DIR`, `XOPCBOT_LOG_CONSOLE`, `XOPCBOT_LOG_FILE`, `XOPCBOT_LOG_RETENTION_DAYS` | Logging |
| `XOPCBOT_PRETTY_LOGS` | Dev-friendly log formatting |

---

## Testing

```bash
pnpm test
pnpm vitest run src/agent/tools/__tests__/send-media.test.ts
pnpm vitest --watch
pnpm vitest run --coverage
```

Co-located tests: `src/**/__tests__/*.test.ts`. Use `describe` / `it` / `expect` / `vi.mock` like existing files.

---

## Web UI

### Gateway console (React)

The **gateway console** is the **`web/`** package: **React 19**, **React Router 7** (`createHashRouter`), **Vite**, **Tailwind CSS v4** (`@import "tailwindcss"` in app CSS), **Zustand** (gateway/theme/locale stores), **SWR** (`SwrProvider`), **Lucide** icons, **Radix** primitives where needed (e.g. `Dialog`). Roadmap and parity notes: [docs/web-migration-plan.md](./docs/web-migration-plan.md).

```bash
cd web && pnpm install && pnpm run dev    # Vite dev server
cd web && pnpm run build                  # → ../dist/gateway/static/root (gateway static root)
```

| Area | Location / convention |
|------|------------------------|
| App shell, nav | `web/src/components/shell/` (`app-shell.tsx`, `sidebar.tsx`, …) |
| Routes | `web/src/app.tsx` (`createHashRouter`); pages under `web/src/pages/` |
| Feature modules | `web/src/features/<domain>/` (e.g. `chat/`, `gateway/`, `sessions/`) |
| Component primitives | `web/src/components/ui/` (Radix-oriented building blocks) |
| API access | `web/src/lib/fetch.ts` (`apiFetch` / `fetchJson`) + `apiUrl()`; sends `Authorization: Bearer <token>` from `gateway-store` |
| Gateway token / URL | `web/src/stores/gateway-store.ts` |
| i18n | `web/src/i18n/messages.ts` (`en` / `zh`) |
| Global styles + tokens | `web/src/styles/globals.css` (`@theme { … }` for semantic colors) |

**Routing (hash):** `/` → `/chat`; chat `/chat`, `/chat/new`, `/chat/:sessionKey`; management `/sessions`, `/cron`, `/skills`, `/logs`; settings `/settings/:section`. Older `#sessions`-style hashes are normalized at startup (`web/src/lib/legacy-hash.ts`).

**Gateway integration:**

- **REST:** same origin `fetch` via `apiUrl('/api/...')`; 401 → `gateway-store` `onUnauthorized`.
- **Agent streaming:** `POST /api/agent` with `Accept: text/event-stream`, response body parsed as SSE (not WebSocket). See `web/src/features/chat/`.
- **Broadcast SSE:** `GET /api/events` via `EventSource` (optional `?token=`); bridge in `web/src/features/gateway/gateway-sse-bridge.tsx` + `dispatch-sse-event.ts`. Dots in event names become hyphenated `window` events (e.g. `config.reload` → `config-reload`).
- **Navigate to chat from other pages:** `window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: { sessionKey } }))` — handled in `AppShell`.

**Design system:** Follow **[docs/design/ui-design-system.md](./docs/design/ui-design-system.md)** — calm slate neutrals, **blue** only for primary actions / links / AI hints; prefer borders over heavy shadows in dark mode; short copy. Implement with **`web/src/styles/globals.css`** semantic tokens (`bg-surface-*`, `text-fg*`, `border-edge`, `accent`, etc.) and Tailwind utilities—do not add a second token system under `web/` unless extending `@theme` there.

**Lint / typecheck:** `cd web && pnpm run lint` · `pnpm run type-check`. Tests: when added, colocate `web/src/**/__tests__/*.test.ts` and run with root **vitest** if wired; until then, rely on `pnpm run build` for the `web` project.

---

## Debugging

- **Level:** `XOPCBOT_LOG_LEVEL=debug` (or `trace`).
- **CLI:** `pnpm run dev -- config --show` · `config --validate`.
- **Code:** `createRequestLogger` / `clearRequestContext` in `src/utils/logger.ts`; `queryLogs` / `getLogStats` in `src/utils/log-store.ts`.
- **Console logs:** gateway + Log Manager tab (default dev URL is project-specific—use your configured gateway port).

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `ERR_MODULE_NOT_FOUND` | `pnpm install` |
| `@xopcbot/...` not found | `pnpm run build` |
| Tests timeout | API keys / network for live calls |
| Bad config | JSON syntax of `~/.xopcbot/config.json` |
| Console unreachable | Gateway running; browser origin matches gateway URL (REST/SSE) |
| `package-lock.json` | Remove; use pnpm only |
| Telegram silent | Token, BotFather, policies |
| No logs in console | `XOPCBOT_LOG_LEVEL`, file logging flags |
| Cron idle | `cron.enabled` in config |

---

## When Making Changes

| Area | Primary locations |
|------|-------------------|
| Agent | `src/agent/service.ts`, `src/agent/tools/` |
| CLI | `src/cli/commands/` |
| Config | `src/config/schema.ts` (and related) |
| Gateway / API | `src/gateway/` |
| Models & providers | `src/providers/index.ts` |
| Channels | `src/channels/`, `extensions/telegram/` |
| Gateway console (React) | `web/src/`, [ui-design-system.md](./docs/design/ui-design-system.md) |
| Logging | `src/utils/logger.ts`, `src/utils/log-store.ts` |
| Log Manager | `web/src/` (logs feature / pages) |
| Tests | Colocated `__tests__` |

---

_Last updated: 2026-03-25_
