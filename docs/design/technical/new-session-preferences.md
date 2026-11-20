# New-session preferences

New-session behavior is a client-owned convenience. The gateway stores only the resolved session metadata and per-session agent configuration; it does not store a user's future-session preference.

## Resolution rules

Clients resolve one `NewSessionIntent` before creating a session:

1. An explicitly selected project or explicit no-project scope wins.
2. A new chat started inside a chat inherits that chat's project and agent.
3. A generic new-chat entry uses the last opened chat scope and selected agent.
4. A project entry uses the project's default agent unless the entry explicitly names an agent.
5. Model and thinking preferences are keyed by agent. Opening an existing chat never overwrites them; an explicit model or thinking change does.
6. New project conversations use the project directory by default. Previously saved project or browser environment preferences do not change this default.

Web stores the versioned preference in `localStorage`. Mobile stores it in MMKV, isolated by gateway profile. TUI stores it in `tui-settings.json`, isolated by local/remote gateway identity.

## Creation contract

`POST /api/sessions` accepts `initialAgentConfig` with `model` and `thinkingLevel`. The gateway applies this configuration before returning the created session. This prevents an immediate first message from using the agent default accidentally.

Project removal is explicit: clients create a new session with no `projectId`; metadata patching uses `projectId: null` when detaching an existing empty shell.

Empty-shell reuse and in-flight request coalescing are client concerns. Cache identity includes gateway, agent, and project scope; forced and temporary creation are not coalesced with reusable creation.

## Project directory

Web project-page, sidebar, and chat project entries use `/chat/new`. For a project with a configured workspace, the composer checks the directory on the Gateway host and creates a local session draft when the user first sends or opens a session resource. Projects without a fixed workspace use the ordinary chat flow.

`GET /api/projects/:projectId/environment-options?mode=local_checkout` checks only directory availability. Explicit Worktree flows can use the full preflight to check Git history and uncommitted changes.

The first input includes the resolved session configuration. When a client omits an execution mode for a project with a workspace, the Gateway binds the project directory before running the first input. The input, attachments, and note references are consumed when submission is accepted. Navigation away or a change of Gateway credentials cancels pending client handoff.

Existing sessions display their bound environment. Implementation delegation creates a separate Worktree from a Git commit. Explicit Worktree requests remain available through environment management.

While a project chat is being prepared, the composer resolves the agent's remembered model or effective default and displays its supported effort. Model and effort changes stay in the draft and are sent with its session configuration. Successful creation remembers explicit edits.

## Concrete chat model selection

The chat composer always shows a concrete provider/model and its supported thinking level. There is no default or automatic-model entry. On chat creation (or first idle access to an older chat), the gateway resolves the selection and persists it with `fixed_model = 1`. A remembered model that is no longer available stays selected and visible so the user can replace it explicitly.

`GET /api/models` exposes `thinking` capabilities derived from the runtime model metadata. Custom models can declare `thinkingLevelMap` in `models.json`. The composer renders explicit levels, a binary control, or no control as appropriate. The current runtime has no supported adaptive effort value, so the picker does not offer one.

Clients remember effort choices per model within each agent's preference. Changing models restores that model's remembered supported effort, otherwise retains the current supported effort, otherwise uses the provider capability's concrete initial value. Only successful writes update preferences.

Chat configuration PATCH requests return the resolved configuration and `configVersion`. The version is the session configuration's monotonically increasing SQLite `updated_at`. Model and effort are validated before a single configuration write. Chat configuration writes and input acceptance share a session lock; stale versions are rejected, and a conversation with active or queued input cannot change model configuration. Input requests carry the displayed version. Failed runtime synchronization evicts the agent so the committed configuration is hydrated before the next turn.

Fixed chat models do not use cross-model fallback. Provider errors keep the selected identity intact. Successful embedded turns append an `xopc.model-selection` audit entry containing the run ID and actual model/effort through the guarded transcript manager. Background sessions without a fixed chat selection retain their configured fallback behavior.
