# 通道配置

xopcbot 支持多种通信通道，采用基于扩展的架构。

## 概述

| 通道 | 状态 | 功能 |
|------|------|------|
| Telegram | ✅ | 多账户、流式传输、语音、文档 |
| Feishu/Lark | ✅ | 机器人消息、@提及 |
| Web UI | ✅ | Gateway 连接的聊天界面 |

## Telegram 通道

### 多账户配置

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "token": "BOT_TOKEN_1",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        },
        "work": {
          "name": "Work Bot",
          "token": "BOT_TOKEN_2",
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

### 访问控制策略

**DM 策略** (`dmPolicy`):
- `pairing` - 需要与用户配对
- `allowlist` - 仅允许指定用户
- `open` - 允许所有用户
- `disabled` - 禁用 DM

**群组策略** (`groupPolicy`):
- `open` - 允许所有群组
- `allowlist` - 仅允许指定群组
- `disabled` - 禁用群组

### 流式配置

**流式模式** (`streamMode`):

| 模式 | 说明 |
|------|------|
| `off` | 不流式，一次性发送完整消息 |
| `partial` | 流式 AI 响应，工具显示进度 |
| `block` | 完整流式，包含所有中间更新 |

### 获取 Bot Token

1. 打开 Telegram，搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新机器人
3. 按提示设置名称和用户名
4. 复制生成的 token

### 配置字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 启用通道 |
| `accounts` | object | 多账户配置 |
| `accounts.<id>.token` | string | Bot Token |
| `accounts.<id>.dmPolicy` | string | DM 访问策略 |
| `accounts.<id>.groupPolicy` | string | 群组访问策略 |
| `accounts.<id>.allowFrom` | array | 允许的用户 ID |
| `accounts.<id>.streamMode` | string | 流式模式 |
| `apiRoot` | string | 自定义 Telegram API 端点 |
| `debug` | boolean | 启用调试日志 |

### 语音消息 (STT/TTS)

配置语音消息支持：

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "model": "paraformer-v1"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "auto",
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "tts-1",
      "voice": "alloy"
    }
  }
}
```

查看 [语音文档](/zh/voice) 了解详情。

### 反向代理配置

受限网络环境：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "token": "YOUR_BOT_TOKEN",
          "apiRoot": "https://your-proxy-domain.com"
        }
      }
    }
  }
}
```

启动时自动验证连接。

### 使用限制

- **仅支持群组和私聊**: 不支持频道（广播）
- **轮询模式**: 使用长轮询，约 1-2 秒延迟
- **语音消息**: STT 限制 60 秒
- **TTS 文本**: 限制 4000 字符

---

## Feishu/Lark 通道

### 配置

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "APP_ID",
      "appSecret": "APP_SECRET",
      "verificationToken": "VERIFICATION_TOKEN"
    }
  }
}
```

### 功能

- ✅ 机器人消息
- ✅ @提及处理
- ✅ 富文本格式化
- ✅ 文件附件

---

## Web UI 通道

Web UI 提供基于浏览器的聊天界面。

### 启动 Gateway

```bash
xopcbot gateway --port 18790
```

### 访问

在浏览器中打开 `http://localhost:18790`。

### 功能

- ✅ WebSocket 实时聊天
- ✅ 会话管理
- ✅ 配置对话框
- ✅ 日志查看器
- ✅ Cron 任务管理

---

## 消息格式

### 入站消息

```typescript
{
  channel: 'telegram',
  sender_id: '123456789',
  chat_id: '987654321',
  content: 'Hello, bot!',
  media?: string[],
  metadata?: Record<string, unknown>
}
```

### 出站消息

```typescript
{
  channel: 'telegram',
  chat_id: '987654321',
  content: 'Hello, user!',
  accountId?: string
}
```

---

## 发送消息

### 通过 CLI

```bash
# 发送消息到 Telegram
xopcbot agent -m "Hello from CLI"
```

### 通过 Gateway API

```bash
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "chat_id": "123456789",
    "content": "Hello via API!",
    "accountId": "personal"
  }'
```

### 通过扩展 Hook

```typescript
api.registerHook('message_sending', async (event, ctx) => {
  // 拦截或修改消息
  return { content: event.content };
});
```

---

## 最佳实践

1. **设置白名单**: 生产环境应设置 `allowFrom` 限制用户
2. **使用多账户**: 分离个人和工作机器人
3. **配置流式模式**: 使用 `partial` 获得平衡的 UX
4. **启用日志**: 通过日志监控通道状态
5. **错误处理**: 通道故障自动重试
6. **资源清理**: 服务停止时正确关闭连接

---

## 故障排除

### 未收到消息

1. 检查 token 是否正确
2. 确认 `enabled` 为 `true`
3. 检查网络连接
4. 与 BotFather 验证机器人状态

### @提及不工作

1. 检查群组设置中的机器人用户名
2. 验证 `requireMention` 配置
3. 确保机器人有群组权限

### 流式未显示

1. 检查 `streamMode` 是否为 `partial` 或 `block`
2. 验证通道支持流式（仅 Telegram）
3. 检查日志中的 DraftStream 错误

### 语音消息不工作

1. 确认 STT/TTS 配置
2. 检查 API 密钥是否有效
3. 验证音频长度 < 60 秒
4. 检查日志中的 STT/TTS 错误
