# Session Management

xopcbot provides comprehensive session management for conversation history, available via both CLI and Web UI.

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
| Search in session | ❌ | ✅ |

## Session Storage

| Property | Value |
|----------|-------|
| Storage directory | `workspace/.sessions/` |
| Index file | `workspace/.sessions/index.json` |
| File format | JSON |
| Archive directory | `workspace/.sessions/archive/` |

## Session States

| Status | Description |
|--------|-------------|
| `active` | Currently active session (default) |
| `pinned` | Pinned to top for quick access |
| `archived` | Archived and moved to archive folder |

## CLI Usage

### List Sessions

```bash
# List all sessions
xopcbot session list

# Filter by status
xopcbot session list --status active
xopcbot session list --status archived
xopcbot session list --status pinned

# Search by name or content
xopcbot session list --query "project"

# Sort and limit
xopcbot session list --sort updatedAt --order desc --limit 50
```

### View Session Details

```bash
# Show session info and recent messages
xopcbot session info telegram:123456

# Search within a session
xopcbot session grep telegram:123456 "API design"
```

### Manage Sessions

```bash
# Rename a session
xopcbot session rename telegram:123456 "Project Discussion"

# Add tags
xopcbot session tag telegram:123456 work important

# Remove tags
xopcbot session untag telegram:123456 important

# Archive a session
xopcbot session archive telegram:123456

# Unarchive a session
xopcbot session unarchive telegram:123456

# Pin a session
xopcbot session pin telegram:123456

# Unpin a session
xopcbot session unpin telegram:123456

# Delete a session
xopcbot session delete telegram:123456

# Export session to JSON
xopcbot session export telegram:123456 --format json --output backup.json
```

### Bulk Operations

```bash
# Delete multiple sessions by filter
xopcbot session delete-many --status archived --force

# Archive old sessions (30+ days inactive)
xopcbot session cleanup --days 30
```

### Statistics

```bash
# View session statistics
xopcbot session stats
```

Sample output:
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

## Web UI

The Web UI provides a visual interface for session management at `/ui/`.

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
# Start the gateway
xopcbot gateway start

# Open in browser
open http://localhost:18790/ui/
```

## Session Structure

```typescript
interface SessionMetadata {
  key: string;              // Unique identifier (e.g., "telegram:123456")
  name?: string;            // Optional custom name
  status: 'active' | 'idle' | 'archived' | 'pinned';
  tags: string[];           // User-defined tags
  createdAt: string;        // ISO timestamp
  updatedAt: string;
  lastAccessedAt: string;
  messageCount: number;
  estimatedTokens: number;
  compactedCount: number;   // Number of times compressed
  sourceChannel: string;    // telegram, whatsapp, gateway, cli
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

## Session Index

The `index.json` file maintains a cache of all session metadata for fast querying:

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

## Automatic Maintenance

### Compaction

When a session exceeds the context window limit, old messages are automatically summarized:

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

### Sliding Window

To prevent memory issues, sessions also have a sliding window:

- Maximum messages: 100
- Keeps recent messages when limit exceeded
- Preserves system context

## Best Practices

1. **Use Tags**: Tag sessions by project or topic for easy filtering
2. **Pin Important Sessions**: Keep frequently accessed sessions pinned
3. **Archive Old Sessions**: Archive sessions you don't need regularly
4. **Regular Cleanup**: Use `session cleanup` to archive old inactive sessions
5. **Export Before Delete**: Export important sessions before deletion

## Troubleshooting

### Sessions Not Loading in Web UI

- Check gateway is running: `xopcbot gateway status`
- Verify WebSocket connection in browser console
- Check for errors in gateway logs

### Session Index Corrupted

The index will be automatically rebuilt on next access. To force rebuild:

```bash
# Delete index file
rm workspace/.sessions/index.json

# It will be rebuilt on next session list
xopcbot session list
```

### Missing Sessions

If sessions exist in `.sessions/` but don't appear:

```bash
# Force index rebuild via migration
xopcbot session list --limit 1000
```

## API Reference

### WebSocket API Methods

| Method | Description |
|--------|-------------|
| `session.list` | List sessions with pagination |
| `session.get` | Get session details |
| `session.delete` | Delete a session |
| `session.rename` | Rename a session |
| `session.tag` | Add tags |
| `session.untag` | Remove tags |
| `session.archive` | Archive session |
| `session.unarchive` | Unarchive session |
| `session.pin` | Pin session |
| `session.unpin` | Unpin session |

## Subagents

Subagents are special sessions created when the main agent invokes `call_subagent` or `call_subagents` tools. Each subagent runs in its own isolated session with independent state.

### Subagent Session Key Format

Subagent session keys follow the pattern:
- Single subagent: `subagent:{name}:{timestamp}:{randomId}`
- Parallel subagents: `subagent:parallel:{timestamp}:{index}:{randomId}`

### Listing Subagents

```bash
# List all subagent sessions via API
curl http://localhost:18790/api/subagents

# Response
{
  "items": [
    {
      "key": "subagent:researcher:1234567890:abc123",
      "status": "active",
      "messageCount": 5,
      "updatedAt": "2026-02-14T10:00:00Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "hasMore": false
}
```

### Web UI

Access the Subagents management page at `/ui/#subagents` to:
- View all subagent sessions
- See subagent execution status
- Review subagent messages and results
- Delete finished subagents

### Subagent Lifecycle

```
1. Main agent calls call_subagent/call_subagents tool
       ↓
2. New session created with subagent: prefix
       ↓
3. Subagent executes task in isolated context
       ↓
4. Result returned to main agent
       ↓
5. Subagent session remains for review (until manually deleted)
```

### Best Practices

1. **Review Results**: Check subagent outputs in Web UI
2. **Clean Up**: Delete finished subagents to keep list manageable
3. **Naming**: Use descriptive `subagent_name` for easy identification
4. **Parallel Tasks**: Use `call_subagents` for independent parallel tasks

| `session.search` | Search sessions |
| `session.searchIn` | Search within session |
| `session.export` | Export session |
| `session.stats` | Get statistics |
