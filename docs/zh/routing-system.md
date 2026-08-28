# Agent

Agent 是为某类工作配置的具名助手。每个 Agent 可以有独立的角色、工作区、模型、工具、技能和安全边界；按照你的设置，用户拥有的上下文可以在多个 Agent 之间使用。

## 什么时候创建新 Agent

真正需要能力边界时再创建，例如：

- 允许编辑代码仓库的开发 Agent；
- 可以访问网页和连接器的研究 Agent；
- 使用独立工作区的个人 Agent；
- 使用低成本模型处理简单任务的轻量 Agent。

只是开始一个不同话题时，无需新建 Agent，新建一个 [Session](./session.md) 即可。

## 在控制台创建 Agent

<!-- 截图占位：/screenshots/agents.png -->

1. 打开 **Agent**。
2. 选择 **添加 Agent**。
3. 填写清晰的名称和职责。
4. 选择主要模型和工作区。
5. 只启用它确实需要的工具和技能。
6. 保存，然后用该 Agent 开始新对话。

允许写文件、运行命令、发送消息或访问外部账号之前，先用只读请求测试它的行为。

## 在终端创建 Agent

```bash
xopc agents add research
xopc agents list
```

命令会创建或更新 Agent 配置，并准备所需目录。要从配置中移除：

```bash
xopc agents delete research
```

如果命令提供磁盘清理选项，请仔细阅读确认提示；删除文件与停用 Agent 是不同的操作。

## 选择默认 Agent

没有明确指定 Agent 的新 Session 会使用默认值：

```bash
xopc config set agents.default research
xopc config validate
```

已有 Session 仍属于原 Agent。要使用其它 Agent，请新建对话并明确选择。

## 设计安全的 Agent

| 设置 | 需要回答的问题 |
| --- | --- |
| 职责 | 这个 Agent 应接受或拒绝哪些工作？ |
| 工作区 | 它可以使用哪些文件？ |
| 模型 | 哪个模型在质量、速度、隐私和成本之间最合适？ |
| 工具 | 它可以执行哪些动作？ |
| 技能 | 它需要哪些可复用指令？ |
| 边界 | 哪些动作必须先确认？ |

从满足任务所需的最小能力开始，只有验证确有需要后再增加访问权限。

完整示例见[创建第二个 Agent](./how-to/create-second-agent.md)，精确字段见[配置参考](./reference/configuration.md)。
