# How to connect Telegram

Use this when you want a Telegram bot to send messages into your xopc gateway.

## 1. Create a bot token

In Telegram, open `@BotFather`, run `/newbot`, and copy the generated token.

## 2. Write Telegram config

Merge a Telegram config block:

```bash
xopc channels config set-json telegram '{"enabled":true,"accounts":{"default":{"botToken":"YOUR_BOT_TOKEN","dmPolicy":"pairing","groupPolicy":"open","streaming":{"mode":"partial"}}}}'
```

Or edit `~/.xopc/xopc.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "YOUR_BOT_TOKEN",
          "dmPolicy": "pairing",
          "groupPolicy": "open",
          "streaming": { "mode": "partial" }
        }
      }
    }
  }
}
```

## 3. Start the gateway

```bash
xopc gateway
```

The gateway runs the channel plugin. Keep it running, or install the gateway service if you want Telegram to stay online.

## 4. Approve the first DM

With `dmPolicy: "pairing"`, the first unknown DM receives a pairing code. Approve it on the gateway host:

```bash
xopc channels pairing approve telegram <CODE> --account default
```

## 5. Check health

```bash
xopc gateway health
xopc channels show telegram
```

For access policy details, see [Telegram channel](../channels/telegram.md).
