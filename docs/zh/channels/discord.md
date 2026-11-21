# Discord

1. 进入 **设置 → 消息通道 → Discord**，选择 **配置 Discord**，打开 Discord Developer Portal。
2. 创建应用，在 **Bot** 页面复制 **Bot Token**，填入 xopc 并保存。
3. 选择 **邀请机器人到服务器**，将它添加到你有权安装应用的服务器。

先给机器人发私聊消息，在 xopc 中批准配对。在服务器里使用时，把相关成员加入 **允许的通道发送者**，再提及机器人。机器人会在收到提及的频道或已有线程中回复。要在线程中使用，需授予机器人访问线程和发消息的权限。

Gateway 使用标准的服务器消息和私聊事件。私聊和明确提及机器人可在未启用特权 **Message Content** intent 的情况下读取。临时断线后，Gateway 会在 Discord 允许时恢复会话。Gateway 重启时用已保存的 Token 重连，并恢复待处理的 xopc 消息。[Discord Gateway](https://docs.discord.com/developers/events/gateway)
