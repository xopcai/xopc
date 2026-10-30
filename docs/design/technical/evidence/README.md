# Retained acceptance evidence

Retain small records that are used by executable analysis, current work, or independent cross-run comparisons. This includes harness decisions/usage accounting, computer-flow trials, recent setup/latency summaries, and Phone Use v1/v2 frozen source/traces used by `scripts/phone-apps-live/analyze-execution-latency.py`. Raw evidence is historical, not a current availability claim.

Historical screenshots, intermediate Phone Use candidates/pilots and unconsumed raw runs were removed on 2026-10-29 after preserving useful results and limitations in the accompanying reports. References inside immutable historical JSON to omitted screenshots/archives record original run paths; recover the original files from Git history if needed. Untracked evidence from ongoing work was left intact.

New routine runs belong under `/tmp` or ignored `.xopc-evals/`. Commit a concise technical summary and only the data required to reproduce a meaningful comparison or verify a maintained contract. This was a retention cleanup, not a new acceptance run.

On 2026-10-30, routine Computer Use profiling dumps, repeated Calculator screenshots,
window-preview and HarmonyOS video run records, and session-input browser screenshots
were removed. Technical reports retain the results, scope and limitations; maintained
verification scripts generate fresh reports in temporary or ignored cache directories.
