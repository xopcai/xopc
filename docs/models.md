# Models Configuration

xopcbot supports multiple LLM providers through a unified configuration system using the OpenClaw-style `models` config.

## Configuration File

All model configurations are stored in `~/.xopcbot/config.json`:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "${OPENAI_API_KEY}",
        "models": [
          { "id": "gpt-4o", "name": "GPT-4o" },
          { "id": "gpt-4o-mini", "name": "GPT-4o Mini" }
        ]
      },
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "models": [
          { "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5", "reasoning": true },
          { "id": "claude-opus-4-5", "name": "Claude Opus 4.5", "reasoning": true }
        ]
      },
      "qwen": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "${QWEN_API_KEY}",
        "models": [
          { "id": "qwen-plus", "name": "Qwen Plus" },
          { "id": "qwen-max", "name": "Qwen Max" }
        ]
      },
      "ollama": {
        "enabled": true,
        "baseUrl": "http://127.0.0.1:11434/v1",
        "models": [
          { "id": "qwen2.5:7b", "name": "Qwen 2.5 7B" }
        ],
        "autoDiscovery": true
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

## Provider Configuration

### Configuration Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | string | Yes | API base URL |
| `apiKey` | string | No | API key, supports `${ENV_VAR}` syntax |
| `api` | string | No | API type: `openai-completions`, `anthropic-messages`, `google-generative-ai` |
| `auth` | object | No | OAuth configuration |
| `headers` | object | No | Custom HTTP headers |
| `enabled` | boolean | No | Enable/disable provider (default: true) |
| `models` | array | No | Model list |

### Model Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Model identifier |
| `name` | string | Yes | Display name |
| `reasoning` | boolean | No | Supports reasoning/thinking |
| `input` | array | No | Input types: `["text"]` or `["text", "image"]` |
| `cost` | object | No | Pricing info |
| `contextWindow` | number | No | Context window size |
| `maxTokens` | number | No | Max output tokens |

### Built-in Providers

| Provider | apiKey Env | baseUrl | Notes |
|----------|-----------|---------|-------|
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` | GPT-4, o1, o3 |
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | Claude models |
| `google` | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com/v1` | Gemini models |
| `qwen` | `QWEN_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 通义千问 |
| `kimi` | `KIMI_API_KEY` | `https://api.moonshot.cn/v1` | 月之暗面 |
| `moonshot` | `MOONSHOT_API_KEY` | `https://api.moonshot.ai/v1` | Moonshot AI |
| `minimax` | `MINIMAX_API_KEY` | `https://api.minimax.io/anthropic` | MiniMax |
| `minimax-cn` | `MINIMAX_CN_API_KEY` | `https://api.minimaxi.com/anthropic` | MiniMax CN |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | DeepSeek |
| `groq` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` | Llama, Mixtral |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` | Multi-provider |
| `xai` | `XAI_API_KEY` | `https://api.x.ai/v1` | Grok |
| `bedrock` | AWS Credentials | - | Amazon Bedrock |

### Ollama Configuration

Ollama is supported with auto-discovery by default:

```json
{
  "models": {
    "providers": {
      "ollama": {
        "enabled": true,
        "baseUrl": "http://127.0.0.1:11434/v1",
        "autoDiscovery": true,
        "models": []
      }
    }
  }
}
```

Set `autoDiscovery: true` to automatically fetch available models from Ollama API.

### Using Environment Variables

Use `${ENV_VAR_NAME}` syntax in apiKey:

```json
{
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "models": []
      }
    }
  }
}
```

Environment variables take priority over config file values.

## Model Selection

### Format

Model IDs use `provider/model-id` format:

- `anthropic/claude-sonnet-4-5`
- `openai/gpt-4o`
- `qwen/qwen-plus`

### Setting Default Model

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

### Fallback Models

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
      }
    }
  }
}
```

## OAuth Authentication

Some providers support OAuth:

```json
{
  "models": {
    "providers": {
      "anthropic": {
        "baseUrl": "https://api.anthropic.com",
        "auth": {
          "type": "oauth",
          "clientId": "your-client-id",
          "clientSecret": "your-client-secret"
        },
        "models": []
      }
    }
  }
}
```

## Listing Configured Providers

Use the CLI to list configured providers:

```bash
xopcbot auth providers
```

This shows all providers with their authentication status (API Key, OAuth, or Not configured).
