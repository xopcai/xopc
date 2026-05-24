# Terminal UI (`xopc tui`)

The **`tui`** command opens a full-screen terminal chat interface powered by [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui). It streams assistant output, tool calls, and thinking blocks similarly to the gateway Web UI, but entirely in the terminal.

For CLI flags and one-liners, see also [CLI Reference — tui](./cli.md#tui).

---

## When to use which mode

| Mode | Flag | Needs gateway? | Best for |
|------|------|------------------|----------|
| **Gateway** | _(default)_ | Yes — a running `xopc gateway` | Shared sessions with the Web UI, remote host, listing sessions/models via REST |
| **Embedded** | `--local` | No | Quick local chat using the same config and workspace as the CLI agent; no HTTP |

---

## Gateway mode (default)

1. Start the gateway (see [Gateway](./gateway.md)).
2. Point the TUI at its base URL and token if your gateway requires auth:

```bash
xopc tui
xopc tui --url http://localhost:18790 --token <your-gateway-token>
```

The CLI’s built-in default base URL is `http://localhost:3120`. If your `gateway.port` in config is different (the project default is often **18790**), pass **`--url`** explicitly.

Obtain or rotate a token with:

```bash
xopc gateway token
```

---

## Embedded mode (`--local`)

Runs **`AgentService` in-process** (same stack as the non-TUI agent): loads `xopc.json`, workspace, and default model. No gateway process is required.

```bash
xopc tui --local
```

**Limitations in embedded mode:**

- Session list and model list APIs are not wired; `/sessions` and `/model` (without arguments) show empty or “not available” style results, and **`/model <id>`** does not change the model (patch is not supported).
- Chat history is not loaded from disk in this iteration.
- **`/reset`** restarts the embedded agent runtime for a clean in-memory state.

For switching sessions and models from the TUI, prefer **gateway mode**.

---

## CLI options

| Option | Description |
|--------|-------------|
| `--url <url>` | Gateway base URL (no trailing path). |
| `--token <token>` | `Authorization: Bearer` token for the gateway. |
| `-s, --session <key>` | Session key (default when omitted: `cli:tui`). |
| `-m, --message <text>` | After connect, send this message once and keep the UI open. |
| `--local` | Embedded mode (no gateway). |
| `--theme <name>` | Theme: `auto`, `dark`, `light`, or a custom name from `~/.xopc/themes/`. |
| `--thinking <level>` | Thinking level override passed through to the agent (same semantics as gateway/agent). |

Examples:

```bash
xopc tui -s telegram:dm:123456
xopc tui -m "Summarize my inbox"
xopc tui --url http://192.168.1.10:18790 --token "$TOKEN"
```

---

## Keyboard and input

| Input | Action |
|-------|--------|
| **Enter** | Submit the current line (normal message or slash command). |
| **Escape** | Abort the active assistant run (if any). |
| **Ctrl+D** | Exit the TUI. |
| **Ctrl+C** | If the input buffer is non-empty: clear it. If empty: first press warns; second press within ~1s exits. |
| **Ctrl+O** | Toggle tool blocks expanded / collapsed. |
| **Ctrl+T** | Toggle thinking content in the stream display. |
| **Ctrl+Shift+P** | Session picker (search, rename, delete). |
| **Ctrl+L** | Model picker. |
| **Ctrl+P / Shift+Ctrl+P** | Cycle models (respects `/scoped-models` filter). |

Settings and customization:

| Input | Action |
|-------|--------|
| **`/settings`** | Overlay: theme, thinking display, tool expansion, double-escape action, terminal progress. |
| **`/scoped-models`** | Limit which models **Ctrl+P** cycles through. |
| **`/hotkeys`** | Show resolved shortcuts (reads `~/.xopc/keybindings.json` overrides). |
| **`/reload-keybindings`** | Reload keybindings without restarting. |
| **`XOPC_THEME`** | Env override for theme id (`auto`, `dark`, `light`, or custom). |
| **`~/.xopc/tui-settings.json`** | Persisted TUI preferences from `/settings`. |
| **`~/.xopc/keybindings.json`** | Custom `app.*` keybindings (pi-compatible names). |
| **`/compact`** | Compact session transcript (gateway API or embedded). Queues messages while running. |
| **`@path` / quoted paths** | File autocomplete when `fd` is on PATH (pi-tui). |

Lines starting with **`/`** are treated as **slash commands** (not sent to the model). The editor offers autocomplete for command names.

---

## Slash commands

| Command | Description |
|---------|-------------|
| `/help` | List commands. |
| `/model` | With args: set session model (`provider/model`). Without args: list models (**gateway mode**). |
| `/models` | Same as `/model` without args. |
| `/session <key>` | Switch session; clears the on-screen log. |
| `/sessions` | List sessions (**gateway mode**). |
| `/new`, `/reset` | Abort if needed; `/reset` also resets the session on the server (embedded: restarts local agent). |
| `/abort` | Abort the current run. |
| `/thinking` | Toggle thinking display (same effect as **Ctrl+T**). |
| `/tools` | Toggle tools expanded (same as **Ctrl+O**). |
| `/settings` | Open TUI settings overlay (theme, thinking, tools, terminal progress). |
| `/scoped-models` | Choose models for **Ctrl+P** cycling. |
| `/resume` | Open session picker (**Ctrl+Shift+P**). |
| `/hotkeys` | Show resolved keyboard shortcuts. |
| `/reload-keybindings` | Reload `~/.xopc/keybindings.json`. |
| `/status` | Show connection and activity text (**gateway mode only**). |
| `/exit`, `/quit` | Leave the TUI. |

---

## TUI extensions (Phase 4)

Extensions can contribute terminal UI when **`xopc tui --local`** starts. Register deferred callbacks from `register()`:

```typescript
import type { ExtensionApi } from 'xopc/extension-sdk';

export function register(api: ExtensionApi) {
  api.registerTui((host) => {
    host.setFooterWidget('status', ['My extension · ready']);
    host.registerSlashCommand('my-tui', 'Local TUI command', async (args) => {
      host.notify(`Args: ${args || '(none)'}`);
    });
    host.addAutocompleteProvider(async (query) => [
      { name: `tag-${query || 'all'}`, description: 'Example @ mention' },
    ]);
    host.registerToolRenderer('my_tool', (ctx) => [
      `Rendered by extension: ${ctx.toolName}`,
      ctx.resultText,
    ]);
  });
}
```

| Host API | Purpose |
|----------|---------|
| `setHeaderWidget` / `setFooterWidget` | Extra lines under the header or footer |
| `setStatus` | Short status chips in the footer stats row |
| `addAutocompleteProvider` | `@`-prefix suggestions in the editor |
| `registerToolRenderer` | Custom expanded tool output |
| `registerSlashCommand` | TUI-local `/commands` (not forwarded to the agent) |
| `notify` | System message in the chat log |
| `showOverlay` / `hideOverlay` | Full-screen pi-tui overlay |

**Notes:**

- **`--local` only** for full extension load (tools + hooks + TUI host share one registry with `AgentService`).
- **Gateway mode** still gets built-in **`@skill`** autocomplete; extension `registerTui` callbacks run only when extensions are loaded in-process.
- Types: `TuiExtensionHostContract` and related types are exported from `xopc/extension-sdk`.

Type **`@`** in the editor to autocomplete skill names from workspace / `~/.xopc/skills` / bundled skills.

---

## Logs and the terminal

While the TUI owns the screen, **JSON log lines** written by the Node logger are filtered so they do not corrupt the layout. After exit, normal stdout/stderr behavior is restored.

---

## Technical notes

- **Gateway path:** chat uses `POST /api/agent` with `Accept: text/event-stream`; the UI also keeps `GET /api/events` for broadcast-style events. Session and model helpers use the same REST surface as the Web UI (`/api/sessions`, `/api/models`, etc.).
- **Embedded path:** messages go through `AgentService.processDirectStreaming` and events are derived from the agent stream types (`token`, `thinking`, `tool_start`, `tool_end`, `error`, `result`, …).
