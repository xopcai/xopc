# 通道配置

xopcbot 支持多种通信通道：Telegram、WhatsApp。

## Telegram 通道

### 配置

在 `~/.config/xopcbot/config.json` 中添加：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allow_from": ["@username1", "@username2"]
    }
  }
}
```

### 获取 Bot Token

1. 打开 Telegram，搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新机器人
3. 按提示设置名称和用户名
4. 复制生成的 Token

### 配置字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用通道 |
| `token` | string | Bot Token |
| `allow_from` | string[] | 白名单用户 (用户名或 ID) |

### 使用限制

- **仅支持群组和私聊**：不支持频道
- **轮询模式**：当前使用长轮询，延迟约 1-2 秒
- **媒体处理**：图片等媒体会显示为 `[media]`

### 启动测试

```bash
npm run dev -- gateway --port 18790
```

然后在 Telegram 中与机器人对话。

### 常见问题

**Q: 收不到消息？**
- 检查 Token 是否正确
- 确认 `enabled` 设为 `true`
- 检查网络连接

**Q: 如何添加管理员？**
修改 `allow_from` 数组：

```json
{
  "channels": {
    "telegram": {
      "token": "...",
      "allow_from": ["@admin1", "123456789"]
    }
  }
}
```

---

## WhatsApp 通道

### 配置

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "bridge_url": "ws://localhost:3001",
      "allow_from": []
    }
  }
}
```

### 配置字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用 |
| `bridge_url` | string | WA Bridge WebSocket 地址 |
| `allow_from` | string[] | 白名单用户 |

### 当前状态

⚠️ **WhatsApp 通道当前为占位实现**，需要配合外部 WA Bridge 使用。

可选方案：
- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
- [Chat-API](https://github.com/chat-api)
- [WA Bridge](https://github.com/pереводчик/wa-bridge)

### 完整设置示例

```bash
# 1. 安装 wa-bridge (示例)
git clone https://github.com/example/wa-bridge.git
cd wa-bridge
npm install
npm start

# 2. 配置 xopcbot
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "bridge_url": "ws://localhost:3001"
    }
  }
}

# 3. 启动网关
npm run dev -- gateway --port 18790
```

---

## 消息格式

### 入站消息

```typescript
{
  channel: 'telegram' | 'whatsapp',
  sender_id: '123456789',
  chat_id: '987654321',
  content: 'Hello, bot!',
  media?: ['file_id_1', 'file_id_2'],
  metadata?: Record<string, unknown>
}
```

### 出站消息

```typescript
{
  channel: 'telegram' | 'whatsapp',
  chat_id: '987654321',
  content: 'Hello, user!'
}
```

---

## 发送消息

### 通过 CLI

```bash
# 发送消息到 Telegram
npm run dev -- agent -m "Hello from CLI"
```

### 通过 Gateway API

```bash
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "chat_id": "123456789",
    "content": "Hello via API!"
  }'
```

### 通过 Plugin

```typescript
api.registerHook('message_sending', async (event, ctx) => {
  // 拦截或修改消息
  return { content: event.content };
});
```

---

## 多通道同时使用

可以同时启用 Telegram 和 WhatsApp：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "...",
      "allow_from": ["@username"]
    },
    "whatsapp": {
      "enabled": true,
      "bridge_url": "ws://localhost:3001",
      "allow_from": []
    }
  }
}
```

机器人会同时监听两个通道的消息。

## 最佳实践

1. **设置白名单**：生产环境建议设置 `allow_from` 限制用户
2. **启用日志**：通过 `npm run dev` 查看通道状态
3. **错误处理**：通道连接失败时会自动重连
4. **资源清理**：停止服务时正确关闭连接
