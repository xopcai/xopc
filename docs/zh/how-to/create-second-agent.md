# 如何创建第二个 agent

当你需要一个独立工作区和模型角色的 agent 时使用本页。

## 1. 添加 agent

`agents add` 必须提供 workspace 路径：

```bash
xopc agents add coder --workspace ~/.xopc/workspace/coder --model anthropic/claude-sonnet-4-5
```

查看已配置 agent：

```bash
xopc agents list
```

## 2. 在会话中使用这个 agent

Session key 使用 `agent:{agentId}:...` 形状。直接话题可用：

```bash
xopc agent -s agent:coder:main -m "Review this project structure."
```

TUI：

```bash
xopc tui -s agent:coder:main
```

## 3. 编辑能力

运行时来源是 `~/.xopc/xopc.json` 的 `agents.list[]`。每条都是 Agent Capability Manifest，包含 identity、responsibilities、workspace、model roles、tools、skills、memory、workflows 和 boundaries。

字段说明见 [Agent manifest](/agent-manifest) 和 [配置参考](../configuration.md)。
