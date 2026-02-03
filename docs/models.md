# 模型配置

xopcbot 使用 `@mariozechner/pi-ai` 提供统一的 LLM API，支持 20+ 提供商和数百种模型。

数据来源：[models.dev](https://models.dev) - AI 模型开放数据库

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
| `mistral-`、`mixtral-`、`ministral-` | Mistral |
| `llama-` | Meta (via Groq/AIHubMix) |
| `doubao-` | ByteDance |
| `glm-`、`chatglm-` | Zhipu (智谱) |
| `qwen-`、`qwq-`、`qvq-` | Alibaba |
| `kimi-` | Moonshot (月之暗面) |
| `deepseek-`、`r1` | DeepSeek |
| `grok-` | xAI |
| `minimax-` | MiniMax |
| `command-r-` | Cohere |

---

## OpenAI

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `gpt-4o` | $2.50 | $10.00 | 128K | ❌ |
| `gpt-4o-mini` | $0.15 | $0.60 | 128K | ❌ |
| `gpt-4o-audio-preview` | - | - | 128K | ❌ |
| `gpt-4.1` | $2.00 | $8.00 | 1M | ❌ |
| `gpt-4.1-mini` | $0.40 | $1.60 | 1M | ❌ |
| `gpt-4.1-nano` | $0.10 | $0.40 | 1M | ❌ |
| `gpt-5` | $1.25 | $10.00 | 400K | ✅ |
| `gpt-5-mini` | $0.25 | $2.00 | 400K | ✅ |
| `gpt-5-pro` | $15.00 | $120.00 | 400K | ✅ |
| `o1` | $15.00 | $60.00 | 200K | ✅ |
| `o1-mini` | $1.10 | $4.40 | 200K | ✅ |
| `o3` | $2.00 | $8.00 | 200K | ✅ |
| `o3-mini` | $1.10 | $4.40 | 200K | ✅ |
| `o4-mini` | $1.10 | $4.40 | 200K | ✅ |

### OpenAI 配置

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

---

## Anthropic

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `claude-haiku-4-5` | $1.00 | $5.00 | 200K | ✅ |
| `claude-sonnet-4-5` | $3.00 | $15.00 | 200K | ✅ |
| `claude-opus-4-5` | $5.00 | $25.00 | 200K | ✅ |
| `claude-sonnet-4` | $3.00 | $15.00 | 200K | ✅ |
| `claude-opus-4-1` | $15.00 | $75.00 | 200K | ✅ |
| `claude-3-7-sonnet` | $3.00 | $15.00 | 200K | ✅ |
| `claude-3-5-sonnet` | $3.00 | $15.00 | 200K | ❌ |
| `claude-3-haiku` | $0.25 | $1.25 | 200K | ❌ |

### Anthropic 配置

```json
{
  "providers": {
    "anthropic": {
      "api_key": "sk-ant-api03-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-5"
    }
  }
}
```

---

## Google Gemini

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `gemini-2.5-pro` | $1.25 | $10.00 | 1M | ✅ |
| `gemini-2.5-flash` | $0.30 | $2.50 | 1M | ✅ |
| `gemini-2.5-flash-lite` | $0.07 | $0.30 | 2M | ❌ |
| `gemini-2.0-flash-exp` | $0.10 | $0.40 | 1M | ❌ |
| `gemini-2.0-pro-exp` | - | - | 2M | ✅ |
| `gemini-3-pro-preview` | $2.00 | $12.00 | 1M | ✅ |
| `gemma-3-27b` | $0.12 | $0.20 | 200K | ❌ |

### Google 配置

```json
{
  "providers": {
    "google": {
      "api_key": "AIza..."
    }
  },
  "agents": {
    "defaults": {
      "model": "gemini-2.5-flash"
    }
  }
}
```

---

## DeepSeek

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `deepseek-chat` | $0.14 | $0.28 | 128K | ❌ |
| `deepseek-reasoner` | $0.14 | $0.28 | 128K | ✅ |
| `deepseek-v3` | $0.14 | $0.28 | 128K | ❌ |
| `deepseek-v3.1` | $0.14 | $0.28 | 131K | ✅ |

### DeepSeek 配置

```json
{
  "providers": {
    "openrouter": {
      "api_key": "sk-or-...",
      "api_base": "https://openrouter.ai/api/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "deepseek/deepseek-chat"
    }
  }
}
```

---

## MiniMax

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `minimax-m2.1` | $0.30 | $1.20 | 1M | ❌ |
| `minimax-m2` | $0.33 | $1.32 | 1M | ❌ |
| `minimax-m1` | $0.13 | $1.25 | 1M | ❌ |

### MiniMax 配置

```json
{
  "providers": {
    "minimax": {
      "api_key": "..."
    }
  },
  "agents": {
    "defaults": {
      "model": "minimax-m2.1"
    }
  }
}
```

---

## Qwen (阿里巴巴)

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `qwen-plus` | $0.12 | $1.20 | 1M | ❌ |
| `qwen-max` | $0.34 | $1.37 | 131K | ❌ |
| `qwen-flash` | $0.02 | $0.22 | 1M | ❌ |
| `qwen3-32b` | $0.09 | $0.29 | 128K | ✅ |
| `qwen3-235b-a22b` | $0.29 | $1.14 | 128K | ✅ |
| `qwen3-coder-480b` | $0.86 | $3.43 | 262K | ❌ |
| `qwq-plus` | $0.80 | $2.40 | 131K | ✅ |
| `qvq-max` | $1.20 | $4.80 | 131K | ✅ |

### Qwen 配置

```json
{
  "providers": {
    "openrouter": {
      "api_key": "sk-or-...",
      "api_base": "https://openrouter.ai/api/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "qwen/qwen-plus"
    }
  }
}
```

---

## Kimi (月之暗面)

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `kimi-k2` | $0.55 | $2.19 | 262K | ❌ |
| `kimi-k2-thinking` | $0.57 | $2.30 | 262K | ✅ |
| `kimi-k2.5` | $0.60 | $3.00 | 262K | ✅ |

### Kimi 配置

```json
{
  "providers": {
    "openrouter": {
      "api_key": "sk-or-...",
      "api_base": "https://openrouter.ai/api/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "kimi/kimi-k2-thinking"
    }
  }
}
```

---

## Groq

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `llama-3.3-70b-versatile` | $0.59 | $0.79 | 128K | ❌ |
| `llama-3.1-70b-instruct` | $0.40 | $0.40 | 128K | ❌ |
| `llama-3.1-8b-instruct` | $0.02 | $0.05 | 128K | ❌ |
| `mixtral-8x7b-32768` | $0.27 | $0.27 | 32K | ❌ |

### Groq 配置

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

---

## xAI (Grok)

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `grok-4` | $3.00 | $15.00 | 256K | ✅ |
| `grok-4-fast` | $0.20 | $0.50 | 2M | ✅ |
| `grok-4.1` | $2.00 | $10.00 | 200K | ❌ |
| `grok-4.1-fast` | $0.20 | $0.50 | 2M | ✅ |

### xAI 配置

```json
{
  "providers": {
    "xai": {
      "api_key": "xai-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "grok-4"
    }
  }
}
```

---

## GLM (智谱 AI)

| 模型 | 输入 ($/M) | 输出 ($/M) | 上下文 | Reasoning |
|------|-----------|-----------|--------|-----------|
| `glm-4.7` | $0.29 | $1.14 | 200K | ❌ |
| `glm-4.6` | $0.29 | $1.14 | 200K | ❌ |
| `glm-4.5` | $0.29 | $1.14 | 128K | ❌ |
| `glm-4.6v` | $0.14 | $0.43 | 128K | ❌ |

### GLM 配置

```json
{
  "providers": {
    "zhipu": {
      "api_key": "...",
      "api_base": "https://open.bigmodel.cn/api/paas/v4"
    }
  },
  "agents": {
    "defaults": {
      "model": "glm-4.7"
    }
  }
}
```

---

## 推理模型推荐

需要复杂推理任务时，推荐使用以下模型：

| 场景 | 推荐模型 | 提供商 |
|------|----------|--------|
| 数学推理 | `o3-mini` | OpenAI |
| 代码生成 | `claude-sonnet-4-5` | Anthropic |
| 长文本分析 | `gemini-2.5-pro` | Google |
| 深度思考 | `deepseek-reasoner` | DeepSeek |
| 快速推理 | `qwen3-235b-a22b` | Alibaba |

---

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
| DeepSeek | `DEEPSEEK_API_KEY` |

---

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

---

## 快速参考

```bash
# 查看支持的模型列表
node -e "const {getProviders, getModels} = require('./dist/providers/index.js'); console.log(getProviders())"
```

---

## 常见问题

### Q: 模型不存在错误

```
Error: Model not found: gpt-5 (provider: openai)
```

检查模型 ID 是否正确，确保拼写与官方一致。

### Q: 如何选择推理模型

- **高强度推理** (`o3`, `claude-opus-4-5`): 数学证明、复杂分析
- **平衡型** (`claude-sonnet-4-5`, `qwen3-235b`): 日常任务
- **快速响应** (`o1-mini`, `qwen-flash`): 简单问答

### Q: 上下文窗口选择

- **200K+**: 长文档分析、代码库理解
- **128K**: 复杂对话、长篇文章
- **32K-64K**: 标准对话

### Q: API Key 无效

确保 API Key 正确且有足够权限，检查是否过期。
