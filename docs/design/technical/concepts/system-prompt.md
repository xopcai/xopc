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
- Subagent and automation-run sessions use a minimal agent profile allowlist (AGENTS, TOOLS, SOUL, IDENTITY) while relevant assertions and knowledge come from the shared execution-context planner.
- Profile context injection follows the selected manifest/runtime policy and session state.

Implementation: `src/agent/bootstrap/`, assembled in `src/agent/prompt/system-prompt.ts`.

## Startup context (`/new`, `/reset`)

When a session is cleared or a new webchat session starts, runtime-provided profile context may be injected with a `[Startup context loaded by runtime]` marker when the selected manifest/workflow enables that behavior.

Agents must not claim they manually read files when startup context was injected by runtime.

## Post-compaction refresh

After transcript compaction, xopc may append a context row with excerpts from AGENTS.md sections **Session Startup** and **Red Lines** according to runtime compaction policy.

## Compaction generation budget

`userContext.contextPlanning.compaction.summaryMaxTokens` caps each generation request, including reasoning, and defaults to 16,000 tokens. The handover prompt asks for concise facts independently of this ceiling. Reasoning models start with up to 4,000 tokens; other models start with up to 2,000. A `length` response is discarded and retried with double the budget, within the configured and model limits. Budget increases count toward `summaryRetries`; once the ceiling is reached, the compactor tries a configured fallback instead of repeating the same truncated request.

Existing explicit limits are preserved. Installations with a saved lower limit can raise it to 16,000 in the compaction settings. Saving config refreshes the shared session store's policy for subsequent compactions. Runtime chunks account for the system prompt, accumulated ledger, output budget, repair allowance and context safety margin. Invalid complete responses can be repaired using the original records; truncated responses never enter JSON repair. Failed compactions leave the transcript and its compaction boundaries unchanged.

Diagnostic logs include the session, stage, chunk, requested and actual output budgets, content block types and next recovery action. `normalizedReasoningTokens` can be zero when the provider omits its reasoning usage breakdown, even when thinking blocks are present.

## Prompt caching

xopc keeps stable instructions and project context ahead of a cache boundary, with heartbeat, channel, interaction, and active-project state after it. Provider adapters turn that boundary into separate cache blocks for Anthropic and Bedrock; implicit-prefix-cache providers receive the same ordering without the internal marker. OpenAI prompt cache routing uses a hash of the stable prompt and ordered tool schemas rather than the conversation id, so equivalent agents can reuse the same prefix while session identity remains independent.

Set `runtime.promptCache` in **Settings → Agent defaults**, or override it for one Agent in the Agent editor. The value is `{ "mode": "off" | "auto", "lifetime": "short" | "long" }`. `auto` lets each provider adapter select its native cache mechanism. Long lifetime can increase cache-write cost and provider-side state retention, so use it only when the stable prefix is reused across longer idle intervals.

## Shared user context

| Location | In prompt? | Access |
|----------|------------|--------|
| Execution Context | Relevant subset only | Per-turn planner with scope, validity, sensitivity, authority, and budget checks |
| Session history | No | `session_search` when available |

## Related

- [Workspace layout](workspace.md)
- [AGENTS.md template](/reference/templates/AGENTS.md)
- [Tools](tools.md)
