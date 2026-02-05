# 模型配置

xopcbot 使用 `@mariozechner/pi-ai` 提供统一的 LLM API，支持 20+ 提供商。

## 目录

- [配置方式](#配置方式)
- [环境变量](#环境变量)
- [内置提供商](#内置提供商)
- [自定义 API](#自定义-api)
- [CLI 命令](#cli-命令)

---

## 配置方式

配置文件位于 `~/.xopcbot/config.json`：

```json
{
  "providers": {
    "openai": { "api_key": "sk-..." },
    "anthropic": { "api_key": "sk-ant-..." },
    "qwen": { "api_key": "sk-..." },
    "kimi": { "api_key": "sk-..." },
    "minimax": { "api_key": "..." },
    "minimax-cn": { "api_key": "..." },
    "deepseek": { "api_key": "..." },
    "google": { "api_key": "..." },
    "openrouter": { "api_key": "..." }
  },
  "agents": {
    "defaults": {
      "model": "qwen3-coder-plus"
    }
  }
}
```

### 极简配置（使用环境变量）

如果你使用环境变量存储 API key，只需指定模型：

```json
{
  "agents": {
    "defaults": {
      "model": "qwen3-coder-plus"
    }
  }
}
```

---

## 环境变量

API Key 也可以通过环境变量设置（推荐）：

| Provider | 环境变量 | API Base |
|----------|----------|----------|
| OpenAI | `OPENAI_API_KEY` | api.openai.com/v1 |
| Anthropic | `ANTHROPIC_API_KEY` | api.anthropic.com |
| Google | `GOOGLE_API_KEY` / `GEMINI_API_KEY` | generativelanguage.googleapis.com |
| Qwen | `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | dashscope.aliyuncs.com/compatible-mode/v1 |
| Kimi | `KIMI_API_KEY` / `MOONSHOT_API_KEY` | api.moonshot.cn/v1 |
| MiniMax (国际) | `MINIMAX_API_KEY` | api.minimax.io/anthropic |
| MiniMax (中国) | `MINIMAX_CN_API_KEY` / `MINIMAX_API_KEY` | api.minimaxi.com/anthropic |
| DeepSeek | `DEEPSEEK_API_KEY` | api.deepseek.com/v1 |
| Groq | `GROQ_API_KEY` | api.groq.com/openai/v1 |
| OpenRouter | `OPENROUTER_API_KEY` | openrouter.ai/api/v1 |
| xAI | `XAI_API_KEY` | api.x.ai/v1 |

### 使用示例

```bash
# Bash
export OPENAI_API_KEY="sk-..."
export QWEN_API_KEY="sk-..."
export MINIMAX_API_KEY="sk-..."

# 在配置文件中
{
  "agents": {
    "defaults": {
      "model": "qwen3-coder-plus"
    }
  }
}

# 运行
xopcbot agent -m "Hello"
```

---

## 内置提供商

xopcbot 内置了以下提供商的默认配置：

| Provider | API Base | API 类型 |
|----------|----------|----------|
| OpenAI | api.openai.com/v1 | OpenAI Responses |
| Anthropic | api.anthropic.com | Anthropic Messages |
| Google | generativelanguage.googleapis.com | Google Generative AI |
| Qwen (阿里) | dashscope.aliyuncs.com/compatible-mode/v1 | OpenAI Completions |
| Kimi (月之暗面) | api.moonshot.cn/v1 | OpenAI Completions |
| MiniMax (国际) | api.minimax.io/anthropic | Anthropic Messages |
| MiniMax (中国) | api.minimaxi.com/anthropic | Anthropic Messages |
| DeepSeek | api.deepseek.com/v1 | OpenAI Completions |
| Groq | api.groq.com/openai/v1 | OpenAI Completions |
| OpenRouter | openrouter.ai/api/v1 | OpenAI Completions |
| Amazon Bedrock | bedrock-runtime.*.amazonaws.com | Bedrock Converse Stream |
| xAI | api.x.ai/v1 | OpenAI Completions |

---

## 支持的模型

### 查看可用模型

```bash
# 列出所有支持的模型
xopcbot models list --builtin
```

### OpenAI 系列

| 模型 ID | 说明 |
|---------|------|
| `openai/gpt-4o` | GPT-4o |
| `openai/gpt-4o-mini` | GPT-4o Mini |
| `openai/gpt-5` | GPT-5 |
| `openai/o1` | o1 (推理模型) |
| `openai/o3` | o3 (推理模型) |
| `openai/o4` | o4 (推理模型) |

### Anthropic 系列

| 模型 ID | 说明 |
|---------|------|
| `anthropic/claude-sonnet-4-20250514` | Claude Sonnet 4 |
| `anthropic/claude-haiku-4-20250514` | Claude Haiku 4 |
| `anthropic/claude-opus-4-20250514` | Claude Opus 4 |

### Google 系列

| 模型 ID | 说明 |
|---------|------|
| `google/gemini-2.5-pro` | Gemini 2.5 Pro |
| `google/gemini-2.5-flash` | Gemini 2.5 Flash |
| `google/gemini-2.0-flash-latest` | Gemini 2.0 Flash |

### Qwen 系列 (通义千问)

**通过阿里云 API：**
| 模型 ID | 说明 |
|---------|------|
| `qwen/qwen-plus` | Qwen Plus |
| `qwen/qwen-max` | Qwen Max |
| `qwen/qwen-2.5-72b-instruct` | Qwen 2.5 72B |
| `qwen/qwen-2.5-7b-instruct` | Qwen 2.5 7B |

**通过 OpenRouter：**
| 模型 ID | 说明 |
|---------|------|
| `qwen3-coder-plus` | Qwen3 Coder Plus |
| `qwen3-32b` | Qwen3 32B |
| `qwen3` | Qwen3 235B |

**通过 Groq：**
| 模型 ID | 说明 |
|---------|------|
| `qwq-32b` | QwQ 32B (推理模型) |

**通过 Amazon Bedrock：**
| 模型 ID | 说明 |
|---------|------|
| `qwen.qwen3-235b-a22b-2507-v1:0` | Qwen3 235B |
| `qwen.qwen3-32b-v1:0` | Qwen3 32B |
| `qwen.qwen3-coder-30b-a3b-v1:0` | Qwen3 Coder 30B |
| `qwen.qwen3-coder-480b-a35b-v1:0` | Qwen3 Coder 480B |

### Kimi 系列 (月之暗面)

**通过 Kimi API：**
| 模型 ID | 说明 |
|---------|------|
| `kimi/kimi-k2-instruct` | Kimi K2 Instruct |

**通过 OpenRouter：**
| 模型 ID | 说明 |
|---------|------|
| `kimi/kimi-k2-instruct` | Kimi K2 Instruct |

**通过 Amazon Bedrock：**
| 模型 ID | 说明 |
|---------|------|
| `moonshot.kimi-k2-thinking` | Kimi K2 Thinking (推理模型) |

### MiniMax 系列

**国际版 (api.minimax.io)：**
| 模型 ID | 说明 |
|---------|------|
| `minimax/MiniMax-M2.1` | MiniMax M2.1 |
| `minimax/MiniMax-M2` | MiniMax M2 |
| `minimax/MiniMax-M1` | MiniMax M1 |

**中国版 (api.minimaxi.com)：**
| 模型 ID | 说明 |
|---------|------|
| `minimax-cn/MiniMax-M2.1` | MiniMax M2.1 (国内版) |
| `minimax-cn/MiniMax-M2` | MiniMax M2 (国内版) |

**通过 Amazon Bedrock：**
| 模型 ID | 说明 |
|---------|------|
| `minimax.minimax-m2` | MiniMax M2 |

### DeepSeek 系列

| 模型 ID | 说明 |
|---------|------|
| `deepseek/deepseek-chat` | DeepSeek Chat |
| `deepseek/deepseek-reasoner` | DeepSeek Reasoner |

**通过 Groq：**
| 模型 ID | 说明 |
|---------|------|
| `deepseek-r1-distill-llama-70b` | DeepSeek R1 Distill Llama 70B |

### Groq 系列

| 模型 ID | 说明 |
|---------|------|
| `groq/llama-3.3-70b-versatile` | Llama 3.3 70B |
| `groq/llama-3.1-70b-instruct` | Llama 3.1 70B |
| `groq/mixtral-8x7b-32768` | Mixtral 8x7B |
| `groq/qwq-32b` | QwQ 32B (推理模型) |

### OpenRouter 系列

| 模型 ID | 说明 |
|---------|------|
| `qwen/qwen3-coder-plus` | Qwen3 Coder Plus |
| `qwen/qwen-max` | Qwen Max |
| `qwen/qwen-plus` | Qwen Plus |
| `qwen/qwen-plus-2025-07-28` | Qwen Plus 2025-07-28 |

### Amazon Bedrock 系列

**Anthropic 模型：**
| 模型 ID | 说明 |
|---------|------|
| `anthropic.claude-sonnet-4-20250514` | Claude Sonnet 4 |
| `anthropic.claude-haiku-4-20250514` | Claude Haiku 4 |
| `anthropic.claude-3-5-sonnet-20241022-v2:0` | Claude 3.5 Sonnet v2 |

**Qwen 模型：**
| 模型 ID | 说明 |
|---------|------|
| `qwen.qwen3-235b-a22b-2507-v1:0` | Qwen3 235B |
| `qwen.qwen3-32b-v1:0` | Qwen3 32B |
| `qwen.qwen3-coder-30b-a3b-v1:0` | Qwen3 Coder 30B |
| `qwen.qwen3-coder-480b-a35b-v1:0` | Qwen3 Coder 480B |

**Kimi 模型：**
| 模型 ID | 说明 |
|---------|------|
| `moonshot.kimi-k2-thinking` | Kimi K2 Thinking |

**MiniMax 模型：**
| 模型 ID | 说明 |
|---------|------|
| `minimax.minimax-m2` | MiniMax M2 |

---

## 自定义 API

### 自建 Endpoint 配置

如果需要使用自建 API 端点，配置方式如下：

```json
{
  "providers": {
    "qwen": {
      "api_key": "your-api-key",
      "api_base": "http://your-server:8000/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "qwen-coder-plus"
    }
  }
}
```

### Ollama 本地模型

```json
{
  "providers": {
    "local": {
      "api_key": "not-needed",
      "api_base": "http://localhost:11434/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "local/llama-3.1-70b-instruct"
    }
  }
}
```

### vLLM / LM Studio

```json
{
  "providers": {
    "vllm": {
      "api_key": "not-needed",
      "api_base": "http://your-vllm-server:8000/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "vllm/Qwen3-235B-A22B"
    }
  }
}
```

---

## CLI 命令

### 查看已配置模型

```bash
# 列出所有模型
xopcbot models list

# 只显示内置模型
xopcbot models list --builtin

# JSON 格式输出
xopcbot models list --json
```

### 使用指定模型

```bash
# 使用默认模型
xopcbot agent -m "Hello"

# 指定模型
xopcbot agent -m "Hello" --model "qwen3-coder-plus"

# 交互模式
xopcbot agent -i
```

---

## 快速开始

### 1. 设置环境变量（推荐）

```bash
export QWEN_API_KEY="sk-..."
export MINIMAX_API_KEY="sk-..."
```

### 2. 创建最小配置

```bash
mkdir -p ~/.xopcbot
cat > ~/.xopcbot/config.json << 'EOF'
{
  "agents": {
    "defaults": {
      "model": "qwen3-coder-plus"
    }
  }
}
EOF
```

### 3. 运行

```bash
xopcbot agent -m "你好！"
```

---

## 常见问题

### Q: 提示 "API key 未配置"

确保环境变量已设置或在配置文件中添加：

```json
{
  "providers": {
    "qwen": {
      "api_key": "sk-your-key"
    }
  }
}
```

### Q: 模型返回 "Model not found"

检查模型 ID 是否正确：

```bash
xopcbot models list --builtin  # 查看可用模型
```

### Q: 如何切换提供商

编辑配置文件：

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-20250514"
    }
  }
}
```

### Q: 自定义 API 端点不工作

确保 `api_base` 正确且以 `/v1` 结尾：

```json
{
  "providers": {
    "custom": {
      "api_key": "sk-...",
      "api_base": "https://your-api.example.com/v1"
    }
  }
}
```

### Q: MiniMax 国际版和国内版区别

- **国际版** (`minimax/`): 使用 `api.minimax.io/anthropic`
- **国内版** (`minimax-cn/`): 使用 `api.minimaxi.com/anthropic`

```json
{
  "providers": {
    "minimax": { "api_key": "..." },      // 国际版
    "minimax-cn": { "api_key": "..." }    // 国内版
  }
}
```

### Q: Qwen 模型有哪些使用方式

1. **阿里云 DashScope**: `qwen/qwen-plus` (默认)
2. **OpenRouter**: `qwen3-coder-plus`, `qwen-max`
3. **Groq**: `qwq-32b` (推理模型)
4. **Amazon Bedrock**: `qwen.qwen3-235b-a22b-2507-v1:0`

```json
{
  "agents": {
    "defaults": {
      "model": "qwen3-coder-plus"  // OpenRouter
    }
  }
}
```
