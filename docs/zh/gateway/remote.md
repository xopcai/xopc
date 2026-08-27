# 使用 SSH 隧道访问

SSH 隧道把远程主机上的本地 Gateway 端口安全转发到当前电脑。已经能够 SSH 登录远程主机时，这是最通用的备用方案。

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
