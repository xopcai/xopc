# 模型配置

xopcbot 通过统一的配置系统支持多个 LLM 提供商，使用 `models` 配置。

## 配置文件

所有模型配置存储在 `~/.xopcbot/config.json` 中：

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

## 提供商配置

### 配置选项

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `baseUrl` | string | 是 | API 基础 URL |
| `apiKey` | string | 否 | API 密钥，支持 `${ENV_VAR}` 语法 |
| `api` | string | 否 | API 类型：`openai-completions`、`anthropic-messages`、`google-generative-ai` |
| `auth` | object | 否 | OAuth 配置 |
| `headers` | object | 否 | 自定义 HTTP 头 |
| `enabled` | boolean | 否 | 启用/禁用提供商（默认：true）|
| `models` | array | 否 | 模型列表 |

### 模型定义

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `id` | string | 是 | 模型标识符 |
| `name` | string | 是 | 显示名称 |
| `reasoning` | boolean | 否 | 支持推理/思考 |
| `input` | array | 否 | 输入类型：`["text"]` 或 `["text", "image"]` |
| `cost` | object | 否 | 价格信息 |
| `contextWindow` | number | 否 | 上下文窗口大小 |
| `maxTokens` | number | 否 | 最大输出 tokens |

### 内置提供商

| 提供商 | apiKey 环境变量 | baseUrl | 备注 |
|--------|---------------|---------|------|
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` | GPT-4, o1, o3 |
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | Claude 模型 |
| `google` | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com/v1` | Gemini 模型 |
| `qwen` | `QWEN_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 通义千问 |
| `kimi` | `KIMI_API_KEY` | `https://api.moonshot.cn/v1` | 月之暗面 |
| `moonshot` | `MOONSHOT_API_KEY` | `https://api.moonshot.ai/v1` | Moonshot AI |
| `minimax` | `MINIMAX_API_KEY` | `https://api.minimax.io/anthropic` | MiniMax |
| `minimax-cn` | `MINIMAX_CN_API_KEY` | `https://api.minimaxi.com/anthropic` | MiniMax 国内 |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | DeepSeek |
| `groq` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` | Llama, Mixtral |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` | 多提供商聚合 |
| `xai` | `XAI_API_KEY` | `https://api.x.ai/v1` | Grok |
| `bedrock` | AWS 凭证 | - | Amazon Bedrock |

### Ollama 配置

Ollama 默认支持自动发现：

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

设置 `autoDiscovery: true` 可自动从 Ollama API 获取可用模型。

### 使用环境变量

在 apiKey 中使用 `${ENV_VAR_NAME}` 语法：

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

环境变量优先于配置文件中的值。

## 模型选择

### 格式

模型 ID 使用 `provider/model-id` 格式：

- `anthropic/claude-sonnet-4-5`
- `openai/gpt-4o`
- `qwen/qwen-plus`

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
        "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
      }
    }
  }
}
```

## OAuth 认证

某些提供商支持 OAuth：

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

## 查看已配置提供商

使用 CLI 查看已配置的提供商：

```bash
xopcbot auth providers
```

这将显示所有提供商的认证状态（API 密钥、OAuth 或未配置）。
