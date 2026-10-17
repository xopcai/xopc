# Chat charts: real Agent end-to-end validation

Date: 2026-10-17, 13:06:00–13:06:16 Asia/Shanghai. Result: passed.

## Environment and scope

- A running authenticated Gateway and its same-origin production chat UI, served from the current `dist/gateway/static/root` build. No mock model, fixture response, or injected assistant message was used.
- Actual recorded provider/model: `qwen-token-plan-cn/qwen3.8-flash`.
- Run ID: `a79ce431-6165-4799-a8a2-21162e37d947`.
- A temporary Agent inherited the existing skills catalog. Its tools were restricted to `skills_list` and `skill_view`; personal user context was disabled for this test conversation.
- The browser submitted the request through the real composer and send button. The request asked for a line chart and a bar chart using supplied illustrative numbers; it did not name the skill, the `chart` language, or the JSON protocol.

This verifies one real model run with a restricted tool set. It does not establish a statistical success rate across models or unrestricted tool catalogs.

## Observed results

1. The Agent independently called `skill_view(name="chat-charts")`, then `skill_view(name="chat-charts", path="references/chart-spec.md")`. Persisted tool results contained the actual requested file contents; the runner checks the contents rather than relying only on `isError`.
2. The generated answer contained exactly two valid `chart` fences, one `line` and one `bar`. Both passed the production `parseChartSpec` validator and declared `dataKind: "example"`.
3. Line chart series preserved income `[14320, 15860, 15140]` and spending `[9310, 8840, 9620]`. The bar chart preserved category spending `[4200, 1860, 540]`.
4. Both charts rendered actual nonzero Canvas elements in the full chat page after the streamed reply, without any manual modification of the answer. Screenshots were captured from the chart figures, excluding the personal sidebar.
5. Both charts rendered again after a full page reload, exercising persisted transcript/history rendering. The browser recorded no uncaught errors.
6. The temporary Agent, conversation, workspace and test browser session were removed after evidence capture.

## Findings and correction

An earlier real run already generated valid charts and rendered successfully, but optional example reads used `line-example.json` / `bar-example.json` instead of paths relative to the skill root. The reference now gives explicit `skill_view` calls with `references/` prefixes. The final fresh run read the main skill and protocol successfully and did not need the optional example files. The revised runner also verifies the returned file contents, because a failed `skill_view` can return a textual error without setting `isError`.

The validation runner selects a thinking level supported by the actual model and authenticates the browser on the same-origin Gateway page. It waits for an enabled send button and clicks it, avoiding reliance on the composer's keyboard send preference or draft-update timing.

## Evidence

- [Machine-readable report](../chat-charts-live-results/report.json)
- [Actual generated Markdown](../chat-charts-live-results/answer.md)
- [Line chart screenshot](../chat-charts-live-results/line-live.png)
- [Bar chart screenshot](../chat-charts-live-results/bar-live.png)
- Runner: `scripts/verify-chat-charts-live.mjs`; invocation: `node --import tsx/esm scripts/verify-chat-charts-live.mjs`.

After the skill reference correction, its validator and the 25 relevant protocol/skill tests also passed. This run made no renderer or protocol implementation changes.
