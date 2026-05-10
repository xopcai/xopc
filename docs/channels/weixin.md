# Weixin (WeChat) channel

## Gateway console — IM channels

When the gateway is running, the React console includes a dedicated **IM channels** screen:

- **Route:** `#/channels` (sidebar: **IM 频道** / *IM channels*).
- **Requires:** a saved **gateway token** (settings) so the UI can call authenticated APIs.
- **Supported here:** **Weixin**, **Telegram**, **Feishu (Lark)**, and **DingTalk** (plus remove/disable flows per card).

### Weixin login

- Opens a **QR login** dialog that talks to the gateway:
  - `POST /api/channels/weixin/login/start` — begin session, returns QR payload.
  - `GET /api/channels/weixin/login/:sessionKey` — poll until login completes; credentials are written on the **gateway host**.
- After login, settings reload from `GET /api/config`. Optional **advanced** fields (`dmPolicy`, `streamMode`, allowlists, per-account JSON) are edited in the same dialog and saved with **Save**.
- You can also sign in from the host CLI, e.g. `pnpm run dev -- channels login --channel weixin`.

## Minimal shape

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

- **`dmPolicy`**: `pairing` | `allowlist` | `open` | `disabled`. With **`pairing`**, unknown senders get a **pairing code** in DM; approve with **`xopc channels pairing approve --channel weixin [--account <id>] <CODE>`** on the host that stores credentials (see [DM pairing](./index.md#dm-pairing)).
- **`allowFrom`**: ids allowed from config alone. **Paired** users are also stored under **`~/.xopc/weixin/credentials/xopc-weixin-<account>-allowFrom.json`** (merged at runtime; same basename with `-pairing.json` holds pending codes).
- **`accounts`**: optional per-account overrides (name, `cdnBaseUrl`, `routeTag`, policies, and more).

Restart or reload the gateway after changing credentials if your deployment requires it.

