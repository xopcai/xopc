# Web chat session semantics

Contract for gateway console chat (`web/`). Phase 2 uses a per-session Zustand store + singleton run manager; product rules below are unchanged.

## Product rules

| User action | Client behavior | Agent run |
|-------------|-----------------|-----------|
| **New chat** | Prefer reusing an existing **empty** webchat session for the same agent (no `POST` when reusing). If none exists, use optimistic client key + background `POST /api/sessions` with `chat_id`. `/new` forces a fresh session (always create). | Runs on other sessions **continue** in the background. |
| **First message title** | Provisional title from first user line (optimistic in UI + server on accept). LLM may refine after turn. | — |
| **Switch session** (sidebar / URL) | Clear **visible** UI for the new key; load history from REST. | Do **not** abort SSE for the session being left. |
| **Abort** (composer stop) | Clear streaming UI for current session. | `POST /api/agent/abort` + client abort. **Only** user-initiated abort stops the run. |
| **Refresh** on `/chat/:key` | Load history; resume SSE if gateway reports an active run. | Resume uses gateway `GET /api/sessions/:key/run` first, then `sessionStorage` cache. |

## Sources of truth

| Data | Authority |
|------|-----------|
| Messages + pagination | `useChatSessionStore` per-session slice (`messages`, `hasMore`) |
| In-flight streaming UI | Same slice (`streamingMsg`, `progress`, `sending`, `streaming`) |
| Active run id | Gateway `GET /api/sessions/:key/run` (preferred), `sessionStorage` (cache) |
| SSE POST/resume | `chatRunManager.sender` (singleton) |
| Visible session | URL route param (`/chat/:key`). `/chat/new` is not a session. |
| Sidebar run dots | `isSessionAgentRunActive` (store slice + pending run + HTTP SSE) |
| Session metadata | Per-session slice (`name`, `model`, `thinkingLevel`, …) |
| Focused shell UI | Store shell (`focusedSessionKey`, `initLoading`, `loadingMore`, `shellError`) |

## UI isolation

- **`focusedSessionKey`** = decoded route key (null on `/chat/new`).
- SSE / resume update **`useChatSessionStore`** for any session.
- Focused view **subscribes** to the store slice for `focusedSessionKey`; no direct `setState` from SSE callbacks.
- **`selectDisplayMessages`** reads the focused session slice (`messages` + optional `streamingMsg`).

## Do not

- Abort or clear pending run when opening New chat or switching sessions.
- Add new reconcile/fallback merge paths across sessions (Phase 2 replaces with store).

## Phase 2 (implemented)

Per-session Zustand slice + singleton `chatRunManager`; SSE callbacks write to the store only.

## Phase 3 (implemented)

- Committed messages and `hasMore` live in the store (no hook `useState` for messages).
- Switching sessions reads the cached slice instantly when already loaded.
- Sidebar run indicator uses `isSessionAgentRunActive` (background sessions included).

## Phase 4 (implemented)

- Session metadata (`name`, `model`, `thinkingLevel`, `reasoningLevel`, `modelSupportsThinking`) in the store slice.
- Chat shell state (`focusedSessionKey`, `initLoading`, `loadingMore`, `shellError`) in the same store.
- `useChatSessionRoute` syncs URL → `focusedSessionKey`; `useChatSession` is a thin selector/composer.
- Removed deprecated `chat-agent-run-indicator-store`.

## Phase 5 (implemented)

- New chat resolves a reusable empty webchat shell per agent (client cache + `loadSessions`) before optimistic create.
- `/new` uses `forceNew` (always optimistic `POST` with client `chat_id`).
- Sidebar list cache: `webchat-empty-shell-cache` updated on each `SessionManager.loadSessions()`.

## Phase 6 (implemented)

- **Provisional title:** first user message first line → session `name` immediately (client optimistic + server on `user_message` SSE path).
- **Refined title:** after turn persist, optional LLM short title when `customData.titleSource` is unset or `provisional`.
- **User rename:** sets `titleSource: user`; auto-title never overwrites.
- **Sidebar:** `session-updated` with `{ key, name }` patches SWR cache without full list refetch; gateway SSE `session.updated` carries `name`.
