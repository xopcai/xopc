# 配置参考

xopcbot 所有配置集中在 `~/.config/xopcbot/config.json` 文件中。

## 完整配置示例

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.xopcbot/workspace",
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
      },
      "max_tokens": 8192,
      "temperature": 0.7,
      "max_tool_iterations": 20
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-...",
        "models": [
          { "id": "gpt-4o", "name": "GPT-4o" },
          { "id": "gpt-4o-mini", "name": "GPT-4o Mini" }
        ]
      },
      "anthropic": {
        "apiKey": "sk-ant-...",
        "models": [
          { "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5", "reasoning": true }
        ]
      },
      "minimax": {
        "apiKey": "...",
        "models": [
          { "id": "minimax-m2.1", "name": "MiniMax M2.1" }
        ]
      },
      "openrouter": {
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "sk-or-...",
        "models": [
          { "id": "openai/gpt-4o", "name": "GPT-4o (via OpenRouter)" }
        ]
      },
      "groq": {
        "baseUrl": "https://api.groq.com/openai/v1",
        "apiKey": "gsk_...",
        "models": [
          { "id": "llama-3.1-70b-versatile", "name": "Llama 3.1 70B" }
        ]
      },
      "google": {
        "apiKey": "AIza...",
        "models": [
          { "id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash" }
        ]
      },
      "deepseek": {
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "...",
        "models": [
          { "id": "deepseek-chat", "name": "DeepSeek Chat" }
        ]
      },
      "ollama": {
        "baseUrl": "http://127.0.0.1:11434/v1",
        "enabled": true,
        "models": [
          { "id": "llama3", "name": "Llama 3" }
        ]
      }
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      "allow_from": []
    },
    "whatsapp": {
      "enabled": false,
      "bridge_url": "ws://localhost:3001",
      "allow_from": []
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  },
  "tools": {
    "web": {
      "search": {
        "api_key": "",
        "max_results": 5
      }
    }
  },
  "modelsDev": {
    "enabled": true
  }
}
```

## 配置选项

### agents

智能体默认配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `workspace` | string | `~/.xopcbot/workspace` | 工作目录 |
| `model` | string / object | `anthropic/claude-sonnet-4-5` | 默认模型 |
| `max_tokens` | number | `8192` | 最大输出 tokens |
| `temperature` | number | `0.7` | 温度参数 (0-2) |
| `max_tool_iterations` | number | `20` | 最大工具调用次数 |

### agents.defaults.model

模型配置支持两种格式：

**简单格式（单个模型）：**
```json
{
  "model": "anthropic/claude-sonnet-4-5"
}
```

**对象格式（带备用模型）：**
```json
{
  "model": {
    "primary": "anthropic/claude-sonnet-4-5",
    "fallbacks": ["openai/gpt-4o"]
  }
}
```

模型 ID 格式为 `provider/model-id`，例如 `anthropic/claude-opus-4-5`。

### models

OpenClaw 风格的模型配置。用于配置 API 提供商和可用模型。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `mode` | string | `merge` | 配置合并模式：`merge` 或 `replace` |
| `providers` | object | `{}` | 提供商配置 |
| `bedrockDiscovery` | object | `{}` | AWS Bedrock 模型发现设置 |

### models.providers

在此部分配置每个 LLM 提供商：

```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-...",
        "models": [
          { "id": "gpt-4o", "name": "GPT-4o" }
        ]
      }
    }
  }
}
```

提供商配置选项：

| 字段 | 类型 | 说明 |
|-------|------|------|
| `baseUrl` | string | API 端点 URL |
| `apiKey` | string | API 密钥（支持 `${ANTHROPIC_API_KEY}` 等环境变量） |
| `api` | string | API 类型：`openai-completions`、`anthropic-messages`、`google-generative-ai` |
| `auth` | object | OAuth 配置 |
| `headers` | object | 自定义 HTTP 头 |
| `enabled` | boolean | 启用/禁用提供商 |
| `models` | array | 可用模型列表 |

### models.providers.[provider].models

每个模型定义：

```json
{
  "id": "gpt-4o",
  "name": "GPT-4o",
  "reasoning": false,
  "input": ["text", "image"],
  "cost": {
    "input": 0.000005,
    "output": 0.000015
  },
  "contextWindow": 128000,
  "maxTokens": 16384
}
```

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `id` | string | (必填) | 模型标识符 |
| `name` | string | (必填) | 显示名称 |
| `reasoning` | boolean | `false` | 支持推理/思考 |
| `input` | array | `["text"]` | 输入类型：`text`、`image` |
| `cost` | object | | 价格信息 |
| `contextWindow` | number | `128000` | 上下文窗口大小 |
| `maxTokens` | number | `16384` | 最大输出 tokens |

### channels

通信渠道配置。

### channels.telegram

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 Telegram 机器人 |
| `token` | string | - | 从 @BotFather 获取的机器人令牌 |
| `allow_from` | array | `[]` | 允许的用户 ID（空 = 允许所有） |
| `group_admins` | boolean | `false` | 仅允许群管理员 |
| `magic` | string | - | 提及前缀 |

### channels.whatsapp

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 WhatsApp 桥接 |
| `bridge_url` | string | `ws://localhost:3001` | WhatsApp 桥接 WebSocket URL |
| `allow_from` | array | `[]` | 允许的手机号 |

