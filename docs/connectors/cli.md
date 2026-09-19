# Managed CLI connectors

Feishu and WeCom use the same managed CLI runtime. MCP and Composio remain available for their existing integrations. The unused Feishu MCP definition has been removed; there is no credential migration or fallback.

## Connect

Open **Connectors**, choose Feishu or WeCom, and connect an account. xopc downloads a pinned distribution, verifies its integrity and executable version, and starts authorization in an isolated account directory. Feishu may require application initialization followed by user authorization; WeCom shows a QR code. Closing the dialog does not cancel authorization. Reopening it restores the active attempt; **Cancel authorization** explicitly cancels it. A stopped Gateway requires a new authorization attempt.

Connections start with read access. Selecting read and write still requires approval for each write. Multiple accounts require an explicit account choice; an unavailable selected account is never replaced silently. Reconnecting preserves account identity and invalidates earlier approvals. Disconnecting locally disables execution but does not revoke upstream authorization. The isolated CLI configuration is retained for reauthorization.

Pinned releases: `lark-cli 1.0.96`, `wecom-cli 1.3.0`. Native distributions cover macOS and Linux on x64 and arm64. The host needs `tar`. Windows is rejected until its credential isolation has been verified. Real account acceptance remains pending; both entries are Beta.

## Execution and diagnostics

The Agent uses normal external tool discovery, description and execution. Only curated actions are exposed; arbitrary commands, raw API escape hatches and newly discovered vendor methods are not executable.

- Feishu: document search/read, calendar list/event reads and creation, file metadata and contact queries.
- WeCom: document search/read, contact search, todo read/create.
- Pagination stays explicit in each action's schema and response. There is no unbounded automatic pagination.
- `xopcAccountId` selects a stable account and is required for batched reads.
- `xopcExportResult: true` exports a successful result to a private JSON artifact. The returned URL requires Gateway administration authentication. This does not enable arbitrary provider file uploads or downloads.
- **Check connection** verifies identity and action contracts. Recent execution statuses are available at `GET /api/connectors/:instanceId/executions`.

A timed-out, interrupted or malformed write response is **unknown**, because the remote write may already have succeeded. The approval is consumed once. Inspect the external resource with a read action before considering another write; xopc does not automatically retry it.

Runtime files live under `<state>/connectors/cli/runtimes/<adapter>/<version>/<platform>/`. Credentials, child home directories and result artifacts live under `<state>/connectors/cli/contexts/<contextId>/`. CLI-specific credential storage remains owned by the CLI. The host environment's unrelated credentials are not forwarded.

## Add another CLI

Implement `CliAdapter` in `src/connectors/cli/types.ts`, then register a trusted packaged adapter. It specifies pinned distributions, isolated configuration variables, curated scopes, schema/result decoding, literal argv construction, identity verification and authorization steps. Shortcuts without machine-readable schemas can supply version-pinned `staticActions`.

A connector definition references `runtime: { type: 'cli', adapterId, adapterVersion, binaryVersion }` and `auth: { mode: 'cli' }`. Store manifests must reference an already registered exact adapter version. They cannot provide code, an executable path, commands, environment overrides or credential setup fields.

A third deterministic adapter is exercised by `src/connectors/cli/__tests__/execution.test.ts` without modifying the runtime, provider, approval code or dialog. Distribution tests verify that a failed new version leaves the old pinned version usable. Supporting another vendor version requires updating its packaged adapter and fixtures; ordinary manifests cannot override supported versions.

Validation commands:

```sh
pnpm vitest run src/connectors/cli/__tests__
pnpm vitest run src/gateway/hono/routes/__tests__/cli-connectors-http.test.ts
pnpm exec tsx scripts/cli-connectors-browser-smoke.mts
```

The browser smoke uses Chrome at its standard macOS path, overridable with `XOPC_SMOKE_BROWSER`. Real-account validation must separately cover token refresh, multiple-account isolation, upstream identity semantics and explicitly approved test writes.
