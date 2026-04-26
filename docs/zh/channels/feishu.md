# 飞书（Feishu / Lark）通道

飞书配置位于 **`channels.feishu`**。该通道支持两种传输模式：

- **`websocket`**（默认）：飞书 Socket Mode。
- **`webhook`**：本地 HTTP server 接收飞书事件（需要 webhook 密钥）。

## 最小配置（Socket Mode / websocket）

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

## Webhook 模式（需要 `encryptKey` + `verificationToken`）

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

## 多账号（`accounts`）

可用 `channels.feishu.accounts.<id>` 覆盖每个账号的设置（包括 `connectionMode` 与 webhook 密钥）。

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

## 故障排查

- **报错：`Feishu webhook mode requires encryptKey`**：该账号解析后的有效配置为 `connectionMode=webhook`，但缺少 `encryptKey`。请设置 `encryptKey`（顶层 `channels.feishu.encryptKey` 或 `channels.feishu.accounts.<id>.encryptKey`），或切回 `connectionMode: "websocket"`。

