# On-disk layout

This page is a **concise map** of where xopcbot reads and writes on disk. Config remains the source of truth; resolution is implemented in `src/agent/agent-scope.ts`, `src/config/paths-state.ts`, `src/config/paths.ts`, and related modules.

For narrative setup (init, templates, env vars), see [State directory & workspace layout](workspace.md).

## Design split

| Area | Role |
|------|------|
| **State directory** | Global config, credentials, logs, cron, global skills/extensions cache, managed tooling. |
| **Agent home** `<stateDir>/agents/<agentId>/` | Per-agent runtime: transcripts, bootstrap persona Markdown, curated memory, inbound/TTS blobs, session tooling config, ACP index. |
| **Agent dir** `…/agents/<agentId>/agent/` | OpenClaw-style process state: `agent.json`, per-agent credentials, IPC inbox, pid/socket, small machine state, extension installs, outbound crash-recovery queue. |
| **Markdown workspace** | User project tree: tool `cwd`, daily `memory/*.md`, `media/generated`, user `skills/`, arbitrary files. **Not** the primary home for persona files or internal agent state. |

Paths below use `~/.xopcbot` as the default state root; override with `XOPCBOT_STATE_DIR`, `XOPCBOT_PROFILE`, or `XOPCBOT_HOME` (see [workspace.md](workspace.md#environment-variables-quick-reference)).

## State directory (global)

Default: `~/.xopcbot/`

| Path | Purpose |
|------|---------|
| `xopcbot.json` | Main application config (unless `XOPCBOT_CONFIG` / `XOPCBOT_CONFIG_PATH` points elsewhere). |
| `credentials/` | Global secrets: `auth-profiles.json`, `oauth/<provider>.json`. |
| `extensions/` | Installed extension packages, `extensions-lock.json`. |
| `skills/` | Globally managed skill packages (`<id>/SKILL.md`). |
| `cron/` | `jobs.json`, `logs/`, `runs/`. |
| `logs/` | Application logs (overridable via `XOPCBOT_LOG_DIR`). |
| `bin/`, `tools/` | Managed CLI shim and tool runtimes. |
| `models.json` | Optional custom model registry data. |

## Agent home: `agents/<agentId>/`

Resolved by `resolveAgentHomeDir(config, agentId)`. Typical layout:

| Path | Purpose |
|------|---------|
| `bootstrap/` | Persona and bootstrap Markdown: `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `AGENTS.md`, `HEARTBEAT.md`, `MEMORY.md` (prompt bootstrap, distinct from curated store), `CONTEXT.md`, `SKILLS.md`, `BOOTSTRAP.md`. Loaded via `loadBootstrapFiles` (`src/agent/context/workspace.ts`). Gateway heartbeat file: `resolveHeartbeatMdPath` → `bootstrap/HEARTBEAT.md`. |
| `sessions/` | Transcript store (shards, `index.json`, `archive/`), per-session overrides under `sessions/config/`, ACP metadata index `sessions/acp-sessions.json`. |
| `memories/` | Curated structured store (`MEMORY.md`, `USER.md`; entries separated by a fixed delimiter — `BuiltinMemoryStore`). |
| `inbound/` | Persisted inbound attachments (non-image binaries); transcript paths use `inbound/...` relative to agent home. |
| `tts/` | Cached outbound TTS audio per session. |
| `agent/` | See **Agent dir** below. |

Seeding: `xopcbot init` / `xopcbot agents add` create `bootstrap/` files and workspace layout; templates live under `src/agent/context/workspace-templates/` (see [Workspace templates](reference/templates.md)).

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

Resolved by `resolveAgentWorkspaceDir(config, agentId)` — often `<stateDir>/workspace` for the default agent, or `<stateDir>/workspace-<id>`, or paths from `agents.defaults.workspace` / per-list `workspace`.

**Intended contents** (user-visible / tool-facing):

| Path | Purpose |
|------|---------|
| `memory/` | Daily or topical notes (`YYYY-MM-DD.md`); `memory_search` / tool cwd. |
| `media/generated/` | Generated images and similar outputs. |
| `skills/` | User-authored skills. |
| *arbitrary files* | `read` / `write` / `edit` tool targets. |

Internal state is **not** written here on new installs. This tree is the only supported layout: persona and machine state live under `agents/<id>/` (see table at top). There is **no** automatic import from older “everything under the markdown workspace” layouts—use `xopcbot setup` / `xopcbot onboard` for bootstrap templates, and move any old data yourself if you are upgrading from another fork.

Inbound / TTS attachments in transcripts use relative paths under `inbound/` and `tts/` **only** (resolved from agent home).

## Operations helpers

- `listAgentWorkspaceDirs(config)` — all markdown roots for listed agents (`src/config/workspace-dirs.ts`).
- `listAgentBootstrapDirs(config)` — all `bootstrap/` roots for backup or editors.

## See also

- [State directory & workspace layout](workspace.md) — setup, env vars, template list.
- [Architecture](architecture.md) — how services use these paths.
- [Session management](session.md) — session store layout.
