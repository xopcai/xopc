# Channel Configuration

xopcbot supports multiple communication channels: Telegram, WhatsApp.

## Telegram Channel

### Configuration

Add to `~/.config/xopcbot/config.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allowFrom": ["@username1", "@username2"],
      "apiRoot": "https://api.telegram.org",
      "debug": false
    }
  }
}
```

### Get Bot Token

1. Open Telegram, search [@BotFather](https://t.me/BotFather)
2. Send `/newbot` to create a new bot
3. Follow prompts to set name and username
4. Copy the generated token

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable channel |
| `token` | string | Bot Token |
| `allowFrom` | string[] | Whitelist users (username or ID) |
| `apiRoot` | string | Custom Telegram API endpoint, default `https://api.telegram.org` |
| `debug` | boolean | Enable debug logs |

### Usage Limits

- **Groups and private chats only**: Channels not supported
- **Polling mode**: Uses long polling, ~1-2 second delay
- **Media handling**: Images and other media shown as `[media]`

### Startup Test

```bash
xopcbot gateway --port 18790
```

Then chat with the bot in Telegram.

### FAQ

**Q: Not receiving messages?**
- Check if Token is correct
- Confirm `enabled` is set to `true`
- Check network connection

**Q: How to add admins?**
Modify `allowFrom` array:

```json
{
  "channels": {
    "telegram": {
      "token": "...",
      "allowFrom": ["@admin1", "123456789"]
    }
  }
}
```

### Reverse Proxy Configuration

In some network environments, you may need a reverse proxy to access Telegram API.

**1. Configure reverse proxy**

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "apiRoot": "https://your-proxy-domain.com",
      "debug": true
    }
  }
}
```

**2. Verify connection**

Connection is automatically verified on startup with `getMe`:

```
[INFO] Telegram API connection verified: {"username":"your_bot","apiRoot":"https://your-proxy-domain.com"}
```

**Manual test** (code):

```typescript
const result = await channel.testConnection();
if (result.success) {
  console.log('Bot info:', result.botInfo);
} else {
  console.error('Connection failed:', result.error);
}
```

---

## WhatsApp Channel

### Configuration

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "bridge_url": "ws://localhost:3001",
      "allowFrom": []
    }
  }
}
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable channel |
| `bridge_url` | string | WA Bridge WebSocket URL |
| `allowFrom` | string[] | Whitelist users |

### Current Status

⚠️ **WhatsApp channel is currently a placeholder**, requires external WA Bridge.

Options:
- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
- [Chat-API](https://github.com/chat-api)
- [WA Bridge](https://github.com/pереводчик/wa-bridge)

### Full Setup Example

```bash
# 1. Install wa-bridge (example)
git clone https://github.com/example/wa-bridge.git
cd wa-bridge
npm install
npm start

# 2. Configure xopcbot
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "bridge_url": "ws://localhost:3001"
    }
  }
}

# 3. Start gateway
xopcbot gateway --port 18790
```

---

## Message Format

### Inbound Message

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

### Outbound Message

```typescript
{
  channel: 'telegram' | 'whatsapp',
  chat_id: '987654321',
  content: 'Hello, user!'
}
```

---

## Sending Messages

### Via CLI

```bash
# Send message to Telegram
xopcbot agent -m "Hello from CLI"
```

### Via Gateway API

```bash
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "chat_id": "123456789",
    "content": "Hello via API!"
  }'
```

### Via Plugin

```typescript
api.registerHook('message_sending', async (event, ctx) => {
  // Intercept or modify message
  return { content: event.content };
});
```

---

## Multi-Channel Usage

Can enable Telegram and WhatsApp simultaneously:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "...",
      "allowFrom": ["@username"],
      "apiRoot": "https://api.telegram.org",
      "debug": false
    },
    "whatsapp": {
      "enabled": true,
      "bridge_url": "ws://localhost:3001",
      "allowFrom": []
    }
  }
}
```

Bot listens to messages from both channels.

## Best Practices

1. **Set whitelist**: Production environments should set `allow_from` to restrict users
2. **Enable logging**: View channel status via `npm run dev`
3. **Error handling**: Channel connection failures auto-retry
4. **Resource cleanup**: Close connections properly on service stop
