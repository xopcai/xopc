# 模型配置

xopcbot 使用 `@mariozechner/pi-ai` 提供统一的 LLM API，支持 20+ 提供商。

## 目录

- [快速开始](#快速开始)
- [配置文件](#配置文件)
- [models.json](#modelsjson-动态配置)
- [环境变量](#环境变量)
- [内置提供商](#内置提供商)
- [Ollama 本地模型](#ollama-本地模型)
- [CLI 命令](#cli-命令)
- [常见问题](#常见问题)

---

## 快速开始

### 1. 设置 API Key

```bash
# 使用环境变量（推荐）
export OPENAI_API_KEY="sk-..."
export QWEN_API_KEY="sk-..."
export MINIMAX_API_KEY="sk-..."
```

### 2. 创建配置

```bash
mkdir -p ~/.xopcbot
cat > ~/.xopcbot/config.json << 'EOF'
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
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

## 配置文件

主配置文件位于 `~/.xopcbot/config.json`：

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  },
  "channels": {
    "telegram": { "enabled": true, "token": "..." }
  }
}
```

---

## models.json (动态配置)

从 v0.2.0 开始，支持通过 `models.json` 动态配置 Provider 和模型。

### 配置文件位置

- 项目目录：`./models.json`
- 用户目录：`~/.xopcbot/models.json`

### 示例配置

参考 `models.example.json`：

```json
{
  "providers": {
    "moonshot": {
      "baseUrl": "https://api.moonshot.ai/v1",
      "apiKey": "${MOONSHOT_API_KEY}",
      "api": "openai-completions",
      "models": [
        {
          "id": "kimi-k2.5",
          "name": "Kimi K2.5",
          "contextWindow": 256000,
          "maxTokens": 8192
        },
        {
          "id": "kimi-k2-thinking",
          "name": "Kimi K2 Thinking",
          "reasoning": true,
          "contextWindow": 256000,
          "maxTokens": 16384
        }
      ]
    },
    "qwen": {
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": "${QWEN_API_KEY}",
      "api": "openai-completions",
      "models": [
        {
          "id": "qwen-plus",
          "name": "Qwen Plus",
          "contextWindow": 131072,
          "maxTokens": 8192
        }
      ]
    },
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKey": "",
      "api": "openai-completions",
      "models": []
    }
  }
}
```

### 配置项说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `baseUrl` | 是 | API 基础 URL |
| `apiKey` | 否 | API Key，支持 `${ENV_VAR}` 语法 |
| `api` | 否 | API 类型：`openai-completions`、`anthropic-messages`、`google-generative-ai` |
| `headers` | 否 | 自定义请求头 |
| `authHeader` | 否 | 是否自动添加 `Authorization: Bearer` 头 |
| `models` | 否 | 自定义模型列表（留空则使用内置模型） |

### 模型配置项

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 模型 ID |
| `name` | 否 | 显示名称（默认等于 id） |
| `reasoning` | 否 | 是否为推理模型 |
| `input` | 否 | 输入类型：`["text"]` 或 `["text", "image"]` |
| `contextWindow` | 否 | 上下文窗口大小（默认 128000） |
| `maxTokens` | 否 | 最大输出 tokens（默认 16384） |
| `cost` | 否 | 价格配置 |
| `compat` | 否 | 兼容性设置 |

---

## 环境变量

### API Key 环境变量

| Provider | 环境变量 | API Base |
|----------|----------|----------|
| OpenAI | `OPENAI_API_KEY` | api.openai.com/v1 |
| Anthropic | `ANTHROPIC_API_KEY` | api.anthropic.com |
| Google | `GOOGLE_API_KEY` / `GEMINI_API_KEY` | generativelanguage.googleapis.com |
| Qwen | `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | dashscope.aliyuncs.com/compatible-mode/v1 |
| Kimi/Moonshot | `KIMI_API_KEY` / `MOONSHOT_API_KEY` | api.moonshot.cn/v1 |
| MiniMax (国际) | `MINIMAX_API_KEY` | api.minimax.io/anthropic |
| MiniMax (中国) | `MINIMAX_CN_API_KEY` | api.minimaxi.com/anthropic |
| DeepSeek | `DEEPSEEK_API_KEY` | api.deepseek.com/v1 |
| Groq | `GROQ_API_KEY` | api.groq.com/openai/v1 |
| OpenRouter | `OPENROUTER_API_KEY` | openrouter.ai/api/v1 |
| xAI | `XAI_API_KEY` | api.x.ai/v1 |
| Ollama | 无需配置 | 127.0.0.1:11434/v1 |

### 在配置中使用环境变量

```json
{
  "providers": {
    "moonshot": {
      "baseUrl": "https://api.moonshot.ai/v1",
      "apiKey": "${MOONSHOT_API_KEY}"
    }
  }
}
```

---

## 内置提供商

以下 Provider 无需在 `models.json` 中配置，直接使用环境变量即可：

| Provider | API Base | API 类型 | 环境变量 |
|----------|----------|----------|----------|
| openai | api.openai.com/v1 | openai-completions | `OPENAI_API_KEY` |
| anthropic | api.anthropic.com | anthropic-messages | `ANTHROPIC_API_KEY` |
| google | generativelanguage.googleapis.com | google-generative-ai | `GOOGLE_API_KEY` |
| minimax | api.minimax.io/anthropic | anthropic-messages | `MINIMAX_API_KEY` |
| minimax-cn | api.minimaxi.com/anthropic | anthropic-messages | `MINIMAX_CN_API_KEY` |
| groq | api.groq.com/openai/v1 | openai-completions | `GROQ_API_KEY` |
| openrouter | openrouter.ai/api/v1 | openai-completions | `OPENROUTER_API_KEY` |
| xai | api.x.ai/v1 | openai-completions | `XAI_API_KEY` |

---

## Ollama 本地模型

xopcbot 支持自动发现本地 Ollama 实例。

### 前置条件

1. 安装 [Ollama](https://ollama.ai)
2. 拉取模型：`ollama pull llama3.3`

### 自动发现

Ollama 模型会被自动发现：

```bash
xopcbot models list
```

输出示例：
```
✅ ollama
  • llama3.3
  • qwen2.5-coder:7b
  • deepseek-r1:671b  🧠
  • codellama:7b
```

标记 🧠 表示推理模型。

### 手动配置

如果自动发现失败，可以在 `models.json` 中配置：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKey": "",
      "api": "openai-completions",
      "models": [
        {
          "id": "llama3.3",
          "name": "Llama 3.3 70B",
          "contextWindow": 131072,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

### Ollama 注意事项

- Ollama 默认禁用流式响应（兼容性原因）
- 本地模型无需 API Key
- 推荐模型：Llama 3.3、Qwen2.5-Coder、DeepSeek R1

---

## CLI 命令

### 查看可用模型

```bash
# 列出所有模型（包括本地 Ollama）
xopcbot models list

# 只显示已配置（有 API Key）的模型
xopcbot models list --available

# JSON 格式输出
xopcbot models list --json

# 查看原始模型数据
xopcbot models list --all
```

### 设置 API Key

```bash
# 设置 API Key
xopcbot models auth set openai sk-xxx

# 列出已配置的认证
xopcbot models auth list
```

### 添加自定义 Provider

```bash
# 添加自定义 Provider
xopcbot models add \
  --provider custom \
  --base-url https://api.custom.com/v1 \
  --api-key ${CUSTOM_API_KEY} \
  --api openai-completions \
  --model-id my-model \
  --model-name "My Model"
```

### 删除 Provider/模型

```bash
# 删除整个 Provider
xopcbot models remove moonshot

# 删除特定模型
xopcbot models remove moonshot/kimi-k2.5
```

---

## 模型参考

### OpenAI

| 模型 ID | 说明 | Context |
|---------|------|---------|
| `openai/gpt-4o` | GPT-4o | 128K |
| `openai/gpt-4o-mini` | GPT-4o Mini | 128K |
| `openai/o1` | o1 (推理) | 200K |
| `openai/o3` | o3 (推理) | 200K |

### Anthropic

| 模型 ID | 说明 | Context |
|---------|------|---------|
| `anthropic/claude-sonnet-4-5` | Claude Sonnet 4.5 | 200K |
| `anthropic/claude-haiku-4-5` | Claude Haiku 4.5 | 200K |
| `anthropic/claude-opus-4-5` | Claude Opus 4.5 | 200K |

### Google

| 模型 ID | 说明 | Context |
|---------|------|---------|
| `google/gemini-2.5-pro` | Gemini 2.5 Pro | 2M |
| `google/gemini-2.5-flash` | Gemini 2.5 Flash | 1M |

### Qwen

| 模型 ID | 说明 | Context |
|---------|------|---------|
| `qwen/qwen-plus` | Qwen Plus | 131K |
| `qwen/qwen-max` | Qwen Max | 131K |
| `qwen/qwen3-32b-v1:0` | Qwen3 32B | 131K |

### Kimi (Moonshot)

| 模型 ID | 说明 | Context |
|---------|------|---------|
| `moonshot/kimi-k2.5` | Kimi K2.5 | 256K |
| `moonshot/kimi-k2-thinking` | Kimi K2 Thinking (推理) | 256K |

### MiniMax

| 模型 ID | 说明 | Context |
|---------|------|---------|
| `minimax/MiniMax-M2.1` | MiniMax M2.1 | 200K |
| `minimax-cn/MiniMax-M2.1` | MiniMax M2.1 (国内) | 200K |

### DeepSeek

| 模型 ID | 说明 | Context |
|---------|------|---------|
| `deepseek/deepseek-chat` | DeepSeek Chat | 131K |
| `deepseek/deepseek-reasoner` | DeepSeek Reasoner (推理) | 131K |

---

## 常见问题

### Q: 提示 "API key 未配置"

确保：
1. 环境变量已设置：`echo $OPENAI_API_KEY`
2. 或使用 `xopcbot models auth set openai sk-xxx`

### Q: 模型返回 "Model not found"

```bash
xopcbot models list  # 查看可用模型
```

### Q: 如何切换模型

编辑 `config.json`：

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

### Q: Ollama 模型未显示

1. 确保 Ollama 正在运行
2. 检查端口：`curl http://127.0.0.1:11434/api/tags`
3. 拉取模型：`ollama pull llama3.3`

### Q: 自定义 API 端点不工作

确保 `baseUrl` 以 `/v1` 结尾：

```json
{
  "providers": {
    "custom": {
      "baseUrl": "https://your-api.example.com/v1",
      "apiKey": "${CUSTOM_API_KEY}"
    }
  }
}
```

### Q: 模型格式错误

运行验证：

```bash
xopcbot models list --json | jq '.'
```

### Q: 需要代理访问

在配置中添加代理头：

```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "headers": {
        "Proxy-Authorization": "Bearer proxy-token"
      }
    }
  }
}
```
