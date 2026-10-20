# Conversation launch acceptance — 2026-10-20

## Scope

| Source | Requested destination | Result |
| --- | --- | --- |
| No project | No project specified | Independent projectless conversation |
| Project A | Current project | Independent conversation in Project A |
| Project A | Explicitly no project | Independent projectless conversation |
| No project | Explicit Project B | Independent conversation in Project B |

All four cases passed in both a real built Gateway with a deterministic streaming model and the running local Gateway with its configured `qwen-token-plan-cn/qwen3.8-flash` model. Both runs used Chrome and actual browser submissions, Agent tools, SQLite transcripts, authenticated HTTP, and realtime connections.

## Checks

- The Agent discovers and invokes `xopc_use` through the real tool registry.
- Creating a conversation returns while its first input is still running.
- Destination project selection does not change the source conversation's project.
- The first message and its provenance persist in the destination transcript.
- The result card opens the destination; its source label returns to the originating conversation.
- Source links work before the first reply completes and survive reload.
- Realtime completion updates the original card with the first reply; reload restores it.
- Project execution preparation works for a local checkout and a real managed Git worktree.

The slow-response test found a missing source label while a destination turn was active. Reconciliation previously kept an existing user row when its turn boundaries matched the server snapshot, losing newly hydrated provenance. Reconciliation now merges provenance for the same turn without replacing local row identity or live content. Subsequent user display updates preserve that provenance.

## Reproduce

```bash
# Builds production assets, starts an isolated Gateway and local streaming model,
# runs all four cases in Chrome, and removes its temporary database/workspaces.
pnpm run test:conversation-launch:e2e

# Explicit opt-in: uses the running local Gateway and configured model.
# Creates E2E-labelled projects and conversations and retains them for inspection.
XOPC_CONVERSATION_LIVE=1 pnpm run test:conversation-launch:live
```

Chrome is used by default; override `XOPC_E2E_BROWSER_CHANNEL` for another installed Playwright browser channel. The live script reads the standard local configuration or `XOPC_CONFIG_PATH`. It never writes credentials to the report.

Default evidence directories:

- `/tmp/xopc-conversation-launch-e2e`: automated report, Gateway log, API history snapshots, and running/origin/completed screenshots.
- `/tmp/xopc-conversation-launch-live`: live model report and browser screenshots.

## Validation

- Full suite: **10,823 passed**, 14 skipped; 1,680 test files passed, 3 skipped.
- Focused regression after the provenance fix: **127 passed** across 8 files.
- Both four-case browser acceptance runs: passed.
- Root typecheck, full build, and lint: passed. Lint reports existing unused-variable warnings outside this change.
