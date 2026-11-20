# MCP servers

xopc uses pi's native MCP extension for outbound connections, tool discovery, resources, OAuth and calls. Configure servers in `mcp.servers` or in the capability center's connector settings. Agent Plugin MCP components are projected into the same native registry.

Supported transports are stdio, Streamable HTTP, and legacy SSE. The native `exposure` modes are `codemode` (default), `deferred`, `direct`, and `hidden`. The `timeout` is in seconds. Use `type: "http"` for Streamable HTTP, `type: "sse"` for legacy SSE, and the `oauth` object for pre-registered OAuth clients.

On the Gateway host, use `xopc mcp list --json`, `xopc mcp login <server>`, and `xopc mcp logout <server>`. The Web UI supports online services, commands on the Gateway host, and JSON configuration import. Authentication can use browser sign-in, Bearer Token, API Key headers, or custom headers. “Test connection” uses an expiring, principal-owned draft and does not change saved configuration. After a successful check, explicitly choose Add connection or Save changes. Saving checks the original server version and merges only that server into the latest configuration; changed or expired drafts must be tested again. OAuth test credentials remain in memory and are published under an independent native credential identity only when committing. Disabled servers can be edited without enabling them. Browser sign-in uses pi’s native OAuth flow, including a manual callback URL fallback for remote Gateways when supported.

## Mobile setup

Open **Capability Center → Connections → Add custom MCP connection**. Choose **Legacy SSE** under the server URL’s advanced settings or import JSON with `type: "sse"`. Private addresses are reached from the Gateway's network. Localhost refers to the Gateway host. For custom private DNS names, select **Gateway private network** or specify `"network": "private"` when importing JSON.

For a server URL, **Authentication** defaults to automatic detection. You can also choose browser OAuth, Bearer Token, API Key, custom request headers, or no authentication. For API Key, enter the key and use `X-API-Key` or the header name specified by the provider. If detection finds that credentials are required, choose the method on the authentication screen.

For stdio, the Gateway administrator enables mobile command launch with `xopc config set gateway.mobileMcpAllowStdio true`. Review the program, arguments, and working directory before selecting **Run and check**. Environment variable values are stored in the Gateway credential store when the draft is committed. After a successful check, choose **Add connection** to commit the draft.

See the [MCP configuration and migration guide](./cli/mcp.md) for examples, credentials, exposure, and incompatible changes. The inbound `xopc mcp capabilities --allow-capability <id>` bridge remains available.
