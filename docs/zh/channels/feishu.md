# 飞书（Feishu / Lark）

可以通过扫码引导连接飞书或 Lark Bot，也可以手动配置企业内部应用。Socket Mode 最简单，因为不需要公网 Webhook 地址。

## 引导式设置

1. 确认可选飞书 SDK 可用。全局安装 xopc 时运行 `npm install -g @larksuiteoapi/node-sdk@1.66.0`。
2. 打开 **消息通道 → 飞书**。
3. 选择 **配置**。
4. 选择 **飞书（中国）** 或 **Lark（国际）**。
5. 扫描二维码并完成平台提示。
6. 连接模式保持 **WebSocket / Socket Mode**。
7. 私聊保持 **配对**，然后保存。
8. 给机器人发测试消息并批准配对。

## 手动配置应用

在飞书开放平台或 Lark Developer 控制台：

1. 创建企业内部应用，并添加 **机器人** 能力。
2. 把 App ID 和 App Secret 填入 xopc。
3. 启用 Socket Mode / 长连接。
4. 订阅接收消息事件。
5. 只添加实际功能需要的 API 权限。
6. 租户有要求时发布应用或申请管理员批准。

先只申请聊天和基础身份权限。只有 Agent 需要对应工具时，才增加文档、Wiki、云盘、权限或多维表格 Scope。

## 配对与群聊

私聊推荐使用配对。在控制台批准，或运行：

```bash
xopc channels pairing approve feishu <code> --account default
```

群聊限制允许的会话，并在支持时要求提及。拥有文档或云盘工具的机器人能访问的不只是聊天内容，因此 Agent 和应用权限都应保持最小范围。

## Webhook 模式

只有部署已经提供安全 HTTPS 地址时才使用 Webhook。它需要平台提供的 Verification Token、Encrypt Key，以及正确路由的事件 URL。个人或本地安装优先 Socket Mode。

## 故障排查

- 扫码失败：选择正确的飞书/Lark 区域，并使用有权限的租户账号重试。
- 应用已连接但没有消息：检查机器人能力、事件订阅、应用发布和租户批准。
- 文档工具被拒绝：添加精确所需 Scope，然后重新申请批准。
- Webhook 验证失败：检查公网 URL、Verification Token、Encrypt Key 和 TLS。
