# Composio connectors

xopc exposes Composio apps as individually installable connectors. The runtime uses Composio Sessions, keeps account selection and agent policy in xopc SQLite, and never exposes the Composio API key to agents or the browser.

## Integration strategy

xopc uses three integration lanes:

- Native channel plugins own core conversation ingress and egress. Telegram is configured under `#/channels/telegram`, not as a Composio toolkit.
- MCP owns frequent or critical services when a first-party connector exists. GitHub uses the built-in `github` MCP connector.
- Composio owns long-tail SaaS integrations where managed authentication and broad toolkit coverage are more valuable than a dedicated runtime.

The catalog marks each preferred lane. Composio duplicates for native channels or preferred MCP connectors remain readable for existing installations but cannot be newly installed.

## Setup

1. Install the optional runtime next to xopc:

   ```bash
   npm install @composio/core@0.14.0 @composio/experimental@0.2.0
   ```

   Add `-g` when xopc itself was installed globally.
2. Install **Composio API Key** from `#/connectors` and save the key.
3. Install an app such as Gmail, Notion, Slack, or GitHub.
4. Open the installed connector, choose **Connect OAuth**, and finish authorization in the new tab.
5. Return to xopc and refresh. Give accounts recognizable aliases, select the default account, choose the maximum read/write/admin scope, and limit access to specific agents when needed.

Toolkit installation is rejected until the Composio project API key is available from the credential store or `XOPC_COMPOSIO_API_KEY` / `COMPOSIO_API_KEY`.

Agents receive three tools:

- `composio_search` discovers exact actions and schemas only for installed, allowed apps.
- `composio_connect` creates an authorization link without claiming authorization completed.
- `composio_execute` executes a cached exact action contract. Write and admin actions follow the connector confirmation policy.

Approvals are one-time, expire after ten minutes, and are bound to the principal, session, action, account, and a deterministic hash of the arguments. Changing an argument invalidates the approval.

## Workflow preflight

A workflow can declare connector requirements in `manifest.json`:

```json
{
  "connectors": [
    {
      "connectorId": "composio-gmail",
      "scope": "read",
      "connectionRequired": true,
      "reason": "Read the messages selected by the user"
    },
    {
      "connectorId": "composio-slack",
      "scope": "write",
      "optional": true
    }
  ]
}
```

xopc refuses to start a workflow when a required connector is missing, disabled, outside the agent allowlist, too narrowly scoped, disconnected, or expired. Optional requirements are reported without blocking the run.

## Signed trigger delivery

Set `COMPOSIO_WEBHOOK_SECRET` in the gateway environment, expose the gateway through the existing remote-access layer, and register this public callback URL in Composio:

```text
https://your-public-host/api/connectors/composio/webhook
```

The handler requires `webhook-id`, `webhook-timestamp`, and `webhook-signature`, verifies the raw body with HMAC-SHA256, enforces a five-minute timestamp window, deduplicates the delivery id, archives the event, updates expired/deleted connection health, and publishes an automation event such as `connector.GMAIL_NEW_GMAIL_MESSAGE` with source `composio:gmail`.

Never expose the webhook endpoint without a configured signing secret. Composio requires a publicly reachable URL; loopback-only gateways need Tailscale, FRP, or another supported public exposure layer.

## Memory sync

Gmail, Google Drive, Notion, and Slack panels can run a verified read action and save its bounded result into xopc memory. Imported records are tagged as external, have `needs_review` status, retain their connector source, and cannot use write/admin actions. Review imported content before treating it as durable personal knowledge.

## Recovery

The connector panel refreshes provider state and distinguishes connected, disconnected, expired, and degraded connections. Reconnect expired accounts, retry transient health failures, or revoke accounts that should no longer be available. Workflows re-run the same checks before every new run.
