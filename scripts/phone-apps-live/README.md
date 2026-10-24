# Real AutoGLM App evaluation

The harness runs real AutoGLM requests and ADB actions against the dedicated `XOPC_Android_Test_API_35` emulator. It rejects physical devices and other AVDs. Settings, Clock, Files and Contacts are actual preinstalled apps; model completion is checked by two independent final native observations.

The recovery comparison is currently **paused by the user and incomplete**. See the [progress note](../../docs/design/technical/phone-use-recovery-pause-2026-10-24.md) and the [previous completed comparison](../../docs/design/technical/phone-use-semantic-planning-benchmark-2026-10-24.md). Do not resume device tests or paid calls until requested.

## Output policy

Runtime JSON, screenshots, traces, source archives and stress-test output are local artifacts. Keep them outside version control using `--output`; the default is a fresh temporary directory. Do not copy them into `docs/design/technical/evidence/`. Commit reusable source, tests and curated Markdown summaries instead.

Existing local evidence was backed up outside the repository during cleanup. Baseline and candidate snapshots may be extracted from that backup if their temporary directories have been removed.

## Sources and arms

A source directory must contain `runtime.ts`, `model-adapter.ts`, `adb-driver.ts`, `contracts.ts` and `reliability.ts`, plus every imported optional module: `semantic-controls.ts`, `planning.ts`, `recovery.ts`, `numeric-entry.ts`. An optional `manifest.json` records `sourceSha256`. Imports are rebound consistently; contracts are shared only when their source hashes match.

| Arm | Source | Semantic controls | Hierarchical execution |
|---|---|---:|---:|
| `reference` | Frozen previous | false | false |
| `before-planning` | Frozen previous | false | true |
| `after-planning` | Candidate | false | true |
| `before-combined` | Frozen previous | true | true |
| `after-combined` | Candidate | true | true |

Legacy `baseline`, `semantic`, `planning`, `combined` and `optimized` names remain supported for the earlier four-arm comparison. Use `pairedOutcomes[].outcomes`, `comparisons` and `matchedPairEfficacy`; the legacy `optimizedCompleted` field does not represent `combined` when the alias is absent.

There are eleven core tasks (`--split core`): seven original development tasks and four transfer-check tasks from the previous panel. Three additional tasks (`--split transfer`) cover two new timer durations and a visible but unfocused search field. The unfocused fixture changes actual focus without injecting or forcing model decisions.

## Validation and execution

List tasks without a model call:

```sh
pnpm exec tsx scripts/benchmark-phone-apps-live.mts --list-tasks
pnpm exec tsc -p scripts/phone-apps-live/tsconfig.json
```

Start the dedicated AVD and configure `ZHIPU_API_KEY` before device execution. The opt-in and key presence are required even for setup-only modes, but those modes make no inference requests.

```sh
XOPC_PHONE_REAL_MODEL=1 pnpm exec tsx scripts/benchmark-phone-apps-live.mts \
  --baseline-dir /path/to/frozen-previous \
  --tasks contacts-search --setup-stability-only --stable-initial \
  --exercise-before-reset --warm-reset --deterministic-ui --repeats 30 \
  --suite-timeout-ms 5400000 --output /tmp/phone-initialization-check
```

`--setup-only` demonstrates the expected UI and calibrates the oracle without inference. Neither manual demonstrations nor initialization checks count as model successes.

After initialization is validated, a paired core run can use:

```sh
XOPC_PHONE_REAL_MODEL=1 pnpm exec tsx scripts/benchmark-phone-apps-live.mts \
  --baseline-dir /path/to/frozen-previous --candidate-dir /path/to/frozen-candidate \
  --arms reference,before-planning,after-planning,before-combined,after-combined \
  --split core --repeats 2 --trial-requests 8 --trial-actions 12 \
  --trial-timeout-ms 90000 --suite-timeout-ms 5400000 --request-cap 420 \
  --stable-initial --warm-reset --deterministic-ui --response-metadata \
  --stop-file /tmp/phone-comparison-stop --output /tmp/phone-comparison-core
```

Run transfer tasks separately with `--split transfer --repeats 1` and an explicit remaining request cap. Freeze sources and task/oracle definitions before model calls; transfer outcomes must not guide candidate tuning. Existing output is never overwritten.

## Initialization and matching

- Full native fingerprints retain geometry and focus; only existing system-clock text normalization applies. No geometry tolerance is introduced.
- `--stable-initial` requires two consecutive identical native observations, with a bounded gate and reset attempts.
- `--warm-reset` preserves the app process while recreating the activity task. Contacts additionally requires explicit loaded-list readiness. PID evidence is recorded; this is a warm functional fixture, not a whole-VM or hidden-history restoration claim.
- Contacts setup prefers visible Home navigation and explicit in-app search Back controls. It does not send blind hardware Back based on stale search-editor nodes.
- `--deterministic-ui` saves, disables and restores three animation scales. Check the actual restoration readback after an interrupted run.
- `--checkpoint-initial` remains a diagnostic option. VM restoration crashed the current SDK emulator with both host and software rendering and is not used by the warm method.

The current order reverses every arm pair on the second repeat. It is deterministic, not randomized. Earlier archived four-arm runs used a different rotation/reversal schedule and must retain their original order limitation.

## Results and boundaries

All arms receive the same goal, completion predicate, model and per-trial budgets. Later arms must match the task/repeat reference fingerprint. Initial mismatches remain in raw output with zero model calls and are excluded from paired efficacy. Inspect `plannedTrials`, `finishedTrials`, `suiteError` and valid groups before interpreting percentages. Pairwise and common-all-arm denominators may differ.

A completed dispatch is not task success. `runtimeVerified` is checked against the independent oracle, while native binding, Back/focus recovery and confirmed numeric steps are counted separately. Assigned phases are host-generated execution state, not evidence that the model generated a plan.

Clock start/add actions, contact modification/import/call/voice controls and seeded-file opening/modification actions are restricted uniformly. Four Settings values and two owned file checksums are sampled; these do not exhaustively prove every negative constraint. Runtime duration includes open/shutdown and final verification, but excludes initial fixture preparation.

`--response-metadata` records bounded finish reasons, token usage and format metadata without raw reasoning or keys. Screenshots are off unless `--save-frames` is specified. `--stop-file` is checked between task/repeat groups and does not interrupt an in-flight trial.

## Offline analysis

Analysis never calls the model:

```sh
python3 scripts/phone-apps-live/analyze-results.py \
  --development /path/to/local/development/result.json \
  --heldout /path/to/local/heldout/result.json \
  --output /tmp/phone-analysis.json --markdown /tmp/phone-analysis.md

python3 scripts/phone-apps-live/analyze-recovery.py \
  --core /path/to/local/core/result.json --transfer /path/to/local/transfer/result.json \
  --baseline-source /path/to/frozen-previous --candidate-source /path/to/frozen-candidate \
  --output /tmp/phone-recovery-analysis.json --markdown /tmp/phone-recovery-analysis.md
```

Core and transfer panels are reported separately. Small repeated tasks are clustered observations and do not establish general real-phone completion-rate gains. No final recovery efficacy claim is available while the comparison is paused.
