# 配置参考

xopcbot 所有配置集中在 `~/.xopcbot/config.json` 文件中。

## 快速开始

运行交互式设置向导：

```bash
xopcbot onboard
```

或手动创建：

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  },
  "providers": {
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

---

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
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "deepseek": "${DEEPSEEK_API_KEY}",
    "groq": "${GROQ_API_KEY}",
    "google": "${GOOGLE_API_KEY}",
    "minimax": "${MINIMAX_API_KEY}"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        }
      }
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  },
  "tools": {
    "web": {
      "search": {
        "api_key": "${BRAVE_API_KEY}",
        "max_results": 5
      }
    }
  },
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "auto",
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "tts-1",
      "voice": "alloy"
    }
  },
  "heartbeat": {
    "enabled": true,
    "intervalMs": 300000
  }
}
```

---

## 配置章节

### agents

智能体默认配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `workspace` | string | `~/.xopcbot/workspace` | 工作目录 |
| `model` | string/object | `anthropic/claude-sonnet-4-5` | 默认模型 |
| `max_tokens` | number | `8192` | 最大输出 tokens |
| `temperature` | number | `0.7` | 温度参数 (0-2) |
| `max_tool_iterations` | number | `20` | 最大工具调用次数 |

#### agents.defaults.model

模型配置支持两种格式：

**简单格式：**
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
    "fallbacks": ["openai/gpt-4o", "minimax/minimax-m2.1"]
  }
}
```

模型 ID 格式：`provider/model-id`（如 `anthropic/claude-opus-4-5`）。

---

### providers

配置 LLM 提供商 API 密钥。使用环境变量引用：

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}",
    "deepseek": "sk-...",
    "groq": "${GROQ_API_KEY}"
  }
}
```

**支持的提供商：**

| 提供商 | 环境变量 |
|--------|----------|
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `google` | `GOOGLE_API_KEY` 或 `GEMINI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `huggingface` | `HF_TOKEN` 或 `HUGGINGFACE_TOKEN` |

> **注意:** 环境变量优先于配置文件中的值。

查看 [模型文档](/zh/models) 了解自定义提供商配置。

---

### bindings

可选的规则数组，用于将入站流量分配到指定 **`agentId`**。按 **`priority`** 从高到低匹配；每条 **`match`** 中的 **`channel`** 须为精确通道 id（如 `telegram`），**`peerId`** 可使用 `*` 通配。若无匹配，则使用默认 Agent（**`agents.list`** 中第一个启用的 id，否则为 `main`）。详见 [Session 路由系统](/zh/routing-system)。

---

### session

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dmScope` | string | `main` | DM 会话合并/拆分策略：`main`、`per-peer`、`per-channel-peer`、`per-account-channel-peer` |
| `identityLinks` | object | - | 规范 id → `["channel:peerId", …]` 别名，用于跨通道身份 |
| `storage` | object | - | 可选会话存储调优（`pruneAfterMs`、`maxEntries`） |

更多说明与示例见 [Session 路由系统](/zh/routing-system)。

---

### channels

通信通道配置。

#### channels.telegram

多账户 Telegram 配置：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        }
      }
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 Telegram |
| `accounts` | object | - | 多账户配置 |
| `accounts.<id>.name` | string | - | 显示名称 |
| `accounts.<id>.botToken` | string | - | Bot token |
| `accounts.<id>.dmPolicy` | string | `open` | DM 策略 |
| `accounts.<id>.groupPolicy` | string | `open` | 群组策略 |
| `accounts.<id>.allowFrom` | array | `[]` | 允许的用户 ID |
| `accounts.<id>.streamMode` | string | `partial` | 流式模式 |

**DM 策略**: `pairing` | `allowlist` | `open` | `disabled`

**群组策略**: `open` | `allowlist` | `disabled`

**流式模式**: `off` | `partial` | `block`

#### channels.feishu

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "APP_ID",
      "appSecret": "APP_SECRET",
      "verificationToken": "VERIFICATION_TOKEN"
    }
  }
}
```

---

### gateway

HTTP API 网关配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `host` | string | `0.0.0.0` | 绑定地址 |
| `port` | number | `18790` | 端口号 |
| `auth` | object | - | 认证配置 |
| `cors` | object | - | CORS 设置 |

#### gateway.auth

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用认证 |
| `username` | string | - | 认证用户名 |
| `password` | string | - | 认证密码 |
| `api_key` | string | - | API 密钥认证 |

#### gateway.cors

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 CORS |
| `origins` | array | `[]` | 允许的来源 |
| `credentials` | boolean | `false` | 允许凭证 |

---

### tools

工具配置。

#### tools.web

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `search` | object | - | 网页搜索配置 |
| `browse` | object | - | 网页浏览配置 |

##### tools.web.search

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `provider` | string | `brave` | 搜索提供商 |
| `api_key` | string | - | API 密钥 |
| `max_results` | number | `5` | 最大结果数 |

---

### stt

