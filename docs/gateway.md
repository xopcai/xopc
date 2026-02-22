# Gateway API

REST API gateway for external programs to interact with xopcbot.

## Start Gateway

### Foreground Mode

```bash
xopcbot gateway --port 18790
```

Default port: `18790`

### Background Mode

```bash
# Start background service
xopcbot gateway --background

# Or shorthand
xopcbot gateway -b

# Specify log file
xopcbot gateway --background --log-file ~/.xopcbot/gateway.log
```

Background mode runs the gateway as a daemon, suitable for production use.

## Process Management Commands

### Check Status

```bash
xopcbot gateway status
```

Example output:
```
✅ Gateway is running

   PID: 12345
   Host: 0.0.0.0
   Port: 18790
   Uptime: 5m 32s
   Health: healthy

🌐 Access:
   URL: http://localhost:18790
   Token: abc12345...xyz67890
   Direct: http://localhost:18790?token=abc12345...
```

### Stop Gateway

```bash
# Graceful stop (default 5 second timeout)
xopcbot gateway stop

# Force stop
xopcbot gateway stop --force

# Custom timeout (milliseconds)
xopcbot gateway stop --timeout 3000
```

### Restart Gateway

```bash
# Restart with existing config
xopcbot gateway restart

# Restart with different config
xopcbot gateway restart --port 8080 --host 127.0.0.1
```

### View Logs

```bash
# View last 50 lines
xopcbot gateway logs

# View specific number of lines
xopcbot gateway logs --lines 100

# Follow logs in real-time (like tail -f)
xopcbot gateway logs --follow
```

## API Endpoints

### Send Message

```http
POST /api/message
Content-Type: application/json

{
  "channel": "telegram",
  "chat_id": "123456789",
  "content": "Hello from API!"
}
```

**Response**:

```json
{
  "status": "ok",
  "message_id": "abc123"
}
```

### Send Message (Sync)

```http
POST /api/message/sync
Content-Type: application/json

{
  "channel": "telegram",
  "chat_id": "123456789",
  "content": "Hello and reply!"
}
```

**Response**:

```json
{
  "status": "ok",
  "reply": "Hello! How can I help?"
}
```

### Agent Chat

```http
POST /api/agent
Content-Type: application/json

{
  "message": "What is the weather?",
  "session": "default"
}
```

**Response**:

```json
{
  "status": "ok",
  "reply": "The weather is sunny...",
  "session": "default"
}
```

### Trigger Cron Job

```http
POST /api/cron/trigger
Content-Type: application/json

{
  "job_id": "abc123"
}
```

**Response**:

```json
{
  "status": "ok",
  "message": "Task triggered"
}
```

### Health Check

```http
GET /health
```

**Response**:

```json
{
  "status": "healthy",
  "uptime": 3600
}
```

## Complete API List

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/message` | Send message (async) |
| POST | `/api/message/sync` | Send message (sync) |
| POST | `/api/agent` | Agent chat |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/:key` | Get session |
| DELETE | `/api/sessions/:key` | Delete session |
| GET | `/api/cron` | List scheduled tasks |
| POST | `/api/cron/trigger` | Trigger task |
| GET | `/health` | Health check |
| GET | `/api/logs` | Query logs (auth required) |
| POST | `/api/cron/create` | Create scheduled task |
| DELETE | `/api/cron/:id` | Delete scheduled task |
| POST | `/api/cron/:id/toggle` | Enable/disable scheduled task |

## Error Responses

All API errors follow this format:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid message content"
  }
}
```

**Error codes**:

| Error Code | Description |
|------------|-------------|
| `INVALID_REQUEST` | Invalid request parameters |
| `CHANNEL_NOT_FOUND` | Channel not found |
| `SESSION_NOT_FOUND` | Session not found |
| `AGENT_ERROR` | Agent processing error |
| `INTERNAL_ERROR` | Internal error |

## Usage Examples

### CLI Management

```bash
# Start background gateway
xopcbot gateway --background

# Check status
xopcbot gateway status

# View logs
xopcbot gateway logs --lines 20

# Restart gateway
xopcbot gateway restart

# Stop gateway
xopcbot gateway stop
```

### cURL

```bash
# Send message
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "chat_id": "123", "content": "Hello!"}'

# Agent chat
curl -X POST http://localhost:18790/api/agent \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2?"}'

# Health check
curl http://localhost:18790/health

# Request with auth
curl -X POST http://localhost:18790/api/agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "Hello"}'
```

### JavaScript/Node.js

```javascript
async function sendMessage(content, chatId) {
  const res = await fetch('http://localhost:18790/api/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'telegram',
      chat_id: chatId,
      content: content
    })
  });
  return res.json();
}

async function chatWithAgent(message) {
  const res = await fetch('http://localhost:18790/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  return res.json();
}
```

### Python

```python
import requests

def send_message(content, chat_id):
    resp = requests.post(
        'http://localhost:18790/api/message',
        json={
            'channel': 'telegram',
            'chat_id': chat_id,
            'content': content
        }
    )
    return resp.json()

def chat(message):
    resp = requests.post(
        'http://localhost:18790/api/agent',
        json={'message': message}
    )
    return resp.json()
```

## Webhook Integration

Supports receiving webhook callbacks:

```http
POST /api/webhook/:channel
Content-Type: application/json

{
  "event": "message",
  "data": { ... }
}
```

## Authentication

⚠️ Current version has no API authentication.

For production, recommended:
- Add Basic Auth via Nginx/Traefik
- Or configure API Key via `.env`
- Limit accessible IPs

## Configuration

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790,
    "auth": {
      "token": "your-secret-token"
    }
  }
}
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `host` | `0.0.0.0` | Bind address |
| `port` | `18790` | Port number |
| `auth.token` | `null` | API auth token (optional) |

## Background Mode Configuration

### PID File

When running in background, PID file is saved at: `~/.xopcbot/gateway.pid`

### Log File

Default log location: `~/.xopcbot/logs/gateway.log`

Can be customized via `--log-file` parameter:

```bash
xopcbot gateway --background --log-file /var/log/xopcbot/gateway.log
```

### Port Conflict Detection

On startup, it automatically detects port occupancy. If port is already in use:

```
❌ Failed to start gateway
   Port 18790 is already in use.
   💡 Use a different port: xopcbot gateway --port 8080
   💡 Or stop the existing process first
```

### Graceful Shutdown

Background mode supports graceful shutdown:
1. After receiving stop signal, wait 5 seconds for existing requests to complete
2. If requests still pending after 5 seconds, force terminate process
3. Automatically clean up PID file

Timeout can be customized via `--timeout` parameter:

```bash
xopcbot gateway stop --timeout 10000  # 10 second timeout
```

## CORS Configuration

To access from browser, add CORS headers (via proxy or middleware).
