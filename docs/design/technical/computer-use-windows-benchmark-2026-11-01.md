# Windows Computer Use audit and benchmark, 2026-11-01

Follow-up: [field verification and latency fixes, complete 48-run validation](computer-windows-field-latency-fix-2026-11-01.md).
The findings and original evidence below describe the earlier source version.

The Windows input fix now has a repeatable native regression matrix. The frozen
smoke completed all 16 planned runs: WinForms 8/8 and WPF 8/8. The deterministic
regression export passed 653 tests across 43 files. Both runners made zero model
requests. Neither result certifies model planning or production reliability.

See [runner instructions](../../../scripts/computer-benchmark/README.md) and the
[retained structured result](evidence/computer-windows-benchmark-2026-11-01.json).
The raw per-action receipts and application oracle snapshots remain in the ignored
run directories named in that result. No personal app was used for this matrix.

## Findings

| Priority | Finding | Evidence and confidence | Next validation/change |
| --- | --- | --- | --- |
| P1 | Exact field and selected-state expectations cannot currently succeed on Windows observations | Confirmed by code: `normalizeWindowsAccessibility` always marks coverage partial; `verifyComputerExpectation` refuses field/selected checks on partial trees. Both real native field probes returned `unavailable` after independently correct writes. | Add a condition grounded in an exact current certified native target, with explicit scope. Preserve the refusal to infer label uniqueness from an incomplete tree. |
| P2 | Native action latency is dominated by observation/identity checking | Confirmed on this machine: 18 completed actions had median total Broker action time 5,031 ms, while median underlying SDK call time was 12.93 ms. One WinForms End action spent 1,872 ms in precheck, 517 ms in input, and 2,751 ms in post-observation; SDK time was 12.20 ms. | Profile repeated PowerShell identity/UIA reads and capture/stability sampling separately. Retain target and freshness checks while testing an equivalent faster implementation. |
| P2 | Background keyboard/focus handling and WPF clicks need repeated, controlled investigation | Observed in the original development trial: WinForms rejected Backspace with `COMPUTER_WINDOWS_KEY_TARGET_REQUIRED` after End completed; a WPF editor click returned unknown delivery. The later frozen smoke passed both keyboard tasks. Trigger and frequency remain unestablished. | Run the unchanged full matrix with multiple repetitions and deliberate foreground/background conditions. Preserve unknown delivery and stop subsequent input. Do not interpret the later pass as eliminating the original incident. |
| P2 | Cold window readiness has a fixed five-second shared deadline | Local history contains one `COMPUTER_WINDOW_READY_TIMEOUT` followed by a successful fresh user-requested open. `withWindowReadiness` shares five seconds across launch/restore/metadata/capture. One event establishes a failure, not that five seconds is generally wrong. | Add delayed-window and tray-restore fixtures with measured launch versus capture time before changing the deadline. |
| P2 | UI-program argument errors may have misleading diagnostics | Local history contains `COMPUTER_PROGRAM_UNAWAITED_CALL` for an awaited `ui.act` call using invalid click fields (`x/y` instead of `point`). Program cancellation can produce the generic unawaited-call fallback. Root-cause attribution remains a hypothesis pending a focused reproduction. | Add an invalid-action-schema case that preserves the original argument issue and verifies zero native dispatch. |
| Coverage | A visible old token is insufficient proof of a new message | Historical `expect: text("hello")` encountered text already present before sending. Runtime correctly returned `condition_present` with `verified: false`. This is a task/condition design limitation, not evidence of a successful send. | Continue using new application effects or independent counters/receipts as the oracle; do not grade from an old string. |

The local log inventory contained 43 `computer_use` tool-result rows, including
four `COMPUTER_INVALID_MODEL_OUTPUT` errors, one missing element-reference error,
one readiness timeout and one UI-program error. Rows include status/report calls;
these counts are not independent tasks or a product failure-rate estimate.

## Maintained coverage

`pnpm run computer:benchmark` exports the existing Runtime/Broker/adapter/desktop
fault regressions plus benchmark preflight checks. It includes the previous fix's
long-tree input retention and dual native-tree Qt parent/child certification.
Its JSON output distinguishes fixture evidence from actual native input.

`pnpm run computer:benchmark:windows --repetitions 3` plans 48 native runs across
the existing disposable WinForms and WPF fixtures. The eight fixed task families
cover exact replacement, Unicode/multiline append, keyboard events, duplicate
envelopes, protected/readonly inputs, stale observations, conversation ownership
and released grants. The app-owned state file, rather than UIA acknowledgement,
grades the result. Every sample retains before/after state and receipts. Phase
timings make latency regressions inspectable.

The planner is scripted. It can discard and re-ground one proposal only after
a confirmed observation change before any native dispatch. A new action ID is
used, the original refusal is retained, and both attempts count in diagnostics.
An unknown native result stops later admission; it is never automatically replayed.

The original development trial is retained separately. Its released-grant test
incorrectly omitted the valid `COMPUTER_GRANT_REVOKED` refusal, and its scripted
planner did not yet include bounded re-grounding. Its source also changed during
development. The final smoke runs every task again under the frozen final harness;
it does not replace selected failures or pool the development trial with the
primary result. Native negative observations from that trial remain useful for
diagnosis but cannot establish a matched regression rate.

## Current result and limits

- Primary native run: `899beaba-da05-4791-bb71-58e060b3cb5d`, one repetition,
  16/16 passed, zero recorded duplicate/scope/post-stop incidents, no source drift.
- Final fixture regression run: `31fbf37c-abbc-4fb5-a045-f911ef53fe20`, 653 passed,
  zero failed or skipped.
- Unsupported probes: exact field expectation unavailable on both frameworks.
- Development trial: `1e57a1d7-a2b6-4aca-a116-5bb573879458`, retained and excluded
  from the primary score, including the unknown WPF click.
- These runs do not cover model inference, Gateway network/desktop reconnection,
  installed-app packaging, Qt at native scale, multi-monitor DPI, dialogs or real
  task distributions. Existing model-input, Gateway and installer checks remain
  separate evidence; one successful Telegram send is also separate smoke evidence.
- One repetition per framework is a smoke, not a reliability or p95 estimate.
  Reported durations include discovery/open and independent validation. Per-action
  durations and native subphases are retained separately.

The existing release quality gate remains false for native/fixture evidence. The
benchmarks exit nonzero on failure, uncertainty, missing runs, source drift or
setup errors, while retaining whatever evidence was captured. They create new
directories instead of overwriting prior results. Safety measurements describe
this runner's native calls only, not unrelated desktop activity.
