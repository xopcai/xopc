# Terminal UI (`xopc` / `xopc tui`)

Running **`xopc`** with no command opens the same full-screen terminal chat as **`xopc tui`**. It is powered by [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui) and streams assistant output, tool calls, and thinking blocks similarly to the gateway Web UI, but entirely in the terminal.

For CLI flags and one-liners, see also [CLI Reference — tui](./cli.md#tui).

---

## When to use which mode

| Mode | Flag | Needs gateway? | Best for |
|------|------|------------------|----------|
| **Embedded** | _(default)_ | No | Quick local chat using the same config and workspace as the CLI agent; no HTTP |
| **Gateway** | `--gateway`, `--url`, `--token` | Yes — a running `xopc gateway` | Shared sessions with the Web UI, remote host, listing sessions/models via REST |

---

## Gateway mode

1. Start the gateway (see [Gateway](./gateway.md)).
2. Point the TUI at its base URL and token if your gateway requires auth:

```bash
xopc tui --url http://localhost:18790 --token <your-gateway-token>
xopc tui --gateway
```

Gateway mode uses the gateway URL from config when available; the default gateway port is **18790**. If you run the gateway on another host or port, pass **`--url`** explicitly.

Obtain or rotate a token with:

```bash
xopc gateway token
```

---

## Embedded mode (default)

Runs **`AgentService` in-process** (same stack as the non-TUI agent): loads `xopc.json`, workspace, and default model. No gateway process is required.

```bash
xopc
xopc tui
```

Fresh TUI sessions use `tui.defaultAgent` when no agent is specified. The default value is `coder` when that built-in starter agent exists. This is separate from `agents.default`, which still controls global routing and non-TUI session creation.

You can change it from the Web console on the Agents page, from the CLI, or from inside the TUI:

```bash
xopc tui --set-default-agent coder
```

Inside the TUI:

```text
/tui-default-agent coder
```

**Limitations in embedded mode:**

- Embedded mode now uses the same SQLite-backed session store as the agent/gateway path for history, session list, model list, session config patching, compaction, import/export, fork, transcript tree labels, and share helpers.
- Some gateway-only operational status still comes from the gateway broadcast stream and is not available when running in-process.
- **`/reset`** and **`/new`** reset the session transcript (archive + new `sessionId`) while keeping the same session key and persisted overrides. Embedded mode uses the in-process reset path; gateway mode calls `POST /api/sessions/:key/reset`.

---

## CLI options

| Option | Description |
|--------|-------------|
| `--url <url>` | Gateway base URL (no trailing path). |
| `--token <token>` | `Authorization: Bearer` token for the gateway. |
| `-s, --session <key>` | Session key to resume. Omitted: start a fresh `agent:{currentAgent}:tui-<uuid>` session and print a resume command on exit. Shorthand `mytopic` → `agent:{currentAgent}:mytopic`. |
| `--agent <id>` | Agent id for a fresh TUI session. Overrides `tui.defaultAgent` for this launch only. |
| `--set-default-agent <id>` | Persist `tui.defaultAgent` and exit. The target agent must exist and be enabled. |
| `-m, --message <text>` | After connect, send this message once and keep the UI open. |
| `--local` | Explicit embedded mode (same as the default). |
| `--gateway` | Force gateway mode. |
| `--theme <name>` | Theme: `auto`, `dark`, `light`, or a custom name from `~/.xopc/themes/`. |
| `--thinking <level>` | Thinking level override passed through to the agent (same semantics as gateway/agent). |

Note: if `--local` and gateway flags (`--gateway`, `--url`, `--token`) are both passed, `--local` wins.

Examples:

```bash
xopc tui -s agent:main:telegram:default:direct:123456
xopc tui -s mytopic
xopc tui --agent coder
xopc tui --set-default-agent coder
xopc tui -m "Summarize my inbox"
xopc tui --url http://192.168.1.10:18790 --token "$TOKEN"
```

On exit, TUI prints a command like:

```bash
To resume this session: xopc tui --session agent:main:tui-019eddd8-d108-7554-b971-33366f99dd27
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

Local shell:

| Input | Action |
|-------|--------|
| **`!cmd`** | Run a local shell command after an in-session confirmation prompt, stream output in the TUI, persist the execution in the transcript, and include the captured output in later LLM context. |
| **`!!cmd`** | Run a full-screen local command with inherited stdio, persist an audit row, and exclude it from LLM context. |

Both forms run on the machine where the TUI process is running, not necessarily on the gateway host.

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

`/help` prints the live command list, including skill, workflow, and extension commands contributed at runtime.

### Agent, Model, And Session

| Command | Description |
|---------|-------------|
| `/agent` | Show the current agent id and session key. |
| `/agent <id>` | Switch this TUI session to another enabled agent by rewriting the key to `agent:<id>:<current-session-suffix>`. It does **not** migrate transcript rows and cannot run while an assistant response is active. |
| `/agents` | Open the agent picker when overlays are available; otherwise list configured agents. |
| `/tui-default-agent <id>` | Persist the default agent for new TUI sessions. The current session is unchanged. |
| `/model [search]` | Open the model picker, optionally filtered by search text. |
| `/models` | List available models. |
| `/switch <provider/model>` | Switch the current session model. Use `/models` to copy a valid model ref. |
| `/scoped-models` | Choose which models **Ctrl+P / Shift+Ctrl+P** cycles through. |
| `/session` or `/status` | Show current session, agent, model, activity, and stats. |
| `/usage` | Show token usage statistics for the current session. |
| `/list` | List sessions. |
| `/resume` or `/sessions` | Open the session picker (**Ctrl+Shift+P**). |
| `/tree` | Open transcript/session tree when available; otherwise print a grouped session tree. |
| `/name [name]` | Show or set the current session display name. |
| `/new` | Start a new isolated `tui-<uuid>` session. |
| `/fork [message-id]` | Fork from a user message or current transcript into a new session. |
| `/clone [name]` | Duplicate the current session transcript into a new session. |
| `/reset` or `/restart` | Abort if needed, reset the current session transcript, and reload history. |
| `/clear` | Clear only the visible TUI log; the stored transcript is not reset. |

### Runtime Controls

| Command | Description |
|---------|-------------|
| `/abort`, `/stop`, `/cancel` | Abort the active run. |
| `/recover` | Reload history and reattach to a stalled stream when recovery is available. |
| `/retry` | Abort if needed and resend the last user message. |
| `/thinking` | Toggle thinking display (same effect as **Ctrl+T**). |
| `/think [off\|low\|medium\|high]` | Show or set thinking level; without args opens the selector when available. |
| `/reasoning [off\|on\|stream]` | Show or set reasoning visibility. |
| `/verbose [off\|summary\|debug]` | Cycle or set verbose output level. |
| `/tools` | Toggle tools expanded (same as **Ctrl+O**). |
| `/compact [reason]` | Compact session history. Messages queue while compaction is running. |
| `/copy` | Copy the last assistant message to the clipboard when clipboard support is available. |
| `/btw <question>` or `/aside <question>` | Ask a side question using the current session as read-only background; the answer is not saved to the session. |
| `/exit` or `/quit` | Leave the TUI. |

### Configuration And Diagnostics

| Command | Description |
|---------|-------------|
| `/settings` | Open TUI settings overlay: theme, thinking display, tool expansion, double-escape action, terminal progress. |
| `/hotkeys` or `/keys` | Show resolved keyboard shortcuts, including `~/.xopc/keybindings.json` overrides. |
| `/reload` | Reload keybindings, TUI settings, theme, and extension UI. |
| `/reload-keybindings` | Reload `~/.xopc/keybindings.json`. |
| `/config` | Show current TUI/session configuration. |
| `/context` | Show context budget and usage. |
| `/trust` | Open project trust options or print trust/security policy details. |
| `/login [provider]` | Run supported OAuth provider login from the TUI. API-key providers still use `xopc auth set` or `xopc providers set-key`. |
| `/logout [provider]` | Without args: list stored auth profiles. With a provider: remove stored profiles for that provider. Env/config credentials are unchanged. |
| `/debug` | Write a TUI debug snapshot to disk. |
| `/changelog` | Show version history. |
| `/start` | Show the startup/welcome message again. |

### Files, Workflows, And Extensions

| Command | Description |
|---------|-------------|
| `/export [path|format]` | Export the current session as Markdown, HTML, or JSON. |
| `/import <path>` | Import an xopc JSON session export. |
| `/share <workspace-path> [friend\|colleague\|public] [--site\|--zip\|--file]` | Create a share link for a workspace file, folder, or site. |
| `/workflow list` | List configured workflow definitions. |
| `/workflow view <name>` | Show workflow details. |
| `/workflow:<name> [goal]` | Start a workflow run directly. Unknown `/name` commands that match a workflow may be rewritten into a workflow run. |
| `/skill:<name> ...` | Skill-provided commands are forwarded to the agent. |
| Extension commands | Extensions can register local TUI slash commands; they appear under `/help` and are handled inside the TUI. |

---

## TUI extensions

Extensions can contribute terminal UI when **`xopc tui`** starts. Register deferred callbacks from `register()`:

```typescript
import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';

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

- Full extension loading is available in embedded mode (the default `xopc` / `xopc tui` path), where tools, hooks, and the TUI host share one registry with `AgentService`.
- Project trust follows the pi-style trust store at `~/.xopc/trust.json`. Project-local `.xopc/` resources and `.agents/skills` trigger a `/trust` prompt; extension TUI contexts can read the current decision through `isProjectTrusted()`.
- **Gateway mode** still gets built-in **`@skill`** autocomplete; extension `registerTui` callbacks run only when extensions are loaded in-process.
- Types: `TuiExtensionHostContract` and related types are exported from `@xopcai/xopc/extension-sdk`.

Type **`@`** in the editor to autocomplete skill names from workspace / `~/.xopc/skills` / bundled skills.

---

## Logs and the terminal

While the TUI owns the screen, **JSON log lines** written by the Node logger are filtered so they do not corrupt the layout. After exit, normal stdout/stderr behavior is restored.

---

## Technical notes

- **Gateway path:** chat uses `POST /api/agent` with `Accept: text/event-stream`; the UI also keeps `GET /api/events` for broadcast-style events. Session and model helpers use the same REST surface as the Web UI (`/api/sessions`, `/api/models`, etc.).
- **Embedded path:** messages go through `AgentService.processDirectStreaming` and events are derived from the agent stream types (`token`, `thinking`, `tool_start`, `tool_end`, `error`, `result`, …).
