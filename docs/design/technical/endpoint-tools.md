# Endpoint tools

Endpoint tools let an agent invoke capabilities owned by a connected web, desktop, or mobile client. The interactive path is intentionally small: the gateway sends one bounded invocation to one authenticated endpoint, and the endpoint returns validated text, JSON, or uploaded files.

## Components

- `packages/endpoint-tools-protocol` owns protocol v2 schemas and shared wire types.
- `packages/endpoint-tools-client` owns the platform-neutral tool registry and host state machine.
- `src/endpoint-tools` owns authentication, the online endpoint registry, trusted policy admission, invocation lifecycle, uploads, and session bindings.
- Each client owns only platform adapters and declarative `EndpointToolDefinition` modules.

Web, desktop, and mobile definitions use the same registration model. Tool execution is co-located with its descriptor; there is no central client-side name switch.

## Security model

An endpoint descriptor is a capability claim, not an authorization decision. The gateway admits only tool names present in its trusted policy catalog and checks the descriptor's `policyId`, effect, confirmation mode, foreground requirement, declared permissions, and sensitivity against that policy.

Every descriptor has an input schema and an output schema. Arguments are validated before external execution, while returned content is validated by the gateway before the invocation succeeds. Protocol v1 is rejected; there is no compatibility branch.

Personal reads and mutations require foreground execution and confirmation. Invocation audit rows retain an argument hash and terminal metadata, not raw arguments or results. A result also carries its sensitivity classification into agent-tool details.

## Mobile contacts

The mobile client exposes three read-only tools:

- `mobile.contacts.pick` uses the system picker and does not request broad address-book permission.
- `mobile.contacts.search` requests read permission when invoked and returns at most 20 matches.
- `mobile.contacts.get` reads one explicitly identified contact.

Results contain only contact ID, display name, phone numbers, and email addresses. Notes, images, postal addresses, birthdays, and other contact fields are never requested. Android declares `READ_CONTACTS`; `WRITE_CONTACTS` is explicitly blocked.

## Cross-device selection

Same-endpoint turns can use their signed origin endpoint. Cross-device use requires an explicit session binding:

```text
PUT    /api/endpoint-tools/bindings/:sessionKey  { "endpointId": "..." }
GET    /api/endpoint-tools/bindings/:sessionKey
DELETE /api/endpoint-tools/bindings/:sessionKey
```

Bindings are persisted in SQLite. An explicit binding is authoritative: if its endpoint is offline, the provider exposes no endpoint tools and does not silently fall back to the turn origin.

## Background boundary

Interactive tools are not background workers. `EndpointDeviceJobRequest`, `EndpointDeviceJobStatus`, and `EndpointDeviceEvent` are separate protocol contracts with consent-grant, idempotency, expiry, subscription, and event identity fields. They are deliberately excluded from `ServerEndpointMessage` and `ClientEndpointMessage`.

When background support is implemented, it must use a durable job/event transport and OS-specific background execution policy. It must not extend the interactive tool handler with hidden polling or long-running work.

## Adding a tool

1. Add a platform `EndpointToolDefinition` with bounded input/output schemas and minimal returned data.
2. Choose an existing trusted policy and add the exact tool name to the server policy catalog. New policy semantics require a server-side policy implementation, not a client-only descriptor change.
3. Add only required OS permissions through the platform's native configuration mechanism.
4. Test success, invalid arguments, denial/cancellation, output-schema failure, and foreground behavior.
5. Run type checks, targeted tests, client lint, and native build verification when permissions or native modules change.
