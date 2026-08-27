# Agent profile files

xopc creates a small set of Markdown files for each Agent. They make the Agent's identity and operating guidance readable and editable without changing application code.

Default location: `~/.xopc/agents/<agent-id>/profile/`.

| File | What to put there |
| --- | --- |
| [SOUL.md](./templates/SOUL.md) | Stable principles, tone, and values |
| [IDENTITY.md](./templates/IDENTITY.md) | Name, role, description, language, and visible identity |
| [TOOLS.md](./templates/TOOLS.md) | Local tool hints that are safe for the Agent to know |
| [AGENTS.md](./templates/AGENTS.md) | Working rules, collaboration style, and red lines |
| [HEARTBEAT.md](./templates/HEARTBEAT.md) | Short periodic-check guidance when Heartbeat is enabled |

## Edit safely

1. Back up the profile directory.
2. Change one file at a time.
3. Keep instructions short and unambiguous.
4. Start a new Session and test a small request.
5. Remove rules that duplicate or contradict each other.

Setup and `xopc agents add` create missing files but do not overwrite your existing profile Markdown.

## What does not belong here

- API keys, passwords, tokens, or private SSH material;
- the user's personal profile or long-term memory;
- large reference documents that can live in the Agent workspace;
- frequently changing Task status.

Profile files may be sent to the configured model as Agent context. Treat everything in them as potentially visible to that model provider.

Use [Agents](../routing-system.md) for capability settings and [Data and file locations](../workspace.md) for the difference between profile, workspace, and local state.
