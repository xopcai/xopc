---
name: configure-xopc
description: Configure xopc itself through conversation — add LLM provider keys (OpenAI / Anthropic / DeepSeek / …), hook up messaging channels (Telegram), enable text-to-speech, set up web-search providers (Brave / Tavily / SearXNG / …). Use when the user asks to "set up", "configure", "add a key", "connect Telegram", "enable voice", or generally wants to change xopc's own settings.
homepage: https://xopcai.github.io/xopc/configuration
metadata:
  xopc:
    emoji: "⚙️"
    requires_tools:
      - bash
---

# Configure xopc through dialogue

You are configuring xopc itself for the user. xopc exposes its setup surface as a small set of CLI commands. Always prefer those over editing `~/.xopc/xopc.json` by hand or asking the user to do so.

## Discovery — what can be configured

Before doing anything, run:

```bash
xopc setup manifest --json
```

This returns a stable `{ version, domains: [{ domain, description, docs, storage, actions, fields, targets }] }` object. Use it to:

- Confirm which domain matches the user's intent
- Look up the exact CLI invocation in `actions[].cli`
- Look up the field schema in `fields` (especially `secret: true` flags — see Security)

## When to delegate

If the user's intent matches one of these, load the matching specialist skill instead of trying to handle it inline:

| Intent | Skill |
|---|---|
| Add / change an **LLM provider** API key (OpenAI, Anthropic, DeepSeek, Google, …) | `setup-provider` |
| Hook up a **Telegram bot** | `setup-telegram` |
| Enable / disable **text-to-speech (TTS)** | `setup-voice` |
| Add a **web search** provider (Brave / Tavily / Bing / SearXNG) | `setup-search` |

For other domains not yet covered as specialist skills (cron, heartbeat, image-models, …), fall back to `xopc config get/set` after confirming the path with the user.

## Universal contract — every setup CLI behaves the same

Every `xopc <domain> <action>` command supports:

- `--json` — emits a single line: `{ ok, action, domain, target?, changedPaths, dryRun, errors?, value?, notes? }`
- `--dry-run` — validates and computes diff, **does not write**
- Standard exit codes: `0` ok / `1` error / `2` cancelled by user

Always parse `--json` output and surface the result faithfully. If `ok: false`, the `errors[]` array tells the user why.

## Security — handling secrets

**Never write a user-supplied API key, bot token, or password into the conversation transcript.** Chat history is persisted to disk and may be replayed; secrets in the log are the worst kind of leak.

When you need a secret:

1. **Prefer omitting `--key` / `--token` and letting the CLI prompt** the user via the secure stdin password input (no echo). Tell the user: "I'll run the command; it will prompt you for the value — paste it into the prompt, not into chat."
2. **If the user has already pasted a secret into chat**, redact it from your reply and acknowledge: "I see the key. I'll pass it directly to the CLI without echoing it back." Run the command with the literal value but do not repeat the value in your output.
3. **If the secret is in an environment variable**, prefer that path: most domains auto-detect env vars (e.g. `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`) and you can simply enable the feature.

## The standard flow

For any setup change:

1. **Discover**: `xopc setup manifest --json` (cache mentally for the turn).
2. **Confirm intent**: in one short sentence, restate what you're about to change. Mention the domain and target.
3. **Dry-run first**: invoke `xopc <domain> <action> ... --dry-run --json`. Show the user `changedPaths`, `value` (masked), and `notes`. Get a confirmation when the change is non-trivial.
4. **Apply**: re-run without `--dry-run`.
5. **Verify**: for `providers` use `xopc providers list --json`; for `channels` use `xopc channels list --json`; for `voice` use `xopc voice status --json`; for `search` use `xopc search list --json`. Show the user the new state.
6. **Tell them what's next** (e.g. "Restart the gateway to pick up the new Telegram token: `xopc gateway restart`").

## Anti-patterns

- ❌ Don't edit `~/.xopc/xopc.json` directly when a setup command exists.
- ❌ Don't repeat secrets in your replies.
- ❌ Don't skip `--dry-run` for first-time changes — the diff catches typos cheaply.
- ❌ Don't assume the user knows the dot-path; talk in domain/target language ("OpenAI key", not "providers.openai.apiKey").
