# MCP servers

xopc uses pi's native MCP extension for outbound connections, tool discovery, resources, OAuth and calls. Configure servers in `mcp.servers` or in the capability center's connector settings. Agent Plugin MCP components are projected into the same native registry.

Supported transports are stdio and Streamable HTTP. The native `exposure` modes are `codemode` (default), `deferred`, `direct`, and `hidden`; `timeout` is in seconds. HTTP servers use `type: "http"`, and pre-registered OAuth clients use the `oauth` object.

On the Gateway host, use `xopc mcp list --json`, `xopc mcp login <server>`, and `xopc mcp logout <server>`. The Web UI supports online services, commands on the Gateway host, and JSON configuration import. Authentication can use browser sign-in, Bearer Token, API Key headers, or custom headers. “Test connection” uses an expiring, principal-owned draft and does not change saved configuration. After a successful check, explicitly choose Add connection or Save changes. Saving checks the original server version and merges only that server into the latest configuration; changed or expired drafts must be tested again. OAuth test credentials remain in memory and are published under an independent native credential identity only when committing. Disabled servers can be edited without enabling them. Browser sign-in uses pi’s native OAuth flow, including a manual callback URL fallback for remote Gateways when supported. SSE and MCP resource attachments are not supported by this setup flow.

See the [MCP configuration and migration guide](./cli/mcp.md) for examples, credentials, exposure, and incompatible changes. The inbound `xopc mcp capabilities --allow-capability <id>` bridge remains available.
