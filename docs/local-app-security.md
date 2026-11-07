# Local App data access and runtime boundaries

Local Apps run generated UI in an opaque-origin iframe. The host retains Gateway credentials and
executes declared operations through the existing CapabilityDispatcher. This boundary applies to
installed application code; it does not add a process sandbox to the coding agent used to build it.

## Resource grants

The user reviews both the release's action permissions and its data scopes. Data access defaults to
`none`, including for previously saved action-only Local App grants. Three independent policies are
stored by the host:

- `notesRead`: notes the app may list or read.
- `notesWrite`: notes the app may change, append to, or create.
- `tasksRead`: tasks the app may list or read.

Each policy is `none`, `workspace`, or `selected`. A selected policy contains explicit record IDs,
project IDs, and optionally `includeCreated` for notes created by this app. Project authorization
includes current and future members of that project. A selected create policy permits creation in
the approved projects, or unassigned creation when `includeCreated` is enabled. Ownership is recorded
in the same SQLite transaction as note creation and the operation receipt. Other apps cannot claim it.

List restrictions are applied in SQL before search results, totals, offsets and pagination. Direct
reads and writes check the same resource policy. Writes recheck immediately before execution or
receipt replay, and results are withheld if access changes while an operation is in flight. Already
returned data cannot be recalled by revocation. Approved note changes can return the changed note's
content; a write grant therefore authorizes that result, even without a separate list/read grant.

Local Apps receive narrow note and task projections. Note provenance, attachments, AI metadata and
project associations are omitted. Task contracts, related tasks, sessions, execution history,
authority grants and context are omitted. The extension-specific output contract has its own pinned
descriptor digest; ordinary HTTP and Agent business capabilities retain their existing output.

## Grant lifecycle

Every grant or scope replacement creates a fresh `grantRevision`. The iframe retains the revision
it was authorized with; it cannot adopt a newer revision without a fresh host registration. Both
the revision and release digest are required by the Local App HTTP invocation API. Agent invocation
through `xopc_use mode=local_app command=invoke` must also supply the discovered revision.

Revoke, disable, uninstall and release activation invalidate old grants. Rollback does not resurrect
an old grant. Permission management is available in the installed app's workbench. The regular
permission dialog also includes resource selection; no homepage redesign is involved.

Write retry identity is stable across app releases for the same caller, app and idempotency key.
Existing receipt validation rejects changes in input or contract, rather than silently issuing a
second write. After an uncertain outcome, retain the original key; a contract conflict requires
reconciliation rather than a new key.

## Runtime and asset restrictions

- Local App frames allow scripts only; forms, popups and same-origin access remain disabled.
- CSP blocks direct connections, nested frames and form submissions. The embedding shell restricts
  frame navigation to its own origin. Do not loosen either policy independently.
- Bridge methods without an explicit permission policy are denied. Local Apps cannot send or receive
  cross-extension events. The bridge bounds message size, concurrency and request rate.
- Storage requests carry the pinned release and grant revision and are checked on the server.
  Local App storage is limited to 5 MB, with request bodies limited to approximately 1 MB.
- Installed resources are served from the immutable release, using a host-recorded public inventory
  with content hashes. Only non-hidden supported UI files in the public directory are inventoried.
  Package manifests, runtime entries, briefs and source maps are not public assets. Real-path checks
  reject symbolic-link escapes; changed or unlisted files are not served.
- Preview URLs expose UI assets only and confer no production capability or storage authorization.

Resource policies, ownership and inventory use existing SQLite durable-state namespaces, avoiding an
unnecessary database-version change. Existing installation data and the upgrade chain are retained.
Grant history is kept separately from the current policy. Access audit retains up to 1,000 recent
events per app, with an administrative API returning the latest 100. It records operation identity
and outcome, not note content, query text, credentials or returned results.

## Host APIs

All endpoints below require authentication and go through the lazy route registry. Grant management,
resource selection and audit endpoints require the existing `gateway.admin` route scope. Invocation
additionally intersects the authenticated caller's scopes with the app's release and resource grants.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/local-app-capabilities/catalog` | Discover public extension contracts before authoring a manifest |
| `GET /api/local-app-capabilities/:extensionId?manifestDigest=…&grantRevision=…` | Inspect the exact installed bindings |
| `POST /api/local-app-capabilities/:extensionId/:id/invocations` | Invoke a pinned capability using `{manifestDigest, grantRevision, call}` |
| `GET /api/extensions/:id/ui-grant` | Read authoritative action permissions and current resource grant |
| `POST /api/extensions/:id/ui-grant` | Explicitly approve or replace `{manifestDigest, resourceScopes}` |
| `DELETE /api/extensions/:id/ui-grant` | Revoke using `{manifestDigest}` |
| `GET /api/extensions/:id/resource-options?kind=notes\|tasks\|projects&search=…` | Host-owned resource selection, up to 100 results |
| `GET /api/extensions/:id/access-audit` | Inspect recent access outcomes |

Generated app code uses `@xopcai/extension-ui-sdk` capability methods; it must not call these HTTP
endpoints or carry credentials or grants itself. Build-time contract discovery must use the extension
catalog, not the broader HTTP operation descriptor. Apps with old pinned output contracts must
refresh their bindings and pass validation before the next release.

An app can request `client.ui.reviewPermissions()` to open the host-owned permission review.
The host derives identity from the registered frame. Opening the review grants nothing, including
when the previous grant has been revoked. The running frame retains its original authority during
review; explicit confirmation replaces the frame before applying the new grant. Application input
cannot supply a manifest identity, resource grant or grant revision through this method.

## Verification

Run the Local App and capability regression tests, then build the console and execute:

```sh
pnpm -C web run build
pnpm exec tsx scripts/local-app-release-browser-smoke.mts
```

The smoke test starts a real authenticated Gateway with a disposable state directory and uses an
actual Chrome browser. It exercises scoped queries and writes, ownership, narrow outputs, grant
revocation/replacement, protected storage, resource integrity, navigation/network/popup isolation,
and the install/update/restart/disable/rollback/uninstall lifecycle. It requires Chrome at the
default macOS path or `XOPC_SMOKE_BROWSER`. It makes no model calls. Screenshots can be retained with
`XOPC_SMOKE_ARTIFACT_DIR`.

Preview data, independent read-only grants and isolated write acceptance are described in
[Local App previews](./local-app-previews.md). Restricted text-only Agent delegation, its explicit consent
and provider budgets are described in [Local App delegation](./local-app-delegation.md).
