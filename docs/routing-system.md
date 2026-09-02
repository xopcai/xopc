# Agents

An Agent is a named assistant configured for a particular kind of work. Every Agent inherits one global capability configuration and stores only its profile, workspace choice, and explicit overrides. User-owned context remains available across Agents according to your settings.

## When to create another Agent

Create one when you need a real capability boundary, for example:

- a coding Agent allowed to edit repositories;
- a research Agent with web and connector access;
- a personal Agent that uses a separate workspace;
- a lightweight Agent that uses a lower-cost model.

Do not create a new Agent only to start a different conversation. A new [Session](./session.md) is enough for that.

## Create an Agent in the console

<!-- Screenshot placeholder: /screenshots/agents.png -->

1. Open **Agents**.
2. Choose **Add Agent**.
3. Give it a clear name and personality instruction.
4. Save, then start a new chat with that Agent.
5. Add an Agent-specific override only when it must differ from the global defaults.

Test a read-only request before allowing tools that write files, run commands, send messages, or access external accounts.

## Create an Agent in the terminal

```bash
xopc agents add research
xopc agents list
```

The command creates or updates the Agent entry and prepares its directories. To remove an Agent from configuration:

```bash
xopc agents delete research
```

Read the confirmation carefully if on-disk cleanup is offered; deleting files is different from disabling an Agent.

## Choose the default Agent

The default is used for new Sessions that do not name an Agent:

```bash
xopc config set agents.default research
xopc config validate
```

Existing Sessions remain assigned to their current Agent. To use another Agent, start a new chat and select it explicitly.

## Design a safe Agent

For each Agent, decide:

| Setting | Question to answer |
| --- | --- |
| Responsibility | What work should this Agent accept or decline? |
| Workspace | Which files may it use? |
| Models | Which model balances quality, speed, privacy, and cost? |
| Tools | Which actions can it take? |
| Skills | Which reusable instructions does it need? |
| Boundaries | Which actions always require confirmation? |

Begin with the smallest useful capability set. Add access only after the Agent succeeds without it.

For a guided example, see [Create a second Agent](./how-to/create-second-agent.md). Exact configuration fields are listed in [Configuration reference](./reference/configuration.md).
