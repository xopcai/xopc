# Configuration Reference

All xopc configuration is centralized in `~/.xopc/xopc.json`.

## Quick Start

Run the interactive setup wizard:

```bash
xopc onboard
```

Or create manually:

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  },
  "providers": {
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

---

## Full Configuration Example

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.xopc/workspace",
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
      },
      "max_tokens": 8192,
      "temperature": 0.7,
      "max_tool_iterations": 20
    }
  },
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "groq": "${GROQ_API_KEY}",
    "google": "${GOOGLE_API_KEY}",
    "minimax": "${MINIMAX_API_KEY}"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        }
      }
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  },
  "tools": {
    "web": {
      "search": {
        "maxResults": 5,
        "providers": [{ "type": "brave", "apiKey": "BSA_your_key_here" }]
      }
    }
  },
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "inbound",
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "tts-1",
      "voice": "alloy"
    }
  },
  "heartbeat": {
    "enabled": true,
    "intervalMs": 300000
  }
}
```

---

## Configuration Sections

### agents

Agent configuration has three parts: optional **`default`** id, shared **`defaults`**, and per-identity **`list`** entries. Routing and session keys use the **first segment** of the session key as the agent id; the **effective profile** for that turn merges `defaults` with the matching enabled `list` row (model, workspace, tools, prompts, etc.).

#### Top-level `agents` fields

| Field | Type | Description |
|-------|------|-------------|
| `default` | string | Optional. Default agent id when the session key or API does not specify one. If omitted: first `list` entry with **`default: true`**, else first **enabled** entry in `list`, else `main`. |
| `defaults` | object | Baseline settings merged into every agent (see **agents.defaults** below). |
| `list` | array | Registered identities; each object can override fields for that id. |

#### `agents.list` entries

Each entry must include **`id`**. Other fields are optional overrides (same shapes as in `defaults` where applicable).

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Agent id (also the first segment of the session key). |
| `default` | boolean | Optional. When `true`, marks this entry as the default agent when top-level **`agents.default`** is unset. |
| `name` | string | Display name. |
| `enabled` | boolean | Default `true`. When `false`, the id is ignored for routing defaults and effective profile resolution falls back to the default agent. |
| `workspace` | string | Per-agent **Markdown workspace** root (`~` expanded). Tool `cwd`, daily `memory/`, and user files. Bootstrap Markdown, inbound/TTS blobs, and curated `memories/` are resolved under **`agents/<id>/`** (agent home), not inside this directory. |
| `agentDir` | string | Optional. Overrides the **internal** agent state directory (`credentials`, `agent.json`, inbox, pid) — default `<stateDir>/agents/<id>/agent`. |
| `model` | string \| object | Same as `agents.defaults.model` (string or `{ primary, fallbacks }`). |
| `thinkingDefault` | string | Optional. One of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `adaptive`. |
| `reasoningDefault` | string | Optional. `off`, `on`, `stream`. |
| `verboseDefault` | string | Optional. `off`, `on`, `full`. |
| `systemPromptOverride` | string | Optional. When set, replaces the usual base system prompt; skills block is still appended (subject to `skills` allowlist). |
| `skills` | string[] | Optional. Allowlist of skill **names** for `<available_skills>`; when set, only those skills are advertised. |
| `tools` | object | Optional. `{ "disable": ["tool_name", ...] }` — built-in tools to omit by **tool name** (e.g. `shell`, `web_search`, `session_search`, `image`; use `extensions` to disable extension tools). |
| `params` | object | Optional. Reserved for future use. |

The same optional keys can appear under **`agents.defaults`** for global defaults (e.g. `agents.defaults.tools.disable` merged with per-agent disables).

**Note:** On-disk paths (`~/.xopc/agents/<id>/` for sessions and internal state, per-agent Markdown workspace under **`agents.defaults.workspace/<agentId>`** or `<stateDir>/workspace/<agentId>`) are **derived from `config.json`** (`agents.list`, `agents.defaults`, optional `agentDir` overrides). Use **`xopc agents add`** / **`agents delete`** to manage entries and directories; there is no separate agent “registry” outside config.

#### agents.defaults

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `workspace` | string | `~/.xopc/workspace` | **Parent** directory for Markdown workspaces; each agent resolves to `<expanded>/<agentId>/` (e.g. `~/.xopc/workspace/main`) |
| `model` | string/object | `anthropic/claude-sonnet-4-5` | Default model |
| `max_tokens` | number | `8192` | Maximum output tokens |
| `temperature` | number | `0.7` | Temperature (0-2) |
| `max_tool_iterations` | number | `20` | Max tool call iterations |
| `imageModel` | string \| object | — | Vision model for the `image` tool and for **describing** inbound images when the session model does not support vision. Same formats as `model` (string or `{ primary, fallbacks }`). See [Image & vision](image-multimodal.md). |
| `imageGenerationModel` | string \| object | — | Image generation chain for `image_generate` (e.g. `openai/gpt-image-1`, `dashscope/wan2.6-t2i`). Same formats as `model`. See [Image & vision](image-multimodal.md). |
| `mediaMaxMb` | number | — | Optional. Max size in **MB** when the `image` tool loads files from disk or URLs. |

#### agents.defaults.model

Model configuration supports two formats:

**Simple format:**
```json
{
  "model": "anthropic/claude-sonnet-4-5"
}
```

**Object format (with fallbacks):**
```json
{
  "model": {
    "primary": "anthropic/claude-sonnet-4-5",
    "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
  }
}
```

Model ID format: `provider/model-id` (e.g., `anthropic/claude-opus-4-5`).

The same **`{ primary, fallbacks }`** object shape applies to **`imageModel`** and **`imageGenerationModel`** when you want ordered fallbacks for vision or image generation.

#### agents.defaults.memory

Curated long-term memory under **`agents/<agentId>/memories/`** (`MEMORY.md` / `USER.md`), optional **stub** external provider for wiring tests, and controls for **prefetch** injection (fenced `<memory-context>` prefix on user turns). See [Curated memory](workspace.md#curated-memory).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch. When `false`: no curated snapshot, no `curated_memory` tool, no external memory provider, no prefetch/sync. |
| `useEnhancedSystem` | boolean | `true` | When `false`: disable curated snapshot and `curated_memory`; workspace bootstrap `MEMORY.md` still applies. |
| `userProfileEnabled` | boolean | `true` | When `false`: omit `USER.md` from the system prompt; `curated_memory` cannot mutate the `user` target (read still allowed). |
| `memoryCharLimit` | number | `2200` | Max characters for `MEMORY.md` entries (total). |
| `userCharLimit` | number | `1375` | Max characters for `USER.md` entries (total). |
| `provider` | string | `none` | External provider: `none` or `stub` (ignored when `enabled` is `false`). |
| `injectionFrequency` | string | `every-turn` | Prefetch injection: `every-turn` or `first-turn` (first user message of the session only). |
| `contextCadence` | number | `1` | When `injectionFrequency` is `every-turn`, inject prefetch on turns 1, 1+N, 1+2N, … (minimum `1`). |
| `dialecticCadence` | number | — | Reserved for future external sync cadence (not wired yet). |

#### agents.defaults.sessionSearch

Cross-session transcript search via the `session_search` tool (when session persistence is available).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `summaryModel` | string | — | Model ref for per-session summaries (e.g. `openai/gpt-4o-mini`). Overrides env `XOPC_SESSION_SEARCH_MODEL` when set. |

---

### providers

Configure LLM provider API keys. Use environment variable references:

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "groq": "${GROQ_API_KEY}"
  }
}
```

