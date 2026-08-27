# 手机端

手机端连接持续运行在电脑或服务器上的 Gateway。它适合离开主机时聊天、记录内容和查看进行中的工作。

## 连接前

1. 确认 Gateway 和本地聊天正常。
2. 选择受保护的远程访问方式，优先 Tailscale。
3. 生成或获取 Gateway Token。
4. 保持主机在线，并让 Gateway 服务持续运行。

## 连接

<!-- 截图占位：/screenshots/mobile-connect.png -->

1. 在桌面或网页控制台打开 **设置 → 远程访问**。
2. 准备受保护的 Gateway URL 和 Token，或使用可用的配对流程。
3. 在手机端添加 Gateway。
4. 验证健康或状态页面。
5. 先打开一个已知 Session，再开始新聊天。

手机应显示与主机相同的 Agent 和 Session。否则很可能连接了另一个 Gateway 或 Profile。

## 安全

- 不要使用未加密的公网 HTTP 地址。
- 不要通过聊天或邮件发送 Gateway Token。
- 使用手机锁屏；手机丢失后撤销访问。
- 优先私有网络，不要直接使用公网隧道。
- Token 意外泄露后立即轮换。

## 故障排查

| 问题 | 检查内容 |
| --- | --- |
| 无法访问 Gateway | 主机在线、服务运行、私有网络或隧道已连接 |
| 未授权 | URL 和 Token 属于同一个 Gateway |
| Session 不一致 | 手机连接的是目标主机和 Profile |
| 消息一直等待 | 主机上的模型正常，实时连接没有被阻止 |

网络排障见[远程访问](./remote-access.md)。
