# MCP servers

MCP (Model Context Protocol) lets xopc connect an Agent to tools supplied by another local program or remote service. Add an MCP server when you trust its operator and need capabilities that xopc does not provide directly.

## Before connecting

Confirm:

- what tools the server exposes;
- whether it runs locally or sends data to a remote service;
- which credentials and filesystem paths it can access;
- whether the intended Agent should be allowed to use every exposed tool.

An MCP server is code with the permissions of the account that runs it. Treat installation commands and remote URLs as security-sensitive.

## Add a server in the console

1. Open **Settings → Agent MCP**.
2. Choose **Add server**.
3. Select a local command or remote HTTP connection.
4. Enter the command, URL, environment variables, and authentication requested by the server provider.
5. Save and run the connection test.
6. Review the discovered tool list.
7. Allow only the required tools for the intended Agent.

The server is ready when its status is healthy and the expected tools appear.

## Local command example

```json
{
  "mcp": {
    "servers": {
      "example": {
        "command": "example-mcp-server",
        "args": []
      }
    }
  }
}
```

The command must be available in the environment that starts the Gateway. Prefer absolute paths when service processes use a different `PATH` from your terminal.

## Remote server example

```json
{
  "mcp": {
    "servers": {
      "example": {
        "transport": "streamable-http",
        "url": "https://mcp.example.com/mcp"
      }
    }
  }
}
```

Store authentication through the supported credential or environment mechanism. Do not put a live bearer token in a shared configuration example.

## Remote OAuth example

For a Streamable HTTP server that implements MCP OAuth, declare OAuth without putting tokens in `xopc.json`:

```json
{
  "mcp": {
    "servers": {
      "private-example": {
        "transport": "streamable-http",
        "url": "https://mcp.example.com/mcp",
        "auth": {
          "type": "oauth"
        }
      }
    }
  }
}
```

Save the server, then choose **Connect** on its card. xopc uses Authorization Code with PKCE, opens the provider authorization page, and receives the callback on a short-lived `127.0.0.1` listener. The server must support dynamic client registration when `clientId` is omitted. If the provider issued a public client id in advance, configure it as `auth.clientId` instead.

OAuth is intentionally limited to Streamable HTTP. It cannot be combined with a static `Authorization` header. Credentials are stored locally under the xopc credentials directory, keyed by the canonical MCP endpoint; all Agents using that endpoint share the same account. **Disconnect** removes the local credential and active MCP runtimes, but does not revoke the grant at the provider.

## Limit access by Agent

A successful MCP connection does not mean every Agent should use every tool. Review Agent tool policy after the server is connected. Keep write, delete, messaging, payment, and account-administration tools disabled unless they are essential.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Local server does not start | Command path, executable permissions, working directory, and required environment variables |
| Remote server is unreachable | URL, TLS certificate, proxy, network policy, and authentication |
| OAuth connect does not open | Allow pop-ups and confirm the browser runs on the same machine as the local Gateway |
| OAuth says client registration failed | Configure the public `auth.clientId` supplied by the provider, or ask the provider to enable dynamic client registration |
| Server is healthy but tools are missing | Tool discovery result and Agent allow/deny policy |
| Tool works in terminal but not Gateway | The Gateway service has the same `PATH`, files, and environment |
| Connection repeatedly restarts | Server logs and the first protocol or startup error |

Restart the Gateway after changing server commands or environment variables. Then test with one read-only tool call before enabling side effects.
