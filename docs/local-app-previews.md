# Local App preview data and isolated acceptance

The workbench uses immutable draft snapshots and short-lived host-owned preview sessions. It does
not install the app to make capabilities work. The installed release and its permissions remain
separate from these authoring sessions.

## Modes

| Mode | Data | Writes | Storage |
| --- | --- | --- | --- |
| Sample | Host examples or `.xopc/fixtures.json` | Temporary database only | Per-session memory |
| Real data, read only | Explicitly selected live notes/tasks | Production writes unavailable | Per-session memory |
| Isolated | Fresh example fixtures | Temporary database only | Fresh per session/scenario |

Default preview uses examples. Each automatic acceptance scenario receives a separate isolated
session, database, operation receipts and storage. It never inherits the visible preview's live-data
grant or state. Even a fixture with the same record ID as a production note cannot mutate that note.

Synthetic sessions execute the existing capability implementations in a host-owned child process.
The process has its own SQLite database under `local-apps/preview-runs/run-*`, a minimal environment
without provider credentials, and a bounded Node heap. Generated application source is not executed
in the worker. Note outbox dispatch is disabled; test receipts, domain events and cleanup intents
stay in the temporary database. This is an isolation boundary for host operations, not a general
sandbox for arbitrary Node programs.

Workers stop on session removal, expiry, Gateway shutdown or parent disconnect, and their temporary
directories are removed. The host limits concurrent sessions and workers. Node and Electron builds
include the worker and SQLite schema assets.

## Live read approval

Selecting real data opens a host-owned scope review. Note read and task read scopes are independent;
write scopes are rejected. No installed grant is inherited. Calls intersect the authenticated owner,
the current snapshot's declared bindings, current capability contracts and the approved resource
scope. List filtering, pagination, totals and output projections use the same production authorization
path as installed Local Apps.

The lease lasts at most 15 minutes and is bound to its caller and source hash. Stop, source changes,
revocation or Gateway restart invalidate it. The frontend also binds approval to the Gateway identity;
switching identity or observing a changed source switches back to examples. Restoring a former source
hash does not restore its approval. Running acceptance again does not renew a live grant; the user
must explicitly start another read-only session. As with installed apps, already returned data cannot
be recalled by revocation.

The iframe receives SDK initialization and results, never Gateway credentials or the host's session
authority. Its declared write capabilities are omitted entirely in read-only mode. Preview navigation,
Agent calls, production configuration and cross-extension events are unavailable. Preview notifications
do not produce host notifications. Storage requests always target the preview's own memory map.

## Fixtures

An optional `.xopc/fixtures.json` is copied into the immutable snapshot and validated before preview:

```json
{
  "schemaVersion": 1,
  "notes": [
    { "id": "sample-reading", "title": "Reading list", "markdown": "- [ ] Read an article", "tags": ["sample"] }
  ],
  "tasks": [
    { "id": "sample-plan", "title": "Plan the week", "phase": "ready" }
  ]
}
```

The file is limited to 256 KB, 50 notes and 50 tasks; IDs must be unique within each collection.
Only bounded data fields are accepted. No file references, code, selectors or network instructions
are executed. Without this file, the host supplies sample reading/review notes and planning tasks.
Do not place production credentials or sensitive data in fixtures. This metadata file is not a public
UI asset.

## Acceptance timing

The previous runner started inside its early `load` listener, before later application load listeners.
It also waited only two microtasks after actions. A deterministic regression reproduces the resulting
lost click and premature text assertion; the old code reports zero handled clicks and fails, while
the fixed code handles the click exactly once and passes after the asynchronous update.

The workbench now connects the SDK and data bridge before explicitly starting a run. The SDK asks for
initialization as soon as its transport is constructed, so a module can await `whenReady()` without
waiting for `window.load`. A legacy non-hosted preview defers execution past all load listeners.

Actions wait for an enabled, visible target and execute once. Assertions wait for their condition,
using DOM observation and host ticks, with an eight-second scenario deadline. They do not replay
clicks, rerun failed scenarios or turn timeouts into successful checks. Background animation frames
are not required. Applications should keep controls disabled until their data and handlers are ready;
if adding a load listener after an asynchronous initialization, also handle an already-complete document.

Private channel generations discard messages queued by an old port. Results carry a run ID and the
host's immutable source hash. React metadata refreshes do not restart a frame or attribute an old
result to a new draft. The injected runtime hash is included in the HTML URL to avoid reusing cached
host code across platform updates.

## Administrative APIs

These authenticated endpoints require `gateway.admin`; subsequent calls must come from the lease owner.

- `POST /api/local-app-previews/:appId/sessions` with `{sourceHash, mode, resourceScopes?, scenarioId?}`.
- `GET /api/local-app-previews/sessions/:id` returns the session and its available pinned contracts.
- `POST /api/local-app-previews/sessions/:id/requests` accepts SDK capability describe/call and storage methods only.
- `DELETE /api/local-app-previews/sessions/:id` revokes the session and stops its worker.

`resourceScopes` are accepted only for read-only previews. `scenarioId`, when supplied, must identify
a scenario from that snapshot and requires isolated mode. Preview IDs cannot be used with the installed
capability or storage APIs. Expired, revoked or changed drafts fail closed, including in-flight results.

## Verification

```sh
pnpm -C web run build
pnpm exec tsx scripts/local-app-preview-browser-smoke.mts
pnpm exec tsx scripts/local-app-release-browser-smoke.mts
```

The preview smoke builds an application using the actual UI SDK, starts a real authenticated Gateway
with disposable state, and drives Chrome. It checks sample/isolated writes, explicit live scope selection,
denied production writes, independent scenarios and storage, source invalidation, repeated asynchronous
acceptance and byte-for-byte stability of production records, receipts and outbox event identities/payloads.
Background outbox delivery timestamps and attempt counters may advance normally. It performs no model calls.

For concurrent workspace builds, build the console into a separate output directory and set
`XOPC_SMOKE_UI_ROOT` to that directory. `XOPC_SMOKE_BROWSER` overrides Chrome's executable path;
`XOPC_SMOKE_ARTIFACT_DIR` retains screenshots. [Restricted Agent delegation](./local-app-delegation.md)
is available to explicitly authorized installed apps and is excluded from all preview modes.

[Automation execution](./local-app-automations.md), including its read and run-management interfaces,
is also excluded from every preview mode. Preview code should present an unavailable state.

## Installation and acceptance

Automatic acceptance is advisory. A failed, missing or still-running acceptance result does not
block installing or updating a statically valid app. The installation review displays failed checks
or an incomplete status, and stored diagnostics remain available after installation. Package
validation, capability contract validation, artifact integrity and permission review still apply.

Development and repair actions return to the app's persisted development conversation. Legacy
workbench apps recover an unambiguous first-build handoff; unrelated Coder chats in the project are
never used as a fallback. If no developer can be identified, the host creates a dedicated conversation.

When preview workers are exhausted, the host reclaims the caller's idle workers and the UI retries
allocation a bounded number of times. Acceptance workers are released as soon as a run ends. Host
resource failures offer a preview retry rather than a request to modify generated app code.