语音转文字（STT）配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 STT |
| `provider` | string | `alibaba` | 提供商：`alibaba`, `openai` |
| `alibaba` | object | - | 阿里云 DashScope 配置 |
| `openai` | object | - | OpenAI Whisper 配置 |
| `fallback` | object | - | 回退配置 |

#### stt.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥 |
| `model` | string | `paraformer-v1` | 模型：`paraformer-v1`, `paraformer-8k-v1` |

#### stt.openai

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | OpenAI API 密钥 |
| `model` | string | `whisper-1` | 模型：`whisper-1` |

#### stt.fallback

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用回退 |
| `order` | array | `["alibaba", "openai"]` | 回退顺序 |

**示例：**
```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    },
    "fallback": {
      "enabled": true,
      "order": ["alibaba", "openai"]
    }
  }
}
```

---

### tts

文字转语音（TTS）配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 TTS |
| `provider` | string | `openai` | 提供商：`openai`, `alibaba` |
| `trigger` | string | `auto` | 触发：`auto`, `never` |
| `openai` | object | - | OpenAI TTS 配置 |
| `alibaba` | object | - | 阿里云 CosyVoice 配置 |

#### tts.openai

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | OpenAI API 密钥 |
| `model` | string | `tts-1` | 模型：`tts-1`, `tts-1-hd` |
| `voice` | string | `alloy` | 音色：`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer` |

#### tts.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥 |
| `model` | string | `cosyvoice-v1` | 模型：`cosyvoice-v1` |
| `voice` | string | - | 音色 ID |

**触发模式：**
- `auto`: 用户发语音时，Agent 用语音回复
- `never`: 禁用 TTS，只发送文字

---

### heartbeat

定期健康检查配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用心跳 |
| `intervalMs` | number | `300000` | 间隔毫秒数（5 分钟） |

---

### cron

定时任务配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `true` | 启用 cron |
| `jobs` | array | `[]` | 定时任务列表 |

查看 [Cron 文档](/zh/cron) 了解任务配置。

---

### extensions

扩展启用/禁用配置。

```json
{
  "extensions": {
    "enabled": ["telegram-channel", "weather-tool"],
    "disabled": ["deprecated-extension"],
    "telegram-channel": {
      "token": "bot-token-here"
    },
    "weather-tool": true
  }
}
```

| 字段 | 类型 | 说明 |
|-------|------|------|
| `enabled` | string[] | 要启用的扩展 ID 列表 |
| `disabled` | string[] | （可选）禁用的扩展 ID 列表 |
| `[extension-id]` | object/boolean | 扩展特定配置 |

查看 [扩展文档](/zh/extensions) 了解详情。

---

## 环境变量

xopcbot 支持环境变量存储敏感数据：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `GOOGLE_API_KEY` | Google AI API 密钥 |
| `GROQ_API_KEY` | Groq API 密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `MINIMAX_API_KEY` | MiniMax API 密钥 |
| `BRAVE_API_KEY` | Brave Search API 密钥 |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API 密钥（STT/TTS） |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `XOPCBOT_CONFIG` | 自定义配置文件路径 |
| `XOPCBOT_WORKSPACE` | 自定义工作区目录 |
| `XOPCBOT_LOG_LEVEL` | 日志级别（trace/debug/info/warn/error/fatal） |
| `XOPCBOT_LOG_DIR` | 日志目录路径 |
| `XOPCBOT_LOG_CONSOLE` | 启用控制台输出（true/false） |
| `XOPCBOT_LOG_FILE` | 启用文件输出（true/false） |
| `XOPCBOT_LOG_RETENTION_DAYS` | 日志文件保留天数 |
| `XOPCBOT_PRETTY_LOGS` | 开发环境美化日志输出 |

环境变量优先于配置文件中的值。

---

## 配置管理

### 验证配置

```bash
xopcbot config --validate
```

### 查看配置

```bash
xopcbot config --show
```

### 编辑配置

```bash
xopcbot config --edit
```

---

## 常见问题

### Q: 如何使用多个提供商？

使用 `providers` 配置定义多个 API 密钥。Agent 根据模型 ID 自动选择合适的提供商：

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

### Q: 如何使用 Ollama（本地模型）？

在 `~/.xopcbot/models.json` 中配置自定义提供商：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" }
      ]
    }
  }
}
```

查看 [模型文档](/zh/models) 了解详情。

### Q: 如何配置 OAuth？

xopcbot 支持某些提供商的 OAuth 认证：

**Kimi（设备码流程）：**
```json
{
  "providers": {
    "kimi": {
      "auth": {
        "type": "oauth",
        "clientId": "your-client-id"
      }
    }
  }
}
```

Kimi 使用设备码流程 - CLI 会提示访问 `auth.kimi.com` 并输入代码。

### Q: 如何使用环境变量？

在配置中使用 `${VAR_NAME}` 语法：

```json
{
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  }
}
```

或直接设置环境变量而不添加到配置中。
