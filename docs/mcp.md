# MCP servers

xopc uses pi's native MCP extension for outbound connections, tool discovery, resources, OAuth and calls. Configure servers in `mcp.servers` or in the capability center's connector settings. Agent Plugin MCP components are projected into the same native registry.

Supported transports are stdio and Streamable HTTP. The native `exposure` modes are `codemode` (default), `deferred`, `direct`, and `hidden`; `timeout` is in seconds. HTTP servers use `type: "http"`, and pre-registered OAuth clients use the `oauth` object.

On the Gateway host, use `xopc mcp list --json`, `xopc mcp login <server>`, and `xopc mcp logout <server>`. The Web UI manages configuration and static API keys. Web OAuth callbacks, SSE, separate capability probes, and MCP resource attachments have been removed.

See the [MCP configuration and migration guide](./cli/mcp.md) for examples, credentials, exposure, and incompatible changes. The inbound `xopc mcp capabilities --allow-capability <id>` bridge remains available.
