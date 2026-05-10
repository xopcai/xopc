# Gateway API

REST API gateway for external programs to interact with xopc.

---

## Start Gateway

### Foreground Mode (Recommended)

```bash
xopc gateway --port 18790
```

Default port: `18790`

The gateway runs in foreground mode by default. Press `Ctrl+C` to stop.

### Force Start

If the port is already in use:

```bash
xopc gateway --force
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
xopc gateway status
```

**Example output:**
```
✅ Gateway is running

   Port: 18790

🌐 Access:
   URL: http://localhost:18790
   Token: abc12345...xyz67890

📝 Management:
   xopc gateway stop      # Stop gateway
   xopc gateway restart   # Restart gateway
```

### Stop Gateway

```bash
# Graceful stop (SIGTERM with 5 second timeout)
xopc gateway stop

# Force stop (SIGKILL immediately)
xopc gateway stop --force

# Custom timeout (milliseconds)
xopc gateway stop --timeout 3000
```

### Restart Gateway

```bash
# Send SIGUSR1 signal to trigger graceful restart
xopc gateway restart

# Force restart (kill and start new)
xopc gateway restart --force
```

> **Note:** SIGUSR1 restart requires `XOPC_ALLOW_SIGUSR1_RESTART=1` environment variable.

### View Logs

```bash
# View last 50 lines
xopc gateway logs

# View specific number of lines
xopc gateway logs --lines 100

# Follow logs in real-time (like tail -f)
xopc gateway logs --follow
```

---

## System Service Management

xopc supports running the gateway as a system service for automatic startup.

### Supported Platforms

| Platform | Service Type |
|----------|--------------|
| Linux | systemd user service |
| macOS | LaunchAgent |
| Windows | Task Scheduler |

### Install as System Service

```bash
xopc gateway install
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
xopc gateway install --port 8080 --token my-secret-token
```

After installation, the gateway will start automatically when you log in.

### Service Commands

```bash
# Start via system service
xopc gateway service-start

# Check service status
xopc gateway service-status

# Uninstall system service
xopc gateway uninstall
```

---

## Process Architecture

### Gateway Lock

Uses file-based locking instead of PID files:

- **Location**: `~/.xopc/locks/gateway.{hash}.lock`
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

### Channel startup and HTTP listen order {#channel-startup-and-http-listen-order}

`GatewayServer` (foreground `xopc gateway`) defers **outbound connect** for some channel plugins until **after** the Node HTTP server reports listening:

1. **Phase 1** — All channels run **`init()`**; channels that do **not** defer run **`start()`** immediately. Session manager, cron, heartbeat, and the agent service start as today. The **outbound drain loop** starts only after phase 2 when defer is active (so Telegram et al. are not raced by queued sends).
2. **Phase 2** — In the HTTP **`listen`** callback, deferred channels run **`start()`**, then **pending outbound replay**, then the outbound processor.

