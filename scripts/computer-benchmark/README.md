# Windows Computer Use benchmarks

These commands reuse the existing desktop Broker, native driver, fixtures and
`evaluateComputerRuns` records. They do not replace the independent executor/oracle
harness or its real-application release gate.

```sh
pnpm run computer:benchmark
pnpm run computer:benchmark:check
pnpm run computer:benchmark:windows --list
pnpm run computer:benchmark:windows --repetitions 1
```

`computer:benchmark` exports the existing deterministic computer tests, including
long accessibility trees, Qt input certification, ambiguous/protected fields,
coordinate grounding, stale observations, approval/cancellation, unknown delivery,
batch budgets, no-progress stopping and evaluator calibration. It runs on CI
without applications or model credentials. Its timings are test timings.

`computer:benchmark:windows` requires an interactive Windows x64 desktop, installed
workspace dependencies, and the pinned driver from `pnpm run computer:driver:setup`.
It compiles and launches only the repository-owned disposable WinForms and WPF
fixtures. Both are closed afterwards. No personal application is selected, no
existing xopc state is changed, and no model or provider request is made. The
fixtures may briefly take desktop focus; avoid concurrent desktop interaction.

The fixed matrix has eight tasks per framework, repeated three times by default
(48 planned runs). Repetitions must be 1–5. `--output ABSOLUTE_DIRECTORY` selects a
new evidence directory; an existing directory is refused. Every attempt remains
in the denominator, including failed and unknown attempts. There is no selective
rerun or replacement of failures.

| Task | Independent evidence |
| --- | --- |
| replace | App control state equals the exact replacement, including nonempty replacement |
| append | Original prefix plus Chinese, emoji and multiline text, normalizing CRLF only |
| deduplicate | Repeating the identical Broker envelope increments the app button counter once |
| protected | Both password and readonly writes are refused with zero native dispatches; app state stays unchanged |
| stale | A replaced observation is refused before input; app state stays unchanged |
| owner | Another conversation cannot issue input; app state stays unchanged |
| released | A released grant cannot issue input; app state stays unchanged |
| keyboard | Click the editor, deliver End and Backspace; app key events and final text agree |

The app process publishes an atomic oracle file read by the benchmark; UIA action
acknowledgements do not grade correctness. Since suite 1.1.0, replacement also
requires `expect: field` to agree with that oracle and reject an intentionally
wrong value. This is stricter than the original 1.0.0 smoke, which retained an
unavailable field condition as a separate capability probe. Probe outcomes remain
in `probes`; an unavailable condition now fails the replacement task. Action
receipts also retain whether a certified editable target was focused before/after.

The scripted planner permits one fresh observation and target resolution only
after `COMPUTER_OBSERVATION_CHANGED` with no receipt and no observed native
dispatch. The discarded proposal and rescue count are retained. It never repeats
input after uncertain delivery. Such uncertainty stops later task admission and
leaves unexecuted repetitions missing. A failed sample with known delivery remains
a failure even when a later, different task succeeds.

Each run directory contains:

- `manifest.json`: fixed tasks, repetitions, relevant source/lockfile hashes and
  pinned driver version. All bundled driver files are checksum-verified first.
- `<framework>/result.json`: atomically checkpointed existing evaluation records,
  per-framework summary and unsupported capability probes.
- `<framework>/<task>-<repetition>.json`: app state before/after, receipts and
  native/total action timing. Only synthetic fixture content is recorded.
- `summary.json`: final cross-framework counts. Nonzero exit means failure,
  uncertainty, missing runs, setup failure or detected source drift.
- `interruption.json`: setup/interruption/source-drift diagnostics when needed.

Source changes during a run invalidate its final comparison. Original smoke
trials must remain separate from frozen-source baselines. Failed records are not
corrected in place after a harness assertion changes.

Safety counts measure only native `perform` calls issued by this benchmark
process: action-ID duplication, target process/application scope and calls after
release. They do not measure other desktop processes or certify all external
effects. Model usage and cost are zero because this runner has no model path.

To compare matching native reports using the existing comparison command:

```sh
pnpm run computer:evaluate:compare -- BASELINE/winforms/result.json CANDIDATE/winforms/result.json
```

Keep the same suite version, Windows environment, framework, repetitions and driver for
paired comparisons. These are small scripted native fixtures, not real-model
planning scores or a production success-rate estimate. The separate real-app
release gate still requires its full matrix. Qt parent/child handling is covered
by deterministic tests and the separately authorized Telegram smoke; this native
matrix does not manufacture a Qt fixture. Multi-monitor DPI, complex dialogs,
long real-app histories and installer certification remain additional coverage.
