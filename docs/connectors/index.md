# Connectors

Connectors let an Agent use data or actions from an external service. They may be supplied through a built-in integration, an extension, an MCP server, or a verified connector catalog.

## Choose a connection method

| Method | Use it when |
| --- | --- |
| Built-in or verified connector | The service appears in the Gateway connector catalog |
| Extension | The integration includes a channel, provider, UI, or local runtime |
| MCP server | The service provides an MCP endpoint or local server |
| Composio | You want its managed app connections and action catalog |

## Connect safely

1. Open **Connectors** and choose the service.
2. Review requested scopes before signing in.
3. Grant the smallest available permission set.
4. Assign the connector only to the Agent that needs it.
5. Test a read-only action.
6. Enable writes or external actions only after reviewing confirmation behavior.

Connector access can expose private account data to the configured model. Review both the service's permission scopes and the Agent's model provider.

## Manage connections

Use the Connector page to check health, reconnect expired authorization, and remove unused connections. Removing a connector from xopc may not revoke authorization at the external service; revoke it in the service's account settings as well when necessary.

For specific integrations, see [Composio](./composio.md) and [GitHub](./github.md). For general protocol connections, see [MCP](../mcp.md).
