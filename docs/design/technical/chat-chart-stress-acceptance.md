# Chat chart performance and stability acceptance

Date: 2026-10-17.

## Scope and reproduction

Run from the repository root with dependencies installed and Chrome available:

```sh
node scripts/verify-chat-chart-stress.mjs fixed-1x
CHART_STRESS_CPU=4 node scripts/verify-chat-chart-stress.mjs fixed-4x
CHAT_RENDER_RUNS=1 node scripts/test-chat-rendering.mjs chart-stability
```

`CHART_STRESS_ROUNDS` defaults to six. The stress runner prints its temporary result directory and writes JSON measurements and screenshots there. A failed assertion, browser exception, or budget violation fails the run. The runner builds an isolated production Vite entry using the real `MessageList`, Virtuoso, session store, preview scheduler, Radix dialog, theme store, Markdown chart renderer, and ECharts Canvas runtime. No mock chart engine or live model calls are involved. It does not create or modify user conversations. This is renderer acceptance; authenticated Gateway and Agent generation are covered separately by the default Agent matrix.

The bundle adds test-only wrappers around ECharts `init`, `setOption`, and `dispose`. Counters retain only IDs and color strings, never chart instances or DOM nodes. The production runtime has no instrumentation added. Chrome DevTools Protocol measures heap usage, DOM counters, and forced GC. Renderer RSS is the sum of this test browser's renderer processes, sampled using `ps`; it is not chart-only memory.

## Scenarios and gates

| Scenario | Coverage |
| --- | --- |
| Virtual history | 300 and 1000 messages; alternating user/assistant; 500 charts in each 1000-message session |
| Many charts in one response | 40 mixed line/bar charts, traversed vertically; repeated previews of both types |
| Large series | One chart with eight series and 1000 categories, 8000 total points |
| Chart content | Signed values, zero, gaps, multiple series; fixed synthetic data |
| Scrolling | Six rounds of 40 wheel events, forward and backward, in real scroll viewport |
| Preview | Eight open/close cycles per round; extra line/bar preview cycles in dense response |
| Theme | Eight light/dark changes per round with browser view transitions enabled; changes while preview is open |
| Session switching | Two cached 1000-message sessions; six switches per round, distant history targets, and switching with preview still open |
| Teardown | Unmount and double GC after each round; final session-cache removal and GC |
| Existing history behavior | Separate production browser fixture: history navigation, selected text retained, prepend anchor stable at 300 and 1000 messages |

Budgets: at most two active inline instances, at most three including a dialog, at most 80 mounted virtual rows during chart interactions, zero instances after unmount, exact created/disposed balance after final teardown, and at most 8 MiB retained JS heap growth from warm state. Scroll rAF interval P95 must be at most 34 ms at native CPU speed or 50 ms under 4x throttling; at most 5% of sampled scroll intervals may exceed 50 ms. Per-phase maximum intervals and long tasks are preserved even when P95 passes.

The selected-text path intentionally retains history while a selection is active. Its existing behavior is tested separately; the 80-row interaction budget applies to chart controls and previews without a text selection.

## Defects found and fixed

1. **Chart controls disabled virtualization.** Focus inside any message set `increaseViewportBy` to 100,000,000. A chart action expanded 9 mounted rows to all 1000 messages and about 27,032 DOM elements. Closing a preview could restore focus and repeat the expansion. The list now widens only for a live text selection. Chart buttons and preview focus restoration keep the ordinary virtual window.
2. **Chart theme could lag the page.** The store notified subscribers before the view-transition callback applied DOM theme attributes. Recreating a chart in response to the store could read old CSS variables. `ChartCanvas` now observes actual root theme attributes, coalesces updates into rAF, and refreshes options only when computed colors change. It reuses the instance and disconnects its observer on teardown.

Regression tests cover bounded focus behavior, selection retention and release, delayed DOM theme application, instance reuse, and no updates after unmount.

