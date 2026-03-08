# Configuration Reference

All xopcbot configuration is centralized in the `~/.xopcbot/config.json` file.

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
      "token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      "allow_from": []
    },
    "whatsapp": {
      "enabled": false,
      "bridge_url": "ws://localhost:3001",
      "allow_from": []
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  },
  "tools": {
    "web": {
      "search": {
        "api_key": "",
        "max_results": 5
      }
    }
  },
  "modelsDev": {
    "enabled": true
  }
}
```

## Configuration Options

### agents

Default configuration for agents.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `workspace` | string | `~/.xopcbot/workspace` | Workspace directory |
| `model` | string / object | `anthropic/claude-sonnet-4-5` | Default model |
| `max_tokens` | number | `8192` | Maximum output tokens |
| `temperature` | number | `0.7` | Temperature parameter (0-2) |
| `max_tool_iterations` | number | `20` | Maximum tool call iterations |

### agents.defaults.model

Model configuration supports two formats:

**Simple format (single model):**
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
    "fallbacks": ["openai/gpt-4o"]
  }
}
```

The model ID format is `provider/model-id`, e.g., `anthropic/claude-opus-4-5`.

### models

 model configuration. Use this to configure API providers and available models.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `providers` | object | `{}` | Provider API keys (see below) |

### providers

Configure LLM provider API keys. Keys can be actual values or environment variable references:

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

Supported providers and their environment variables:

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

You can also use environment variables directly without adding them to config.
| `name` | string | (required) | Display name |
| `reasoning` | boolean | `false` | Supports reasoning/thinking |
| `input` | array | `["text"]` | Input types: `text`, `image` |
| `cost` | object | | Pricing info |
| `contextWindow` | number | `128000` | Context window size |
| `maxTokens` | number | `16384` | Max output tokens |

### Supported Providers

xopcbot supports the following LLM providers:

| Provider | Auth Type | Capabilities | Model Prefixes |
|----------|-----------|--------------|----------------|
| `openai` | API Key | text, vision, tools | gpt-, o1- |
| `anthropic` | API Key, OAuth | text, vision, reasoning, tools | claude- |
| `google` | API Key | text, vision, tools | gemini- |
| `qwen` | API Key | text, vision, tools | qwen-, qwq- |
| `kimi` | OAuth (Device Code) | text, reasoning, tools | kimi- |
| `moonshot` | API Key | text, tools | moonshot- |
| `minimax` | API Key | text | abab- |
| `deepseek` | API Key | text, reasoning, tools | deepseek- |
| `groq` | API Key | text, tools | llama-, mixtral- |
| `openrouter` | API Key | text, vision, tools | openrouter/ |
| `xai` | API Key | text, tools | xai/, grok- |
| `cerebras` | API Key | text | cerebras/ |
| `mistral` | API Key | text, tools | mistral- |
| `zhipu` | API Key | text | glm- |
| `ollama` | None (local) | text, vision | llama3, qwen2, etc. |
| `bailian` | API Key | text | bailian- |

#### Provider Examples

**Kimi (OAuth):**
```json
{
  "kimi": {
    "auth": {
      "type": "oauth",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret"
    },
    "models": [
      { "id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": true }
    ]
  }
}
```

**Moonshot (API Key):**
```json
{
  "moonshot": {
    "apiKey": "${MOONSHOT_API_KEY}",
    "models": [
      { "id": "moonshot-v1-8k", "name": "Moonshot V1 8K" }
    ]
  }
}
```

**MiniMax:**
```json
{
  "minimax": {
    "apiKey": "${MINIMAX_API_KEY}",
    "baseUrl": "https://api.minimax.chat/v1",
    "models": [
      { "id": "abab6.5s-chat", "name": "MiniMax ABAB 6.5S" }
    ]
  }
}
```

**Zhipu (智谱):**
```json
{
  "zhipu": {
    "apiKey": "${ZHIPU_API_KEY}",
    "models": [
      { "id": "glm-4-flash", "name": "GLM-4 Flash" }
    ]
  }
}
```

**xAI (Grok):**
```json
{
  "xai": {
    "apiKey": "${XAI_API_KEY}",
    "models": [
      { "id": "grok-2-1212", "name": "Grok 2" }
    ]
  }
}
```

**Cerebras:**
```json
{
  "cerebras": {
    "apiKey": "${CEREBRAS_API_KEY}",
    "models": [
      { "id": "llama-3.3-70b", "name": "Llama 3.3 70B" }
    ]
  }
}
```

