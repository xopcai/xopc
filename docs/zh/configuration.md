# 配置参考

xopcbot 的所有配置都集中在 `~/.config/xopcbot/config.json` 文件中。

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
  "providers": {
    "openai": {
      "api_key": "sk-...",
      "base_url": "https://api.openai.com/v1"
    },
    "anthropic": {
      "api_key": "sk-ant-..."
    },
    "minimax": {
      "api_key": "..."
    },
    "openrouter": {
      "api_key": "sk-or-...",
      "base_url": "https://openrouter.ai/api/v1"
    },
    "groq": {
      "api_key": "gsk_..."
    },
    "google": {
      "api_key": "AIza..."
    },
    "deepseek": {
      "api_key": "..."
    },
    "ollama": {
      "enabled": true,
      "base_url": "http://127.0.0.1:11434/v1"
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
  }
}
```

## 配置项详解

### agents

Agent 的默认配置。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `workspace` | string | `~/.xopcbot/workspace` | 工作区目录 |
| `model` | string / object | `anthropic/claude-sonnet-4-5` | 默认模型 |
| `max_tokens` | number | `8192` | 最大输出 token |
| `temperature` | number | `0.7` | 温度参数 (0-2) |
| `max_tool_iterations` | number | `20` | 最大工具调用次数 |

### agents.defaults.model

模型配置支持两种格式：

**简单格式（单个模型）：**
```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

**完整格式（主模型 + 备用模型）：**
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": [
          "openai/gpt-4o",
          "minimax/minimax-m2.1",
          "google/gemini-2.5-flash"
        ]
      }
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `primary` | string | 主要模型 (provider/model 格式) |
| `fallbacks` | string[] | 备用模型列表，当主模型失败时自动切换 |

#### 模型回退机制

当主模型调用失败时，xopcbot 会自动尝试备用模型列表中的模型：

1. **支持的失败类型**：
   - `auth` - 认证失败 (401, 403)
   - `rate_limit` - 速率限制 (429)
   - `billing` - 账单/配额问题 (402)
   - `timeout` - 请求超时
   - `format` - 请求格式错误 (400)

2. **回退流程**：
   - 主模型调用失败
   - 检测失败原因
   - 按顺序尝试备用模型
   - 任意模型成功则返回结果
   - 所有模型失败则抛出错误

3. **示例配置**：
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": [
          "openai/gpt-4o",
          "minimax/minimax-m2.1"
        ]
      }
    }
  },
  "providers": {
    "anthropic": { "api_key": "sk-ant-..." },
    "openai": { "api_key": "sk-..." },
    "minimax": { "api_key": "..." }
  }
}
```

模型 ID 格式：
- **简短格式**：`gpt-4o` (使用默认 provider)
- **完整格式**：`anthropic/claude-sonnet-4-5`

### providers

LLM 提供商配置。

#### openai

```json
{
  "providers": {
    "openai": {
      "api_key": "sk-...",
      "api_base": "https://api.openai.com/v1"
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `api_key` | string | OpenAI API Key |
| `api_base` | string | (可选) 自定义 API 地址 |

#### anthropic

```json
{
  "providers": {
    "anthropic": {
      "api_key": "sk-ant-..."
    }
  }
}
```

#### openrouter

```json
{
  "providers": {
    "openrouter": {
      "api_key": "sk-or-...",
      "api_base": "https://openrouter.ai/api/v1"
    }
  }
}
```

#### groq

```json
{
  "providers": {
    "groq": {
      "api_key": "gsk_..."
    }
  }
}
```

#### gemini

```json
{
  "providers": {
    "gemini": {
      "api_key": "AIza..."
    }
  }
}
```

#### zhipu (智谱 AI)

```json
{
  "providers": {
    "zhipu": {
      "api_key": "...",
      "api_base": "https://open.bigmodel.cn/api/paas/v4"
    }
  }
}
```

#### vllm (本地部署)

```json
{
  "providers": {
    "vllm": {
      "api_key": "dummy",
      "api_base": "http://localhost:8000/v1"
    }
  }
}
```

### channels

通信通道配置。

#### telegram

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "123456:...",
      "allow_from": ["@username", "123456789"]
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用 |
| `token` | string | Bot Token |
| `allow_from` | string[] | 白名单用户 |

获取 Token：[@BotFather](https://t.me/BotFather)

#### whatsapp

```json
{
  "channels": {
    "whatsapp": {
      "enabled": false,
      "bridge_url": "ws://localhost:3001",
      "allow_from": []
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用 |
| `bridge_url` | string | WA Bridge WebSocket 地址 |
| `allow_from` | string[] | 白名单用户 |

### gateway

REST 网关配置。

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `host` | string | 绑定地址 |
| `port` | number | 端口号 |

### tools

内置工具配置。

```json
{
  "tools": {
    "web": {
      "search": {
        "api_key": "",
        "max_results": 5
      }
    }
  }
}
```

## 环境变量

配置也可以通过环境变量设置，会覆盖配置文件：

| 配置项 | 环境变量 |
|--------|----------|
| OpenAI API Key | `OPENAI_API_KEY` |
| Anthropic API Key | `ANTHROPIC_API_KEY` |
| OpenRouter API Key | `OPENROUTER_API_KEY` |
| Groq API Key | `GROQ_API_KEY` |
| Google API Key | `GOOGLE_API_KEY` |
| MiniMax API Key | `MINIMAX_API_KEY` |
| DeepSeek API Key | `DEEPSEEK_API_KEY` |
| Brave Search API Key | `BRAVE_API_KEY` |
| Telegram Bot Token | `TELEGRAM_BOT_TOKEN` |

示例：

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export MINIMAX_API_KEY="..."
export DEEPSEEK_API_KEY="..."
```

## 配置文件位置

| 用途 | 位置 |
|------|------|
| 配置文件 | `~/.config/xopcbot/config.json` |
| 工作区 | `~/.xopcbot/workspace/` |
| 会话数据 | `~/.xopcbot/workspace/sessions/` |

## 验证配置

运行命令检查配置：

```bash
# 测试 Provider 连接
npm run dev -- agent -m "Hello"

# 列出定时任务
npm run dev -- cron list
```

## 常见问题

### Q: 修改配置后需要重启吗？

是的，修改 `config.json` 后需要重启服务。

### Q: 如何使用多个提供商？

配置多个 provider，agent 会根据模型名称自动选择：

```json
{
  "providers": {
    "openai": { "api_key": "sk-..." },
    "anthropic": { "api_key": "sk-ant-..." }
  }
}
```

设置不同模型使用不同提供商。

### Q: API Key 安全性

- 不要将配置文件提交到 Git
- 使用环境变量存储敏感信息
- 配置文件的权限应设为 `600`
