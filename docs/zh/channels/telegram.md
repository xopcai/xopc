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
      "defaults": {
        "dmPolicy": "pairing",
        "groupPolicy": "open",
        "streaming": { "mode": "partial" }
      },
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "botToken": "BOT_TOKEN_1",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streaming": { "mode": "partial" }
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

**DM 策略**（`dmPolicy`）：

- **`pairing`** — 未在允许列表中的用户 **不会** 进入智能体。允许来源：`channels.telegram.accounts.<账号>.allowFrom`，以及 **`~/.xopc/credentials/xopc-telegram-<账号>-allowFrom.json`** 里已批准的 id（可用 **`XOPC_CREDENTIALS_DIR`** 覆盖目录）。首次私聊会收到 **配对码**；管理员在网关所在机执行 **`xopc channels pairing approve --channel telegram --account <账号> <配对码>`**。详见 [DM 私聊配对](./index.md#dm-pairing) 与 [CLI — channels](../cli.md#channels)。
- **`allowlist`** — 同样合并配置与凭证文件中的 id，但 **不** 发配对码；未命中则丢弃。
- **`open`** — 任意用户可私聊。
- **`disabled`** — 关闭私聊。

`channels.telegram.defaults` 为账号提供策略、流式输出、代理、API 根地址和限制等默认值。访问列表只属于账号：私聊 id 写入 `accounts.<账号>.allowFrom`，群聊 id 写入 `accounts.<账号>.groupAllowFrom`。

**群组策略** (`groupPolicy`)：
- `open` - 允许所有群
- `allowlist` - 仅允许指定群
- `disabled` - 禁用群

## 流式输出

**Stream 模式** (`streaming.mode`)：

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
      "defaults": {
        "apiRoot": "https://your-proxy-domain.com"
      },
      "accounts": {
        "default": {
          "botToken": "YOUR_BOT_TOKEN"
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
