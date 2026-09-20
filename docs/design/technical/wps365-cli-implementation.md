# WPS 365 CLI replacement implementation plan

Status: proposed; implementation and real-account acceptance are not complete.
Date: 2026-09-20

## Decision and scope

Replace the three built-in WPS MCP connectors with one managed CLI connector:

- Connector ID: `wps365-workspace`; display name: `WPS 365`.
- Adapter ID: `wps365`; external-tool source: `cli`.
- Remove `wps-cloud-docs`, `wps-calendar`, and `wps-mail` after the new implementation passes the release gates in this document.
- The user confirmed the existing marketplace MCP integrations have no users. No credential migration, old-ID aliases, dual implementations, fallback to the old MCP endpoints, or compatibility feature flags are needed.
- This change concerns the WPS integrations only. Keep the generic MCP runtime and other vendors' connectors.
- Do not silently delete arbitrary local configuration or secrets. Obsolete built-in catalog definitions and their dedicated code/tests can be removed without a database migration.

The first release is a Beta integration for the existing supported CLI platforms: macOS/Linux, x64/arm64, subject to availability of verified upstream archives. Windows support is a separate runtime task.

## Verified inputs and remaining uncertainties

Official references:

- https://open.wps.cn/documents/wps365-cli
- https://github.com/wps365-open/cli/blob/main/README.md
- https://github.com/wps365-open/cli/blob/main/CHANGELOG.md
- https://github.com/wps365-open/cli/blob/main/docs/prerequisites.md

The official changelog records v0.3.6 on 2026-09-17. Use it as the initial evaluation version, not an untested guarantee of compatibility. The documentation describes application registration, device login, JSON output, automatic token refresh, a configurable config directory, and encrypted credential storage. It also documents CDN-loaded command specs and possible delegated-to-app fallback. Version 0.3.5 added a local MCP bridge; MCP is not deprecated by this decision.

The inspected public repository checkout contains documentation and installers, not the implementation directories described in its README. Verify actual behavior against the pinned binary. Documentation alone does not prove CLI command availability, wire schemas, credential isolation, refresh semantics, or write retry safety.

Stage 1 must resolve:

1. Archive URLs, members, integrity digests, supported platforms, and actual version output.
2. Noninteractive registration/login behavior, URL framing, expiry, cancellation, and whether unsolicited browser opening can be suppressed.
3. Exact JSON envelopes and exit codes for successful/partial/failed login, current-user lookup, and each selected action.
4. Where specs and credential encryption keys are stored; whether config-directory isolation covers the file credential backend.
5. How explicit delegated mode behaves when the user token is absent, expired, or rejected.
6. Whether writes can be replayed inside the CLI after 401/network errors, and how to disable or constrain that behavior.
7. Which required actions depend on enterprise approval or paid entitlements.

## Architecture

Existing execution path remains:

`xopc_tool_search -> xopc_tool_describe -> xopc_tool_execute -> CliToolProvider -> WPS adapter -> managed process`

Reuse installation locking, process cancellation, timeout/output limits, isolated account contexts, connection persistence, principal and agent policies, one-time write approvals, execution audit, artifact exports, and the CLI connector dialog. Do not add a WPS REST endpoint family, a second provider implementation, or a provider-specific UI.

The adapter owns command mapping, output decoding, identity decoding, authorization steps, and a curated action allowlist. The shared runtime owns lifecycle and execution policy. Do not wrap WPS `mcp serve` in the CLI adapter: it introduces an unnecessary second transport and a long-lived process into the chosen execution path.

### Small shared-runtime extensions

Add only the capabilities demonstrated necessary by WPS:

- Optional trusted adapter environment constants, initially for `WPS365_KEYRING_BACKEND=file`. Merge them before runtime-owned HOME/config/data directory values; disallow overriding those reserved values. Do not accept arbitrary environment settings from manifests or model arguments.
- Optional packaged context assets, expressed as relative paths, bytes, and expected digest. This supports fixed provider specs without adding a generic plugin lifecycle-hook system.
- Prepare and verify assets before every subprocess invocation, including authorization, identity probes and schema discovery. Validate relative paths and reject escaping paths/symlinks. Copy only designated assets; never overwrite provider credentials or unrelated account files.
- Existing adapters omit the optional fields and retain their current behavior.

The existing downloader permits GitHub/npm origins. Prefer official GitHub release archives when verified. If CDN delivery is required, add the exact official CDN origin to the trusted installer policy and validate redirects; do not add arbitrary per-manifest download hosts. Do not execute remote install scripts or use `latest` at runtime.

### Fixed contracts and specs

Pin a tested tuple: adapter version, CLI binary version/integrity, provider spec digest, and action contracts. Include the spec digest in action revisions so old approvals cannot authorize changed behavior.

Start with a small, explicitly maintained set of `staticActions`; the current runtime already supports this. Do not introduce a general YAML-to-JSON-Schema compiler for the first WPS release. Prefer stable curated commands; if a selected capability requires a raw API call, bind the exact method/path and schema in the adapter. The model must never receive a generic `api`, arbitrary URL, shell, update, or spec-update tool.

