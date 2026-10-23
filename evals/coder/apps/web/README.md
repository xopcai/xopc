# Evaluation workspace

A read-only, task-oriented interface for understanding benchmark results and improvement decisions.

## User paths

- **Overview** (`#overview`): identify benchmarks needing attention, inspect recent changes, and follow active or recent evaluations. Every headline metric opens its corresponding filtered list.
- **Benchmarks** (`#benchmarks`): search by task or capability and filter by evidence coverage. Each benchmark explains its question, current finding, result history and evaluation method.
- **Results** (`#evidence/:id`): read the observed pass count, evidence validity and model coverage separately. Inspect unresolved checks first, follow associated improvements, or compare with another result. Full provenance remains expandable.
- **Comparison** (`#compare`): contextual entry from a benchmark or result. Select two distinct records from the same benchmark; no manual evidence IDs. The server's comparability gate stays authoritative, and its blockers are explained before paired outcomes.
- **Runs** (`#runs`, `#runs/:id`): follow execution status and job completion, then open related results. Request pools, accounting and configuration are technical details.
- **Improvements** (`#improvements`, `#improvements/:id`): filter pending, accepted and rejected changes. Details separate the decision, scope, blockers, verification checks and supporting results. Supplements never replace the original decision.

The four primary navigation entries are Overview, Benchmarks, Runs and Improvements. The existing evidence-library and comparison deep links continue to work.

## Interaction and evidence rules

- Theme and language preferences persist. UI explanations are localized; original model output, IDs, evidence and decisions retain their original text.
- Filter links reset unrelated query state. A selected scenario filters result options before comparison.
- Missing assessments are not displayed as zero successful checks. A valid source is not a claim that every task passed, and execution completion is not a promotion.
- Related decisions use explicit evidence IDs or existing per-job ledger/source lineage. The UI does not modify or infer grades.
- Data comes from existing GET APIs. The workspace does not launch paid model calls, rerun tasks or mutate decisions. Evaluation execution remains in repository plans; the benchmark page explains that boundary.
- Details use progressive disclosure. Live refresh preserves focused controls and expanded records; unchanged HTML does not replace the active view.
