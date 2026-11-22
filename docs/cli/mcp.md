# MCP commands and configuration

xopc uses pi's native MCP extension when connecting to external MCP servers. The Gateway can also serve xopc capabilities to an external client. These connections have separate configuration and credentials. [Web and mobile setup](../mcp.md)

## Connect an external MCP server

Configure `mcp.servers` in `xopc.json` or add a custom connection in Capability Center. Enabled Agent Plugin MCP components enter the same registry.

```json
{
  "mcp": {
    "servers": {
      "docs": {
        "type": "http",
        "url": "https://example.com/mcp",
        "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
        "exposure": "deferred",
        "description": "Search product documentation"
      }
    }
  }
}
```

Use `type: "stdio"` for a command, `"http"` or `"streamable-http"` for Streamable HTTP, and `"sse"` for legacy SSE. `localhost` refers to the Gateway host. Set `network: "private"` for a custom private address when needed. Server IDs use letters, digits, underscores, or hyphens. IDs such as `a-b` and `a_b` collide after normalization.

Connection settings include `command`, `args`, `env`, `cwd`, `url`, `headers`, `oauth`, `auth.provider`, `timeout`, `enabled`, `description`, `exposure`, and `toolExposure`. The default timeout is 60 seconds. MCP progress notifications reset it. pi resolves environment variables and supported command expressions.

| Exposure | How the Agent can use the tool |
| --- | --- |
| `codemode` (default) | Discover and call it from a script |
| `deferred` | Load it through `tool_search` for direct calls |
| `direct` | Call it directly or from a script |
| `hidden` | The tool is unavailable to the Agent |

Tool names use `mcp__<server>__<tool>`. Set `toolExposure` by original tool name or a wildcard pattern. MCP scripts read structured data from the response's `.structuredContent`. Use `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` to access MCP resources.

### OAuth and diagnostics

Run these on the Gateway host:

```sh
xopc mcp list --json
xopc mcp login docs
xopc mcp logout docs
```

For a pre-registered OAuth client, set `oauth.clientId` and, where required, `oauth.callbackPort`. An HTTP service that responds with 401 and has no explicit Authorization header can initiate pi's OAuth flow. Web setup can use browser sign-in and, where supported, accept the full callback URL for a remote Gateway. A supported connection set up from a conversation can resume the original request after authorization. Enter credentials in the connection form.

pi stores credentials in `mcp-auth.json` and diagnostics in `mcp.log` under its state directory, normally `~/.xopc/pi`. `XOPC_STATE_DIR` changes the base directory, and `PI_CODING_AGENT_DIR` can override pi's directory. xopc's generated `mcp.json` may contain resolved secrets. Edit the xopc configuration to change servers.

### Migrate an older configuration

Use `type`, `cwd`, `timeout` in seconds, and the `oauth` object in place of old transport, working-directory, timeout, and OAuth keys. Replace `mcp:<server>:<tool>` policy aliases with native names. Reauthorize servers with old OAuth credentials. For a legacy SSE server, set `type: "sse"` and use its actual SSE URL.

## Let an external client use Gateway tools

Manage local and remote Gateway MCP connections either from the CLI below or in the Gateway Console under **Settings → Gateway → MCP Server** (`#/settings/gateway?tab=mcp-server`), which also generates ready-to-copy client snippets and displays recent call audit logs.

### Local stdio

With the Gateway listening on loopback on the same host, issue a read-only grant, choose a capability toolset (`core-read`, `memory-read`, `workspace-write`, `delegation`, `automations`, `full-read`, `full-write`), or restrict access to specific projects or exact capability IDs.

```sh
xopc mcp toolsets
xopc mcp grant --name "Cursor" --toolset core-read
xopc mcp grant --name "Project Agent" --toolset workspace-write --project <project-id> --expires-in 30
xopc mcp grant --allow-capability xopc.notes.list xopc.notes.get
xopc mcp list-grants
```

The response includes a `connectionId` and a token shown only when the grant is created. Provide the token via `XOPC_MCP_TOKEN` to the stdio process. For example, in Codex `config.toml`:

```toml
[mcp_servers.xopc]
command = "xopc"
args = ["mcp", "serve", "--stdio"]
env_vars = ["XOPC_MCP_TOKEN"]
```

Use an absolute command path if xopc is outside the client's PATH. If the Gateway starts with a port override, add `"--port", "<port>"` to the arguments. Revoke the grant with `xopc mcp revoke <connectionId>`.

### Remote Streamable HTTP

Configure `gateway.mcp` to enable `/mcp` and OAuth discovery metadata (`/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`). Two authentication modes are supported:

#### Option A: Built-in OAuth 2.1 + Dynamic Client Registration (Recommended, zero external IdP)

```json
{
  "gateway": {
    "mcp": {
      "mode": "builtin",
      "resource": "https://gateway.example.com/mcp",
      "allowedOrigins": ["https://claude.ai", "http://localhost:6274"],
      "rateLimitMax": 120
    }
  }
}
```

