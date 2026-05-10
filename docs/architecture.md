# Architecture

This page describes how xopc is structured and how the main pieces fit together.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      xopc                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    CLI Layer                         │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ setup   │ │ onboard │ │ agent   │ │ gateway │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     Core                             │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │              AgentService                    │   │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │   │
│  │  │  │ Prompt  │ │ Memory  │ │ Skills  │       │   │   │
│  │  │  │ Builder │ │ Search  │ │         │       │   │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘       │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Providers                          │   │
│  │            @earendil-works/pi-ai (20+ providers)      │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────────┐     ┌──────────┐        ┌──────────┐
  │ Channel bots │     │   Cron   │        │ Gateway  │
  │ (bundled IM) │     │ Scheduler│        │   API    │
  └──────────────┘     └──────────┘        └──────────┘
```

## Major components

| Area | Role |
|------|------|
| **CLI** | Commands such as `agent`, `tui`, `gateway`, `config`, `onboard`, and extension management. |
| **Agent** | Runs the model, tools, memory, skills, and session handling for each conversation. |
| **Gateway** | HTTP server and static **Web console** (chat, settings, logs, channels, cron, …). |
| **Channels** | Bundled bots (Telegram, Weixin, Feishu/Lark, DingTalk) and gateway web chat share one outbound pipeline. |
| **Extensions** | Optional add-ons (tools, hooks, channels, console panels) from your workspace, `~/.xopc/extensions/`, or the install bundle. |
| **Config** | Single JSON file (default `~/.xopc/xopc.json`) plus environment variables for secrets. |

## State directory & workspace on disk

Runtime data (config, credentials, per-agent sessions, the Markdown **workspace** used as tool cwd and user content, and per-agent **bootstrap** persona Markdown under `agents/<id>/bootstrap/`) lives outside the git repo under the **state directory** (default `~/.xopc`). For a filesystem map (bootstrap, agent home, Markdown workspace), see [On-disk layout](disk-layout.md). For setup, env overrides, and how `agents.defaults.workspace` relates to default paths, see [State directory & workspace layout](workspace.md).

## Agent and prompt

**AgentService** is the runtime that:

1. Accepts user messages from channels or the Web console.
2. Builds the system prompt from **bootstrap** Markdown under each agent’s directory (`SOUL.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`, …) plus optional memory snippets.
3. Persists **session** transcripts and runs **compaction** when configured.
4. Runs **built-in and extension tools** with progress feedback for long steps.

**Prompt sections** (conceptual): identity, tool style, safety, workspace path, skills, messaging, heartbeats, and runtime hints—see [Workspace](workspace.md) and [Templates](reference/templates.md).

## Built-in tools (overview)

| Tool | Purpose |
|------|---------|
| `read_file` / `write_file` / `edit_file` | Workspace file operations |
| `list_dir`, `grep`, `find` | Navigate and search the workspace |
| `shell` | Run shell commands (time-limited) |
| `web_search`, `web_fetch` | Web search and fetch (when configured) |
| `send_message` | Send outbound chat on the current channel |
| `memory_search`, `memory_get` | Search/read `memory/*.md` in the workspace |
| `curated_memory` | Edit bounded entries in the agent home `memories/` tree when enabled |
| `session_search` | Search other sessions when the session store is available |

Exact availability depends on [Configuration](configuration.md) and extensions.

## Progress feedback

Long-running tool work emits short status lines (reading, searching, shell, …) so clients can show activity before the final reply.

## Memory and sessions

- **Sessions** — per-agent conversation history on disk (not the same folder as Markdown “workspace” project files).
- **Curated memory** — optional `memories/` store and tools; tuned under `agents.defaults.memory`.
- **Compaction** — context window management under `agents.defaults.compaction` / pruning.

## Channels and extensions

Channels (Telegram, Weixin, Web chat, and extension-provided types) share the same message bus into the agent. Configure them under `channels.*` in your config file; see [Channel configuration](/channels). Extensions add tools, hooks, optional channel plugins, and optional Web-console UI—see [Extensions](extensions.md).

## Data Flow

### Conversation Flow

```
User (Telegram/Gateway/CLI)
        │
        ▼
┌─────────────────────┐
│   Channel Handler   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   AgentService      │
│  ┌───────────────┐  │
│  │ Load Bootstrap │  │ ← SOUL.md, USER.md, TOOLS.md, AGENTS.md
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Build Prompt  │  │ ← bootstrap files, curated snapshot, memory_search / memory_get, …
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ LLM (pi-ai)   │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Execute Tools │  │ ← Tools + Extensions
│  │ + Progress    │  │ ← Progress feedback
│  └───────┬───────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Response          │
└──────────┬──────────┘
           │
           ▼
User Reply / Channel Response
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ |
| Language | TypeScript 5.x |
| LLM SDK | @earendil-works/pi-ai |
| Agent Framework | @earendil-works/pi-agent-core |
| CLI | Commander.js |
| Validation | Zod (config) + TypeBox (tools) |
| Logging | Pino |
| Cron | node-cron |
| HTTP Server | Hono |
| Web UI | React + Vite + Tailwind v4 (gateway console) |
| Testing | Vitest |

## Changing xopc itself

To add core tools, channels, or CLI commands, work in the xopc source tree and follow the contributor guide **`AGENTS.md`** in the repository. Extensions are the supported way to customize behaviour without forking—see [Extensions](extensions.md).
