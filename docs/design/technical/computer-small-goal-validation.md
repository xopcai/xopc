# Small-goal Computer Use validation

Validated on macOS on 2026-10-19 through the running source Gateway, Electron dev desktop bridge, native Cua driver 0.28.2, and a real Calculator window. The main Agent used `deepseek/deepseek-v4-pro`; the Computer Use model used `openai/gpt-6.1-sol` with the existing ChatGPT OAuth binding. This was not a benchmark against Codex.

## Live Calculator result

A single `computer_use` `run` cleared the existing expression, entered `121 + 123`, and pressed Equals. The returned native accessibility condition matched `244`:

| Measurement | Result |
| --- | --- |
| Run status | `goal_satisfied` |
| Stop reason | `condition_satisfied` |
| Completed inputs inside run | 10 |
| Model requests inside run | 10 |
| Reused post-action observations | 9 |
| Run elapsed time | 91,416 ms |
| Observation-change rescues | 0 |
| Unknown dispatches | 0 |
| Final control state | Released (`close` returned `stopped`) |

The session report contained 10 completed inputs, zero unchanged inputs, zero takeovers, and two verified conditions. It recorded 11 model requests overall: 10 during `run` and one for the final independent visual observation. A separate native accessibility read also found Calculator's Last Expression `121+123` and its displayed result `244`. Verification of the requested condition, rather than the model's success claim or native action acknowledgement, ended the loop.

The test restored the previous global Computer Use model and enabled flag. Calculator was left displaying the requested result. No personal screenshots or credentials are retained in this report.

## Regression comparison and scope

The controlled three-input runtime fixture requires three main-Agent `step` invocations and nine driver observations on the legacy path. `run` completes the same fixture in one invocation with seven driver observations: one initial frame, then one fresh pre-dispatch check and one post-action frame per input. Both intermediate post-action frames are reused, and all image buffers are zeroed at exit. This verifies fewer Agent round trips and redundant observations; it does not imply fewer GUI-model decisions or parallel inputs on one window.

Regression coverage includes action/session limits, read-only rejection, held approvals, cancellation, concurrent-input rejection, stale frame expiry, pre-dispatch state changes and bounded replanning, uncertain dispatch without replay, preexisting text, selected-state completion, and model success claims without native evidence.

## Issues exposed during live testing

- A macOS sharing accessory can expose an `AXWindow` root and rank above an application's document. Auto-selection now excludes nonstandard native layers and probes only the root/first control to identify `WindowSharingSessionButton` when layer metadata is absent. Observations of that system accessory are rejected before reaching the model.
- Native input acknowledgement may precede a render commit. Successful inputs receive a 200 ms render grace before the post-action observation. This is not proof of stability; the broker still performs its fresh target/state comparison before every input.
- Calculator was on Space `5` while the chat was on Space `1500`, later `6`. Returning to the chat made it unavailable to the driver despite manual foregrounding. Read-only native window metadata established the mismatch. A desktop-layout shortcut switched to Space `5`; the driver then independently confirmed `isOnScreen=true` and `onCurrentSpace=true` before the successful test. All calculation inputs and the final model observation still went through xopc Computer Use. The runtime now distinguishes `COMPUTER_WINDOW_OTHER_SPACE` and explains the layout change needed, rather than asking users to foreground the same off-Space window repeatedly.

Earlier refused/unstable attempts were stopped and are not counted as successful runs. The successful run alone supplies the measurements above.

## Speed follow-up: 2026-10-20

The original session spent 64,807 ms in model prediction and 30,430 ms in action dispatch. Those are **session** totals, including the separate final visual answer; they are not a partition of the 91,416 ms `run`. Ten GUI-model requests inside that run were the main avoidable cost. The fixed 200 ms render grace accounts for only about two seconds across ten inputs.

Structured function-tool models now receive a call-local conditional native-button plan option (two to six presses). Each continuation requires a completed previous receipt, the recorded post-action digest, an exact expected native display value and a newly resolved enabled native button ref. The ordinary local authorization and full fresh broker target/state comparison still precede every input. No coordinate batch, key/text sequence, stale ref replay or parallel input was added. Actual outbound calls, rather than locally consumed plan steps, debit the model-request budget.

Fast continuations exposed a render race that normal model latency had hidden: a post-action snapshot could precede the final button/display animation. The original fresh-state guard refused these attempts, exhausting the existing bounded rescue allowance without replaying input. The final implementation therefore takes at most three additional post-action observations before a queued continuation, requiring two consecutive matching native snapshots. It records the stable post-state for the plan. Capture failure or instability preserves the completed receipt and hands off; it does not increase rescue limits or weaken the pre-dispatch comparison. Temporary frames are zeroed, and plans are discarded on exit, read-only use, changed goals, failed guards or rescue.

### Successful original-task rerun

The final real Calculator run used the same `openai/gpt-6.1-sol` ChatGPT OAuth binding and native driver 0.28.2, with `deepseek/deepseek-v4-pro` as the main Agent. It cleared old test input and entered `121 + 123` using native buttons. Native completion verification returned `goal_satisfied`, `verified: true`; a separate native read confirmed Last Expression `121+123` and result `244`.

| Measurement | Original | Optimized |
| --- | ---: | ---: |
| `run` elapsed | 91,416 ms | 47,585 ms |
| GUI-model requests inside `run` | 10 | 2 |
| Completed native inputs | 10 | 9 |
| Reused post-action observations | 9 | 8 |
| Entire open-to-release session | 117,599 ms | 66,412 ms |
| Unknown dispatches / observation-change rescues | 0 / 0 | 0 / 0 |

The optimized run was about 48% shorter. The input counts differ by one, so this is a real task comparison, not an isolated latency benchmark or a statistical average. An earlier successful `121 + 124 = 245` prototype run took 51,525 ms with five model requests; it predates the final bounded stability handling and is not the final acceptance run.

Optimized `run.phaseMs`: model 17,487 ms, dispatch 26,436 ms, explicit/stability observations 1,351 ms. The remaining approximately 2,311 ms includes authorization polling and other orchestration. `run.nativeMs` further splits dispatch into 1,524 ms for fresh pre-dispatch observation/validation, 22,605 ms for acknowledged native input including render grace, and 2,240 ms for the broker's first post-action observation. Additional stability observations are included in `phaseMs.observe`, not counted twice in `nativeMs`. Input acknowledgement is now the largest measured component; these measurements do not justify removing native checks or declaring input success without the final native condition.

The session closed with `stopped` and a released report. It had nine completed inputs, zero unchanged inputs, zero unknown dispatches, zero observation changes, zero rescues, zero takeovers and three model calls overall (two inside `run`, one for the separate visual answer). Test configuration was restored and Calculator was left displaying `244`. The macOS Space mismatch encountered during setup was resolved by reopening the disposable Calculator test window on the current desktop; native metadata independently confirmed both `isOnScreen` and `onCurrentSpace` before the successful attempt. All calculation inputs went through xopc.

Regression validation: 365 tests passed, nine skipped; TypeScript checking and Node build passed. Coverage includes fresh per-input checks, changing refs, exact static-text/field guards, duplicate/disabled/web targets, uncertain receipts, expired state, bounded animation settling, post-dispatch capture failure without replay, plan reset, model/action limits and frame zeroing. No personal screenshots or credentials are included in this document.
