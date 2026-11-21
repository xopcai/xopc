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

### Local stdio

With the Gateway listening on loopback on the same host, issue a read-only grant or grant selected operations. For read/write access, add `--write`.

```sh
xopc mcp grant
xopc mcp grant --allow-capability xopc.notes.list xopc.notes.get
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

Configure `gateway.mcp` to enable `/mcp` and its OAuth protected-resource metadata. The external authorization server handles authentication, access tokens, and renewal.

```json
{
  "gateway": {
    "mcp": {
      "resource": "https://gateway.example.com/mcp",
      "issuer": "https://login.example.com/",
      "jwksUrl": "https://login.example.com/.well-known/jwks.json"
    }
  }
}
```

- Use HTTPS for remote access. Keep the canonical host, Authorization and MCP headers, and `WWW-Authenticate` through the proxy. Configure `gateway.trustedProxies` for HTTP forwarding from a proxy on another host.
- Register the OAuth client and its actual callback with the issuer. Use authorization code flow with PKCE S256. The issuer must provide RFC 9068 access tokens with the configured issuer, the full Gateway resource URL in the audience, and `mcp.read` scope. Write calls also require `mcp.write` and a Gateway grant with `--write`.
- On the Gateway host, grant the OAuth subject and client ID access. Existing grants retain the tool list they were issued with.

```sh
xopc mcp remote grant --subject '<oauth-sub>' --client-id '<registered-client-id>'
xopc mcp remote list
xopc mcp remote revoke '<connection-id>'
```

For Codex, add the remote server and sign in with the scope that matches your grant:

```sh
codex mcp add xopc-remote --url https://gateway.example.com/mcp --oauth-client-id '<registered-client-id>'
codex mcp login xopc-remote --scopes mcp.read
```

A read/write grant uses `--scopes mcp.read,mcp.write`.

### Gateway capabilities and delegation

Read access covers the personal workspace, including projects, tasks, notes, and automation history. A grant can restrict permitted operation IDs with `--allow-capability`. Tool names use underscores, such as `xopc_notes_get`. Grant IDs use dots, such as `xopc.notes.get`. If a write returns an unknown outcome, retry with the same parameters and `idempotencyKey`.

1. Call `xopc_agent_runs_agents` to list the available Agents. Start work with `xopc_agent_runs_start`, a title, prompt, and stable `idempotencyKey`. Optionally pass an Agent, project, or up to eight project, task, note, or file references. Keep the returned Task and run IDs.
2. Read status with `xopc_agent_runs_get` or poll `xopc_agent_runs_events` using `nextSequence` as the next cursor. Use `xopc_agent_runs_steer` to send updated instructions or `xopc_agent_runs_cancel` to cancel. A cancellation receipt can arrive before execution stops.
3. When a run requests clarification, respond through `xopc_agent_runs_respond` using its clarification ID and expected version. Complete approvals and device confirmations in the Gateway's own interface.
4. Use `xopc_agent_runs_result` to inspect the final reply and published artifacts. Paginate text and artifacts independently. Retrieve readable files with `xopc_agent_runs_artifact_read`, continuing with the returned offset and original revision. Access a delegated run through the grant that created it.

For callbacks, set `gateway.mcpCallback.url` to the receiving HTTPS address and set `gateway.mcpCallback.secretEnv` to the Gateway's signing-secret environment variable name. Pass `callback: true` when starting a run. Verify `X-Xopc-Signature` as HMAC-SHA256 over `<X-Xopc-Timestamp>.<raw request body>`; the header format is `sha256=<hex>`. Deduplicate by `X-Xopc-Event-Id` and acknowledge with HTTP 2xx. Callbacks cover waits and terminal results. Use the events and result tools to recover state.

[中文配置与完整调用示例](../zh/cli/mcp.md) · [pi MCP reference](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md)
