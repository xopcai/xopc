# Computer Use diagnostics and paired evaluation

The existing Runtime, desktop Broker, endpoint transport and independent executor/oracle harness remain the execution boundaries. Diagnostics do not grant access, replay input, switch providers or grade business success. There is no new Gateway route, screenshot archive or background desktop job.

## Session reports

`computer_use {"op":"report"}` reads this conversation's active or most recent session report entirely in the Gateway process. It does not contact the desktop, consume model calls, resume a held action or acquire a lease. Tool errors and `close` include the available report; normal operations expose its `reportId` for correlation. Report reads remain available after a failure, desktop disconnection or control disablement.

Reports contain versioned metadata: report/session UUIDs, timestamps, release status, counters, measured phase durations, the first failure, and at most twelve recent action kinds and outcomes. They never include goals, input values, element tokens/references, coordinates, app/window names, page text, screenshots, model responses or credentials. Failure classification only preserves recognized error codes and validated request correlation fields; arbitrary exception prose becomes `COMPUTER_OPERATION_FAILED`. Existing structured logs receive content-free report metadata.

Released reports are retained in memory for thirty minutes, at most thirty-two conversations. Active reports remain attached to their session. A restart discards them; an expired `no_report` is not a reason to reopen the desktop. Report data is copied on retrieval so a consumer cannot mutate runtime counters. `release_unconfirmed` retains the existing control gate and does not authorize another tool or input retry.

Counter meanings:

| Field | What is measured |
| --- | --- |
| `observations` | Runtime observation requests, including failed requests; excludes the Broker's internal revalidation captures |
| `predictionAttempts` | Adapter predictions, including format corrections and cached Responses batch actions; existing budget reservation is unchanged |
| `modelRequests` | Actual HTTP inference requests, counted immediately before fetch; cached batch actions add no requests |
| `proposedInputs` | Distinct proposed non-wait actions, including ones discarded before dispatch |
| `completedInputs` | Non-wait actions with `dispatch: completed`; acknowledgement does not imply the requested business effect |
| `unknownDispatches` | Actions with uncertain delivery, including a lost act reply; counts each held action once |
| `unchangedInputs` | Completed non-wait inputs whose before/after state digests match; this is not proof of a failed or harmless input |
| `observationChanges` | Proposals discarded after the Broker positively confirms pre-dispatch UI change |
| `rescueAttempts` | Fresh observation/planning cycles authorized by the session rescue budget; counts even if the new observation or prediction fails |
| `rescueExhaustions` | Confirmed pre-dispatch changes stopped because rescue was disabled or its session allowance was exhausted |
| `takeovers`, `successClaims`, `verifiedConditions` | Separate human handoffs, model claims and satisfied native conditions; none grades an entire business task |

`phaseMs` measures endpoint calls for open/observe/dispatch/release and the complete adapter prediction phase for model. Status calls, configuration lookup and time between agent calls are not assigned to those phases, so phase totals need not equal elapsed session duration. Pending-action polls add transport time but do not add proposals or model requests. An uncertain native result or RPC remains uncertain, even if cleanup later succeeds.

Failure categories distinguish permission, target, observation, model, transport, native execution, budget, no progress, cancellation, harness and unknown failures. `failure.dispatch` describes execution evidence for that failure; a model error before the next action must not inherit a previous action's completed receipt. The first failure is retained through cleanup; release status separately identifies an unconfirmed shutdown.

## Evaluation records

The existing fixed-plan evaluator still requires an independent oracle and explicit application-state or artifact evidence. The real-app beta gate remains sixty tasks, three repetitions, at least ninety percent autonomous success, no false success claims or observed incidents, and distinct per-run evidence for release. Unknown safety measurements or uncertain delivery cannot pass it. Fixture/native checks do not certify real-app quality.

Executor output may additionally contain `actions`, `unchangedInputs`, `observationChanges`, `rescueAttempts`, `rescueExhaustions` and a structured `failure`. These optional performance values, model/token usage, cost and safety counters can be `null` when unmeasured. A missing optional value remains unknown, not zero. Aggregate measurement totals become null when any recorded run lacks that metric. Missing runs stay in the success-rate denominator; cost per success still requires complete known cost coverage.

An executor can use `computerReportMeasurements(runtime.getReport(conversationId))` after releasing its session to obtain measured duration, actual model calls, completed inputs, unchanged inputs, stale proposals, rescue attempts/exhaustions, takeovers and claims. Active-session export is refused; unconfirmed release exports an uncertain failure. This helper does not invent token usage, costs, safety incident counts or oracle outcomes. The executor must provide those measurements independently, using null where unavailable. A native condition check remains distinct from the oracle's full task grade.

When an executor process fails, times out, exceeds its output limit or returns invalid JSON/schema, the harness records an unknown run with no oracle grade, no evidence reference and null unmeasured counters. When the oracle fails, the executor's measured values are retained but its success claim cannot supply a grade. The partial matrix is checkpointed and subsequent executions stop. Confirmed incidents and reported uncertain execution also stop the matrix. Processes are still launched without a shell, with bounded output and tree termination. Stderr, command arguments and raw process errors are never copied into evaluation reports.

The runner writes private atomic checkpoints (mode 0600), including an initial empty matrix. SIGINT/SIGTERM abort the harness process tree and save an interrupted partial report. A cancelled in-flight run that has no complete result remains missing, with unknown execution recorded in the interruption metadata; it is not silently retried. Only run already-authorized, operator-owned manifests, using disposable application state and an independent oracle.

```sh
pnpm run computer:evaluate:run -- manifest.json report.json
pnpm run computer:evaluate -- report.json
pnpm run computer:evaluate:compare -- baseline.json candidate.json
```

The first two commands retain the existing nonzero exit status when the beta gate is not met, including successful fixture matrices. The comparison command returns nonzero for incomplete pairs; zero means the matrix is fully comparable, not that the candidate is better or release-ready.

## Paired comparison

`compareComputerEvaluations` reparses both reports and recomputes their summaries. Environments, evidence classes, task sets and repetition counts must match; each report must contain one fixed model reference. The model reference can differ between baseline and candidate. Pairs match exact task ID and repetition, independent of list order. Duplicate, foreign and mixed-model rows are refused before comparison.

Results include wins/losses/ties under the autonomous-success predicate, matched/missing pairs, and paired mean differences for duration, actual model calls, completed inputs, unchanged inputs, observation changes, rescue attempts/exhaustions and cost. Each metric reports how many pairs have measurements on both sides; missing values never become zero. Differences include all measured paired runs, including failed tasks, and are not a claim of speedup on successful work. Incomplete coverage and oracle/safety failures remain visible in each recomputed summary. Stored summaries and model success claims have no grading authority.

## Verification scope

The automated Runtime/Broker path exercises privacy, report retention and isolation, setup/model/native/transport failures, uncertain receipts, pending-action deduplication, stale replanning, budget enforcement and claim/verification separation. Adapter tests check that a cached Responses batch action adds no HTTP call. Real Node subprocess tests execute executor and oracle commands, check mode-0600 checkpoints, preserve process failure and missing-run denominators, suppress private stderr, and invoke the comparison CLI on the resulting reports. These checks validate diagnostics and evaluation mechanics; they do not establish a general desktop task success rate.
