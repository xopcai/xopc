# State Directory & Workspace Layout

For a concise map of **profile Markdown**, **agent home**, and the **Markdown workspace**, see [On-disk layout](disk-layout.md).

xopc keeps **machine-local state** under a single **state directory** (the “Agent OS” root) and, inside it, **per-agent** trees for inbox, inbound/TTS blobs, curated memory, and runtime files. **Session transcripts** live in **`xopc.db`** (SQLite) at the state root. Separately, the **agent workspace** is the Markdown root the runtime uses as tool `cwd`, for daily `memory/` notes, user files, and extensions under that tree.

Paths come from your **main config file** (default `<stateDir>/xopc.json`) and optional env overrides. **`xopc init`** and **`xopc agents add`** create directories and seed templates. The **Markdown workspace** (tool `cwd` and project files) is **not** the same folder as `agents/<id>/` state: by default each agent id uses `<stateDir>/workspace/<agentId>/` (the default agent id is `main`), or under **`agents.defaults.workspace`** as a **parent** directory (`<expanded>/<agentId>/`), or an explicit per-list **`workspace`** path.

## State directory root

Default: `~/.xopc`  
Overrides (highest priority first):

| Mechanism | Result |
|-----------|--------|
| `XOPC_STATE_DIR` | Explicit state root |
| `XOPC_PROFILE` | `~/.xopc-<profile>` when set and not `default` |
| `XOPC_HOME` | Base for the default `~/.xopc` path (`$XOPC_HOME/.xopc`) |

Main config file: `xopc.json` in the state directory, unless `XOPC_CONFIG` / `XOPC_CONFIG_PATH` points elsewhere.

## Global directories (under the state root)

These are shared across agents unless noted.

| Path | Role |
|------|------|
| `xopc.json` | Main configuration (providers, gateway, channels, `agents.defaults`, …). |
| `xopc.db` | SQLite database: sessions, transcripts, per-session config, compaction checkpoints, FTS5 search. |
| `credentials/` | Global secrets; `auth-profiles.json`; `oauth/<provider>.json` for OAuth tokens. |
| `extensions/` | Installed extensions and `extensions-lock.json`. |
| `skills/` | Skill packages (each skill is a folder with `SKILL.md`). |
| `cron/` | `jobs.json` scheduled jobs. Run history is in **`xopc.db`** (`cron_runs`). |
| `logs/` | Process logs (`xopc-<date>.log`), unless `XOPC_LOG_DIR` overrides. |
| `bin/` | Managed CLI shim (e.g. `xopc`). |
| `tools/` | Bundled tool runtimes (e.g. `tools/node/current/` for Node/npm used by tools). |
| `models.json` | Cached model registry data. |

## Per-agent tree: `agents/<agentId>/`

For a given **`agentId`**, the **agent home** is `~/.xopc/agents/<id>/` by default (under `XOPC_STATE_DIR` / profile rules above). **`agents.list[].agentDir`** in config can override the inner **agent state** directory (the `…/agent` subtree: credentials, `agent.json`, inbox, pid/socket).

| Path | Role |
|------|------|
| `agent/` | **Agent state** (not the Markdown workspace): `agent.json`, `credentials/`, file inbox (`inbox/pending`, `inbox/processed`), and volatile files (`pid`, `status.json`, `agent.sock`) — no separate top-level `run/`. |

Session metadata and transcripts live in **`~/.xopc/xopc.db`** (SQLite).

## Agent workspace directory (Markdown root)

With a normal config, each agent gets an explicit **`workspace`** path or inherits **`join(agents.defaults.workspace, <agentId>)`**, or falls back to **`<stateDir>/workspace/<agentId>`** when `agents.defaults.workspace` is unset.

