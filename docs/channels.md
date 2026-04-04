# Channel Configuration

xopcbot supports multiple communication channels with an extension-based architecture. The **core config schema** (`src/config/schema.ts`) defines **`channels.telegram`** and **`channels.weixin`**; unknown keys are preserved via **`.passthrough()`** so extensions can add more channel ids.

## Overview

| Channel | Status | Features |
|---------|--------|----------|
| **Telegram** | ✅ | Bot token or multi-account JSON, streaming, voice, documents |
| **Weixin (WeChat)** | ✅ | QR login on the gateway host, DM policies, optional per-account JSON |
| **Web UI** | ✅ | Gateway console chat (browser), same HTTP API as other clients |

Third-party or experimental channel types may ship as **extensions** and still persist under `channels.<id>` when valid for your build.

## Gateway console — IM channels

When the gateway is running, the React console includes a dedicated **IM channels** screen:

- **Route:** `#/channels` (sidebar: **IM 频道** / *IM channels*).
- **Requires:** a saved **gateway token** (settings) so the UI can call authenticated APIs.
- **Supported here:** **Weixin** and **Telegram** only (aligned with the first-class `channels` schema).

### Weixin

- Opens a **QR login** dialog that talks to the gateway:
  - `POST /api/channels/weixin/login/start` — begin session, returns QR payload.
  - `GET /api/channels/weixin/login/:sessionKey` — poll until login completes; credentials are written on the **gateway host** (not uploaded to a cloud).
- After login, settings reload from `GET /api/config`. Optional **advanced** fields (allowlist, `dmPolicy`, `streamMode`, per-account JSON) are edited in the same dialog and saved with **Save**.
- You can also sign in from the host CLI, e.g. `pnpm run dev -- channels login --channel weixin` (see CLI help for your install).

### Telegram

- Modal form: bot token, allowlists, enable flag, and **Advanced** (API root, proxy, policies, multi-account JSON).
- **Save** writes `PATCH /api/config` with `channels.telegram` (and preserves other config).

### Hub cards (after setup)

Once a channel is considered **configured** (e.g. Telegram: token or `accounts`; Weixin: enabled, accounts, or allowlist), the list row shows **Connected**, a **⋯** menu (**Edit configuration** / **Remove configuration**), and an **enable** switch that persists immediately via the same config patch. **Remove** resets that channel block to defaults and saves.

Configuration is stored in the **gateway config file** (default `~/.xopcbot/config.json` or `XOPCBOT_CONFIG`).

## Weixin (WeChat) channel

### Minimal shape

```json
{
  "channels": {
    "weixin": {
      "enabled": true,
      "dmPolicy": "pairing",
      "allowFrom": [],
      "streamMode": "partial",
      "historyLimit": 50,
      "textChunkLimit": 4000,
      "routeTag": "",
      "accounts": {}
    }
  }
}
```

- **`dmPolicy`**: same family as Telegram (`pairing`, `allowlist`, `open`, `disabled`).
- **`allowFrom`**: when using allowlist-style DM policy, list allowed wxid / openid strings.
- **`accounts`**: optional per-account overrides (name, `cdnBaseUrl`, `routeTag`, policies, etc.) — see schema `WeixinConfigSchema` / `WeixinAccountConfigSchema` in `src/config/schema.ts`.

Restart or reload the gateway after changing credentials if your deployment requires it.

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

## Implementation note (developers)

The Telegram channel is shipped as a **pnpm workspace package** at `extensions/telegram` (`@xopcai/xopcbot-extension-telegram`). The core registers it through `src/channels/plugins/bundled.ts`. For stable imports from core code, `src/channels/telegram/index.ts` re-exports the plugin and related symbols from that package. The Weixin channel follows the same pattern (`extensions/weixin`, private workspace package). Channels use the **`ChannelPlugin`** model (see `src/channels/plugin-types.ts`), not the legacy `telegramExtension` API.

---

## Web UI channel

The Web UI provides a browser-based chat interface served as static assets from the gateway (Vite build under `web/`, output co-located with the gateway static root).

### Start Gateway

```bash
xopcbot gateway --port 18790
```

### Access

Open `http://localhost:18790` in your browser (or your configured bind address).

### Features

- ✅ Chat via the gateway (REST; agent replies stream with **SSE** on `/api/agent`)
- ✅ Session management (`#/sessions`, sidebar task list)
- ✅ **IM channels** screen `#/channels` for Telegram + Weixin (see above)
- ✅ Other settings (models, gateway token, voice, etc.)
- ✅ Log viewer
- ✅ Cron job management

### Sidebar: filter sessions by channel

The sidebar session list can show **Web** / **Telegram** / **Weixin** sessions:

- **Web** — lists sessions whose keys are treated as web UI sessions (client-side filter after `GET /api/sessions`).
- **Telegram** / **Weixin** — `GET /api/sessions?channel=telegram` or `channel=weixin`, matching `SessionMetadata.sourceChannel`.

---

## Other channel types (extensions)

Some deployments add extra channel plugins (Feishu/Lark, Discord, etc.). Those may introduce additional `channels.<id>` blocks and runtime wiring; refer to the extension’s own README and to `src/channels/plugins/bundled.ts` / generated bundled plugins. The core UI **IM channels** page only surfaces **Telegram** and **Weixin** from the product console.

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
