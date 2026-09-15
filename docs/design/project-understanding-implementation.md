# Lightweight project understanding

## Product behavior

- All three project creation forms offer a checked-by-default “Automatically learn about this project” option.
- Creation queues understanding and returns immediately. The project and chat remain usable.
- The project overview shows a quiet status and a collapsed, editable summary. The sidebar project menu offers one-click start, refresh, or retry.
- Background runs never reveal their internal session, open onboarding, or publish work-discovery notification events.
- Project facts stay in project knowledge. Generated understanding does not create personal assertions or confirmed user goals.

## Implementation and phase reviews

### Phase 1 — reuse understanding

Extended `WorkDiscoveryService` with a background mode, reusing the existing bounded probe, investigator, analyzer, and evidence storage. Migration 172 adds mode and attempt count to existing discovery runs.

Background requests produce a concise overview instead of conversational recommendations. Each attempt has a 90-second cancellation deadline, the overview response has a 2,000-token budget, and automatic execution allows at most two attempts.

Review fixes: keep projects visible when they contain only internal sessions; preserve owner corrections during regeneration; check cancellation before publishing analysis; keep generated project understanding out of personal assertions.

### Phase 2 — creation and project UI

Creation accepts `autoUnderstand`; only an explicit `true` queues work. Frontend controls supply their checkbox value. A shared component implements the checkbox, quiet project panel, and menu action.

`GET`, `POST`, and `PATCH /api/projects/:id/understanding` provide status, start/retry, and corrections. The family has its own authenticated lazy bundle, including positive and neighboring negative mapping tests.

Review fixes: preserve successful creation when background startup fails; emit project refresh from the project switcher creation path; consistently exclude hidden sessions from project session lists, removing the old shell-specific filter.

### Phase 3 — lifecycle and conversation context

The Gateway owns the understanding service. Removed the route-owned WeakMap cache. Gateway post-ready startup resumes pending background work; shutdown cancels and awaits tracked executions while retaining interrupted background requests for bounded recovery. Project deletion cancels its current background run.

The overview is a canonical project-scoped knowledge item with evidence references. Normal project conversations reuse it through the existing knowledge context path, respecting knowledge inclusion/source settings. Explicit owner corrections are retained on subsequent analysis.

Review fixes: change retry status back to queued before asynchronous preflight; merge overlapping requests while execution is active; prevent background retry from bypassing execution budgets; retain normal knowledge excerpt limits while allowing a longer project overview.

## Validation

- 141 related tests passed across 16 files.
- Includes real loopback HTTP requests through Gateway authentication and lazy dispatch, unchecked creation, failure isolation, retry, deletion, and overview correction.
- Includes background deduplication, shutdown/resume, hidden sessions, project context reuse, owner correction preservation, project isolation, and existing probe/investigator regressions.
- React tests cover one-click opt-out, collapsed results, and one-click retry without dialogs.
- Backend typecheck, frontend production build, targeted frontend lint, and diff whitespace checks passed.
- Model behavior in orchestration tests uses test doubles; no paid live model run was required. The analyzer's prompt and output handling are tested separately.

## Delivery

Source changes include migration 172. Build and restart the Gateway when deploying so backend code and schema advance together. Existing projects are not automatically enrolled; users can start understanding from a project menu or overview.
