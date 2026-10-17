# Native semantic actions: live validation

Validated on 2026-10-17 with macOS 26.6.2, Electron 42.4.1 and the pinned Cua Driver 0.28.2. These checks cover native controls and one real application; they are not a general application compatibility benchmark.

## Native fixture

`scripts/verify-computer-native.mts` verified application discovery, read-only enforcement, native field value entry and `activate` on the disposable Swift fixture's Continue button. The fixture's own status changed to `PASS: Continue clicked`. The snapshot was marked incomplete, so automatic coordinate grounding correctly retained the original coordinate action; the explicit observed element reference remained usable. The fixture clears initial field focus to avoid a blinking caret invalidating the screenshot freshness check.

## TextEdit context menu

`scripts/verify-computer-context-menu.mts` ran against a disposable, already-open plain-text document in the real macOS TextEdit application (`com.apple.TextEdit`). Before any content capture, the harness checked the selected window title against the unique scratch filename. The file's exact synthetic contents were also checked. The test used the ordinary Broker, action authorization, observation comparison, native token dispatch and receipt path, with no model inference or coordinate fallback.

The native `AXTextArea` advertised `AXShowMenu`. Its fresh public reference was passed to `showMenu`. The post-action observation contained a new `AXMenu` directly under that same text area and eight direct `AXMenuItem` children. The bound window and process identity were unchanged. A screenshot of only the scratch document was visually inspected and showed the standard TextEdit context menu. Application menu-bar roots remained excluded from the public observation.

The test also confirmed that replaying the same action returned the same receipt without another native menu dispatch. The receipt retained `outcome: unknown`; observed menu evidence, rather than the acknowledgement, established the result. A separate, authorized Escape action dismissed the menu, and the next observation confirmed its absence. The document's file contents were unchanged. Private driver processes exited at the end of the test.

Result:

```json
{"status":"passed","app":"com.apple.TextEdit","windowBound":true,"nativeContextMenuVerified":true,"nativeMenuItems":8,"receiptReplayDeduplicated":true,"menuDismissalVerified":true,"documentUnchanged":true,"modelInference":false}
```

## Reproduce the TextEdit check

Use a macOS desktop with the native Electron host permissions already granted. Keep the scratch document visible, dismiss any preexisting context menu, and avoid interacting with its window during the check. The harness refuses a different selected document and does not retry refused or uncertain input.

From the repository root:

```sh
pnpm run computer:driver:setup
menu_run_dir="$(mktemp -d)"
menu_scratch="$menu_run_dir/xopc-context-menu-$(uuidgen | tr '[:upper:]' '[:lower:]').txt"
printf 'XOPC native context menu validation. Disposable text only.\n' > "$menu_scratch"
open -a TextEdit "$menu_scratch"

pnpm exec esbuild scripts/verify-computer-context-menu.mts \
  --bundle --platform=node --format=esm \
  --external:electron --external:@trycua/cua-driver \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
  --outfile=.cache/verify-computer-context-menu.mjs

env -u ELECTRON_RUN_AS_NODE pnpm exec electron \
  .cache/verify-computer-context-menu.mjs \
  "$PWD/.cache/computer-driver/0.28.2/cua-driver" "$menu_scratch" \
  "$PWD/.cache/textedit-context-menu.png"
```

The screenshot argument is optional. The harness closes its Broker and driver but leaves TextEdit and the unchanged scratch document open; close that document and remove its temporary directory after validation. No personal documents, clipboard contents or model credentials are needed.

## Automated checks

The related Computer, Endpoint and agent-tool suites cover unsupported actions, stale or duplicate references, cross-window dispatch, disabled and sensitive targets, read-only enforcement, exact action authorization, receipt deduplication and the absence of coordinate retries. A window-scoping regression specifically preserves a context menu under its owning text area while excluding application menu-bar siblings. The Electron Computer tests are registered as the `computer-desktop` Vitest project.
