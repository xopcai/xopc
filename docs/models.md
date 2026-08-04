# Models and Providers

xopc can use built-in LLM providers directly, and `~/.xopc/models.json` is only needed when you add custom providers, local runtimes, or per-model overrides.

## Built-in LLM providers (pi-ai)

The **gateway console** (Settings → Providers), **`xopc providers`**, and **`xopc models`** use the same built-in provider ids as `@earendil-works/pi-ai`. For most users, start with a built-in provider instead of editing `models.json`.

**Recommended starter model:** use **DeepSeek V4 Flash** with model ref `deepseek/deepseek-v4-flash`. It is the default recommended fast path in the console because it has strong price/performance and works through a simple API key.

```json
{
  "agents": {
    "default": "main",
    "list": [
      {
        "id": "main",
        "identity": { "name": "Main", "role": "General assistant" },
        "responsibilities": { "primary": ["Help the user complete tasks"] },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "models": {
          "defaultRole": "deep",
          "roles": {
            "deep": { "model": "deepseek/deepseek-v4-flash" }
          }
        },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "memory": { "mode": "confirmWrite", "sources": ["session"] },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}"
  }
}
```

You can also set the same key from the terminal:

```bash
export DEEPSEEK_API_KEY="sk-..."
```

**Default chat model:** xopc resolves the selected agent from `agents.default` and `agents.list`. Put model roles under `agents.list[].models.roles`; workflows can then reference those typed roles instead of hard-coding a model everywhere.

Included built-ins cover, among others: **DeepSeek**, **OpenAI**, **Anthropic**, **Google** / **Vertex**, **Azure OpenAI**, **AWS Bedrock**, **Groq**, **xAI**, **Mistral**, **Cerebras**, **OpenRouter**, **Vercel AI Gateway**, **Zhipu z.ai**, **MiniMax** (intl + CN), **Kimi for coding**, **Moonshot** (`moonshotai`, `moonshotai-cn`), **Hugging Face**, **Fireworks**, **Together**, **OpenCode** / **OpenCode Go**, **Cloudflare Workers AI** and **Cloudflare AI Gateway**, **GitHub Copilot**, **OpenAI Codex** (OAuth), **Google Gemini CLI** / **Antigravity** (token or key flows), and **Xiaomi MiMo**. **DashScope** (`dashscope`) is an xopc env id for image/STT/TTS HTTP APIs, not an LLM `KnownProvider` in pi-ai.

### Built-in provider credentials

Built-in provider credentials can come from OAuth, saved API keys, `xopc.json`, or environment variables. Resolution order is:

| Priority | Source | Example | Best for |
|----------|--------|---------|----------|
| 1 | Saved auth profile from the console or `xopc auth` / `xopc providers set-key` | OAuth access token or pasted API key | Desktop/console setup and refreshable OAuth |
| 2 | `xopc.json` `providers` config | `"deepseek": "${DEEPSEEK_API_KEY}"` | Reproducible workspace config without committing secrets |
| 3 | Environment variable from `PROVIDER_ENV_MAP` | `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_OAUTH_TOKEN` | Shell, CI, containers, and server deployments |

Use OAuth when the provider requires browser login or short-lived tokens. Use API keys for providers such as DeepSeek, OpenAI, OpenRouter, and most OpenAI-compatible services. Use environment variables when you do not want secrets written into config files.

Important OAuth/API-key cases:

| Provider id | Credential path |
|-------------|-----------------|
| `xopc-cloud` | OAuth-only; use `/login xopc-cloud`, `xopc auth login xopc-cloud`, or Settings → Providers. Access tokens refresh automatically. |
| `deepseek` | API key via Settings → Providers, `xopc providers set-key deepseek`, `providers.deepseek`, or `DEEPSEEK_API_KEY` |
| `openai` | API key via saved key, config, or `OPENAI_API_KEY` |
| `anthropic` | OAuth token or API key; env supports `ANTHROPIC_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` |
| `openai-codex` | OAuth-only for normal Codex access |
| `google-gemini-cli` / `google-antigravity` | OAuth token or API key flows, depending on your setup |
| `github-copilot` | GitHub token via env vars or OAuth, depending on your setup |

