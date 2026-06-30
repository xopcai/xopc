# How to create a second agent

Use this when you want a separate agent with its own workspace and model role.

## 1. Add the agent

`agents add` requires a workspace path:

```bash
xopc agents add coder --workspace ~/.xopc/workspace/coder --model anthropic/claude-sonnet-4-5
```

Show the configured agents:

```bash
xopc agents list
```

## 2. Use the agent in a session

Session keys use the `agent:{agentId}:...` shape. For a direct topic:

```bash
xopc agent -s agent:coder:main -m "Review this project structure."
```

In the TUI:

```bash
xopc tui -s agent:coder:main
```

## 3. Edit capabilities

The runtime source of truth is `agents.list[]` in `~/.xopc/xopc.json`. Each entry is an Agent Capability Manifest with identity, responsibilities, workspace, model roles, tools, skills, memory, workflows, and boundaries.

For the field reference, see [Agent manifest](../agent-manifest.md) and [Configuration](../configuration.md).
