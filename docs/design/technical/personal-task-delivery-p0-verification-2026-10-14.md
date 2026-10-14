# Personal delivery P0 implementation and verification

Date: 2026-10-14, Asia/Shanghai. Scope: P0 reliability, concise defaults and the first benchmark baseline. General research verification and automatic repair remain later stages.

## Implemented

- Personal submit/create preserve omitted output, acceptance and constraint fields. Default contracts survive; explicit arrays remain explicit. The main conversation still submits quickly without an extra planning model call.
- Delivery preserves the latest outcome's partial/failed state instead of inferring full completion from run success. Status text distinguishes returned text, available artifacts, partial work and incomplete requests.
- Composer rejects model-authored host/workspace file links and MEDIA directives. Recorded worker reports and fallback prose are sanitized before display; unpublished local links with no available artifact downgrade delivery to partial. Literal code and HTTP source links are retained.
- Main conversation and Composer share a concise-default rule: usually 1–3 sentences, without repeated requests, directories, execution recaps or closing offers. Explicit detail, exact text, code and important uncertainty take precedence. New Personal profiles default to brief; existing explicit preferences remain intact, and the existing instruction-upgrade mechanism adds the shared rule.
- A published report no longer causes its entire contents to be appended by default merely because it is long or contains code. Explicit exact/full-content requests continue to preserve the material.
- If composition fails and files are available, fallback quotes a short explicit reported conclusion when one exists, with a pointer to the full result and limitations. Otherwise it gives a short, honest availability message. Text-only and exact-content requests retain their recorded content instead of being blindly truncated.
- The legacy messaging hint no longer describes MEDIA text as file publication. Structured artifact or messaging tool results provide delivery.

No new API routes or database tables were introduced for P0.

## Deterministic comparison

The same eight-case fixture ran against the unmodified production source at `cb13eb3109ba22d0e5670b0774af2b8371221ff7` and the current candidate. The baseline used a disposable detached checkout with the new test fixture copied in; it was removed after execution. The case-file hashes match.

| Case | Before P0 | Candidate |
| --- | --- | --- |
| D04-default contract | Failed | Passed |
| D04-explicit requirements | Passed | Passed |
| B01-partial state | Failed | Passed |
| B01-failed state | Failed | Passed |
| S02-unpublished link rejection | Failed | Passed |
| S02-safe fallback | Failed | Passed |
| F02-authenticated file delivery | Passed | Passed |
| H03-concise policy/fallback | Failed | Passed |
| Total | 2/8 | 8/8 |

These are deterministic P0 invariants, not a model capability score. The file case includes real authenticated Gateway HTTP history and download, but scripted worker completion.

Reports: [pre-fix](../../../evals/personal/baselines/p0-pre-fix.json), [candidate](../../../evals/personal/baselines/p0-candidate.json). Re-run with `pnpm run eval:personal:p0`.

## Real-model complete workflow

Three isolated synthetic sales workflows were executed, including the Personal Agent, background Router, actual specialist tools/script execution, result outbox, Composer/fallback, authenticated history and downloads. All three returned all requested files (`monthly_summary.csv`, `report.md`, `reproduce.mjs`). Downloaded reports contained totals 150 and 210 with 40% growth. Unauthenticated downloads returned 401; cross-conversation access is additionally covered in the deterministic HTTP case.

| Trial | Total time | Foreground reply during execution | Final reply length | Composition |
| --- | ---: | ---: | ---: | --- |
| Exploratory 1 | 80.259 s | 1.095 s | 580 characters | Invalid JSON; exposed verbose fallback, subsequently fixed |
| Exploratory 2 | 100.861 s | 0.816 s | 165 characters | Model composition succeeded |
| Final candidate | 146.709 s | 1.552 s | 33 characters | Invalid JSON; short safe fallback delivered |

The final candidate experienced a transient network interruption and resumed the same turn. Assertions confirmed one Task, one root run, one allocation attempt, no worker tool errors and actual artifact downloads. Relevant startup/end source fingerprints did not drift. The first two trials were exploratory runs during implementation; their fingerprints were originally captured at completion and are not treated as frozen reliability measurements.

The final candidate's fallback was: “已提供 3 份成果。简短说明暂时不可用，完整结果与限制请查看附件。” It accurately reports artifact availability and avoids pretending to supply an independently verified summary. This is graceful degradation, not proof of successful conversational synthesis.

Reports: [trial 1](../../../evals/personal/baselines/live-first-trial.json), [trial 2](../../../evals/personal/baselines/live-second-trial.json), [final candidate](../../../evals/personal/baselines/live-candidate.json).

## Checks and remaining limits

- 10 related Vitest files, 132 tests passed; production TypeScript check passed; `git diff --check` passed.
- Pure text limitations, source links, exact prose/code, file access isolation, instruction upgrade, coordination and retry behavior remain covered in related tests.
- Reply model format compliance failed in two exploratory/final trials. The reports retain fallback events separately from delivery success. It needs additional format/semantic grading; P0 does not claim this model is consistently natural or faithful.
- Benchmark records source/fixture hashes, stage timings and usage. Three trials across evolving candidate versions are insufficient for pass^k, p95 or SLA claims.
- No independent claim-to-source grader, multi-turn frozen research suite, calibrated style judge or automatic repair workflow has been implemented yet.
- Gateway/model/file verification was performed through HTTP and persisted history; four-platform UI previews were not tested in this stage.
- Changes are in the workspace; the user's normal Gateway was not restarted or deployed. Other ongoing workspace changes were left intact.

The [benchmark README](../../../evals/personal/README.md) describes execution and limits. The [research plan](personal-task-delivery-benchmark-research-2026-10-14.md) remains the roadmap for subsequent stages.
