# 使用 Tailscale 访问

Tailscale Serve 可以让同一 Tailnet 中的设备通过 HTTPS 访问保持本机监听的 Gateway，是个人设备远程访问的推荐方式。

## 设置

1. 在 Gateway 主机和客户端设备安装并登录 Tailscale。
2. 确认两台设备在同一 Tailnet 中可见。
3. 生成 Gateway Token。
4. 启动：

```bash
xopc gateway --tailscale serve --tailscale-reset-on-exit
```

5. 使用终端显示的 Tailscale HTTPS 地址和 Gateway Token 连接。

查看状态：

```bash
xopc tailscale status
xopc gateway health
```

## Serve 与 Funnel

**Serve** 只向 Tailnet 设备开放，适合日常个人访问。**Funnel** 会提供公网入口，风险显著更高；除非确实需要公网服务并已经配置强认证，否则不要使用。

## 故障排查

- 确认主机和客户端登录了正确的 Tailnet。
- 检查 Tailscale DNS、ACL 和设备在线状态。
- Gateway 应保持本机监听，并且 Token 有效。
- 其它隧道自动启动可能与 Tailscale 暴露冲突。

总体安全说明见[远程访问](../remote-access.md)。
