# Configuration Reference

All xopcbot configuration is centralized in `~/.xopcbot/config.json`.

## Quick Start

Run the interactive setup wizard:

```bash
xopcbot onboard
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
      "workspace": "~/.xopcbot/workspace",
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
    "deepseek": "${DEEPSEEK_API_KEY}",
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
        "api_key": "${BRAVE_API_KEY}",
        "max_results": 5
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
    "trigger": "auto",
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

Default configuration for agents.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `workspace` | string | `~/.xopcbot/workspace` | Workspace directory |
| `model` | string/object | `anthropic/claude-sonnet-4-5` | Default model |
| `max_tokens` | number | `8192` | Maximum output tokens |
| `temperature` | number | `0.7` | Temperature (0-2) |
| `max_tool_iterations` | number | `20` | Max tool call iterations |

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

---

### providers

Configure LLM provider API keys. Use environment variable references:

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "deepseek": "sk-...",
    "groq": "${GROQ_API_KEY}"
  }
}
```

**Supported Providers:**

| Provider | Environment Variable |
|----------|---------------------|
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `google` | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `huggingface` | `HF_TOKEN` or `HUGGINGFACE_TOKEN` |

> **Note:** Environment variables take priority over config file values.

See [Models Documentation](/models) for custom provider configuration.

---

### bindings

Optional array of rules that assign an **`agentId`** to incoming traffic. Rules are sorted by **`priority`** (higher first). Each rule’s **`match`** requires an exact **`channel`** value (e.g. `telegram`); **`peerId`** may use `*` glob patterns. If nothing matches, routing falls back to the default agent (first enabled entry in **`agents.list`**, otherwise `main`). See [Session Routing System](/routing-system).

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
| `provider` | string | `brave` | Search provider |
| `api_key` | string | - | API key |
| `max_results` | number | `5` | Max results |

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

Text-to-Speech configuration for voice replies.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable TTS |
| `provider` | string | `openai` | Provider: `openai`, `alibaba` |
| `trigger` | string | `auto` | Trigger: `auto`, `never` |
| `openai` | object | - | OpenAI TTS config |
| `alibaba` | object | - | Alibaba CosyVoice config |

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
| `model` | string | `cosyvoice-v1` | Model: `cosyvoice-v1` |
| `voice` | string | - | Voice ID |

**Trigger modes:**
- `auto`: Send voice reply when user sends voice message
- `never`: Disable TTS, only send text

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

xopcbot supports environment variables for sensitive data:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Google AI API key |
| `GROQ_API_KEY` | Groq API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `MINIMAX_API_KEY` | MiniMax API key |
| `BRAVE_API_KEY` | Brave Search API key |
| `DASHSCOPE_API_KEY` | Alibaba DashScope API key (STT/TTS) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `XOPCBOT_CONFIG` | Custom config file path |
| `XOPCBOT_WORKSPACE` | Custom workspace directory |
| `XOPCBOT_LOG_LEVEL` | Log level (trace/debug/info/warn/error/fatal) |
| `XOPCBOT_LOG_DIR` | Log directory path |
| `XOPCBOT_LOG_CONSOLE` | Enable console output (true/false) |
| `XOPCBOT_LOG_FILE` | Enable file output (true/false) |
| `XOPCBOT_LOG_RETENTION_DAYS` | Days to retain log files |
| `XOPCBOT_PRETTY_LOGS` | Pretty print logs for development |

Environment variables take priority over config file values.

---

## Configuration Management

### Validate Configuration

```bash
xopcbot config --validate
```

### View Configuration

```bash
xopcbot config --show
```

### Edit Configuration

```bash
xopcbot config --edit
```

---

## Q&A

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

Configure custom provider in `~/.xopcbot/models.json`:

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

xopcbot supports OAuth authentication for certain providers:

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
