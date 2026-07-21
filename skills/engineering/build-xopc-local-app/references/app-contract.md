# Phase 1 local app contract

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

## Acceptance scenarios

Use at most 10 scenarios and 20 steps per scenario. Targets are exact `data-xopc-test-id` values
using letters, numbers, dashes, or underscores. Supported steps are:

- `{ "action": "click", "target": "save-button" }`
- `{ "action": "fill", "target": "title-input", "value": "Read later" }`
- `{ "assert": "text_visible", "text": "Read later" }`
- `{ "assert": "element_exists", "target": "reading-list" }`
- `{ "assert": "value_equals", "target": "title-input", "value": "" }`

Do not use selectors, scripts, timing commands, network calls, or host APIs. The workbench runs these
scenarios in an isolated preview and requires them to pass before installation.
