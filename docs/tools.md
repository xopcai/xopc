# Built-in Tools Reference

xopcbot provides a comprehensive set of built-in tools for the Agent to use.

## Tools Overview

| Category | Tools |
|----------|-------|
| **Filesystem** | `read_file`, `write_file`, `edit_file`, `list_dir` |
| **Search** | `grep`, `find` |
| **Shell** | `shell` |
| **Web** | `web_search`, `web_fetch` |
| **Communication** | `send_message` |
| **Memory** | `memory_search`, `memory_get` |

---

## Filesystem Tools

### 📄 read_file

Read file content. Output automatically truncated to first 500 lines or 50KB.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | File path |
| `limit` | number | ❌ | Maximum lines (default: 500) |

**Example:**
```json
{
  "name": "read_file",
  "arguments": {
    "path": "src/index.ts",
    "limit": 100
  }
}
```

---

### ✍️ write_file

Create or overwrite a file.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | File path |
| `content` | string | ✅ | File content |

**Example:**
```json
{
  "name": "write_file",
  "arguments": {
    "path": "src/new-file.ts",
    "content": "export const hello = 'world';"
  }
}
```

---

### ✏️ edit_file

Replace specified text in a file.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | File path |
| `oldText` | string | ✅ | Text to replace (must match exactly) |
| `newText` | string | ✅ | Replacement text |

**Example:**
```json
{
  "name": "edit_file",
  "arguments": {
    "path": "src/index.ts",
    "oldText": "const x = 1;",
    "newText": "const x = 2;"
  }
}
```

> **Note:** `oldText` must match exactly, including whitespace.

---

### 📂 list_dir

List directory contents.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ❌ | Directory path (default: workspace root) |

**Example:**
```json
{
  "name": "list_dir",
  "arguments": {
    "path": "src/components"
  }
}
```

---

## Search Tools

### 🔍 grep

Search text in files using ripgrep.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | ✅ | Search pattern (supports regex) |
| `glob` | string | ❌ | File matching pattern (e.g., `*.ts`) |
| `path` | string | ❌ | Search directory |
| `ignoreCase` | boolean | ❌ | Ignore case |
| `literal` | boolean | ❌ | Plain text matching |
| `context` | number | ❌ | Number of context lines |
| `limit` | number | ❌ | Maximum results (default: 100) |

**Example:**
```json
{
  "name": "grep",
  "arguments": {
    "pattern": "function.*test",
    "glob": "*.ts",
    "path": "src",
    "ignoreCase": true,
    "limit": 50
  }
}
```

---

### 📄 find

Find files by pattern.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | ✅ | Filename matching pattern |
| `path` | string | ❌ | Search directory |
| `limit` | number | ❌ | Maximum results |

**Example:**
```json
{
  "name": "find",
  "arguments": {
    "pattern": "*.test.ts",
    "path": "src",
    "limit": 20
  }
}
```

---

## Shell Tool

### 💻 shell

Execute shell command. Output automatically truncated to last 50KB.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | ✅ | Shell command to execute |
| `timeout` | number | ❌ | Timeout in seconds (default: 300) |
| `cwd` | string | ❌ | Working directory |

**Limits:**
- Timeout: 5 minutes (300 seconds)
- Output truncation: 50KB
- Restricted to workspace directory

**Example:**
```json
{
  "name": "shell",
  "arguments": {
    "command": "git log --oneline -10",
    "timeout": 60
  }
}
```

---

## Web Tools

### 🔍 web_search

Search the web using configured providers (`tools.web.search.providers`), then region-based HTML fallback if none succeed.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Search query |
| `count` | number | ❌ | Maximum results (default: `tools.web.search.maxResults`) |

**Configuration:**

```json
{
  "tools": {
    "web": {
      "region": "global",
      "search": {
        "maxResults": 5,
        "providers": [{ "type": "brave", "apiKey": "BSA_your_key_here" }]
      }
    }
  }
}
```

**Example:**
```json
{
  "name": "web_search",
  "arguments": {
    "query": "TypeScript best practices 2026",
    "count": 10
  }
}
```

---

### 📄 web_fetch

Fetch web page content.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | URL to fetch |
| `timeout` | number | ❌ | Timeout in seconds (default: 30) |

**Example:**
```json
{
  "name": "web_fetch",
  "arguments": {
    "url": "https://example.com/article",
    "timeout": 60
  }
}
```

---

## Communication Tools

### 📤 send_message

Send message to configured channel.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | ✅ | Channel name (e.g., `telegram`) |
| `chat_id` | string | ✅ | Chat ID |
| `content` | string | ✅ | Message content |
| `accountId` | string | ❌ | Account ID (for multi-account) |

**Example:**
```json
{
  "name": "send_message",
  "arguments": {
    "channel": "telegram",
    "chat_id": "123456789",
    "content": "Hello from agent!",
    "accountId": "personal"
  }
}
```

---

## Memory Tools

### 🔍 memory_search

Search memory files. Must be called before answering questions about previous work, decisions, etc.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Search query |
| `limit` | number | ❌ | Maximum results (default: 10) |

**Example:**
```json
{
  "name": "memory_search",
  "arguments": {
    "query": "API design decisions",
    "limit": 5
  }
}
```

---

### 📄 memory_get

Read snippets from memory files.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | ✅ | Memory file name |
| `snippet` | string | ✅ | Snippet identifier |

**Example:**
```json
{
  "name": "memory_get",
  "arguments": {
    "file": "project-notes.md",
    "snippet": "api-design"
  }
}
```

---

## Security Limits

| Operation | Limit |
|-----------|-------|
| File path | Restricted to workspace directory |
| Shell command | 5 minute timeout |
| File read | 500 lines or 50KB |
| Shell output | 50KB |
| File size | Maximum 10MB |

---

## Tool Execution Flow

```
User Message
    ↓
Agent processes
    ↓
┌─────────────────────────┐
│  Tool Call Decision     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Progress Feedback      │
│  → Shows: 🔍 搜索中...   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Execute Tool           │
│  → Apply security limits│
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Return Result          │
│  → Clear progress       │
└─────────────────────────┘
```

---

## Progress Feedback

Tools automatically trigger progress feedback:

| Tool | Progress Stage | Emoji |
|------|---------------|-------|
| `read_file` | reading | 📖 |
| `write_file` | writing | ✍️ |
| `edit_file` | writing | ✍️ |
| `grep` | searching | 🔍 |
| `web_search` | searching | 🔍 |
| `shell` | executing | ⚙️ |
| `find` | searching | 🔍 |

Configure feedback verbosity in `config.json`:

```json
{
  "progress": {
    "level": "normal",
    "showThinking": true,
    "streamToolProgress": true,
    "heartbeatEnabled": true
  }
}
```

See [Progress Documentation](/progress) for details.

---

## Best Practices

1. **Use memory tools first**: Call `memory_search` before answering questions about previous work
2. **Respect limits**: Be aware of truncation limits for large files/outputs
3. **Error handling**: Tools return errors gracefully - agent should handle them
4. **Progress feedback**: Long-running tools automatically show progress
