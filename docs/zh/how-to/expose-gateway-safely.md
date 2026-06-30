# 如何安全暴露 gateway

当其它设备需要访问你的 gateway 时使用本页。

## 优先选择最窄暴露面

| 需求 | 方法 |
| --- | --- |
| 自己的设备都在 tailnet | Tailscale Serve |
| 只在同一 Wi-Fi | LAN bind |
| 需要公网 HTTPS URL | Public tunnel 或反向代理 |
| 笔记本通过 SSH 连远程主机 | SSH tunnel |

同一时间只启用一种公网暴露方式。

## 1. 确保 token auth 可用

生成或轮换 gateway token：

```bash
xopc gateway token --generate
```

检查状态：

```bash
xopc gateway status
```

## 2. 推荐：Tailscale Serve

在 gateway 主机安装并登录 Tailscale，然后运行：

```bash
xopc gateway --tailscale serve --tailscale-reset-on-exit
xopc tailscale status
```

在同一 tailnet 的设备上打开 Tailscale HTTPS URL。API 路由仍需要 gateway Bearer token。

## 3. 只在同一 LAN 使用

```bash
xopc gateway --bind lan
```

仅在可信网络使用。不要泄露 token。

## 4. 检查安全状态

```bash
xopc doctor --security
```

更多方式和风险说明见 [远程访问](../remote-access.md)、[Tailscale](/gateway/tailscale) 和 [Trusted proxy](/gateway/trusted-proxy)。
