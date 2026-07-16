# Code Intelligence

xopc gives the `coder` agent managed repository intelligence backed by codebase-memory-mcp (CBM). It indexes source into a local SQLite knowledge graph and exposes a small, read-only tool surface for symbol discovery, source grounding, call tracing, change impact, and architecture mapping.

## Default behavior

- Code intelligence is enabled for the `coder` agent by default.
- The CBM process is lazy, workspace-scoped, and shared by sessions using the same resolved workspace.
- The first coder session starts indexing in the background.
- Successful file edits mark the index dirty and trigger a debounced incremental refresh.
- The process and graph are local. xopc does not send repository content to an additional model or hosted indexing service.
- If CBM is unavailable or coverage is incomplete, the tools return a freshness warning and direct the agent to `grep`, `find`, and `read_file`.

Do not run `codebase-memory-mcp install` for this integration. That command configures other coding clients. xopc starts the packaged MCP binary directly.

The Electron app ships the matching static CBM binary. The npm package downloads CBM only when a coder agent first needs code intelligence; it is not downloaded during `npm install`. The on-demand download has a two-minute deadline, verifies the release SHA-256 manifest before extraction, and writes atomically to the xopc state directory, so an unreachable or untrusted GitHub Releases host cannot leave package installation stuck or introduce an executable.

## Agent tools

| Tool | Purpose |
|------|---------|
| `code_search` | Find definitions, implementations, routes, types, and important symbols. |
| `code_read_symbol` | Read exact source for a qualified symbol before editing. |
| `code_trace` | Trace callers, callees, data flow, and cross-service paths. |
| `code_impact` | Map a Git diff or range to affected symbols and blast radius; defaults to `HEAD` and bounds symbol output. |
| `code_architecture` | Map packages, boundaries, layers, entry points, hotspots, and clusters. |

The graph is indexed evidence, not ground truth. The coder prompt requires direct source verification before editing or claiming that code does not exist.

## Configuration

Add `codeIntelligence` to `~/.xopc/xopc.json` only when overriding defaults:

```json
{
  "codeIntelligence": {
    "enabled": true,
    "agentIds": ["coder"],
    "indexMode": "moderate",
    "autoIndex": true,
    "autoRefresh": true,
    "refreshDebounceMs": 600,
    "queryTimeoutMs": 20000,
    "indexTimeoutMs": 300000,
    "binaryPath": "/optional/absolute/path/codebase-memory-mcp"
  }
}
```

| Setting | Default | Notes |
|---------|---------|-------|
| `enabled` | `true` | Disables the managed runtime and tools when false. |
| `agentIds` | `["coder"]` | Agent manifests that receive the tools. |
| `indexMode` | `moderate` | `fast`, `moderate`, or `full`; moderate includes semantic edges. |
| `autoIndex` | `true` | Builds or refreshes the graph when a target agent starts. |
| `autoRefresh` | `true` | Refreshes after successful workspace edits. |
| `refreshDebounceMs` | `600` | Coalesces nearby edits into one incremental run. |
| `queryTimeoutMs` | `20000` | Maximum time for a graph query. |
| `indexTimeoutMs` | `300000` | Maximum time for an indexing run. |
| `binaryPath` | unset | Overrides the packaged/npm binary. `XOPC_CBM_BINARY` is also supported. |

Restart the gateway after changing binary or process settings.

## Runtime and storage

xopc resolves the binary in this order:

1. `codeIntelligence.binaryPath`
2. `XOPC_CBM_BINARY`
3. packaged Electron `resources/bin`
4. the binary cached by xopc after its on-demand download

Indexes live under the xopc state directory at `code-intelligence/cbm`. Each process is restricted to its resolved workspace with `CBM_ALLOWED_ROOT`. Indexing is crash-isolated by the CBM process boundary and is stopped when workspace runtimes are cleared.

## Troubleshooting

Check the installed binary in a source checkout:

```bash
pnpm exec codebase-memory-mcp --version
```

Common failure modes:

| Symptom | Action |
|---------|--------|
| Binary download fails | Check access to GitHub Releases, retry a coder request, or set `XOPC_CBM_BINARY` / `codeIntelligence.binaryPath` to a trusted executable. |
| Index timeout | Use `indexMode: "fast"`, increase `indexTimeoutMs`, or reduce the workspace scope. |
| Partial/degraded coverage | Use direct source tools for flagged paths; do not make absence claims from graph results. |
| Stale result after an external edit | Wait for CBM auto-sync, or restart the gateway to rebuild the workspace runtime. |

## Packaging

Electron builds copy the real binary into application resources, so packaged applications do not download CBM at runtime. npm installation does not download CBM; xopc downloads it on demand with a deadline only when code intelligence is first used and no explicit binary has been configured.
