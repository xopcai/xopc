# Models Configuration

xopcbot supports multiple LLM providers through a unified configuration system.

## Configuration File

All model configurations are stored in `~/.xopcbot/config.json`:

```json
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "baseUrl": "https://api.openai.com/v1",
      "models": ["gpt-4o", "gpt-4o-mini", "gpt-5", "o1", "o3"]
    },
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-sonnet-4-5", "claude-opus-4-5"]
    },
    "qwen": {
      "apiKey": "${QWEN_API_KEY}",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "models": ["qwen-plus", "qwen-max"]
    },
    "ollama": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:11434/v1",
      "models": ["qwen2.5:7b"],
      "autoDiscovery": true
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

### Common Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | string | No | API key, supports `${ENV_VAR}` syntax |
| `baseUrl` | string | No | API base URL (optional, defaults built-in) |
| `api` | string | No | API type: `openai-completions`, `anthropic-messages`, `google-generative-ai` |
| `models` | string[] | No | Custom model list (extends built-in models) |

### Built-in Providers

| Provider | apiKey Env | baseUrl | Notes |
|----------|-----------|---------|-------|
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` | GPT-4, o1, o3 |
| `anthropic` | `ANTHROPIC_API_KEY` | - | Claude models |
| `google` | `GOOGLE_API_KEY` | - | Gemini models |
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
  "providers": {
    "ollama": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:11434/v1",
      "autoDiscovery": true,
      "models": ["qwen2.5:7b"]
    }
  }
}
```

**Options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable Ollama provider |
| `baseUrl` | string | `http://127.0.0.1:11434/v1` | Ollama server URL |
| `autoDiscovery` | boolean | `true` | Auto-detect locally running models |
| `models` | string[] | [] | Manually specify models |

## Environment Variables

Use `${ENV_VAR}` syntax in config to reference environment variables:

```json
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}"
    }
  }
}
```

Then set the environment variable:
```bash
export OPENAI_API_KEY="sk-..."
```

## CLI Commands

### List Available Models

```bash
xopcbot models list
xopcbot models list --all    # Show all models
xopcbot models list --json   # Output as JSON
```

### Set Default Model

```bash
xopcbot models set openai/gpt-4o
```

### Add Custom Model

```bash
# Add model to existing provider
xopcbot models add --provider openai --model gpt-4.1

# Add provider with custom base URL
xopcbot models add --provider custom --baseUrl https://api.example.com/v1 --model my-model
```

### Remove Model

```bash
# Remove specific model
xopcbot models remove openai/gpt-4o

# Remove entire provider config
xopcbot models remove openai
```

### Manage API Keys

```bash
# Set API key
xopcbot models auth set openai ${OPENAI_API_KEY}

# List configured providers
xopcbot models auth list
```

## Built-in Models

The following models are available by default:

| Provider | Models |
|----------|--------|
| openai | gpt-4o, gpt-4o-mini, gpt-5, o1, o3 |
| anthropic | claude-sonnet-4-5, claude-haiku-4-5, claude-opus-4-5 |
| google | gemini-2.5-pro, gemini-2.5-flash |
| qwen | qwen-plus, qwen-max, qwen3-235b |
| kimi | kimi-k2.5, kimi-k2-thinking |
| minimax | minimax-m2.1, minimax-m2 |
| deepseek | deepseek-chat, deepseek-reasoner |
| groq | llama-3.3-70b |

## Models.dev Integration

xopcbot integrates with [models.dev](https://models.dev/) to provide a comprehensive database of open-source AI model specifications. This feature is **enabled by default** and provides additional model information without requiring network requests at runtime.

### Configuration

```json
{
  "modelsDev": {
    "enabled": true
  }
}
```

To disable models.dev integration:

```json
{
  "modelsDev": {
    "enabled": false
  }
}
```

### Supported Providers

The local models.dev data includes models from the following providers:

- **openai** - GPT models
- **anthropic** - Claude models
- **google** - Gemini models
- **groq** - Llama, Mixtral models
- **deepseek** - DeepSeek models
- **openrouter** - Multi-provider routing
- **xai** - Grok models
- **zhipu** - GLM models

### How It Works

When enabled, xopcbot automatically loads model data from the built-in local cache at startup. This provides:

1. **Faster startup** - No network request needed to load model list
2. **Offline support** - Works without internet connection
3. **Up-to-date models** - Local data is pre-fetched from models.dev API

The local data is stored in `src/providers/models-dev-data.ts` and can be regenerated by fetching fresh data from the models.dev API.

## Model References

Models are referenced using the `provider/model-id` format:

- `openai/gpt-4o`
- `anthropic/claude-sonnet-4-5`
- `qwen/qwen-plus`

Or by ID only for auto-detection:
- `gpt-4o` (auto-detects as openai)
- `claude-sonnet-4-5` (auto-detects as anthropic)