## Measurements

Environment: Apple M5 Pro, macOS arm64, headless Chrome 155.0.8059.40, viewport 1280 × 900. Both accepted runs use production bundles and fixed synthetic data. These are local acceptance budgets, not a device-independent performance guarantee.

| Metric | Before fixes, two rounds | After fixes, six rounds, native CPU |
| --- | --- | --- |
| Result | Failed virtual-window and theme checks | Passed |
| Mounted rows after chart focus | 1000 | 9 |
| DOM elements after chart focus | 27,032 | 278 |
| Focus phase rAF P95 | 483–1117 ms | 16.6–16.7 ms |
| Preview phase rAF P95 | 383–433 ms | 16.7–16.8 ms |
| Scroll rAF P95 | 16.7–16.8 ms | 16.7–16.8 ms |
| Active instance peak | 3 | 3 |
| Created / disposed at end | 237 / 237 | 582 / 582 |
| Retained heap, warm → round six | Not the same iteration count | 26.33 → 28.51 MiB (+2.18 MiB) |
| Retained heap after clearing sessions | 29.78 MiB | 25.66 MiB |
| DOM nodes after each round's GC | 36,550 | 382 |

The native run has zero scroll frames over 50 ms and no browser exceptions. One session-switch phase had a 466.6 ms maximum interval, despite P95 ≤16.8 ms; the raw report retains this outlier. It was not a repeated scroll stall. Renderer RSS after round one through six ranged from 397 to 427 MiB, below its warm sample of 471 MiB. RSS includes browser/runtime allocations and allocator retention; JS GC and instance counters alone do not measure GPU memory. Within this test duration, instances release exactly and retained DOM counts remain stable; this does not establish leak freedom over an hours-long run.

The earlier baseline has two rounds and fewer dense-preview checks. Compare its common focus/preview phases to the accepted run, rather than total duration or total allocations.

The separate **4x CPU run also passed all gates**, with six rounds:

| Metric | 4x CPU |
| --- | --- |
| Scroll rAF P95 | 16.7–16.8 ms |
| Scroll intervals over 50 ms | 0–0.66% per round; one 100 ms maximum interval |
| Session-switch rAF P95 / maximum | 33.3–50 ms / 150.1 ms |
| Virtual rows / DOM elements after focus | 9 / 278 |
| Instance peak; created / disposed | 3; 513 / 513 |
| Retained heap, warm → round six | 26.35 → 28.38 MiB (+2.03 MiB) |
| Retained heap after clearing sessions | 25.64 MiB |
| Highest sampled heap before GC | 55.98 MiB (allocation pressure, not retained heap) |
| Renderer RSS after round one through six | 424–489 MiB |
| DOM nodes after each round's GC | 382 |
| Browser errors / gate violations | 0 / 0 |

The 4x report includes extra live heap samples and screenshots. The native run predates those measurement-only additions. Creation totals vary with scheduler and intersection timing; both runs enforce the same live-instance limits and exact disposal balance.

Validation also passed 32 relevant unit/component tests across six files, web TypeScript checking, ESLint, and the web production build. The existing history regression also passed with one measured iteration per streaming fixture plus its warmup; it is a functional regression check, not a statistically robust streaming benchmark.

## Evidence

- [Baseline](../chat-chart-stress-results/baseline.json)
- [Native CPU, six rounds](../chat-chart-stress-results/fixed-1x.json)
- [4x CPU, six rounds](../chat-chart-stress-results/fixed-4x.json)
- [Virtual history screenshot](../chat-chart-stress-results/virtual-history.png), [preview screenshot](../chat-chart-stress-results/preview.png)
- [Existing history and streaming regression](../chat-rendering-results/chart-stability.json): navigation and text selection pass at 300/1000 messages; prepend drift is 0 px; no browser exceptions.

The full working tree also contained other concurrent changes. No unrelated source files were changed for this acceptance task.
