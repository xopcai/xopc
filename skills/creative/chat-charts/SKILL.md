---
name: chat-charts
description: Add an inline line or bar chart to an xopc chat response when comparing numerical trends or categories helps the user understand data.
metadata:
  i18n:
    en:
      name: "Chat Charts"
      description: "Show numerical trends and category comparisons as inline line or bar charts."
    zh-CN:
      name: "聊天图表"
      description: "在聊天回复中使用折线图或柱状图展示数值趋势和分类对比。"
---

# Chat Charts

Use a chart when it adds understanding to a numerical comparison. Prefer a table for a few isolated values. This skill produces chat content; it does not fetch data or create a separate application.

Before emitting a chart, read [references/chart-spec.md](references/chart-spec.md) for the exact v1 protocol and examples. With xopc, load it using `skill_view(name="chat-charts", path="references/chart-spec.md")`.

Output a strict JSON object in a fenced block tagged `chart`, with ordinary explanatory Markdown around it. The xopc Web chat renderer validates it and converts it to a themed interactive chart. Other clients may display the source; include a concise textual conclusion outside the block.

Choose `line` for an ordered trend and `bar` for category comparisons. Preserve the source's order, numbers, units and precision. All series share one unit and axis; split different units into separate charts. Use only obtained data; do not fill gaps with invented values. Missing measurements are `null`, never an assumed zero.

Use `dataKind: "real"` with sources describing the dataset, time range, and retrieval/as-of time when relevant. Label illustrative data with `dataKind: "example"` and state that it is illustrative in the prose. Source declarations are attribution, not proof that data is verified.

Do not output ECharts options, JavaScript, functions, HTML, external images, or executable formatters. The host owns styling, layout, tooltips, and export. Do not claim a chart rendered successfully: this skill receives no client rendering acknowledgment.
