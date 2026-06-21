# Channels

xopc can connect assistants to **Telegram**, **Weixin (WeChat)**, **Feishu (Lark)**, and the **gateway Web chat**. Other channel types may appear if you install extensions that register them.

All channel settings live under the **`channels`** object in `~/.xopc/xopc.json` (or the file pointed to by `XOPC_CONFIG`).

## Overview

| Channel | Status | Features |
|---------|--------|----------|
| **Telegram** | ✅ | Bot token or multi-account JSON, streaming, voice, documents |
| **Weixin (WeChat)** | ✅ | QR login on the gateway host, DM policies, optional per-account JSON |
| **Feishu (Lark)** | ✅ | Socket Mode / Webhook, cards, doc/wiki/drive tools (opt-in); QR app setup in gateway console |
| **Web UI** | ✅ | Gateway console chat (browser), same HTTP API as other clients |

## Pages

- [Telegram](./telegram.md)
- [Weixin (WeChat)](./weixin.md)
- [Feishu (Lark)](./feishu.md)
- [Web UI](./webui.md)

## Extensions and channels

Third-party channel types from extensions also use `channels.<id>` blocks when their README says so.

Configure **`channels.telegram`**, **`channels.weixin`**, **`channels.feishu`**, etc., as needed; the gateway loads matching plugins from config. To **block** a specific extension id, add it under **`extensions.disabled`**.

For how extension loading interacts with other CLI commands, see [Extensions — When extensions load](../extensions.md#when-extensions-load).

## DM pairing {#dm-pairing}

For **Telegram**, **Feishu**, and **Weixin**, when **`dmPolicy`** is **`pairing`**, private chats are allowed only if the sender appears in the **merged allow list**:

1. **`allowFrom`** in `xopc.json` (Telegram: `channels.telegram.accounts.<id>.allowFrom`; Feishu/Weixin: their documented channel/account allow list), plus
2. **Paired users** persisted on disk (JSON files under the credentials directory).

If the sender is not allowed, the bot sends a **one-time pairing code** and instructions to run:

```bash
xopc channels pairing approve --channel <telegram|feishu|weixin> [--account <id>] <CODE>
```

See **[CLI — channels](../cli.md#channels)**. Run the approve command on the **same machine** that holds the credential files (typically the gateway host).

### Gateway console (Web UI)

You can approve, revoke, and monitor pending requests in the gateway console without the CLI:

1. Open **Settings → Channels** (`#/settings/channels` in the hash router).
2. Configure the channel (Telegram token, Weixin QR login, or Feishu app credentials) and set **`dmPolicy`** to **`pairing`**.
3. When a user DMs the bot, pending requests appear in the channel settings dialog (Telegram) or **Advanced** section (Weixin / Feishu).
4. **Approve** with the 8-character code, or use **Quick approve** after verifying the user id matches someone who messaged the bot.
5. Hub cards show a pending badge; the list refreshes over SSE when new or repeat pairing DMs arrive.

REST endpoints (require gateway bearer token):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/channels/pairing?channel=&account=` | Pending list + paired allowFrom (config + credentials) |
| `GET` | `/api/channels/pairing/summary` | Per-channel pending / stale / at-capacity counts |
| `POST` | `/api/channels/pairing/approve` | Approve by pairing code |
| `POST` | `/api/channels/pairing/approve-sender` | Quick approve by sender id |
| `DELETE` | `/api/channels/pairing/paired` | Revoke a credential allowFrom entry |
| `DELETE` | `/api/channels/pairing/pending` | Dismiss a pending request without approving |

Summary and doctor checks only count **enabled** channels whose effective `dmPolicy` is **`pairing`** (account-level overrides included).

**Credential files** (override directory with **`XOPC_CREDENTIALS_DIR`**):

| Channel | Allowlist store | Pending requests |
|---------|-----------------|------------------|
| Telegram | `$DIR/xopc-telegram-<account>-allowFrom.json` | `$DIR/xopc-telegram-<account>-pairing.json` |
| Feishu | `$DIR/xopc-feishu-<account>-allowFrom.json` | `$DIR/xopc-feishu-<account>-pairing.json` |

Default **`$DIR`** is **`~/.xopc/credentials`**.

**Weixin** uses **`~/.xopc/weixin/credentials/`** (same `XOPC_CREDENTIALS_DIR` override if set): `xopc-weixin-<account>-allowFrom.json` and `xopc-weixin-<account>-pairing.json`.

**`allowlist`** DM policy does **not** send a pairing code; unknown senders are dropped. **`open`** allows everyone; **`disabled`** blocks DMs.

**Feishu gateway QR (scan-to-create):** the scanner’s **`open_id`** is written into **`channels.feishu.allowFrom`** automatically so they can chat immediately under default **`pairing`**.

## Gateway startup order

When you run **`xopc gateway`**, Telegram / Weixin / Feishu may **`start()`** only **after** HTTP is listening, so misconfigured API roots or slow `getMe` do not block the Web console. See [Gateway — Channel startup and HTTP listen order](../gateway.md#channel-startup-and-http-listen-order) and [Configuration — Channel connect defer](../configuration.md#channel-connect-defer).
