# Channels

Channels let people talk to an xopc Agent from another application. Configure them only after local Chat and the Gateway work.

## Available channels

| Channel | Setup | Guide |
| --- | --- | --- |
| Telegram | Bot token | [Telegram](./telegram.md) |
| Weixin (WeChat) | QR login | [Weixin](./weixin.md) |
| Feishu / Lark | QR app setup or app credentials | [Feishu](./feishu.md) |
| Web console | Gateway URL and token | [Web console](./webui.md) |

Extensions may add more channel types.

## Before you connect

1. Confirm that local Chat can reach the model.
2. Keep the Gateway running continuously.
3. Decide who may send direct messages and group messages.
4. Start with pairing or an allowlist rather than open access.
5. Decide which Agent will receive the channel's Sessions.

## Configure and check status

<!-- Screenshot placeholder: /screenshots/channels.png -->

Use the **Channels** page in the Gateway console. In a terminal:

```bash
xopc channels list
xopc channels show <channel>
xopc channels enable <channel>
xopc gateway health
```

## Direct-message access

| Policy | Behavior |
| --- | --- |
| Pairing | Unknown users receive a code that the owner must approve |
| Allowlist | Only listed users can send messages; others are ignored |
| Open | Anyone can send messages |
| Disabled | Direct messages are blocked |

Pairing is the recommended starting policy. Approve a code in the Channel settings or on the Gateway host:

```bash
xopc channels pairing approve <channel> <code> --account <account>
```

Verify the sender identity before approval. An approved channel user can send content to the configured Agent and model.

## Group access

Use an allowlist for private groups. When supported, require a mention so the bot does not respond to every message. Test in one group before adding the bot to others.

## Troubleshooting

- Local Chat fails: fix the model first.
- Channel shows unhealthy: check its credential and Gateway logs.
- Bot receives nothing: review platform event settings, group permissions, and access policy.
- Messages go to the wrong Agent: check the channel's routing or default Agent.
- Configuration changed but behavior did not: restart the Gateway.
