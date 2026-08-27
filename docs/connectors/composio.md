# Composio

Composio provides managed connections and actions for external apps. Use it when the app you need is available in Composio and you accept Composio as an additional service in the data path.

## Connect

1. Create or sign in to your Composio account.
2. In xopc, open **Connectors** and choose **Composio**.
3. Add the requested Composio credential.
4. Choose an app and complete its authorization flow.
5. Review the scopes granted by the external app.
6. Assign the connection only to the Agent that needs it.

## Verify

Ask the Agent for a read-only action such as listing a small number of recent items. Confirm that it uses the intended account and does not request broader access than expected.

Enable create, update, send, or delete actions only after read access works and confirmation behavior is clear.

## Privacy and removal

Requests may pass through xopc, the selected model provider, Composio, and the connected app. Review each service's data policy.

When removing a connection, delete it from xopc and Composio, then revoke the app authorization in the external service when required.

## Troubleshooting

- Reauthorize when the connection shows an expired or revoked token.
- Confirm that the selected app action exists in the current catalog.
- Check that the Agent permits the connector tool.
- Inspect Gateway logs for the first Composio error without sharing tokens.
