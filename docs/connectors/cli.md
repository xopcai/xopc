# Managed CLI connectors

Connect Feishu, WeCom or WPS 365 so your Agent can use supported office data and actions. xopc installs and verifies the required CLI and keeps each account isolated. These connectors are Beta.

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

## Verify and troubleshoot

After connecting, use **Check connection**, then ask the assistant to read a document, event or todo you recognize. Verify the selected account and returned content. Successful login does not establish every enterprise permission.

- Missing content: check the selected account, resource sharing and application scopes.
- Authorization failure: inspect the dialog's reason; administrator approval or subscription limits require administrator action.
- Download or startup failure: check the Gateway host's network, supported platform and `tar`.
- Unknown write result: read the remote state before attempting another creation.
- Revoke access: disconnect in xopc, then revoke authorization in the upstream account settings.

A Feishu messaging bot and an office connector are separate entries. See [Feishu channel](../channels/feishu.md) for messaging, and [Connectors](./index.md) for other connection methods.