**Bailian (百川):**
```json
{
  "bailian": {
    "apiKey": "${BAILIAN_API_KEY}",
    "models": [
      { "id": "baichuan4", "name": "Baichuan 4" }
    ]
  }
}
```

### channels

Communication channels configuration.

### channels.telegram

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Telegram bot |
| `token` | string | - | Bot token from @BotFather |
| `allow_from` | array | `[]` | Allowed user IDs (empty = all) |
| `group_admins` | boolean | `false` | Only allow group admins |
| `magic` | string | - | Magic prefix for mentions |

### channels.whatsapp

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable WhatsApp bridge |
| `bridge_url` | string | `ws://localhost:3001` | WhatsApp bridge WebSocket URL |
| `allow_from` | array | `[]` | Allowed phone numbers |

### channels.discord

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Discord bot |
| `token` | string | - | Bot token |
| `allow_from` | array | `[]` | Allowed guild/channel IDs |

### channels.slack

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Slack bot |
| `token` | string | - | Bot token |
| `allow_from` | array | `[]` | Allowed channel IDs |

### channels.signal

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Signal bot |
| `phone_number` | string | - | Signal phone number |
| `device_name` | string | - | Device name |
| `allow_from` | array | `[]` | Allowed phone numbers |

### gateway

HTTP API gateway configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | `0.0.0.0` | Bind address |
| `port` | number | `18790` | Port number |
| `auth` | object | - | Authentication config |
| `cors` | object | - | CORS settings |

### gateway.auth

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable auth |
| `username` | string | - | Auth username |
| `password` | string | - | Auth password |
| `api_key` | string | - | API key auth |

### gateway.cors

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable CORS |
| `origins` | array | `[]` | Allowed origins |
| `credentials` | boolean | `false` | Allow credentials |

### tools

Tool configurations.

### tools.web

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `search` | object | - | Web search config |
| `browse` | object | - | Web browsing config |

### tools.web.search

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | string | `brave` | Search provider: `brave`, `searxng` |
| `api_key` | string | - | API key |
| `max_results` | number | `5` | Max results |

### tools.web.browse

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable browsing |
| `max_depth` | number | `2` | Max link depth |
| `timeout` | number | `30000` | Timeout ms |

### cron

Scheduled tasks configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable cron |
| `jobs` | array | `[]` | List of cron jobs |

### heartbeat

Periodic health check configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable heartbeat |
| `interval` | number | `300000` | Interval in ms (5 min) |
| `checks` | array | - | List of checks |

### modelsDev

Local model development settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable local model cache |

## Environment Variables

xopcbot supports environment variables for sensitive data:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google AI API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `WHATSAPP_BRIDGE_URL` | WhatsApp bridge URL |

Environment variables take priority over config file values.

## Q&A

### Q: How to use multiple providers?

Use the `models` configuration to define multiple providers. The agent automatically selects the appropriate provider based on the model ID:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "${OPENAI_API_KEY}",
        "models": [
          { "id": "gpt-4o", "name": "GPT-4o" }
        ]
      },
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "models": [
          { "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5", "reasoning": true }
        ]
      }
    }
  }
}
```

Set different models in `agents.defaults.model` to use different providers.

### Q: How to use Ollama?

```json
{
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://127.0.0.1:11434/v1",
        "enabled": true,
        "autoDiscovery": true,
        "models": [
          { "id": "llama3", "name": "Llama 3" }
        ]
      }
    }
  }
}
```

### Q: How to configure OAuth?

xopcbot supports OAuth authentication for certain providers:

**Kimi (Device Code Flow - Recommended):**
```json
{
  "models": {
    "providers": {
      "kimi": {
        "auth": {
          "type": "oauth",
          "clientId": "17e5f671-d194-4dfb-9706-5516cb48c098"
        },
        "models": [
          { "id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": true }
        ]
      }
    }
  }
}
```

Kimi uses Device Code Flow - the CLI will prompt you to visit `auth.kimi.com` and enter a code to complete authentication.

**Other OAuth Providers:**
```json
{
  "models": {
    "providers": {
      "anthropic": {
        "baseUrl": "https://api.anthropic.com",
        "auth": {
          "type": "oauth",
          "clientId": "...",
          "clientSecret": "..."
        },
        "models": []
      }
    }
  }
}
```

> **Note:** Qwen OAuth was removed in favor of browser-based login (run `qwen` CLI).

### Q: What is modelsDev?

When enabled, xopcbot automatically loads model information from the built-in local cache, which includes models from providers like OpenAI, Anthropic, Google, Groq, DeepSeek, and more. This provides faster model listing without requiring network requests at runtime.
