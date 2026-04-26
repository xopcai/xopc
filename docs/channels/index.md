# Channels

xopc can connect assistants to **Telegram**, **Weixin (WeChat)**, and the **gateway Web chat**. Other channel types may appear if you install extensions that register them.

All channel settings live under the **`channels`** object in `~/.xopc/xopc.json` (or the file pointed to by `XOPC_CONFIG`).

## Overview

| Channel | Status | Features |
|---------|--------|----------|
| **Telegram** | ✅ | Bot token or multi-account JSON, streaming, voice, documents |
| **Weixin (WeChat)** | ✅ | QR login on the gateway host, DM policies, optional per-account JSON |
| **Feishu (Lark)** | ✅ | Socket Mode / Webhook, cards, doc/wiki/drive tools (opt-in) |
| **Web UI** | ✅ | Gateway console chat (browser), same HTTP API as other clients |

## Pages

- [Telegram](./telegram.md)
- [Weixin (WeChat)](./weixin.md)
- [Feishu (Lark)](./feishu.md)
- [Web UI](./webui.md)

## Extensions and channels

Third-party channel types from extensions also use `channels.<id>` blocks when their README says so.

Usually you only configure **`channels.telegram`** or **`channels.weixin`**; the matching pieces load automatically. To **block** a specific extension id, add it under **`extensions.disabled`**.

For how extension loading interacts with other CLI commands, see [Extensions — When extensions load](../extensions.md#when-extensions-load).