In `builtin` mode, xopc serves `/.well-known/oauth-authorization-server` and `/mcp/oauth/{register,authorize,token,jwks,revoke}` with mandatory PKCE S256, RFC 8707 resource binding, rotating refresh tokens, and an owner-authenticated browser consent page where you can pick a toolset and optional project scope.

#### Option B: External OAuth Authorization Server

```json
{
  "gateway": {
    "mcp": {
      "mode": "external",
      "resource": "https://gateway.example.com/mcp",
      "issuer": "https://login.example.com/",
      "jwksUrl": "https://login.example.com/.well-known/jwks.json",
      "allowedOrigins": ["https://claude.ai"],
      "acceptedTokenTypes": ["at+jwt", "JWT"],
      "clientIdClaims": ["client_id", "azp"],
      "requireJti": false
    }
  }
}
```

- Use HTTPS for remote access. Keep the canonical host, Authorization and MCP headers (`MCP-Protocol-Version`, `Mcp-Session-Id`), and `WWW-Authenticate` through the proxy. Configure `gateway.trustedProxies` for HTTP forwarding from a proxy on another host.
- By default, external mode requires strict RFC 9068 access tokens (`typ: "at+jwt"`, `client_id`, `jti`, `mcp.read` scope, plus `mcp.write` for writes). For mainstream IdPs that emit `typ: "JWT"`, `azp`, or opaque tokens, configure `acceptedTokenTypes`, `clientIdClaims`, `requireJti`, or `introspectionUrl`.
- On the Gateway host, grant the OAuth subject and client ID access (optionally with `--toolset`, `--project`, `--expires-in`, or `--max-concurrent-runs`):

```sh
xopc mcp remote grant --subject '<oauth-sub>' --client-id '<registered-client-id>' --toolset core-read
xopc mcp remote list
xopc mcp remote revoke '<connection-id>'
```

For Codex, add the remote server and sign in with the scope that matches your grant:

```sh
codex mcp add xopc-remote --url https://gateway.example.com/mcp
codex mcp login xopc-remote --scopes mcp.read
```

A read/write grant uses `--scopes mcp.read,mcp.write`.

### Gateway capabilities, resources, prompts, tasks, and delegation

Read access covers projects, tasks, notes, workspace files (`xopc_files_spaces/list/search/get`), automation history & simulation, and (when granted) non-sensitive user context & knowledge memory (`xopc_user_context_profile`, `xopc_knowledge_list/search`). Both stdio and remote `/mcp` also expose:

- **MCP Resources & Templates**: `xopc://workspace/overview`, `xopc://user/context`, `xopc://agents/directory`, `xopc://files/spaces`, `xopc://projects/{id}`, `xopc://notes/{id}`, `xopc://tasks/{id}`, `xopc://files/{id}`, and `xopc://runs/{runId}/result` (strictly gated by the connection's granted capabilities and project scope).
- **MCP Prompts**: `xopc_workspace_briefing`, `xopc_delegate_specialist`, `xopc_capture_meeting_notes`, and `xopc_project_status_report`.
- **MCP Tasks Protocol**: `tasks/list`, `tasks/get`, `tasks/result`, and `tasks/cancel` mapped directly onto delegated runs owned by the connection.

A grant can restrict permitted operation IDs with `--allow-capability` or restrict data to specific projects with `--project`. Tool names use underscores (`xopc_notes_get`); grant IDs use dots (`xopc.notes.get`). If a write returns an unknown outcome, retry with the same parameters and `idempotencyKey`.

1. Call `xopc_agent_runs_agents` to inspect available Agents along with their descriptions, purposes, specialties, and skills. Start work with `xopc_agent_runs_start`, a title, prompt, and stable `idempotencyKey`. Optionally pass an Agent, project, or up to eight project, task, note, or workspace file references.
2. Recover or monitor delegated runs with `xopc_agent_runs_list`, `xopc_agent_runs_get`, `xopc_agent_runs_events`, or standard MCP `tasks/*` methods. Use `xopc_agent_runs_steer` to send updated instructions or `xopc_agent_runs_cancel` to cancel.
3. When a run requests clarification, respond through `xopc_agent_runs_respond` using its clarification ID and expected version. Complete approvals and device confirmations in the Gateway's own interface.
4. Use `xopc_agent_runs_result` to inspect the final reply and published artifacts. Paginate text and artifacts independently. Retrieve readable files with `xopc_agent_runs_artifact_read` or `xopc_files_get`. Access a delegated run through the grant that created it.

For callbacks, configure either a per-connection callback on the grant or a Gateway-wide `gateway.mcpCallback.url` and `gateway.mcpCallback.secretEnv`, then pass `callback: true` when starting a run. Verify `X-Xopc-Signature` as HMAC-SHA256 over `<X-Xopc-Timestamp>.<raw request body>`; the header format is `sha256=<hex>`. Deduplicate by `X-Xopc-Event-Id` and acknowledge with HTTP 2xx.

[中文配置与完整调用示例](../zh/cli/mcp.md) · [pi MCP reference](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md)
