# Verified flows with a real GUI model

The opt-in TextEdit harness has two separate modes: the original local deterministic planner and `--hosted`, which uses the real fixed-version `dashscope-cn/gui-plus-2026-02-26` model at `https://dashscope.aliyuncs.com/compatible-mode/v1`. The existing `DASHSCOPE_API_KEY` environment credential is resolved through the ordinary provider resolver in each isolated process. No key is copied into configuration, evidence or logs. This direct-provider run does not validate the XOPC Cloud routing or billing path.

## Model and native actions

GUI-Plus receives the actual window screenshot, current AX context, current goal/expectation and, after restart, untrusted saved hints through the production Chat Completions adapter. The fetch instrumentation delegates the original response unchanged to the production parser; it never fabricates or rewrites decisions. It pins the recipient, model and redirect policy and refuses further inference after uncertain dispatch. Successful HTTP responses and model requests are counted separately.

The XOPC prompt protocol now explicitly offers `activate(ref)` and `show_menu(ref)` alongside its existing coordinate actions. These are XOPC extensions, not claims about Alibaba's standard action vocabulary. Strict action-specific parsing maps them to the existing native action contract. Read-only requests still offer only `answer` and reject native inputs. The Broker retains its ordinary observation/generation/grant, native capability, target and receipt checks. Partial trees remain partial; coordinate clicks are not automatically upgraded on incomplete snapshots.

This extension is needed because saved flows accept verified native actions, while the pinned macOS backend cannot prove full AX coverage. The model must explicitly choose an observed native ref. The test does not translate its coordinates into native actions to make saving pass. Its current goal explicitly requires one native activation from the current AX context. During preflight, a less constrained navigation goal produced a coordinate proposal; the harness refused it before the real driver call (zero native inputs), retained unknown-dispatch diagnostics and stopped. The passing matrix therefore validates this explicit native-navigation task, not reliable native-action preference for arbitrary goals.

## Reproduce

Use the same macOS permissions and pinned driver as the [local baseline](./computer-use-verified-flows-live-validation.md). Open TextEdit Settings on **New Document**, inspect the window and ensure Author, Organization and Copyright are empty/non-sensitive before running. Only this window is sent to DashScope; do not use a document or another application. Normal provider inference charges apply.

```sh
pnpm exec tsx scripts/run-computer-flow-validation.mts --hosted
```

The runner creates a private temporary state root and starts three independent Electron processes using the same isolated SQLite database, Agent/workspace and flow identity. No phase is automatically retried. A failed phase stops the matrix and leaves its state for inspection. Metadata-only failure reports distinguish model calls, guarded inputs and failure dispatch without recording raw responses, screenshots or AX text.

Before screenshots, the harness requests window candidates through the driver's normal invalid-window-ref response, then explicitly selects the sole Settings candidate using its fresh opaque window ref. This avoids macOS proxy stacking selecting another surface. It awaits the failed enumeration lease's shutdown before opening the selected window; this is metadata selection before input, not an action retry.

Each phase first revokes app access in the isolated local policy and requires denial with zero observations, inference or inputs. Granting access uses the normal host setting. The actual host approval implementation remains in place for both session and action checks; instrumentation only counts calls. The test never changes OS permissions or the user's real access policy.

Capture must execute the model's native tab activation, positively verify **HTML Saving Options**, release and explicitly save. Reuse must load the same UUID in another OS process, receive fresh pixels and hints, perform a new authorized native action and verify the page again. The unknown phase drops the reply only after the actual native effect is independently observed; Runtime never receives that effect evidence. It must release, record unknown dispatch, make zero rescue attempts or further act/inference calls, and reject saving. Separate authorized baseline cleanup occurs only after scenario assertions.

The endpoint transport remains an in-process harness bridge to the real DesktopEndpointHost/Broker/driver. This exercises the full hosted-model-to-native-action-and-persistence chain, not network Gateway enrollment or reconnect handling. One successful navigation case does not establish general model accuracy.

## Observed result — 2026-10-17

[Metadata-only evidence](./evidence/computer-use-flows-hosted-2026-10-17.json) records the passing matrix on macOS 26.6.2, Electron 42.4.1 and pinned Cua Driver 0.28.2:

| Phase | OS PID | Actual successful HTTP responses | Scenario native inputs | Requests with saved hints | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Capture | 45619 | 1 | 1 | 0 | Verified page, released and saved |
| Reuse | 89921 | 1 | 1 | 1 | Same flow UUID loaded after restart; fresh inference and input |
| Unknown reply | 34047 | 1 | 1 | 1 | Real effect observed; reply withheld; no replay or rescue |

Every phase denied access before granting the isolated allowlist entry, ran seven ordinary session checks (including metadata selection and cleanup leases) and two ordinary action checks (one scenario, one cleanup). The unknown phase recorded `dispatch: unknown`, one unknown dispatch, zero acts after loss, zero rescues and confirmed release; its failed session could not be saved. Each phase restored New Document using one separate authorized cleanup input. No format re-prediction was needed in this matrix.

Related automated validation: 375 tests passed and 9 were skipped across the Computer Use, desktop host, endpoint tools and evaluation CLI suites. Root TypeScript checking, the runner TypeScript check and Electron main/preload production builds passed. The final-source deterministic live mode was also rerun successfully in three independent processes (78313, 22664, 66444), covering the same lifecycle without hosted inference. TextEdit was independently checked afterward and remained on New Document with the original preference values.

The additional [real Gateway/desktop network matrix](./computer-use-verified-flows-network-validation.md) replaces the in-process endpoint bridge with the production HTTP/WebSocket transport and tests persistent authenticated device identity across restarts. It uses a controlled native AppKit application, separately from the TextEdit application check above.
