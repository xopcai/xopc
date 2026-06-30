# MCP CLI & API

XOPC supports **outbound bundle-MCP** (the agent calls external MCP tools) and an **inbound channel bridge** (`xopc mcp serve`) for stdio MCP clients.

For configuration, Web UI, tool naming, and lifecycle, see the main guide: [MCP](./../mcp.md).

---

## Configuration quick reference

Servers live under `mcp.servers` in `~/.xopc/xopc.json`:

```json
{
  "mcp": {
    "sessionIdleTtlMs": 600000,
    "servers": {
      "fetch": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-fetch"]
      },
      "remote": {
        "url": "https://example.com/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer ${MCP_TOKEN}"
        },
        "connectionTimeoutMs": 30000
      }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `command` + `args` | stdio MCP subprocess |
| `url` + `transport` | Remote MCP: `sse` or `streamable-http` |
| `headers` / `env` | HTTP headers or stdio env (`${ENV}` supported; stdio env is host-filtered) |
| `connectionTimeoutMs` | Connect / list / call timeout (default **30 s**) |
| `sessionIdleTtlMs` | Per-session runtime idle TTL (default **10 min**; `0` = no idle eviction) |

Extension `.mcp.json` manifests merge with user config (user wins on id collision).

---

## Disable MCP tools

Set the selected agent manifest's MCP/tool policy to deny the server or tool you do not want exposed. Individual materialized tools use names `serverId__toolName`.

---

## CLI status

Current `xopc --help` does not expose `mcp` as a root command. Manage MCP servers through `mcp.servers` in `xopc.json` and the gateway console when available. The examples below are retained only for installs or development branches that still expose the historical MCP CLI.

### Historical server management commands

```bash
xopc mcp list
xopc mcp show [name]
xopc mcp set fetch '{"command":"npx","args":["-y","@modelcontextprotocol/server-fetch"]}'
xopc mcp unset fetch
```

`xopc mcp set` accepts a JSON object for the server entry. The server id is the map key you pass to `set` / `unset`.

### Inbound channel bridge

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

## Gateway REST API

Requires gateway auth (Bearer token or configured password).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/mcp/servers` | GET | List configured + extension-merged servers |
| `/api/mcp/servers/:id/tools` | GET | Tool catalog for a server (uses saved config) |
| `/api/mcp/servers/:id/test` | POST | Connect with optional body override + list tools |
| `/api/mcp/approvals/respond` | POST | Channel bridge approval stub |

### Test / tools response shape

Tool entries include:

```json
{
  "name": "fetch__browse",
  "shortName": "browse",
  "description": "Fetch a URL and return readable content"
}
```

The Web UI uses these fields in the connection test and **View all** tools dialog.

Config CRUD for MCP uses the general config API: `GET /api/config` and `PATCH /api/config` (see [Gateway](./../gateway.md)).

---

## Web UI

Gateway Console → **Settings → MCP** (`#/settings/agent-mcp`):

- Session idle TTL
- Collapsible server cards (stdio / SSE / streamable HTTP)
- Headers key-value editor with paste support
- Connection timeout
- **Test** and searchable **View all** tools dialog

See [MCP guide](./../mcp.md#gateway-console-web-ui) for the full UI walkthrough.

---

## Security notes

- Stdio MCP uses a filtered host environment (`host-env-security-policy.json`).
- Delegate sub-agents cannot use MCP tools (`bundle-mcp` blocklist).
- `before_tool_call` hooks receive `isMcpTool` / `mcpServerId` for policy extensions.
