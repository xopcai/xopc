---
name: setup-telegram
description: Hook up a Telegram bot for xopc — set the bot token from BotFather, enable the channel, and tell the user how to bring it online. Use when the user asks to "add Telegram", "connect a Telegram bot", "configure my BotFather token", or pastes a token like `123456:AAH...`.
homepage: https://xopcai.github.io/xopc/channels
metadata:
  xopc:
    emoji: "✈️"
    requires_tools:
      - bash
---

# Set up a Telegram bot

This skill writes a Telegram bot account into `~/.xopc/xopc.json` (under `channels.telegram`). Reads `configure-xopc` for shared rules.

## When to load

Triggers:

- "Add a Telegram bot"
- "Connect Telegram"
- "Hook up my BotFather token"
- User pastes a string matching `\d{5,}:[A-Za-z0-9_-]{30,}` (a Telegram bot token shape)

## Prerequisite — the user must have a token

If they don't, walk them through:

1. Open Telegram, search for `@BotFather`.
2. Send `/newbot`, follow the prompts (display name, then username ending in `_bot` or `bot`).
3. BotFather replies with `Use this token to access the HTTP API: <token>`.

Don't proceed until they have a token. Don't ask them to paste it into chat — see Step 2.

## Step 1 — pick the input path

Same security ladder as `setup-provider`:

### A. Env var already set

```bash
TELEGRAM_BOT_TOKEN=… xopc channels add telegram --json
```

Or if it's already in their shell env, the CLI auto-detects it. Confirm with:

```bash
echo "${TELEGRAM_BOT_TOKEN+set}"
```

### B. Interactive prompt (recommended)

Tell the user to run this in their terminal:

```bash
xopc channels add telegram --json
```

The CLI will prompt for the token with `mask: '*'`. The value is validated against the Telegram token regex before write.

### C. Direct flag (only when the token is already on the CLI invocation)

```bash
xopc channels add telegram --token '<value>' --dry-run --json
```

Use `--dry-run` first — show `changedPaths` and the masked `value.tokenMask`. Then re-run without `--dry-run`.

**Never echo the token in your reply.** Use the masked `tokenMask` field from the JSON outcome.

## Step 2 — verify

```bash
xopc channels list --json | jq '.channels[] | select(.id == "telegram")'
```

Should show `enabled: true` with at least one account whose `configured: true`.

## Step 3 — bring the bot online

Telegram bots run inside the gateway. After a fresh add, the gateway needs to reload:

```bash
xopc gateway restart       # if running in foreground
# or
xopc gateway --background  # if not yet started
```

Then the user can DM the bot. By default xopc requires DM **pairing** before responding to strangers — tell them about that:

> The bot won't reply to random DMs by default. To pair, send any message to your bot — it'll print a pairing code. Then run:
>
> ```bash
> xopc channels pairing approve --channel telegram --account default <code>
> ```

## Multiple bots

The `--account <id>` flag adds a second bot without disturbing the first:

```bash
xopc channels add telegram --account work --json
xopc channels add telegram --account personal --json
```

`xopc channels list --json` shows both.

## Errors and recovery

| Error | Cause | Fix |
|---|---|---|
| `Token does not look like a Telegram bot token` | Pattern mismatch — typically a partial paste | Re-prompt; tokens look like `123456789:AAHxx...` (35+ chars after the colon) |
| `Cancelled by user` | Ctrl+C at the prompt | Confirm intent and re-run |
| Telegram API errors after restart | Token revoked, network blocked | Run `xopc doctor` — it pings BotFather |

## Anti-patterns

- ❌ Don't ask "please send me your bot token in chat" — guide them to use the prompt.
- ❌ Don't show the token in your reply text. Even "✓ token saved: 123456789:AAHxx..." is leaky.
- ❌ Don't manually `xopc config set channels.telegram.botToken …` — `xopc channels add` keeps both legacy and per-account fields consistent.
- ❌ Don't proceed for `feishu` or `weixin` here — those have separate flows (Feishu: app id + app secret; Weixin: QR login via `xopc channels login --channel weixin`).
