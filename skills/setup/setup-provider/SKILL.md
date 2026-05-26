---
name: setup-provider
description: Add or update an LLM provider API key (OpenAI, Anthropic, DeepSeek, Google Gemini, Groq, Mistral, xAI, OpenRouter, etc.) for xopc. Use when the user wants to "add OpenAI key", "configure Anthropic", "use DeepSeek", "set up an LLM provider", or pastes an API key.
homepage: https://xopcai.github.io/xopc/models
metadata:
  xopc:
    emoji: "🔑"
    requires_tools:
      - bash
---

# Set up an LLM provider key

This skill wires an API key into xopc's auth-profile store so models from that provider become usable. Reads `configure-xopc` for shared rules — especially **Security: handling secrets**.

## When to load this skill

Triggers:

- "Add OpenAI / Anthropic / DeepSeek / … key"
- "I have an API key for X"
- "How do I use Gemini / Claude / GPT-4 / …"
- "Switch the default model to <provider>"
- User pastes a string starting with `sk-`, `sk-ant-`, `gsk_`, `tvly_`, …

## Step 1 — find the provider id

If unsure which CLI provider id matches the user's request:

```bash
xopc providers list --json
```

The response includes every known provider with id, display name, env var, category, and current status (`configured` / `env-only` / `oauth` / `not-configured`). Common ids: `openai`, `anthropic`, `deepseek`, `google`, `groq`, `mistral`, `xai`, `openrouter`.

## Step 2 — pick the safest input path

In order of preference:

### A. Env var already set

If `xopc providers list --json` shows the provider as `env-only`, the key is already detectable. Often the user just needs to be told it works — no action required. Confirm:

```bash
xopc providers list --json | jq '.providers[] | select(.id == "<id>")'
```

### B. Interactive prompt (recommended path when the user mentions a key)

Do **not** ask the user to paste the key into chat. Instead, run:

```bash
xopc providers set-key <id> --json
```

…with `--key` **omitted**. The CLI will prompt with `mask: '*'`, the value never lands in chat history. Tell the user: "Run this in your terminal — it will prompt for the key without echoing it."

### C. Direct flag (only when the user has already pasted the value or it's already on the CLI invocation)

```bash
xopc providers set-key <id> --key '<value>' --dry-run --json
```

Use `--dry-run` first to confirm the change. Then re-run without it. **Do not echo the key back in your reply** — refer to it as "the key you provided" or use the masked form from the JSON outcome (`value.key`).

## Step 3 — verify

```bash
xopc providers list --json | jq '.providers[] | select(.id == "<id>")'
```

Status should now be `configured`. If the user wanted this provider as the default for chat, follow up with `xopc onboard --model` or `xopc config set agents.defaults.model "<id>/<model-name>"` — but only if they asked for it.

## Multi-profile (optional)

If the user manages several keys per provider (e.g. work / personal):

```bash
xopc providers set-key openai --profile work --json
```

The default profile id is `<provider>:default`. List all with `xopc providers list --json`.

## Errors and recovery

| Error message | What it means | Fix |
|---|---|---|
| `Provider "X" does not support API keys` | OAuth-only provider (e.g. `github-copilot`) | Use `xopc auth login <provider>` instead |
| `Cancelled by user` | User pressed Ctrl+C at the password prompt | Confirm intent and re-run |
| Schema validation error | Unexpected — the auth store usually accepts any string | Show the JSON `errors[]` to the user |

## Anti-patterns

- ❌ Don't ask the user to paste the key in chat ("please send me your key" is wrong).
- ❌ Don't echo the key back, even partially, in your reply text. The `--json` outcome already masks it (`xxxx…xxxx`); use that.
- ❌ Don't `xopc auth set <provider> <key>` — that command echoes the key as a CLI arg. Prefer `xopc providers set-key`.
