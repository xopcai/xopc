---
name: configure-xopc
description: Configure xopc through guided dialogue — add LLM provider keys (OpenAI, Anthropic, DeepSeek, Google, Groq, …), hook up Telegram bots, enable text-to-speech, set up web search (Brave, Tavily, Bing, SearXNG), tune search region/blocklist, register MCP servers, enable gateway heartbeat, switch the default chat model, and other setup domains. Use whenever the user asks to set up, configure, add a key, connect Telegram, enable voice or TTS, configure web search or MCP, heartbeat, default model, or change xopc settings — in the gateway console, Electron desktop app, or CLI. Always use the `setup` tool as the primary write path when available.
homepage: https://xopcai.github.io/xopc/configuration
metadata:
  xopc:
    emoji: "⚙️"
    requires_tools:
      - setup
    requires_toolsets:
      - terminal
---

# Configure xopc through dialogue

You are configuring xopc itself for the user. Prefer the **`setup` tool** (same pipeline as Settings forms and `POST /api/setup/*`). Do not edit `xopc.json` by hand or ask the user to do so.

## Table of contents

1. [Write path priority](#write-path-priority)
2. [Runtime detection (Electron vs CLI)](#runtime-detection-electron-vs-cli)
3. [Security — handling secrets](#security--handling-secrets)
4. [Standard flow](#standard-flow)
5. [Domain routing](#domain-routing)
6. [LLM providers](#llm-providers)
7. [Telegram channel](#telegram-channel)
8. [Text-to-speech (TTS)](#text-to-speech-tts)
9. [Web search providers](#web-search-providers)
10. [Search tuning (region / blocklist)](#search-tuning-region--blocklist)
11. [MCP servers](#mcp-servers)
12. [Gateway heartbeat](#gateway-heartbeat)
13. [Default chat model](#default-chat-model)
14. [Settings-only domains (guidance)](#settings-only-domains-guidance)
15. [Anti-patterns](#anti-patterns)

## Write path priority

1. **`setup` tool** — primary path in Chat, Electron, and gateway (works without `xopc` on PATH, no TTY needed).
2. **Settings UI** — when the user must enter a secret and has not pasted it in chat. Give hash links: `#/settings/providers`, `#/settings/channels`, `#/settings/voice`, `#/settings/search`, `#/settings/agent-mcp`, `#/settings/heartbeat`, `#/settings/credentials`.
3. **`xopc` CLI via `shell`** — fallback only when `setup` is unavailable **and** `xopc` is on PATH. Never use interactive CLI prompts in Chat (no TTY).

## Runtime detection (Electron vs CLI)

Before giving path or restart advice, discover runtime via **`setup` tool `op: manifest`** context or **`GET /api/status`**:

| Field | Meaning |
|---|---|
| `runtime: "electron"` | Desktop app — config under app userData (not `~/.xopc`) |
| `runtime: "cli"` | Standalone gateway / browser against CLI install |
| `configPath` | Actual `xopc.json` location |
| `hotReloadEnabled` | When `false` (Electron), CLI file writes need gateway restart |
| `gatewayPort` | Default **28790** in Electron, **18790** for typical CLI |

**Electron restart:** tell the user **Settings → Gateway → Restart Gateway** (or quit and reopen the app). Do **not** say `xopc gateway restart`.

**CLI gateway restart:** `xopc gateway restart` after Telegram add, MCP server changes, or when hot reload is off.

**Separate Terminal CLI:** warn that bare `xopc` commands use `~/.xopc` unless `--config` / `XOPC_CONFIG_PATH` points at the app config.

## Security — handling secrets

**Never repeat API keys, bot tokens, MCP headers, or passwords in your reply.** Chat history is persisted.

| Scenario | Action |
|---|---|
| User has **not** provided the secret | Explain steps + link to Settings (`#/settings/...`). Use `clarify` to confirm provider/channel if needed. |
| User **pasted** the secret in chat | `setup` invoke with `fields.key` / `fields.token` / header values in `fields.servers`, **`dryRun: true` first**, then apply. Reply using masked `value` from outcome only. |
| Env-only provider | `setup` invoke `providers/list` — if `env-only`, often no write needed. |

## Standard flow

1. **Discover:** `setup` tool `op: manifest` (or read `/api/status` for runtime).
2. **Confirm intent** in one short sentence (domain + target).
3. **Dry-run:** `setup` invoke with `dryRun: true`. Show `changedPaths`, masked `value`, `notes`.
4. **Apply:** re-run with `dryRun: false`.
5. **Verify:** domain-specific read (see sections below).
6. **Next step:** restart guidance per runtime (see above).

## Domain routing

| User intent | Setup domain / action | Settings deep link |
|---|---|---|
| Provider API keys | `providers` / `set-key`, `list` | `#/settings/providers` |
| Telegram bot | `channels.telegram` / `add` | `#/settings/channels` |
| TTS / voice | `voice` / `enable`, `disable`, `status`, `configure` | `#/settings/voice` |
| Search providers | `search` / `add`, `remove`, `list` | `#/settings/search` |
| Search region / blocklist | `search` / `configure` | `#/settings/search` |
| MCP servers | `mcp` / `configure`, `list` | `#/settings/agent-mcp` |
| Heartbeat polling | `heartbeat` / `configure` | `#/settings/heartbeat` |
| Default chat model only | `agents` / `set-model` | `#/settings/credentials?tab=models` |
| Full agent defaults (browser, tools, memory) | — (guidance) | `#/settings/agent-defaults` |
| Gateway bind / auth | — (guidance) | `#/settings/gateway` |
| OAuth login | — (guidance) | `#/settings/providers` |
| Feishu / Weixin QR | — (guidance) | `#/settings/channels` |
| Cron jobs | — (guidance) | `#/settings/cron` |
| Remote access / tunnel | — (guidance) | `#/settings/remote-access` |

Bulk channel edits: `channels/configure` with `fields.channels` / `fields.bindings`.

---

## LLM providers

**Triggers:** add OpenAI / Anthropic / DeepSeek key, switch model provider, user pastes `sk-`, `sk-ant-`, …

### Discover

```
setup { "op": "invoke", "domain": "providers", "action": "list" }
```

### Set key (user already provided secret)

```
setup { "op": "invoke", "domain": "providers", "action": "set-key", "fields": { "provider": "openai", "key": "<value>" }, "dryRun": true }
```

Then apply without `dryRun`. Optional `fields.profile` for multi-profile keys.

### Without secret

Guide to **`#/settings/providers`** (Configure with AI from that page works too).

### Verify

Re-run `providers/list` or check Settings — status should be `configured`.

OAuth-only providers: use Settings OAuth flow, not `set-key`.

---

## Telegram channel

**Triggers:** connect Telegram, BotFather token, token shape `\d{5,}:…`

### Prerequisite

User needs a BotFather token. If missing, walk through `@BotFather` `/newbot`. Do not ask them to paste the token unless they already did.

### Add (secret in chat)

```
setup { "op": "invoke", "domain": "channels.telegram", "action": "add", "fields": { "token": "<value>", "account": "default" }, "dryRun": true }
```

### Without secret

**`#/settings/channels`**

### Verify

`channels.telegram` in manifest / Channels settings — `enabled` + `configured`.

### Online + pairing

After add, restart gateway per runtime. Default DM **pairing** — user messages bot, then approve pairing (CLI: `xopc channels pairing approve …`; in Chat, explain in plain language).

---

## Text-to-speech (TTS)

**Triggers:** enable voice, TTS, Edge voice, speak on inbound only.

### Show state

```
setup { "op": "invoke", "domain": "voice", "action": "status" }
```

Or Settings → Voice.

### Enable (free Edge, inbound trigger)

```
setup { "op": "invoke", "domain": "voice", "action": "enable", "fields": { "provider": "edge", "trigger": "inbound" }, "dryRun": true }
```

Or `action: "configure"` with full `fields.tts` blob (matches Settings panel).

Paid provider: confirm `providers/list` shows key configured first.

### Disable

```
setup { "op": "invoke", "domain": "voice", "action": "disable" }
```

---

## Web search providers

**Triggers:** Brave / Tavily / SearXNG, weak search results.

### List

```
setup { "op": "invoke", "domain": "search", "action": "list" }
```

Returns providers plus region / blocklist summary. Also visible in **`#/settings/search`**.

### Add API provider (secret provided)

```
setup { "op": "invoke", "domain": "search", "action": "add", "fields": { "type": "tavily", "key": "<value>" }, "dryRun": true }
```

### SearXNG (URL only)

```
setup { "op": "invoke", "domain": "search", "action": "add", "fields": { "type": "searxng", "url": "http://host:8080" } }
```

Do not use `localhost` if gateway runs elsewhere.

### Remove

```
setup { "op": "invoke", "domain": "search", "action": "remove", "fields": { "type": "brave" } }
```

---

## Search tuning (region / blocklist)

**Triggers:** China region search, global region, block domains, max results count.

### Configure

```
setup { "op": "invoke", "domain": "search", "action": "configure", "fields": { "region": "cn", "maxResults": 8, "blocklistEnabled": true, "blocklistDomains": ["example.com"] }, "dryRun": true }
```

`region`: `auto` | `cn` | `global`. Omit fields you are not changing.

### Verify

Re-run `search/list` or check **`#/settings/search`**.

---

## MCP servers

**Triggers:** add MCP server, stdio MCP, SSE MCP, connect GitHub/filesystem MCP.

### List (no secrets)

```
setup { "op": "invoke", "domain": "mcp", "action": "list" }
```

### Configure (stdio example)

```
setup { "op": "invoke", "domain": "mcp", "action": "configure", "fields": { "servers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<token>" } } } }, "dryRun": true }
```

HTTP/SSE: use `url` + optional `transport` (`sse` | `streamable-http`) and `headers`. Replace the entire `servers` map (same as Settings save).

### Without secret

Guide to **`#/settings/agent-mcp`** for header/env entry.

### Verify

`mcp/list` or Settings MCP panel test connection.

Restart gateway per runtime after MCP registry changes if tools do not appear.

---

## Gateway heartbeat

**Triggers:** enable heartbeat, periodic check-ins, heartbeat to Telegram, active hours.

### Configure

```
setup { "op": "invoke", "domain": "heartbeat", "action": "configure", "fields": { "enabled": true, "intervalMs": 1800000, "target": "telegram", "targetChatId": "<chat-id>" }, "dryRun": true }
```

Optional: `prompt`, `ackMaxChars`, `isolatedSession`, `includeSystemPromptSection`, `activeHours: { "start": "09:00", "end": "22:00", "timezone": "Asia/Shanghai" }`.

### Verify

**`#/settings/heartbeat`** — use "Run now" to test delivery.

Heartbeat markdown content still edits via Settings workspace heartbeat file, not setup.

---

## Default chat model

**Triggers:** switch default model, set fallback models, change primary LLM.

**Scope:** only `agents.defaults.model` — not browser, tools, memory, or workspace tabs.

### Set model

```
setup { "op": "invoke", "domain": "agents", "action": "set-model", "fields": { "model": "anthropic/claude-sonnet-4-5" }, "dryRun": true }
```

With fallbacks:

```
setup { "op": "invoke", "domain": "agents", "action": "set-model", "fields": { "model": { "primary": "openai/gpt-4o", "fallbacks": ["anthropic/claude-sonnet-4-5"] } }, "dryRun": true }
```

### Full agent defaults

Guide to **`#/settings/agent-defaults?tab=`** slices for browser, tools, memory, etc.

---

## Settings-only domains (guidance)

These have **no setup write handler** in this phase — link to Settings and explain steps:

| Domain | Link | Notes |
|---|---|---|
| Gateway bind / port / auth | `#/settings/gateway` | High restart risk — user confirms in UI |
| OAuth provider login | `#/settings/providers` | Interactive browser OAuth |
| Feishu / Weixin | `#/settings/channels` | QR / pairing flows in UI |
| Cron jobs | `#/settings/cron` | Jobs stored separately from `xopc.json` slices |
| Remote access / FRP / Tailscale | `#/settings/remote-access` | Tunnel consent + security review |

---

## Anti-patterns

- Do not edit `xopc.json` manually when `setup` exists.
- Do not recommend CLI interactive prompts (`xopc providers set-key` without `--key`) in Chat.
- Do not echo secrets in replies.
- Do not skip dry-run for first-time writes.
- Do not tell Electron users to run `xopc gateway restart` or edit `~/.xopc/xopc.json`.
- Do not use `xopc auth set <provider> <key>` — prefer `setup` providers/set-key.
- Do not use `PATCH /api/config` when a setup handler exists for the same fields.
