# 网页控制台

网页控制台在浏览器中提供聊天和 xopc 设置。它连接 Gateway，并与桌面应用使用相同的 Session、Agent 和本地数据。

## 本地打开

```bash
xopc gateway
```

打开终端显示的地址，通常是 `http://127.0.0.1:18790`。页面要求 Token 时，使用 `xopc config token --show` 显示现有值，或用 `xopc config token --generate` 生成新值，然后保存在连接设置中。

## 可以做什么

- 开始和恢复聊天 Session；
- 管理 Agent、Project、Task、Workflow 和 Automation；
- 配置模型、工具、消息通道、连接器、Skill、MCP 和扩展；
- 查看健康状态、日志、更新和远程访问。

## 从其它设备访问

默认本地地址有意只允许 Gateway 电脑访问。不要在没有认证和网络保护的情况下改成公网监听。按照[远程访问](../remote-access.md)选择 Tailscale、SSH、局域网或其它受保护方式。

## 故障排查

- 页面空白或断开：运行 `xopc gateway status` 和 `xopc gateway health`。
- 未授权：确认保存的 Gateway 地址和 Token 属于同一个实例。
- Session 与桌面端不同：浏览器可能连接了另一个 Gateway 或 Profile。
- 实时进度停止：先刷新一次，再从 Gateway 日志查找实时连接错误。