Xiaomi MiMo is still available through `xiaomi` and `xiaomi-token-plan-*`; choose the provider id that matches the endpoint and token plan attached to your key.

---

## Custom Provider Quick Start

Create `~/.xopc/models.json`:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "modelDiscovery": { "enabled": true },
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

> **Note:** The `apiKey` is required but Ollama ignores it, so any value works.

---

## Configuration

### File Location

`~/.xopc/models.json` (or set `XOPC_MODELS_JSON` environment variable)

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
          "cost": { 
            "input": 0, 
            "output": 0, 
            "cacheRead": 0, 
            "cacheWrite": 0 
          }
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

---

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

---

## Provider Configuration

| Field | Description |
|-------|-------------|
| `baseUrl` | API endpoint URL |
| `api` | API type (see above) |
| `apiKey` | API key (see resolution below) |
| `headers` | Custom headers |
| `authHeader` | Add `Authorization: Bearer <apiKey>` header |
| `models` | Array of model configurations |
| `modelOverrides` | Per-model overrides for built-in models |
| `modelDiscovery.enabled` | Periodically synchronize this OpenAI-compatible provider from its `/models` endpoint |

### Catalog synchronization

The gateway builds the remote catalog in memory after startup and refreshes it every six hours. Network failures keep the current in-process snapshot. Models missing from a successful response become unavailable and are skipped by runtime fallback selection; xopc does not rewrite agent or session configuration automatically.

Configure the global schedule in `xopc.json`:

```json
{
  "modelCatalog": {
    "enabled": true,
    "refreshOnStartup": true,
    "intervalHours": 6
  }
}
```

Automatic discovery is opt-in for custom OpenAI-compatible providers. XOPC Model Service synchronization runs whenever its OAuth grant is available. Remote snapshots exist only in process memory; `xopc-cloud` cannot be configured in `models.json`.

---

## Custom image generation providers

Custom image generation uses one explicit protocol: `openai-images`. xopc sends the standard OpenAI Images request shapes to `/images/generations` and `/images/edits`; it does not guess vendor response fields or run compatibility transforms.

```json
{
  "providers": {
    "studio-images": {
      "baseUrl": "https://images.example.com/v1",
      "imageGeneration": {
        "api": "openai-images",
        "name": "Studio Images",
        "documentationUrl": "https://images.example.com/docs",
        "apiKeyUrl": "https://images.example.com/keys",
        "defaultModel": "image-1",
        "auth": { "type": "bearer" },
        "models": [
          {
            "id": "image-1",
            "capabilities": {
              "generate": { "maxCount": 1, "supportsSize": true },
              "edit": { "enabled": true, "maxInputImages": 1 }
            },
            "defaults": { "size": "1024x1024", "outputFormat": "png" }
          }
        ]
      }
    }
  }
}
```

`auth.type` is `bearer`, `header` (with `headerName`), or `none`. Image API keys are stored through the gateway credential store and are never placed in this image provider definition. Static `headers` cannot contain the authentication header.

Private and loopback endpoints are blocked by default. To trust a local endpoint, list only its exact hostname or IP:

```json
"network": { "allowedHosts": ["127.0.0.1", "image-server.lan"] }
```

The gateway limits OpenAI Images JSON responses to 64 MiB, each decoded image to 32 MiB, and all decoded images in one response to 64 MiB. Use **Settings → Capabilities → Images** to add services, manage credentials, run a real generation test, and assign a model to an Agent. `xopc doctor` reports invalid definitions, blocked private endpoints, and missing credentials.

---

## Model Configuration

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | - | Model identifier (passed to API) |
| `name` | No | `id` | Display name |
| `api` | No | provider's `api` | Override provider's API |
| `reasoning` | No | `false` | Supports extended thinking |
| `input` | No | `["text"]` | Input types: `["text"]` or `["text", "image"]` |
| `contextWindow` | No | `128000` | Context window size |
| `maxTokens` | No | `16384` | Maximum output tokens |
| `cost` | No | all zeros | `{input, output, cacheRead, cacheWrite}` per million tokens |
| `headers` | No | - | Custom headers for this model |
| `compat` | No | - | OpenAI compatibility settings |

---

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

---

## API Key Resolution

For custom providers in `models.json`, the `apiKey` field supports three formats:

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

---

## Web UI Configuration

