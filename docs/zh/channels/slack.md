# Slack

进入 **设置 → 消息通道 → Slack**，选择 **配置 Slack**，复制 **应用清单**。在 Slack 的应用设置中选择 **Create New App → From an app manifest**，选定工作区，粘贴 JSON 并安装应用。安装可能需要工作区管理员批准。

1. 从 **OAuth & Permissions** 复制 **Bot User OAuth Token**（以 `xoxb-` 开头）。
2. 在 **Basic Information → App-Level Tokens** 创建带 `connections:write` 权限的 **App Token**（以 `xapp-` 开头）。
3. 将同一个 Slack 应用的两个 Token 填入 xopc 并保存。Gateway 会主动建立 Socket Mode 连接。

先给机器人发一条私聊消息，在 xopc 中批准配对。需要在频道使用时，先邀请机器人，在 **允许的通道发送者** 中添加可调用机器人的 Slack 成员 ID，再在频道中提及机器人。机器人会在顶层提及下开启线程，在已有线程中的提及会回复到原线程。已有私聊线程也会保留回复位置。

每个 Slack 应用只运行一个活跃的 xopc Gateway。连接断开或 Slack 要求刷新时，Gateway 会获取新的连接地址。重启后，Gateway 使用已保存的凭据重新连接。[Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
