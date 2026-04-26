# Telegram 通道

## 网关控制台 — 即时通讯

网关运行时可使用 React 控制台中的 **即时通讯** 专页：

- **路由：** `#/channels`（侧栏 **即时通讯**）。
- **前提：** 已在设置中保存 **网关访问令牌**，以便调用需鉴权的 API。
- **当前产品界面：** 仅配置 **微信** 与 **Telegram**。

## 多账户配置

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN_1",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        },
        "work": {
          "name": "Work Bot",
          "botToken": "BOT_TOKEN_2",
          "dmPolicy": "disabled",
          "groupPolicy": "allowlist",
          "groups": {
            "-1001234567890": {
              "requireMention": true,
              "systemPrompt": "You are a work assistant"
            }
          }
        }
      }
    }
  }
}
```

## 访问控制策略

**DM 策略** (`dmPolicy`)：
- `pairing` - 需要与用户配对
- `allowlist` - 仅允许指定用户
- `open` - 允许所有用户
- `disabled` - 禁用私聊

**群组策略** (`groupPolicy`)：
- `open` - 允许所有群
- `allowlist` - 仅允许指定群
- `disabled` - 禁用群

## 流式输出

**Stream 模式** (`streamMode`)：

| 模式 | 说明 |
|------|------|
| `off` | 一次性发送完整消息 |
| `partial` | 流式发送 AI 回复，并展示工具进度 |
| `block` | 更完整的流式（含更多更新） |

## 获取 Bot Token

1. 打开 Telegram，搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建机器人
3. 按提示设置名称与用户名
4. 复制生成的 Token

## 语音消息（STT/TTS）

详情见 [语音（STT/TTS）](/zh/voice)。

在需要 @mention 的 Telegram 群/超级群中，**纯语音**消息会在 mention 过滤前先做转写，这样“口播 bot 名称”（以及更适合 STT 的别名）也能触发。

## 反向代理配置

在受限网络环境下可设置自定义 API 根地址：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "YOUR_BOT_TOKEN",
          "apiRoot": "https://your-proxy-domain.com"
        }
      }
    }
  }
}
```

启动时会自动验证连接。

## 使用限制

- **仅群/私聊**：不支持广播频道（Channel）
- **轮询模式**：使用 long polling，约 1-2 秒延迟
- **语音消息**：STT 60 秒限制（Telegram）
- **TTS 文本**：受 `tts.maxTextLength` 限制（schema 默认 512；可配置）

