# Built-in tools

This page lists tools the xopc agent can call: read and edit files, run commands, search the web, talk to channels, manage skills, and more. Which tools are registered depends on your **config**, optional **features** (memory, browser, TTS), whether a **gateway** is running (e.g. `clarify`, `automation`), and **extensions** (extra tools from installed extensions).

---

## Availability at a glance

| Area | Tools |
|------|-------|
| Planning & clarification | `clarify`, `todo` |
| Skills | `skills_list`, `skill_view`, `skill_manage` |
| Tool manuals | `tool_manual` for built-in complex tool guides |
| Workspace files | `read_file`, `write_file`, `edit_file`, `list_dir` |
| Search in repo | `grep`, `find` |
| Shell | `shell` |
| Web | `web_search`, `web_fetch`, `web_extract` |
| Messaging & media | `send_message`, `send_media` |
| Voice (optional) | `text_to_speech` — when TTS is enabled in config |
| Memory (optional) | `memory_search`, `memory_get`; `session_search` when configured |
| Images (optional) | `image`, `image_generate` when models and keys are set |
| Browser (optional) | `browser_use`; `browser_recipe` for saved [Browser automations](browser-workflows.md) |
| Delegation & code (optional) | `delegate_task`, `execute_code` |
| Multi-agent orchestration | `workflow` — fan-out subagents via a deterministic JS script. See [Dynamic Workflows](workflows.md). |
| Automations (optional) | `automation` — when the runtime exposes the automation service (typical gateway setup) |
| External tools | `xopc_tool_search`, `xopc_tool_describe`, `xopc_tool_execute` — federates MCP, Composio, extension, and remote-memory tools without injecting their schemas |

Extensions may add tools to the external catalog, but not to the model-visible tool list.

**MCP tools:** Cataloged on demand from `mcp.servers`. Installed Connectors materialize their managed server there; Extensions may declare `connectorDependencies` but cannot inject MCP configuration. Agent policy can still deny a server or a stable tool policy id. See [MCP](mcp.md).

**Conditionally enabled:** Some capabilities need explicit settings or agent policy: e.g. `session_search` needs session persistence; `web_extract` can use `XOPC_WEB_EXTRACT_MODEL`; skills write policy is `skills.agentWritePolicy`; skill discovery can be gated with `skills.toolGating` and metadata. For skills CLI (`xopc skills hub …`), see [Skills](skills.md).

---

## Filesystem

### `read_file`

Reads a file. Output is capped (default up to 500 lines / 50KB).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `limit` | number | no | Max lines (default: 500) |

```json
{
  "name": "read_file",
  "arguments": { "path": "src/index.ts", "limit": 100 }
}
```

### `write_file`

Creates or overwrites a file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `content` | string | yes | Full file content |

```json
{
  "name": "write_file",
  "arguments": {
    "path": "src/new-file.ts",
    "content": "export const hello = 'world';"
  }
}
```

### `edit_file`

Replaces an exact substring. `oldText` must match the file exactly (including whitespace).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `oldText` | string | yes | Text to replace |
| `newText` | string | yes | Replacement |

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

### `list_dir`

Lists entries in a directory (default: workspace root).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | no | Directory path |

```json
{
  "name": "list_dir",
  "arguments": { "path": "src/components" }
}
```

---

## Search (`grep`, `find`)

### `grep`

Text search using ripgrep.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Pattern (regex unless `literal`) |
| `glob` | string | no | e.g. `*.ts` |
| `path` | string | no | Root directory |
| `ignoreCase` | boolean | no | Case-insensitive |
| `literal` | boolean | no | Plain text |
| `context` | number | no | Context lines |
| `limit` | number | no | Max hits (default: 100) |

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

### `find`

Finds files by name pattern.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Glob-style filename pattern |
| `path` | string | no | Search root |
| `limit` | number | no | Max results |

```json
{
  "name": "find",
  "arguments": { "pattern": "*.test.ts", "path": "src", "limit": 20 }
}
```

---

## `shell`

Runs a shell command under workspace constraints. Stdout/stderr are truncated (e.g. last 50KB).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Command line |
| `timeout` | number | no | Seconds (default: 300) |
| `cwd` | string | no | Working directory |

Default timeout 5 minutes; execution is restricted to the workspace.

```json
{
  "name": "shell",
  "arguments": { "command": "git log --oneline -10", "timeout": 60 }
}
```

After **`skill_view`**, environment variable **names** declared in the skill can be registered for the session; **`shell`** may expose matching variables from the process (values are not shown to the model).

---

## Web

### `web_search`

