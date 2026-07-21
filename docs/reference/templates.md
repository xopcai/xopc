# Workspace Templates

xopc uses **profile Markdown** templates to customize agent behavior and knowledge. During `onboard`, `setup`, or `agents add`, missing files are **copied** (never overwritten) into the **resolved Markdown workspace root** for that agent (see [On-disk layout](../disk-layout.md)). The same filenames are documented here for reference.

Template resolution at runtime: `XOPC_TEMPLATE_PATH` (if set), else a walk to `docs/reference/templates` from the running install, else the bundled `workspace-templates` directory next to the compiled `workspace-seed` module.

## Template Files

| File | Purpose |
|------|---------|
| [SOUL.md](/reference/templates/SOUL) | Agent's core identity, personality and values |
| [TOOLS.md](/reference/templates/TOOLS) | Tool usage instructions and best practices |
| [AGENTS.md](/reference/templates/AGENTS) | Agent collaboration guidelines |
| [IDENTITY.md](/reference/templates/IDENTITY) | Identity and boundary definitions |
| [HEARTBEAT.md](/reference/templates/HEARTBEAT) | Proactive monitoring configuration |

## System prompt load order

These files are read from the agent profile root and assembled into the agent system prompt **in this order**. The global user profile is read separately from **`user/PROFILE.md`** before the agent profile.

1. **SOUL.md**
2. **IDENTITY.md**
3. **TOOLS.md**
4. **AGENTS.md**
5. **HEARTBEAT.md**

**CONTEXT.md** and **SKILLS.md** are **not** part of the default system-prompt profile list, so they are **not** injected automatically. `xopc init` does **not** create them; add them at the workspace root yourself if you want. The seed used by `onboard` / `agents add` copies the files listed above—it does **not** add `CONTEXT.md` / `SKILLS.md` from this docs folder unless you place them yourself.

## Memory System

Memory is not an agent profile template. Every agent uses the same user-owned stores: **`user/MEMORY.md`** and **`user/memories/MEMORY.md`**. Configure them once through top-level `userContext`; use `memory_search`, `memory_get`, and `curated_memory` at runtime. See [Shared user memory](../workspace.md#curated-memory).

## See also

- [State directory & workspace layout](../workspace.md)
- [On-disk layout](../disk-layout.md)
