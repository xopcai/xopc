# Chat performance: measured changes and regression contracts

## Implemented

- Session history loads now serialize per conversation rather than across all conversations. A slow old conversation cannot block opening the selected one. Requests within the same conversation retain pagination/refresh ordering. Late failures and pagination cursors from another route cannot overwrite the selected view.
- History and agent configuration start concurrently. Receipt reconciliation is shared while pending on the same SessionManager, scoped by Gateway identity and conversation, so parallel reads do not duplicate receipt confirmation. Completed reconciliation is never cached. History snapshots retain the existing completed-turn/reset fence before applying configuration.
- All chat message surfaces show their first streamed text immediately. Subsequent deltas retain backpressure, grapheme boundaries, reduced-motion behavior and terminal atomic commits.
- Math allowance calculation reuses completed block counts. When allowances do not change, it also preserves the Context value identity, allowing completed Markdown blocks to stay memoized. Replacements, truncation and the 256-expression budget remain covered.
- Opt-in production diagnostics expose existing rendering and response timings, plus startup, local draft creation and history/config phases. Samples are bounded and remain in the current renderer; there is no upload pipeline.

## Reproduce

```sh
pnpm run test:chat:performance
pnpm run test:chat:bench
pnpm run test:chat:browser
pnpm -C web run build
```

The browser check builds an isolated production fixture from the real renderer and pacing hook, launches installed Chrome, checks immediate first text, complete terminal output, Chinese/math/table/code rendering, production diagnostics opt-in and page errors. It cleans up its temporary build. It does not call a model or open user conversations.

The performance contracts are normal Web Vitest tests and run in the existing CI test shards. They cover no cross-session head-of-line blocking, same-session ordering and recovery, concurrent configuration/history, late error isolation, count reuse and no rerenders of 100 completed blocks across 10 tail updates. CPU milliseconds are reported rather than gated on shared CI machines.

## Local results

Synthetic benchmark on Node 26.12.1, 500 completed blocks, 100 tail deltas, 20 measured runs after warmup, alternating baseline/optimized order:

| Operation | Baseline | Optimized |
| --- | ---: | ---: |
| Math allowance calculation p50 | 8.502 ms | 0.024 ms |
| Math allowance calculation p95 | 11.048 ms | 0.044 ms |
| Selected session scheduling, unrelated request delayed 100 ms | 103.858 ms | 0.016 ms |

Math scans across all runs including warmup fell from 1,050,000 to 12,600 (including initial cache construction). The math benchmark executes the actual math scanner and checks output equivalence on every delta. The scheduling benchmark isolates queue behavior; it excludes HTTP, SQLite and rendering. These numbers are not end-to-end app or inference speedups.

## Validation

- Web suite: 570 files, 3,335 tests passed.
- Web ESLint: passed.
- Final production build, including TypeScript: passed.
- Real Chrome production fixture: passed, zero page errors.
- `git diff --check`: passed.

## Diagnose an installed build

In the renderer's developer console:

```js
localStorage.setItem('xopc.performance', '1');
location.reload();
// Perform the interaction, then inspect:
window.__xopcJourneyMetrics();
window.__xopcResponseLatencyMetrics();
window.__xopcStreamingRenderMetrics();
window.__xopcPageRenderMetrics();
```

Remove the localStorage key and reload to disable production collection. Development builds enable it by default. Journey samples carry numeric operation IDs so concurrent loads can be separated, phase names and elapsed monotonic milliseconds. No message text or credentials are captured by these new journey samples. Existing response/render snapshots retain run/stream IDs.

Startup phases use navigation-relative time and include credentials ready and the first enabled, non-hidden composer animation frame. This is a readiness/frame proxy, not proof of a displayed frame. History committed means the client store was updated, not that the browser painted. Response timings distinguish first text received from the first animation frame with rendered Markdown text. The browser sample and Gateway logs use the same run ID so browser and server durations can be inspected without subtracting clocks across machines.

## Send to visible text and streaming paragraph checks

The browser records elapsed time from the composer send action to sender entry, first POST attempt, HTTP response, input acceptance, association with the accepted run, first realtime text, and the first frame with rendered Markdown text. Endpoint claim and environment capture are reported as individual durations. The regular session input command also reports Gateway validation and receipt time through `Server-Timing`. The model logs report Gateway run entry to the first model request, first model content delta, and first model text. The Gateway first text log reports persisted input queue time and run time to text. A model delta can contain reasoning or tool arguments before visible text. Runs that finish before the sender can associate them with a run ID and recover through history have no realtime first-text sample.

Generic image links register with their Markdown renderer. Ordinary paragraphs do not participate in duplicate image detection. When a candidate is present, changes in the Markdown DOM can update the link when an adjacent image appears, changes, or is removed. The media source remains available when the image shows its retry state.

```sh
pnpm run test:chat:browser --benchmark
pnpm run test:web:activity:e2e
```

The Chrome benchmark alternates the previous layout scan and the optimized renderer over the same 500 completed paragraphs and 180 measured tail updates per variant. The previous scan visited 90,180 paragraphs. The optimized path performed zero full scans. The final run measured synchronous React commit p75 at 0.8 → 0.7 ms and p95 at 1.2 → 1.0 ms.

The activity browser test uses production Web, an authenticated Gateway, SQLite and realtime, with a controlled local model. One pure reply sample reached first visible text in 491.3 ms. The browser recorded POST start at 30.0 ms, input acceptance at 61.6 ms, run association at 464.3 ms and first realtime text at 470.3 ms. For the same run, the Gateway reported 4.8 ms to the input receipt, 3 ms in the input queue, 132.3 ms from Gateway run entry to the model request, and 16.0 ms from the model request to its first content delta. The browser waited 402.7 ms between input acceptance and run association, consistent with the 400 ms input-state polling interval. The final verification measured 486.7 ms to first visible text and 406.8 ms from acceptance to run association. Web regression passed all 3,336 tests, the selected backend suites passed all 69 tests, and the production build and both Chrome checks passed.

## Remaining measurement work

Collect representative cold/warm, local/remote Gateway p50/p75/p95 distributions from real interactions before setting end-to-end budgets. Profile the initial bundle and composer subscriptions, long-list layout/scroll, syntax highlighting and server preparation separately. The current work does not claim a measured Electron cold-start reduction, production p75 reduction, provider inference acceleration, or 120 fps. Static composer handoff, worker parsing and V8 code caches should follow evidence from those profiles.
