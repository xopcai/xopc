# Telegram channel

## Gateway console — IM channels

When the gateway is running, the React console includes a dedicated **IM channels** screen:

- **Route:** `#/channels` (sidebar: **IM 频道** / *IM channels*).
- **Requires:** a saved **gateway token** (settings) so the UI can call authenticated APIs.
- **Supported here:** **Weixin** and **Telegram** only.

## Multi-account configuration

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

## Access control policies

**DM policies** (`dmPolicy`):

- **`pairing`** — Unknown senders are blocked from the agent until their **numeric Telegram user id** is allowed. Allow sources: `allowFrom` in config **and** paired ids in **`~/.xopc/credentials/xopc-telegram-<account>-allowFrom.json`** (override base dir with **`XOPC_CREDENTIALS_DIR`**). First DM receives a **pairing code**; the owner runs **`xopc channels pairing approve --channel telegram --account <id> <CODE>`** on the gateway host. See [DM pairing](./index.md#dm-pairing) and [CLI — channels](../cli.md#channels).
- **`allowlist`** — Same allow merge, but **no** pairing message; unknown users are dropped.
- **`open`** — All users can DM.
- **`disabled`** — DMs off.

**Group Policies** (`groupPolicy`):
- `open` - Allow all groups
- `allowlist` - Only allow specified groups
- `disabled` - Disable groups

## Streaming configuration

**Stream Modes** (`streamMode`):

| Mode | Description |
|------|-------------|
| `off` | Send complete message at once |
| `partial` | Stream AI response, show progress for tools |
| `block` | Coalesced block streaming (updates after min chars / idle window) |

## Get bot token

1. Open Telegram, search [@BotFather](https://t.me/BotFather)
2. Send `/newbot` to create a new bot
3. Follow prompts to set name and username
4. Copy the generated token

## Voice messages (STT/TTS)

See [Voice Documentation](/voice) for details.

In **Telegram supergroups/groups** where the bot requires an @mention, **voice-only** messages are transcribed *before* mention filtering so spoken bot names (and STT-friendly variants) can count as mentions.

## Reverse proxy configuration

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

## Usage limits

- **Groups and private chats only**: Channels (broadcast) not supported
- **Polling mode**: Uses long polling, ~1-2 second delay
- **Voice messages**: 60 second limit for STT (Telegram)
- **TTS text**: limited by `tts.maxTextLength` (schema default 512; configurable)

