# 模型配置

xopcbot 使用 `@mariozechner/pi-ai` 提供统一的 LLM API，支持 20+ 提供商。

## 配置文件

配置文件位于 `~/.config/xopcbot/config.json`：

```json
{
  "providers": {
    "openai": { "api_key": "sk-..." },
    "anthropic": { "api_key": "sk-ant-..." },
    "minimax": { "api_key": "..." }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o"
    }
  }
}
```

## 模型格式

### 格式说明

模型 ID 可以是：
- **简短格式**（自动检测提供商）：`gpt-4o`、`claude-3-5-sonnet`
- **完整格式**（指定提供商）：`openai/gpt-4o`、`anthropic/claude-3-5-sonnet`

### 自动检测规则

| 模型前缀 | 提供商 |
|---------|--------|
| `gpt-`、`o1-`、`o3-` | OpenAI |
| `claude-`、`sonnet`、`haiku` | Anthropic |
| `gemini-`、`gemma-` | Google |
| `mistral-`、`mixtral-` | Mistral |
| `llama-` | Groq |
| `grok-` | xAI |
| `deepseek-` | OpenRouter |
| `command-r-` | Cerebras |
| `minimax-` | MiniMax |

## 提供商配置

### OpenAI

```json
{
  "providers": {
    "openai": {
      "api_key": "sk-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o"
    }
  }
}
```

**可用模型**：
- `gpt-4o` - 最新的全能模型
- `gpt-4o-mini` - 轻量版
- `o1` - 推理增强模型
- `o3-mini` - 小型推理模型

### Anthropic

```json
{
  "providers": {
    "anthropic": {
      "api_key": "sk-ant-api03-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

**可用模型**：
- `claude-sonnet-4-20250514` - 当前最新版
- `claude-opus-4` - 高性能版
- `claude-haiku-3-20250520` - 轻量版

### MiniMax

```json
{
  "providers": {
    "minimax": {
      "api_key": "..."
    }
  },
  "agents": {
    "defaults": {
      "model": "minimax-abab6.5s-chat"
    }
  }
}
```

**可用模型**：
- `minimax-abab6.5s-chat`
- `minimax-abab6.5-chat`
- `minimax-abab5.5-chat`

### Groq

```json
{
  "providers": {
    "groq": {
      "api_key": "gsk_..."
    }
  },
  "agents": {
    "defaults": {
      "model": "llama-3.3-70b-versatile"
    }
  }
}
```

**可用模型**：
- `llama-3.3-70b-versatile`
- `llama-3.1-70b-versatile`
- `mixtral-8x7b-32768`

### Google

```json
{
  "providers": {
    "google": {
      "api_key": "AIza..."
    }
  },
  "agents": {
    "defaults": {
      "model": "gemini-2.0-flash-exp"
    }
  }
}
```

**可用模型**：
- `gemini-2.0-flash-exp` - 最新实验版
- `gemini-1.5-pro`
- `gemini-1.5-flash`

### xAI

```json
{
  "providers": {
    "xai": {
      "api_key": "xai-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "grok-2-latest"
    }
  }
}
```

### OpenRouter

```json
{
  "providers": {
    "openrouter": {
      "api_key": "sk-or-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "deepseek/deepseek-chat"
    }
  }
}
```

**可用模型**：
- `deepseek/deepseek-chat`
- `anthropic/claude-3.5-sonnet`
- `qwen/qwen-2.5-72b-instruct`
- `moonshotai/moonshot-v1-8k`

## 环境变量

API Key 也可通过环境变量设置：

| 提供商 | 环境变量 |
|--------|----------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| Groq | `GROQ_API_KEY` |
| xAI | `XAI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |

## 代理配置

如需使用代理，在配置中添加：

```json
{
  "providers": {
    "openai": {
      "api_key": "sk-...",
      "http_proxy": "http://127.0.0.1:7890"
    }
  }
}
```

## 成本追踪

pi-ai 自动计算 API 调用成本：

```typescript
import { createProvider } from '../providers/index.js';

const provider = createProvider(config);
const response = await provider.chat(messages, tools, model);

if (response.usage) {
  const cost = provider.calculateCost({
    input: response.usage.prompt_tokens,
    output: response.usage.completion_tokens
  });
  console.log(`本次调用成本: $${cost.toFixed(6)}`);
}
```

## 快速参考

```bash
# 查看支持的模型列表
node -e "const {getProviders, getModels} = require('./dist/providers/index.js'); console.log(getProviders())"
```

## 常见问题

### Q: 模型不存在错误

```
Error: Model not found: gpt-5 (provider: openai)
```

检查模型 ID 是否正确，参考可用模型列表。

### Q: API Key 无效

确保 API Key 正确且有足够权限。

### Q: 如何切换模型

修改 `config.json` 中的 `agents.defaults.model`：

```json
{
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```
