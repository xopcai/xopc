# MCP (Model Context Protocol)

XOPC supports **outbound bundle-MCP**: the agent connects to external MCP servers and exposes their tools in conversation. XOPC also provides an **inbound channel bridge** (`xopc mcp serve`) that lets external MCP clients (e.g. Claude Desktop) talk to gateway sessions over stdio.

---

## Table of contents

- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Disable MCP tools](#disable-mcp-tools)
- [Gateway console (Web UI)](#gateway-console-web-ui)
- [Gateway REST API](#gateway-rest-api)
- [Inbound channel bridge](#inbound-channel-bridge)
- [Extension MCP manifests](#extension-mcp-manifests)
- [Lifecycle](#lifecycle)
- [Security notes](#security-notes)
- [Related docs](#related-docs)

---

## How it works

1. You define MCP servers under `mcp.servers` in `~/.xopc/xopc.json` (or your `XOPC_CONFIG` path).
2. On an agent turn, XOPC starts (or reuses) a **per-session MCP runtime**, connects to each server, and lists tools.
3. Tools are registered as **`serverId__toolName`** (double underscore). Example: server id `fetch` with tool `browse` → `fetch__browse`.
4. The model can call these tools like any other built-in tool. Tool descriptions come from the MCP server (with sensible fallbacks when missing).

**Transport types**

| Type | Config shape | Use case |
|------|----------------|----------|
| **stdio** | `command` + optional `args`, `cwd`, `env` | Local MCP servers launched as subprocesses (`npx`, `uvx`, custom binaries) |
| **SSE** | `url` + `transport: "sse"` | Remote MCP over Server-Sent Events |
| **Streamable HTTP** | `url` + `transport: "streamable-http"` | Remote MCP over streamable HTTP (common for hosted services) |

Extension packages may ship `.mcp.json` manifests; those servers **merge** with user config (same server id → user entry wins).

---

## Configuration

Add an `mcp` block to your config file:

```json
{
  "mcp": {
    "sessionIdleTtlMs": 600000,
    "servers": {
      "fetch": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-fetch"]
      },
      "teambition": {
        "url": "https://example.com/api/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer ${TEAMBITION_TOKEN}"
        },
        "connectionTimeoutMs": 60000
      }
    }
  }
}
```

### Top-level fields

| Field | Description |
|-------|-------------|
| `sessionIdleTtlMs` | Idle eviction for per-session MCP client runtimes. Default **10 minutes** (`600000` ms). Set **`0`** to disable idle eviction. |
| `servers` | Map of **server id** → server definition. The id becomes the tool name prefix (`id__tool`). |

### stdio server fields

| Field | Description |
|-------|-------------|
| `command` | Executable to launch (required for stdio). |
| `args` | Argument array (optional). |
| `cwd` | Working directory (optional). |
| `env` | Environment variables passed to the subprocess. Values may use `${ENV_VAR}`. Host env is **filtered** for safety (see [Security](#security-notes)). |
| `connectionTimeoutMs` | Connect / list-tools / call timeout in milliseconds (optional; default **30 s**). |

### HTTP server fields

| Field | Description |
|-------|-------------|
| `url` | MCP endpoint URL (`http://` or `https://`, required for remote). |
| `transport` | `"sse"` or `"streamable-http"`. If omitted with a `url`, defaults to streamable HTTP. |
| `headers` | HTTP headers (e.g. `Authorization`). Values may reference `${ENV_VAR}`. |
| `connectionTimeoutMs` | Same as stdio (optional). |

You cannot set both `command` and `url` on the same server entry.

### Editing configuration

Current `xopc --help` does not expose `mcp` as a root command. Edit `mcp.servers` in `xopc.json` directly, or use the gateway console when available.

### Historical server management commands

These are retained for installs or development branches that still expose the historical MCP CLI:

```bash
xopc mcp list
xopc mcp show [name]
xopc mcp set fetch '{"command":"npx","args":["-y","@modelcontextprotocol/server-fetch"]}'
xopc mcp unset fetch
```

---

## Deny MCP tools for an agent

Put MCP policy in an Agent entry or capability preset. To deny every tool from a configured server:

```json
{
  "agents": {
    "capabilityPresets": {
      "no-fetch": {
        "id": "no-fetch",
        "name": "No fetch MCP",
        "tools": {
          "mcp": { "servers": { "fetch": { "mode": "deny" } } }
        }
      }
    }
  }
}
```

Apply the plan through the Agent's `extends` list. To deny one MCP tool, put its full registered name under `tools.mcp.tools`, for example `"fetch__browse": { "mode": "deny" }`. The same policy can be set directly on an Agent entry.

Delegate sub-agents cannot use MCP tools.

---

## Gateway console (Web UI)

Open **Settings → MCP** in the gateway console (`#/settings/agent-mcp`). You need a saved gateway token (same as other settings pages).

### Runtime

- **Session idle TTL (minutes)** — maps to `mcp.sessionIdleTtlMs`. Leave empty for the default (10 minutes). `0` disables idle eviction.

### MCP servers

Each server is shown as a **collapsible card** (collapsed by default after save or page load).

| UI area | Maps to config |
|---------|----------------|
| Server type | `transport` (stdio / SSE / Streamable HTTP) |
| Server name | Key in `mcp.servers` (tool prefix) |
| Server URL | `url` (HTTP transports) |
| Headers | Key/value editor → `headers` (supports paste JSON or `Key: Value` lines) |
| Timeout (seconds) | `connectionTimeoutMs` |
| Command / args / cwd / env | stdio fields |

**Actions**

- **Test** — connects with the current form values (including unsaved edits), lists tools, and shows the tool count on the card.
- **View all** — opens a searchable dialog with tool short name, description (truncated with hover tooltip), and full `serverId__toolName`.
- **Remove** — deletes the server from the form (persist with **Save**).
- **Add server** — new card starts **expanded** for editing.

Click the card header (chevron + title) to expand or collapse. After **Save**, all cards collapse so long lists stay scannable.

Changes are written to `~/.xopc/xopc.json` via `PATCH /api/config` when you click **Save**.

---

## Gateway REST API

Requires gateway auth (Bearer token or configured password).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/mcp/servers` | GET | List configured + extension-merged servers |
| `/api/mcp/servers/:id/tools` | GET | Tool catalog for a server (uses saved config) |
| `/api/mcp/servers/:id/test` | POST | Connect with optional body override + list tools |
| `/api/mcp/approvals/respond` | POST | Channel bridge approval stub |

Config CRUD for MCP uses the general config API: `GET /api/config` and `PATCH /api/config` (see [Gateway](./gateway.md)).

### Test / tools response shape

Tool entries include:

```json
{
  "name": "fetch__browse",
  "shortName": "browse",
  "description": "Fetch a URL and return readable content"
}
```

---

## Inbound channel bridge

Expose gateway sessions to external MCP clients (stdio):

```bash
xopc mcp serve --url http://127.0.0.1:18790 --token-file ~/.xopc/gateway.token
```

| Flag | Purpose |
|------|---------|
| `--url` | Gateway base URL |
| `--token` / `--token-file` | Bearer auth |
| `--password` / `--password-file` | Password auth (when configured) |
| `--claude-channel-mode` | `auto` \| `on` \| `off` — Claude Desktop channel compatibility |
| `-v` | Verbose logging |

---

## Extension MCP manifests

Extensions can ship `.mcp.json` at the package root. At runtime, XOPC merges extension servers with `mcp.servers` from config:

- Same server **name** → user config wins.
- Different names → both appear; tools are prefixed by each server id.

Restart or hot-reload config after changing extensions or user MCP entries.

---

## Lifecycle

MCP runtimes are **scoped per session key** (conversation / agent context):

- Created on first tool materialization for that session.
- Reused until idle TTL expires or the runtime is torn down.
- Disposed on: gateway shutdown, `mcp.*` config hot reload, session delete, agent evict, isolated automation run completion.

Config changes under `mcp` trigger hot reload (see [Configuration rules](./configuration.md)).

---

## Security notes

- **stdio env** — subprocess environment is filtered using `host-env-security-policy.json`; dangerous host variables are not passed through.
- **Secrets** — prefer `${ENV_VAR}` in `headers` / `env` instead of literals in config files under version control.
- **HTTP** — only `http://` and `https://` URLs are accepted.
- **Hooks** — `before_tool_call` extensions receive `isMcpTool` and `mcpServerId` for custom policy.
- **Delegate** — sub-agent runs cannot invoke MCP tools.

---

## Related docs

- [Built-in tools](./tools.md) — tool registry overview
- [Configuration](./configuration.md) — full config schema
- [Extensions](./extensions.md) — extension MCP manifests
- [Gateway](./gateway.md) — starting the gateway and authentication
