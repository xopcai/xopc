# MCP (Model Context Protocol)

xopc supports **outbound bundle-MCP** (agent consumes external MCP tools) and an **inbound channel bridge** (`xopc mcp serve`) that exposes gateway sessions to external MCP clients over stdio.

## Configuration

Add MCP servers under `mcp.servers` in `~/.xopc/xopc.json` (or your `XOPC_CONFIG` path):

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
        }
      }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `command` + `args` | stdio MCP server launch |
| `url` + `transport` | Remote MCP via `sse` or `streamable-http` |
| `env` / `headers` | Passed to the MCP client (stdio env is filtered for host safety) |
| `sessionIdleTtlMs` | Idle eviction for per-session MCP runtimes (default 10 min; `0` = disable) |

Extension manifests may ship `.mcp.json` files; they merge with user config (user entries win on name collision).

## Disable MCP tools

Add `bundle-mcp` to `agents.defaults.tools.disable` or a per-agent `tools.disable` list to block all MCP tools for that profile.

Individual MCP tools use names `serverId__toolName` and can be disabled by full name.

## CLI

```bash
xopc mcp list
xopc mcp show [name]
xopc mcp set fetch '{"command":"npx","args":["-y","@modelcontextprotocol/server-fetch"]}'
xopc mcp unset fetch

# Inbound channel bridge (stdio MCP server → gateway REST + SSE)
xopc mcp serve --url http://127.0.0.1:18790 --token-file ~/.xopc/gateway.token
```

### `xopc mcp serve` options

| Flag | Purpose |
|------|---------|
| `--url` | Gateway base URL |
| `--token` / `--token-file` | Bearer auth |
| `--password` / `--password-file` | Password auth (when configured) |
| `--claude-channel-mode` | `auto` \| `on` \| `off` |
| `-v` | Verbose logging |

## Gateway API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/mcp/servers` | List configured + merged servers |
| `GET /api/mcp/servers/:id/tools` | Tool catalog preview |
| `POST /api/mcp/servers/:id/test` | Connect + list tools |
| `POST /api/mcp/approvals/respond` | Channel bridge approval stub |

## Web UI

Gateway Console → **Settings → MCP** (`#/settings/mcp`): CRUD for `mcp.servers`, idle TTL, connection test.

## Lifecycle

MCP runtimes are per session key. They are disposed on gateway shutdown, `mcp.*` config hot reload, session delete, agent evict, and isolated cron job completion.

## Security notes

- Stdio MCP inherits a filtered host environment (`host-env-security-policy.json`).
- Delegate sub-agents cannot use MCP tools (`bundle-mcp` blocklist).
- `before_tool_call` hooks receive `isMcpTool` / `mcpServerId` context for policy extensions.