**Built-in provider ids** match **`@mariozechner/pi-ai` KnownProvider** (see `src/providers/env-keys.ts` **`PROVIDER_ENV_MAP`** for env var names). Other vendors (e.g. DeepSeek, DashScope chat) belong in **`models.json`**, not as built-in keys here.

| Provider (examples) | Environment variables |
|---------------------|------------------------|
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` |
| `google` | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY`, `MINIMAX_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `huggingface` | `HF_TOKEN` or `HUGGINGFACE_TOKEN` |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY`, `VERCEL_AI_GATEWAY_API_KEY` |

> **Note:** Environment variables take priority over config file values.

See [Models Documentation](/models) for custom provider configuration.

---

### bindings

Optional array of rules that assign an **`agentId`** to incoming traffic. Rules are sorted by **`priority`** (higher first). Each rule’s **`match`** requires an exact **`channel`** value (e.g. `telegram`); **`peerId`** may use `*` glob patterns. If nothing matches, routing uses the default agent id: **`agents.default`** if set, else the first enabled entry in **`agents.list`**, else **`main`**. See [Session Routing System](/routing-system).

---

### session

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dmScope` | string | `main` | How DM sessions are merged or split: `main`, `per-peer`, `per-channel-peer`, `per-account-channel-peer` |
| `identityLinks` | object | - | Map of canonical id → `["channel:peerId", ...]` aliases for cross-channel identity |
| `storage` | object | - | Optional session store tuning (`pruneAfterMs`, `maxEntries`) |

Details and examples: [Session Routing System](/routing-system).

---

### channels

Communication channels configuration.

Keys under `channels` depend on which channel types you use. Built-in **Telegram** and **Weixin** accept the shapes documented in [Channel configuration](/channels). Other keys may come from extensions—follow each extension’s README.

#### channels.telegram

Multi-account Telegram configuration:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Telegram |
| `accounts` | object | - | Multi-account config |
| `accounts.<id>.name` | string | - | Display name |
| `accounts.<id>.botToken` | string | - | Bot token |
| `accounts.<id>.dmPolicy` | string | `open` | DM policy |
| `accounts.<id>.groupPolicy` | string | `open` | Group policy |
| `accounts.<id>.allowFrom` | array | `[]` | Allowed user IDs |
| `accounts.<id>.streamMode` | string | `partial` | Stream mode |

**DM Policies**: `pairing` | `allowlist` | `open` | `disabled`

**Group Policies**: `open` | `allowlist` | `disabled`

**Stream Modes**: `off` | `partial` | `block`

#### channels.feishu

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "APP_ID",
      "appSecret": "APP_SECRET",
      "verificationToken": "VERIFICATION_TOKEN"
    }
  }
}
```

