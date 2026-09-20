# Managed CLI connectors

Feishu, WeCom and WPS 365 use the same managed CLI runtime. MCP and Composio remain available for their existing integrations. The unused Feishu and three WPS MCP definitions have been removed; there is no credential migration or fallback.

## Connect

Open **Connectors**, choose Feishu, WeCom or WPS 365, and connect an account. xopc downloads a pinned distribution, verifies its integrity and executable version, and starts authorization in an isolated account directory. Feishu may require application initialization followed by user authorization; WeCom shows a QR code. Closing the dialog does not cancel authorization. Reopening it restores the active attempt; **Cancel authorization** explicitly cancels it. A stopped Gateway requires a new authorization attempt.

Connections start with read access. Selecting read and write still requires approval for each write. Multiple accounts require an explicit account choice; an unavailable selected account is never replaced silently. Reconnecting preserves account identity and invalidates earlier approvals. Disconnecting locally disables execution but does not revoke upstream authorization. The isolated CLI configuration is retained for reauthorization.

Pinned releases: `lark-cli 1.0.96`, `wecom-cli 1.3.0`, `wps365-cli 0.3.6`. Native distributions cover macOS and Linux on x64 and arm64. The host needs `tar`. Windows is rejected until its credential isolation has been verified. Real account acceptance remains pending; these entries are Beta.

## WPS 365 authorization

Choose **WPS 365**. The initial connection first binds an application with `config init`, then authorizes a user with device login. Complete each browser step and return to xopc; the dialog polls progress and verifies the current user before reporting success. Your enterprise may require application publication, administrator approval and API/data permissions. A successful login does not guarantee access to every enterprise feature. A subscription entitlement error requires administrator action rather than repeated login.

WPS uses file credential storage in the isolated account directory, packaged API specifications and an explicit delegated user identity. It does not inherit host WPS tokens or fall back to application identity. Write commands remain excluded until vendor retry semantics and real-account write acceptance have been verified.

## Execution and diagnostics

The Agent uses normal external tool discovery, description and execution. Only curated actions are exposed; arbitrary commands, raw API escape hatches and newly discovered vendor methods are not executable.

- Feishu: document search/read, calendar list/event reads and creation, file metadata and contact queries.
- WeCom: document search/read, contact search, todo read/create.
- WPS 365: 14 read-only actions for cloud documents, calendars/events and mail. Writes are not exposed, even if the account policy allows them.
- Pagination stays explicit in each action's schema and response. There is no unbounded automatic pagination.
- `xopcAccountId` selects a stable account and is required for batched reads.
- `xopcExportResult: true` exports a successful result to a private JSON artifact. The returned URL requires Gateway administration authentication. This does not enable arbitrary provider file uploads or downloads.
- **Check connection** verifies identity and action contracts. Recent execution statuses are available at `GET /api/connectors/:instanceId/executions`.

A timed-out, interrupted or malformed write response is **unknown**, because the remote write may already have succeeded. The approval is consumed once. Inspect the external resource with a read action before considering another write; xopc does not automatically retry it.

Runtime files live under `<state>/connectors/cli/runtimes/<adapter>/<version>/<platform>/`. Credentials, child home directories and result artifacts live under `<state>/connectors/cli/contexts/<contextId>/`. CLI-specific credential storage remains owned by the CLI. The host environment's unrelated credentials are not forwarded.

## Add another CLI

Implement `CliAdapter` in `src/connectors/cli/types.ts`, then register a trusted packaged adapter. It specifies pinned distributions, isolated configuration variables, curated scopes, schema/result decoding, literal argv construction, identity verification and authorization steps. Shortcuts without machine-readable schemas can supply version-pinned `staticActions`. Trusted adapters may supply constant `environment` values and SHA-256 verified `configAssets`; manifests cannot override these. Assets are atomically installed without replacing credentials, and mismatched specs fail closed.

A connector definition references `runtime: { type: 'cli', adapterId, adapterVersion, binaryVersion }` and `auth: { mode: 'cli' }`. Store manifests must reference an already registered exact adapter version. They cannot provide code, an executable path, commands, environment overrides or credential setup fields.

A third deterministic adapter is exercised by `src/connectors/cli/__tests__/execution.test.ts` without modifying the runtime, provider, approval code or dialog. Distribution tests verify that a failed new version leaves the old pinned version usable. Supporting another vendor version requires updating its packaged adapter and fixtures; ordinary manifests cannot override supported versions.

Validation commands:

```sh
pnpm vitest run src/connectors/cli/__tests__
pnpm vitest run src/gateway/hono/routes/__tests__/cli-connectors-http.test.ts
pnpm exec tsx scripts/cli-connectors-browser-smoke.mts
pnpm exec tsx scripts/wps365-cli-smoke.mts
```

The browser smoke uses Chrome at its standard macOS path, overridable with `XOPC_SMOKE_BROWSER`. Real-account validation must separately cover token refresh, multiple-account isolation, upstream identity semantics and explicitly approved test writes.

The WPS binary smoke downloads and verifies the pinned official release, exercises all 14 commands with dry runs and a local HTTP fixture, and checks that missing user credentials do not trigger application-token fallback. It does not authorize a real account or validate enterprise entitlements.
