export const xopcUseManual = `# XOPC Use Tool Manual

## Overview

\`xopc_use\` is the unified tool for operating XOPC product objects. Use it instead of editing storage files or database rows directly.

Basic shape:

\`\`\`json
{
  "mode": "project | note | task | local_app | settings",
  "command": "list | get | create | update | append | preview_edit | resolve_workspace | update_dependencies | action | validate | open",
  "args": { "...": "..." },
  "dryRun": false
}
\`\`\`

## Scope And Tool Routing

\`xopc_use\` owns the product objects in the first five rows below. Other objects are
first-class XOPC objects too, but already have dedicated tools. Do not force them
through \`xopc_use\` or imitate their APIs with file/database edits.

| User intent or object | Correct tool | Notes |
| --- | --- | --- |
| Project | \`xopc_use\` with \`mode: "project"\` | Metadata, workspace resolution, and durable project context. |
| Note | \`xopc_use\` with \`mode: "note"\` | Durable user-owned Markdown content. |
| Task | \`xopc_use\` with \`mode: "task"\` | Durable outcome lifecycle, dependencies, and execution actions. |
| Local app | \`xopc_use\` with \`mode: "local_app"\` | Discover, create, inspect, and validate app records. |
| Settings destination | \`xopc_use\` with \`mode: "settings"\` | Produces a jump target; it does not mutate configuration. |
| Automation | \`automation\` | Recurring, scheduled, webhook, or product-event execution. |
| Workflow run | \`workflow\` | Starts a saved multi-agent workflow in a linked session. |
| Workflow definition | Product workflow editor | Definition CRUD is not exposed through \`xopc_use\`; \`workflow\` only starts runs. |
| Session | \`session_search\` / \`session_status\` | Search or inspect conversation state; continue through the linked chat. |
| Workspace file | \`read_file\`, \`write_file\`, \`apply_patch\` | Use \`create_share\` only when a user-facing share is requested. |
| Memory | \`memory_search\`, \`memory_get\`, \`curated_memory\` | Memory is governed context, not a note substitute. |
| Skill | \`skills_list\`, \`skill_view\`, \`skill_manage\`, \`skill_install\` | Skills change agent capability, not product content. |
| Connected app | \`composio_search\`, then \`composio_execute\` | Discover the exact external action schema before execution. |

### Choose the object before choosing the command

- Use a **note** when the requested result is reference material or user-owned prose.
- Use a **task** when there is an outcome to execute, track, block, resume, or verify.
- Use a **project** when work must retain shared context across multiple tasks, sessions,
  files, or decisions.
- Use an **automation** when execution should recur or be triggered later. A task with a
  due date is not an automation.
- Use a **workflow** when a saved multi-agent procedure should run now. A workflow run
  may be linked to a Task by passing \`taskId\` to the dedicated \`workflow\` tool.
- A note with \`kind: "task"\` is still a note. It does not gain Task lifecycle,
  dependency, execution, or verification behavior.

## Supported Command Matrix

| Mode | Commands | Mutating commands |
| --- | --- | --- |
| \`project\` | \`list\`, \`get\`, \`create\`, \`update\`, \`resolve_workspace\` | \`create\`, \`update\`; \`resolve_workspace\` only when \`autoCreate: true\` creates a project. |
| \`note\` | \`list\`, \`get\`, \`create\`, \`append\`, \`preview_edit\`, \`update\` | \`create\`, \`append\`, \`update\`; \`preview_edit\` is preview-only. |
| \`task\` | \`list\`, \`get\`, \`create\`, \`update_dependencies\`, \`action\` | \`create\`, \`update_dependencies\`, \`action\`. |
| \`local_app\` | \`list\`, \`get\`, \`create\`, \`validate\` | \`create\`; validation does not install or activate. |
| \`settings\` | \`open\` | None; returns a product reference only. |

Unsupported commands must not be guessed. In particular, \`delete\`, project pinning,
note history restore, task contract revision, and local-app installation are not
currently exposed by \`xopc_use\`.

## General Rules

- Use \`list\` or \`get\` first when the target object is ambiguous.
- Use \`dryRun: true\` before a broad or risky change.
- Prefer additive operations over destructive replacement.
- Do not invent ids. If an id is not known, search/list first.
- Do not attempt delete/archive workflows through this tool unless the command is explicitly supported.
- For non-trivial note rewrites, use \`note.preview_edit\` before \`note.update\`.
- Preserve the returned “Open in xopc” link in channel replies so the user can jump directly into the delivered object.

- Load this manual before a non-trivial \`xopc_use\` mutation.
- Send one object command per call. Do not invent batch payloads.
- Inspect the JSON body's \`ok\` field. A completed tool call can still return
  \`{ "ok": false, ... }\` for a product-level failure.
- Treat \`updatedAt\` and \`dueAt\` as Unix epoch milliseconds. Never substitute an ISO
  date string where a numeric timestamp is required.
- Array fields must be arrays of strings. An empty array intentionally clears the
  corresponding collection; omission preserves a value when the command supports patches.
- \`id\` is accepted as an alias on single-object commands, but prefer the explicit
  \`projectId\`, \`noteId\`, \`taskId\`, or \`localAppId\` field in generated calls.

## Reliable Operation Protocol

For any mutation that depends on existing state:

1. **Identify** the object kind using the routing table above.
2. **Resolve** the exact object with \`list\` when the id is unknown, then \`get\` it.
3. **Check** current status, project scope, revision/timestamp, and user authority.
4. **Preview** with \`dryRun: true\` for broad project changes or destructive-looking
   replacements. For note rewrites, use \`preview_edit\` instead.
5. **Mutate once** with the exact id and latest concurrency token when required.
6. **Verify** from the returned object. Call \`get\` again if downstream behavior or a
   conflict makes the final state uncertain.
7. **Deliver** the product link and report pending approval, dependency waiting, or
   other non-terminal state accurately.

Do not blindly retry create operations after a timeout or uncertain response. Search
for the intended object first so a retry does not create a duplicate.

## Projects

Projects group sessions, Tasks, workflows, files, and project instructions.

Project statuses are \`active\`, \`paused\`, and \`archived\`. List sorting supports
\`updatedAt\`, \`createdAt\`, or \`name\`, with \`asc\` or \`desc\` order.

### Find projects

\`\`\`json
{ "mode": "project", "command": "list", "args": { "search": "release", "limit": 10 } }
\`\`\`

### Read project detail

\`\`\`json
{ "mode": "project", "command": "get", "args": { "projectId": "project_id" } }
\`\`\`

### Create a project

Use when the user asks to keep a task moving across conversations, or explicitly accepts an offer to do so. The user does not need to say “project”. Do not create one merely because a task is complex: continuity across sessions, files, decisions, or dependencies is the key signal. Include \`workspaceRoot\` when the work maps to a local repository or directory. Include \`brief\` for the desired outcome and \`instructions\` only for durable operating guidance.

\`\`\`json
{
  "mode": "project",
  "command": "create",
  "args": {
    "name": "AI Product Research",
    "workspaceRoot": "/path/to/repo",
    "brief": "Explore demand and feasibility for an AI product.",
    "instructions": "Keep decisions and open questions current."
  }
}
\`\`\`

### Update a project

Use for metadata, brief, status, or instructions. Use \`dryRun\` first when changing \`workspaceRoot\` or broad instructions.

\`\`\`json
{
  "mode": "project",
  "command": "update",
  "args": {
    "projectId": "project_id",
    "status": "active",
    "instructions": "Prioritize safe previews before changing notes."
  }
}
\`\`\`

### Resolve workspace

Use when a file path or current working directory should be mapped to a project.
Keep \`autoCreate: false\` for discovery. Set it to \`true\` only when project creation is
already authorized; otherwise a lookup can unexpectedly become a mutation.

\`\`\`json
{
  "mode": "project",
  "command": "resolve_workspace",
  "args": { "workspacePath": "/path/to/repo", "autoCreate": false }
}
\`\`\`

## Notes

Notes are user-owned markdown objects. Treat them as durable user content.

Kinds are \`thought\`, \`todo\`, \`voice\`, \`media\`, \`bookmark\`, \`mixed\`, and \`task\`.
Statuses are \`inbox\`, \`processed\`, \`archived\`, and \`trashed\`. A status change is not
deletion. List sorting supports \`createdAt\`, \`updatedAt\`, or \`lastOpenedAt\`.
For \`list\` and \`create\`, an explicit \`projectId\` selects the project. When omitted,
the current session project is inherited when available.

### Find notes

\`\`\`json
{ "mode": "note", "command": "list", "args": { "search": "pricing", "limit": 10 } }
\`\`\`

### Create a note

Pass \`projectId\` when the target project is explicit. From a project-linked chat it
may be omitted; XOPC creates the same formal Note → Project relationship.

\`\`\`json
{
  "mode": "note",
  "command": "create",
  "args": {
    "title": "Product direction",
    "markdown": "Initial notes...",
    "tags": ["product"],
    "projectId": "project_id"
  }
}
\`\`\`

### Append to a note

Prefer append when preserving original user notes and adding AI output.

\`\`\`json
{
  "mode": "note",
  "command": "append",
  "args": {
    "noteId": "note_id",
    "heading": "AI synthesis",
    "content": "Key points..."
  }
}
\`\`\`

### Preview an edit

Use before rewriting or restructuring a note.

\`\`\`json
{
  "mode": "note",
  "command": "preview_edit",
  "args": {
    "noteId": "note_id",
    "instruction": "Summarize this as action items"
  }
}
\`\`\`

### Update a note

Use only when the user clearly wants the canonical note changed. Prefer \`append\` or \`preview_edit\` otherwise.

\`\`\`json
{
  "mode": "note",
  "command": "update",
  "args": {
    "noteId": "note_id",
    "status": "processed",
    "tags": ["product", "validated"]
  }
}
\`\`\`

When replacing \`markdown\`, first read the current note and preserve content the user
did not ask to remove. \`preview_edit\` creates a proposed patch but does not apply it;
there is no \`apply_preview\` command, so an approved result must be applied with an
explicit \`update\`.

## Tasks

Tasks are durable outcomes that xopc can plan, execute, and verify. They replace the
legacy WorkItem model. New tasks are captured in \`pending\` state by default; start
them immediately only when the user explicitly asks xopc to begin execution.

### Find tasks

\`projectId\` is optional. When omitted, the current session project is used when available.
This contextual default is intentional. From a project-linked chat, omission does not
mean “all projects”. Status filters accept \`pending\`, \`planning\`,
\`waiting_dependency\`, \`running\`, \`verifying\`, \`needs_user\`, \`blocked\`, \`paused\`,
\`completed\`, or \`cancelled\`; priorities are \`low\`, \`normal\`, \`high\`, and \`critical\`.

\`\`\`json
{ "mode": "task", "command": "list", "args": { "projectId": "project_id", "status": "pending", "limit": 20 } }
\`\`\`

### Read task detail

The result includes the task plus its dependencies and dependents.

\`\`\`json
{ "mode": "task", "command": "get", "args": { "taskId": "task_id" } }
\`\`\`

### Capture a task

\`createMode\` defaults to \`capture\`. Use \`start\` only when immediate execution is
part of the user's request. Optional contract fields include \`expectedOutputs\`,
\`acceptanceCriteria\`, \`constraints\`, \`approvalRequired\`, \`assumptions\`, and \`risks\`.
Use a numeric epoch-millisecond \`dueAt\`. When the current chat belongs to a project,
the new task inherits that project unless an explicit \`projectId\` is supplied.

\`\`\`json
{
  "mode": "task",
  "command": "create",
  "args": {
    "objective": "Complete the customer research report",
    "projectId": "project_id",
    "createMode": "capture",
    "priority": "high",
    "dependsOnTaskIds": []
  }
}
\`\`\`

### Update dependencies

Read the task first and pass its current \`updatedAt\` as \`expectedUpdatedAt\`.

\`\`\`json
{
  "mode": "task",
  "command": "update_dependencies",
  "args": {
    "taskId": "task_id",
    "dependsOnTaskIds": ["dependency_task_id"],
    "expectedUpdatedAt": 1760000000000
  }
}
\`\`\`

### Advance task state

Supported actions are \`run\`, \`pause\`, \`resume\`, \`verify\`, and \`cancel\`.
Always use the latest \`updatedAt\`; a stale value is rejected instead of overwriting
newer state. Supply \`approvedBoundaries\` only after the user has approved them.

Action guidance:

- \`run\`: start a captured \`pending\` Task.
- \`pause\`: stop active planning, running, or verification without cancelling the Task.
- \`resume\`: continue a paused/blocked/user-waiting Task when its blocker is resolved.
- \`verify\`: request verification only from a state where verification is valid.
- \`cancel\`: terminal cancellation; do not use it as a substitute for pause.

If an action returns \`approval_required\`, show the returned required boundaries and
wait for explicit approval. Then read the Task again and submit only the boundaries
the user approved. If it returns \`waiting_dependency\`, do not repeatedly call \`run\`;
report the blocking Tasks and wait for them to complete.

\`\`\`json
{
  "mode": "task",
  "command": "action",
  "args": {
    "taskId": "task_id",
    "action": "run",
    "expectedUpdatedAt": 1760000000000
  }
}
\`\`\`

## Local Apps

Local apps are first-class XOPC extension UIs backed by a project workspace.

\`\`\`json
{
  "mode": "local_app",
  "command": "create",
  "args": {
    "name": "Research Hub",
    "idea": "Keep product research sources and decisions together.",
    "description": "A compact local research workspace."
  }
}
\`\`\`

Use \`list\`, \`get\`, and \`validate\` to inspect an existing app. Installation,
activation, rollback, and uninstall remain explicit product UI operations because
they change the extension runtime.

## Settings

Use settings references when the user must review credentials, privacy, gateway,
appearance, agent browser, or another configuration surface. This does not change
configuration silently; it returns an exact inline jump target.

\`\`\`json
{
  "mode": "settings",
  "command": "open",
  "args": {
    "section": "credentials",
    "title": "Provider credentials",
    "summary": "Add the API key required by the selected model."
  }
}
\`\`\`

## Safety

- \`note.update\` can replace canonical user content. Use \`preview_edit\` first for content rewrites.
- \`project.update.workspaceRoot\` changes project-file scope. Use \`dryRun\` and ask the user if intent is unclear.
- \`task.create\` defaults to capture. Do not use \`createMode: \"start\"\` unless immediate execution is intended.
- Task actions use optimistic concurrency. Read the task again after a conflict instead of retrying with a stale timestamp.
- If the user asks for deletion, explain that deletion is not exposed through \`xopc_use\` yet.

## Error Recovery

| Result | Correct recovery |
| --- | --- |
| \`Service is unavailable\` | Do not retry in a loop. Explain that the capability is unavailable in this runtime or use the dedicated tool listed in the routing table. |
| \`not found\` | Re-list in the intended project/scope; do not guess a replacement id. |
| \`conflict\` / “Task changed” | Call \`task.get\`, inspect the latest state, then decide whether the original intent still applies before using the new \`updatedAt\`. |
| \`approval_required\` | Present the exact required boundaries and wait for user approval. Never infer approval from the original task request. |
| invalid task state | Read the Task and choose an action valid for its current state; do not force a status with storage edits. |
| dependency cycle or invalid dependency | Read dependencies/dependents, correct the graph, and resubmit once with the latest \`updatedAt\`. |
| unsupported command | Use the dedicated tool or product UI from the routing table; do not synthesize an undocumented command. |

## Known Capability Gaps

These are real product capabilities visible elsewhere in XOPC but not yet exposed by
\`xopc_use\`. Treat them as roadmap gaps, not undocumented commands:

- **Task:** revise objective/contract, priority, due date, or execution context after
  creation; inspect receipts/context manifest/metrics; configure project monitoring.
- **Project:** pin/unpin, manage linked sessions and project goals, inspect operating
  view/activity, and project-scoped file operations.
- **Note:** delete, move, toggle completion, restore history, media management,
  catalysis, discussion threads, and note-to-Task conversion.
- **Local app:** update metadata and perform install/activate/rollback/uninstall.
- **Workflow definition/run:** definition CRUD, validation/drafting, run listing,
  cancellation, and comparison. Starting a run is already covered by \`workflow\`.
- **Session product actions:** rename, pin, archive, reset, fork, and export are not
  owned by \`xopc_use\`.

Prioritize future additions that preserve domain validation, optimistic concurrency,
activity attribution, and product delivery links. Do not expose raw repository writes
merely to make the command matrix larger.
`;