---

### gateway

HTTP API gateway configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | `0.0.0.0` | Bind address |
| `port` | number | `18790` | Port number |
| `auth` | object | - | Authentication config |
| `cors` | object | - | CORS settings |

#### gateway.auth

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable auth |
| `username` | string | - | Auth username |
| `password` | string | - | Auth password |
| `api_key` | string | - | API key auth |

#### gateway.cors

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable CORS |
| `origins` | array | `[]` | Allowed origins |
| `credentials` | boolean | `false` | Allow credentials |

---

### tools

Tool configurations.

#### tools.web

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `search` | object | - | Web search config |
| `browse` | object | - | Web browsing config |

##### tools.web.search

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxResults` | number | `5` | Default result count when the tool omits `count` |
| `providers` | array | `[]` | Ordered list of search backends (`brave`, `tavily`, `bing`, `searxng`). Empty → HTML fallback only. |

Each provider entry: `type`, optional `apiKey`, optional `url` (SearXNG base URL), optional `disabled`.

---

### stt

Speech-to-Text configuration for voice messages.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable STT |
| `provider` | string | `alibaba` | Provider: `alibaba`, `openai` |
| `alibaba` | object | - | Alibaba DashScope config |
| `openai` | object | - | OpenAI Whisper config |
| `fallback` | object | - | Fallback configuration |

#### stt.alibaba

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | string | - | DashScope API key |
| `model` | string | `paraformer-v1` | Model: `paraformer-v1`, `paraformer-8k-v1` |

#### stt.openai

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | string | - | OpenAI API key |
| `model` | string | `whisper-1` | Model: `whisper-1` |

#### stt.fallback

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable fallback |
| `order` | array | `["alibaba", "openai"]` | Fallback order |

On failure, the runtime tries each provider in order and records structured **attempts** (provider, outcome, latency, reason) for diagnostics.

**Example:**
```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    },
    "fallback": {
      "enabled": true,
      "order": ["alibaba", "openai"]
    }
  }
}
```

---

### tts

Text-to-Speech configuration for voice replies and the optional agent `text_to_speech` tool.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable TTS (and registration of `text_to_speech` when true) |
| `provider` | string | `openai` | Primary provider: `openai`, `alibaba`, `edge` |
| `trigger` | string | `always` | `off`, `always`, `inbound`, `tagged` (legacy `auto` → `inbound`) |
| `maxTextLength` | number | `512` | Max characters sent to TTS providers (raise if your provider allows more) |
| `timeoutMs` | number | `30000` | Per-request timeout (ms) |
| `fallback` | object | - | Provider fallback order |
| `summarization` | object | - | LLM summarization before TTS when text exceeds threshold |
| `modelOverrides` | object | - | Allow `[[tts:...]]` directives from the model |
| `openai` | object | - | OpenAI TTS config |
| `alibaba` | object | - | Alibaba DashScope TTS config |
| `edge` | object | - | Microsoft Edge TTS (no API key) |

#### tts.openai

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | string | - | OpenAI API key |
| `model` | string | `tts-1` | Model: `tts-1`, `tts-1-hd` |
| `voice` | string | `alloy` | Voice: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer` |

#### tts.alibaba

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | string | - | DashScope API key |
| `model` | string | `qwen-tts` | TTS model id |
| `voice` | string | `Cherry` | Voice id |

