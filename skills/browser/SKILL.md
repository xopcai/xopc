---
name: browser
description: Use browser_use for web navigation, page inspection, UI interaction, screenshots, network capture, and reusable browser pipelines. Load this skill before complex browser tasks.
metadata:
  xopc:
    requires_tools:
      - browser_use
---

# Browser Skill

## Overview

`browser_use` is XOPC’s unified browser tool. It supports four modes:

| Mode | Purpose |
|------|---------|
| `command` | Run a single browser action |
| `pipeline` | Run a multi-step YAML flow |
| `inspect` | Read current page state |
| `close` | Close the browser session |

## When to use

- Open pages, click controls, fill forms
- Capture screenshots or page content
- Run multi-step automation flows
- Extract data from pages

## Command mode

### Basic shape

```json
{
  "mode": "command",
  "command": "<action>",
  "args": { ... }
}
```

### Available commands

| Command | Description | Key arguments |
|---------|-------------|----------------|
| `open` / `navigate` | Open a URL | `url`, `wait_until` |
| `state` / `snapshot` | ARIA snapshot of the page | `selector`, `maxLength` |
| `click` | Click an element | `selector` / `text` / `role` |
| `type` / `input` | Type text | `selector` / `label`, `text`, `pressEnter` |
| `scroll` | Scroll the page | `direction`, `amount` |
| `screenshot` | Screenshot | `selector`, `full_page`, `path` |
| `back` | Go back | `waitFor` |
| `keys` / `press` | Keyboard input | `key` |
| `console` / `eval` | Run JavaScript | `javascript` |
| `images` | Collect images on the page | `selector`, `maxImages` |
| `wait` | Wait for element/time | `selector` / `text` / `ms`, `timeout_ms` |
| `dialog` | Handle dialogs | `action` (accept/dismiss) |
| `close` | Close the current page | — |

### Element targeting

Prefer, in order:

1. **ARIA role**: most stable, e.g. `"role": "button:Submit"`
2. **Visible text**, e.g. `"text": "Sign In"`
3. **CSS selector**, e.g. `"selector": "#login-btn"`

Guidelines:

- Use `inspect` or `state` first to get a snapshot
- Pick locators from ARIA info in the snapshot
- Avoid dynamic class names when possible

## Inspect mode

Before acting, understand the current page:

```json
{ "mode": "inspect" }
```

Returns: current URL, title, ARIA snapshot.

**Best practice**: after each navigation, inspect, then choose the next step.

## Pipeline mode

For multi-step, reusable flows. Uses a brocli-style YAML DSL.

### Run from file

```json
{
  "mode": "pipeline",
  "pipeline": {
    "path": "./browser-flow.yaml",
    "args": { "url": "https://example.com" }
  }
}
```

### Run inline YAML

```json
{
  "mode": "pipeline",
  "pipeline": {
    "yaml": "name: quick-check\npipeline:\n  - navigate:\n      url: https://example.com\n  - screenshot:\n      full_page: true",
    "dryRun": false
  }
}
```

### YAML layout

```yaml
name: pipeline-name
description: What this flow does
args:
  url:
    type: string
    required: true
  query:
    type: string
    default: "hello"
pipeline:
  - navigate:
      url: ${{ args.url }}
      wait_until: domcontentloaded
  - wait:
      selector: input[name="q"]
  - type:
      selector: input[name="q"]
      text: ${{ args.query }}
  - press:
      key: Enter
  - wait:
      selector: body
      timeout_ms: 10000
  - screenshot:
      path: ./artifacts/result.png
      full_page: true
  - output:
      value:
        screenshot: ./artifacts/result.png
on_error:
  - screenshot:
      path: ./artifacts/error.png
      full_page: true
```

### Authoring rules

1. One action per step
2. Use `${{ args.xxx }}` for parameters
3. Use `${{ data }}` or `${{ data | json }}` for the previous step’s result
4. Use `on_error` to collect diagnostics after failure

### Validate without running

```json
{
  "mode": "pipeline",
  "pipeline": {
    "yaml": "...",
    "dryRun": true
  }
}
```

## Recovery when something fails

1. `inspect` to see current state
2. Confirm the URL (redirects may have changed it)
3. Use the snapshot to see if the page finished loading
4. `screenshot` for visual debugging
5. `wait` for elements, then retry

## Safety

- Do not put API keys or tokens in URLs
- Do not target private IPs / localhost unless configuration allows it
- Cloud metadata endpoints are always blocked
- For destructive actions (submit forms, delete data), confirm intent with the user first