Package the verified provider specs into the distributed build and place them in the provider's supported local override directory. No runtime spec update command is exposed. Verify the actual binary respects the local pinned files and does not replace them. If it cannot, this is a release blocker rather than a reason to accept drifting contracts.

If JSON modules can carry the needed asset bytes with the current bundler, prefer that over additional runtime file-location logic. Test the packaged build, not only the source checkout.

## Product surface and initial actions

One connector, one authorization flow, one account list. Document/calendar/mail capabilities are action groups rather than separate installations. Keep the current read/write policy and per-write confirmation.

Proposed xopc action IDs below are internal contracts, not assertions about exact upstream command spellings:

| Domain | Initial actions | Scope |
| --- | --- | --- |
| Documents | `drive.libraries.list`, `drive.files.list`, `drive.files.search`, `drive.files.get`, `documents.content.get` | read |
| Calendar | `calendar.calendars.list`, `calendar.events.list`, `calendar.events.get` | read |
| Calendar | `calendar.events.create` | write |
| Mail | `mail.mailboxes.list`, `mail.folders.list`, `mail.messages.list`, `mail.messages.search`, `mail.messages.get` | read |

Each action requires a tested upstream command/API mapping, closed input schema, pagination contract, identity mode, permission/entitlement expectations, success decoder, and error fixtures. If document content retrieval needs downloads or asynchronous conversion, specify that bounded flow before enabling the action; do not present metadata as document content.

Deferred: sending mail/messages, deletes, sharing/permission changes, arbitrary uploads, meetings, spreadsheets and multi-dimensional tables. Existing MCP descriptions mention some of these; record the intentionally narrower first-release coverage instead of claiming full parity.

Add WPS, WPS365, 金山, WPS 365, and 金山文档 discovery terms as appropriate, while labeling this integration as WPS 365 enterprise cloud services. Do not promise equivalence with a personal Kingsoft Docs account or local desktop WPS automation.

## Authorization and identity

Use the shared two-stage authorization UI:

1. `config init`: create/bind the app through the official verification page.
2. `auth login --device`: authorize the user with the selected supported permissions.
3. Probe the current user with explicit delegated identity and verify the result before committing the account.

Exact flags, trusted verification hosts, expiry parsing and output decoders come from Stage 1 fixtures. Never infer successful login from an exit code alone, and never treat all nonzero codes as partial success. Accept a partial result only when its documented protocol explicitly confirms authentication and the independent user probe succeeds.

Construct identity from the actual stable enterprise/tenant and user IDs; keep the application binding in metadata. Do not use display names as identity keys. Reauthorization must match the selected account identity. All business commands explicitly request delegated identity; failure must not fall back to an app or another account.

Use isolated config/HOME directories and a verified encrypted-file credential backend. Test isolation of both encrypted tokens and the encryption key; separate config directories alone do not prove keychain isolation. No token values or complete process output are returned to the model or written into diagnostics.

Token refresh remains provider-owned. xopc handles a final expired/revoked result through its existing connection-recovery flow. Enterprise approval, missing scope, and missing subscription entitlement are distinct failures; repeatedly reconnecting must not be offered as the remedy for an entitlement failure.

Do not require a locally recorded scope list to be complete unless the selected CLI protocol guarantees that property. Keep xopc action policy authoritative locally, and let the provider enforce actual upstream grants when the grant ledger is incomplete.

## Writes and errors

Continue the existing approval hash, fresh account/policy check, single-use approval consumption, and execution ledger. Include contract/spec revision and the exact selected account in approval identity.

Normalize authentication, permission, entitlement, invalid input, rate limiting, transport, protocol and cancellation failures into bounded user-readable messages. Preserve safe provider error codes and request IDs for troubleshooting; strip credentials and authorization URLs.

Only confirmed provider rejection is a definitive failed write. Timeout, truncated/unparseable response, or interrupted execution after launch is `unknown`; never automatically repeat the business action. Inspect upstream refresh/retry behavior before enabling writes. If duplicate-free behavior cannot be established, ship read-only and keep write actions undiscoverable until the blocker is resolved.

## Files and cleanup

Expected primary edits:

- `src/connectors/cli/adapters/wps365.ts`: adapter and protocol decoder.
- `src/connectors/cli/adapters/wps365Actions.ts`: curated static contracts/mapping, if needed for readability.
- `src/connectors/cli/distributions.ts`, `adapterRegistry.ts`: pinned distribution and registration.
- `src/connectors/cli/types.ts`, `process.ts`: optional trusted environment and pinned context assets.
- `src/connectors/cli/installer.ts`: exact CDN policy only if required by verified distribution availability.
- `src/connectors/china-catalog.ts`: replace three WPS definitions with one CLI definition.
- Connector search metadata and descriptions: include WPS without a new runtime branch; keep source enumeration generic.
- `docs/connectors/cli.md`, `docs/zh/connectors/cli.md`: setup, supported actions and enterprise limitations.

Remove the three old WPS catalog definitions, token setup fields, endpoint constants, and tests that assert the old integration. Replace tests of generic secret materialization with another suitable fixture instead of losing general coverage. Remove unreferenced WPS-specific icons only after checking all consumers; retain one appropriate WPS icon and attribution.

