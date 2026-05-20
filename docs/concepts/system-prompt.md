---
summary: "What the xopc system prompt contains and how it is assembled"
read_when:
  - Editing system prompt text, tools list, or time/heartbeat sections
  - Changing workspace bootstrap or skills injection behavior
title: "System prompt"
---

xopc builds a custom system prompt for every agent run. The prompt is **xopc-owned** and does not rely on pi-coding-agent workspace `AGENTS.md` scanning during embedded turns (`noContextFiles: true` + `applySystemPromptOverrideToSession`).

## Structure

Fixed sections include Tooling, Skills, Safety, Problem Solving, Messaging, Runtime, and optional Voice (TTS). Profile Markdown is injected as **Project Context**:

```
# Project Context

The following project context files have been loaded:
…
## profile/SOUL.md
…
```

`HEARTBEAT.md` (when enabled) appears under **Dynamic Project Context** below the prompt cache boundary.

## Bootstrap loading

Runtime loads bootstrap files from **`agents/<agentId>/profile/`** in a fixed order (see [Workspace](workspace.md)):

- Per-file and total character budgets: `agents.defaults.bootstrapMaxChars` (default 12000), `bootstrapTotalMaxChars` (default 60000)
- Subagent and cron sessions omit `MEMORY.md` (allowlist: AGENTS, TOOLS, SOUL, IDENTITY, USER)
- `BOOTSTRAP.md` is injected only while the file exists on disk

Implementation: `src/agent/bootstrap/`, assembled in `src/agent/prompt/system-prompt.ts`.

## Startup context (`/new`, `/reset`)

When a session is cleared or a new webchat session starts, the first user turn may prepend recent daily memory from `memory/YYYY-MM-DD.md` with a `[Startup context loaded by runtime]` marker. Configure via `agents.defaults.startupContext` (enabled by default, `applyOn: ['new','reset']`).

Agents must not claim they manually read files when startup context was injected by runtime.

## Post-compaction refresh

After transcript compaction, xopc appends a context row with excerpts from AGENTS.md sections **Session Startup** and **Red Lines** (configurable via `agents.defaults.compaction.postCompactionSections`; `[]` disables). Budget: `agents.defaults.contextLimits.postCompactionMaxChars` (default 1800).

## Curated memory vs profile MEMORY

| Location | In prompt? | Access |
|----------|------------|--------|
| `agents/<id>/profile/MEMORY.md` | Yes (main session bootstrap) | Project Context + memory tools |
| `agents/<id>/memories/` | No | `curated_memory` tool only |
| `memory/YYYY-MM-DD.md` | On demand; preloaded on /new/reset | startup context + memory tools |

## Related

- [Workspace layout](workspace.md)
- [AGENTS.md template](/reference/templates/AGENTS.md)
- [Tools](tools.md)
