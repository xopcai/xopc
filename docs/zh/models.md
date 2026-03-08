# 模型配置

xopcbot 使用 `@mariozechner/pi-ai` 作为统一的模型层，通过一致的 API 访问 20+ LLM 提供商。

## 架构

```
┌──────────────────────────────┐
│      @mariozechner/pi-ai     │ ← 内置提供商/模型定义
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     xopcbot providers/       │ ← 提供商查找和 API Key 解析
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│    配置 (API Keys)           │ ← 环境变量进行认证
└──────────────────────────────┘
```

### 主要特性

- **20+ 内置提供商** - OpenAI、Anthropic、Google、Groq、DeepSeek 等
- **自动模型检测** - 根据模型 ID 自动检测提供商
- **统一 API** - 所有提供商接口一致
- **OAuth 支持** - 支持 GitHub Copilot、OpenAI Codex 等

## 支持的提供商

| 提供商 | 类别 | 环境变量 | 说明 |
|--------|------|----------|------|
| `openai` | 常用 | `OPENAI_API_KEY` | GPT-4, o1, o3, o4, Codex |
| `anthropic` | 常用 | `ANTHROPIC_API_KEY` | Claude 模型，支持 OAuth |
| `google` | 常用 | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini 模型 |
| `groq` | 常用 | `GROQ_API_KEY` | 快速推理，Llama/Mixtral |
| `deepseek` | 常用 | `DEEPSEEK_API_KEY` | DeepSeek R1, Chat |
| `minimax` | 常用 | `MINIMAX_API_KEY` | MiniMax M2 系列 |
| `minimax-cn` | 常用 | `MINIMAX_API_KEY` | MiniMax 国内端点 |
| `kimi-coding` | 常用 | `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Kimi 编程模型 |
| `xai` | 专用 | `XAI_API_KEY` | Grok 模型 |
| `mistral` | 专用 | `MISTRAL_API_KEY` | Mistral 模型 |
| `cerebras` | 专用 | `CEREBRAS_API_KEY` | 超快速推理 |
| `openrouter` | 专用 | `OPENROUTER_API_KEY` | 多提供商聚合 |
| `huggingface` | 专用 | `HF_TOKEN` / `HUGGINGFACE_TOKEN` | Hugging Face 端点 |
| `opencode` | 专用 | `OPENCODE_API_KEY` | OpenCode 模型 |
| `zai` | 专用 | `ZAI_API_KEY` | Z.ai 模型 |
| `amazon-bedrock` | 企业级 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | AWS Nova 模型 |
| `azure-openai-responses` | 企业级 | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL` | Azure OpenAI |
| `google-vertex` | 企业级 | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Google Vertex AI |
| `vercel-ai-gateway` | 企业级 | - | Vercel AI Gateway |
| `github-copilot` | OAuth | OAuth 流程 | GitHub Copilot |
| `openai-codex` | OAuth | OAuth 流程 | OpenAI Codex |
| `google-gemini-cli` | OAuth | OAuth 流程 | Google Gemini CLI |
| `google-antigravity` | OAuth | OAuth 流程 | Google Antigravity |

## 配置

### 设置 API Keys

通过 `~/.xopcbot/config.json` 中的环境变量配置 API Keys：

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

或直接在环境中设置：

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export DEEPSEEK_API_KEY="sk-..."
```

环境变量优先于配置文件中的值。

### 设置默认模型

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

### 备用模型

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

## 模型选择

### 格式

模型 ID 使用 `提供商/模型ID` 格式：

```bash
anthropic/claude-sonnet-4-5
openai/gpt-4o
google/gemini-2.5-flash
deepseek/deepseek-chat
```

### 自动检测

如果只指定模型 ID 而不带提供商前缀，xopcbot 会尝试自动检测：

```json
{
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-5"  // 自动检测为 anthropic
    }
  }
}
```

### 推荐模型

| 模型 | 提供商 | 适用场景 |
|------|--------|----------|
| `anthropic/claude-sonnet-4-5` | Anthropic | 平衡性能 |
| `anthropic/claude-3-5-sonnet-20241022` | Anthropic | 稳定可靠 |
| `openai/gpt-4o` | OpenAI | 通用场景 |
| `google/gemini-2.5-flash` | Google | 快速、成本效益高 |
| `groq/llama-3.3-70b-versatile` | Groq | 超快速推理 |
| `deepseek/deepseek-chat` | DeepSeek | 成本效益高 |
| `minimax/MiniMax-M2.1` | MiniMax | 编程任务 |

## API 端点

### GET /api/providers

返回 pi-ai 支持的所有提供商：

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:18790/api/providers
```

### GET /api/providers/:provider/models

返回特定提供商的模型：

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:18790/api/providers/openai/models
```

### GET /api/auth/providers

返回所有提供商的认证状态：

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:18790/api/auth/providers
```

返回结果：

```json
{
  "providers": {
    "openai": { "status": "configured" },
    "anthropic": { "status": "configured" },
    "deepseek": { "status": "not_configured" }
  }
}
```

## 提供商检测

xopcbot 可以根据模型 ID 前缀自动检测提供商：

| 提供商 | 前缀 |
|--------|------|
| `openai` | `gpt-`, `o1`, `o3`, `o4`, `chatgpt-` |
| `anthropic` | `claude-` |
| `google` | `gemini-`, `gemma-` |
| `xai` | `grok-` |
| `groq` | `llama-`, `mixtral-`, `gemma-` |
| `deepseek` | `deepseek-`, `r1` |
| `mistral` | `mistral-` |
| `cerebras` | `llama-` |

## 查看已配置提供商

使用 CLI 查看已配置的提供商：

```bash
xopcbot auth providers
```

这将显示所有提供商的认证状态（API 密钥、OAuth 或未配置）。

## OAuth 提供商

部分提供商支持 OAuth 认证：

- `github-copilot` - GitHub Copilot
- `openai-codex` - OpenAI Codex
- `google-gemini-cli` - Google Gemini CLI
- `google-antigravity` - Google Antigravity

OAuth 凭证通过 Web UI 管理。

## 故障排除

### 提供商未找到

如果遇到 "Model not found" 错误：

1. 检查模型 ID 格式：`提供商/模型ID`
2. 验证提供商是否支持
3. 检查 API Key 是否配置

### API Key 不生效

1. 验证环境变量设置正确
2. 检查 API Key 是否有效且有足够额度
3. 使用 `xopcbot auth providers` 检查状态

### 模型不可用

某些模型可能在特定地区不可用或需要特定的 API Key。详情请参阅 [pi-ai 文档](https://github.com/mariozechner/pi-ai)。
