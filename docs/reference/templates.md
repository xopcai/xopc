# Workspace Templates

xopcbot uses workspace template files to customize agent behavior and knowledge. These files are automatically created during the `onboard` process in the `~/.xopcbot/workspace/` directory.

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

## Auto-Loading

These files are automatically loaded into the agent's system prompt for each conversation:

1. **SOUL.md** - Defines who the agent is, how it behaves
2. **USER.md** - What the agent knows about you
3. **TOOLS.md** - Tool usage guidelines
4. **AGENTS.md** - Multi-agent collaboration rules

## Memory System

Memory files support dynamic updates:

- **MEMORY.md** - Index of permanent memories
- **memory/*.md** - Memory snippets organized by date or topic

The agent can search and read memories via `memory_search` and `memory_get` tools.

## Editing Tips

- Use Markdown format
- Keep it concise, key information first
- Regularly update USER.md and MEMORY.md
- Use clear heading structure
