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
    "deepseek": { "api_key": "..." },
    "google": { "api_key": "..." }
  },
  "agents": {
    "defaults": {
      "model": "qwen/qwen-plus"
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
      "model": "qwen/qwen-plus"
    }
  }
}
```

---

## 环境变量

API Key 也可以通过环境变量设置（推荐）：

| Provider | 环境变量 |
|---------|----------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_API_KEY` 或 `GEMINI_API_KEY` |
| Qwen | `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY` |
| Kimi | `KIMI_API_KEY` 或 `MOONSHOT_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Groq | `GROQ_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |

### 使用示例

```bash
# Bash
export OPENAI_API_KEY="sk-..."
export QWEN_API_KEY="sk-..."

# 在配置文件中
{
  "agents": {
    "defaults": {
      "model": "qwen/qwen-plus"
    }
  }
}

# 运行
xopcbot agent -m "Hello"
```

---

## 内置提供商

xopcbot 内置了以下提供商的默认配置：

| Provider | API Base | 默认模型 |
|----------|----------|----------|
| OpenAI | api.openai.com/v1 | gpt-4o |
| Anthropic | api.anthropic.com | claude-sonnet-4-5 |
| Google | generativelanguage.googleapis.com | gemini-2.5-pro |
| Qwen (国内) | dashscope.aliyuncs.com | qwen-plus |
| Kimi (国内) | api.moonshot.cn | kimi-k2.5 |
| MiniMax | api.minimax.chat | minimax-m2.1 |
| DeepSeek | api.deepseek.com | deepseek-chat |
| Groq | api.groq.com/openai/v1 | llama-3.3-70b |

### 支持的模型

```bash
# 查看所有支持的模型
xopcbot models list --builtin
```

### 可用模型列表

#### OpenAI
- `openai/gpt-4o`
- `openai/gpt-4o-mini`
- `openai/gpt-5`
- `openai/o1`
- `openai/o3`

#### Anthropic
- `anthropic/claude-sonnet-4-5`
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-opus-4-5`

#### Google
- `google/gemini-2.5-pro`
- `google/gemini-2.5-flash`

#### Qwen (通义千问)
- `qwen/qwen-plus`
- `qwen/qwen-max`
- `qwen/qwen3-235b-a22b`

#### Kimi (月之暗面)
- `kimi/kimi-k2.5`
- `kimi/kimi-k2-thinking`

#### MiniMax
- `minimax/minimax-m2.1`
- `minimax/minimax-m2`

#### DeepSeek
- `deepseek/deepseek-chat`
- `deepseek/deepseek-reasoner`

#### Groq
- `groq/llama-3.3-70b-versatile`

---

## 自定义 API

如果需要使用自定义 API 端点，可以指定 `api_base`：

```json
{
  "providers": {
    "qwen": {
      "api_key": "sk-your-key",
      "api_base": "https://your-custom-endpoint.com/v1",
      "api_type": "openai"
    }
  },
  "agents": {
    "defaults": {
      "model": "qwen/your-model"
    }
  }
}
```

### 自托管模型示例

```json
{
  "providers": {
    "local": {
      "api_key": "not-needed",
      "api_base": "http://localhost:8000/v1",
      "api_type": "openai"
    }
  },
  "agents": {
    "defaults": {
      "model": "local/llama-3.1-70b-instruct"
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
xopcbot agent -m "Hello" --model qwen/qwen-plus

# 交互模式
xopcbot agent -i
```

---

## 快速开始

### 1. 设置环境变量（推荐）

```bash
export OPENAI_API_KEY="sk-..."
export QWEN_API_KEY="sk-..."
```

### 2. 创建最小配置

```bash
mkdir -p ~/.xopcbot
cat > ~/.xopcbot/config.json << 'EOF'
{
  "agents": {
    "defaults": {
      "model": "qwen/qwen-plus"
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

编辑配置文件或使用环境变量：

```json
{
  "agents": {
    "defaults": {
      "model": "openai/gpt-4o"
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
      "api_base": "https://your-api.example.com/v1",
      "api_type": "openai"
    }
  }
}
```
