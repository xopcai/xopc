# TUI Product Parity Plan

This plan tracks the non-approval work needed to bring `src/tui` closer to pi/Codex-class terminal product capabilities.

## Goals

- Keep gateway and embedded modes behaviorally aligned.
- Make coding workflows fast from the keyboard: file references, session navigation, model control, tool output, and compaction should be first-class.
- Improve stream/session reliability without changing the permission or approval model yet.
- Reduce `src/tui/tui.ts` coupling so new product work has clear ownership boundaries.

## Phase 1: Input and Reference UX

Primary files:

- `src/tui/extension-host/runtime.ts`
- `src/tui/components/custom-editor.ts`
- `src/tui/tui-submit.ts`
- `src/tui/tui-skills-autocomplete.ts`

Tasks:

- Preserve primary `@file` autocomplete while adding skill and extension `@` suggestions.
- Add explicit labels/descriptions that distinguish files, skills, and extension references in the autocomplete menu.
- Normalize pasted image handling into a structured attachment envelope instead of inserting only a temp file path.
- Add tests for `@file`, `@skill`, path completion, and attachment submit behavior.

Acceptance:

- Typing or tab-completing `@` references never hides file suggestions because a skill or extension provider also matches.
- A submitted image can be rendered in history and passed through the same agent message path as other attachments.

## Phase 2: Stream Reliability

Primary files:

- `src/tui/backends/gateway-sse-backend.ts`
- `src/tui/tui-agent-events.ts`
- `src/tui/stream-assembler.ts`
- `src/tui/tui-session-actions.ts`

Tasks:

- Track stream origin and run id to avoid duplicate rendering when `/api/agent` and broadcast SSE both emit related events.
- Add a reconnect recovery step that reloads current session history after a broadcast gap or reconnect.
- Replace the fixed 30s watchdog reset with phase-aware stale detection and a visible recovery action.
- Surface abort, steer, follow-up, and retry state transitions in a single run status model.

Acceptance:

- Network reconnect does not duplicate completed assistant/tool blocks.
- A stalled stream can recover from persisted session rows without losing the active editor draft or queued messages.

## Phase 3: Session Tree and Branching

Primary files:

- `src/tui/tui-transcript-tree.ts`
- `src/tui/tui-transcript-tree-picker.ts`
- `src/tui/tui-session-actions.ts`
- `src/storage/sqlite/`

Tasks:

- Promote active transcript leaf/path to an explicit TUI session concept.
- Support continuing from a selected historical row without forcing a new session key when storage can represent the branch.
- Add branch compare and checkpoint/bookmark summaries.
- Warn when switching sessions changes cwd, agent id, trust state, or effective model config.

Acceptance:

- `/tree` supports both "continue here" and "fork to new session" flows.
- Labels/checkpoints survive reload and are visible in session picker/search.

## Phase 4: Compaction Productization

Primary files:

- `src/tui/tui-context-usage.ts`
- `src/tui/tui-session-actions.ts`
- `src/tui/tui-settings.ts`
- `src/tui/components/settings-selector.ts`

Tasks:

- Add TUI settings for compaction mode, threshold, retained recent turns, and custom instructions.
- Show proactive context warnings in the footer before the context window is exhausted.
- Trigger automatic compaction when policy allows it, then reload history and show before/after summary.
- Add overflow retry handling when the backend reports context exhaustion.

Acceptance:

- Long sessions can continue without manual `/compact` in the default configuration.
- Users can inspect what compaction did and adjust policy from `/settings`.

## Phase 5: Tool Rendering as Operation Panels

Primary files:

- `src/tui/components/tool-execution.ts`
- `src/tui/tui-tool-diff.ts`
- `src/tui/tui-tool-result.ts`
- `src/tui/extension-host/tool-renderers.ts`

Tasks:

- Add specialized renderers for edit/write/apply-patch style tool results.
- Provide copy/open controls for long outputs and full-output files.
- Improve browser, web search, MCP, and media tool summaries.
- Make collapsed tool cards information-dense enough to scan without expansion.

Acceptance:

- Common coding tools show intent, target path, result, and diff summary in the collapsed view.
- Expanding a tool provides the full structured result without corrupting terminal layout.

## Phase 6: TUI Runtime Decomposition

Primary files:

- `src/tui/tui.ts`
- new `src/tui/tui-runtime-controller.ts`
- new `src/tui/tui-input-controller.ts`
- new `src/tui/tui-session-controller.ts`
- new `src/tui/tui-settings-controller.ts`

Tasks:

- Move stream/run state into a runtime controller.
- Move keybindings, submit, queue, shell, and editor actions into an input controller.
- Move session switching, import/export, fork, tree, and compaction into a session controller.
- Keep `runTui` as composition root only.

Acceptance:

- `runTui` wires components but does not own individual workflow state machines.
- New TUI features can be tested without starting a full terminal instance.

## Current Implementation Notes

- Phase 1 has started: `@` autocomplete now merges primary provider results with skill/extension suggestions.
- Built-in skill suggestions now identify themselves as `skill` in the autocomplete description.
- Clipboard image paste now stages a structured webchat-compatible image attachment and sends it through both gateway and embedded TUI backends.
- Phase 2 has started: TUI stream events now carry source metadata (`agent-response`, `broadcast`, `embedded`) and update a shared run status model.
- The stream watchdog now marks runs as stalled and reloads persisted history instead of finalizing/dropping the active run; broadcast gaps and reconnects use the same recovery path.
- Duplicate stream rendering now skips broadcast token/thinking/tool/progress/result/error events when the same run is already owned by the direct `/api/agent` response stream, while still allowing broadcast-only recovery streams.
- Gateway resume is wired into TUI recovery: stalled runs reload persisted history, clear partial stream state, and reattach through `/api/agent/resume` when available.
- `/recover` and `/retry` are available in the TUI for manual recovery and resend after aborting a stuck run.
- Gateway webchat relay events now include `runId` and monotonic `seq`; TUI uses `(runId, seq)` for exact cross-source stream dedupe.
- History reloads during reconnect/gap/recovery now append new rows when the transcript key prefix is unchanged, avoiding unnecessary chat-log clears.
- Run lifecycle mutations are now centralized in `tui-run-state.ts` helpers, with tests for send, direct/resume ownership, completion, abort, stale, and recovery transitions.
- The footer surfaces `run:stalled`, `run:recovering`, and `run:resumed` so stream recovery state is visible without opening logs.
- TUI command code was split so `tui-commands.ts` owns command definitions/dispatch and `tui-command-formatters.ts` owns parsing/formatting helpers; no compatibility re-export is kept.
- Extension runtime autocomplete and runtime context helpers were split into `extension-host/autocomplete.ts` and `extension-host/runtime-context.ts`, bringing `extension-host/runtime.ts` below 1000 lines.
