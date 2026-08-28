# Agent Profile 文件

xopc 为每个 Agent 创建一小组 Markdown 文件，让你无需修改程序代码就能查看和调整 Agent 的身份与工作规则。

默认位置：`~/.xopc/agents/<agent-id>/profile/`。

| 文件 | 适合填写的内容 |
| --- | --- |
| [SOUL.md](./templates/SOUL.md) | 稳定原则、语气和价值观 |
| [IDENTITY.md](./templates/IDENTITY.md) | 名称、角色、说明、语言和可见身份 |
| [TOOLS.md](./templates/TOOLS.md) | 可以安全提供给 Agent 的本地工具提示 |
| [AGENTS.md](./templates/AGENTS.md) | 工作规则、协作方式和红线 |
| [HEARTBEAT.md](./templates/HEARTBEAT.md) | 启用 Heartbeat 时的简短检查规则 |

## 安全编辑

1. 先备份 Profile 目录。
2. 一次只修改一个文件。
3. 指令保持简短、无歧义。
4. 新建 Session 并测试一个小任务。
5. 删除重复或冲突规则。

设置流程和 `xopc agents add` 只创建缺失文件，不会覆盖已有 Profile Markdown。

## 不应放入的内容

- API Key、密码、Token 或私人 SSH 材料；
- 用户的个人资料或长期记忆；
- 可以放在工作区中的大型参考文档；
- 经常变化的 Task 状态。

Profile 文件可能作为 Agent 上下文发送给当前模型。请把其中全部内容视为模型服务商可能看到的信息。

能力设置见 [Agent](../routing-system.md)，Profile、工作区和本地状态的差异见[数据和文件位置](../workspace.md)。
