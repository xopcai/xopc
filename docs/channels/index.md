# Channels

xopc can connect assistants to **Telegram**, **Weixin (WeChat)**, **Feishu (Lark)**, **DingTalk**, and the **gateway Web chat**. Other channel types may appear if you install extensions that register them.

All channel settings live under the **`channels`** object in `~/.xopc/xopc.json` (or the file pointed to by `XOPC_CONFIG`).

## Overview

| Channel | Status | Features |
|---------|--------|----------|
| **Telegram** | ✅ | Bot token or multi-account JSON, streaming, voice, documents |
| **Weixin (WeChat)** | ✅ | QR login on the gateway host, DM policies, optional per-account JSON |
| **Feishu (Lark)** | ✅ | Socket Mode / Webhook, cards, doc/wiki/drive tools (opt-in); QR app setup in gateway console |
| **DingTalk** | ✅ | Stream robot, device QR registration, DM/group policies (bundled plugin) |
| **Web UI** | ✅ | Gateway console chat (browser), same HTTP API as other clients |

## Pages

- [Telegram](./telegram.md)
- [Weixin (WeChat)](./weixin.md)
- [Feishu (Lark)](./feishu.md)
- [DingTalk](./dingtalk.md)
- [Web UI](./webui.md)

## Extensions and channels

Third-party channel types from extensions also use `channels.<id>` blocks when their README says so.

Configure **`channels.telegram`**, **`channels.weixin`**, **`channels.feishu`**, **`channels.dingtalk`**, etc., as needed; the gateway loads matching plugins from config. To **block** a specific extension id, add it under **`extensions.disabled`**.

For how extension loading interacts with other CLI commands, see [Extensions — When extensions load](../extensions.md#when-extensions-load).

## DM pairing {#dm-pairing}

For **Telegram**, **Feishu**, **DingTalk**, and **Weixin**, when **`dmPolicy`** is **`pairing`**, private chats are allowed only if the sender appears in the **merged allow list**:

1. **`allowFrom`** in `xopc.json` (per-account / channel block), plus
2. **Paired users** persisted on disk (JSON files under the credentials directory).

If the sender is not allowed, the bot sends a **one-time pairing code** and instructions to run:

```bash
xopc channels pairing approve --channel <telegram|feishu|dingtalk|weixin> [--account <id>] <CODE>
```

See **[CLI — channels](./cli.md#channels)**. Run the approve command on the **same machine** that holds the credential files (typically the gateway host).

**Credential files** (override directory with **`XOPC_CREDENTIALS_DIR`**):

| Channel | Allowlist store | Pending requests |
|---------|-----------------|------------------|
| Telegram | `$DIR/xopc-telegram-<account>-allowFrom.json` | `$DIR/xopc-telegram-<account>-pairing.json` |
| Feishu | `$DIR/xopc-feishu-<account>-allowFrom.json` | `$DIR/xopc-feishu-<account>-pairing.json` |
| DingTalk | `$DIR/xopc-dingtalk-<account>-allowFrom.json` | `$DIR/xopc-dingtalk-<account>-pairing.json` |

Default **`$DIR`** is **`~/.xopc/credentials`**.

**Weixin** uses **`~/.xopc/weixin/credentials/`** (same `XOPC_CREDENTIALS_DIR` override if set): `xopc-weixin-<account>-allowFrom.json` and `xopc-weixin-<account>-pairing.json`.

**`allowlist`** DM policy does **not** send a pairing code; unknown senders are dropped. **`open`** allows everyone; **`disabled`** blocks DMs.

**Feishu gateway QR (scan-to-create):** the scanner’s **`open_id`** is written into **`channels.feishu.allowFrom`** automatically so they can chat immediately under default **`pairing`**. **DingTalk** device registration does not expose the scanner id; pre-seed **`channels.dingtalk.allowFrom`** manually or use **`pairing approve`** for the first user.

## Gateway startup order

When you run **`xopc gateway`**, Telegram / Weixin / Feishu / DingTalk may **`start()`** only **after** HTTP is listening, so misconfigured API roots or slow `getMe` do not block the Web console. See [Gateway — Channel startup and HTTP listen order](../gateway.md#channel-startup-and-http-listen-order) and [Configuration — Channel connect defer](../configuration.md#channel-connect-defer).

