# Channel Configuration

xopcbot supports multiple communication channels with an extension-based architecture.

## Overview

| Channel | Status | Features |
|---------|--------|----------|
| Telegram | ✅ | Multi-account, streaming, voice, documents |
| Feishu/Lark | ✅ | Bot messages, mentions |
| Web UI | ✅ | Gateway-connected chat interface |

## Implementation note (developers)

The Telegram channel is shipped as a **pnpm workspace package** at `extensions/telegram` (`@xopcai/xopcbot-extension-telegram`). The core registers it through `src/channels/plugins/bundled.ts`. For stable imports from core code, `src/channels/telegram/index.ts` re-exports the plugin and related symbols from that package. Channels use the **`ChannelPlugin`** model (see `src/channels/plugin-types.ts`), not the legacy `telegramExtension` API.

## Telegram Channel

### Multi-Account Configuration

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN_1",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        },
        "work": {
          "name": "Work Bot",
          "botToken": "BOT_TOKEN_2",
          "dmPolicy": "disabled",
          "groupPolicy": "allowlist",
          "groups": {
            "-1001234567890": {
              "requireMention": true,
              "systemPrompt": "You are a work assistant"
            }
          }
        }
      }
    }
  }
}
```

### Access Control Policies

**DM Policies** (`dmPolicy`):
- `pairing` - Require pairing with user
- `allowlist` - Only allow specified users
- `open` - Allow all users
- `disabled` - Disable DMs

**Group Policies** (`groupPolicy`):
- `open` - Allow all groups
- `allowlist` - Only allow specified groups
- `disabled` - Disable groups

### Streaming Configuration

**Stream Modes** (`streamMode`):

| Mode | Description |
|------|-------------|
| `off` | Send complete message at once |
| `partial` | Stream AI response, show progress for tools |
| `block` | Full streaming with all updates |

### Get Bot Token

1. Open Telegram, search [@BotFather](https://t.me/BotFather)
2. Send `/newbot` to create a new bot
3. Follow prompts to set name and username
4. Copy the generated token

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable channel |
| `accounts` | object | Multi-account configuration |
| `accounts.<id>.botToken` | string | Bot Token |
| `accounts.<id>.dmPolicy` | string | DM access policy |
| `accounts.<id>.groupPolicy` | string | Group access policy |
| `accounts.<id>.allowFrom` | array | Allowed user IDs |
| `accounts.<id>.streamMode` | string | Streaming mode |
| `apiRoot` | string | Custom Telegram API endpoint |
| `debug` | boolean | Enable debug logs |

### Voice Messages (STT/TTS)

Configure voice message support:

```json
{
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
  }
}
```

See [Voice Documentation](/voice) for details.

### Reverse Proxy Configuration

For restricted network environments:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "YOUR_BOT_TOKEN",
          "apiRoot": "https://your-proxy-domain.com"
        }
      }
    }
  }
}
```

Connection is automatically verified on startup.

### Usage Limits

- **Groups and private chats only**: Channels (broadcast) not supported
- **Polling mode**: Uses long polling, ~1-2 second delay
- **Voice messages**: 60 second limit for STT
- **TTS text**: 4000 character limit

---

## Feishu/Lark Channel

### Configuration

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

### Features

- ✅ Bot messages
- ✅ @mention handling
- ✅ Rich text formatting
- ✅ File attachments

---

## Web UI Channel

The Web UI provides a browser-based chat interface.

### Start Gateway

```bash
xopcbot gateway --port 18790
```

### Access

Open `http://localhost:18790` in your browser.

### Features

- ✅ Chat via the gateway (REST; agent replies stream with **SSE** on `/api/agent`)
- ✅ Session management
- ✅ Configuration UI
- ✅ Log viewer
- ✅ Cron job management

---

## Message Format

### Inbound Message

```typescript
{
  channel: 'telegram',
  sender_id: '123456789',
  chat_id: '987654321',
  content: 'Hello, bot!',
  media?: string[],
  metadata?: Record<string, unknown>
}
```

### Outbound Message

```typescript
{
  channel: 'telegram',
  chat_id: '987654321',
  content: 'Hello, user!',
  accountId?: string
}
```

---

## Sending Messages

### Via CLI

```bash
# Send message to Telegram
xopcbot agent -m "Hello from CLI"
```

### Via Gateway API

```bash
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "chat_id": "123456789",
    "content": "Hello via API!",
    "accountId": "personal"
  }'
```

### Via Extension Hook

```typescript
api.registerHook('message_sending', async (event, ctx) => {
  // Intercept or modify message
  return { content: event.content };
});
```

---

## Best Practices

1. **Set whitelist**: Production should set `allowFrom` to restrict users
2. **Use multi-account**: Separate personal and work bots
3. **Configure stream mode**: Use `partial` for balanced UX
4. **Enable logging**: Monitor channel status via logs
5. **Error handling**: Channel failures auto-retry
6. **Resource cleanup**: Close connections on service stop

---

## Troubleshooting

### Not Receiving Messages

1. Check if token is correct
2. Confirm `enabled` is `true`
3. Check network connection
4. Verify bot status with BotFather

### @mention Not Working

1. Check bot username in group settings
2. Verify `requireMention` configuration
3. Ensure bot has group permissions

### Streaming Not Showing

1. Check `streamMode` is `partial` or `block`
2. Verify channel supports streaming (Telegram only)
3. Check logs for DraftStream errors

### Voice Messages Not Working

1. Confirm STT/TTS configuration
2. Check API keys are valid
3. Verify audio length < 60 seconds
4. Check logs for STT/TTS errors
