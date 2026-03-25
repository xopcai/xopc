# Gateway API

REST API gateway for external programs to interact with xopcbot.

---

## Start Gateway

### Foreground Mode (Recommended)

```bash
xopcbot gateway --port 18790
```

Default port: `18790`

The gateway runs in foreground mode by default. Press `Ctrl+C` to stop.

### Force Start

If the port is already in use:

```bash
xopcbot gateway --force
```

This will:
1. Send SIGTERM to processes listening on the port
2. Wait 700ms for graceful shutdown
3. Send SIGKILL if still running
4. Start the new gateway instance

---

## Process Management Commands

### Check Status

```bash
xopcbot gateway status
```

**Example output:**
```
✅ Gateway is running

   Port: 18790

🌐 Access:
   URL: http://localhost:18790
   Token: abc12345...xyz67890

📝 Management:
   xopcbot gateway stop      # Stop gateway
   xopcbot gateway restart   # Restart gateway
```

### Stop Gateway

```bash
# Graceful stop (SIGTERM with 5 second timeout)
xopcbot gateway stop

# Force stop (SIGKILL immediately)
xopcbot gateway stop --force

# Custom timeout (milliseconds)
xopcbot gateway stop --timeout 3000
```

### Restart Gateway

```bash
# Send SIGUSR1 signal to trigger graceful restart
xopcbot gateway restart

# Force restart (kill and start new)
xopcbot gateway restart --force
```

> **Note:** SIGUSR1 restart requires `XOPCBOT_ALLOW_SIGUSR1_RESTART=1` environment variable.

### View Logs

```bash
# View last 50 lines
xopcbot gateway logs

# View specific number of lines
xopcbot gateway logs --lines 100

# Follow logs in real-time (like tail -f)
xopcbot gateway logs --follow
```

---

## System Service Management

xopcbot supports running the gateway as a system service for automatic startup.

### Supported Platforms

| Platform | Service Type |
|----------|--------------|
| Linux | systemd user service |
| macOS | LaunchAgent |
| Windows | Task Scheduler |

### Install as System Service

```bash
xopcbot gateway install
```

**Options:**

| Option | Description |
|--------|-------------|
| `--port <number>` | Gateway port (default: 18790) |
| `--host <address>` | Host to bind to (default: 0.0.0.0) |
| `--token <token>` | Authentication token |
| `--runtime <runtime>` | Runtime: node or binary |

**Example:**
```bash
xopcbot gateway install --port 8080 --token my-secret-token
```

After installation, the gateway will start automatically when you log in.

### Service Commands

```bash
# Start via system service
xopcbot gateway service-start

# Check service status
xopcbot gateway service-status

# Uninstall system service
xopcbot gateway uninstall
```

---

## Process Architecture

### Gateway Lock

Uses file-based locking instead of PID files:

- **Location**: `~/.xopcbot/locks/gateway.{hash}.lock`
- **Hash**: SHA256 of config path (supports multiple configs)
- **Content**: `{ pid, createdAt, configPath, startTime }`

### Run Loop

```
┌─────────────────────────────────────────┐
│              Run Loop                   │
├─────────────────────────────────────────┤
│  1. Acquire Gateway Lock                │
│  2. Start Gateway Server                │
│  3. Wait for signal                     │
│     - SIGTERM/SIGINT -> Stop            │
│     - SIGUSR1 -> Restart                │
│  4. Graceful shutdown (5s timeout)      │
│  5. Release lock                        │
│  6. Exit or respawn                     │
└─────────────────────────────────────────┘
```

### Process Respawn

On restart:
1. Detect environment (supervised vs normal)
2. If supervised: exit and let supervisor restart
3. If normal: spawn detached child, then exit

### Port Management

```bash
# Check if port is available
lsof -i :18790

# Force free port (SIGTERM -> SIGKILL)
xopcbot gateway --force
```

---

## API Endpoints

### Send Message

```http
POST /api/message
Content-Type: application/json

{
  "channel": "telegram",
  "chat_id": "123456789",
  "content": "Hello from API!",
  "accountId": "personal"
}
```

**Response:**
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

**Response:**
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

**Response:**
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

**Response:**
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

**Response:**
```json
{
  "status": "healthy",
  "uptime": 3600
}
```

---

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
| POST | `/api/cron/:id/toggle` | Enable/disable task |
| GET | `/api/providers` | List LLM providers |
| GET | `/api/models` | List available models |
| GET | `/api/models-json` | Get models.json config |
| PATCH | `/api/models-json` | Save models.json |

---

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

**Error codes:**

| Error Code | Description |
|------------|-------------|
| `INVALID_REQUEST` | Invalid request parameters |
| `CHANNEL_NOT_FOUND` | Channel not found |
| `SESSION_NOT_FOUND` | Session not found |
| `AGENT_ERROR` | Agent processing error |
| `INTERNAL_ERROR` | Internal error |

---

## Usage Examples

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

---

## Authentication

⚠️ **Current version has no API authentication enabled by default.**

For production, recommended:
- Add Basic Auth via Nginx/Traefik
- Or configure API Key via config
- Limit accessible IPs

### Configure Auth

```json
{
  "gateway": {
    "auth": {
      "enabled": true,
      "api_key": "your-secret-token"
    }
  }
}
```

---

## Configuration

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790,
    "auth": {
      "enabled": true,
      "api_key": "your-secret-token"
    },
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000"]
    }
  }
}
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `host` | `0.0.0.0` | Bind address |
| `port` | `18790` | Port number |
| `auth.enabled` | `false` | Enable authentication |
| `auth.api_key` | `null` | API auth token |
| `cors.enabled` | `false` | Enable CORS |
| `cors.origins` | `[]` | Allowed origins |

---

## Graceful Shutdown

Gateway supports graceful shutdown:
1. After receiving stop signal, wait 5 seconds for existing requests
2. If requests still pending after 5 seconds, force terminate
3. Automatically release lock file

Timeout can be customized:

```bash
xopcbot gateway stop --timeout 10000  # 10 second timeout
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XOPCBOT_NO_RESPAWN` | Disable process respawn |
| `XOPCBOT_ALLOW_SIGUSR1_RESTART` | Allow SIGUSR1 to trigger restart |
| `XOPCBOT_SERVICE_MARKER` | Mark running under supervisor |

---

## CORS Configuration

To access from browser, add CORS headers:

```json
{
  "gateway": {
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000"],
      "credentials": true
    }
  }
}
```

---

## Web UI

The gateway serves the Web UI at `/` (hash-router SPA; assets under `/assets/*`):

```bash
# Start gateway
xopcbot gateway

# Open in browser
open http://localhost:18790/
```

**Features:**
- Real-time chat with WebSocket
- Session management
- Configuration dialog
- Log viewer
- Cron job management
- Models configuration

---

## Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
lsof -i :18790

# Force start (kills existing process)
xopcbot gateway --force
```

### Gateway Won't Start

1. Check logs: `xopcbot gateway logs`
2. Verify config is valid JSON
3. Check if lock file exists: `~/.xopcbot/locks/`
4. Remove stale lock file if needed

### API Not Responding

1. Check gateway status: `xopcbot gateway status`
2. Verify port is correct
3. Check firewall settings
4. Review gateway logs for errors
