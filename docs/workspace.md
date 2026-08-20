# State Directory & Workspace Layout

For a concise map of **profile Markdown**, **agent home**, and the **Markdown workspace**, see [On-disk layout](disk-layout.md).

xopc keeps **machine-local state** under a single **state directory** (the “Agent OS” root), with a shared `user/` context plus per-agent trees for profile, inbox, inbound/TTS blobs, and runtime files. **Session transcripts** live in **`xopc.db`** (SQLite) at the state root. Separately, the **agent workspace** is the Markdown root the runtime uses as tool `cwd`, for user files, generated artifacts, and extensions under that tree.

Paths come from your **main config file** (default `<stateDir>/xopc.json`) and optional env overrides. **`xopc init`** and **`xopc agents add`** create directories and seed templates. The **Markdown workspace** (tool `cwd` and project files) is **not** the same folder as `agents/<id>/` state: each manifest owns `agents.list[].workspace.root`; when unavailable during fallback resolution xopc uses `<stateDir>/workspace/<agentId>/`.

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
| `xopc.json` | Main configuration (providers, gateway, channels, `agents.list`, `agents.capabilityPresets`, …). |
| `xopc.db` | SQLite database: sessions, transcripts, automations, per-session config, compaction checkpoints, FTS5 search. |
| `credentials/` | Global secrets; `auth-profiles.json`; `oauth/<provider>.json` for OAuth tokens. |
| `extensions/` | Installed extensions and `extensions-lock.json`. |
| `skills/` | Skill packages (each skill is a folder with `SKILL.md`). |
| `logs/` | Process logs (`xopc-<date>.log`), unless `XOPC_LOG_DIR` overrides. |
| `bin/` | Managed CLI shim (e.g. `xopc`). |
| `tools/` | Bundled tool runtimes (e.g. `tools/node/current/` for Node/npm used by tools). |
| `models.json` | Cached model registry data. |
| `user/` | Shared `PROFILE.md` and operational Dreaming event logs; durable understanding lives in `xopc.db`. |

## Per-agent tree: `agents/<agentId>/`

For a given **`agentId`**, the **agent home** is `~/.xopc/agents/<id>/` by default (under `XOPC_STATE_DIR` / profile rules above). **`agents.list[].agentDir`** in config can override the inner **agent state** directory (the `…/agent` subtree: credentials, `agent.json`, inbox, pid/socket).

| Path | Role |
|------|------|
| `agent/` | **Agent state** (not the Markdown workspace): `agent.json`, `credentials/`, file inbox (`inbox/pending`, `inbox/processed`), and volatile files (`pid`, `status.json`, `agent.sock`) — no separate top-level `run/`. |

Session metadata and transcripts live in **`~/.xopc/xopc.db`** (SQLite).

## Agent workspace directory (Markdown root)

With a normal config, each agent gets an explicit **`agents.list[].workspace.root`** path. Fallback resolution uses **`<stateDir>/workspace/<agentId>`**.

When the CLI runs **without** a loaded config file, **`XOPC_WORKSPACE`** wins if set (full path to the primary agent’s Markdown root); otherwise the primary Markdown tree defaults to **`<stateDir>/workspace/main`**. **`xopc init`** creates **`agents/<id>/`**, the Markdown workspace, and seeds profile Markdown under **`agents/<id>/profile/`** from built-in templates (filenames in [Workspace templates](/reference/templates)) only when missing. **`xopc agents add`** updates **`agents.list`**, creates directories, and seeds profile files (see [CLI](cli.md#agents)).

### Profile Markdown (agent persona)

These files are injected into the system prompt as **Project Context** (OpenClaw-aligned bootstrap). Location: **`agents/<agentId>/profile/`** (same filenames). Runtime also injects the global user profile from **`user/PROFILE.md`** when present. Agents should not manually reread startup context at session start unless the user asks or context is incomplete.

| File | Role |
|------|------|
| `SOUL.md` | Principles and “who you are” for the agent. |
| `IDENTITY.md` | Name, description, language, avatar, tone, boundaries. This is the source of truth for UI display identity and model-visible identity. |
| `TOOLS.md` | Environment-specific tool hints (hosts, devices, …). |
| `AGENTS.md` | Session Startup, Red Lines, and collaboration guidelines. |
| `HEARTBEAT.md` | Heartbeat / proactive check configuration (dynamic Project Context when enabled). |
Memory is not part of an agent profile. Every agent reads and writes the shared user context under `user/`, controlled by top-level `userContext`.

Other root Markdown files (for example `CONTEXT.md` or `SKILLS.md`) are optional and are **not** loaded into the default system prompt unless you wire them in yourself (e.g. read via tools or custom workflow).

### Subdirectories and dot folders

| Path | Role |
|------|------|
| `.state/` | Machine state: `workspace.json` (profile Markdown seed metadata), `skills-cache.json`, etc. |
| `.extensions/` | Per-workspace extension install/cache paths (when used by the extension loader). |

Per-session overrides (SQLite `session_config`), **inbound** blobs (`inbound/`), **TTS** cache (`tts/`), and structured memory relate to **`agents/<agentId>/`** (agent home) or **`xopc.db`**, not under this Markdown tree.

### Structured user understanding

User understanding and Dreaming state live in the structured SQLite memory store. Every agent consumes the same user-owned records through the context compiler; workspace Markdown files are ordinary documents and are never treated as runtime memory.

## Which path is “the” workspace at runtime?

Two related ideas:

1. **Gateway** — uses the **default agent** from config and that agent’s resolved Markdown workspace. Per-workspace extensions use `<that workspace>/.extensions` when present.

2. **CLI** (no explicit `--workspace` on the root command) — **`XOPC_WORKSPACE`** if set, otherwise **`<stateDir>/workspace/main`** (or your profile/state dir equivalent).

After `xopc init`, profile Markdown for `main` lives under **`~/.xopc/agents/main/profile/`** by default. The Markdown workspace is the selected manifest's **`workspace.root`**, commonly `~/.xopc/workspace/main`.

## Environment variables (quick reference)

| Variable | Purpose |
|----------|---------|
| `XOPC_STATE_DIR` | State root |
| `XOPC_PROFILE` | Profile-specific state directory |
| `XOPC_HOME` | Home override for default state path |
| `XOPC_CONFIG` / `XOPC_CONFIG_PATH` | Config file location |
| `XOPC_WORKSPACE` | Primary agent Markdown root when no `--workspace` (full path) |
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
