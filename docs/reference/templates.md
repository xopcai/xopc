# Workspace Templates

xopc uses bootstrap Markdown templates to customize agent behavior and knowledge. During `onboard`, `setup`, or `agents add`, missing files are **copied** (never overwritten) into **`~/.xopc/agents/<agentId>/bootstrap/`** — the same set ships as `src/agent/context/workspace-templates/*.md` and is published under `docs/reference/templates/` for reading in the docs site.

Template resolution at runtime: `XOPC_TEMPLATE_PATH` (if set), else a walk to `docs/reference/templates` from the running install, else the bundled `workspace-templates` directory next to the compiled `workspace-seed` module.

## Template Files

| File | Purpose |
|------|---------|
| [SOUL.md](/reference/templates/SOUL) | Agent's core identity, personality and values |
| [USER.md](/reference/templates/USER) | Information about you, preferences and needs |
| [TOOLS.md](/reference/templates/TOOLS) | Tool usage instructions and best practices |
| [AGENTS.md](/reference/templates/AGENTS) | Agent collaboration guidelines |
| [MEMORY.md](/reference/templates/MEMORY) | Key information storage and memory index |
| [IDENTITY.md](/reference/templates/IDENTITY) | Identity and boundary definitions |
| [HEARTBEAT.md](/reference/templates/HEARTBEAT) | Proactive monitoring configuration |
| [BOOTSTRAP.md](/reference/templates/BOOTSTRAP) | Bootstrap configuration |

## System prompt load order

These files are read from `bootstrap/` (when present) and assembled into the agent system prompt **in this order** (see `BOOTSTRAP_FILES` in `src/agent/context/workspace.ts`):

1. **SOUL.md**
2. **IDENTITY.md**
3. **USER.md**
4. **TOOLS.md**
5. **AGENTS.md**
6. **HEARTBEAT.md**
7. **MEMORY.md**

**BOOTSTRAP.md** is also copied when seeding a new agent; it is **not** part of that load list (first-run / manual guidance only).

**CONTEXT.md** and **SKILLS.md** are **not** in `BOOTSTRAP_FILES`, so they are **not** injected into the default system prompt. The `xopc init` flow can still **create** them under `bootstrap/` (see `src/cli/commands/init.ts`). The template **seed** used by `onboard` / `agents add` (`workspace-seed.ts`) only copies the files listed above plus `BOOTSTRAP.md` — it does **not** ship `CONTEXT.md` / `SKILLS.md` from `docs/reference/templates`.

## Memory System

Memory files support dynamic updates:

- **MEMORY.md** - Index of permanent memories
- **memory/*.md** - Memory snippets organized by date or topic

The agent can search and read memories via `memory_search` and `memory_get` tools.

**Curated memory** (optional): **`agents/<agentId>/memories/MEMORY.md`** and **`USER.md`** hold bounded, tool-edited entries separate from bootstrap `MEMORY.md` under `agents/<id>/bootstrap/`. See [Curated memory](../workspace.md#curated-memory) and [Configuration](../configuration.md) (`agents.defaults.memory`).

## Editing Tips

- Use Markdown format
- Keep it concise, key information first
- Regularly update USER.md and MEMORY.md
- Use clear heading structure
