# Feishu (Lark) channel

Feishu/Lark is configured under **`channels.feishu`**. The channel supports two transport modes:

- **`websocket`** (default): Feishu Socket Mode.
- **`webhook`**: a local HTTP server that receives Feishu events. Requires webhook secrets.

## Gateway console — IM channels

On **`#/channels`** (sidebar **IM channels**), you can onboard Feishu when the gateway is running and a **gateway token** is saved in settings.

- **Configure / Edit** opens a **QR setup** dialog that **starts immediately** for the **China (Feishu)** tenant by default.
- A **capsule control under the QR** switches **Feishu (China)** vs **Lark (international)**; switching starts a new scan for that domain.
- After a successful scan, the gateway writes **`appId`**, **`appSecret`**, and **`domain`** into `channels.feishu` (merging with existing fields such as `connectionMode`, defaulting new installs to **`websocket`**).
- Full manual fields (webhook secrets, tools, policies, multi-account JSON, …) live under **Advanced** in the same dialog and are saved with **Save**.

### Setup API (authenticated)

- `POST /api/channels/feishu/setup/start` — JSON body optional: `{ "domain": "feishu" | "lark" }` (omit or any other value → `feishu`). Returns `sessionKey` and `qrUrl`.
- `GET /api/channels/feishu/setup/:sessionKey` — poll until done; on success the server persists credentials as above.

You can still create or manage the app entirely in the Feishu / Lark console (below) if you prefer not to use QR setup.

## Create and configure a Feishu app

In Feishu Open Platform (or Lark Developer):

1. Create a **self-built app** (internal app).
2. Add a **Bot** capability to the app.
3. Copy **App ID** / **App Secret** from the app **Credentials** page.
4. Configure **Permissions (Scopes)** (see below) and request approval/publish as required by your tenant.
5. Configure **Event Subscriptions**:
   - Enable the subscription feature.
   - Subscribe to the required event types (see below).
   - For **Socket Mode**: enable the platform’s **persistent connection / WebSocket** option.
   - For **Webhook mode**: set your **Request URL** to match `webhookHost` + `webhookPort` + `webhookPath`, and copy **Verification Token** + **Encrypt Key** into `channels.feishu`.

## Permissions (scopes) — copy/paste JSON

Feishu permissions are scope-based. You can keep scopes minimal for chat-only bots, and add scopes only when you enable the corresponding xopc Feishu tools (`channels.feishu.tools.*`).

### Minimal (chat + cards + basic identity)

```json
{
  "scopes": ["im:message", "im:chat", "contact:user.base:readonly"]
}
```

### Recommended (includes doc/wiki/drive; add perm/bitable only if you need them)

```json
{
  "scopes": [
    "im:message",
    "im:chat",
    "contact:user.base:readonly",

    "docx:document",
    "docx:document:readonly",
    "docx:document.block:convert",

    "drive:drive",
    "drive:drive:readonly",

    "wiki:wiki",
    "wiki:wiki:readonly",

    "drive:permission",

    "bitable:app",
    "bitable:app:readonly",
    "bitable:table",
    "bitable:table:readonly",
    "bitable:record",
    "bitable:record:readonly"
  ]
}
```

Notes:

- If your tenant only allows requesting either read-write or read-only scopes, pick the smallest set that matches your usage.
- If you aren’t using a tool (for example `feishu_perm`), keep its scope disabled.
- After changing scopes, the app may require (re)approval in the admin console before the bot can access newly granted APIs.

## Event subscriptions (what to subscribe)

At minimum, subscribe to:

- `im.message.receive_v1` (inbound messages)
- `card.action.trigger` (interactive card button/input callbacks, used by streaming cards and UI actions)

Recommended (if you enable those features):

- `im.message.reaction.created_v1` / `im.message.reaction.deleted_v1` (reaction-driven workflows)
- `drive.notice.comment_add_v1` (drive/doc comment notices)
- `im.chat.member.bot.added_v1` / `im.chat.member.bot.deleted_v1` (bot added/removed from chats; optional)
- `application.bot.menu_v6` (bot menu actions; optional)

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

## DM pairing

When **`dmPolicy`** is **`pairing`**, private chats use the merged allow list from **`allowFrom` in config** plus **`~/.xopc/credentials/xopc-feishu-<account>-allowFrom.json`** (see [DM pairing](./index.md#dm-pairing)). Unknown users receive a **pairing code** in Feishu; approve with **`xopc channels pairing approve --channel feishu [--account <id>] <CODE>`** on the gateway host.

**Gateway console QR setup:** when scan-to-create succeeds, the scanner’s **`open_id`** is **merged into `channels.feishu.allowFrom`** in `xopc.json` (deduped) so that user can DM the bot immediately while **`dmPolicy`** stays **`pairing`** (default if unset). Others still go through pairing approval.

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

