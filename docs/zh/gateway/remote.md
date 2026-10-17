# 使用 SSH 隧道访问

SSH 隧道把远程主机上的本地 Gateway 端口安全转发到当前电脑。已经能够 SSH 登录远程主机时，这是最通用的备用方案。

## 准备 VPS 主机

在 Hetzner 等具有持久存储的 VPS 上：

1. 按[安装指南](../getting-started.md)安装 Node.js >= 22.22.3 和 xopc。
2. 将 `gateway.bind` 设置为 `loopback`，并配置强 Gateway Token。
3. 安装并启动 Gateway 服务：

   ```bash
   xopc gateway service install
   xopc gateway service start
   ```

4. 在主机防火墙中允许 SSH（通常为 22 端口）或 Tailscale，保持 Gateway 的 `18790` 端口私有。
5. 建立下方的 SSH 隧道，或将 `gateway.tailscale.mode` 设置为 `serve`，使用 [Tailscale Serve](./tailscale.md)。

若需要公网访问，先阅读[公网隧道安全说明](../../tunnel-security.md)，并在启用前接受隧道风险提示。可用的访问方式见[网络访问](../../network.md)。

## 建立隧道

在本地电脑运行：

```bash
ssh -N -L 18790:127.0.0.1:18790 user@gateway-host
```

也可以使用 xopc 命令：

```bash
xopc gateway ssh-tunnel --target user@gateway-host
```

保持该终端运行，然后在本地打开 `http://127.0.0.1:18790`，并使用远程 Gateway 的 Token。

## 安全建议

- 远程 Gateway 保持 loopback 监听。
- 使用 SSH Key，并保护私钥。
- 不要为了方便同时开放远程 Gateway 端口。
- 在共享电脑上关闭隧道并删除保存的 Gateway Token。

## 故障排查

- SSH 无法连接：先独立验证 `ssh user@gateway-host`。
- 本地端口占用：使用另一个本地端口，例如 `18791:127.0.0.1:18790`。
- 页面未授权：使用远程 Gateway 的 Token，而不是本地实例 Token。
- 页面打不开：在远程主机运行 `xopc gateway health`。

其它方式见[远程访问](../remote-access.md)。
