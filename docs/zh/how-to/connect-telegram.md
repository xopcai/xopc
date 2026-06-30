# 如何接入 Telegram

当你想让 Telegram bot 把消息送入 xopc gateway 时使用本页。

## 1. 创建 bot token

在 Telegram 打开 `@BotFather`，执行 `/newbot`，复制生成的 token。

## 2. 写入 Telegram 配置

用 CLI 合并配置：

```bash
xopc channels config set-json telegram '{"enabled":true,"accounts":{"default":{"botToken":"YOUR_BOT_TOKEN","dmPolicy":"pairing","groupPolicy":"open","streaming":{"mode":"partial"}}}}'
```

也可以编辑 `~/.xopc/xopc.json`：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "YOUR_BOT_TOKEN",
          "dmPolicy": "pairing",
          "groupPolicy": "open",
          "streaming": { "mode": "partial" }
        }
      }
    }
  }
}
```

## 3. 启动 gateway

```bash
xopc gateway
```

Telegram channel plugin 在 gateway 进程中运行。需要长期在线时，请安装 gateway service。

## 4. 批准第一次私聊

`dmPolicy: "pairing"` 下，未知私聊用户会收到配对码。在 gateway 主机上批准：

```bash
xopc channels pairing approve telegram <CODE> --account default
```

## 5. 检查状态

```bash
xopc gateway health
xopc channels show telegram
```

访问策略详见 [Telegram channel](../channels/telegram.md)。
