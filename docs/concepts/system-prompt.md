---
summary: "What the xopc system prompt contains and how it is assembled"
read_when:
  - Editing system prompt text, tools list, or time/heartbeat sections
  - Changing workspace bootstrap or skills injection behavior
title: "System prompt"
---

xopc builds a custom system prompt for every agent run. The prompt is **xopc-owned** and does not rely on pi-coding-agent workspace `AGENTS.md` scanning during embedded turns (`noContextFiles: true` + `applySystemPromptOverrideToSession`).

## Structure

Fixed sections include **Tooling**, Tool Call Style, Execution Bias, Skills, Safety, Problem Solving, Messaging, Silent Replies, Runtime, and optional Voice (TTS). Profile Markdown is injected as **Project Context**:

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

- Per-file and total character budgets are runtime constants unless exposed by a future manifest runtime field.
- Subagent and automation-run sessions omit `MEMORY.md` (allowlist: AGENTS, TOOLS, SOUL, IDENTITY, USER)
- Profile context injection follows the selected manifest/runtime policy and session state.

Implementation: `src/agent/bootstrap/`, assembled in `src/agent/prompt/system-prompt.ts`.

## Startup context (`/new`, `/reset`)

When a session is cleared or a new webchat session starts, runtime-provided profile context may be injected with a `[Startup context loaded by runtime]` marker when the selected manifest/workflow enables that behavior.

Agents must not claim they manually read files when startup context was injected by runtime.

## Post-compaction refresh

After transcript compaction, xopc may append a context row with excerpts from AGENTS.md sections **Session Startup** and **Red Lines** according to runtime compaction policy.

## Curated memory vs profile MEMORY

| Location | In prompt? | Access |
|----------|------------|--------|
| `agents/<id>/profile/MEMORY.md` | Yes (main session bootstrap) | Project Context + memory tools |
| `agents/<id>/memories/` | No | `curated_memory` tool only |
| Session history | No | `session_search` when available |

## Related

- [Workspace layout](workspace.md)
- [AGENTS.md template](/reference/templates/AGENTS.md)
- [Tools](tools.md)