Search the full repository, including documentation and build assets, for the old IDs/endpoints. Keep references only when deliberately documenting removal. No WPS-specific migration, legacy backend or fallback logic is added. No changes to unrelated connector implementations or unrelated work in the checkout.

## Implementation stages and review gates

| Stage | Deliverable | Required self-review and acceptance |
| --- | --- | --- |
| 1. Protocol verification | Pinned distribution/spec manifest, sanitized fixtures, final action matrix | Probe the official binary in temporary isolated directories; verify noninteractive behavior, identity enforcement, spec override and retry semantics; mark unknowns explicitly |
| 2. Shared runtime support | Minimal environment/assets extension | Cross-provider regression, directory escape/symlink rejection, missing/corrupt asset rejection, cancellation; packaged asset availability |
| 3. WPS adapter | Authorization, current-user verification, curated read actions; approved write path where verified | Login failure/partial cases, tenant/user mismatch, missing grants/entitlements, correct argv and JSON/error decoding; no guessed command names |
| 4. Product replacement | Single catalog entry, generic UI/discovery, old WPS definitions removed | Chinese/English search -> describe -> execute; no source-filter false negatives; no obsolete setup/token fields; existing Feishu/WeCom behavior retained |
| 5. Acceptance and release | Build, test record, real-account read/write results | Real authorization return flow, document/calendar/mail reads, revoked/expired credentials, account isolation, one explicitly authorized test event, no automatic uncertain-write retry |

Finish each stage's review and fix its findings before moving to the next. Do not claim real-account acceptance based on mocks. If authorization is unavailable, continue all independent development/tests and report only the real-account gate as pending. The production replacement is complete only when the declared first-release capability set passes its acceptance gates; no permanent parallel MCP implementation is introduced.

Suggested checks: targeted connector/CLI/provider tests; catalog/store validation; root and Web type checks; targeted lint; full build; connector browser smoke test. Reuse existing authenticated routes, so no new lazy-route family should be necessary. If implementation introduces one, update its lazy matcher and verify the real authenticated Gateway path.

## Completion criteria

- Exactly one built-in WPS 365 connector, using source `cli`.
- Managed installation plus browser/device authorization without manually copying an Access Token.
- Connected accounts are discoverable through WPS English/Chinese queries and all-source search.
- Tested supported actions work with the selected user; unavailable permissions/entitlements have accurate guidance.
- Fixed binary/spec/contracts; credential isolation; no silent identity fallback or uncertain-write retry.
- Old WPS MCP implementation removed, generic MCP support unaffected.
- Validation report distinguishes automated coverage, binary protocol probes, and real-account results.

## Implementation record — 2026-09-20

Stages 1–4 are implemented and reviewed. Stage 5 automated checks pass; real-account acceptance is pending. The first release exposes 14 read-only actions and stays Beta. Writes remain excluded because the published upstream repository does not provide the implementation needed to establish internal retry behavior, and no real-account write test has occurred.

- Added the pinned v0.3.6 WPS adapter and four macOS/Linux distributions with SHA-256 checks. The managed macOS arm64 installation was exercised successfully.
- Added minimal trusted adapter environment constants and immutable configuration assets to the shared runtime. Self-review found a partial-file race during concurrent installation; atomic no-overwrite publication fixes it. Regression tests cover concurrent large assets, tampering, traversal, symlinks and credential preservation.
- Bundled the official selected API specs and command schemas. Native binary checks cover all 14 commands, delegated identity decoding, and refusal to acquire an application token when user credentials are absent. Fixture requests target a local HTTP server; no real business writes occur.
- Replaced the three built-in WPS MCP definitions with `wps365-workspace`. Removed unused icons and old setup fields. Generic MCP remains supported. Chinese/English discovery and the shared search/describe path are covered.
- Reused existing authorization, account, tool execution and Gateway APIs. Added no authenticated route family, database schema, credential migration or fallback implementation.

Validation completed:

| Check | Result |
| --- | --- |
| CLI/runtime/catalog/provider/store/Gateway regression | 17 files, 84 tests passed |
| Root TypeScript check | Passed |
| Targeted backend and connector UI lint | Passed; standalone `.mts` smoke script is outside ESLint configuration |
| `pnpm run build` | Passed, including declaration generation and Web TypeScript/build; bundler warnings remain |
| Packaged adapter import | 14 contracts and all packaged asset hashes verified |
| Managed official binary smoke | Download/install, all read command dry runs, identity envelope and no application fallback passed |
| Shared connector browser smoke | English desktop and Chinese mobile: authorization progress, policy, cancellation, keyboard and viewport passed |
| Old WPS IDs | Absent outside removal assertions and this design document |

The user is available to complete WPS authorization after being notified of the build. Still pending: actual two-step authorization and returned URL host, real document/calendar/mail reads, enterprise entitlement behavior, token refresh/revocation and multiple-account isolation. Automated fixtures do not establish those results. No real credentials were migrated and no user data was written during development.