#### tts.edge

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | When `false`, Edge is excluded from the provider chain |
| `voice` | string | `en-US-MichelleNeural` | Edge voice |
| `lang` | string | `en-US` | BCP-47 language |
| `outputFormat` | string | (see schema) | Edge output format string |
| `proxy` | string | - | Optional HTTP(S) proxy for Edge |
| `timeoutMs` | number | - | Override timeout for Edge only |

#### tts.fallback

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Try other providers on failure |
| `order` | array | `["openai","alibaba","edge"]` | Order after deduplicating primary |

#### tts.summarization

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Summarize long text via LLM before TTS |
| `threshold` | number | same as `maxTextLength` | Min length to trigger summarization |
| `targetLength` | number | same as `maxTextLength` | Target length after summarization |
| `model` | string | - | Model ref for summarization; env `XOPC_TTS_SUMMARIZE_MODEL` if unset |

**Trigger modes:**
- `off`: No automatic TTS on outbound
- `always`: TTS when outbound rules pass
- `inbound`: TTS only when the user message carried voice (`transcribedVoice`)
- `tagged`: TTS only when assistant text contains `[[tts]]`
- Legacy `auto` in JSON is normalized to `inbound`

See [Voice (STT/TTS)](/voice) for Telegram group voice + mention behavior, `/tts status`, and channel formats.

---

### heartbeat

Periodic health check configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable heartbeat |
| `intervalMs` | number | `300000` | Interval in ms (5 min) |

---

### cron

Scheduled tasks configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable cron |
| `jobs` | array | `[]` | List of cron jobs |

See [Cron Documentation](/cron) for job configuration.

---

### extensions

Extension enable/disable configuration.

```json
{
  "extensions": {
    "enabled": ["telegram-channel", "weather-tool"],
    "disabled": ["deprecated-extension"],
    "telegram-channel": {
      "token": "bot-token-here"
    },
    "weather-tool": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | string[] | List of extension IDs to enable |
| `disabled` | string[] | (Optional) List of extension IDs to disable |
| `[extension-id]` | object/boolean | Extension-specific configuration |

See [Extensions Documentation](/extensions) for details.

---

## Environment Variables

xopc supports environment variables for sensitive data:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_OAUTH_TOKEN` | Anthropic OAuth token (when used) |
| `GOOGLE_API_KEY` | Google AI API key |
| `GROQ_API_KEY` | Groq API key |
| `MINIMAX_API_KEY` | MiniMax API key |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway (primary name in pi-ai) |
| `DASHSCOPE_API_KEY` | Alibaba DashScope (STT/TTS, image gen) |
| `XOPC_TTS_SUMMARIZE_MODEL` | Model ref for TTS long-text summarization when `tts.summarization.model` is unset |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `XOPC_CONFIG` | Custom config file path |
| `XOPC_WORKSPACE` | Custom workspace directory |
| `XOPC_SESSION_SEARCH_MODEL` | Default model for `session_search` summaries when `agents.defaults.sessionSearch.summaryModel` is unset |
| `XOPC_LOG_LEVEL` | Log level (trace/debug/info/warn/error/fatal) |
| `XOPC_LOG_DIR` | Log directory path |
| `XOPC_LOG_CONSOLE` | Enable console output (true/false) |
| `XOPC_LOG_FILE` | Enable file output (true/false) |
| `XOPC_LOG_RETENTION_DAYS` | Days to retain log files |
| `XOPC_PRETTY_LOGS` | Pretty print logs for development |

Environment variables take priority over config file values.

---

## Configuration Management

### Validate Configuration

```bash
xopc config --validate
```

### View Configuration

```bash
xopc config --show
```

### Edit Configuration

```bash
xopc config --edit
```

---

## FAQ

### Q: How to use multiple providers?

Use the `providers` configuration to define multiple API keys. The agent automatically selects the appropriate provider based on the model ID:

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

### Q: How to use Ollama (local models)?

Configure custom provider in `~/.xopc/models.json`:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" }
      ]
    }
  }
}
```

See [Models Documentation](/models) for details.

### Q: How to configure OAuth?

xopc supports OAuth authentication for certain providers:

**Kimi (Device Code Flow):**
```json
{
  "providers": {
    "kimi": {
      "auth": {
        "type": "oauth",
        "clientId": "your-client-id"
      }
    }
  }
}
```

Kimi uses Device Code Flow - the CLI will prompt you to visit `auth.kimi.com` and enter a code.

### Q: How to use environment variables?

Use `${VAR_NAME}` syntax in config:

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

Or set environment variables directly without adding to config.
