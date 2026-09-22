# @xopcai/extension-ui-sdk

TypeScript client for **xopc Gateway Console** extension UIs that run inside an **iframe**. The host and extension communicate over `window.postMessage` using a small RPC-style protocol (`xopc-host` / `xopc-extension` message envelopes).

## Install

```bash
pnpm add @xopcai/extension-ui-sdk
# or
npm install @xopcai/extension-ui-sdk
```

The package ships **TypeScript sources** (`exports` point at `src/*.ts`) for direct consumption by bundlers that compile dependencies.

## Quick start

```ts
import { createExtensionClient } from '@xopcai/extension-ui-sdk';

const client = createExtensionClient();

await client.whenReady();
// Host has sent init (extension id, permissions, theme, locale).

const theme = await client.theme.getTheme();
const unsubTheme = client.theme.onThemeChange((t) => {
  console.log('theme', t.mode, t.tokens);
});

const { sessionKey } = await client.agent.sendMessage('Hello', { newSession: true });
const unsubStream = client.agent.onStreamEvent(sessionKey, (payload) => {
  console.log('stream', payload);
});

// Later: unsubTheme(); unsubStream();
```

Call `whenReady()` before relying on host-backed APIs: the transport waits for the host **`init`** message ([`HostInit`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/interfaces/HostInit.md)) with `extensionId`, `permissions`, `theme`, and `locale`.

## `ExtensionClient` API (overview)

High-level surface from [`ExtensionClient`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/interfaces/ExtensionClient.md):

| Area | Role |
|------|------|
| **`theme`** | `getTheme()`, `onThemeChange` — [`ThemeInfo`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/interfaces/ThemeInfo.md) (`mode`, design `tokens`, optional font stacks). |
| **`agent`** | `sendMessage`, `onStreamEvent` — chat agent and streaming events for a `sessionKey`. |
| **`session`** | `listSessions`, `navigateToSession`. |
| **`config`** | `getExtensionConfig` / `setExtensionConfig` (typed via generic on get). |
| **`storage`** | Key/value helpers: `get`, `set`, `remove`, `keys`. |
| **`ui`** | `resize`, `showNotification`, `closePanel`, `navigate`, `onWidgetResult` (tool/widget iframe results via `widget.data`). |
| **`events`** | Custom extension events: `emit` / `on` (prefixed as `ext.<event>` on the wire). |
| **Lifecycle** | `onDispose`, `onDidChangeVisibility`. |

## `createExtensionClient`

[`createExtensionClient(options?)`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/functions/createExtensionClient.md) returns an `ExtensionClient`. Optional [`CreateExtensionClientOptions`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/type-aliases/CreateExtensionClientOptions.md) lets you inject a custom [`Transport`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/classes/Transport.md).

## `Transport` (advanced)

[`Transport`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/classes/Transport.md) listens for `message` events, tracks pending RPCs, and posts to `window.parent`. Useful knobs:

- [`TransportOptions`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/type-aliases/TransportOptions.md): e.g. `timeout` (default 10s) for `request()`.
- **`ready`**: `Promise<HostInit>` — same init the client awaits internally.
- **`id`**: host-assigned extension id after init.
- **`request` / `emit` / `on` / `dispose`**: lower-level control than `ExtensionClient`.

Wire types for custom integrations: [`ExtensionRequest`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/interfaces/ExtensionRequest.md), [`ExtensionEventMessage`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/interfaces/ExtensionEventMessage.md), [`HostResponse`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/interfaces/HostResponse.md), [`HostEventMessage`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/interfaces/HostEventMessage.md), [`HostToExtensionMessage`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/type-aliases/HostToExtensionMessage.md), [`ExtensionToHostMessage`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/type-aliases/ExtensionToHostMessage.md).

## Error codes

[`ExtensionErrorCode`](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/enumerations/ExtensionErrorCode.md) documents numeric codes the host may return on failed requests (permission, invalid request, method not found, internal error, timeout, extension not found, rate limited).

## Full API reference (TypeDoc Markdown)

Generated Markdown mirrors the public API (enumerations, classes, interfaces, type aliases, functions). Index:

[docs/api/README.md](https://github.com/xopcai/xopc/blob/main/packages/extension-ui-sdk/docs/api/README.md) · [browse `docs/api`](https://github.com/xopcai/xopc/tree/main/packages/extension-ui-sdk/docs/api)

To regenerate after cloning **xopc**:

```bash
pnpm -C packages/extension-ui-sdk run docs
```

## License

MIT
# Pinned Local App capabilities

Installed Local Apps may declare `ui.capabilities` entries with an exact `id`,
`majorVersion`, and `descriptorDigest` from the authenticated Gateway catalog.
Currently supported bindings are `xopc.notes.get`, `xopc.notes.list`,
`xopc.tasks.get`, and `xopc.tasks.list` for reads, plus `xopc.notes.create`,
`xopc.notes.update`, and `xopc.notes.append` for local writes. Wildcards, duplicate
IDs, undeclared operations, and supplied implementation code are rejected.

Bindings are included in the release source hash and permission review. Obtain a
fresh acceptance result and user grant after changing the release. The UI host
binds calls to its registered iframe and reviewed release; never embed Gateway
credentials in the app or pass an extension identity, grant, or release digest
as capability arguments.

```ts
const descriptor = await client.capability.describe('xopc.notes.list');
const result = await client.capability.call(descriptor.id, {
  majorVersion: descriptor.majorVersion,
  descriptorDigest: descriptor.descriptorDigest,
  input: { limit: 20 },
});
```

The host refuses undeclared or changed contracts, disabled/uninstalled apps, and
missing or revoked grants. A release switch or revocation during a read prevents
delivery of its result. This API currently targets installed Local Apps, not
arbitrary Node extensions. Writes require an explicit stable `idempotencyKey`;
retain it after timeouts or unknown outcomes. Keys are isolated by caller, app,
and installed release. Updates also require the current note revision.

Agents use `xopc_use` with `mode: "local_app"`, `command: "capabilities"`, and
`args: { extensionId }` to discover an already granted release. Invoke with
`command: "invoke"` and `args: { extensionId, manifestDigest, capabilityId, call }`.
Discovery never creates a grant. Both paths share the host dispatcher and release
checks. Task writes, destructive actions, arbitrary backend registrations, and
external writes are not exposed by these bindings.

Release validation and installation reject stale host contract digests; refresh
the binding and repeat acceptance before publishing. Rollback verifies the stored
artifact source hash and contract compatibility without reversing business data.
