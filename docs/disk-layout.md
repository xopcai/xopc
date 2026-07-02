# On-disk layout

This page lists where xopc reads and writes on disk. Effective paths always come from your **config file** (default `~/.xopc/xopc.json`) and environment variables such as `XOPC_CONFIG` and `XOPC_WORKSPACE`.

For narrative setup (init, templates, env vars), see [State directory & workspace layout](workspace.md).

## Design split

| Area | Role |
|------|------|
| **State directory** | Global config, credentials, logs, global skills/extensions cache, managed tooling. |
| **Agent home** `<stateDir>/agents/<agentId>/` | Per-agent runtime: curated memory, **`profile/`** Markdown (`SOUL.md`, …), inbound/TTS blobs. Session transcripts live in **`xopc.db`**, not under `sessions/`. |
| **Agent dir** `…/agents/<agentId>/agent/` | Process state: `agent.json`, per-agent credentials, IPC inbox, pid/socket, small machine state, extension installs, outbound crash-recovery queue. |
| **Markdown workspace** | User project tree: tool `cwd`, daily `memory/*.md`, `media/generated`, project `.xopc/skills/`, arbitrary files. |

Paths below use `~/.xopc` as the default state root; override with `XOPC_STATE_DIR`, `XOPC_PROFILE`, or `XOPC_HOME` (see [workspace.md](workspace.md#environment-variables-quick-reference)).

## State directory (global)

Default: `~/.xopc/`

| Path | Purpose |
|------|---------|
| `xopc.json` | Main application config (unless `XOPC_CONFIG` / `XOPC_CONFIG_PATH` points elsewhere). |
| `xopc.db` | Primary SQLite database: sessions, transcripts, automations, per-session config, compaction checkpoints, FTS5 search index. |
| `credentials/` | Global secrets: `auth-profiles.json`, `oauth/<provider>.json`. |
| `extensions/` | Installed extension packages, `extensions-lock.json`. |
| `skills/` | Globally managed skill packages (`<id>/SKILL.md`). |
| `logs/` | Application logs (overridable via `XOPC_LOG_DIR`). |
| `bin/`, `tools/` | Managed CLI shim and tool runtimes. |
| `models.json` | Optional custom model registry data. |

## Agent home: `agents/<agentId>/`

Resolved by `resolveAgentHomeDir(config, agentId)`. Typical layout:

| Path | Purpose |
|------|---------|
| `profile/` | Agent profile Markdown for the system prompt stack: `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`, `HEARTBEAT.md`, `MEMORY.md` (separate from curated `memories/`), optional `agent-avatar.*` for the gateway console. Global user profile lives in `user/PROFILE.md`. |
| `sessions/` | Legacy directory (optional); may remain from older installs. New installs store transcripts in `xopc.db` only. |
| `memories/` | Agent curated structured store (`MEMORY.md`; entries separated by a fixed delimiter — `BuiltinMemoryStore`). Global user memory lives in `user/MEMORY.md`. |
| `inbound/` | Persisted inbound attachments (non-image binaries); transcript paths use `inbound/...` relative to agent home. |
| `tts/` | Cached outbound TTS audio per session. |
| `agent/` | See **Agent dir** below. |

Seeding: `xopc init` / `xopc agents add` copy missing profile Markdown templates into **`agents/<agentId>/profile/`** (see [Workspace templates](reference/templates.md)).

## Agent dir: `agents/<agentId>/agent/`

Resolved by `resolveAgentDir(config, agentId)`.

| Path | Purpose |
|------|---------|
| `agent.json` | Agent metadata. |
| `credentials/` | Per-agent API profiles (when used). |
| `inbox/pending/`, `inbox/processed/` | File-based IPC inbox. |
| `pid`, `status.json`, `agent.sock` | Process coordination. |
| `state/` | Machine state (e.g. workspace metadata, skills scan cache) — not the Markdown workspace `.state/`. |
| `extensions/` | Per-agent extension install root. |
| `outbound-pending.json` | Outbound message crash-recovery queue. |

## Markdown workspace

Resolved by `resolveAgentWorkspaceDir(config, agentId)` from the selected agent manifest. In current configs this is usually **`agents.list[].workspace.root`** (for example `~/.xopc/workspace/main`), with **`<stateDir>/workspace/<agentId>`** as the fallback for generated defaults.

**Intended contents** (user-visible / tool-facing):

| Path | Purpose |
|------|---------|
| `memory/` | Daily or topical notes (`YYYY-MM-DD.md`); `memory_search` / tool cwd. |
| `media/generated/` | Generated images and similar outputs. |
| `.xopc/skills/` | Project-local user-authored skills. |
| *arbitrary files* | `read` / `write` / `edit` tool targets. |

Internal state is **not** written here on new installs. This tree is the only supported layout: persona Markdown and machine state follow the table at top. There is **no** automatic import from older “everything under the markdown workspace” layouts—use `xopc init` for the full state tree, or `xopc setup` / `xopc onboard` for config + profile Markdown seeds, and move any old data yourself if you are upgrading from another fork.

Inbound / TTS attachments in transcripts use relative paths under `inbound/` and `tts/` **only** (resolved from agent home).

## Operations helpers

- `listAgentWorkspaceDirs(config)` — all Markdown workspace roots for agents listed in config (CLI / advanced use).
- `listAgentProfileMarkdownDirs(config)` — same roots as `listAgentWorkspaceDirs` (profile Markdown lives in the workspace root; useful for backup or editors).

## See also

- [State directory & workspace layout](workspace.md) — setup, env vars, template list.
- [Architecture](architecture.md) — how services use these paths.
- [Session management](session.md) — session store layout.
