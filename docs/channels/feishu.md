# Feishu (Lark) channel

Feishu/Lark is configured under **`channels.feishu`**. The channel supports two transport modes:

- **`websocket`** (default): Feishu Socket Mode.
- **`webhook`**: a local HTTP server that receives Feishu events. Requires webhook secrets.

## Minimal (Socket Mode / websocket)

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "domain": "feishu",
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "connectionMode": "websocket",

      "dmPolicy": "open",
      "groupPolicy": "open",
      "allowFrom": [],
      "groupAllowFrom": [],
      "requireMention": false,

      "renderMode": "card",
      "reactionNotifications": "own",
      "actions": { "reactions": true },

      "streaming": false,
      "historyLimit": 50,
      "textChunkLimit": 4000,

      "tools": { "doc": true, "wiki": true, "drive": true, "perm": true, "bitable": true, "scopes": true }
    }
  }
}
```

## Webhook mode (requires `encryptKey` + `verificationToken`)

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "domain": "feishu",
      "appId": "cli_xxx",
      "appSecret": "xxx",

      "connectionMode": "webhook",
      "verificationToken": "xxx",
      "encryptKey": "xxx",
      "webhookHost": "127.0.0.1",
      "webhookPort": 3000,
      "webhookPath": "/feishu/events"
    }
  }
}
```

## Multi-account (`accounts`)

Use `channels.feishu.accounts.<id>` to override per-account settings (including `connectionMode` and webhook secrets).

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "domain": "feishu",
      "defaultAccount": "im-bot",

      "appId": "cli_shared_xxx",
      "appSecret": "shared_secret_xxx",
      "connectionMode": "websocket",

      "accounts": {
        "im-bot": { "enabled": true, "connectionMode": "websocket" },
        "webhook-bot": {
          "enabled": true,
          "connectionMode": "webhook",
          "verificationToken": "xxx",
          "encryptKey": "xxx",
          "webhookHost": "127.0.0.1",
          "webhookPort": 3001,
          "webhookPath": "/feishu/events-webhook"
        }
      }
    }
  }
}
```

## Troubleshooting

- **Error: `Feishu webhook mode requires encryptKey`**: your effective config resolved `connectionMode=webhook` for that account, but `encryptKey` is missing. Set `encryptKey` (either top-level `channels.feishu.encryptKey` or per-account `channels.feishu.accounts.<id>.encryptKey`), or switch back to `connectionMode: "websocket"`.

