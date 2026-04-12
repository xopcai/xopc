# State Directory & Workspace Layout

For a concise map of **bootstrap**, **agent home**, and the **Markdown workspace**, see [On-disk layout](disk-layout.md).

xopc keeps **machine-local state** under a single **state directory** (the “Agent OS” root) and, inside it, **per-agent** trees for transcripts, inbox, inbound/TTS blobs, curated memory, and runtime files. Separately, the **agent workspace** is the Markdown root the runtime uses as tool `cwd`, for daily `memory/` notes, user files, and extensions under that tree.

Path resolution uses **`config.json`** as the source of truth: `src/agent/agent-scope.ts` (workspace and agent-dir resolution), plus `src/config/paths-state.ts`, `src/config/workspace-defaults.ts`, and `src/config/paths.ts`. Workspace bootstrap is seeded by **`xopc init`** (`src/cli/commands/init.ts`) and by **`xopc agents add`**. The **Markdown workspace** is **not** under `agents/<id>/` (it lives beside the state root as `workspace` / `workspace-<id>` or under `agents.defaults.workspace/<id>` when configured).

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
| `credentials/` | Global secrets; `auth-profiles.json`; `oauth/<provider>.json` for OAuth tokens. |
| `extensions/` | Installed extensions and `extensions-lock.json`. |
| `skills/` | Skill packages (each skill is a folder with `SKILL.md`). |
| `cron/` | `jobs.json` scheduled jobs; `logs/` daily JSONL logs; `runs/` per-job run history. |
| `logs/` | Process logs (`xopc-<date>.log`), unless `XOPC_LOG_DIR` overrides. |
| `bin/` | Managed CLI shim (e.g. `xopc`). |
| `tools/` | Bundled tool runtimes (e.g. `tools/node/current/` for Node/npm used by tools). |
| `models.json` | Cached model registry data. |

## Per-agent tree: `agents/<agentId>/`

For a given **`agentId`**, the **agent home** is `~/.xopc/agents/<id>/` by default (under `XOPC_STATE_DIR` / profile rules above). **`agents.list[].agentDir`** in config can override the inner **agent state** directory (the `…/agent` subtree: credentials, `agent.json`, inbox, pid/socket).

| Path | Role |
|------|------|
| `sessions/` | Session store: sharded transcript files, `index.json`, `archive/` for archived sessions. |
| `agent/` | **Agent state** (not the Markdown workspace): `agent.json`, `credentials/`, file inbox (`inbox/pending`, `inbox/processed`), and volatile files (`pid`, `status.json`, `agent.sock`) — no separate top-level `run/`. |

Session storage is **not** under the Markdown workspace directory; it always uses `agents/<agentId>/sessions/`.

## Agent workspace directory (Markdown root)

Heuristic paths (no per-list `workspace` override in config): default agent id → `<stateDir>/workspace`; other ids → `<stateDir>/workspace-<id>` when `agents.defaults.workspace` is unset. With **`config.json`**, use merged resolution via `resolveAgentWorkspaceDir` / effective agent profile: explicit `workspace`, or `join(<agents.defaults.workspace>, <id>)` for a listed agent, or the `workspace-<id>` fallback.

