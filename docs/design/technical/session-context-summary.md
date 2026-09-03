# Session context summary

The chat header keeps an icon-only file browser directly accessible alongside
an icon-only context entry point. Its animated anchored panel groups the local execution
environment, current work (project and active execution task), and Note sources.
Before the first message, an inset context bar sits above the rounded composer.
It offers searchable project selection/removal, branch information, and a folder
picker for unscoped chats. Project-owned folders remain
locked until the project is removed. Project changes retain the draft, attachments
and pending Note references; context changes are disabled during saves, sends and
session transitions. The former page-level project/task scope strips are removed.
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
