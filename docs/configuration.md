# Configuration Reference

All xopcbot configuration is centralized in the `~/.config/xopcbot/config.json` file.

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
    "openai": {
      "api_key": "sk-...",
      "base_url": "https://api.openai.com/v1"
    },
    "anthropic": {
      "api_key": "sk-ant-..."
    },
    "minimax": {
      "api_key": "..."
    },
    "openrouter": {
      "api_key": "sk-or-...",
      "base_url": "https://openrouter.ai/api/v1"
    },
    "groq": {
      "api_key": "gsk_..."
    },
    "google": {
      "api_key": "AIza..."
    },
    "deepseek": {
      "api_key": "..."
    },
    "ollama": {
      "enabled": true,
      "base_url": "http://127.0.0.1:11434/v1"
    }
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
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

**Full format (primary + fallbacks):**
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": [
          "openai/gpt-4o",
          "minimax/minimax-m2.1",
          "google/gemini-2.5-flash"
        ]
      }
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `primary` | string | Primary model (provider/model format) |
| `fallbacks` | string[] | Fallback models, used when primary fails |

#### Model Fallback Mechanism

When the primary model fails, xopcbot automatically tries fallback models:

1. **Supported failure types**:
   - `auth` - Authentication failure (401, 403)
   - `rate_limit` - Rate limit exceeded (429)
   - `billing` - Billing/quota issues (402)
   - `timeout` - Request timeout
   - `format` - Request format error (400)

2. **Fallback flow**:
   - Primary model call fails
   - Detect failure reason
   - Try fallbacks in order
   - Return result if any succeeds
   - Throw error if all fail

3. **Example configuration**:
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": [
          "openai/gpt-4o",
          "minimax/minimax-m2.1"
        ]
      }
    }
  },
  "providers": {
    "anthropic": { "api_key": "sk-ant-..." },
    "openai": { "api_key": "sk-..." },
    "minimax": { "api_key": "..." }
  }
}
```

Model ID formats:
- **Short format**: `gpt-4o` (uses default provider)
- **Full format**: `anthropic/claude-sonnet-4-5`

### providers

LLM provider configurations.

#### openai

```json
{
  "providers": {
    "openai": {
      "api_key": "sk-...",
      "api_base": "https://api.openai.com/v1"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `api_key` | string | OpenAI API Key |
| `api_base` | string | (Optional) Custom API endpoint |

#### anthropic

```json
{
  "providers": {
    "anthropic": {
      "api_key": "sk-ant-..."
    }
  }
}
```

#### openrouter

```json
{
  "providers": {
    "openrouter": {
      "api_key": "sk-or-...",
      "api_base": "https://openrouter.ai/api/v1"
    }
  }
}
```

#### groq

```json
{
  "providers": {
    "groq": {
      "api_key": "gsk_..."
    }
  }
}
```

#### gemini

```json
{
  "providers": {
    "gemini": {
      "api_key": "AIza..."
    }
  }
}
```

#### zhipu (智谱 AI)

```json
{
  "providers": {
    "zhipu": {
      "api_key": "...",
      "api_base": "https://open.bigmodel.cn/api/paas/v4"
    }
  }
}
```

#### vllm (Local deployment)

```json
{
  "providers": {
    "vllm": {
      "api_key": "dummy",
      "api_base": "http://localhost:8000/v1"
    }
  }
}
```

### channels

Communication channel configurations.

#### telegram

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "123456:...",
      "allow_from": ["@username", "123456789"]
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable channel |
| `token` | string | Bot Token |
| `allow_from` | string[] | Whitelist users |

Get Token: [@BotFather](https://t.me/BotFather)

#### whatsapp

```json
{
  "channels": {
    "whatsapp": {
      "enabled": false,
      "bridge_url": "ws://localhost:3001",
      "allow_from": []
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable channel |
| `bridge_url` | string | WA Bridge WebSocket URL |
| `allow_from` | string[] | Whitelist users |

### gateway

REST gateway configuration.

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `host` | string | Bind address |
| `port` | number | Port number |

### tools

Built-in tool configurations.

```json
{
  "tools": {
    "web": {
      "search": {
        "api_key": "",
        "max_results": 5
      }
    }
  }
}
```

## Environment Variables

Configuration can also be set via environment variables, which override config file:

| Config | Environment Variable |
|--------|---------------------|
| OpenAI API Key | `OPENAI_API_KEY` |
| Anthropic API Key | `ANTHROPIC_API_KEY` |
| OpenRouter API Key | `OPENROUTER_API_KEY` |
| Groq API Key | `GROQ_API_KEY` |
| Google API Key | `GOOGLE_API_KEY` |
| MiniMax API Key | `MINIMAX_API_KEY` |
| DeepSeek API Key | `DEEPSEEK_API_KEY` |
| Brave Search API Key | `BRAVE_API_KEY` |
| Telegram Bot Token | `TELEGRAM_BOT_TOKEN` |

Example:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export MINIMAX_API_KEY="..."
export DEEPSEEK_API_KEY="..."
```

## Config File Locations

| Purpose | Location |
|---------|----------|
| Config file | `~/.config/xopcbot/config.json` |
| Workspace | `~/.xopcbot/workspace/` |
| Session data | `~/.xopcbot/workspace/sessions/` |

## Verify Configuration

Run commands to test configuration:

```bash
# Test provider connection
npm run dev -- agent -m "Hello"

# List cron jobs
npm run dev -- cron list
```

## FAQ

### Q: Need to restart after config changes?

Yes, restart the service after modifying `config.json`.

### Q: How to use multiple providers?

Configure multiple providers, agent automatically selects based on model name:

```json
{
  "providers": {
    "openai": { "api_key": "sk-..." },
    "anthropic": { "api_key": "sk-ant-..." }
  }
}
```

Set different models to use different providers.

### Q: API Key Security

- Don't commit config files to Git
- Use environment variables for sensitive data
- Set config file permissions to `600`

### modelsDev

Configuration for models.dev integration. models.dev provides a comprehensive database of open-source AI model specifications.

```json
{
  "modelsDev": {
    "enabled": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable models.dev model data |

When enabled, xopcbot automatically loads model information from the built-in local cache, which includes models from providers like OpenAI, Anthropic, Google, Groq, DeepSeek, and more. This provides faster model listing without requiring network requests at runtime.
