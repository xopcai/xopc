# Session Management

xopc provides comprehensive session management for conversation history via CLI and Web UI.

---

## Overview

| Feature | CLI | Web UI |
|---------|-----|--------|
| List sessions | ✅ | ✅ |
| Search sessions | ✅ | ✅ |
| View details | ✅ | ✅ |
| Archive/Unarchive | ✅ | ✅ |
| Pin/Unpin | ✅ | ✅ |
| Export (JSON) | ✅ | ✅ |
| Delete | ✅ | ✅ |
| Reset in place (`/new`) | ✅ (channels) | ✅ |
| Search in session | ❌ | ✅ |

---

## Session Storage

| Property | Value |
|----------|-------|
| Storage directory | `agents/<agentId>/sessions/` (under the state directory; sharded transcript files) |
| Index file | `agents/<agentId>/sessions/index.json` |
| File format | JSON |
| Archive directory | `agents/<agentId>/sessions/archive/` |
| Session overrides | `agents/<agentId>/sessions/config/<sanitized-session-key>.json` |

---

## Reset vs delete

| Action | Session key | Transcript | Overrides (`sessions/config/`, thinking on disk) |
|--------|-------------|------------|--------------------------------------------------|
| **Reset** (`/new`, `POST /api/sessions/:key/reset`) | Same key | Current JSONL archived as `*.reset.*`; new `sessionId` + empty transcript | Preserved |
| **Delete** (`DELETE /api/sessions/:key`) | Removed from index | Archived as `*.deleted.*` | Config file removed with session |

Channel slash **`/new`** (aliases `/reset`, `/restart`) uses reset semantics, not delete. TUI **`/new`** / **`/reset`** call the same reset API in gateway mode (`POST /api/sessions/:key/reset` via `performSessionReset`).

**Automatic rollover:** At turn start, xopc evaluates `session.reset` (daily at `atHour` or idle via `idleMinutes`) and archives + assigns a new `sessionId` when the session is stale—same as OpenClaw channel `initSessionState`. Configured **`session.resetTriggers`** (default `["/new","/reset"]`) are matched on inbound body before the model runs; bare triggers ack without a turn, `/new hello` resets then continues with `hello`.

**Webchat API:** `POST /api/agent` requires `sessionKey` / `chatId` in `agent:{agentId}:{rest}` form (or omit for `agent:main:main`). Bare `chat_*` ids are rejected; create sessions via `POST /api/sessions`.

---

## Agent session keys

Runtime session keys use the OpenClaw-aligned form **`agent:{agentId}:{rest}`**:

| Shape | Example | Use |
|-------|---------|-----|
| Main bucket | `agent:main:main` | Default TUI/CLI “home” session when `session.scope` is `per-sender` (`session.mainKey` defaults to `main`) |
| Global scope | `global` | When `session.scope` is `global` and no `-s` is passed |
| Channel peer | `agent:main:telegram:default:direct:123456` | Routed inbound/outbound chats |
| Shorthand | `mytopic` on CLI/TUI | Expanded to `agent:{currentAgentId}:mytopic` |

The `agentId` segment selects which **`agents.list`** entry (merged over `agents.defaults`) owns workspace, model defaults, and on-disk `agents/<id>/sessions/`. Prefer full `agent:…` keys in scripts; shorthand is fine for interactive TUI.

---

## Session States

| Status | Description |
|--------|-------------|
| `active` | Currently active session (default) |
| `pinned` | Pinned to top for quick access |
| `archived` | Archived and moved to archive folder |

---

## CLI Usage

### List Sessions

```bash
# List all sessions
xopc session list

# Filter by status
xopc session list --status active
xopc session list --status archived
xopc session list --status pinned

# Search by name or content
xopc session list --query "project"

# Sort and limit
xopc session list --sort updatedAt --order desc --limit 50
```

### View Session Details

```bash
# Show session info and recent messages
xopc session info telegram:123456

# Search within a session
xopc session grep telegram:123456 "API design"
```

### Manage Sessions

```bash
# Rename a session
xopc session rename telegram:123456 "Project Discussion"

# Add tags
xopc session tag telegram:123456 work important

# Remove tags
xopc session untag telegram:123456 important

# Archive a session
xopc session archive telegram:123456

# Unarchive a session
xopc session unarchive telegram:123456

# Pin a session
xopc session pin telegram:123456

# Unpin a session
xopc session unpin telegram:123456

# Delete a session
xopc session delete telegram:123456

# Export session to JSON
xopc session export telegram:123456 \
  --format json \
  --output backup.json
```

### Bulk Operations

```bash
# Delete multiple sessions by filter
xopc session delete-many --status archived --force

# Archive old sessions (30+ days inactive)
xopc session cleanup --days 30
```

### Statistics

```bash
xopc session stats
```

