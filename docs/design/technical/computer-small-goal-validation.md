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
