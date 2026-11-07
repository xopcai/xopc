# OSWorld continuous Computer Use evaluation

Default model: **`openai/gpt-6.1-sol`**. No model fallback. Read the
[optimization plan](../../docs/design/computer-use-osworld-continuous-improvement.md).

This first adapter supports the pinned **OSWorld V1 / Verified JSON task format**.
OSWorld 2.1 uses a different task-class/evaluator interface and is a later stage.
The suite contains 24 development tasks and 8 held-out tasks across eight domains.
The task selection is deterministic: SHA256-sort IDs by `xopc-osworld-v1:<id>` in
each domain, choose three development tasks and the next held-out task.
The two smoke tasks are explicitly selected from the development set: rename a
directory and enable Do Not Disturb. Both have local state oracles and exercise
actual input; the first two development entries include an infeasible task and
an external shopping website, so they are unsuitable as the infrastructure smoke.

The Python agent implements `reset` and `predict` for OSWorld. It communicates with
the TypeScript bridge over JSONL. The bridge uses xopc's existing model registry,
credentials, `createComputerModelAdapter` and `predictComputerStep`. The model only
proposes structured actions; fixed local code generates each PyAutoGUI input.
Each primitive action is followed by a fresh observation. Native refs, native
setValue, batches and arbitrary model-authored Python are rejected.
AT-SPI editable bounds ground typing; missing/ambiguous fields remain unsupported.
Text is pasted via the disposable guest clipboard, requiring `pyperclip` in the VM.

This measures the shared model adapter and VM execution. It does **not** exercise
the full xopc Agent, Broker, endpoint transport or native driver. Reports explicitly
set `nativeCertified: false`, `safetyMeasured: false`, and leave unknown costs/tokens
as null. Run the existing native evaluation harness separately.

## Offline checks (no inference or desktop input)

```sh
pnpm run computer:osworld:check
```

Prepare an upstream checkout and its own Python dependencies following the
[official instructions](https://github.com/xlang-ai/OSWorld). Pin its commit:

```sh
git clone https://github.com/xlang-ai/OSWorld /path/to/OSWorld
git -C /path/to/OSWorld checkout 8903ebeb0efdf74331bd7dc37ed91ccbbff22317
python3 scripts/osworld/run.py --osworld-root /path/to/OSWorld \
  --environment-id ubuntu-image-sha256-and-snapshot-revision \
  --output .cache/osworld-results/baseline --preflight
```

Preflight checks the checkout revision, tracked modifications and all selected
task hashes. It never resolves credentials, contacts a model, starts a VM or
provisions cloud resources. It does not certify the guest image or authentication.
The Docker image is x86; the current macOS ARM64 Docker installation is not a
verified host. Provide a working x86 VM/provider before running live evaluation.

## After GPT-6.1 authorization and VM setup

Use the Python environment in which the upstream dependencies are installed.
The Node bridge needs this repository's `pnpm install` dependencies. An xopc
GPT-6.1 connection must already be configured. Pass `--model provider/gpt-6.1-sol`
to select another configured GPT-6.1 connection explicitly.

```sh
# Gated sequence: two smoke successes, then exactly 24 tasks x 3 repetitions.
python scripts/osworld/pipeline.py --osworld-root /path/to/OSWorld \
  --provider docker --environment-id ubuntu-image-sha256-and-snapshot-revision \
  --output .cache/osworld-results/experiment-001

# To inspect only the two smoke tasks without starting the baseline:
python scripts/osworld/run.py --osworld-root /path/to/OSWorld \
  --provider docker --environment-id ubuntu-image-sha256-and-snapshot-revision \
  --output .cache/osworld-results/smoke --repetitions 1 \
  --task-id e0df059f-28a6-4169-924f-b9623e7184cc \
  --task-id f9be0997-4b7c-45c5-b05c-4612b44a6118

# Full development baseline after smoke succeeds; use a new directory for a candidate.
python scripts/osworld/run.py --osworld-root /path/to/OSWorld \
  --provider docker --environment-id ubuntu-image-sha256-and-snapshot-revision \
  --output .cache/osworld-results/baseline --repetitions 3

python3 scripts/osworld/report.py \
  .cache/osworld-results/baseline/report.json \
  .cache/osworld-results/candidate/report.json --check
```

The pipeline recomputes the smoke scores from raw runs. A successful process exit,
a model connectivity check, missing tasks, or unconfirmed cleanup cannot unlock
the baseline. Both task scores must be 1 with no takeover. Baseline completion
means all 72 independent evaluations finished; failed task scores remain in the
report for subsequent optimization.

Use the same explicit HTTP proxy environment as the Gateway when the host needs
one. Node does not automatically inherit macOS system proxy settings. Include
`localhost,127.0.0.1,::1` in `NO_PROXY` so guest control traffic stays local. The
benchmark never changes the system proxy or switches model connections.

`--provider aws` explicitly provisions chargeable cloud infrastructure using the
upstream provider; select it only for an already authorized evaluation environment.
For VMware, pass `--provider vmware --vm-path /path/to/Ubuntu.vmx`.
Set `OSWORLD_CLIENT_PASSWORD` if the guest password differs from the upstream default.

Use a new output directory per run. Each task/repetition starts from an upstream
reset, and only the official evaluator supplies `score`. The private report is
checkpointed after every run. Missing runs remain in the planned denominator;
setup, model, dispatch and oracle errors stay separate from completed tasks.
Any input delivery failure interrupts the matrix; there is no automatic input
replay or resume. Guest cleanup runs in `finally`.

Comparisons recompute summaries and reject changes to tasks/hashes, model, image
identity, resolution, budgets, observation mode or provider. `--check` fails on
missing/error runs, any previously successful task becoming unsuccessful, any
partial-score reduction, or any false success claim. A pass certifies only this
paired regression check; it is not a product release certification.

For native product reports, strict checking is also available:

```sh
pnpm run computer:evaluate:compare baseline.json candidate.json --check
```

2026-11-07: authorization was restored and the GPT-6.1 synthetic visual/action
protocol check passed (two requests, no native input). This is not an OSWorld
smoke result. An official Ubuntu guest still needs to be prepared before running
the two-task smoke and 72-run baseline.
