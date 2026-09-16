# Computer Use quality delivery

## Scope and gates

This work improves the existing ComputerRuntime, broker and hosted-model adapters.
It does not introduce a second agent framework, credential store, unrestricted
desktop route or automatic provider fallback. Existing mobile changes are unrelated.

1. Evaluation: repeatable task/result contracts, independent outcome gates and
   regression fixtures. Missing runs and unknown outcomes must not count as success.
2. Task execution: bounded in-memory history, explicit expectations, post-action
   verification, no-progress detection, and safe pre-dispatch recovery. Preserve
   approvals, cancellation and receipts; never replay an uncertain input.
3. Model and tool cooperation: complete structured proposal semantics, model
   capability reporting, explicit desktop lease handoff and task budget visibility.
4. Delivery: targeted tests, self-review, production bundle checks and a documented
   real-application acceptance matrix. Real account actions, paid model comparisons,
   production quota changes and new platform certification require separate evidence.

## Acceptance evidence

Do not confuse deterministic fixtures with real-app/model measurements. Real-app
certification requires 60 distinct tasks, three runs each, fixed initial states,
model/deployment identifiers and independent outcome assertions. The proposed beta
gate is >=90% first-attempt task success, with no observed false success, duplicate
submission, scope violation or post-stop input. Report coverage and failures, not
only the successful subset. A zero incident count is not a universal safety guarantee.

## Progress

- Evaluation infrastructure: implemented. Fixed-plan schemas, missing-run accounting,
  independent-outcome requirements, cost/latency metrics, and an executable report
  grader. The separate 60-task acceptance specification is not an executed benchmark.
- Task execution: implemented. Six-entry text history, caller-specified native
  predicates, post-input verification, no-progress detection, and at most one fresh
  prediction after a positively acknowledged non-dispatch. Unknown dispatch is
  never replayed; pending approval retains the original goal and predicate.
- Model/tool cooperation: implemented. Full structured decision union; explicit
  confirmed-release handoff with bounded action facts; local budgets and managed
  service ceilings. No new keys, implicit provider changes, quota upgrades or
  alternate desktop control routes.
- Production verification: source types, targeted regressions, Electron
  main/preload/Gateway builds, platform model-gateway build, and isolated built
  Gateway authentication/upload smoke passed. No signed installer or other-machine
  native acceptance was performed in this delivery.
- Hosted-model quality gate: **not passed**. See the retained measurements below.
- Real-app beta gate: **not run**. Requires dedicated application accounts/fixtures,
  an approved model comparison budget and independent application-state oracles.

## Self-review changes

1. Evaluation: missing runs remain in the denominator; model claims, human takeover
   and fixture-only evidence cannot count as autonomous production certification.
2. Runtime: recover only for `ready` + `COMPUTER_OBSERVATION_CHANGED` + no receipt;
   return `condition_satisfied` for exact field/selected-state predicates, not
   whole-task success or merely pre-existing navigation text. Preserve original approved
   conditions and clear in-memory history on close.
3. Handoff: retain the other-tool gate if release times out/fails. Accept a matching
   stopped reply or explicit absent-session response, not an assumed local stop.
   The clarification cancellation path now returns the same confirmed-close result.
4. Model/platform: limit output by service/model/runtime ceilings, never report a
   policy as remaining credits. Generic model control accepts only the current
   structured proposal schema. GUI-Plus retains strict JSON/action validation.
5. HTTP tests: the early-rejection auth/grant cases use a small body to avoid
   HTTP/1 socket-reset races while the server rejects an unread multi-megabyte
   body. Separate authenticated real-PNG and chunked-size tests retain large-body
   coverage. Static built-in manuals remain available during a desktop lease;
   browser, shell, files and raw MCP remain blocked until confirmed release.

Final local verification: xopc 187 regression tests passed (9 opt-in hosted cases
skipped in this run); platform 88 tests passed. Both TypeScript checks, Electron
main/preload/Gateway builds, platform model-gateway build and the isolated built
Gateway compatibility/upload test passed. `git diff --check` passed in both repos.
The separate opt-in hosted run below failed and remains a delivery gate failure.

## Hosted measurements, 2026-09-17

All requests used generated 800x600 images of one blue Continue button, Beijing
`gui-plus-2026-02-26`, non-thinking mode, and the existing test credential. No native
input or personal screenshot was used. These are grounding/format smoke tests,
not task-success or model-comparison benchmarks.

| Experiment | Result |
| --- | --- |
| Initial three positions, text first | 2/3 passed; top-left failed JSON validation even after one correction |
| Diagnostic repeat of top-left | Both responses omitted the opening coordinate bracket |
| Flat prompt signature, text first | 2/3 passed; same case failed |
| Top-left, image first, temperature 0 | 1/1 passed |
| Top-left, text first, temperature 0.2 | 0/1 passed |
| Top-left, image first, temperature 0.2 | 0/1 passed |
| Final flat signature + image first + temperature 0, three positions × three runs | 8/9 passed; center run 0 failed JSON validation |

