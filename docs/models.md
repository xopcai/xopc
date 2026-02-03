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
| `mistral-`、`mixtral-`、`ministral-` | Mistral |
| `llama-` | Meta (via Groq) |
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

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `gpt-4o` | 128K | ❌ |
| `gpt-4o-mini` | 128K | ❌ |
| `gpt-4.1` | 1M | ❌ |
| `gpt-4.1-mini` | 1M | ❌ |
| `gpt-5` | 400K | ✅ |
| `gpt-5.1` | 400K | ✅ |
| `gpt-5.2` | 400K | ✅ |
| `o1` | 200K | ✅ |
| `o3` | 200K | ✅ |
| `o3-mini` | 200K | ✅ |

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

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `claude-haiku-4-5` | 200K | ✅ |
| `claude-sonnet-4-5` | 200K | ✅ |
| `claude-opus-4-5` | 200K | ✅ |
| `claude-sonnet-4` | 200K | ✅ |
| `claude-opus-4-1` | 200K | ✅ |
| `claude-3-7-sonnet` | 200K | ✅ |
| `claude-3-5-sonnet` | 200K | ❌ |
| `claude-3-haiku` | 200K | ❌ |

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

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `gemini-2.5-pro` | 1M | ✅ |
| `gemini-2.5-flash` | 1M | ✅ |
| `gemini-2.0-flash-exp` | 1M | ❌ |
| `gemini-3-pro-preview` | 1M | ✅ |
| `gemma-3-27b` | 200K | ❌ |

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

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `deepseek-chat` | 128K | ❌ |
| `deepseek-reasoner` | 128K | ✅ |
| `deepseek-v3` | 128K | ❌ |

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

| 模型 | 上下文 |
|------|--------|
| `minimax-m2.1` | 1M |
| `minimax-m2` | 1M |
| `minimax-m1` | 1M |

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

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `qwen-plus` | 1M | ❌ |
| `qwen-max` | 131K | ❌ |
| `qwen-flash` | 1M | ❌ |
| `qwen3-32b` | 128K | ✅ |
| `qwen3-235b-a22b` | 128K | ✅ |
| `qwq-plus` | 131K | ✅ |

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

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `kimi-k2.5` | 262K | ✅ |
| `kimi-k2-thinking` | 262K | ✅ |
| `kimi-k2-turbo` | 262K | ❌ |
| `kimi-k2` | 262K | ❌ |

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
      "model": "kimi/kimi-k2.5"
    }
  }
}
```

---

## Groq

| 模型 | 上下文 |
|------|--------|
| `llama-3.3-70b-versatile` | 128K |
| `llama-3.1-70b-instruct` | 128K |
| `llama-3.1-8b-instruct` | 128K |
| `mixtral-8x7b-32768` | 32K |

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

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `grok-4` | 256K | ✅ |
| `grok-4-fast` | 2M | ✅ |
| `grok-4.1` | 200K | ❌ |

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

| 模型 | 上下文 |
|------|--------|
| `glm-4.7` | 200K |
| `glm-4.6` | 200K |
| `glm-4.5` | 128K |

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

| 配置项 | 环境变量 |
|--------|----------|
| OpenAI API Key | `OPENAI_API_KEY` |
| Anthropic API Key | `ANTHROPIC_API_KEY` |
| Google API Key | `GOOGLE_API_KEY` |
| MiniMax API Key | `MINIMAX_API_KEY` |
| Groq API Key | `GROQ_API_KEY` |
| xAI API Key | `XAI_API_KEY` |

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
