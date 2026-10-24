Real AutoGLM app comparison

This harness compares a frozen five-module Phone Use snapshot with current production code on the dedicated `XOPC_Android_Test_API_35` emulator. The benchmark uses actual AutoGLM calls and actual Settings, Clock and Files apps, with two independent final native observations per trial. Manual setup/oracle demonstrations are not model successes.

List or validate the seven fixed tasks:

```bash
pnpm exec tsx scripts/benchmark-phone-apps-live.mts --list-tasks
XOPC_PHONE_REAL_MODEL=1 pnpm exec tsx scripts/benchmark-phone-apps-live.mts \
  --baseline-dir /absolute/path/to/baseline \
  --setup-only --output /tmp/phone-apps-oracles
```

Run the paired panel after exporting `ZHIPU_API_KEY` and starting the dedicated test AVD:

```bash
XOPC_PHONE_REAL_MODEL=1 pnpm exec tsx scripts/benchmark-phone-apps-live.mts \
  --baseline-dir /absolute/path/to/baseline \
  --repeats 3 --trial-requests 8 --trial-actions 12 \
  --trial-timeout-ms 90000 --request-cap 300 --suite-timeout-ms 1800000 \
  --output /tmp/phone-apps-comparison
```

The source directory must contain `runtime.ts`, `model-adapter.ts`, `adb-driver.ts`, `contracts.ts`, `reliability.ts`, and optionally a `manifest.json` with `sourceSha256`. Snapshot relative and dynamic imports are rebound consistently. The current contracts module is shared only when its SHA-256 exactly equals the baseline; this keeps shared timeout-error classification intact without changing baseline behavior.

Arms alternate AB/BA across repeats and tasks. Both get identical model, query, completion predicate, action/request/time budgets and independent oracle. Before the second arm makes a model call, its initial native fingerprint must match the first arm; setup retries twice at most. Unmatched rows remain in raw results but are excluded from matched-pair efficacy. The request cap may stop an incomplete panel; inspect `plannedTrials`, `finishedTrials`, `suiteError`, and eligible pairs before interpreting results.

Each trial records predictions, parsed action decisions, dispatches, native facts, independent final predicates, sampled Settings invariants, scratch-file checksums and operational counters. Raw model reasoning and keys are not saved. Screenshots are off by default; `--save-frames` explicitly saves test-only frames locally. The suite rejects physical devices and other AVD names. Clock Start/Add alarm/Save/Add point actions and scratch file opening/modification actions are blocked equally for both arms. Changed sampled Settings values or fixture checksums fail the trial and are restored on this dedicated test AVD.

The four sampled Settings keys are `screen_brightness`, `screen_brightness_mode`, `screen_off_timeout`, and `font_scale`. They do not exhaustively prove all negative constraints. The two owned scratch files remain under Downloads for repeatable tests. No accounts, messages, purchases, app installation or production phone state are involved.

Typecheck:

```bash
pnpm exec tsc -p scripts/phone-apps-live/tsconfig.json
```

`--response-metadata` adds a bounded 256 KiB cloned-response inspection for both arms. It persists only the fixed-schema finish reason, token usage, output/line counts, format labels and repetition counts; raw response text and reasoning are never written. A capped clone is cancelled without awaiting the tee, so the production adapter can still read or cancel its original response.

`--candidate-dir /path/to/frozen/source` uses a second five-module archive as the optimized arm instead of the working tree. This supports replay of rejected candidates. The host/oracle source hashes and candidate hashes are recorded separately. The task and oracle definitions stay the same.

Verify response-reader privacy and tee behavior without device or model calls:

```bash
pnpm exec tsx scripts/phone-apps-live/verify-response-reader.mts
```
