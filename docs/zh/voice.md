# 语音功能 (STT/TTS)

xopcbot 支持语音消息处理，包括：
- **STT** (Speech-to-Text): 语音转文字
- **TTS** (Text-to-Speech): 文字转语音

## 功能概述

当用户通过 Telegram 发送语音消息时：
1. STT 将语音转换为文字
2. Agent 处理文字内容
3. TTS 将回复转换为语音（可选）
4. 同时发送文字和语音回复

## 快速开始

在 `~/.xopcbot/config.json` 中添加配置：

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "your-dashscope-api-key"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "auto",
    "openai": {
      "apiKey": "your-openai-api-key"
    }
  }
}
```

## STT 配置

### 阿里云 Paraformer (推荐中文)

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "your-dashscope-api-key",
      "model": "paraformer-v1"
    }
  }
}
```

**支持的模型：**
- `paraformer-v1`: 中英文，16kHz 以上音频
- `paraformer-8k-v1`: 电话录音，8kHz
- `paraformer-mtl-v1`: 多语言支持

### OpenAI Whisper

```json
{
  "stt": {
    "enabled": true,
    "provider": "openai",
    "openai": {
      "apiKey": "your-openai-api-key",
      "model": "whisper-1"
    }
  }
}
```

**模型：**
- `whisper-1`: 支持 99+ 语言

### Fallback 配置

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "fallback": {
      "enabled": true,
      "order": ["alibaba", "openai"]
    }
  }
}
```

## TTS 配置

### 触发模式

| 模式 | 说明 |
|------|------|
| `auto` | 用户发语音 → Agent 语音回复 |
| `never` | 禁用 TTS，只发文字 |

### OpenAI TTS

```json
{
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "auto",
    "openai": {
      "apiKey": "your-openai-api-key",
      "model": "tts-1",
      "voice": "alloy"
    }
  }
}
```

**Voice 选项：** `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

### 阿里云 CosyVoice (推荐中文)

```json
{
  "tts": {
    "enabled": true,
    "provider": "alibaba",
    "trigger": "auto",
    "alibaba": {
      "apiKey": "your-dashscope-api-key",
      "model": "cosyvoice-v1",
      "voice": "longxiaochun"
    }
  }
}
```

**Voice 选项：** 见阿里云语音合成文档

## 完整配置示例

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    },
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "whisper-1"
    },
    "fallback": {
      "enabled": true,
      "order": ["alibaba", "openai"]
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
    },
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "cosyvoice-v1",
      "voice": "longxiaochun"
    }
  }
}
```

## 限制

- 语音消息长度限制：60 秒（超过则跳过 STT）
- TTS 文本长度限制：4000 字符
- 仅支持 Telegram 频道

## 环境变量

可以使用环境变量代替配置文件中的 API key：

| 环境变量 | 用途 |
|----------|------|
| `DASHSCOPE_API_KEY` | 阿里云 DashScope API Key |
| `OPENAI_API_KEY` | OpenAI API Key |

## 故障排除

### 语音转文字失败

1. 检查 API key 是否正确
2. 查看日志：`tail -f ~/.xopcbot/logs/xopcbot.log`
3. 确认语音时长在 60 秒以内

### 没有收到语音回复

1. 确认 `tts.enabled` 为 `true`
2. 确认 `tts.trigger` 为 `auto`
3. 检查用户是否发送了语音消息（而非文字）
4. 查看日志中的 TTS 错误信息

## API 参考

### STT Config Schema

```typescript
interface STTConfig {
  enabled: boolean;
  provider: 'alibaba' | 'openai';
  alibaba?: {
    apiKey?: string;
    model?: string;
  };
  openai?: {
    apiKey?: string;
    model?: string;
  };
  fallback?: {
    enabled: boolean;
    order: ('alibaba' | 'openai')[];
  };
}
```

### TTS Config Schema

```typescript
interface TTSConfig {
  enabled: boolean;
  provider: 'openai' | 'alibaba';
  trigger: 'auto' | 'never';
  alibaba?: {
    apiKey?: string;
    model?: string;
    voice?: string;
  };
  openai?: {
    apiKey?: string;
    model?: string;
    voice?: string;
  };
}
```