### channels.discord

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 Discord 机器人 |
| `token` | string | - | 机器人令牌 |
| `allow_from` | array | `[]` | 允许的群组/频道 ID |

### channels.slack

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 Slack 机器人 |
| `token` | string | - | 机器人令牌 |
| `allow_from` | array | `[]` | 允许的频道 ID |

### channels.signal

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 Signal 机器人 |
| `phone_number` | string | - | Signal 手机号 |
| `device_name` | string | - | 设备名称 |
| `allow_from` | array | `[]` | 允许的手机号 |

### gateway

HTTP API 网关配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `host` | string | `0.0.0.0` | 绑定地址 |
| `port` | number | `18790` | 端口号 |
| `auth` | object | - | 认证配置 |
| `cors` | object | - | CORS 设置 |

### gateway.auth

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用认证 |
| `username` | string | - | 用户名 |
| `password` | string | - | 密码 |
| `api_key` | string | - | API 密钥认证 |

### gateway.cors

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 CORS |
| `origins` | array | `[]` | 允许的来源 |
| `credentials` | boolean | `false` | 允许凭证 |

### tools

工具配置。

### tools.web

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `search` | object | - | 网页搜索配置 |
| `browse` | object | - | 网页浏览配置 |

### tools.web.search

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `provider` | string | `brave` | 搜索提供商：`brave`、`searxng` |
| `api_key` | string | - | API 密钥 |
| `max_results` | number | `5` | 最大结果数 |

### tools.web.browse

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用浏览 |
| `max_depth` | number | `2` | 最大链接深度 |
| `timeout` | number | `30000` | 超时毫秒数 |

### cron

定时任务配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用 cron |
| `jobs` | array | `[]` | 定时任务列表 |

### heartbeat

定期健康检查配置。

| 字段 |类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用心跳 |
| `interval` | number | `300000` | 间隔毫秒数（5分钟）|
| `checks` | array | - | 检查列表 |

### modelsDev

本地模型开发设置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用本地模型缓存 |

## 环境变量

xopcbot 支持环境变量来存储敏感数据：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `GOOGLE_API_KEY` | Google AI API 密钥 |
| `TELEGRAM_BOT_TOKEN` | Telegram 机器人令牌 |
| `WHATSAPP_BRIDGE_URL` | WhatsApp 桥接 URL |

环境变量优先于配置文件中的值。

## 问答

### Q: 如何使用多个提供商？

使用 `models` 配置来定义多个提供商。智能体会根据模型 ID 自动选择合适的提供商：

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "${OPENAI_API_KEY}",
        "models": [
          { "id": "gpt-4o", "name": "GPT-4o" }
        ]
      },
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "models": [
          { "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5", "reasoning": true }
        ]
      }
    }
  }
}
```

在 `agents.defaults.model` 中设置不同的模型来使用不同的提供商。

### Q: 如何配置 Ollama？

```json
{
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://127.0.0.1:11434/v1",
        "enabled": true,
        "autoDiscovery": true,
        "models": [
          { "id": "llama3", "name": "Llama 3" }
        ]
      }
    }
  }
}
```

### Q: 如何配置 OAuth？

某些提供商支持 OAuth 认证：

```json
{
  "models": {
    "providers": {
      "anthropic": {
        "baseUrl": "https://api.anthropic.com",
        "auth": {
          "type": "oauth",
          "clientId": "...",
          "clientSecret": "..."
        },
        "models": []
      }
    }
  }
}
```

### Q: 什么是 modelsDev？

启用后，xopcbot 会自动从内置本地缓存加载模型信息，包括来自 OpenAI、Anthropic、Google、Groq、DeepSeek 等提供商的模型。这可以更快地列出模型，无需在运行时发起网络请求。
