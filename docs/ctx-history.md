# Export history to ctx

XOPC can export its Sessions as a provider-owned [`ctx-history-jsonl-v2`](https://github.com/ctxrs/ctx/blob/main/docs/custom-history-import-format.md) source. ctx imports this durable file through its history-source plugin contract; it does not read the XOPC database directly.

## Export and import

```bash
xopc history export ctx
ctx import --history-source-manifest ~/.xopc/exports/ctx/ctx-history-plugin.json
```

The export creates:

- `~/.xopc/exports/ctx/history.jsonl` — the durable history source;
- `~/.xopc/exports/ctx/ctx-history-plugin.json` — the ctx plugin manifest.

After the first import, search only XOPC history with:

```bash
ctx search "release decision" --history-source xopc/default
```

Run `xopc history export ctx` again when XOPC history changes. The output is deterministic and is not rewritten when its contents are unchanged. A registered ctx daemon watches the durable source for later file changes.

Use `--output-dir <path>` to choose another directory, or `--json` for script-friendly result metadata.

## Export boundary

The exporter includes visible user and assistant messages, tool calls and outputs, local command activity, and compaction summaries. It deliberately excludes hidden context rows, system prompts, model reasoning blocks, invisible extension messages, and deleted Sessions. Each reset generation keeps its own stable XOPC Session ID.

The export is explicit; XOPC does not run it in the background. Newly created output directories and exported files use private permissions (`0700` and `0600`) on platforms that support POSIX modes. Review the JSONL before importing it if a Session may contain sensitive text.
