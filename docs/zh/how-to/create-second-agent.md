# 创建第二个 Agent

另一个助手需要不同职责、工作区、模型或工具边界时，创建新 Agent。只是聊天主题不同，只需新建 Session。

## 在控制台中

1. 打开 **Agent**，选择 **添加 Agent**。
2. 填写简短 ID 和清晰名称。
3. 描述主要职责。
4. 选择工作区和模型。
5. 只启用需要的工具和 Skill。
6. 保存，并使用该 Agent 开始新聊天。

先测试只读任务。Agent 行为符合预期后，再添加写入、Shell、浏览器、消息发送或外部账号访问。

## 在终端中

```bash
xopc agents add coder --workspace ~/.xopc/workspace/coder --model <provider>/<model>
xopc agents list
```

然后在新客户端 Session 中选择该 Agent；需要显式 Session 参数时，以已安装命令的 `--help` 为准。

## 设为默认 Agent

```bash
xopc config set agents.default coder
xopc config validate
```

只影响新 Session，已有 Session 仍属于原 Agent。

能力选择和精确字段见 [Agent](../routing-system.md)与[配置](../configuration.md)。
