---
name: setup-voice
description: Enable / disable / configure xopc text-to-speech (TTS) output — pick a provider (openai / alibaba / edge / minimax) and trigger mode. Use when the user asks to "turn on voice", "enable TTS", "make it speak", "use Edge voice", or wants to silence the bot.
homepage: https://xopcai.github.io/xopc/voice
metadata:
  xopc:
    emoji: "🔊"
    requires_tools:
      - bash
---

# Set up text-to-speech (TTS)

This skill toggles and configures `cfg.messages.tts`. Reads `configure-xopc` for shared rules.

## When to load

Triggers:

- "Enable voice / TTS"
- "Make it speak"
- "Turn off voice"
- "Use the Edge / OpenAI / Alibaba / Minimax voice"
- "Only speak on inbound messages" / "always speak" / "never speak"

## Concepts

| Knob | Values | Meaning |
|---|---|---|
| `enabled` | `true` / `false` | Master switch |
| `provider` | `openai` / `alibaba` / `edge` / `minimax` | TTS engine. **Edge is free and needs no API key**, the others require provider credentials |
| `trigger` | `off` / `always` / `inbound` / `tagged` | When to speak: never / every reply / only when replying to incoming voice / only when message is tagged |

## Step 1 — show current state

```bash
xopc voice status --json
```

Surface the four fields (`enabled`, `provider`, `trigger`, `maxTextLength`) plainly. Don't assume the user knows what the trigger modes mean.

## Step 2 — apply the change

### Enable with defaults

```bash
xopc voice enable --json
```

### Pick a free voice (no API key needed)

```bash
xopc voice enable --provider edge --trigger inbound --dry-run --json
```

Confirm `changedPaths`, then re-run without `--dry-run`. Edge TTS uses Microsoft Edge's built-in voices and works offline-ish (it talks to Microsoft's free endpoint).

### Pick a paid provider

The user must have a key for that provider configured first. Check:

```bash
xopc providers list --json | jq '.providers[] | select(.id == "openai")'
```

If `status: "not-configured"` (or `env-only` with no actual key), route to the `setup-provider` skill before enabling TTS with that provider.

### Disable

```bash
xopc voice disable --json
```

## Step 3 — verify

```bash
xopc voice status --json
```

The change takes effect for new messages. If the user is in an active session, suggest sending a fresh message to test.

## Trigger modes — when to recommend which

- **`always`**: speak every reply. Loud. Use for accessibility or hands-free.
- **`inbound`** (often best): only speak when the message that triggered the reply was a voice message itself. Natural for voice-to-voice conversation.
- **`tagged`**: only speak when the message is explicitly tagged (e.g. tool/inline command). Power-user mode.
- **`off`**: never speak even if `enabled: true`. Mostly for debugging.

Default (`enabled: false`, `trigger: 'always'`) means: when the user enables, they'll get spoken replies on every message unless they pick a trigger.

## Errors and recovery

| Error | Cause | Fix |
|---|---|---|
| `Unknown provider "X"` | Typo in `--provider` | List valid: `openai`, `alibaba`, `edge`, `minimax` |
| `Unknown trigger "X"` | Typo in `--trigger` | List valid: `off`, `always`, `inbound`, `tagged` |
| TTS silent at runtime | Provider key missing | Run `xopc providers list --json` and configure |

## Anti-patterns

- ❌ Don't enable TTS with a paid provider without checking the key is configured first — the user will hear nothing and have no idea why.
- ❌ Don't change `maxTextLength` or `timeoutMs` unless the user asks; defaults (512, 60s) work for all providers.
- ❌ Don't manually edit `cfg.messages.tts` via `xopc config set` — the `xopc voice` commands preserve cohabiting fields safely.
