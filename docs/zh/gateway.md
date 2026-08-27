# Gateway 控制台

Gateway 让网页控制台、桌面应用、手机、消息通道、Automation 和远程客户端持续访问 xopc。只使用本地终端聊天时，可以直接运行 `xopc`，无需单独启动 Gateway。

## 本地启动

```bash
xopc gateway
```

打开终端显示的地址，通常是 `http://127.0.0.1:18790`。前台进程会占用当前终端，按 `Ctrl+C` 停止。

在另一个终端检查：

```bash
xopc gateway status
xopc gateway health
```

## 后台运行

消息通道、手机、Webhook 和定时工作需要 Gateway 持续运行，建议安装系统服务：

```bash
xopc gateway service install
xopc gateway status
```

平台相关命令见 `xopc gateway service --help`。桌面应用也可以自行管理本地 Gateway。

## 认证 Token

本地浏览器可能不会要求 Token，但其它客户端和远程连接应使用 Token。

```bash
xopc config token
xopc config token --generate
```

把 Token 当作密码，只保存在受信任客户端，不要放进截图、公开 URL 或源码。生成新 Token 后，使用旧值的客户端会断开。

## 常用操作

```bash
xopc gateway restart
xopc gateway stop
xopc gateway logs
xopc gateway probe
```

扩展、通道凭据、进程环境或运行依赖变化后使用 `restart`。许多普通配置会自动重载。

## 从其它设备访问

默认 loopback 监听有意只允许本机访问。修改前先选择受保护方式：

- 个人可信设备使用 [Tailscale](./gateway/tailscale.md)；
- 管理远程主机使用 [SSH 隧道](./gateway/remote.md)；
- 局域网和公网方案见[远程访问](./remote-access.md)。

不要把未认证 Gateway 直接暴露到公网。

## 故障排查

| 问题 | 检查内容 |
| --- | --- |
| 端口已占用 | 停止其它进程或修改 `gateway.port` |
| 控制台显示未授权 | URL 和 Token 属于同一个 Gateway |
| Gateway 运行但通道异常 | `xopc gateway health` 和通道日志 |
| 终端运行正常但开机服务失败 | 服务环境、绝对路径和凭据 |
| 浏览器无法远程连接 | 监听地址、防火墙、隧道、TLS 和 Token |

把 Gateway 暴露到本机之外前运行 `xopc doctor --security`。
