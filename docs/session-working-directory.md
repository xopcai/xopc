# Session working directory (design)

This document describes **intended product behavior** for an optional per-conversation **task working directory**. It is **not** a goal to hard-sandbox every tool in the runtime; the focus is **where file-oriented work should happen by default**, and how that interacts with **bootstrap markdown** that feeds the system prompt.

## Goals

- **Default experience**: The agent treats **`agents.defaults.workspace`** (and `XOPCBOT_WORKSPACE`) as the **primary place** for file operations and relative paths, matching today’s mental model.
- **Optional user override**: The user may pick a **different directory for this session** (or chat). When set, **routine file read/write/list/search and shell `cwd`** should **prefer that directory**, so generated or edited artifacts land in the user’s chosen folder.
- **Bootstrap / system-prompt markdown stays on the config workspace**: Files that are loaded into the system prompt (see below) continue to be read from the **default workspace root**, not from the session task directory—so persona, identity, and global instructions remain stable and centrally managed.

## Non-goals (for this design)

- **Not** “every tool on the host is confined to one directory.” Some tools (channels, extensions, memory, config) may still touch paths outside the session task root; this spec targets **task file I/O** and **developer ergonomics**, not a full OS sandbox.
- **Not** changing where **session transcripts** or **gateway-internal stores** live unless explicitly decided later (they are separate from “where the user wants project files”).

## Two roots (terminology)

| Concept | Role |
|--------|------|
| **Config workspace** | Resolved from config / env (`agents.defaults.workspace`, `getWorkspacePath`). Holds bootstrap markdown, gateway workspace APIs, and other global layout. |
| **Session task root** | Optional per-session absolute path chosen by the user. When unset, it defaults to the **config workspace**. |

## Bootstrap files (always from config workspace)

These filenames are defined and ordered in [`src/agent/context/workspace.ts`](../src/agent/context/workspace.ts) (`BOOTSTRAP_FILES`). They are loaded via `loadBootstrapFiles(bootstrapDir)` using the **config workspace** as `bootstrapDir`:

- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `TOOLS.md`
- `AGENTS.md`
- `HEARTBEAT.md`
- `MEMORY.md`

**Rule:** For system prompt assembly, **always** load these from the **config workspace**, even when a **session task root** is set.

## Default behavior (no user-selected directory)

- **Session task root** = **config workspace**.
- Relative paths in file tools resolve against the config workspace.
- System prompt includes bootstrap content from the config workspace (as today).
- UX copy and prompts should state that the **working directory** is the default workspace unless the user changes it.

## Behavior when the user selects a working directory

- **Session task root** = user-chosen directory (validated and normalized server-side; details TBD in implementation).
- **Bootstrap markdown**: still read only from **config workspace** (see table above).
- **File-oriented task work** (read/write/edit/list, find/grep search roots, shell initial `cwd`, image paths where the tool already scopes to workspace, etc.): resolve **relative paths** and default search roots against **session task root**.
- **System prompt text**: should include an explicit line such as **“Current task working directory: …”** pointing at the session task root so the model prefers that tree for user files, while understanding that **persona/instructions files** come from the config workspace.

## Edge cases (to resolve at implementation time)

- **Skills**: Managed and bundled skills may live outside either root; workspace-specific skills under the config workspace need a clear rule (e.g. still load from config workspace only, or also allow `<session task root>/skills`—product choice).
- **Memory tools**: If they read/write under the workspace, decide whether memory files follow **session task root** or remain under **config workspace** so long-term memory is not fragmented per folder.
- **Shell**: Setting `cwd` to the session task root reduces accidents; commands that use absolute paths or `cd` elsewhere cannot be fully prevented without a stronger sandbox.
- **Web UI**: A native OS folder picker implies a **desktop shell** or bridge; a browser-only console may offer **path entry** and/or picking **subtrees under the config workspace** via existing gateway list APIs.

## Security note

If the gateway is reachable beyond a trusted machine, allowing arbitrary absolute paths as **session task root** is sensitive. Any implementation should combine **authentication**, **path validation** (resolve + realpath + allowlist policy), and clear **admin defaults**.

## Related code (current)

- Bootstrap loading: [`src/agent/context/workspace.ts`](../src/agent/context/workspace.ts), [`loadBootstrapFiles`](../src/agent/context/workspace.ts) used from [`src/agent/agent-manager.ts`](../src/agent/agent-manager.ts) / [`src/agent/service.ts`](../src/agent/service.ts).
- Session-level overrides (model, etc.): [`src/session/config-store.ts`](../src/session/config-store.ts) (`SessionAgentConfig`).
- Safe path helpers for the workspace editor API: [`src/gateway/workspace-editor-path.ts`](../src/gateway/workspace-editor-path.ts).

---

*Status: design spec; implementation may not exist yet. Update this doc when behavior ships.*