The final adapter uses a flat action signature and image-first layout, following
the shape of the [vendor integration example](https://help.aliyun.com/en/model-studio/gui-automation)
while advertising only xopc-supported actions. It retains temperature 0 and the
strict discriminated parser; malformed coordinates are never repaired into input.
The measurements do not establish that this prompt/layout fixes format reliability.
Do not mark the hosted gate green or silently replace the configured model. A
larger fixed benchmark and an explicitly approved alternative hosted candidate
are needed before selecting a production-quality default.

## Window/action regression audit, 2026-09-17

- Hidden multi-surface apps: `prepare:true` can activate the authorized app before
  re-enumeration and exact-window binding. No app activation during unprepared
  observation. Failed/degraded window probes remain unknown candidates, not
  silently excluded windows; native visibility/stacking resolves only when possible.
- Model validation: bounded failure reasons replace opaque parse errors. GUI typing
  requires a grounded coordinate, zero scrolling and empty answers are rejected,
  and converted actions pass the same strict validator. One format correction
  includes the previous invalid reply as ephemeral feedback to the same recipient.
  No coordinate repair, provider fallback, or replay after dispatch.
- Other execution defects: web text fields use their validated screenshot point
  to establish renderer focus; native fields retain token-bound writes. Enter,
  Esc and arrow aliases map to native keys; Shift+Tab is no longer incorrectly
  blocked as an app-switch shortcut. Right/double clicks, wheel direction and
  bounded wait retain their existing native action semantics.
- Evidence: large accessibility summaries preserve whole JSON records. Clipped
  trees and web AXValue-only writes cannot establish exact field success. A
  pre-existing text match neither skips the requested action nor proves its
  effect. `expect:{kind:"selected",label:"Memories"}` requires native selected
  state instead of inferring navigation from its label.

Validation evidence (not real-app certification):

- 188 targeted tests passed; nine opt-in live cases were skipped in the unit run.
  Core TypeScript and lint checks passed. Node, Electron main/preload and embedded
  Gateway builds passed, followed by authenticated built-artifact preflight and
  screenshot-upload admission checks. The first preflight encountered stale v178
  generated assets beside the worktree's v179 sources; rebuilding Node assets
  before the embedded Gateway resolved it without editing unrelated migrations.
- Native Electron harness passed against a disposable Swift fixture: discovery,
  read-only enforcement and native field write/read-back. No personal app operated.
- xopc Cloud synthetic Continue observation/click smoke passed in three model
  requests. The expanded synthetic navigation and double-click predictions failed
  JSON validation; HTTP 429 then blocked the rest of the matrix. A navigation
  retry after adding feedback also failed on the larger multi-control image.
- A separate direct Alibaba protocol comparison, using the existing test key and
  at most two requests, reproduced a missing `[` in the initial coordinate JSON.
  The second request with the failed reply as feedback returned valid coordinates
  inside the synthetic Memories button. No native action was executed.

The hosted-quality gate remains **not passed**: one repaired example is not a
reliability benchmark, and cloud rate limiting prevented full live action coverage.
The user's other-machine Today window scenario still needs native acceptance
after rebuilding Electron; deterministic window fixtures are not that evidence.

## Managed screenshot admission fix, 2026-09-17

The managed `observe(question)` failure was reproduced against
`xopc-cloud/computer-gui-plus-preview` using a valid, generated 800x600 PNG.
The service returned HTTP 400 / `max_input_tokens_exceeded` (request ID
`ffcbf333-f4f5-47b8-ae21-bc1af5f68358`). Base64 request bytes were incorrectly
included in the text-token estimate. A 5,385-byte encoding of the same fixture
passed, confirming the encoding-size-dependent admission failure.

The platform now budgets GUI-Plus image patches from validated dimensions,
with the documented per-image ceiling, and retains text/schema estimates and
the existing byte/pixel limits. Actual upstream usage still settles billing.
The client retains HTTP status, allowlisted service codes and validated request
IDs without exposing raw provider messages. Runtime tests verify that model
rejections clear frames, close the session, never dispatch and never auto-retry.

A local real-HTTP gateway with an in-memory database sent a 1.4 MB synthetic PNG
through the actual Alibaba adapter. The initial read-only prompt produced bare
JSON without protocol tags; adding the explicit answer-only function signature
passed, both locally and on the staged deployment baseline. The production
parser remains strict; malformed coordinates or answers are not repaired.

With explicit deployment authorization, only the model-gateway service was
updated. Backup: `/var/www/xopc-computer-deployments/computer-20260917052912590`.
No database, nginx, other service, npm or mobile publication was changed.
The staged baseline passed 209 tests and its typecheck/build. The local platform
branch passed 219 tests; xopc passed 94 related tests and its typecheck.

Post-deployment managed verification used a 1,923,767-byte PNG and passed visual
observation plus grounded button prediction in three model requests (including
the permitted format correction). Missing deployment pins still returned 409.
No personal desktop was captured and no native input was executed. This validates
the repaired model-service path, not overall task reliability; the earlier 8/9
grounding benchmark and its remaining format failure are not superseded.
