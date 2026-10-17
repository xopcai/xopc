# ChartSpec v1

Emit one strict JSON object inside a `chart` Markdown fence. Use double quotes, no comments, no trailing commas, and no extra fields. Do not wrap the spec in an `option` object. Supported types are `line` and `bar` only.

| Field | Required value |
| --- | --- |
| `version` | Number `1` |
| `type` | `"line"` or `"bar"` |
| `title` | Nonblank text, at most 200 characters |
| `summary` | Nonblank accessible explanation, at most 2,000 characters |
| `dataKind` | `"real"` or `"example"` |
| `sources` | Required for real data: 1–20 nonblank strings, at most 2,000 characters each; optional for examples |
| `xAxis` | Object with `label` and `values`; values are nonblank string category labels |
| `yAxis` | Object with nonblank `label` and `unit`; use `%`, `CNY`, `count`, etc. |
| `series` | 1–20 objects with unique nonblank `name` and numeric/null `values` |

All other text fields and each horizontal-axis label are at most 200 characters. Every series must have exactly as many values as `xAxis.values`. At least one data point must be a finite number; `NaN`, `Infinity`, numeric strings, empty arrays and all-null charts are invalid. Use `null` to preserve a gap. Do not reorder or silently drop missing categories. Keep category labels unambiguous, including year where needed.

The complete JSON must fit in 100 KiB UTF-8, with at most 10,000 total points across all series. Prefer fewer categories and series for readability. For larger datasets, ask for an appropriate aggregation or describe the aggregation used; do not silently sample and change the conclusion.

Examples are in [line-example.json](line-example.json) and [bar-example.json](bar-example.json). Read only the relevant example if needed. `skill_view` paths are relative to the skill root, even when a link is relative to this reference: use `skill_view(name="chat-charts", path="references/line-example.json")` or `skill_view(name="chat-charts", path="references/bar-example.json")`. Both contain illustrative data. Emit their contents inside a `chart` fence, not as a linked JSON file.

For real data, add `sources`, for example `["User-provided sales.csv, January–March 2026, amounts in CNY"]`, and change `dataKind` to `real` only if using actually obtained data. Explain the source and time range in surrounding prose as well. The host does not retrieve source URLs or check the factual accuracy of the dataset.

If you notice an invalid chart, correct the data structure without inventing measurements. If valid comparable data is unavailable, provide a table or explain what data is missing.
