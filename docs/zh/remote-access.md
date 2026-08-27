# 远程访问

远程访问让其它设备连接你的 xopc Gateway。选择满足需求的最小暴露方式，并始终启用 Token 认证。

## 选择方式

<!-- 截图占位：/screenshots/remote-access.png -->

| 需求 | 推荐方式 | 是否暴露公网 |
| --- | --- | --- |
| 自己的电脑和手机 | [Tailscale Serve](./gateway/tailscale.md) | 否 |
| 临时管理远程服务器 | [SSH 隧道](./gateway/remote.md) | 否 |
| 同一可信局域网设备 | LAN 监听加防火墙 | 否 |
| Webhook 或客户端需要公网 URL | 带认证的 HTTPS 反向代理或可信隧道 | 是 |

个人设备优先 Tailscale；已经控制远程主机时，SSH 是最通用的安全备用方案。

## 启用前

1. 验证本地聊天和 Gateway 健康状态。
2. 生成强 Token：`xopc config token --generate`。
3. 备份配置。
4. 明确哪些设备或网络需要访问。
5. 运行 `xopc doctor --security`。

## 局域网访问

```bash
xopc gateway --bind lan
```

只在可信私人网络允许 Gateway 端口，要求 Token，并从其它设备使用主机私有 IP。不要在公共 Wi-Fi 上使用 LAN 监听。

## 公网访问

使用受信任隧道或保留认证的 HTTPS 反向代理，至少满足：

- 有效证书和 TLS；
- Gateway Token 或经过仔细配置的可信身份代理；
- 防火墙只开放必要端口；
- URL 中不包含调试入口或密钥；
- 定期检查访问日志并轮换 Token。

公网暴露会放大 Agent、工具、通道和扩展配置错误的影响。能使用私有网络时不要选择公网。

## 连接客户端

在客户端连接设置中填写受保护的 Gateway URL 和 Token。发送消息前先验证健康状态。如果出现陌生 Session，请立即停止：你可能连接了错误的 Gateway。

## 故障排查

```bash
xopc gateway probe
xopc gateway status
xopc doctor --security
```

按顺序检查：Gateway 监听 → 主机防火墙 → 私有网络或隧道 → TLS/代理 → Token。不要通过关闭认证来排查。
