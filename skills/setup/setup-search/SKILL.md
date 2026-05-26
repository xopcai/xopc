---
name: setup-search
description: Add / remove a web-search provider (Brave, Tavily, Bing, or self-hosted SearXNG) so xopc's web_search tool returns API results instead of HTML scraping. Use when the user asks to "add Brave search", "set up Tavily", "use SearXNG", or "configure web search".
homepage: https://xopcai.github.io/xopc/tools
metadata:
  xopc:
    emoji: "🔎"
    requires_tools:
      - bash
---

# Set up web-search providers

This skill manages `cfg.tools.web.search.providers[]`. Reads `configure-xopc` for shared rules.

## When to load

Triggers:

- "Add Brave / Tavily / Bing search"
- "I have a SearXNG instance, hook it up"
- "Search isn't returning good results" (recommend adding an API provider)
- "Disable search provider X"

## Step 1 — show current state

```bash
xopc search list --json
```

If `providers: []`, search falls back to **HTML scraping** (DuckDuckGo, or Bing in CN region). API providers are usually faster and more reliable.

## Step 2 — pick a provider

| Provider | Auth | Free tier | Notes |
|---|---|---|---|
| **Brave** | API key | Yes (limited) | Privacy-focused. Get key: https://api.search.brave.com/ |
| **Tavily** | API key | Yes (1000 / mo) | Built for LLMs; concise results. Get key: https://app.tavily.com/ |
| **Bing** | API key | Microsoft Azure-bound | Official MS endpoint |
| **SearXNG** | URL only | Self-hosted | No key needed; needs your SearXNG instance URL |

If the user is unsure, recommend Tavily for LLM use or SearXNG for self-hosted.

## Step 3 — add the provider

### API-key providers (Brave / Tavily / Bing)

Same security ladder as `setup-provider`. Prefer interactive prompt:

```bash
xopc search add brave --json
# CLI prompts for the key without echoing
```

Or with the key already on the invocation:

```bash
xopc search add tavily --key '<value>' --dry-run --json
```

Then re-run without `--dry-run`. **Don't echo the key in your reply.**

### SearXNG (URL only, no secret)

```bash
xopc search add searxng --url http://localhost:8080 --json
```

The URL must be reachable from where the gateway runs.

## Step 4 — verify

```bash
xopc search list --json
```

The provider should appear in `providers[]` with the key masked (`xxxx…xxxx`) or the URL shown.

The change takes effect on the next web-search call — no restart needed.

## Multiple providers

Adding the same `type` twice **replaces** the prior entry (idempotent). Adding different types stacks them; `cfg.tools.web.search.providers[]` is an ordered list — the first one is tried first.

To remove:

```bash
xopc search remove brave --json
```

## Errors and recovery

| Error | Cause | Fix |
|---|---|---|
| `Unknown search type "X"` | Typo | Valid types: `brave`, `tavily`, `bing`, `searxng` |
| `--url is required for type=searxng` | Missing URL | Add `--url http://...` |
| `No "X" search provider configured` (on `remove`) | Not present | List with `xopc search list --json` first |

## Anti-patterns

- ❌ Don't ask for the key in chat. Use the interactive prompt path.
- ❌ Don't add SearXNG with a `localhost` URL if the gateway runs on a different host — won't be reachable.
- ❌ Don't try `xopc config set tools.web.search.providers …` — the array shape is fragile; the `xopc search` commands handle the mutation correctly.
