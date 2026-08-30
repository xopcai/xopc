# New-session preferences

New-session behavior is a client-owned convenience. The gateway stores only the resolved session metadata and per-session agent configuration; it does not store a user's future-session preference.

## Resolution rules

Clients resolve one `NewSessionIntent` before creating a session:

1. An explicitly selected project or explicit no-project scope wins.
2. A new chat started inside a chat inherits that chat's project and agent.
3. A generic new-chat entry uses the last opened chat scope and selected agent.
4. A project entry uses the project's default agent unless the entry explicitly names an agent.
5. Model and thinking preferences are keyed by agent. Opening an existing chat never overwrites them; an explicit model or thinking change does.

Web stores the versioned preference in `localStorage`. Mobile stores it in MMKV, isolated by gateway profile. TUI stores it in `tui-settings.json`, isolated by local/remote gateway identity.

## Creation contract

`POST /api/sessions` accepts `initialAgentConfig` with `model` and `thinkingLevel`. The gateway applies this configuration before returning the created session. This prevents an immediate first message from using the agent default accidentally.

Project removal is explicit: clients create a new session with no `projectId`; metadata patching uses `projectId: null` when detaching an existing empty shell.

Empty-shell reuse and in-flight request coalescing are client concerns. Cache identity includes gateway, agent, and project scope; forced and temporary creation are not coalesced with reusable creation.
