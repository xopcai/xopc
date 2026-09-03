# Session context summary

The chat header owns one context entry point. Its anchored panel groups current work
(project and active execution task), Note sources, and the local execution environment.
The former project/task scope strips and standalone workspace header label are removed.
Task progress cards, historical message references, and embedded-chat affordances remain.

`GET /api/sessions/:key/context-summary` is a read-only metadata query. It requires
`sessions.read`; project, Note and environment fields additionally require
`workspace.read`, and task fields/references require `tasks.read`. Missing sections
are explicit, and responses use `Cache-Control: no-store`.

- Sources are deduplicated by Note ID, preserve source provenance/version, and are
  limited to 20 items with an overflow indicator. Missing or trashed Notes never
  fall back to stored edge titles. No Note body, transcription, prompt or credentials
  are returned; opening the panel never prepares Note context or starts an agent.
- The active task comes from the execution-session binding, not project membership.
- Workspace resolution follows the actual session environment binding. A missing
  bound directory is unavailable, not a reason to use the project checkout.
  Git reads are bounded and report live branch/HEAD; there are no Git write actions.
- The chat page owns the existing composer Note-reference state. The composer and
  header share it; pending sources do not create another persisted context store.
- SWR keys include session and gateway identity. The panel closes on session switch,
  refreshes on opening, and listens for relevant updates while open. Closed panels
  do not poll. Blank chats can display draft project/Note context without a session read.

These are **current associations**, not proof of what a model received or read.
Request-level context auditing, context management, remote execution, and token-usage
percentages are outside this implementation.
