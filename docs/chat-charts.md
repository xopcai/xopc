# Inline chat charts

The Web gateway console (including the Electron window that uses it) renders `chart` Markdown fences as interactive line or bar charts. Other Markdown readers may show the original JSON. Include a short conclusion in ordinary prose so the response remains useful in every client.

## Agent usage

The bundled `chat-charts` skill is discovered through the existing skills catalog. Only its name and description enter the available-skills prompt; the agent reads `SKILL.md` and the protocol reference with `skill_view` when needed. Existing skill allowlists and disabled-skill settings still apply. No chart tool or always-on chart prompt is added.

The skill contains tested examples in `skills/creative/chat-charts/references/`. It does not fetch data or receive client render acknowledgments. Real datasets require source attribution; the renderer validates structure, not factual accuracy.

## Markdown format

````markdown
The following is illustrative data.

```chart
{
  "version": 1,
  "type": "line",
  "title": "Monthly spending",
  "summary": "Illustrative spending declines from January to March.",
  "dataKind": "example",
  "xAxis": { "label": "Month", "values": ["2026-01", "2026-02", "2026-03"] },
  "yAxis": { "label": "Spending", "unit": "CNY" },
  "series": [{ "name": "Spending", "values": [8000, 7200, 6500] }]
}
```
````

Change `type` to `bar` for grouped vertical bars. Multiple series share one vertical axis and unit; split datasets with different units into separate charts. Missing values must be `null`, with the original category retained. The host uses a zero baseline and does not smooth lines or connect gaps.

For real data, set these fields in the chart object:

```json
{
  "dataKind": "real",
  "sources": ["User-provided ledger.csv, January–March 2026, CNY"]
}
```

Source strings are displayed as text, never fetched. Keep the source and time range in surrounding prose as well.

## Validation and rendering

`packages/chart-spec` is a dependency-free shared parser. It rejects unsupported versions/types, unknown fields at every object level, blank or oversized text, invalid numbers, duplicate series names, mismatched lengths and entirely missing data. The JSON is limited to 100 KiB UTF-8, 20 series and 10,000 total points. Each title, label, unit and series name is limited to 200 characters; summaries to 2,000 characters. Real data requires 1–20 nonblank source strings, each up to 2,000 characters.

Only the explicit `chart` language is rendered. Ordinary JSON, JavaScript and untagged code stay code. ECharts options, callbacks, HTML formatters, external images and transforms are not part of the protocol. The host constructs all options and uses rich-text tooltips, fixed styling and finite numeric data.

A real closing fence is required, including for persisted/static Markdown. Incomplete streaming blocks show a skeleton and optional source; interrupted blocks retain source. Invalid configurations show a field-specific error with source and copy. Rendering failures preserve the JSON and allow retry.

The ECharts runtime is dynamically imported only for a valid, active chart. Inline chart instances share the existing preview scheduler with Mermaid, dispose when their lease is lost or their component is removed, and wait for nonzero dimensions. A ResizeObserver handles container changes; theme changes rebuild with current semantic colors. The original Markdown remains the persisted source of truth, so no database or realtime schema change is required.

Charts provide JSON copy, source switching, an accessible data table, a fixed-size responsive preview, and bounded PNG export. The preview owns an independent instance; the inline canvas is released while it is open.

Chat and note Markdown renderers support the same `chart` fences. Notes reuse the chart validator and interactive component while retaining their document Markdown parser, attachment hydration, math and Mermaid support. Other document Markdown consumers can opt in through `MarkdownView.renderChart`; native clients require their own renderer integration.

## Verification

```bash
pnpm vitest run packages/chart-spec web/src/components/charts web/src/features/chat/rendering/__tests__/chat-charts.test.tsx src/agent/skills/__tests__/chat-charts.test.ts
pnpm --filter @xopc/web type-check
pnpm --filter @xopc/web lint
pnpm --filter @xopc/web build
```

For a real browser check, start Vite, then run the script in another terminal. It requires an installed Google Chrome and uses an isolated headless session:

```bash
pnpm --filter @xopc/web exec vite --host 127.0.0.1 --port 5186
node scripts/verify-chat-charts.mjs
```

The script verifies real Canvas rendering, copying, PNG bytes, source switching, the data table, preview, dark/mobile layout, streaming completion, reload, and that invalid/incomplete input does not load the engine. Its fixture is available at `/src/visual-tests/chat-charts/` on the Vite server.

For the note Markdown integration, start a Vite server on port 5188 and run `node scripts/verify-note-charts.mjs`. The `/src/visual-tests/note-charts/` fixture uses the actual `NoteMarkdownView` and checks both chart types, data edits, source switching, copy, preview, PNG export, formula/Mermaid coexistence, narrow/dark layout, and invalid or incomplete source fallback. Note preview and detail views both use this renderer; persisted Markdown stays unchanged.

To verify actual skill selection and generation with a configured model, run:

```bash
node --import tsx/esm scripts/verify-chat-charts-live.mjs
```

This invokes the configured live chat model through the running authenticated Gateway and its production Web UI. It creates a temporary Agent (inheriting the skills catalog, with only skill-reading tools enabled), submits an ordinary chart request through the composer without naming the skill or supplying a JSON template, verifies the persisted skill tool calls and returned file content, validates the generated specs and original numbers, and checks both charts before and after reload. It saves a report, the generated Markdown and chart screenshots in a temporary output directory, then removes the temporary Agent, conversation, workspace and browser session. It reads credentials locally without putting them in the report.

Optional overrides: `XOPC_CONFIG_PATH`, `XOPC_STATE_DIR`, `XOPC_CHART_LIVE_MODEL`, `XOPC_CHART_LIVE_WEB` and `XOPC_CHART_LIVE_REPORT_DIR`. The Web URL must be allowed by the Gateway origin policy; the default same-origin production page avoids development proxy differences. This test makes real model requests and requires an installed Google Chrome.

For acceptance with the actual default Agent's unrestricted tool policy and full enabled skills catalog:

```bash
node --import tsx/esm scripts/verify-chat-charts-matrix.mjs
```

The matrix covers configured Qwen Flash, Qwen Max, DeepSeek V4 Pro and MiniMax M2.7 across line-chart gaps, signed bar values, multiple series with decimals, and an all-missing-data fallback. It uses a fresh conversation for each combination, submits natural requests through the production chat UI without skill hints or protocol templates, checks the recorded model and on-demand skill reads, compares each series/category/value with the supplied data, and verifies actual Canvas rendering and reload. It does not patch the default Agent's configuration or restrict its tools/skills; only each temporary conversation's model is selected. Conversations and the test browser session are cleaned up.

Set `XOPC_CHART_MATRIX_MODELS` to comma-separated configured model refs, `XOPC_CHART_MATRIX_CASES` to comma-separated case IDs (`line-gaps`, `bar-negative`, `bar-multi-series`, `all-missing`), and `XOPC_CHART_MATRIX_DIR` to an output directory when running a subset or collecting evidence. All selected models must already be available. Each selected combination makes a real model request. Regressions are retained as failed cases; the runner does not send corrective prompts to turn an initial failure into a pass.
