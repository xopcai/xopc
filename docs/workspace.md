# State Directory & Workspace Layout

xopcbot keeps **machine-local state** under a single **state directory** (the “Agent OS” root) and, inside it, **per-agent** trees for transcripts, inbox, and runtime files. Separately, the **agent workspace** is the folder the runtime uses for bootstrap Markdown, tools data, extensions under that tree, and inbound attachment persistence.

Path resolution is implemented in `src/config/paths.ts` and seeded by `xopcbot init` (`src/cli/commands/init.ts`).

## State directory root

Default: `~/.xopcbot`  
Overrides (highest priority first):

| Mechanism | Result |
|-----------|--------|
| `XOPCBOT_STATE_DIR` | Explicit state root |
| `XOPCBOT_PROFILE` | `~/.xopcbot-<profile>` when set and not `default` |
| `XOPCBOT_HOME` | Base for the default `~/.xopcbot` path (`$XOPCBOT_HOME/.xopcbot`) |

Main config file: `xopcbot.json` in the state directory, unless `XOPCBOT_CONFIG` / `XOPCBOT_CONFIG_PATH` points elsewhere.

## Global directories (under the state root)

These are shared across agents unless noted.

| Path | Role |
|------|------|
| `xopcbot.json` | Main configuration (providers, gateway, channels, `agents.defaults`, …). |
| `credentials/` | Global secrets; `auth-profiles.json`; `oauth/<provider>.json` for OAuth tokens. |
| `extensions/` | Installed extensions and `extensions-lock.json`. |
| `skills/` | Skill packages (each skill is a folder with `SKILL.md`). |
| `cron/` | `jobs.json` scheduled jobs; `logs/` daily JSONL logs; `runs/` per-job run history. |
| `logs/` | Process logs (`xopcbot-<date>.log`), unless `XOPCBOT_LOG_DIR` overrides. |
| `bin/` | Managed CLI shim (e.g. `xopcbot`). |
| `tools/` | Bundled tool runtimes (e.g. `tools/node/current/` for Node/npm used by tools). |
| `models.json` | Cached model registry data. |

## Per-agent tree: `agents/<agentId>/`

`agentId` defaults to `main` (`XOPCBOT_AGENT_ID`).  
`XOPCBOT_AGENT_DIR` can replace the entire `agents/<id>` path.

| Path | Role |
|------|------|
| `agent.json` | Agent metadata (name, model hint, tags, …). |
| `credentials/` | Agent-scoped credentials (`auth-profiles.json`). |
| `workspace/` | **Agent workspace** — see next section. |
| `sessions/` | Session store root: sharded transcript files, `index.json`, `archive/` for archived sessions. |
| `inbox/` | File-based inbox: `pending/`, `processed/` (`<messageId>.json`). |
| `run/` | Volatile runtime: `pid`, `status.json`, `agent.sock` (Unix socket). |

Session storage is **not** under the Markdown workspace directory; it always uses `agents/<agentId>/sessions/` (with optional one-time migration from legacy `<workspace>/.sessions` when that path still exists).

## Agent workspace directory (`agents/<agentId>/workspace/`)

This is the directory returned by `resolveWorkspaceDir()` and created by `xopcbot init` for the chosen agent.

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
| `.sessions/config/` | Per-session overrides stored by the agent service (e.g. model override), under the **configured** workspace path. |
| `.xopcbot/inbound/<session>/` | Persisted inbound attachments (non-image with binary data) for stable paths in transcripts and `read_file`. |

## Which path is “the” workspace at runtime?

Two related ideas:

1. **Config field** `agents.defaults.workspace` (default in schema: `~/.xopcbot/workspace`) — used by the **gateway** and related services via `getWorkspacePath()` (`src/config/schema.ts`). Extensions for the gateway use `<that path>/.extensions`.

2. **CLI default context** — `XOPCBOT_WORKSPACE` if set, else `resolveWorkspaceDir()` → `agents/<id>/workspace` (`src/cli/registry.ts`).

So after `xopcbot init`, bootstrap files live under `~/.xopcbot/agents/main/workspace/`, while a fresh config may still point `agents.defaults.workspace` at `~/.xopcbot/workspace`. **Align these** (symlink or set the config to the agent workspace path) if you want gateway and CLI to share the same bootstrap files without duplication.

## Environment variables (quick reference)

| Variable | Purpose |
|----------|---------|
| `XOPCBOT_STATE_DIR` | State root |
| `XOPCBOT_PROFILE` | Profile-specific state directory |
| `XOPCBOT_HOME` | Home override for default state path |
| `XOPCBOT_CONFIG` / `XOPCBOT_CONFIG_PATH` | Config file location |
| `XOPCBOT_WORKSPACE` | Workspace directory for CLI commands |
| `XOPCBOT_AGENT_ID` | Current agent id (`main`, …) |
| `XOPCBOT_AGENT_DIR` | Override entire `agents/<id>` directory |
| `XOPCBOT_CREDENTIALS_DIR` | Global credentials directory |
| `XOPCBOT_LOG_DIR` | Log file directory |

## See also

- [Workspace templates](reference/templates.md) — what each Markdown file is for
- [Session management](session.md) — sessions live under `agents/<id>/sessions/`
- [Architecture](architecture.md) — how components use these paths
