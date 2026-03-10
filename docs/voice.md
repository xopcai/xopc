# Voice Messages (STT/TTS)

xopcbot supports voice message processing via Telegram:
- **STT** (Speech-to-Text): Convert voice to text
- **TTS** (Text-to-Speech): Convert text to voice

---

## Overview

When a user sends a voice message via Telegram:
1. STT converts voice to text
2. Agent processes the text content
3. TTS converts reply to voice (optional)
4. Sends both text and voice reply

---

## Quick Start

Add to `~/.xopcbot/config.json`:

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

---

## STT Configuration

### Alibaba Paraformer (Recommended for Chinese)

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

**Supported Models:**
- `paraformer-v1`: Chinese/English, 16kHz+ audio
- `paraformer-8k-v1`: Phone recordings, 8kHz
- `paraformer-mtl-v1`: Multi-language support

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

**Model:**
- `whisper-1`: Supports 99+ languages

### Fallback Configuration

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

If primary provider fails, automatically tries fallback providers in order.

---

## TTS Configuration

### Trigger Modes

| Mode | Description |
|------|-------------|
| `auto` | User sends voice → Agent replies with voice |
| `never` | Disable TTS, text only |

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

**Voices:** `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

**Models:**
- `tts-1`: Standard quality, faster
- `tts-1-hd`: High definition quality

### Alibaba CosyVoice (Recommended for Chinese)

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

See Alibaba documentation for available voices.

---

## Complete Configuration Example

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

---

## Limits

| Limit | Value |
|-------|-------|
| Voice message duration | 60 seconds (STT skipped if longer) |
| TTS text length | 4000 characters |
| Supported channels | Telegram only |

---

## Environment Variables

Use environment variables instead of hardcoding API keys:

| Variable | Purpose |
|----------|---------|
| `DASHSCOPE_API_KEY` | Alibaba DashScope API Key (STT/TTS) |
| `OPENAI_API_KEY` | OpenAI API Key (STT/TTS) |

Example:
```json
{
  "stt": {
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}"
    }
  },
  "tts": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}"
    }
  }
}
```

---

## Workflow

```
User sends voice message (Telegram)
        │
        ▼
┌─────────────────────┐
│ Download voice      │
│ message audio       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ STT Processing      │
│ (Alibaba/OpenAI)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Agent processes     │
│ transcribed text    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ TTS Processing      │
│ (if trigger=auto)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Send text + voice   │
│ reply to Telegram   │
└─────────────────────┘
```

---

## Troubleshooting

### STT Fails

1. **Check API key**: Verify API key is correct and has credits
2. **Check audio length**: Must be < 60 seconds
3. **View logs**: `tail -f ~/.xopcbot/logs/xopcbot.log`
4. **Test fallback**: Ensure fallback is configured

### No Voice Reply

1. **Check TTS enabled**: Verify `tts.enabled` is `true`
2. **Check trigger mode**: Must be `auto` for voice replies
3. **Verify user sent voice**: TTS only triggers on voice messages
4. **Check text length**: Must be < 4000 characters
5. **View logs**: Check for TTS error messages

### Poor Recognition Quality

1. **Try different provider**: Switch between Alibaba and OpenAI
2. **Check audio quality**: Ensure clear audio recording
3. **Language match**: Use provider optimized for your language
   - Chinese: Alibaba Paraformer
   - Multi-language: OpenAI Whisper

---

## API Reference

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

---

## Best Practices

1. **Use fallback**: Configure fallback providers for reliability
2. **Monitor usage**: STT/TTS APIs consume credits
3. **Set length limits**: Inform users about 60-second limit
4. **Test voices**: Choose appropriate voice for your use case
5. **Environment variables**: Store API keys securely
