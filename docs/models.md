# 模型配置

xopcbot 使用 `@mariozechner/pi-ai` 提供统一的 LLM API，支持 20+ 提供商。同时也支持自定义模型配置。

## 目录

- [配置文件](#配置文件)
- [自定义模型](#自定义模型)
- [模型格式](#模型格式)
- [内置提供商](#内置提供商)
- [环境变量](#环境变量)

---

## 配置文件

配置文件位于 `~/.xopcbot/config.json`：

```json
{
  "providers": {
    "openai": { "api_key": "sk-..." },
    "anthropic": { "api_key": "sk-ant-..." }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

---

## 自定义模型

xopcbot 支持配置自定义模型提供商，包括自托管模型、私有部署等。

### 配置结构

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "<provider-name>": {
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "sk-your-api-key",
        "apiType": "openai",
        "headers": {
          "X-Custom-Header": "value"
        },
        "models": [
          {
            "id": "<model-id>",
            "name": "Model Display Name",
            "cost": {
              "input": 10,
              "output": 30,
              "cacheRead": 2,
              "cacheWrite": 10
            },
            "contextWindow": 131072,
            "maxTokens": 8192,
            "reasoning": false,
            "input": ["text", "image"]
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "<provider-name>/<model-id>"
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `models.mode` | `merge` \| `replace` | 否 | `merge` 合并到内置模型，`replace` 替换全部 |
| `models.providers.<name>.baseUrl` | string | 是 | API 基础地址 |
| `models.providers.<name>.apiKey` | string | 否 | API 密钥 |
| `models.providers.<name>.apiType` | `openai` \| `anthropic` | 否 | API 类型，默认 `openai` |
| `models.providers.<name>.headers` | object | 否 | 自定义请求头 |
| `models.providers.<name>.models[].id` | string | 是 | 模型 ID |
| `models.providers.<name>.models[].name` | string | 是 | 模型显示名称 |
| `models.providers.<name>.models[].cost` | object | 否 | 价格（每百万 tokens） |
| `models.providers.<name>.models[].contextWindow` | number | 否 | 上下文窗口大小 |
| `models.providers.<name>.models[].maxTokens` | number | 否 | 最大输出 tokens |
| `models.providers.<name>.models[].reasoning` | boolean | 否 | 是否支持思考模型 |
| `models.providers.<name>.models[].input` | string[] | 否 | 支持的输入类型 |

### 示例：Qwen 自定义模型

```json
{
  "models": {
    "providers": {
      "qwen-custom": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "apiKey": "sk-your-qwen-api-key",
        "apiType": "openai",
        "models": [
          {
            "id": "qwen-code-plus",
            "name": "Qwen Code Plus",
            "cost": { "input": 10, "output": 30 },
            "contextWindow": 131072,
            "maxTokens": 8192
          },
          {
            "id": "qwen-code-max",
            "name": "Qwen Code Max",
            "cost": { "input": 20, "output": 60 },
            "contextWindow": 131072,
            "maxTokens": 16384
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "qwen-custom/qwen-code-plus"
    }
  }
}
```

### 示例：Kimi 自定义模型

```json
{
  "models": {
    "providers": {
      "kimi-custom": {
        "baseUrl": "https://api.moonshot.cn/v1",
        "apiKey": "sk-your-kimi-api-key",
        "apiType": "openai",
        "models": [
          {
            "id": "kimi-4.5",
            "name": "Kimi 4.5",
            "cost": { "input": 10, "output": 50 },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "kimi-custom/kimi-4.5"
    }
  }
}
```

### 示例：自托管 vLLM

```json
{
  "models": {
    "providers": {
      "local-llama": {
        "baseUrl": "http://localhost:8000/v1",
        "apiKey": "not-needed",
        "apiType": "openai",
        "models": [
          {
            "id": "llama-3.1-70b-instruct",
            "name": "Local Llama 3.1",
            "cost": { "input": 0, "output": 0 },
            "contextWindow": 131072,
            "maxTokens": 4096
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "local-llama/llama-3.1-70b-instruct"
    }
  }
}
```

### 使用 CLI 管理模型

```bash
# 列出所有已配置的自定义模型
xopcbot models list

# JSON 格式输出
xopcbot models list --json
```

输出示例：
```
📋 Available Models

──────────────────────────────────────────────────

🤖 Qwen Code Plus
   ID: qwen-custom/qwen-code-plus
   Provider: qwen-custom

🤖 Qwen Code Max
   ID: qwen-custom/qwen-code-max
   Provider: qwen-custom

──────────────────────────────────────────────────

📌 Current default model: qwen-custom/qwen-code-plus
```

---

## 模型格式

### 格式说明

模型 ID 可以是：
- **简短格式**（自动检测提供商）：`gpt-4o`、`claude-3-5-sonnet`
- **完整格式**（指定提供商）：`openai/gpt-4o`、`anthropic/claude-3-5-sonnet`
- **自定义格式**：`qwen-custom/qwen-code-plus`

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

## 内置提供商

### OpenAI

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `gpt-4o` | 128K | ❌ |
| `gpt-4o-mini` | 128K | ❌ |
| `gpt-4.1` | 1M | ❌ |
| `gpt-4.1-mini` | 1M | ❌ |
| `gpt-5` | 400K | ✅ |
| `o1` | 200K | ✅ |
| `o3` | 200K | ✅ |
| `o3-mini` | 200K | ✅ |

### Anthropic

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `claude-haiku-4-5` | 200K | ✅ |
| `claude-sonnet-4-5` | 200K | ✅ |
| `claude-opus-4-5` | 200K | ✅ |
| `claude-3-5-sonnet` | 200K | ❌ |

### Google Gemini

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `gemini-2.5-pro` | 1M | ✅ |
| `gemini-2.5-flash` | 1M | ✅ |

### DeepSeek

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `deepseek-chat` | 128K | ❌ |
| `deepseek-reasoner` | 128K | ✅ |
| `deepseek-v3` | 128K | ❌ |

### Qwen (阿里巴巴)

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `qwen-plus` | 1M | ❌ |
| `qwen-max` | 131K | ❌ |
| `qwen3-235b-a22b` | 128K | ✅ |
| `qwq-plus` | 131K | ✅ |

### Kimi (月之暗面)

| 模型 | 上下文 | Reasoning |
|------|--------|-----------|
| `kimi-k2.5` | 262K | ✅ |
| `kimi-k2-thinking` | 262K | ✅ |

### MiniMax

| 模型 | 上下文 |
|------|--------|
| `minimax-m2.1` | 1M |

### Groq

| 模型 | 上下文 |
|------|--------|
| `llama-3.3-70b-versatile` | 128K |

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
# 列出自定义模型
xopcbot models list

# 使用自定义模型
xopcbot agent -m "Hello"
```

---

## 常见问题

### Q: 自定义模型无法连接

1. 检查 `baseUrl` 是否正确
2. 确认 API 服务正在运行
3. 检查网络连接和防火墙

### Q: 如何调试自定义模型

使用 `DEBUG=* xopcbot agent -m "test"` 查看详细日志。

### Q: 价格计算不准确

在模型配置中设置 `cost` 字段来自定义价格：
```json
{
  "models": {
    "providers": {
      "custom": {
        "models": [{
          "id": "my-model",
          "cost": { "input": 10, "output": 30 }
        }]
      }
    }
  }
}
```
