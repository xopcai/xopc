# Local Apps: projects, tasks, connectors and files

Local Apps use pinned capability contracts and explicit, revocable resource grants. New fields default to denied, including for existing installations. These features do not add a bundled application or change the main product layout.

## Projects and tasks

Applications can list/read approved projects, milestones and progress updates, edit project metadata, and create/edit milestones and progress records. Selected-project restrictions apply in SQL before counts and pagination. Project instructions, host workspace configuration, Agent configuration and linked sessions are excluded from app output. Project creation, deletion and workspace reassignment are unavailable.

Applications can capture tasks into backlog and edit approved task titles, bodies, priorities and due dates using the expected version. Capture does not start an Agent run. Execution contracts, dependencies, delegation, task activation and project reassignment are unavailable. The user can separately allow records created by this app; ownership is persisted atomically with task creation. Read and write grants are independent.

## External connectors

Only installed CLI and Composio tools with host-curated read/write classifications can be granted. Each grant pins the operation, exact account, current connection ID and contract revision. Reconnecting an account or changing a tool contract requires another permission review. Administrative actions, arbitrary tool providers, URLs, credentials and host connector controls are excluded.

`xopc.connectors.describe` returns an approved contract; `xopc.connectors.read` executes an approved read. Reads are limited to 60 per minute per app. Calls have a 30-second deadline, at most four active calls per app and sixteen across the Gateway. Revocation and caller-session validity are checked during execution and before releasing results. Underlying connector policies remain active. Reads requiring confirmation become host-review requests.

`xopc.connectors.propose_write` stages the exact account and full arguments without executing them. The SDK's `client.requests.review(id)` opens the host-owned review dialog. Only an authenticated host decision can execute the staged request. Review decisions are claimed atomically after connector preflight: a rejection that wins preflight cannot be overwritten, and an accepted approval cannot later be rejected. App receipts bind the application and request ID independently of the reviewing browser/device, with the original reviewer recorded separately. Both app and provider receipts prevent repeated or concurrent approval from repeating an external write, including receipt recovery under another host identity. Uncertain outcomes remain `unknown`, with a stable operation ID for investigation; they are never automatically resubmitted with a new key. `xopc.apps.get_request` reads only this app's requests and revalidates authority before returning external results.

Requests expire after fifteen minutes, with at most fifty retained requests per app. Connector results are bounded to 512 KiB. Applications never receive Gateway tokens, provider approval tokens, or connector secrets.

## Files and attachments

`xopc.files.read` accepts only individually selected opaque file IDs in registered workspace/project/session spaces. Arbitrary host spaces, hidden paths, symbolic links, hard-linked files and files larger than 512 KiB are denied. The selected canonical path and every path component are revalidated before opening, after opening and after reading, rejecting symbolic-link replacements of both files and directories. File identity is checked around opening and reading; output contains bytes, display metadata and SHA-256, without absolute paths or credential-bearing URLs. UTF-8 and base64 are supported.

`client.files.pickAttachment()` opens a host-owned file chooser only with a separate import grant. The user must choose an attachment for each request. Selection returns its name, MIME type, size and base64 content, without a host path. Authority is checked before opening and before delivering bytes. Cancellation, timeout, iframe removal and revocation end the request. The size limit is 512 KiB.

`xopc.files.propose_export` stages immutable content and a safe filename. Host approval triggers a browser download. It never creates or overwrites a Gateway file. Reopening an approved export allows the host to explicitly save it again. Export requires a separate grant.

## Preview boundary

Project/task preview uses synthetic records in the existing isolated preview database. Real read-only preview supports explicitly selected project metadata, milestones and progress updates as well as existing note/task reads, and blocks writes. Isolated-write preview never changes the installed workspace. External connectors, host file access, attachment selection and exports are excluded from previews.

## Validation

Run the scoped unit/security checks and build the Web UI, then run:

```sh
XOPC_SMOKE_UI_ROOT=/tmp/xopc-p1-ui XOPC_SMOKE_BROWSER='/absolute/path/to/chrome' pnpm exec tsx scripts/local-app-p1-browser-smoke.mts
```

The smoke test creates a disposable state directory, authenticated real Gateway, temporary app, real CLI subprocess and real Chrome. No live external account or paid model is required. It verifies project/task writes, selected file access, attachment import, browser export, connector write review, concurrent cross-browser approval, conflicting review decisions, file replacement, project read-only preview, idempotency and revocation. Temporary fixtures are not shipped as application features.