Access the Models configuration in the web UI:

1. Open the web UI (http://localhost:18790)
2. Go to **Settings** → **Models**
3. Use the visual editor to configure providers and models

### Provider Management

#### Adding a Provider

Click **"Add Provider"** to open the provider configuration dialog:

**Quick Setup with Presets:**
- **Ollama** - Local LLMs (`http://localhost:11434/v1`)
- **LM Studio** - LM Studio server (`http://localhost:1234/v1`)
- **OpenRouter** - Multi-provider API (`https://openrouter.ai/api/v1`)
- **Vercel AI Gateway** - Vercel Gateway (`https://ai-gateway.vercel.sh/v1`)
- **vLLM** - vLLM server (`http://localhost:8000/v1`)
- **Custom** - Manual configuration

**Configuration Fields:**
- **Provider ID** - Unique identifier (lowercase, alphanumeric, hyphens)
- **API Type** - The API protocol
- **Base URL** - The API endpoint URL
- **API Key** - Supports literal, env vars, or shell commands

**Advanced Options:**
- **Add Authorization header** - Adds `Authorization: Bearer {apiKey}`
- **Custom Headers** - JSON format custom headers

### Model Management

#### Adding/Editing Models

Click **"Add Model"** or edit icon on existing model:

**Basic Tab:**
- **Model ID** - Unique identifier
- **Display Name** - Human-readable name
- **Input Types** - Text only or Text + Vision
- **Supports Reasoning** - Enable for extended thinking
- **Context Window** - Maximum context size (default: 128000)
- **Max Output Tokens** - Maximum response tokens (default: 16384)

**Advanced Tab:**
- **Cost Configuration** - Per-million-token pricing
- **Custom Headers** - Model-specific headers

**Compatibility Tab:**
- **OpenAI Completions Settings**
- **Routing Configuration** (for OpenRouter/Vercel)

### API Key Testing

Each provider shows an API key type badge. Click **"Test"** to:
- Verify the key resolves correctly
- See the resolved value type
- Check for errors

### Statistics Display

The toolbar shows real-time statistics:
- **Providers count** - Number of custom providers
- **Models count** - Total models across all providers

### Actions

- **Validate** - Check configuration for errors
- **Save** - Save changes to models.json
- **Reload** - Hot reload without restart
- **Show/Hide JSON** - View raw JSON configuration

### Hot Reload

Changes are automatically reloaded when you save in the UI. No restart required.

---

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

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/models-json` | Get models.json configuration |
| POST | `/api/models-json/validate` | Validate configuration |
| PATCH | `/api/models-json` | Save configuration |
| POST | `/api/models-json/reload` | Hot reload |
| POST | `/api/models-json/test-api-key` | Test API key resolution |
| GET | `/api/image-generation/custom-providers` | List custom image providers (no secrets) |
| PUT | `/api/image-generation/custom-providers/:providerId` | Create or replace a custom image provider |
| DELETE | `/api/image-generation/custom-providers/:providerId` | Delete a custom image provider definition |
| PUT | `/api/image-generation/providers/:providerId/credential` | Store an image provider API key |
| POST | `/api/image-generation/providers/:providerId/reveal-api-key` | Reveal a locally stored image provider key |
| DELETE | `/api/image-generation/providers/:providerId/credential` | Delete an image provider credential |
| POST | `/api/image-generation/providers/:providerId/test` | Run one real image generation test |

---

## Troubleshooting

### Models Not Showing Up

1. Check browser console for errors
2. Verify `models.json` syntax is valid JSON
3. Check Settings → Models page for validation errors
4. Ensure API keys are correctly resolved (use Test button)

### API Key Not Working

1. Use "Test" button in UI to verify resolution
2. Check environment variables are set
3. For shell commands, ensure they work manually
4. Check logs for command execution errors

### Changes Not Taking Effect

1. Click "Reload" in UI to force refresh
2. Check `models.json` file was saved correctly
3. Restart gateway if needed

### Separation from config.json

**Note:** `models.json` is separate from `config.json`:
- `config.json` contains API keys for built-in providers
- `models.json` contains custom provider configurations

This separation allows:
- Different file permissions for sensitive API keys
- Easier management of custom model configurations
- Hot reload of models without affecting other settings