When no **`config.json`** is loaded, CLI defaults use **`resolveDefaultAgentWorkspaceDir()`** (`src/config/workspace-defaults.ts`): `XOPC_WORKSPACE` if set, otherwise `~/.xopc/workspace` for the primary tree. **`xopc init`** loads config (or schema defaults), creates **`agents/<id>/`** and the resolved Markdown workspace, and **seeds** the standard bootstrap set from built-in templates (same filenames as [Workspace templates](/reference/templates): `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `AGENTS.md`, `HEARTBEAT.md`, `MEMORY.md`, plus `BOOTSTRAP.md` from the template pack). Files are only written when missing. **`xopc agents add`** updates **`agents.list`**, creates directories, and seeds the new workspace — use that to add additional agents (see [CLI](cli.md#agents)).

### Bootstrap Markdown (persona & memory index)

These files are loaded into the system prompt (see `src/agent/context/workspace.ts` for order and limits). Names are constants in `WORKSPACE_FILES` (`src/config/paths.ts`).

| File | Role |
|------|------|
| `SOUL.md` | Principles and “who you are” for the agent. |
| `IDENTITY.md` | Name, tone, boundaries. |
| `USER.md` | Notes about the human user. |
| `TOOLS.md` | Environment-specific tool hints (hosts, devices, …). |
| `AGENTS.md` | Safety and collaboration guidelines. |
| `HEARTBEAT.md` | Heartbeat / proactive check configuration (empty or comment-only skips calls). |
| `MEMORY.md` | Curated long-term memory index. |
| `CONTEXT.md` | Current focus / active project (maintained by you or the agent). |
| `SKILLS.md` | Workspace skills index (can be auto-maintained). |
| `BOOTSTRAP.md` | Optional onboarding tips; often created by `onboard` / template setup, not always by `init`. |

### Subdirectories and dot folders

| Path | Role |
|------|------|
| `memory/` | Dated or topical memory snippets (e.g. `YYYY-MM-DD.md`); used with memory tools. |
| `.state/` | Machine state: `workspace.json` (bootstrap seed metadata), `skills-cache.json`, etc. |
| `.extensions/` | Per-workspace extension install/cache paths (when used by the extension loader). |

Per-session overrides (`sessions/config/` JSON), **inbound** blobs (`inbound/`), **TTS** cache (`tts/`), and the **curated** store (`memories/`) live under **`agents/<agentId>/`** (agent home), not under this Markdown tree.

### Curated memory (`agents/<agentId>/memories/`) {#curated-memory}

Separate from bootstrap `MEMORY.md` (under `agents/<id>/bootstrap/`) and from workspace `memory/*.md` (searchable snippets), **`agents/<agentId>/memories/`** holds **bounded, §-delimited** entries in `MEMORY.md` (agent notes) and `USER.md` (user profile). A frozen snapshot is injected into the system prompt when enhanced memory is enabled; the agent can update live files via the **`curated_memory`** tool. Behavior and limits are configured under **`agents.defaults.memory`** ([Configuration](configuration.md)).

## Which path is “the” workspace at runtime?

Two related ideas:

1. **Merged default agent workspace** — the **gateway** and `getWorkspacePath(config)` (`src/config/schema.ts`) resolve the **default** agent id from config, then the Markdown root via `resolveAgentWorkspaceDir` / effective profile. Extensions for the gateway use `<that workspace>/.extensions`.

2. **CLI default context** (no explicit `--workspace` on the root program) — `XOPC_WORKSPACE` if set, else **`resolveDefaultAgentWorkspaceDir()`** → `~/.xopc/workspace` when using state-dir heuristics (`src/cli/registry.ts`, `src/config/workspace-defaults.ts`).

After `xopc init`, bootstrap files for `main` live under `~/.xopc/workspace/` by default; ensure **`agents.defaults.workspace`** (and any **`agents.list[].workspace`**) point at the same tree if you want the gateway and CLI to load identical Markdown without duplication.

## Environment variables (quick reference)

| Variable | Purpose |
|----------|---------|
| `XOPC_STATE_DIR` | State root |
| `XOPC_PROFILE` | Profile-specific state directory |
| `XOPC_HOME` | Home override for default state path |
| `XOPC_CONFIG` / `XOPC_CONFIG_PATH` | Config file location |
| `XOPC_WORKSPACE` | Default Markdown workspace for CLI context when no `--workspace` |
| `XOPC_CREDENTIALS_DIR` | Global credentials directory |
| `XOPC_LOG_DIR` | Log file directory |

## See also

- [Workspace templates](reference/templates.md) — what each Markdown file is for
- [Session management](session.md) — sessions live under `agents/<id>/sessions/`
- [Architecture](architecture.md) — how components use these paths
