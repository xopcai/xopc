# AGENTS.md - xopc Development Guide

> Guide for AI assistants working on this repository.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Quick Start](#quick-start)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Model Registry](#model-registry-architecture)
- [Code Style](#code-style-guidelines)
- [Logging conventions](#logging-conventions)
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

**xopc** (`@xopcai/xopc`) is a personal AI assistant on Node.js + TypeScript: CLI, HTTP/SSE **gateway** (REST + Server-Sent Events), and a **React** gateway console (`web/`). Channels (e.g. Telegram) load as extensions; additional backends appear in config/registry as the project evolves.

| Metric | Value |
|--------|-------|
| Core | TypeScript on Node.js **>= 22** |
| LLM layer | **~23** built-in providers via `@earendil-works/pi-ai` (`KnownProvider`); more via `models.json` |
| Tests | **vitest** (`src/**/__tests__/*.test.ts`) |

---

## Quick Start

```bash
pnpm install
pnpm run dev -- <command>    # no build required for dev CLI
pnpm run build               # Node: tsdown (`tsdown.config.ts`) + web; types: `pnpm run typecheck`
pnpm test
```

Examples: `pnpm run dev -- agent -i` · `pnpm run dev -- agent -m "Hello"`

---

## Tech Stack

| Area | Stack |
|------|--------|
| Agent | `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` |
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
| `agent/` | `AgentService`, tools, memory, orchestration (core entry files at root; helpers grouped under `context/`, `lifecycle/`, `prompt/`, `transcript/` — transcript hygiene, thinking-level types, etc.) |
| `agent/mcp/` | Outbound bundle-MCP: session runtimes, transports, tool materialize (`server__tool` names) |
| `mcp/` | Inbound channel bridge (`xopc mcp serve`) — stdio MCP server + gateway REST/SSE client |
| `channels/` | `ChannelPlugin`, manager, inbound/outbound, `attachments/`, `plugins/bundled.ts` |
| `gateway/` | HTTP + SSE server, API for UI; `heartbeat/` keep-alive service |
| `cli/` | Commands (self-registration via `registry`) |
| `config/` | Schema, loader, paths |
| `providers/` | `resolveModel`, API keys, pi-ai bridge |
| `session/` | Conversation session store |
| `infra/` | Infrastructure primitives (`retry`, rate-limit, `bus/` message bus) |
| `extensions/` | Extension runtime; `extensions/sdk/` re-exports `@xopcai/xopc/extension-sdk` |

Also present (follow local patterns): `auth/`, `chat-commands/` (in-chat slash commands), `cron/`, `daemon/`, `routing/`, `voice/stt/`, `voice/tts/`, `utils/` (`logger.ts` barrel → `logger/` implementation + `helpers.ts`), `markdown/`, `errors/`, etc.

**Gateway console (`web/`)** — React SPA (Vite + Tailwind v4): hash router, REST + SSE to the gateway, Zustand + SWR. Production build outputs to `dist/gateway/static/root` (same static root the gateway serves).

**Extensions (`extensions/`)** — optional add-ons; **Telegram / Weixin** channel *sources* live in `extensions/telegram` and `extensions/weixin` but are **`private`** workspace packages (not published). **`tsdown`** (Rolldown) **unbundle** mode emits `dist/src/**` and `dist/extensions/**` in one pass. Wiring: `src/generated/bundled-channel-plugins.ts` (`pnpm run generate:bundled-channels`) and `src/channels/plugins/bundled.ts`.

---

## Model Registry Architecture

`src/providers/index.ts` sits on **`@earendil-works/pi-ai`**: resolve models, map API keys from config/env, expose provider lists to CLI/UI. The built-in provider id set matches upstream **`KnownProvider`**; **`PROVIDER_META`** adds display names and categories (common / specialty / enterprise / oauth). Extra vendors are added only when present in `models.json`. Keys load at process start—restart after credential changes.

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

## Logging conventions

Use **`createLogger('Prefix')`** from `src/utils/logger.ts` (Pino under the hood). Prefer a **stable module prefix** (e.g. `AgentService`, `Hono:Auth`) so gateway **Log Manager** and file logs filter cleanly.

### Shape: object first, message second

```typescript
const log = createLogger('MyModule');

log.info({ sessionKey, durationMs }, 'Session saved');
log.warn({ path, errorMessage: em }, `Config read failed: ${em}`);
log.error({ err, requestId, phase: 'outbound_consume' }, `Outbound pipeline failed: ${em}`);
```

- **First argument:** structured fields (`err`, `sessionKey`, `path`, `tool`, `phase`, counts, ids). Pass **`Error` instances as `err`** so the formatter keeps **name / message / stack**.
- **Second argument (`msg`):** a **short, scannable sentence** for humans and UIs that mostly show the message column. Repeat the **one-line outcome** there (e.g. failure reason), not only in fields.
- For non-`Error` throws, add **`errorMessage: String(x)`** (and/or embed the text in `msg`) so logs stay grep-friendly.

### What to include for debugging

- **Identity:** `sessionKey`, `channel`, `chatId`, `requestId` (often injected via async context—see below), file **`path`**, **`tool` / `toolName`**, **`modelRef`** or `provider` + `modelId`.
- **Operation:** a **`phase`** or verb in `msg` (`inbound_consume`, `publishOutbound`, `lifecycle emit llm_request`, …).
- **Bounded previews:** long strings as **`contentPreview` / `linePreview` / `goalPreview`** (truncated), not full payloads.

### What to avoid

- **Vague `msg` only** (`'failed'`, `'Error'`) with no structured context.
- **Spam:** do not emit the same **warn/error on every iteration** once a condition is true (e.g. “approaching limit” on each LLM call). Log **once** when crossing the threshold or once per logical phase.
- **Secrets:** avoid logging raw tokens, API keys, or full `Authorization` headers. Structured redaction runs in `src/utils/logger/redact.ts`; disable only with care via **`XOPC_LOG_REDACTION=false`**.

### Request correlation (gateway / agent)

HTTP and SSE paths attach context via **`runWithLogContext` / `updateAsyncLogContext`** (`src/utils/logger/context.ts`) and gateway middleware (`src/gateway/hono/middleware/log-context.ts`). Prefer keeping **`requestId`** (and related keys) in async context so logs tie to a single API call without threading an argument through every function.

### Reference

- Implementation: `src/utils/logger/` (`index.ts`, `context.ts`, `log-store.ts`, `redact.ts`, …).
- Longer notes: `src/utils/README.logger.md`.

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

`MessageBus` + `AgentService` with `workspace`, `model`, and `config` (including `tools.web.search` for web search); `await agent.start()`.

### Channels

Implement `ChannelPlugin` (`src/channels/plugin-types.ts`). Bundled list: `src/channels/plugins/bundled.ts` (imports `src/generated/bundled-channel-plugins.ts`). Telegram / Weixin: sources under `extensions/telegram`, `extensions/weixin`; stable imports from `src/channels/telegram/index.js`, `src/channels/weixin/index.js`.

**Access:** DM policies `pairing` \| `allowlist` \| `open` \| `disabled`; group `open` \| `disabled` \| `allowlist`. See [Configuration](#configuration).

### Telegram draft streaming

```typescript
import { DraftStreamManager } from '@xopcai/xopc/channels/telegram/draft-stream.js';
```

---

## Common Tasks

| Task | Steps |
|------|--------|
| New CLI command | `src/cli/commands/<name>.ts` + register + import in `src/cli/index.ts` |
| Package / gateway update | `src/infra/update-runner.ts` (`runGatewayUpdateWithPostSteps`), `src/extensions/update.ts`, `src/infra/update-restart.ts`; CLI `update`, gateway `POST /api/update/*` — see [docs/update.md](./docs/update.md) |
| New tool | `src/agent/tools/<area>.ts` → export from `src/agent/tools/index.ts` → wire in `AgentService` |
| New provider | Prefer upstream **`pi-ai`**; else OpenRouter / Vercel AI Gateway for custom bases. See [pi-ai](https://github.com/earendil-works/pi-mono). |
| New channel plugin | `ChannelPlugin` + optional `defineChannelPluginEntry` → `bundled.ts` if shipping in core |
| New gateway console screen | `web/src/pages/<name>.tsx` or `web/src/features/<area>/`; register route in `web/src/app.tsx`; follow [Web UI](#web-ui). |
| MCP servers / channel bridge | Config: `mcp.servers` in `xopc.json`; outbound runtime `src/agent/mcp/`; inbound `src/mcp/` + `xopc mcp serve`; UI `#/settings/agent-mcp`. See [docs/cli/mcp.md](./docs/cli/mcp.md). |
| Dependencies | **`pnpm` only** — never commit `package-lock.json` (use `pnpm-lock.yaml`). |
| GitHub issues / PRs | Templates under `.github/ISSUE_TEMPLATE/`; process in **[CONTRIBUTING.md](./CONTRIBUTING.md)**; sync labels with `./scripts/sync-github-labels.sh` |
| Electron desktop | Packaged app: `pnpm run build && pnpm run electron:build`. The **main process** runs minimal shell code; first-time `userData` config init uses **Zod (`ConfigSchema`) only** via `initWorkspace({ skipChannelPluginValidation: true })` so it does not load bundled channel plugins. **Channel plugin `configSchema.validate`** still runs when the **gateway subprocess** (`out/server/index.js`) starts. |

---

## Configuration

**Default path:** `~/.xopc/xopc.json` (override with `XOPC_CONFIG` or `XOPC_CONFIG_PATH`).

| Section | Purpose |
|---------|---------|
| `providers` | LLM API keys |
| `agents.defaults` | Default model, typed model roles (`models[]`), limits, temperature |
| `channels` | Telegram and other channel configs |
| `gateway` | HTTP + SSE |
| `mcp` | Outbound MCP server registry (`mcp.servers`) + session idle TTL |
| `cron` | Scheduled jobs |
| `extensions` | Enable/disable extensions |

### Multiple agents (`agents.list`)

Runtime behavior (model, workspace, tools, prompts per **session key** agent id) is driven by the main config file (`xopc.json` by default) — `agents.defaults` merged with the matching entry in **`agents.list`**. Default agent id: **`agents.default`**, else a `list` entry with **`default: true`**, else the first enabled entry, else **`main`**. Display identity (name, description, language, avatar) is read from **`~/.xopc/agents/<id>/profile/IDENTITY.md`**. On-disk paths (`~/.xopc/agents/<id>/` including **`profile/`** Markdown, Markdown workspace roots) resolve from the same config via **`src/agent/agent-scope.ts`**.

**Typed model roles** (`agents.defaults.models.roles` and per-agent `agents.list[].models.roles`): named slots like `small` / `large` mapping to `provider/model` refs. Per-agent roles override defaults by id. Workflows reference them in `agent({ model: 'small' })` or `meta.phases[].model`. Resolution: `src/config/agent-typed-models.ts`.

Use **`xopc agents list`**, **`xopc agents add`**, **`xopc agents delete`** to manage `agents.list` and initialize directories — there is no separate agent registry outside config.

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
| Per-provider env vars | See `src/providers/env-keys.ts` **`PROVIDER_ENV_MAP`** (aligned with pi-ai, e.g. `OPENAI_API_KEY`, `ANTHROPIC_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`, `AI_GATEWAY_API_KEY` / `VERCEL_AI_GATEWAY_API_KEY`, …). DashScope (image, speech, STT): `DASHSCOPE_API_KEY` (`dashscope` service id). Custom OpenAI-compatible vendors: configure in `models.json`. |
| `TELEGRAM_BOT_TOKEN` | Telegram (if not only in config) |
| `XOPC_CONFIG`, `XOPC_CONFIG_PATH` | Config file path |
| `XOPC_SKILLS_STORE_URL` | Overrides `gateway.skillsStoreBaseUrl` (skills marketplace REST base) |
| `XOPC_WORKSPACE` | Workspace directory |
| `XOPC_LOG_LEVEL` | `trace` … `fatal` (default `info`) |
| `XOPC_LOG_DIR`, `XOPC_LOG_CONSOLE`, `XOPC_LOG_FILE`, `XOPC_LOG_RETENTION_DAYS` | Logging |
| `XOPC_PRETTY_LOGS` | Dev-friendly log formatting |
| `XOPC_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_ID`, `XOPC_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET` | Google Antigravity OAuth (Cloud Code–style desktop client; required for `xopc auth` / gateway OAuth on that provider — set locally, never commit) |
| `XOPC_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID`, `XOPC_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_SECRET` | Google Gemini CLI (Cloud Code Assist) OAuth — same as above |

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

See [Testing](#testing).

### Remote access

Gateway defaults to loopback. External access layers:

| Layer | Config / CLI | Docs |
|-------|----------------|------|
| Tailscale Serve | `gateway.tailscale.mode=serve`, `xopc gateway --tailscale serve` | [docs/gateway/tailscale.md](./docs/gateway/tailscale.md) |
| SSH tunnel | `xopc gateway ssh-tunnel --target user@host` | [docs/gateway/remote.md](./docs/gateway/remote.md) |
| FRP public tunnel | `tunnel.*`, `#/settings/remote-access` | [docs/remote-access.md](./docs/remote-access.md) · [tunnel-security](./docs/tunnel-security.md) |
| CLI remote mode | `gateway.mode=remote`, `gateway.remote.*` | [docs/network.md](./docs/network.md) |

Key paths: `src/infra/tailscale.ts`, `src/gateway/tailscale-lifecycle.ts`, `src/remote-access/`, `src/tunnel/`.

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

**Routing (hash):** `/` → `/chat`; chat `/chat`, `/chat/new`, `/chat/:sessionKey`. Full-screen **settings** shell: `/settings/gateway`, `/settings/agent-mcp`, `/settings/appearance`, `/settings/providers`, `/settings/models`, `/settings/agents`, `/settings/search`, `/settings/heartbeat`, **`/settings/cron`**, **`/settings/skills`**, `/settings/sessions`, `/settings/logs`, **`/settings/channels`**, `/settings/voice`. **Agent defaults** merge into `/settings/agent-defaults` with `?tab=` slices (`chat`, `workspace`, `browser`, `runtime`, `context`, `memory`, `tools`, `skills`, `system-prompt`); legacy `#/settings/agent-*` paths redirect to the matching tab. Goal checking (`cron.goals`) lives on the **Cron** page, not agent defaults. The settings left rail lists each agent-defaults slice; command palette includes the same routes. Top-level **`/cron`**, **`/skills`**, **`/channels`**, **`/mcp`**, `/sessions`, `/logs` redirect into the matching `/settings/...` route (bookmark-safe).

**Gateway integration:**

- **REST:** same origin `fetch` via `apiUrl('/api/...')`; 401 → `gateway-store` `onUnauthorized`.
- **Agent streaming:** `POST /api/agent` with `Accept: text/event-stream`, response body parsed as SSE (not WebSocket). See `web/src/features/chat/`.
- **Broadcast SSE:** `GET /api/events` via `EventSource` (optional `?token=`); bridge in `web/src/features/gateway/gateway-sse-bridge.tsx` + `dispatch-sse-event.ts`. Dots in event names become hyphenated `window` events (e.g. `config.reload` → `config-reload`).
- **Navigate to chat from other pages:** `window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: { sessionKey } }))` — handled in `AppShell`.

**Design system:** Follow **[docs/design/ui-design-system.md](./docs/design/ui-design-system.md)** — calm slate neutrals, **blue** only for primary actions / links / AI hints; prefer borders over heavy shadows in dark mode; short copy. Implement with **`web/src/styles/globals.css`** semantic tokens (`bg-surface-*`, `text-fg*`, `border-edge`, `accent`, etc.) and Tailwind utilities—do not add a second token system under `web/` unless extending `@theme` there.

**Modal sizing:** Complex modals and detail dialogs must use a fixed responsive outer size (`h-[min(...)]` + fixed width) with `overflow-hidden`; keep header/footer fixed and put variable content in an internal `min-h-0 flex-1 overflow-y-auto` region. Do not let modal height shrink/grow based on content, because different records should not cause visual jumps.

**Lint / typecheck:** `cd web && pnpm run lint` · `pnpm run type-check`. Tests: when added, colocate `web/src/**/__tests__/*.test.ts` and run with root **vitest** if wired; until then, rely on `pnpm run build` for the `web` project.

---

## Debugging

- **Level:** `XOPC_LOG_LEVEL=debug` (or `trace`).
- **CLI:** `pnpm run dev -- config show` · `config validate` · (`config --show` / `config --validate` legacy aliases).
- **Code:** `runWithLogContext` / `updateAsyncLogContext` in `src/utils/logger/context.ts`; `queryLogs` / `getFileLogStats` in `src/utils/logger/log-store.ts`; `getRuntimeLogStats` in `src/utils/logger/stats.ts`.
- **Console logs:** gateway + Log Manager tab (default dev URL is project-specific—use your configured gateway port).
- **New logs:** follow [Logging conventions](#logging-conventions).

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `ERR_MODULE_NOT_FOUND` | `pnpm install` |
| `@vscode/ripgrep` missing at runtime | `allowBuilds` in `pnpm-workspace.yaml` must include `@vscode/ripgrep` (ships the `rg` binary); re-run `pnpm install` |
| `@xopc/...` not found | `pnpm run build` |
| Tests timeout | API keys / network for live calls |
| Bad config | JSON syntax of `~/.xopc/xopc.json` |
| Console unreachable | Gateway running; browser origin matches gateway URL (REST/SSE) |
| `package-lock.json` | Remove; use pnpm only |
| Telegram silent | Token, BotFather, policies |
| No logs in console | `XOPC_LOG_LEVEL`, file logging flags |
| Cron idle | `cron.enabled` in config |
| `browser_use` tool error at first use | Enable `agents.defaults.browser.enabled`; install Chromium once with `npx playwright install chromium` (`playwright-core` does not ship browsers) |

---

## When Making Changes

### Session transcript (LLM vs on-disk rows)

- **Authoritative storage:** `~/.xopc/xopc.db` (SQLite). Session metadata, transcripts, per-session config, compaction checkpoints, and FTS5 search all live in `src/storage/sqlite/`. Gateway opens the DB on start via `openXopcDatabase()`.
- **Runtime write path:** Gateway, channels, and CLI turns use `runXopcEmbeddedTurn` → `openSqliteHydratingSessionManager` (in-memory pi `SessionManager` hydrated from SQLite) → `guardSessionManager` appends → `emitSessionTranscriptUpdate` → `SessionStore.syncEmbeddedTranscriptUpdate` → `appendTranscriptEntry` (SQLite). Do **not** add turn-end `SessionStore.save` / `saveMessages` on agent paths.
- **Index:** `SessionIndex` (`src/session/manager.ts`) delegates to `SessionStore`; `onSessionTranscriptUpdate` bumps counts after appends.
- **Model input:** Use `SessionStore.loadMessages` / `sessionStore.load` (they apply `buildSessionContextForLlm`). If you parse transcript rows yourself, run `buildSessionContextForLlm(rows)` before passing history to the LLM.
- **Webchat abort cutoff:** `POST /api/agent` accepts optional `clientCreatedAtMs`. When it is **omitted**, `abortCutoffTimestamp` does **not** drop stale POSTs (clients must send send-time for skip semantics). Abort uses `abortEmbeddedRun` + context rows via `appendCustomEntry`.
- **Audit rows:** `kind: 'context'` entries persist for ops/UI via `GET /api/sessions/:key?include=transcriptRows` (comma-separated with `transcript` if you also want `transcriptSummary`).
- **JSON export:** `SessionStore.exportSession(..., 'json')` includes `transcriptRows` (full stored order) alongside API-shaped `messages` (LLM-only). Session text search uses FTS5 over transcript content.
- **Reset (`/new`, TUI `/reset`):** `performSessionReset` (`src/gateway/session-reset-service.ts`) archives the active transcript row in SQLite, assigns a new `sessionId` for the same session key, and keeps per-session overrides (`session_config`, thinking/verbose on the session row). Gateway: `POST /api/sessions/:key/reset`. **Delete** (`DELETE /api/sessions/:key`) removes the key from the index — do not use delete for `/new`.
- **Integrity:** `xopc doctor --deep` runs SQLite session linkage checks and `PRAGMA integrity_check`.

| Area | Primary locations |
|------|-------------------|
| Agent | `src/agent/service.ts`, `src/agent/tools/`, `src/agent/context/`, `src/agent/lifecycle/` |
| CLI | `src/cli/commands/` |
| In-chat slash commands | `src/chat-commands/` |
| Config | `src/config/schema.ts` (and related) |
| Gateway / API | `src/gateway/` |
| Models & providers | `src/providers/index.ts` |
| Channels | `src/channels/` (+ `extensions/telegram`, `extensions/weixin` sources → `dist/extensions/`) |
| Gateway console (React) | `web/src/`, [ui-design-system.md](./docs/design/ui-design-system.md) |
| Logging | `src/utils/logger.ts` (barrel) → `src/utils/logger/`; conventions: [Logging conventions](#logging-conventions) |
| Log Manager | `web/src/` (logs feature / pages) |
| Tests | Colocated `__tests__` |
| Session store / SQLite | `src/session/store.ts`, `src/storage/sqlite/`, `src/session/session-context-for-llm.ts`, `src/gateway/session-reset-service.ts` |

---

_Last updated: 2026-06-15_
