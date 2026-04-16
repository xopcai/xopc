# Channel Configuration

xopc can connect assistants to **Telegram**, **Weixin (WeChat)**, and the **gateway Web chat**. Other channel types may appear if you install extensions that register them. All channel settings live under the **`channels`** object in `~/.xopc/xopc.json` (or the file pointed to by `XOPC_CONFIG`).

## Overview

| Channel | Status | Features |
|---------|--------|----------|
| **Telegram** | ✅ | Bot token or multi-account JSON, streaming, voice, documents |
| **Weixin (WeChat)** | ✅ | QR login on the gateway host, DM policies, optional per-account JSON |
| **Web UI** | ✅ | Gateway console chat (browser), same HTTP API as other clients |

Third-party channel types from extensions also use `channels.<id>` blocks when their README says so.

### Extensions and Telegram / Weixin

Usually you only configure **`channels.telegram`** or **`channels.weixin`**; the matching pieces load automatically. To **block** a specific extension id, add it under **`extensions.disabled`**. For how extension loading interacts with other CLI commands, see [Extensions — When extensions load](./extensions.md#when-extensions-load).

## Gateway console — IM channels

When the gateway is running, the React console includes a dedicated **IM channels** screen:

- **Route:** `#/channels` (sidebar: **IM 频道** / *IM channels*).
- **Requires:** a saved **gateway token** (settings) so the UI can call authenticated APIs.
- **Supported here:** **Weixin** and **Telegram** only (product UI matches the bundled plugins and the dynamic `/api/config` channel snapshot).

### Weixin

- Opens a **QR login** dialog that talks to the gateway:
  - `POST /api/channels/weixin/login/start` — begin session, returns QR payload.
  - `GET /api/channels/weixin/login/:sessionKey` — poll until login completes; credentials are written on the **gateway host** (not uploaded to a cloud).
- After login, settings reload from `GET /api/config`. Optional **advanced** fields (allowlist, `dmPolicy`, `streamMode`, per-account JSON) are edited in the same dialog and saved with **Save**.
- You can also sign in from the host CLI, e.g. `pnpm run dev -- channels login --channel weixin` (see CLI help for your install).

### Telegram

- Modal form: bot token, allowlists, enable flag, and **Advanced** (API root, proxy, policies, multi-account JSON).
- **Save** writes `PATCH /api/config` with `channels.telegram` (and preserves other config).

### CLI configuration (same config file as the gateway)

The gateway reads the same JSON as the CLI (default `~/.xopc/xopc.json`; override with `XOPC_CONFIG` or the global `--config` flag on commands). You can configure channels without the browser console:

**Telegram**

- **Interactive wizard:** `xopc onboard --channels` — prompts for bot token, DM/group policies, and allowlists, then writes `channels.telegram`.
- **Manual / env:** set `TELEGRAM_BOT_TOKEN` in the environment, or edit `channels.telegram` in the config file directly (including `accounts` for multi-bot setups).

**Weixin (WeChat ilink)**

- **QR login in the terminal:** `xopc channels login --channel weixin` — scan with WeChat; credentials are stored on **that host** (under the extension state directory; the command can also merge `channels.weixin` into the config unless `--credentials-only` is used).
- **Useful options:** `--account <id>` when re-logging an existing bot, `--timeout <ms>` (default 480000), `--credentials-only` to save token files without updating the main config JSON.
- Run `xopc channels login --help` for details.

After changing credentials or enabled flags via CLI, **restart or reload the gateway** if it is already running so the channel runtime picks up the new settings.

### Hub cards (after setup)

Once a channel is considered **configured** (e.g. Telegram: token or `accounts`; Weixin: enabled, accounts, or allowlist), the list row shows **Connected**, a **⋯** menu (**Edit configuration** / **Remove configuration**), and an **enable** switch that persists immediately via the same config patch. **Remove** resets that channel block to defaults and saves.

Configuration is stored in the **gateway config file** (default `~/.xopc/xopc.json` or `XOPC_CONFIG`).

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
- **`accounts`**: optional per-account overrides (name, `cdnBaseUrl`, `routeTag`, policies, and more — use the gateway **IM channels** form or edit JSON carefully).

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

In **Telegram supergroups/groups** where the bot requires an @mention, **voice-only** messages are transcribed *before* mention filtering so spoken bot names (and STT-friendly variants) can count as mentions; see [Voice (STT/TTS)](/voice).

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
- **Voice messages**: 60 second limit for STT (Telegram)
- **TTS text**: limited by `tts.maxTextLength` (schema default 512; configurable) with optional LLM summarization — see [Voice](/voice)

## Web UI channel

The Web UI is the gateway’s built-in browser chat (static files served together with the gateway).

### Start Gateway

```bash
xopc gateway --port 18790
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

Some extensions add more channel plugins and their own `channels.<id>` keys. Follow each extension’s README. The gateway **IM channels** screen only covers **Telegram** and **Weixin** out of the box.

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
xopc agent -m "Hello from CLI"
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
