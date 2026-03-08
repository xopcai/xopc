# Models Configuration

xopcbot uses `@mariozechner/pi-ai` as the unified model layer, providing access to 20+ LLM providers with a single consistent API.

## Architecture

```
┌──────────────────────────────┐
│      @mariozechner/pi-ai     │ ← Built-in provider/model definitions
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     xopcbot providers/       │ ← Provider lookup & API key resolution
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│    Config (API Keys)        │ ← Environment variables for auth
└──────────────────────────────┘
```

### Key Features

- **20+ Built-in Providers** - OpenAI, Anthropic, Google, Groq, DeepSeek, etc.
- **Automatic Model Detection** - Detect provider from model ID automatically
- **Unified API** - Consistent interface across all providers
- **OAuth Support** - For providers like GitHub Copilot, OpenAI Codex

## Supported Providers

| Provider | Category | Environment Variables | Notes |
|----------|----------|----------------------|-------|
| `openai` | Common | `OPENAI_API_KEY` | GPT-4, o1, o3, o4, Codex |
| `anthropic` | Common | `ANTHROPIC_API_KEY` | Claude models, supports OAuth |
| `google` | Common | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini models |
| `groq` | Common | `GROQ_API_KEY` | Fast inference, Llama/Mixtral |
| `deepseek` | Common | `DEEPSEEK_API_KEY` | DeepSeek R1, Chat |
| `minimax` | Common | `MINIMAX_API_KEY` | MiniMax M2 series |
| `minimax-cn` | Common | `MINIMAX_API_KEY` | MiniMax CN endpoint |
| `kimi-coding` | Common | `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Kimi for Coding |
| `xai` | Specialty | `XAI_API_KEY` | Grok models |
| `mistral` | Specialty | `MISTRAL_API_KEY` | Mistral models |
| `cerebras` | Specialty | `CEREBRAS_API_KEY` | Ultra-fast inference |
| `openrouter` | Specialty | `OPENROUTER_API_KEY` | Multi-provider aggregation |
| `huggingface` | Specialty | `HF_TOKEN` / `HUGGINGFACE_TOKEN` | Hugging Face endpoints |
| `opencode` | Specialty | `OPENCODE_API_KEY` | OpenCode models |
| `zai` | Specialty | `ZAI_API_KEY` | Z.ai models |
| `amazon-bedrock` | Enterprise | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | AWS Nova models |
| `azure-openai-responses` | Enterprise | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL` | Azure OpenAI |
| `google-vertex` | Enterprise | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Google Vertex AI |
| `vercel-ai-gateway` | Enterprise | - | Vercel AI Gateway |
| `github-copilot` | OAuth | OAuth flow | GitHub Copilot |
| `openai-codex` | OAuth | OAuth flow | OpenAI Codex |
| `google-gemini-cli` | OAuth | OAuth flow | Google Gemini CLI |
| `google-antigravity` | OAuth | OAuth flow | Google Antigravity |

## Configuration

### Setting API Keys

Configure API keys via environment variables in `~/.xopcbot/config.json`:

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "deepseek": "${DEEPSEEK_API_KEY}",
    "groq": "${GROQ_API_KEY}"
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

Or use environment variables directly:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export DEEPSEEK_API_KEY="sk-..."
```

Environment variables take priority over config file values.

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
        "fallbacks": ["openai/gpt-4o", "deepseek/deepseek-chat"]
      }
    }
  }
}
```

## Model Selection

### Format

Model IDs use `provider/model-id` format:

```bash
anthropic/claude-sonnet-4-5
openai/gpt-4o
google/gemini-2.5-flash
deepseek/deepseek-chat
```

### Automatic Detection

If you only specify the model ID without provider prefix, xopcbot will try to auto-detect:

```json
{
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-5"  // Auto-detected as anthropic
    }
  }
}
```

### Recommended Models

| Model | Provider | Use Case |
|-------|----------|----------|
| `anthropic/claude-sonnet-4-5` | Anthropic | Balanced performance |
| `anthropic/claude-3-5-sonnet-20241022` | Anthropic | Stable, reliable |
| `openai/gpt-4o` | OpenAI | General purpose |
| `google/gemini-2.5-flash` | Google | Fast, cost-effective |
| `groq/llama-3.3-70b-versatile` | Groq | Ultra-fast inference |
| `deepseek/deepseek-chat` | DeepSeek | Cost-effective |
| `minimax/MiniMax-M2.1` | MiniMax | Coding tasks |

## API Endpoints

### GET /api/providers

Returns all available providers from pi-ai:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:18790/api/providers
```

### GET /api/providers/:provider/models

Returns models for a specific provider:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:18790/api/providers/openai/models
```

### GET /api/auth/providers

Returns authentication status for all providers:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:18790/api/auth/providers
```

Returns:

```json
{
  "providers": {
    "openai": { "status": "configured" },
    "anthropic": { "status": "configured" },
    "deepseek": { "status": "not_configured" }
  }
}
```

## Provider Detection

xopcbot can automatically detect the provider based on model ID prefixes:

| Provider | Prefixes |
|----------|----------|
| `openai` | `gpt-`, `o1`, `o3`, `o4`, `chatgpt-` |
| `anthropic` | `claude-` |
| `google` | `gemini-`, `gemma-` |
| `xai` | `grok-` |
| `groq` | `llama-`, `mixtral-`, `gemma-` |
| `deepseek` | `deepseek-`, `r1` |
| `mistral` | `mistral-` |
| `cerebras` | `llama-` |

## Listing Configured Providers

Use the CLI to list configured providers:

```bash
xopcbot auth providers
```

This shows all providers with their authentication status (API Key, OAuth, or Not configured).

## OAuth Providers

Some providers support OAuth authentication:

- `github-copilot` - GitHub Copilot
- `openai-codex` - OpenAI Codex
- `google-gemini-cli` - Google Gemini CLI
- `google-antigravity` - Google Antigravity

OAuth credentials are managed through the web UI.

## Troubleshooting

### Provider Not Found

If you get "Model not found" error:

1. Check the model ID format: `provider/model-id`
2. Verify the provider is supported
3. Check API key is configured

### API Key Not Working

1. Verify environment variable is set correctly
2. Check API key is valid and has sufficient credits
3. Use `xopcbot auth providers` to check status

### Model Not Available

Some models may not be available in all regions or require specific API keys. Check the [pi-ai documentation](https://github.com/mariozechner/pi-ai) for details.
