# xopc evaluation control plane

Stage-one implementation for [benchmark-driven harness evolution](../../docs/design/benchmark-driven-harness-evolution-plan.md). This is developer tooling, separate from the production Gateway. It reuses Coder Evals and preserves original evidence. Current acceptance and remaining work are tracked in [the implementation ledger](../../docs/design/benchmark-driven-harness-evolution-stage-one.md).

## Start the dashboard

From the repository root:

```sh
pnpm run eval:control import
pnpm run eval:coder:web
```

Open [the local dashboard](http://127.0.0.1:4310). It provides capability coverage, campaigns, evidence/run details, paired comparison, and improvement records. CLI and dashboard share `.xopc-evals/control/index.db`. The web server refreshes registered sources every two seconds and streams durable control events with reconnect cursors. The API is read-only and binds to loopback.

`evals/control/sources.json` is an explicit import list: checked-in Personal baselines plus local coder/style/memory archives. A clean clone may lack those local archives; missing sources remain visible and `import` exits nonzero. Supply your own list with `--sources FILE`. No recursive scan or source migration occurs. Registering a new source requires the CLI, not an anonymous web request.

```sh
pnpm run eval:control import --sources /absolute/path/sources.json
pnpm run eval:coder:web --sources /absolute/path/sources.json --port 4311
pnpm run eval:coder:web --db /absolute/path/evals.db
```

Legacy `--db` registers a read-only source with **unknown** evidence class/provenance; it does not assume model evidence. Existing raw databases/artifacts remain the trajectory authority. The index retains revisions and can be rebuilt by reimporting explicit sources. Back up the index if you need its campaign controls or manually entered improvement records: those cannot be reconstructed from source evidence alone.

## Run the stage-one pilot without model calls

Use a fresh output directory; existing evidence is never overwritten:

```sh
pnpm run eval:control run \
  --plan evals/control/plans/stage-one-pilot.json \
  --output .xopc-evals/control/pilot-new
```

Four jobs run with bounded concurrency:

- Convergence core: C01/C02, both reference and intentionally broken controls.
- Convergence growth: E01/E02/P01, both controls.
- Delivery recovery: F01/F02, both controls.
- Personal P0: eight actual deterministic regressions, including authenticated HTTP delivery.

The first three jobs are **harness calibration**, not xopc model scores. A successful campaign means the reference passes and the broken controls fail as intended, while P0 passes. It is not promotion of a product patch. Each job records its exit, evidence import errors, duration, immutable attempt result and bounded/redacted diagnostic log.

Campaign plans execute trusted repository Node programs with an argument array, never an interpolated shell command. They are not an untrusted-code sandbox. Concurrent jobs have independent temporary state via their existing adapters; use `resource` to serialize jobs sharing a desktop or other mutable external resource. Dependencies form explicit execution waves; downstream work starts after the ready wave drains. This initial scheduler does not implement distributed workers or dynamic critical-path prioritization.

## Pause, cancel and resume

Copy the full campaign ID from the running dashboard:

```sh
pnpm run eval:control signal --id CAMPAIGN_ID --action pause
pnpm run eval:control signal --id CAMPAIGN_ID --action resume
pnpm run eval:control signal --id CAMPAIGN_ID --action cancel
```

Pause stops new admission and allows active work to drain; cancel terminates active process groups and preserves results. Both retain their time in the campaign wall budget. The dashboard shows acknowledgement, not merely a sent command.

After a stopped owner has exited:

```sh
pnpm run eval:control run --resume \
  --plan evals/control/plans/stage-one-pilot.json \
  --output .xopc-evals/control/pilot-new
```

Resume requires identical plan and source fingerprints. Completed passes are reused, valid failures are not replaced, and interrupted jobs need explicit `replaySafe`. Replays use a new attempt directory, preserving the old output. Nonzero active leases require external-state reconciliation rather than an automatic fresh request. Campaign time and admitted request budgets carry over. A process killed without a final checkpoint remains running until operator reconciliation; there is no automatic owner takeover or TTL-based side-effect replay.

## Physical request pool and live pilot preparation

For multiple campaigns sharing a provider quota, start a long-lived common parent broker and pass its private endpoint file to **every** campaign in that quota group:

```sh
pnpm run eval:control pool --generation 4 --judge 2 --parent 4 \
  --output .xopc-evals/control/shared-pool.json
# In another terminal:
pnpm run eval:control run --pool-endpoint .xopc-evals/control/shared-pool.json \
  --plan /absolute/path/live-plan.json --output .xopc-evals/control/live-pilot-new
```

The endpoint file contains a private local token (mode 0600); do not commit or share it. If the broker is unavailable the campaign fails closed, without starting an independent fallback. Independent campaigns that omit this option have independent quota scopes; their limits must not be presented as a global provider cap. The integration test runs two separate local brokers and child processes under one shared parent and verifies the actual combined streaming concurrency.

A campaign hosts one shared authenticated lease broker for its child process tree. It applies generation/judge role limits and a common parent limit; declared model-origin fetches hold leases until stream EOF/cancellation. Queue cancellation removes pending leases; 429/503 reduces the role target. Queued/acquired/released events include worker PID and request ID, never request bodies or credentials.

Prepare a live plan without making requests:

```sh
pnpm run eval:control prepare-live \
  --model provider/model \
  --origins https://provider-api.example \
  --output /absolute/path/live-plan.json
```

The placeholders must be replaced with a registered API-key or configured XOPC Cloud model and its actual HTTP origin(s). The generated plan defaults to two isolated Gateway workers, one repetition of seven selected direct-agent tasks, a shared parent limit of four requests, 160 admitted instrumented requests, and a 20-minute campaign wall budget. Per-case inherited token/time/request limits remain in force. Inspect and adjust this explicit budget before executing:

```sh
pnpm run eval:control run --plan /absolute/path/live-plan.json \
  --output .xopc-evals/control/live-pilot-new
```

The existing launcher resolves API keys locally and starts/cleans up separate Gateways. Unsupported API-key/model configurations remain setup failures. Other OAuth/custom model adapters still require their established isolated setup. `--include-personal` adds one real mixed delivery/repair workflow using the **existing configured Personal/router/worker/review models**, which may differ from `--model`; this adapter retains its `XOPC_ALLOCATION_LIVE=1` opt-in. Declare all corresponding model origins and inspect the saved identities.

Coverage is explicitly **fetch to declared origins**, not proof that every SDK/custom dispatcher/HTTP client was observed. Nonmatching HTTP and native transports are not intercepted. `verifiedAllModelCalls` remains false until a real-model wire/usage reconciliation is supplied; no automatic promotion relies on this instrumentation alone. An unknown owner remains uncertain; an OS-confirmed dead local owner can release a lease without replaying the call. Token totals and billing may remain unknown; a request limit is not a provider billing cap.

## Compare, annotate and validate

Use evidence IDs from the evidence view; the dashboard also offers baseline/candidate links:

```sh
pnpm run eval:control compare --left EVIDENCE_ID --right EVIDENCE_ID
pnpm run eval:control improvement --file evals/control/plans/improvement-example.json
pnpm run eval:control:check
node --import tsx evals/control/acceptance.ts .xopc-evals/control/concurrency-new.json
```

Comparison checks suite, selection, model, reasoning, fixture, grader, lockfile, environment, budget, completeness and validity. Source fingerprints may differ as the treatment. Unknown identity yields `insufficient_evidence`. Unresolved quality is not a tie or a pass. The current comparison preserves variant labels; use matched variant identities across experiments. It does not infer statistical significance or authorize promotion.

The acceptance script measures eight isolated Git fixtures with controlled mock delay, actual preparation/diff/graders/cleanup, and concurrency 1 versus 4. It makes no model calls. Output is created once and includes the timing ratio, observed peak, environment and all-eight correctness gates.

## Evidence interpretation

Importers project coder SQLite, delivery JSON, style summary and memory judgments into the same index. Summary-only EQ retains trait data and a null quality score rather than manufactured case outcomes. Missing provenance stays unknown. Source drift is invalid; partial results remain partial. Source-run metadata and scores are fingerprinted before detail reads; changed source revisions cannot silently replace an old run view. Full trajectory payloads stay in the original source and are fetched by page; the index digest is not a cryptographic archive of all source events/artifacts.

Predeclared pilot decisions are supported below; sealed independent-evaluation services remain future work. First-stage infrastructure passing, a historical model score, and a newly demonstrated product improvement are separate evidence classes and decisions.

## Real-model reconciliation and immutable candidate decisions

The API-key launcher also supports the configured `xopc-cloud` model catalog and shared credential directory. It uses the standard credential refresh path and never copies OAuth refresh tokens into a sandbox. Pin a concrete model rather than a routing alias for paired trials. `run-benchmark-live.mjs --max-turns 8` applies a single harness configuration treatment; its manifest records the treatment. Production defaults are unchanged.

Before model calls, freeze the source and register the hypothesis, disjoint development/validation selections, quality protection and numerical gate. [The first real pilot plan](./plans/convergence-turn-cap-live.json) and [its registration](./plans/convergence-turn-cap-registration.json) are historical examples, not recommendations for an 8-turn default. The candidate was rejected.

Each child writes an append-only `JOB-model-requests.jsonl` with physical request/lease IDs, model/origin, payload hash, response ID, terminal status and streamed provider usage. Bodies, response prose and authorization headers are excluded. Declared model endpoint paths on an undeclared origin are blocked; native HTTP/SDK bypasses remain outside this fetch-only coverage. Request retries consume fresh leases and remain separate observations.

After task evaluation, the launcher drains auxiliary usage for at most 15 seconds, stops the isolated Gateway and exports the allowlisted runtime usage ledger. EOF/cancellation releases leases. An OS-confirmed dead local PID can release an orphaned lease and its upstream parent; a live/unknown owner is never expired by age. Reclamation is not proof that a provider stopped billing, and never replays the request.

`reconciliation.ts` compares physical requests, runtime ledger rows, task response events and auxiliary operations. It preserves missing usage and provider/runtime token discrepancies. Partial observed totals remain separate from complete totals; neither estimated zero cost nor missing receipts become a settled zero bill. `observe-live-ledger.mjs` is a read-only compatibility sidecar for older frozen launchers; its final snapshot is explicitly not guaranteed.

Finalize a registered pilot once all outputs are present:

```sh
pnpm run eval:control assess-cycle \
  --file /absolute/path/registration.json \
  --output /absolute/path/development-campaign \
  --validation-output /absolute/path/validation-campaign \
  --id IMPROVEMENT_ID
```

Omit `--validation-output` when both phases share a campaign. This writes `decision.json` once and persists an immutable decision plus evidence links in the improvement record. The Dashboard shows phase results, physical/runtime/task counts, auxiliary calls, token differences and rejection reasons. It does not modify production defaults. A retry or changed hypothesis requires a new candidate record; do not overwrite a rejected decision or quality failure.

## Usage correction acceptance and evidence preservation

`src/usage/cloud-wire.ts` observes the unmodified Cloud response through the SDK's scoped fetch option. It preserves a valid `total_tokens` on both terminal stream events and completion results. It does not infer missing cache components, alter model text/tools, or treat a token count as a charge. The evaluation preload independently records numeric raw usage and links physical request IDs, Cloud request IDs and runtime usage-event IDs. Judge/review operations use the judge pool; the parent limit still covers every role.

The isolated launchers wait for both zero running ledger rows and zero open HTTP tails, with a stable idle interval, before normal shutdown. Process exit writes an interrupted terminal record synchronously. After confirmed owner death the controller may append an `owner_dead` record with **unknown** usage; it never invents an EOF or a zero bill. The post-stop exporter opens a fresh read-only SQLite connection because `GatewayService.stop()` closes the application's connection. Aborted requests without provider final usage remain unknown.

The configured-model acceptance plans are [the broad trial](./plans/usage-tail-verification.json) and [the fresh independent ledger trial](./plans/usage-tail-independent-ledger.json), with separate preregistrations. The latter passed three repetitions and all 44 physical request identities/totals/tails. The broad trial remains rejected: an underspecified grading constraint required protocol review, and Personal mixed timed out. Neither failure was replaced by a successful rerun.

```sh
pnpm run eval:control assess-verification \
  --file evals/control/plans/usage-tail-independent-registration.json \
  --output /absolute/path/new-campaign --id IMPROVEMENT_ID
pnpm run eval:control supplement --id IMPROVEMENT_ID --file /absolute/path/new-evidence.json
pnpm run eval:control export --output /absolute/path/fresh-metadata-export.json
```

An evidence source can declare `review: "/absolute/path/protocol-review.json"`. A review with `blocking: true` produces an **unknown** validity revision and keeps original trial grades; comparison/promotion cannot silently use it as valid evidence. Review bytes participate in the revision ID. Restart a running Dashboard after changing normalization code before importing reviews. All prior projections remain available by ID.

Supplements append evidence outside the immutable decision and retain its hash. The Dashboard labels the original decision and shows the latest supplementary audit without rewriting source databases, original scores or decision files. Exports contain normalized metadata and source references, not raw transcripts/credentials; they are local files and do not publish anything. For revised grading, freeze a new suite/grader version and a new output directory, retain the original experiment and review lineage, then import the new result; there is no overwrite-style regrading command.

The sealed local family uses macOS `sandbox-exec` to deny the evaluated Gateway and descendants access to the suite/grader directories in both checkouts. Host grading is outside that sandbox. This is a local evaluated-process boundary, not a remote evaluator account or a generally hostile optimizer isolation service. Other platforms fail closed until an equivalent boundary is implemented.


### Personal convergence and cancellation acceptance

The 2026-10-23 follow-up is recorded in [the stage-one acceptance ledger](../../docs/design/benchmark-driven-harness-evolution-stage-one.md#8-personal-超时与取消请求分项用量复验2026-10-23). Keep cancellation telemetry in `cloud-cancellation-accounting`; it cannot qualify as Personal task-quality evidence.

- `scripts/verify-cloud-cancellation-live.mts --configured-models --output <fresh-directory>` intentionally cancels after the first real text delta. Both trials must remain aborted and collect final total/input/output within the bounded drain. Run through an instrumented campaign; retain every failed trial.
- `scripts/verify-personal-delivery-evidence.mts --configured-models --report <retained-trial.json> --output <fresh-directory>` inspects the original database read-only, reproduces downloaded outputs in a sandbox, runs a real wrong-price negative review and tests authenticated downloads through a cloned Gateway. It appends inspection evidence; it never replaces the original grade. It currently requires macOS sandbox-exec and has no unsandboxed fallback.
- `personal-convergence-live.json`, `cancellation-components-live.json` and their preregistrations are frozen historical plans. Use a new ID/output/registration for the next candidate. The original cancellation-components plan misclassified its imported source as Personal; an append-only normalization correction assigns it to `cloud-cancellation-accounting` while keeping the frozen plan unchanged.
- `assess-verification` accepts `kind: "cancellation"` jobs and validates aborted status, response timings, source hashes, HTTP/runtime identity and observed usage components. Review the original decision and the later supplements separately.

A settled receipt with zero charge does not establish zero consumed tokens. Missing final usage stays unknown, even after the platform releases its reservation.


### Fixed Personal v7 latency gate

`assess-personal-latency --file <preregistration.json> --output <completed-campaign> --candidate-root <frozen-source> --id <improvement-id>` records an immutable decision. It requires one full mixed v7 trial, original quality success, unchanged 20s submit / 5s acknowledgement / 5s ping / 10min delivery gates, the local250ms persistence gate, frozen candidate file hashes and independent request reconciliation. A fast partial trial never replaces a failed full trial. Register a fresh candidate/output before each changed implementation; preserve every attempt.

The three 2026-10-24 latency plans are historical preregistrations. They were run sequentially with unchanged configured models; all three were rejected. Local private retained evidence excludes configuration and credential files. New latency/diagnostic observations append supplements to the original decision.
