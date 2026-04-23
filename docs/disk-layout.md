# On-disk layout

This page lists where xopc reads and writes on disk. Effective paths always come from your **config file** (default `~/.xopc/xopc.json`) and environment variables such as `XOPC_CONFIG` and `XOPC_WORKSPACE`.

For narrative setup (init, templates, env vars), see [State directory & workspace layout](workspace.md).

## Design split

| Area | Role |
|------|------|
| **State directory** | Global config, credentials, logs, cron, global skills/extensions cache, managed tooling. |
| **Agent home** `<stateDir>/agents/<agentId>/` | Per-agent runtime: transcripts, bootstrap persona Markdown, curated memory, inbound/TTS blobs, session tooling config. |
| **Agent dir** `…/agents/<agentId>/agent/` | Process state: `agent.json`, per-agent credentials, IPC inbox, pid/socket, small machine state, extension installs, outbound crash-recovery queue. |
| **Markdown workspace** | User project tree: tool `cwd`, daily `memory/*.md`, `media/generated`, user `skills/`, arbitrary files. **Not** the primary home for persona files or internal agent state. |

Paths below use `~/.xopc` as the default state root; override with `XOPC_STATE_DIR`, `XOPC_PROFILE`, or `XOPC_HOME` (see [workspace.md](workspace.md#environment-variables-quick-reference)).

## State directory (global)

Default: `~/.xopc/`

| Path | Purpose |
|------|---------|
| `xopc.json` | Main application config (unless `XOPC_CONFIG` / `XOPC_CONFIG_PATH` points elsewhere). |
| `credentials/` | Global secrets: `auth-profiles.json`, `oauth/<provider>.json`. |
| `extensions/` | Installed extension packages, `extensions-lock.json`. |
| `skills/` | Globally managed skill packages (`<id>/SKILL.md`). |
| `cron/` | `jobs.json`, `logs/`, `runs/`. |
| `logs/` | Application logs (overridable via `XOPC_LOG_DIR`). |
| `bin/`, `tools/` | Managed CLI shim and tool runtimes. |
| `models.json` | Optional custom model registry data. |

## Agent home: `agents/<agentId>/`

Resolved by `resolveAgentHomeDir(config, agentId)`. Typical layout:

| Path | Purpose |
|------|---------|
| `bootstrap/` | Persona and bootstrap Markdown: `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `AGENTS.md`, `HEARTBEAT.md`, `MEMORY.md` (system-prompt bootstrap, separate from curated `memories/`), `CONTEXT.md`, `SKILLS.md`, `BOOTSTRAP.md`. Used when building the agent system prompt. Gateway heartbeat text defaults to `bootstrap/HEARTBEAT.md` when present. |
| `sessions/` | Transcript store (shards, `index.json`, `archive/`), per-session overrides under `sessions/config/`. |
| `memories/` | Curated structured store (`MEMORY.md`, `USER.md`; entries separated by a fixed delimiter — `BuiltinMemoryStore`). |
| `inbound/` | Persisted inbound attachments (non-image binaries); transcript paths use `inbound/...` relative to agent home. |
| `tts/` | Cached outbound TTS audio per session. |
| `agent/` | See **Agent dir** below. |

Seeding: `xopc init` / `xopc agents add` create `bootstrap/` files and workspace layout from built-in templates (see [Workspace templates](reference/templates.md)).

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

Internal state is **not** written here on new installs. This tree is the only supported layout: persona and machine state live under `agents/<id>/` (see table at top). There is **no** automatic import from older “everything under the markdown workspace” layouts—use `xopc setup` / `xopc onboard` for bootstrap templates, and move any old data yourself if you are upgrading from another fork.

Inbound / TTS attachments in transcripts use relative paths under `inbound/` and `tts/` **only** (resolved from agent home).

## Operations helpers

- `listAgentWorkspaceDirs(config)` — all Markdown workspace roots for agents listed in config (CLI / advanced use).
- `listAgentBootstrapDirs(config)` — all `bootstrap/` roots for backup or editors.

## See also

- [State directory & workspace layout](workspace.md) — setup, env vars, template list.
- [Architecture](architecture.md) — how services use these paths.
- [Session management](session.md) — session store layout.
