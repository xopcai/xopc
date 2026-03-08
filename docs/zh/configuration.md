# 配置参考

xopcbot 所有配置集中在 `~/.xopcbot/config.json` 文件中。

**注意：** 自定义模型配置已移至独立的 `~/.xopcbot/models.json` 文件。请参阅 [models.md](./models.md) 了解详情。

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

### providers

配置 LLM 提供商的 API Keys（简单格式）。Key 可以是实际值或环境变量引用：

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

**注意：** 如果需要配置自定义模型（Ollama、vLLM、LM Studio 等），请使用 `models.json` 文件。详见 [models.md](./models.md)。

支持的提供商及其环境变量：

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

你也可以直接在环境中设置环境变量，而无需添加到配置文件中。

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

### stt

语音转文字（STT）配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 STT |
| `provider` | string | `alibaba` | 提供商：`alibaba`、`openai` |
| `alibaba` | object | - | 阿里云 DashScope 配置 |
| `openai` | object | - | OpenAI Whisper 配置 |
| `fallback` | object | - | 回退配置 |

#### stt.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥 |
| `model` | string | `paraformer-v1` | 模型：`paraformer-v1`、`paraformer-8k-v1`、`paraformer-mtl-v1` |

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

示例：
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

### tts

文字转语音（TTS）配置。

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `enabled` | boolean | `false` | 启用 TTS |
| `provider` | string | `openai` | 提供商：`openai`、`alibaba` |
| `trigger` | string | `auto` | 触发模式：`auto`、`never` |
| `openai` | object | - | OpenAI TTS 配置 |
| `alibaba` | object | - | 阿里云 CosyVoice 配置 |

#### tts.openai

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | OpenAI API 密钥 |
| `model` | string | `tts-1` | 模型：`tts-1`、`tts-1-hd` |
| `voice` | string | `alloy` | 音色：`alloy`、`echo`、`fable`、`onyx`、`nova`、`shimmer` |

#### tts.alibaba

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|------|
| `apiKey` | string | - | DashScope API 密钥 |
| `model` | string | `cosyvoice-v1` | 模型：`cosyvoice-v1` |
| `voice` | string | - | 音色 ID |

示例：
```json
{
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "auto",
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "tts-1",
      "voice": "alloy"
    }
  }
}
```

**触发模式：**
- `auto`：用户发语音时，Agent 用语音回复
- `never`：禁用 TTS，只发送文字

## 环境变量

xopcbot 支持环境变量来存储敏感数据：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `GOOGLE_API_KEY` | Google AI API 密钥 |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API 密钥（用于 STT/TTS） |
| `TELEGRAM_BOT_TOKEN` | Telegram 机器人令牌 |
| `WHATSAPP_BRIDGE_URL` | WhatsApp 桥接 URL |
| `XOPCBOT_MODELS_JSON` | 自定义 models.json 文件路径 |

环境变量优先于配置文件中的值。

## 自定义模型配置

自定义模型配置（Ollama、vLLM、LM Studio、OpenRouter 等）已移至独立的 `models.json` 文件。

详见 [models.md](./models.md)。

### 为什么分离？

- **不同的文件权限** - 可以对敏感 API keys 设置更严格的权限
- **更方便管理** - 自定义模型配置与主配置分离
- **热重载** - 修改模型配置时可以热重载而不影响其他设置