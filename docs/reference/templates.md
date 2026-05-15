# Workspace Templates

xopc uses **profile Markdown** templates to customize agent behavior and knowledge. During `onboard`, `setup`, or `agents add`, missing files are **copied** (never overwritten) into the **resolved Markdown workspace root** for that agent (see [On-disk layout](../disk-layout.md)). The same filenames are documented here for reference.

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
| [BOOTSTRAP.md](/reference/templates/BOOTSTRAP) | First-run / origin story (not injected into the default system-prompt stack) |

## System prompt load order

These files are read from the **Markdown workspace root** (when present) and assembled into the agent system prompt **in this order**:

1. **SOUL.md**
2. **IDENTITY.md**
3. **USER.md**
4. **TOOLS.md**
5. **AGENTS.md**
6. **HEARTBEAT.md**
7. **MEMORY.md**

**BOOTSTRAP.md** is also copied when seeding a new agent; it is **not** part of that load list (first-run / manual guidance only).

**CONTEXT.md** and **SKILLS.md** are **not** part of the default system-prompt profile list, so they are **not** injected automatically. `xopc init` does **not** create them; add them at the workspace root yourself if you want. The seed used by `onboard` / `agents add` copies the files listed above plus **`BOOTSTRAP.md`** only—it does **not** add `CONTEXT.md` / `SKILLS.md` from this docs folder unless you place them yourself.

## Memory System

Memory files support dynamic updates:

- **MEMORY.md** - Index of permanent memories
- **memory/*.md** - Memory snippets organized by date or topic

The agent can search and read memories via `memory_search` and `memory_get` tools.

**Curated memory** (optional): **`agents/<agentId>/memories/MEMORY.md`** and **`USER.md`** hold bounded, tool-edited entries separate from **`agents/<agentId>/profile/MEMORY.md`** (system-prompt profile index). See [Curated memory](../workspace.md#curated-memory) and [Configuration](../configuration.md) (`agents.defaults.memory`).

## See also

- [State directory & workspace layout](../workspace.md)
- [On-disk layout](../disk-layout.md)
