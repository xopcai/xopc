# MCP servers

xopc uses pi's native MCP extension for outbound connections, tool discovery, resources, OAuth and calls. Configure servers in `mcp.servers` or in the capability center's connector settings. Agent Plugin MCP components are projected into the same native registry.

Supported transports are stdio, Streamable HTTP, and legacy SSE. The native `exposure` modes are `codemode` (default), `deferred`, `direct`, and `hidden`. The `timeout` is in seconds. Use `type: "http"` for Streamable HTTP, `type: "sse"` for legacy SSE, and the `oauth` object for pre-registered OAuth clients.

On the Gateway host, use `xopc mcp list --json`, `xopc mcp login <server>`, and `xopc mcp logout <server>`. The Web UI supports online services, commands on the Gateway host, and JSON configuration import. Authentication can use browser sign-in, Bearer Token, API Key headers, or custom headers. “Test connection” uses an expiring, principal-owned draft and does not change saved configuration. After a successful check, explicitly choose Add connection or Save changes. Saving checks the original server version and merges only that server into the latest configuration; changed or expired drafts must be tested again. OAuth test credentials remain in memory and are published under an independent native credential identity only when committing. Disabled servers can be edited without enabling them. Browser sign-in uses pi’s native OAuth flow, including a manual callback URL fallback for remote Gateways when supported.

## Mobile setup

Open **Capability Center → Connections → Add custom MCP connection**. Choose **Legacy SSE** under the server URL’s advanced settings or import JSON with `type: "sse"`. Private addresses are reached from the Gateway's network. Localhost refers to the Gateway host. For custom private DNS names, select **Gateway private network** or specify `"network": "private"` when importing JSON.

For a server URL, **Authentication** defaults to automatic detection. You can also choose browser OAuth, Bearer Token, API Key, custom request headers, or no authentication. For API Key, enter the key and use `X-API-Key` or the header name specified by the provider. If detection finds that credentials are required, choose the method on the authentication screen.

### Remote connection authentication

- Marketplace connectors declare the authentication method in the package. For an API key, token, or personal MCP URL, use the provider link in the setup panel and follow the instructions next to the field. Older mobile installs can use **View provider setup guide** under the connection’s additional options. For OAuth packages, install the connector and choose **Connect account**. Both marketplace and custom MCP connections use the Gateway's verification flow. The mobile panel offers **Use in chat** once an enabled remote connection has passed verification.
- OAuth supplies the `Authorization` header. Custom connections can add other request headers in **OAuth client settings** or through JSON import. Marketplace connectors use the supplementary headers declared by the package. A manually supplied `Authorization` header belongs to Bearer Token or custom-header authentication.
- Public clients can use provider-supported registration. When a provider rejects dynamic client registration, enter a provider-approved client ID in **OAuth client settings**. Supply a client secret only when the provider issued one. If the provider requires a fixed loopback redirect, register `http://127.0.0.1:<port>/callback` and enter that port. When the browser runs on a different device from the Gateway, use **Final browser address** if the automatic callback cannot reach the Gateway.
- The Gateway keeps draft credentials separate until authorization and tool discovery succeed and you save the connection. Reauthorization uses the same flow. The Gateway protects the client secret and header values in its credential store.

For stdio, the Gateway administrator enables mobile command launch with `xopc config set gateway.mobileMcpAllowStdio true`. Review the program, arguments, and working directory before selecting **Run and check**. Environment variable values are stored in the Gateway credential store when the draft is committed. After a successful check, choose **Add connection** to commit the draft.

See the [MCP configuration and migration guide](./cli/mcp.md) for examples, credentials, exposure, and incompatible changes.

## Connect an external client to xopc

Use a Gateway grant to let an MCP client search projects, tasks, and notes, or delegate to a configured xopc Agent. Grants default to read access across the personal workspace. Use `--allow-capability` to restrict which operations the client can call. Delegation and other write operations require write access.

For a local client, create a grant with `xopc mcp grant` and configure the client to run `xopc mcp serve --stdio`. Remote clients can use the Gateway's optional Streamable HTTP endpoint with an external OAuth issuer and a separate Gateway grant. Each client can follow its own delegated runs, answer clarifications, steer or cancel work, and retrieve published results where its grant permits. [Local and remote setup](./cli/mcp.md#let-an-external-client-use-gateway-tools)
