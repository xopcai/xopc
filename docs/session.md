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
| Database | `~/.xopc/xopc.db` (SQLite, WAL) |
| Tables | `sessions`, `transcripts`, `transcript_entries`, `session_config`, `transcript_fts` (FTS5) |
| Per-session overrides | SQLite `session_config` (model, thinking, verbose, …) |
| Legacy path | `agents/<agentId>/sessions/` may exist from older installs; new installs do not write transcripts there |

Session metadata, append-only compaction boundaries, transcript rows, and full-text search are stored in SQLite. Compaction boundaries are regular typed rows in `transcript_entries`. The gateway opens the database on startup (`openXopcDatabase()`).

---

## Reset vs delete

| Action | Session key | Transcript | Overrides (`session_config`, thinking on session row) |
|--------|-------------|------------|------------------------------------------------------|
| **Reset** (`/new`, `POST /api/sessions/:key/reset`) | Same key | Current transcript archived in SQLite; new `sessionId` + empty transcript | Preserved |
| **Delete** (`DELETE /api/sessions/:key`) | Removed from index | Transcript rows removed with session | Config removed with session |

Channel slash **`/new`** (aliases `/reset`, `/restart`) uses reset semantics, not delete. TUI **`/new`** / **`/reset`** call the same reset API in gateway mode (`POST /api/sessions/:key/reset` via `performSessionReset`).

**Automatic rollover:** Automatic rollover is disabled unless `session.reset`, `session.resetByType`, or `session.resetByChannel` explicitly configures it. When configured, xopc evaluates the daily `atHour` or sliding `idleMinutes` boundary at turn start and archives + assigns a new `sessionId` when stale. Configured **`session.resetTriggers`** (default `["/new","/reset"]`) are matched on inbound body before the model runs; bare triggers ack without a turn, `/new hello` resets then continues with `hello`.

**Webchat API:** `POST /api/sessions/:sessionKey/inputs` requires an existing `agent:{agentId}:{rest}` session key. Create sessions via `POST /api/sessions`; input creation never creates a session implicitly.

---

## Agent session keys

Runtime session keys use the OpenClaw-aligned form **`agent:{agentId}:{rest}`**:

| Shape | Example | Use |
|-------|---------|-----|
| Main bucket | `agent:main:main` | Default TUI/CLI “home” session when `session.scope` is `per-sender` (`session.mainKey` defaults to `main`) |
| Global scope | `global` | When `session.scope` is `global` and no `-s` is passed |
| Channel peer | `agent:main:telegram:default:direct:123456` | Routed inbound/outbound chats |
| Shorthand | `mytopic` on CLI/TUI | Expanded to `agent:{currentAgentId}:mytopic` |

The `agentId` segment selects one enabled **`agents.list`** manifest, with any declared `capabilityPresets` applied. That effective manifest owns workspace, model roles, tool policy, and agent home (`agents/<id>/`). Prefer full `agent:…` keys in scripts; shorthand is fine for interactive TUI.

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

## Automatic Maintenance

### Compaction

When the complete estimated model input reaches the configured threshold, or the active transcript crosses its byte limit:

1. xopc plans atomic user/tool units and never splits an assistant tool call from its results.
2. The configured summary model creates a structured, chunked summary while recent turns and a recent-token tail remain verbatim.
3. Summary quality checks require all sections and exact identifiers; configured fallback models are tried before failure.
4. xopc appends a compaction boundary containing the exact reduced LLM context. Original transcript rows remain unchanged for display, export, and search.
5. If summary generation or quality checks fail, compaction fails closed and the original model context is kept.

Repeated compaction replaces the previous boundary in model input while the on-disk transcript remains append-only.

Provider input is projected only from canonical transcript rows and compaction boundaries. xopc does not generate
synthetic `<coding_context>` user messages from old tool results. Incomplete tool calls and orphan tool results are
removed from provider input as pairs.

Deleting a chat turn operates atomically on raw transcript rows: the selected user row and all assistant, tool,
tool-result, and audit rows through the next user row are removed together. Existing compaction boundaries are
invalidated so a deleted turn cannot survive inside a summary snapshot; the next turn compacts the remaining
authoritative history again when needed.

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
2. In browser devtools **Network**, confirm `/api/sessions` REST calls succeed and one **`/api/realtime/v1/ws`** WebSocket stays connected
3. Check for errors in gateway logs

### Session store issues

Run deep integrity checks:

```bash
xopc doctor --deep
```

This validates SQLite linkage between `sessions` and `transcripts`, scans for orphan transcripts, and runs `PRAGMA integrity_check`.

### Missing sessions

If sessions were created but do not appear in the UI:

```bash
xopc session list --limit 1000
```

Check gateway logs and confirm `~/.xopc/xopc.db` exists and is writable.

---

## API Reference

The gateway exposes session snapshots and commands under **`/api/sessions`** (authenticated JSON over HTTP). Live updates and run output use the authenticated **`/api/realtime/v1/ws`** WebSocket.

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
| Delete one user turn | `DELETE /api/sessions/:key/messages` (`userRoundIndex`) |
| Delete | `DELETE /api/sessions/:key` |
| Reset (archive + new transcript id) | `POST /api/sessions/:key/reset` |

Search inside transcript text from the CLI: `xopc session grep <sessionKey> <pattern>`.
