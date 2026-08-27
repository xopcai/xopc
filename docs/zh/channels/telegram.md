# Telegram

连接 Telegram Bot 后，可以在私聊和群组中使用 xopc Agent。

## 创建机器人

1. 在 Telegram 中打开 [@BotFather](https://t.me/BotFather)。
2. 发送 `/newbot` 并按提示操作。
3. 复制生成的 Bot Token。
4. 私密保存 Token；任何拥有它的人都可以控制机器人账号。

## 连接到 xopc

1. 在 Gateway 控制台打开 **消息通道 → Telegram**。
2. 选择 **配置**，粘贴 Bot Token。
3. 私聊策略保持为 **配对**。
4. 初始先停用群聊，或使用群白名单并要求提及。
5. 保存并等待健康检查成功。

然后给机器人发送 Telegram 私聊消息，并在 xopc 中批准显示的配对码。

## 终端设置

```bash
xopc channels enable telegram
xopc channels show telegram
xopc channels pairing approve telegram <code> --account default
```

需要在主机编辑通道 JSON 时使用 `xopc channels config`。

## 访问策略

- **配对** 适合个人机器人：每个新发送者都需要批准。
- **白名单** 会静默忽略未知发送者。
- **开放** 只适用于有意公开的机器人和 Agent。
- **停用** 会关闭对应会话类型。

机器人拥有工具或私人上下文时，群聊应要求提及并限制群 ID。

## 多个机器人

可以分别添加个人和工作账号。每个账号使用独立 Token、访问策略和路由。先完整测试一个账号，再添加下一个。

## 语音与文件

Telegram 可以把受支持的文档、图片和语音消息交给 xopc。语音转写和语音回复需要单独配置[语音能力](../voice.md)。文件和媒体仍受大小限制。

## 故障排查

| 问题 | 检查内容 |
| --- | --- |
| 机器人状态异常 | Token 有效，Gateway 可以访问 Telegram |
| 私聊没有回复 | 配对已批准，并且本地聊天正常 |
| 群聊没有回复 | 机器人已进群、群策略允许、满足提及要求 |
| 回复中途停止 | 流式模式、Telegram 限制和 Gateway 日志 |

Token 一旦出现在日志、截图或源码中，立即在 BotFather 中轮换。
