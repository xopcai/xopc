# 聊天与会话

Session 是与一个 Agent 的已保存对话。它保留继续工作所需的消息和上下文，你可以从桌面、浏览器、终端、手机或已连接的消息通道继续。

## 开始对话

- 桌面或网页控制台：打开 **聊天**，选择 **新对话**。
- 终端：运行 `xopc` 打开 TUI，或运行 `xopc agent -i` 进入交互式 CLI。
- 只发送一条消息：运行 `xopc agent -m "你的请求"`。

目标或受众改变时，新建 Session；希望 Agent 继续使用当前对话上下文时，继续已有 Session。

## 查找和恢复 Session

控制台侧栏会列出最近对话，选择一项即可继续。

终端中使用：

```bash
xopc session list
xopc resume
xopc resume <session-key>
```

需要查看特定 Session 的详情时，运行 `xopc session info <session-key>`。其它管理命令可通过 `xopc session --help` 查看。

## 重置与删除

| 操作 | 适用场景 | 结果 |
| --- | --- | --- |
| 新对话 / 重置 | 希望在同一路由下开始干净的对话 | 旧对话归档，并创建新对话 |
| 删除 | 不再需要保存或显示该 Session | 从列表和存储中删除 |

通常优先使用重置。只有确定要移除已保存对话时才删除。

## Session 与 Agent

每个 Session 都属于一个 Agent。Agent 决定角色、模型、工具、技能和工作区。修改默认 Agent 只影响新 Session，不会把已有对话自动迁移过去。

创建或选择其它 Agent 见 [Agent](./routing-system.md)。

## 保持对话清晰

- 客户端支持时，使用简短、明确的标题。
- 一个 Session 保持一个主要目标。
- 旧上下文可能干扰新任务时，新建 Session。
- 工作需要明确状态和下一步时，创建 Task。
- 除非确实需要且你信任当前模型服务商，否则不要在对话中粘贴敏感信息。

## 存储与隐私

Session 保存在状态目录中的本地 xopc 数据库里。使用云端模型时，每轮发送的消息仍会按照该服务商的政策进行处理。

备份和删除位置见[数据与文件位置](./workspace.md)。

## 故障排查

| 问题 | 检查内容 |
| --- | --- |
| 找不到最近的 Session | 确认客户端连接的是同一个 Gateway 和状态配置 |
| 恢复后使用了错误的 Agent | 查看 Session 详情和默认 Agent 配置 |
| 长对话丢失较早的细节 | 在对话中总结重要事实，或把长期材料放入 Task、Note 或工作区文件 |
| Session 无法加载 | 运行 `xopc doctor --deep`，再查看 `xopc logs tail` |
