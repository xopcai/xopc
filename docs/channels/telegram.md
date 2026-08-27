# Telegram

Connect a Telegram bot to use an xopc Agent in private chats and groups.

## Create the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts.
3. Copy the generated bot token.
4. Keep the token private; anyone who has it can control the bot account.

## Connect it to xopc

1. Open **Channels → Telegram** in the Gateway console.
2. Choose **Configure** and paste the bot token.
3. Keep the direct-message policy set to **Pairing**.
4. Disable groups initially, or use a group allowlist with mention required.
5. Save and wait for the health check to succeed.

Then send the bot a private Telegram message. Approve the displayed pairing code in xopc.

## Terminal setup

```bash
xopc channels enable telegram
xopc channels show telegram
xopc channels pairing approve telegram <code> --account default
```

Use `xopc channels config` if you need to edit channel JSON from the host.

## Access policies

- **Pairing** is best for a personal bot: each new sender must be approved.
- **Allowlist** silently ignores unknown senders.
- **Open** should be used only when the bot and its Agent are intentionally public.
- **Disabled** turns off that conversation type.

For groups, require a mention and restrict group IDs whenever the bot has tools or private context.

## Multiple bots

You can add separate accounts for personal and work use. Give each account its own token, access policy, and routing. Test one account completely before adding another.

## Voice and files

Telegram can pass supported documents, images, and voice messages to xopc. Voice transcription and spoken replies require separate [voice configuration](../voice.md). File and media limits still apply.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Bot is unhealthy | Token is current and the Gateway can reach Telegram |
| Private message gets no reply | Pairing is approved and local Chat works |
| Group gets no reply | Bot is in the group, group policy permits it, and mention requirements are met |
| Replies stop part way | Streaming mode, Telegram limits, and Gateway logs |

Rotate the token in BotFather immediately if it appears in logs, screenshots, or source control.