Bundled messaging channels (**Telegram**, **Weixin**, **Feishu**, **DingTalk**) declare deferral in plugin metadata. Override behavior with **`gateway.channelConnectDeferMode`** / **`channelConnectDeferIds`** / **`channelConnectDeferSkipIds`** — see [Configuration — Channel connect defer](configuration.md#channel-connect-defer).

Structured metrics are logged at **`info`** with `phase: "gateway.channel_startup"` and `stage: "phase1"` or `"phase2"` (millisecond fields, defer mode/source, and deferred channel ids).

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
xopc gateway --force
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

### Create session (`POST /api/sessions`)

Creates a webchat-scoped session (or returns an existing empty one). JSON body (all optional except as noted):

| Field | Description |
|-------|-------------|
| `channel` | Source label for the session key (default `webchat`). |
| `chat_id` | If set, forces a session key with this peer id. |
| `agentId` | If set, must match an **enabled** id in `agents.list`; session key uses this agent. If omitted, uses **`agents.default`** or the first enabled list entry (see [Session Routing](/routing-system)). |

---

## Complete API List

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/message` | Send message (async) |
| POST | `/api/message/sync` | Send message (sync) |
| POST | `/api/agent` | Agent chat |
| POST | `/api/sessions` | Create or reuse a webchat session (optional `agentId` in JSON body) |
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
| GET | `/api/image/capabilities` | Image generation / vision capability snapshot (auth) |
| POST | `/api/image/validate-model` | Validate a `provider/model` ref for image flows (auth) |
| GET | `/api/events` | Server-Sent Events stream (auth); broadcast events including **`agent.stream`** for the web console and Gateway extension iframes |
| GET | `/api/extensions` | List discovered extensions (includes optional `ui` summary) (auth) |
| GET | `/api/extensions/:id` | Extension detail and full manifest (auth) |
| GET | `/api/extensions/:id/assets/*` | Static assets for extension UI (HTML/JS/CSS; strict CSP) (auth) |
| GET | `/api/extensions/:id/storage` | List extension KV storage keys (auth) |
| GET | `/api/extensions/:id/storage/:key` | Read a storage value (auth) |
| PUT | `/api/extensions/:id/storage/:key` | Write a storage value (auth) |
| DELETE | `/api/extensions/:id/storage/:key` | Delete a storage key (auth) |
| GET | `/api/extensions/:id/config` | Read extension-scoped config object (auth) |
| PATCH | `/api/extensions/:id/config` | Merge extension-scoped config (auth) |

`GET` / `PATCH` **`/api/config`** (auth) expose agent defaults including **`imageModel`**, **`imageGenerationModel`**, and their **`imageModelFallbacks`** / **`imageGenerationModelFallbacks`** arrays; `PATCH` accepts the same `{ primary, fallbacks }` object shape as the chat `model` field. See [Image & vision](image-multimodal.md).

**Extension UI:** manifest **`ui`**, **`@xopcai/extension-ui-sdk`**, `/api/events` forwarding, and permissions are documented in [Extensions — Gateway console: Extension UI](extensions.md#gateway-console-extension-ui-iframe).

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

Gateway authentication supports 3 modes:
- `token` (default): API clients pass credential via `Authorization: Bearer <token>` or `X-Api-Key`.
- `password`: simple password mode (same transport as token validation layer).
- `none`: disables auth (local development only).

### Configure Auth (`token` mode)

```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "${XOPC_GATEWAY_TOKEN}"
    }
  }
}
```

### Configure Auth (`password` mode)

```json
{
  "gateway": {
    "auth": {
      "mode": "password",
      "password": "${XOPC_GATEWAY_PASSWORD}"
    }
  }
}
```

### Auth Environment Variables

- `XOPC_GATEWAY_AUTH_MODE` (`none` | `token` | `password`)
- `XOPC_GATEWAY_TOKEN`
- `XOPC_GATEWAY_PASSWORD`

Notes:
- `token` and `password` are mutually exclusive; startup fails if both are set.
- In `token` mode, a random token is auto-generated when no explicit token is provided.
- Token comparison uses constant-time checks to reduce timing-attack risk.
- Placeholder / weak tokens and tokens shorter than 16 chars are rejected at startup.
- Startup also runs a security audit (for example: `mode: none` on non-loopback host, wildcard CORS, auto-generated token warning).

### Browser Origin Protection (CSRF)

- Browser-initiated requests (with `Origin`) are checked against `gateway.corsOrigins`.
- Same-host fallback and local loopback fallback are supported for trusted local dev paths.
- Requests without `Origin` (CLI / server-to-server) skip origin checks and rely on auth credentials.

### Route Scope Enforcement

Authenticated API routes enforce operator scopes (`operator.read`, `operator.write`, `operator.admin`) internally.
Current authenticated users are granted default operator scopes, and this layer prepares the gateway for future per-connection scoped auth.

### WebSocket Flood Guard

Unauthorized WebSocket request bursts are throttled and can trigger forced socket close to limit abuse.

---

## Configuration

```json
{
  "gateway": {
    "host": "127.0.0.1",
    "port": 18790,
    "auth": {
      "mode": "token",
      "token": "${XOPC_GATEWAY_TOKEN}",
      "rateLimit": {
        "enabled": true,
        "maxAttempts": 5,
        "windowMs": 900000,
        "blockDurationMs": 300000
      }
    },
    "corsOrigins": ["http://localhost:5173"]
  }
}
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `host` | `127.0.0.1` | Bind address |
| `port` | `18790` | Port number |
| `auth.mode` | `token` | Auth mode (`none` / `token` / `password`) |
| `auth.token` | auto-generated in token mode | Token credential |
| `auth.password` | unset | Password credential |
| `auth.rateLimit.*` | see defaults above | Failed-auth rate limiter config |
| `corsOrigins` | `[]` | Allowed browser origins |
| `channelConnectDeferMode` | *(unset → `auto`)* | `auto` / `off` / `explicit` — see [Configuration](configuration.md#channel-connect-defer) |
| `channelConnectDeferIds` | - | Explicit defer list when mode is `explicit` |
| `channelConnectDeferSkipIds` | - | Subtract from auto or explicit defer sets |

---

## Graceful Shutdown

Gateway supports graceful shutdown:
1. After receiving stop signal, wait 5 seconds for existing requests
2. If requests still pending after 5 seconds, force terminate
3. Automatically release lock file

Timeout can be customized:

```bash
xopc gateway stop --timeout 10000  # 10 second timeout
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XOPC_GATEWAY_AUTH_MODE` | Override auth mode (`none` / `token` / `password`) |
| `XOPC_GATEWAY_TOKEN` | Gateway token when auth mode is `token` |
| `XOPC_GATEWAY_PASSWORD` | Gateway password when auth mode is `password` |
| `XOPC_NO_RESPAWN` | Disable process respawn |
| `XOPC_ALLOW_SIGUSR1_RESTART` | Allow SIGUSR1 to trigger restart |
| `XOPC_SERVICE_MARKER` | Mark running under supervisor |

---

## CORS Configuration

To access from browser, add CORS headers:

```json
{
  "gateway": {
    "corsOrigins": ["http://localhost:5173"]
  }
}
```

---

## Web UI

The gateway serves the Web UI at `/` (hash-router SPA; assets under `/assets/*`):

```bash
# Start gateway
xopc gateway

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
xopc gateway --force
```

### Gateway Won't Start

1. Check logs: `xopc gateway logs`
2. Verify config is valid JSON
3. Check if lock file exists: `~/.xopc/locks/`
4. Remove stale lock file if needed

### API Not Responding

1. Check gateway status: `xopc gateway status`
2. Verify port is correct
3. Check firewall settings
4. Review gateway logs for errors
