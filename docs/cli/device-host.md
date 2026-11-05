# Device capability hosts

A Gateway runs the agent. Device hosts connect outbound to that Gateway and publish capabilities. The Gateway stores offline claims, admits an exact contract digest, discovers tools through deferred `tool_search`, and sends each invocation to its selected connection. Local and remote Gateways use the same path.

## Run a device-local MCP host

`xopc device-host --host-config /absolute/path/device-host.json`

Use `--interactive` in a local terminal to answer confirmation-required requests. Without a confirmation handler, these requests are denied. Provider approval does not bypass the device confirmation or operating-system permissions.

```json
{
  "gatewayUrl": "https://gateway.example.com",
  "tokenEnv": "XOPC_DEVICE_GATEWAY_TOKEN",
  "identityPath": "/home/user/.xopc/device-host-identity.json",
  "displayName": "Workshop",
  "providers": [{
    "localId": "climate",
    "title": "Workshop sensors",
    "summary": "Read temperature from the workshop",
    "server": { "command": "node", "args": ["/opt/sensors/mcp-server.mjs"] },
    "policies": {
      "Read-Temperature": {
        "effect": "read",
        "sensitivity": "public",
        "confirmation": "never",
        "requiresForeground": false,
        "requiredPermissions": [],
        "timeoutMs": 10000,
        "maxConcurrency": 1,
        "supportsCancellation": true,
        "idempotent": true,
        "resultKinds": ["json"]
      }
    }
  }]
}
```

The owner-managed Gateway credential is used only for initial enrollment. The host receives `device.self` and `gateway.status` scopes, signs HTTP and WS requests with its device key, and rotates its own credentials. It cannot approve Providers or read conversations. After enrollment the owner credential need not be present. The origin-bound identity file is created with mode `0600` and contains the signing key and restricted refresh credential. Keep one host process per identity. If a crashed process leaves a lock, remove it only after verifying that process has stopped. HTTPS is required outside loopback. Gateway MCP configuration and credentials are separate from device-local MCP server settings.

After connecting, open Settings → Devices → the device → Device capabilities. Inspect its tools and approve the reported contract. Changed descriptions, schemas or policies require approval of the new digest. Offline claims remain visible; an offline record cannot execute.

Choose an execution device in the chat header, or let the agent discover `device_use`, select a returned `targetRef`, and then discover the relevant capability through `tool_search`. Explicit target selection is independent of the message source. Source-specific reads continue to refer to the device that sent the message. When the selected connection disappears, execution fails without selecting another device.

## Native and hardware adapters

Use `EndpointToolRegistry.registerProvider({ localId, title, summary, instructions?, tools, getState? })` from `@xopcai/endpoint-tools-client`. Each tool supplies a bounded descriptor and an `execute(args, context)` implementation. The context provides cancellation, progress and invocation-scoped file upload. `removeProvider(localId)` withdraws its tools. A manifest contains data only; execution code stays on the device.

Provider IDs are scoped to the authenticated principal. Two devices can use the same local ID and raw MCP tool names without collision. Concurrent connections cannot publish the same stable Provider simultaneously. A task pins principal, connection epoch, actor and transcript; reconnecting requires explicit reselection. A Gateway restart preserves the old selection as unavailable and does not restore connection authority. Active Computer/Browser resources must confirm release before switching.

Use `getState` for `ready`, `needs_foreground`, `permission_missing`, `resource_busy` or `unavailable`. The SDK publishes readiness only after the Gateway acknowledges the current catalog revision, and republishes a full catalog after reconnect. State expires without refresh. A connection being online does not establish readiness or permission.

Tools that share an exclusive physical resource can declare the same `resourceId` in their policies. The Gateway serializes matching resources per device principal. The host also holds the resource until local execution settles, including when the transport disconnects and reconnects.

## Supported MCP surface

The device adapter uses the installed MCP SDK with stdio or Streamable HTTP. It supports paginated tool discovery, list-change notifications, Server instructions, structured output, text, images, embedded resources, resource links and explicitly scoped resource reads. `policies` is an installation allowlist. Server annotations never install a tool or grant permission. Resource reads require `resourcePrefixes` and an installed `xopc_resource_read` policy. Set `gatewayFormInput` to `1` on a Provider to forward MCP form requests to the authenticated conversation while the original invocation is open. The chat validates the answer against the form schema and sends it back to that invocation. SDK integrators can also implement the local `onElicitation` callback.

After a Gateway restart, an owner can answer a recovered form in the original chat while the same device process is still waiting and the invocation has time remaining. Recovery checks the original target, transcript, device and admitted tool contract. It returns only the answer to the original call. It does not run the tool again. Recoverable writes require durable Provider receipts. Invocations that use a single-call consent or a transient file grant end when the connection closes.

Each host supports up to 20 Providers, 100 tools per Provider and 128 KiB per catalog. Schema depth and node count are bounded. External, recursive and dynamic schema references and schema regex are rejected. MCP schemas outside these limits withdraw the Provider with an error. Sampling, roots, URL elicitation, OAuth orchestration and MCP Tasks are unsupported.

Writes require local confirmation. Gateway writes use the existing durable external-operation ledger with manual recovery. Disconnects, timeouts and invalid results after dispatch produce `OUTCOME_UNKNOWN`; the same operation is not automatically replayed. Cancellation of a basic adapter is not proof that an external hardware effect was rolled back. Desktop's independently authorized durable execution remains a dedicated path.

The MCP host records write intents and result digests in the private `<identityPath>.operations` directory. Owners can check the device receipt from the Gateway's invocation history after the same device reconnects. This reports evidence without recovering missing result content or repeating the write. The journal stops admitting new writes at 10,000 entries; it does not automatically delete records that protect against replay.

## Transfer a file between devices

Set `artifactInput` in the receiving MCP tool's policy to the name of a required string parameter. After approval, the parameter accepts a transfer ID at the Gateway and receives the file bytes encoded as base64 inside the device MCP process. Select the receiving device in the chat header, open **Transfer file**, and select the source file and receiving capability. Paste the generated request into the chat within two minutes. Eligible files are completed device results from the current transcript and are limited to 8 MiB. The transfer can be redeemed once by the authorized invocation. Changing the selected connection, resetting the transcript or revoking the grant invalidates the transfer.

## Delegate a device capability

The owner can use `POST /api/endpoint-tools/delegations` to authorize one admitted public Provider tool for a verified channel or enabled automation. The request includes `subject`, `endpointId`, `toolName`, `arguments` and `expiresAt` (epoch milliseconds, at most 30 days). For a channel use `{ "kind": "channel", "channel": "telegram", "accountId": "…", "chatId": "…", "senderId": "…" }` and include `threadId` for a thread. For automation use `{ "kind": "automation", "automationId": "…" }`. Arguments must match exactly. Use `GET` on the same collection to inspect grants and `DELETE /api/endpoint-tools/delegations/:delegationId` to revoke one. The grant covers runs accepted after issuance. Editing the automation action or changing the Provider contract requires new authorization.

Set `gateway.deviceProvidersEnabled` to `false` to remove dynamic Provider tools from discovery and dispatch while retaining the device identities and approval records. Restore the setting to re-enable currently ready Providers. Built-in device capabilities continue to use their own policies.

Endpoint protocol v3 is required. The outer Realtime protocol remains v2. Old Endpoint parsers, persistent session bindings and the hardcoded `desktop.bridge.*` sensor path have been removed; database upgrade history is preserved.
