# Custom Models Configuration

xopcbot supports custom model providers via `~/.xopcbot/models.json`, similar to [pi-coding-agent](https://github.com/mariozechner/pi-mono/tree/main/packages/coding-agent).

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration File](#configuration-file)
- [Supported APIs](#supported-apis)
- [Provider Configuration](#provider-configuration)
- [Model Configuration](#model-configuration)
- [Overriding Built-in Providers](#overriding-built-in-providers)
- [API Key Resolution](#api-key-resolution)
- [Frontend UI](#frontend-ui)

## Quick Start

Create `~/.xopcbot/models.json`:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

The `apiKey` is required but Ollama ignores it, so any value works.

## Configuration File

### Location

- **Default**: `~/.xopcbot/models.json`
- **Custom**: Set `XOPCBOT_MODELS_JSON` environment variable

### Minimal Example

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

### Full Example

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "llama3.1:8b",
          "name": "Llama 3.1 8B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "anthropic/claude-3.5-sonnet",
          "name": "Claude 3.5 Sonnet (OR)",
          "compat": {
            "openRouterRouting": {
              "only": ["anthropic"]
            }
          }
        }
      ]
    }
  }
}
```

## Supported APIs

| API | Description |
|-----|-------------|
| `openai-completions` | OpenAI Chat Completions (most compatible) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |
| `azure-openai-responses` | Azure OpenAI |
| `bedrock-converse-stream` | AWS Bedrock |
| `openai-codex-responses` | OpenAI Codex |
| `google-gemini-cli` | Google Gemini CLI |
| `google-vertex` | Google Vertex AI |

## Provider Configuration

| Field | Description |
|-------|-------------|
| `baseUrl` | API endpoint URL |
| `api` | API type (see above) |
| `apiKey` | API key (see resolution below) |
| `headers` | Custom headers |
| `authHeader` | Set `true` to add `Authorization: Bearer <apiKey>` |
| `models` | Array of model configurations |
| `modelOverrides` | Per-model overrides for built-in models |

## Model Configuration

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | - | Model identifier (passed to the API) |
| `name` | No | `id` | Display name |
| `api` | No | provider's `api` | Override provider's API |
| `reasoning` | No | `false` | Supports extended thinking |
| `input` | No | `["text"]` | Input types: `["text"]` or `["text", "image"]` |
| `contextWindow` | No | `128000` | Context window size |
| `maxTokens` | No | `16384` | Maximum output tokens |
| `cost` | No | all zeros | `{input, output, cacheRead, cacheWrite}` per million tokens |
| `headers` | No | - | Custom headers for this model |
| `compat` | No | - | OpenAI compatibility settings |

## Overriding Built-in Providers

### Base URL Override

Route a built-in provider through a proxy:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1"
    }
  }
}
```

### Model Overrides

Customize specific built-in models:

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "anthropic/claude-sonnet-4": {
          "name": "Claude Sonnet 4 (Bedrock Route)",
          "compat": {
            "openRouterRouting": {
              "only": ["amazon-bedrock"]
            }
          }
        }
      }
    }
  }
}
```

## API Key Resolution

The `apiKey` field supports three formats:

### 1. Shell Command

Prefix with `!` to execute a shell command:

```json
{
  "apiKey": "!op read 'op://vault/item/credential'"
}
```

### 2. Environment Variable

Use the name of an environment variable (all uppercase):

```json
{
  "apiKey": "ANTHROPIC_API_KEY"
}
```

### 3. Literal Value

Use the value directly:

```json
{
  "apiKey": "sk-..."
}
```

## Frontend UI

Access the Models configuration in the web UI:

1. Open the web UI (http://localhost:18790 by default)
2. Go to **Settings** → **Models**
3. Use the visual editor to:
   - Add custom providers
   - Configure API endpoints
   - Add models
   - Test API key resolution
   - Validate configuration

### Hot Reload

Changes are automatically reloaded when you save in the UI. No restart required.

## Examples

### Ollama (Local)

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

### OpenRouter

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "anthropic/claude-3.5-sonnet",
          "compat": {
            "openRouterRouting": {
              "order": ["anthropic", "openai"]
            }
          }
        }
      ]
    }
  }
}
```

### Vercel AI Gateway

```json
{
  "providers": {
    "vercel-ai-gateway": {
      "baseUrl": "https://ai-gateway.vercel.sh/v1",
      "apiKey": "AI_GATEWAY_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "moonshotai/kimi-k2.5",
          "name": "Kimi K2.5 (Fireworks via Vercel)",
          "compat": {
            "vercelGatewayRouting": {
              "only": ["fireworks", "novita"]
            }
          }
        }
      ]
    }
  }
}
```

### LM Studio

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "lmstudio",
      "models": [
        { "id": "local-model" }
      ]
    }
  }
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/models-json` | Get current configuration |
| POST | `/api/models-json/validate` | Validate configuration |
| PATCH | `/api/models-json` | Save configuration |
| POST | `/api/models-json/reload` | Hot reload |
| POST | `/api/models-json/test-api-key` | Test API key resolution |

## Troubleshooting

### Models not showing up

1. Check the browser console for errors
2. Verify `models.json` syntax is valid JSON
3. Check the Settings → Models page for validation errors
4. Ensure API keys are correctly resolved (use the Test button)

### API key not working

1. Use the "Test" button in the UI to verify resolution
2. Check environment variables are set
3. For shell commands, ensure they work when run manually
4. Check logs for command execution errors

### Changes not taking effect

1. Click "Reload" in the UI to force a refresh
2. Check the `models.json` file was saved correctly
3. Restart the gateway if needed
