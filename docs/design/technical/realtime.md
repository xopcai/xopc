# Realtime transport

xopc uses one authenticated WebSocket connection per client for persistent server-to-client delivery and endpoint-tool traffic. Web, desktop, mobile, TUI, and the inbound MCP bridge share the same protocol and client runtime.

## Connection

1. The client creates a short-lived, single-use ticket with `POST /api/realtime/tickets` using the normal Bearer token.
2. The client opens `WS /api/realtime/v1/ws` and sends `realtime.hello` as its first frame.
3. The hello carries the ticket, client identity, requested topics and optional signed endpoint identity.
4. The gateway replies with `realtime.ready`; endpoint-capable clients also receive the endpoint turn token there.

Bearer tokens are never placed in the WebSocket URL. The server enforces a hello deadline, frame size, connection and subscription limits, heartbeat timeout, and bounded outbound queues.

## Topics

| Topic | Purpose | Replay |
|---|---|---|
| `gateway` | Global configuration, channel, automation, extension, and system events | 1,000 events |
| `sessions` | Cross-session lifecycle events | 1,000 events |
| `session:<sessionKey>` | Conversation-scoped state | 200 events |
| `run:<runId>` | Ordered agent-run stream | 8,000 events, removed after completion TTL |
| `workflow:<runId>` | Workflow-scoped progress | Policy-defined |
| `logs` | Live log entries | 500 events |

Every event has a topic-local monotonic sequence. Clients reconnect with their last applied cursor; the gateway replays newer events and suppresses duplicates. Subscription acknowledgements establish a cursor even before the first event arrives. If the cursor predates the replay window, the gateway emits a recoverable `realtime.gap`; chat clients reload the durable session snapshot and then consume the retained suffix. A missing or expired run topic emits a terminal gap and clients reconcile from REST only.

## Endpoint tools

Endpoint tool discovery and invocation use `endpoint.message` frames nested inside the same realtime connection. A signed endpoint hello advertises the current tool descriptors. The gateway verifies the principal, binds the endpoint to the connection, and routes invocation, cancellation, result, error, availability, and upload messages through that binding.

There is no separate endpoint WebSocket and no transport compatibility branch.

## HTTP boundary

REST remains the durable command and snapshot boundary: clients create session inputs, mutate resources, query state, and issue realtime tickets over HTTP. The realtime connection carries notifications, ordered run output, logs, and endpoint messages.

Finite request-scoped streams such as update/install progress and AI-assist responses may still use SSE. They are direct responses to one HTTP request, not persistent subscriptions or a second message bus.

## Mobile recovery

Mobile transport recovery is intentionally silent. Route probes, WebSocket reconnects, replay gaps, and run resume never create chat banners. Recovery uses a fast bounded retry phase, then parks until network, foreground, route, or realtime events wake it; a low-frequency foreground retry is the final safety net. When a run no longer exists, the client reconciles the durable session snapshot instead of asking the user to resume it.

Session inputs enter a durable mobile outbox before the first HTTP attempt. The outbox persists the original `clientMessageId`, text, and attachment file references (never attachment base64), retries every session after realtime connectivity returns, and removes an entry only after the gateway acknowledges it or definitively rejects it.

## Implementation

- Protocol: `packages/realtime-protocol`
- Shared client: `packages/realtime-client`
- Gateway broker/runtime: `src/realtime/`
- Ticket route: `src/gateway/hono/routes/realtime.ts`
- Endpoint runtime: `src/endpoint-tools/`
- Web integration: `web/src/features/gateway/gateway-realtime.ts`
- Mobile integration: `apps/mobile-expo/src/features/gateway/use-gateway-realtime.ts`
