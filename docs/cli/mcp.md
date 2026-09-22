# MCP commands

Outbound MCP setup and troubleshooting are covered in the [MCP guide](../mcp.md). Those connections are managed in Gateway settings or the `mcp.servers` configuration block.

## Expose selected xopc capabilities

With a Gateway already running, explicitly start the stdio proxy:

```bash
xopc mcp capabilities --allow-capability xopc.notes.list xopc.notes.get
```

This command does not install a client configuration, start a Gateway, or expose all capabilities. Wildcards are rejected. It reads the Gateway address and credential from the selected xopc configuration (`--config <path>`); do not pass secrets as command-line arguments. Use a dedicated, minimally scoped Gateway credential when connecting another agent.

Only the intersection of the explicit allowlist and the current authenticated HTTP capability catalog is available. Discovery and each call recheck visibility; Gateway remains responsible for authorization and input validation. This is an **HTTP proxy**: audit records retain the HTTP surface and authenticated Gateway principal, not an invented MCP identity.

Each tool accepts `majorVersion`, `descriptorDigest`, and `input` as shown by discovery. Writes additionally require a stable `idempotencyKey`. Contract changes fail closed; rediscover before proposing a new call. For `OUTCOME_UNKNOWN`, retain the same key and reconcile the original operation—never retry with a new key. The proxy neither approves requests nor retries calls automatically. Do not allow write capabilities unless that client is authorized to perform those writes.

Stdout is reserved for MCP JSON-RPC. The process exits when stdin closes or it receives SIGINT/SIGTERM. The retired channel-serving command is not restored.