Uses configured providers (`tools.web.search.providers`), then falls back to region-based HTML search if needed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `count` | number | no | Max results (default from `tools.web.search.maxResults`) |

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

### `web_fetch`

Fetches a URL and returns page content for the agent (HTTP client; timeouts apply).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL |
| `timeout` | number | no | Seconds (default: 30) |

### `web_extract`

Fetches HTML or JSON, reduces boilerplate, then runs a configured extraction model to return markdown-oriented output. Optional `instruction` and `maxLength` (default from config or about 15000 characters). Very large pages are processed in **chunks** so extraction can complete without loading the entire document into one model call (internal size limits still apply).

**Config:** `XOPC_WEB_EXTRACT_MODEL` when you need to force a specific extraction model.

---

## Messaging

### `send_message`

Sends a message on a configured channel.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | yes | e.g. `telegram` |
| `chat_id` | string | yes | Target chat |
| `content` | string | yes | Message body |
| `accountId` | string | no | Multi-account id |

### `send_media`

Sends a **local** file to the current conversation context: `filePath`, optional `mediaType` (`photo` | `video` | `audio` | `document`), optional `caption`. Type may be inferred from the extension.

### `text_to_speech` (optional)

Present when TTS is enabled. Sends synthesized voice suitable for read-aloud; prefer normal text replies unless voice is appropriate. See [tts](configuration.md#tts) in the configuration reference and [Voice (STT/TTS)](voice.md) for channel behavior.

---

## Memory

### `memory_search`

Searches indexed memory sources. Use it when answers should use stored notes, prior decisions, preferences, or todos.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `limit` | number | no | Max results (default: 10) |

### `memory_get`

Loads one structured memory record returned by `memory_search`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Stable memory record id |

### `session_search`

Searches other sessions’ transcripts (keyword or semantic-style query; optional per-session summaries). Requires SQLite session persistence. Set `XOPC_SESSION_SEARCH_MODEL` when you need to force the model used for per-session summaries.

See [Session management](session.md) and [Configuration](configuration.md).

---

## Planning & clarification

### `clarify`

Asks the user a question and waits for a reply. Optional `choices` (2–10) for multiple choice; optional `default` if the user does not answer or the UI cannot prompt.

Works interactively on **web** chat, **Telegram**, or **CLI** when wired; otherwise returns guidance and may use `default`.

### `todo`

Per-session task list: items with `id`, `content`, `status` (`pending` | `in_progress` | `completed` | `cancelled`). `merge: true` upserts by `id`; `merge: false` or omit replaces the list. Omit `todos` to read the current list.

---

## Skills

### `skills_list`

Lists skills available for the session (name, description, source), respecting allowlists and tool gating. Optional `query` filters by substring on name/description.

### `skill_view`

Loads `SKILL.md` or a path under `references/`, `templates/`, `scripts/`, or `assets/`. Parameters: `name`, optional `path`, optional `limit` (lines, default 500). Registers declared env var **names** for passthrough into `shell`. Respects `skills.limits.maxSkillFileBytes` and disabled/gated skills.

Use `skills_list` / `skill_view` to load skill bodies; do not read skill disk paths directly from `<available_skills>` or bypass those tools.

### `skill_manage`

Creates, edits, patches, deletes skills, or `write_file` / `remove_file` under allowed directories. Actions include `create`, `edit`, `patch`, `delete`, `write_file`, `remove_file`. Controlled by `skills.agentWritePolicy` (`global` | `workspace` | `both`). Bundled skills are not mutable. Writes are scanned.

Skills can include `disable-model-invocation` so the skill stays on disk but is omitted from model-facing lists. Hub installs: `xopc skills hub pull|update|lock` — see [Skills](skills.md).

---

## Vision & image generation

Inbound images: if the **session model** supports vision, images are passed in the user message; otherwise a **vision** model (`imageModel`, with fallbacks) may describe them as text first. See [Image & vision](image-multimodal.md).

### `image`

Analyzes images (paths or URLs) with the resolved vision model. Optional `prompt`. Often unnecessary when the user already attached images and the session model is multimodal.

Image understanding is resolved from the selected agent/runtime image capability settings and configured providers. Use `xopc image status` to inspect current behavior.

### `image_generate`

Generates an image and saves under `workspace/media/generated/` on success. `action: "list"` lists available generation providers/models.

Generation provider availability is discovered at runtime from configured providers. Use `xopc image providers` to inspect available options.

Programmatic generation may support reference images for some providers; the `image_generate` tool surface may not expose every option.

---

## Browser (optional)

Registered when browser automation is enabled by config and allowed by the selected agent manifest. The local
browser runtime is optional:

```bash
npm install playwright-core@1.60.0
npx playwright-core install chromium
```

Add `-g` to the install command when xopc itself is installed globally.

| Tool | Purpose |
|------|---------|
| `browser_use` | Operates the browser with actions such as opening pages, inspecting content, clicking, typing, scrolling, taking screenshots, and waiting for page changes. For complex tasks, call `tool_manual({ tool: "browser_use" })` first. |
| `browser_recipe` | Saves, lists, runs, pauses, and updates reusable [Browser automations](browser-workflows.md) when the Gateway provides the browser automation service. |

To disable browser automation for an agent, set the selected agent manifest's `tools.builtin.browser_use.mode` to `"deny"` or omit browser access from the relevant capability preset.

**URL policy:** Navigation rejects URLs that embed credentials, target **cloud metadata / IMDS** hosts and link-local ranges (always, even if private URLs are allowed), or contain patterns that look like **API keys or tokens** in the query (anti-exfiltration). Top-level `browser.allowPrivateUrls` relaxes private-IP blocking only; metadata and suspicious token patterns remain blocked.

**Backends:** top-level `browser.backend` selects the browser backend (`local`, `cdp`, `cloud`, `extension`, or `cloakbrowser`). Optional `browser.cdpUrl` connects directly to a CDP WebSocket. Per-command timeouts use `browser.commandTimeout` (seconds). **Dialogs:** `browser.dialogPolicy` (`must_respond` \| `auto_dismiss` \| `auto_accept`) and `browser.dialogTimeoutSeconds` interact with the CDP supervisor.

Uses a per-session tab; `browser.headless` controls whether local browser runs show a visible window.

---

## Delegation & sandboxed code (optional)

### `delegate_task`

Runs a **sub-agent** with a fresh context (no parent transcript) and returns a **text summary** only. Parameters include `goal`, optional `context`, optional `toolset` (subset of allowed tools), optional `maxIterations` (default 30). Sub-agents cannot use nested `delegate_task`, `clarify`, outbound messaging, memory tools, `todo`, `automation`, or skill management.

Availability is controlled by the selected agent manifest and capability presets.

### `execute_code`

Runs JavaScript in a VM with `tools.*` wrappers for an allowlisted set (`web_search`, `web_fetch`, `read_file`, `write_file`, `grep`, `find`, `shell`, `skills_list`, `skill_view`) plus `console.log`. Wall clock, tool-call count, and stdout/stderr sizes are capped.

Availability is controlled by the selected agent manifest and capability presets. Not a strong security boundary (`node:vm`); enable only with trusted models and environments.

---

## Scheduling (gateway)

### `automation`

Lists and manages product automations: `list`, `create`, `update`, `delete`, `run`, `pause`, `resume`, `history`. Create/update use the same structured payloads as `/api/automations`: one trigger (`manual`, `schedule`, or `webhook`) and one action (`agent` instruction or `workflow` run). Scheduled triggers may use `once`, `interval`, or cron-expression schedules.

Only registered when the runtime provides the automation service (normal for gateway deployments).

---

## Limits (typical)

| Operation | Limit |
|-----------|-------|
| File paths | Workspace-scoped |
| Shell | 5 min timeout; output truncated (~50KB) |
| File read | Lines/bytes capped (e.g. 500 lines / 50KB) |
| File size | Large reads rejected (e.g. max ~10MB) |

Exact numbers can vary slightly by version; treat this table as order-of-magnitude.

---

## Progress feedback

Long-running tools emit progress stages so UIs and channels (e.g. Telegram) can show status. Example mapping:

| Tool | Stage label (concept) | Icon (UI) |
|------|------------------------|-----------|
| `read_file` | reading | 📖 |
| `write_file` / `edit_file` | writing | ✍️ |
| `grep` / `find` / `web_*` | searching | 🔍 |
| `shell` / browser / `delegate_task` / `execute_code` / `automation` | executing | ⚙️ |

Configure verbosity under `progress` in config (e.g. `level`, `streamToolProgress`, `heartbeatEnabled`). Details: [Progress feedback](progress.md).

---

## Notes for operators

- **Privileged tools:** Treat `execute_code`, `delegate_task`, and browser tools as elevated capability; enable only where appropriate.
- **Skills:** Writes follow `skills.agentWritePolicy`; `skill_view` respects `skills.limits.maxSkillFileBytes`.
- **Memory plugins:** Implementations may register extra tools via `MemoryManager.getAdditionalTools()`.

---

_Last updated: 2026-05-08_