When the CLI runs **without** a loaded config file, **`XOPC_WORKSPACE`** wins if set (full path to the primary agent’s Markdown root); otherwise the primary Markdown tree defaults to **`<stateDir>/workspace/main`**. **`xopc init`** creates **`agents/<id>/`**, the Markdown workspace, and seeds profile Markdown under **`agents/<id>/profile/`** from built-in templates (filenames in [Workspace templates](/reference/templates)) only when missing. **`xopc agents add`** updates **`agents.list`**, creates directories, and seeds profile files (see [CLI](cli.md#agents)).

### Profile Markdown (persona & memory index)

These files are injected into the system prompt as **Project Context** (OpenClaw-aligned bootstrap). Location: **`agents/<agentId>/profile/`** (same filenames). Runtime loads them on each agent run; agents should not manually reread SOUL/USER/MEMORY at session start unless the user asks or context is incomplete.

| File | Role |
|------|------|
| `SOUL.md` | Principles and “who you are” for the agent. |
| `IDENTITY.md` | Name, tone, boundaries. |
| `USER.md` | Notes about the human user. |
| `TOOLS.md` | Environment-specific tool hints (hosts, devices, …). |
| `AGENTS.md` | Session Startup, Red Lines, and collaboration guidelines. |
| `HEARTBEAT.md` | Heartbeat / proactive check configuration (dynamic Project Context when enabled). |
| `MEMORY.md` | Curated long-term memory index (main session only; omitted for subagent/cron). |

On `/new` and `/reset`, xopc may also prepend recent **`memory/YYYY-MM-DD.md`** excerpts to the first user turn (`agents.defaults.startupContext`). **`agents/<id>/memories/`** is **not** injected into the prompt; use the `curated_memory` tool for live read/write.

Other root Markdown files (for example `CONTEXT.md` or `SKILLS.md`) are optional and are **not** loaded into the default system prompt unless you wire them in yourself (e.g. read via tools or custom workflow).

### Subdirectories and dot folders

| Path | Role |
|------|------|
| `memory/` | Dated or topical memory snippets (e.g. `YYYY-MM-DD.md`); used with memory tools. |
| `.state/` | Machine state: `workspace.json` (profile Markdown seed metadata), `skills-cache.json`, etc. |
| `.extensions/` | Per-workspace extension install/cache paths (when used by the extension loader). |

Per-session overrides (SQLite `session_config`), **inbound** blobs (`inbound/`), **TTS** cache (`tts/`), and the **curated** store (`memories/`) relate to **`agents/<agentId>/`** (agent home) or **`xopc.db`**, not under this Markdown tree.

### Curated memory (`agents/<agentId>/memories/`) {#curated-memory}

Separate from **`agents/<agentId>/profile/MEMORY.md`** (system-prompt profile index) and from workspace `memory/*.md` (searchable snippets), **`agents/<agentId>/memories/`** holds **bounded, §-delimited** entries in `MEMORY.md` (agent notes) and `USER.md` (user profile). A frozen snapshot is injected into the system prompt when enhanced memory is enabled; the agent can update live files via the **`curated_memory`** tool. Behavior and limits are configured under **`agents.defaults.memory`** ([Configuration](configuration.md)).

## Which path is “the” workspace at runtime?

Two related ideas:

1. **Gateway** — uses the **default agent** from config and that agent’s resolved Markdown workspace. Per-workspace extensions use `<that workspace>/.extensions` when present.

2. **CLI** (no explicit `--workspace` on the root command) — **`XOPC_WORKSPACE`** if set, otherwise **`<stateDir>/workspace/main`** (or your profile/state dir equivalent).

After `xopc init`, profile Markdown for `main` lives under **`~/.xopc/agents/main/profile/`** by default. The Markdown workspace remains **`agents.defaults.workspace/main`** when that parent is set (schema default `~/.xopc/workspace` → `~/.xopc/workspace/main`), or **`<stateDir>/workspace/main`** when it is not. Per-list **`agents.list[].workspace`** overrides the derived Markdown path for that agent only.

## Environment variables (quick reference)

| Variable | Purpose |
|----------|---------|
| `XOPC_STATE_DIR` | State root |
| `XOPC_PROFILE` | Profile-specific state directory |
| `XOPC_HOME` | Home override for default state path |
| `XOPC_CONFIG` / `XOPC_CONFIG_PATH` | Config file location |
| `XOPC_WORKSPACE` | Primary agent Markdown root when no `--workspace` (full path; not the `agents.defaults.workspace` parent) |
| `XOPC_CREDENTIALS_DIR` | Global credentials directory |
| `XOPC_LOG_DIR` | Log file directory |

### State profiles (CLI)

Use **`xopc profile`** to manage separate state roots (`~/.xopc` for `default`, `~/.xopc-<name>` otherwise):

```bash
xopc profile list
xopc profile create staging
xopc profile switch staging   # prints export XOPC_PROFILE=staging
```

## See also

- [Workspace templates](reference/templates.md) — what each Markdown file is for
- [Session management](session.md) — session metadata and transcripts live in `~/.xopc/xopc.db` (SQLite)
- [Architecture](architecture.md) — how components use these paths
