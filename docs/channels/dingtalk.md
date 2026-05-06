# DingTalk channel

DingTalk is a **bundled** channel plugin (`extensions/dingtalk`). Configure it under **`channels.dingtalk`**.

The integration uses **DingTalk Stream** (`dingtalk-stream`) for inbound events and the channel outbound adapter for replies. Streaming to the client is **blocked at the channel layer** (`blockStreaming: true`); the bot still receives messages and can respond with full replies.

## Gateway console — IM channels

When the gateway is running, the React console **IM channels** screen (`#/channels`) can onboard DingTalk alongside Weixin, Telegram, and Feishu.

- **Requires:** a saved **gateway token** in settings so the UI can call authenticated APIs.
- **Configure / Edit** opens a **QR setup** dialog that starts device registration immediately. After a successful scan, the gateway merges **`clientId`** and **`clientSecret`** into `channels.dingtalk` on disk (existing keys such as policies are preserved) and reloads the in-memory config.
- Optional **Advanced** fields (DM/group policies, allowlists, `endpoint`, history limits, per-account JSON, manual Client ID / Secret) live in the same dialog and are saved with **Save**.

### Setup API (authenticated)

- `POST /api/channels/dingtalk/setup/start` — begin registration; returns `sessionKey` and `qrUrl` (scan URL).
- `GET /api/channels/dingtalk/setup/:sessionKey` — poll until the session finishes; on success the server persists credentials as above.

### CLI (on the gateway host)

You can also complete registration from the host CLI (same QR / manual flow as the adapter):

```bash
xopc channels login --channel dingtalk
```

Interactive onboarding (e.g. `xopc channels onboard`) may offer DingTalk when the channel is available.

### Optional environment variables

Used by the device-registration client (defaults are suitable for the public DingTalk API):

- `DINGTALK_REGISTRATION_BASE_URL` — override the registration API base (default `https://oapi.dingtalk.com`).
- `DINGTALK_REGISTRATION_SOURCE` — client/source tag sent with registration (default `DING_XOPC`).

## Minimal shape

```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "dingxxxxxxxx",
      "clientSecret": "xxx",

      "dmPolicy": "pairing",
      "groupPolicy": "open",
      "allowFrom": [],
      "groupAllowFrom": [],
      "requireMention": false,

      "historyLimit": 50,
      "textChunkLimit": 4000
    }
  }
}
```

| Field | Notes |
|-------|--------|
| `enabled` | Master switch for the channel block. |
| `clientId` / `clientSecret` | From DingTalk Open Platform (or QR device registration). |
| `dmPolicy` | `pairing` \| `allowlist` \| `open` \| `disabled` (CLI merge defaults new installs to `pairing`). |
| `groupPolicy` | `open` \| `allowlist` \| `disabled`. |
| `allowFrom` / `groupAllowFrom` | Strings or numeric IDs allowed when policies use allowlists. |
| `requireMention` | In groups, require `@` mention before the bot handles the message. |
| `endpoint` | Optional API override for advanced deployments. |
| `debug` | Extra logging when enabled. |

## Multi-account (`accounts`)

Use `channels.dingtalk.accounts.<id>` for per-account overrides (`clientId`, `clientSecret`, policies, limits, `endpoint`, etc.). Set `defaultAccount` when more than one account exists.

## Capabilities (high level)

- **Chats:** direct messages and groups.
- **Not supported in this channel:** native reactions/threads/media/polls as first-class channel features (`reactions: false`, `media: false`, … in the plugin metadata).

## Troubleshooting

- **QR / setup start fails:** confirm the gateway can reach DingTalk registration endpoints; check `DINGTALK_REGISTRATION_BASE_URL` if you use a proxy or custom stack.
- **Inbound silent after config change:** restart or reload the gateway so Stream subscriptions pick up new credentials.
