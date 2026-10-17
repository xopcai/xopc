# Verified flows: real TextEdit validation

For the additional real hosted GUI-Plus matrix, see [hosted model validation](./computer-use-verified-flows-hosted-validation.md). The original deterministic run below remains a separate baseline.

Validated on 2026-10-17, macOS 26.6.2, Electron 42.4.1 and pinned Cua Driver 0.28.2. The application is the real macOS TextEdit (`com.apple.TextEdit`), not a synthetic GUI fixture. Only its English Settings window and the **New Document / Open and Save** navigation tabs are used. No document, preference value, clipboard or personal credential is modified. Successful phases restore New Document.

[Committed metadata-only evidence](./evidence/computer-use-flows-2026-10-17.json) contains the actual process IDs, access checks, native dispatch counts and uncertain-delivery results. Screenshots and AX window text are not written to those results.

## What ran

`scripts/run-computer-flow-validation.mts` builds the Electron harness, creates a private temporary state directory and launches **three separate Electron OS processes** sequentially. Each uses a new conversation and the same isolated SQLite database, Agent/workspace and synthetic desktop endpoint identity. SQLite, normal Agent/model resolution, ComputerRuntime, DesktopEndpointHost, ComputerBroker, ComputerAccessPolicy and CuaComputerDriver are the actual implementations.

The host's existing `approve` implementation is instrumented only to count checks; it is never replaced with an always-approve fixture. Each phase explicitly removes TextEdit access through the ordinary local host settings method and verifies `COMPUTER_APP_NOT_AUTHORIZED`, with zero observation/model/input calls. Only then does the test owner grant TextEdit access in this isolated policy store. Session and exact-action checks still run. The visible test host window uses accessory presentation to avoid stealing focus from the application under inspection; visibility and local access checks remain unchanged. No OS permissions or the user's real desktop access policy are changed.

The endpoint registry/transport is a local harness bridge that passes validated commands to the real Broker and transfers frames by invocation ID. It does not exercise Gateway HTTP/WebSocket enrollment/authentication. A deterministic in-process structured planner receives the current observation through the normal model adapter and returns the **current** native tab reference. All fetch URLs except its synthetic `.invalid` model URL are rejected. This retains fresh inference-request accounting and model protocol checks without sending pixels to a hosted service; it is not an LLM quality benchmark.

| Phase | OS PID | Real scenario inputs | Model requests | Requests with saved hints | Denied without app access | Result |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Capture | 10384 | 1 | 1 | 0 | yes | Native page content verified; close released control and saved one flow |
| Reuse | 42793 | 1 | 1 | 1 | yes | Same flow UUID loaded after process exit; new authorized native activation and verification |
| Unknown reply | 75292 | 1 | 1 | 1 | yes | Native activation happened; its reply was deliberately lost; no replay or rescue |

Capture saves only after the real post-action AX text contains **HTML Saving Options**, a page-specific heading. The two navigation control labels themselves cannot qualify as evidence. The flow is read again in later processes and its UUID is compared with the original. Every phase has an independent local session check and one scenario action check. Each additionally performs one separate authorized **New Document** cleanup activation after the scenario assertions; those inputs are reported separately and do not replay the failed Open and Save action.

The uncertain phase drops the RPC reply **after** the native input completes and the real application effect is independently observed by the harness. That observation is withheld from Runtime. Runtime records `failure.dispatch: unknown`, `unknownDispatches: 1`, `rescueAttempts: 0`, and `releaseStatus: released`. There are **zero act requests after loss**, exactly one scenario native input and one model request. Saving that failed session is refused and the original flow remains the only stored record. Cleanup starts a fresh authorized lease with a different explicit goal only after these assertions.

## Completeness finding and correction

The pinned macOS driver's [source](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/libs/cua-driver/rust/crates/platform-macos/src/tools/get_window_state.rs#L549-L553) deliberately reports `elements_complete = false`: projected actionable nodes and fallible AX child reads cannot prove full traversal coverage. Raising traversal limits cannot establish the missing proof. The earlier selected-only flow admission therefore could not save a real macOS flow with this backend.

The correction keeps this unknown coverage intact. A flow may now retain **positively observed native targets and page-specific text evidence**, with `coverage: partial`; it remains untrusted planning data. This uses the existing positive text-verification path. It does not upgrade selected-state evidence, prove absence/global label uniqueness, enable coordinate grounding from incomplete trees, authorize an action, or grade business success. Selected conditions still require complete coverage. Text must be short/non-sensitive, at least eight characters, visible after input, not already observed before input, and not a bare/actionable control label. Unsupported actions, missing evidence, uncertain receipts and failed release still prevent saving.

During preflight, unavailable screenshots and refused foreground preparation correctly stopped without input retry. The final passing run required an already-visible Settings window and used `prepare: false`; no foreground-refusal fallback was added. These OS-dependent failures are not hidden by the runner, which never automatically repeats a phase.

## Reproduce

Use a macOS desktop with the existing Electron Accessibility and Screen Recording permissions. Open TextEdit → Settings and select **New Document**. Keep this window visible, dismiss menus/sheets and avoid interacting with it during the check. The test refuses other windows, unexpected controls, languages and input kinds.

```sh
pnpm run computer:driver:setup
pnpm exec tsx scripts/run-computer-flow-validation.mts
```

The runner prints its private evidence directory. `capture-result.json`, `reuse-result.json` and `unknown-result.json` are mode 0600. Flow data and its test-only access policy remain isolated there for inspection. All phases release/dispose their Brokers and close their own host windows. The TextEdit Settings window remains open on New Document; close it normally after inspection. A failed phase stops the matrix and leaves the application state for inspection rather than automatically applying cleanup or replaying input.

Automated regression checks cover partial positive evidence, retained strict selected-state rules, bare/preexisting text rejection, privacy, restart persistence, local access policy, fresh refs, budgets and non-replay. This one-application check does not certify unattended use, universal application compatibility, hosted-model quality or full network transport recovery.
