# Local App contract

## Host capability bindings

UI-only apps may use declared host capabilities through `@xopcai/extension-ui-sdk`; this does not
authorize direct HTTP, network access or backend code. Discover bindings through the authenticated
`GET /api/local-app-capabilities/catalog`, pin each capability's version and descriptor digest in
`ui.capabilities`, and let the host handle user review and execution. The extension output contract
differs from the full HTTP/Agent business contract. Never manufacture grants, use Gateway tokens in
app code, or silently enlarge permissions.

Data access defaults to none. Explain the smallest useful note-read, note-write and task-read scopes
to the user. They select resources in the host permission dialog. App-created ownership is recorded
by the host; names, tags and app-supplied IDs cannot claim ownership. Handle denied access explicitly.
The default draft preview uses example data; `.xopc/fixtures.json` can provide bounded note/task examples.
Only the user can start a scoped real-data read-only preview. Automatic acceptance always uses fresh
isolated fixtures, receipts and storage, never that live-data grant. Do not fake a successful acceptance
or request production writes from an automated preview. Use the SDK capability methods in all modes.
Keep controls disabled until their data and event handlers are ready. Await `client.whenReady()` for
SDK initialization, and handle an already-complete document when adding load handlers after async work.

Installed apps may declare `xopc.agent.delegate` for one bounded text inference after the user separately
approves delegation in the host permission dialog. Use explicit instruction/context and at most three
approved notes/tasks `get` references; each referenced read capability must also be declared. There are
no tools, history, memory, filesystem, Agent/model selection or automatic writes. All preview modes
omit this capability: show a clear unavailable state and use example content for presentation checks.
Keep a stable idempotency key for each delegation intent; never automatically retry an uncertain outcome
with a new key. See `docs/local-app-delegation.md` for budgets and the SDK contract.

Only supported non-hidden files beneath the public UI directory can be served. Keep secrets, manifests,
briefs and runtime files outside that directory. For details see `docs/local-app-security.md` in xopc.

Required files:

- `.xopc/app.json`: `schemaVersion`, immutable `extensionId`, `capabilityLevel: "ui"`, and entrypoint.
- `.xopc/acceptance.json`: declarative critical user journeys. Older apps may omit it.
- `xopc.extension.json`: matching `id`, xopc-owned `main`, `ui.main`, and one navigation page.
- `.xopc/runtime/local-ui.js`: immutable xopc-owned runtime entry; generated app code must stay in `ui/`.
- `ui/index.html`: sandbox entrypoint with only local asset references.

Before marking a draft ready:

- Manifest and app metadata ids match.
- Runtime `main` remains `.xopc/runtime/local-ui.js` and its contents are unchanged.
- Declared files exist and remain inside the Project.
- Navigation path stays `/extensions/<extension-id>`.
- No remote scripts, stylesheets, images, frames, or fetch calls were introduced.
- UI remains usable at narrow desktop widths, with keyboard navigation and both color schemes.
- The user-facing acceptance checks pass in preview.

## Sandbox interactions and storage

The host uses `sandbox="allow-scripts"`, without `allow-forms` or `allow-same-origin`.
A submit button is blocked before the form's submit handler runs. Use `type="button"`, bind its click
handler, and handle Enter explicitly on the input. Preserve labels and keyboard access.
Browser origin storage is unavailable: use `createExtensionClient()` from the UI SDK, bundle it into
`ui/`, await `client.whenReady()`, then call `client.storage.get/set/remove`. These methods use
lease-isolated storage in previews and host-owned extension storage after installation. Catch and
surface storage failures. Do not relax the sandbox or use network requests to work around it.

## Acceptance scenarios

Use at most 10 scenarios and 20 steps per scenario. Targets are exact `data-xopc-test-id` values
using letters, numbers, dashes, or underscores. Supported steps are:

- `{ "action": "click", "target": "save-button" }`
- `{ "action": "fill", "target": "title-input", "value": "Read later" }`
- `{ "assert": "text_visible", "text": "Read later" }`
- `{ "assert": "element_exists", "target": "reading-list" }`
- `{ "assert": "value_equals", "target": "title-input", "value": "" }`

Do not use selectors, scripts, timing commands, network calls, or host APIs. The workbench runs these
scenarios in an isolated preview. Failed or incomplete acceptance remains visible as advisory feedback;
users can still install a statically valid draft.