**Sample output:**
```
📊 Session Statistics

  Total Sessions:     42
  Active:             28
  Archived:           12
  Pinned:             2
  Total Messages:     1,847
  Total Tokens:       452.3k

  By Channel:
    telegram: 35
    gateway: 5
    cli: 2
```

---

## Web UI

The Web UI provides a visual interface for session management at the gateway root (hash router; sessions live under `#/sessions`).

### Features

1. **Session List**: Grid/list view with filtering
2. **Search**: Real-time search across sessions
3. **Filters**: Filter by status (All/Active/Pinned/Archived)
4. **Statistics**: Visual stats cards
5. **Detail Drawer**: Click any session to view:
   - Full message history
   - In-session search with highlighting
   - Archive/Pin/Export/Delete actions

### Accessing the UI

```bash
# Install and start the gateway OS service (or run foreground: xopc gateway)
xopc gateway service install
xopc gateway service start

# Open in browser
open http://localhost:18790/#/sessions
```

---

## Session Structure

```typescript
interface SessionMetadata {
  key: string;              // Unique identifier
  name?: string;            // Optional custom name
  status: 'active' | 'idle' | 'archived' | 'pinned';
  tags: string[];           // User-defined tags
  createdAt: string;        // ISO timestamp
  updatedAt: string;
  lastAccessedAt: string;
  messageCount: number;
  estimatedTokens: number;
  compactedCount: number;   // Number of compressions
  sourceChannel: string;    // telegram, gateway, cli
  sourceChatId: string;
}

interface SessionDetail extends SessionMetadata {
  messages: Message[];
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  content: string;
  timestamp?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}
```

---

## Session Index

The `index.json` file maintains a cache of all session metadata:

```json
{
  "version": "1.0",
  "lastUpdated": "2026-02-14T10:00:00Z",
  "sessions": [
    {
      "key": "telegram:123456",
      "status": "active",
      "tags": ["work"],
      "messageCount": 42,
      ...
    }
  ]
}
```

---

## Automatic Maintenance

### Compaction

When a session exceeds the context window limit:

1. Early messages are summarized using LLM
2. Recent messages are preserved (default: last 10)
3. System messages are always kept

Configure in `config.json`:

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "enabled": true,
        "mode": "abstractive",
        "triggerThreshold": 0.8,
        "keepRecentMessages": 10
      }
    }
  }
}
```

**Compaction Modes:**
- `extractive` - Summarize using key sentences
- `abstractive` - LLM-based summarization
- `structured` - Preserve structured data

### Sliding Window

To prevent memory issues:
- Maximum messages: 100
- Keeps recent messages when limit exceeded
- Preserves system context

---

## Best Practices

1. **Use Tags**: Tag sessions by project or topic
2. **Pin Important Sessions**: Keep frequently accessed sessions pinned
3. **Archive Old Sessions**: Archive sessions you don't need regularly
4. **Regular Cleanup**: Use `session cleanup` for old inactive sessions
5. **Export Before Delete**: Export important sessions before deletion

---

## Troubleshooting

### Sessions Not Loading in Web UI

1. Check gateway is running: `xopc gateway status`
2. In the browser devtools **Network** tab, confirm REST calls to `/api/sessions` succeed and, if the UI uses live updates, that **`GET /api/events`** (SSE) stays connected
3. Check for errors in gateway logs

### Session Index Corrupted

The index will be automatically rebuilt on next access. To force rebuild:

```bash
# Delete index file (replace <agentId> with your agent id, e.g. main)
rm ~/.xopc/agents/<agentId>/sessions/index.json

# It will be rebuilt on next session list
xopc session list
```

### Missing Sessions

If sessions exist on disk under `agents/<agentId>/sessions/` but don't appear:

```bash
# Force index rebuild
xopc session list --limit 1000
```

---

## API Reference

The gateway exposes sessions under **`/api/sessions`** (authenticated JSON over HTTP). There is **no WebSocket** surface for the console; live UI updates use **SSE** on **`GET /api/events`** where applicable.

### Gateway HTTP routes (summary)

| Operation | HTTP |
|-----------|------|
| List / filter / search | `GET /api/sessions` (`status`, `search`, `channel`, `limit`, `offset`, …) |
| Stats | `GET /api/sessions/stats` |
| Get session | `GET /api/sessions/:key` |
| Update metadata (e.g. tags) | `PATCH /api/sessions/:key` |
| Create session | `POST /api/sessions` |
| Rename | `POST /api/sessions/:key/rename` |
| Archive / unarchive | `POST /api/sessions/:key/archive` · `POST /api/sessions/:key/unarchive` |
| Pin / unpin | `POST /api/sessions/:key/pin` · `POST /api/sessions/:key/unpin` |
| Export | `GET /api/sessions/:key/export` |
| Delete | `DELETE /api/sessions/:key` |
| Reset (archive + new transcript id) | `POST /api/sessions/:key/reset` |

Search inside transcript text from the CLI: `xopc session grep <sessionKey> <pattern>`.
