# Built-in Tools Reference

xopc provides a comprehensive set of built-in tools for the Agent to use.

## Tools Overview

Tools are assembled in `AgentToolsFactory` (`src/agent/tools/factory.ts`). Some are always registered; others need **config**, **session** (for example `session_search` when a `SessionStore` exists), or **gateway** wiring (for example `clarify` with a live user channel, `cronjob` when `CronService` is available).

| Category | Tools |
|----------|-------|
| **Planning & UX** | `clarify`, `todo` |
| **Skills (runtime)** | `skills_list`, `skill_view`, `skill_manage` |
| **Filesystem** | `read_file`, `write_file`, `edit_file`, `list_dir` |
| **Search** | `grep`, `find` |
| **Shell** | `shell` |
| **Web** | `web_search`, `web_fetch`, `web_extract` |
| **Communication** | `send_message`, `send_media` |
| **Memory** | `memory_search`, `memory_get`, `curated_memory` (optional), `session_search` (optional) |
| **Vision / images** | `image` (optional), `image_generate` (optional) |
| **Browser** | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_screenshot` (optional) |
| **Delegation & code** | `delegate_task` (optional), `execute_code` (optional) |
| **Scheduling** | `cronjob` (optional) |

Extension packages may append more tools when an extension registry is present.

### Recent capability additions (tools + skill runtime)

1. **`skills_list`**, **`skill_view`**, **`skill_manage`** — discover skills, read `SKILL.md` or files under `references/`, `templates/`, `scripts/`, `assets/`, and create/edit/patch/delete user skills subject to `skills.agentWritePolicy` (see [Skills](skills.md)).
2. **Skill env passthrough** — after **`skill_view`**, declared variable **names** from SKILL.md (`required_environment_variables`, `prerequisites.env_vars`, `requires.env`, `metadata.xopc.requires.env`) are registered for the session; the **`shell`** tool may expose matching variables from the process (values are never shown to the model).
3. **`web_extract`** — fetches a page and runs an LLM pass for markdown-oriented extraction (`agents.defaults.webExtract.model` or `XOPC_WEB_EXTRACT_MODEL`).
4. **`send_media`** — sends a local file as photo/video/audio/document to the current channel context.
5. **`clarify`** — asks the user a question (optional multiple choice) and waits for an answer on **web**, **Telegram**, or **CLI** when wired; otherwise returns a message and uses `default` if provided.
6. **`todo`** — per-session todo list with merge or full replace.
7. **`image`** / **`image_generate`** — vision analysis and image generation when `agents.defaults.imageModel` / `imageGenerationModel` (and keys) resolve.
8. **Browser tools** — Playwright-backed automation when `agents.defaults.browser.enabled` is true (install browsers once: `npx playwright install chromium`).
9. **`delegate_task`** — spawns a sub-agent with a restricted toolset and returns a text summary only (`agents.defaults.delegate.enabled`).
10. **`execute_code`** — sandboxed JavaScript that calls a subset of tools programmatically (`agents.defaults.executeCode.enabled`); `node:vm` is not a strong security boundary — use only with trusted models.
11. **`cronjob`** — manage scheduled agent turns via gateway `CronService`; includes basic prompt threat scanning.
12. **`session_search`** — search other sessions’ transcripts when persistence is enabled; optional per-session summaries.
13. **`curated_memory`** — live read/write to agent-home `memories/` while the system prompt keeps a frozen snapshot from session start.
14. **Skill tool gating** — skills can be omitted from `<available_skills>` unless required tools exist (`skills.toolGating` and skill metadata).
15. **`disable-model-invocation`** in SKILL.md — skill stays on disk but is hidden from model-facing lists.
16. **Skills Hub CLI** — `xopc skills hub pull|update|lock` for git/archive installs under `~/.xopc/skills` with `skills-lock.json` (see [Skills](skills.md)).
17. **Web search** — configurable provider list in `tools.web.search.providers` plus regional HTML fallback.
18. **Skill file limits** — `skills.limits.maxSkillFileBytes` caps reads in `skill_view`.
19. **Memory plugins** — `MemoryManager.getAdditionalTools()` can register extra memory-related tools.
20. **DashScope / multi-provider image paths** — image tooling follows the same provider resolution stack as other agent models.

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

### 🧠 curated_memory

Read or edit **bounded** curated memory under **`agents/<agentId>/memories/`** (`MEMORY.md` and `USER.md`), with entries separated by a section-sign delimiter. The system prompt includes a **frozen snapshot** from session start; this tool reads and writes **live** state on disk. Disabled when `agents.defaults.memory.enabled` is `false` or `useEnhancedSystem` is `false`. If `userProfileEnabled` is `false`, mutations targeting the user profile are rejected (reads still work).

See [Configuration](configuration.md) (**agents.defaults.memory**) and [Curated memory](workspace.md#curated-memory).

---

### 🔎 session_search

Search **other sessions’** transcripts (keyword or semantic-style query with optional LLM summaries per session). Requires session persistence and agent wiring; model for summaries: `agents.defaults.sessionSearch.summaryModel` or `XOPC_SESSION_SEARCH_MODEL`.

See [Configuration](configuration.md) (**agents.defaults.sessionSearch**).

---

## Planning & clarification

### ❓ clarify

Ask the user a clarifying question and wait for a reply. Optional `choices` (2–10) for multiple choice; optional `default` when the user does not answer or clarification is unavailable.

**Transports:** interactive flow when the session is **webchat**, **Telegram**, or **CLI** with clarification wired; otherwise the tool returns guidance and uses `default` if set.

---

### ✅ todo

Per-session task list. Pass `todos` (items with `id`, `content`, `status`: `pending` \| `in_progress` \| `completed` \| `cancelled`). Use `merge: true` to upsert by `id`; omit or set `merge: false` to replace the whole list. Omit `todos` to read the current list.

---

## Skills tools

### 📚 skills_list

Lists enabled skills (name, description, source) for the current session, respecting skill allowlists and tool gating. Optional `query` filters by substring on name/description.

---

### 📖 skill_view

Loads `SKILL.md` or a file under `references/`, `templates/`, `scripts/`, or `assets/`. Parameters: `name`, optional `path`, optional `limit` (lines, default 500). Registers declared env var **names** for passthrough (see overview). Respects `skills.limits.maxSkillFileBytes` and disabled / gated skills.

---

### 🛠️ skill_manage

Create, edit, patch, delete skills, or `write_file` / `remove_file` under allowed subdirs. Actions: `create`, `edit`, `patch`, `delete`, `write_file`, `remove_file`. Uses `skills.agentWritePolicy` (`global` \| `workspace` \| `both`). Bundled skills are not mutable. Writes run through security scanning.

---

## Web extraction

### 🧾 web_extract

Fetches `url` (HTML or JSON), strips boilerplate, and runs an LLM extraction pass. Optional `instruction` (what to focus on) and `maxLength` (default from config or 15000 characters).

**Configuration:** `agents.defaults.webExtract.model` or `XOPC_WEB_EXTRACT_MODEL`.

---

## Communication (media)

### 📎 send_media

Sends a local file to the current conversation. Parameters: `filePath`, optional `mediaType` (`photo` \| `video` \| `audio` \| `document`), optional `caption`. Type may be inferred from the extension.

---

## Vision & image generation

Inbound photos (channels / webchat) are handled in two ways: if the **session model** supports vision (pi-ai metadata or a conservative id heuristic), images are sent **natively** in the user message; otherwise a **vision model** (from `imageModel`, with fallbacks) describes them as text before the main model runs. See [Image & vision](image-multimodal.md).

### 🖼️ image

Analyzes one or more images (paths or URLs) with the resolved vision model. Optional `prompt`. Prefer **not** calling it when the user message already includes images **and** the session model is multimodal.

**Configuration:** `agents.defaults.imageModel` (string or `{ primary, fallbacks }`), `agents.defaults.mediaMaxMb`.

---

### 🎨 image_generate

Generates an image via the configured generation model and saves under `workspace/media/generated/` when successful. Use `action: "list"` to print registered generation providers and model ids.

**Configuration:** `agents.defaults.imageGenerationModel` (string or `{ primary, fallbacks }`).

Programmatic generation supports optional **reference images** (`inputImages`) for OpenAI **edits**; the `image_generate` tool does not expose that parameter yet.

---

## Browser tools (optional)

Registered when `agents.defaults.browser.enabled` is `true`.

| Tool | Role |
|------|------|
| `browser_navigate` | Open an http(s) URL (localhost/private IPs blocked). |
| `browser_snapshot` | ARIA snapshot for the page or a selector. |
| `browser_click` | Click via `selector`, `text`, or `role`. |
| `browser_type` | Type into a field via `selector` or `label`. |
| `browser_scroll` | Scroll the page or element. |
| `browser_screenshot` | Capture viewport or element (size-capped). |

Uses a per-session tab; `agents.defaults.browser.headless` defaults to true when enabled.

---

## Delegation & sandboxed code

### 🤖 delegate_task

Runs a **sub-agent** with a fresh context (no parent transcript) and returns a **summary** only. Parameters: `goal`, optional `context`, optional `toolset` (subset of safe tools), optional `maxIterations` (default 30). Sub-agents cannot use `delegate_task`, `clarify`, messaging, memory tools, `todo`, `cronjob`, or skill management tools.

**Configuration:** `agents.defaults.delegate.enabled`.

---

### 💾 execute_code

Runs JavaScript in a VM with async `tools.*` wrappers for a fixed allowlist (`web_search`, `web_fetch`, `read_file`, `write_file`, `grep`, `find`, `shell`, `skills_list`, `skill_view`) plus `console.log`. Hard limits on wall time (default 30 minutes, max 4 hours), tool calls (50), and stdout/stderr size.

**Configuration:** `agents.defaults.executeCode.enabled`. Disable via `disabledTools` including `execute_code` if needed.

---

## Scheduling (gateway)

### ⏰ cronjob

Manage cron jobs that trigger agent turns: `list`, `create`, `update`, `remove`, `enable`, `disable`, `history`. Create/update require schedule and message; optional `timezone`, `sessionTarget` (`main` \| `isolated`), `name`, `jobId` where applicable.

Only registered when the runtime provides `CronService` (typical gateway deployment).

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
│  → e.g. 🔍 Searching…   │
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
| `web_extract` | searching | 🔍 |
| `shell` | executing | ⚙️ |
| `find` | searching | 🔍 |
| `web_fetch` | searching | 🔍 |
| `image` / `image_generate` | searching | 🔍 |
| `browser_navigate` | executing | ⚙️ |
| `delegate_task` | executing | ⚙️ |
| `execute_code` | executing | ⚙️ |
| `cronjob` | executing | ⚙️ |

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

1. **Use memory tools when relevant**: Call `memory_search` / `memory_get` for workspace `memory/` files; use `session_search` for cross-session history when available; use `curated_memory` only when enhanced curated memory is enabled
2. **Skills discovery**: Prefer `skills_list` and `skill_view` over reading skill paths directly when `skills.promptStyle` is `metadata-only` (default)
3. **Respect limits**: Be aware of truncation limits for large files/outputs
4. **Error handling**: Tools return errors gracefully - agent should handle them
5. **Progress feedback**: Long-running tools automatically show progress
6. **Privileged tools**: Enable `execute_code`, `delegate_task`, and browser tools only when needed; `execute_code` is not a strong sandbox

---

_Last updated: 2026-04-11_
