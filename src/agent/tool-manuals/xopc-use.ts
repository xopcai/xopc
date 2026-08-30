export const xopcUseManual = `# XOPC Use Tool Manual

## Purpose

\`xopc_use\` operates first-class XOPC product objects without editing SQLite or product files directly.
Load this manual before a non-trivial mutation.

\`\`\`json
{
  "mode": "project | automation | note | task | task_run | local_app | settings",
  "command": "...",
  "args": {},
  "dryRun": false
}
\`\`\`

Send one object command per call. Inspect the returned JSON \`ok\` field; a tool call can
complete successfully while the product command returns \`ok: false\`.

## Object routing

| Object | Tool |
| --- | --- |
| Project, milestone, project update | \`xopc_use\` mode \`project\` |
| Automation | \`xopc_use\` mode \`automation\` |
| Task intent and lifecycle | \`xopc_use\` mode \`task\` |
| Task execution attempt, receipt, events and waits | \`xopc_use\` mode \`task_run\` |
| Note | \`xopc_use\` mode \`note\` |
| Local app | \`xopc_use\` mode \`local_app\` |
| Settings jump target | \`xopc_use\` mode \`settings\` |
| Workflow run | dedicated \`workflow\` tool; pass \`taskId\` to link it to a Task |
| Session, memory, skill, connected app or workspace file | its dedicated tool |

Do not emulate Workflow APIs through \`xopc_use\`. A Task is durable intent;
a TaskRun is one execution attempt; a WorkflowRun is a procedure execution and may belong
to a TaskRun. Never treat these three objects as interchangeable.

## Reliable protocol

1. Use \`list\` then \`get\` when an id is unknown.
2. Read the current \`version\` before a Task mutation.
3. Use \`dryRun: true\` for broad Project changes or uncertain mutations.
4. Mutate once with the exact id and current concurrency token.
5. Verify the returned object and preserve any “Open in xopc” delivery link.
6. On a conflict, read again and reconsider the operation; do not blindly retry.

Timestamps are Unix epoch milliseconds. Array fields are arrays of strings. Omission
preserves a patchable field; an empty array intentionally clears it. Prefer explicit
\`projectId\`, \`taskId\`, \`runId\`, \`noteId\`, and \`localAppId\` fields over \`id\`.

## Projects

Commands: \`list\`, \`get\`, \`create\`, \`update\`, \`resolve_workspace\`,
\`list_milestones\`, \`create_milestone\`, \`update_milestone\`, \`list_updates\`,
and \`create_update\`.

Project statuses: \`planned\`, \`active\`, \`paused\`, \`completed\`, \`cancelled\`,
\`archived\`. Health values: \`unknown\`, \`on_track\`, \`at_risk\`, \`off_track\`.

A Project defines bounded shared context for related work. Its durable planning fields are \`outcome\`,
\`successCriteria\`, \`scope\`, \`nonGoals\`, \`ownerId\`, \`targetAt\`, and \`health\`.
Use \`brief\` for a concise description and \`instructions\` for durable operating guidance.

### Create

\`\`\`json
{
  "mode": "project",
  "command": "create",
  "args": {
    "name": "AI Product Research",
    "outcome": "Choose a validated product direction",
    "successCriteria": ["Ten customer interviews", "Decision recorded"],
    "scope": { "market": "developer tools" },
    "nonGoals": ["Build the production product"],
    "health": "on_track",
    "targetAt": 1760000000000,
    "workspaceRoot": "/path/to/repo"
  }
}
\`\`\`

### Update

\`\`\`json
{
  "mode": "project",
  "command": "update",
  "args": {
    "projectId": "project_id",
    "status": "active",
    "health": "at_risk",
    "successCriteria": ["Ten interviews", "Evidence-backed decision"]
  }
}
\`\`\`

### Resolve a workspace

Use \`autoCreate: false\` for lookup. Set it to true only when creating a Project is authorized.

\`\`\`json
{ "mode": "project", "command": "resolve_workspace", "args": { "workspacePath": "/path/to/repo", "autoCreate": false } }
\`\`\`

### Milestones

Milestone statuses: \`planned\`, \`active\`, \`completed\`, \`cancelled\`.

\`\`\`json
{
  "mode": "project",
  "command": "create_milestone",
  "args": {
    "projectId": "project_id",
    "title": "Finish discovery",
    "status": "active",
    "targetAt": 1760000000000,
    "sortOrder": 10
  }
}
\`\`\`

Use \`list_milestones\` with \`projectId\`. Use \`update_milestone\` with both
\`projectId\` and \`milestoneId\`. Milestone deletion is intentionally not exposed.

### Immutable project updates

Project updates are append-only progress snapshots. They also update Project health.

\`\`\`json
{
  "mode": "project",
  "command": "create_update",
  "args": {
    "projectId": "project_id",
    "health": "on_track",
    "summary": "Discovery is complete",
    "progress": ["Interviewed ten users"],
    "risks": ["Pricing remains unvalidated"],
    "nextSteps": ["Run pricing tests"]
  }
}
\`\`\`

Use \`list_updates\` with \`projectId\` and optional \`limit\`. Updates cannot be edited.

## Automations

Commands: \`list\`, \`get\`, \`create\`, \`update\`, \`delete\`, \`run\`, \`pause\`,
\`resume\`, and \`history\`.

Automation \`create\` automatically uses the current session Project when \`projectId\` is
omitted. An explicit \`projectId\` takes precedence and is validated before mutation. Use an
explicit id when creating for a Project other than the current session Project.

### Create in the current Project

\`trigger\` and \`action\` use the same shapes as the Automation product API.

\`\`\`json
{
  "mode": "automation",
  "command": "create",
  "args": {
    "name": "Daily project review",
    "trigger": { "kind": "schedule", "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" } },
    "action": { "kind": "agent", "instruction": "Review the current project and summarize risks." }
  }
}
\`\`\`

To override the inherited Project, add \`"projectId": "project_id"\` to \`args\`.
The create payload may also be nested under \`args.automation\`; top-level \`args.projectId\`
has precedence.

### List and history

\`list\` and unqualified \`history\` inherit the current session Project. Pass an explicit
\`projectId\` to query another Project. Pass \`automationId\` to \`history\` for one Automation.

### Update and operate

Use \`automationId\` for \`get\`, \`update\`, \`delete\`, \`run\`, \`pause\`, and \`resume\`.
For \`update\`, patch fields may be direct args or nested under \`args.patch\`. Supplying a new
\`projectId\` reassigns the Automation after validating the target Project.

## Tasks

Commands: \`list\`, \`get\`, \`create\`, \`update_dependencies\`, \`add_context\`,
\`remove_context\`, \`command\`, and \`delete\`.

Task phases are \`backlog\`, \`ready\`, \`active\`, \`review\`, and \`closed\`.
Operational state is projected separately as \`idle\`, \`queued\`, \`running\`, \`waiting\`,
\`verifying\`, \`succeeded\`, \`failed\`, or \`cancelled\`. Never send either value as a
free-form status update.

\`task.get\` returns the Task, its projected \`model\`, dependencies, dependents, context,
authority grants, TaskRuns, receipts, and waits.
The projected model is the correct source for current operational state and attention items.

\`delete\` permanently removes the Task and its contracts, waits, context links, TaskRuns,
receipts, and Task-owned execution records. It does not delete linked Sessions, workspace files,
or external artifacts. Cancel an active TaskRun before deletion, and use \`dryRun: true\` when
the user's intent is ambiguous.

\`\`\`json
{ "mode": "task", "command": "delete", "args": { "taskId": "task_id" }, "dryRun": true }
\`\`\`

### Capture or start

\`createMode\` defaults to \`capture\`, which creates a backlog Task without executing it.
Use \`start\` only when immediate execution is intended.

\`\`\`json
{
  "mode": "task",
  "command": "create",
  "args": {
    "objective": "Complete the customer research report",
    "projectId": "project_id",
    "createMode": "capture",
    "priority": "high",
    "expectedOutputs": ["Research report"],
    "acceptanceCriteria": ["Sources are cited"],
    "constraints": ["Do not contact customers without approval"],
    "dependsOnTaskIds": []
  }
}
\`\`\`

### Dependencies

\`\`\`json
{
  "mode": "task",
  "command": "update_dependencies",
  "args": {
    "taskId": "task_id",
    "expectedVersion": 3,
    "dependsOnTaskIds": ["dependency_task_id"]
  }
}
\`\`\`

### Context links

Use \`add_context\` to link a document, file, URL, session, memory, Task, artifact, or source
as \`input\`, \`reference\`, \`constraint\`, \`deliverable\`, or \`evidence\` context.

\`\`\`json
{
  "mode": "task",
  "command": "add_context",
  "args": {
    "taskId": "task_id",
    "targetKind": "file",
    "targetId": "/path/to/spec.md",
    "role": "input",
    "title": "Product specification",
    "pinned": true,
    "retrievalPolicy": {},
    "metadata": {}
  }
}
\`\`\`

Use \`remove_context\` with \`taskId\` and the exact \`edgeId\` returned by \`task.get\`.
Do not add authority grants through this tool; an Agent must not authorize itself.

### Typed lifecycle commands

Every command requires \`taskId\`, the Task's current \`expectedVersion\`, a \`type\`, and
type-specific fields inside \`commandArgs\`.

Supported command types:

- \`mark_ready\`
- \`start\`: \`{ "executor": { "kind": "agent", "agentId": "main" } }\`
- \`request_review\`
- \`close\`: \`{ "resolution": "done | cancelled | duplicate | wont_do" }\`
- \`reopen\`: \`{ "phase": "ready | active" }\`
- \`add_wait\`: \`{ "wait": { "kind": "dependency | approval | input | schedule | external | paused", "reason": "...", "condition": {} } }\`
- \`resolve_wait\`: \`{ "waitId": "wait_id", "resolution": {} }\`
- \`delegate\`: \`{ "agentId": "agent_id" }\`
- \`revise_contract\`: \`{ "contract": { ...complete contract... } }\`

\`\`\`json
{
  "mode": "task",
  "command": "command",
  "args": {
    "taskId": "task_id",
    "expectedVersion": 3,
    "type": "start",
    "commandArgs": {
      "executor": { "kind": "agent", "agentId": "main" }
    }
  }
}
\`\`\`

Contract revision is replacement, not a patch. Read the Task and preserve all contract fields
the user did not ask to change. Resolve a wait through \`resolve_wait\`; do not directly mutate
a TaskRun or manufacture a phase transition.

## TaskRuns

TaskRun inspection is read-only except for explicit cancellation. Other execution state is
controlled by Task commands and the runtime coordinator.

### List attempts for a Task

\`\`\`json
{ "mode": "task_run", "command": "list", "args": { "taskId": "task_id", "limit": 20 } }
\`\`\`

The result contains run attempts, finalized receipts, and active waits.

### Inspect one attempt

\`\`\`json
{ "mode": "task_run", "command": "get", "args": { "runId": "run_id" } }
\`\`\`

The result contains the TaskRun, its receipt when terminal, ordered events, and active Task waits.

### Cancel an attempt

Read the run first, then pass its current version. Cancellation creates a terminal receipt.

\`\`\`json
{
  "mode": "task_run",
  "command": "cancel",
  "args": { "runId": "run_id", "expectedVersion": 2, "reason": "User cancelled execution" }
}
\`\`\`

Do not guess commands such as retry, force-complete, heartbeat, or transition; they are not Agent APIs.

## Notes

Commands: \`list\`, \`get\`, \`create\`, \`append\`, \`preview_edit\`, \`update\`, and \`delete\`.
Use Notes for durable prose and reference material, not as a Task substitute. Prefer \`append\`
when preserving user content. Use \`preview_edit\` before a canonical rewrite.

\`\`\`json
{ "mode": "note", "command": "create", "args": { "title": "Decision", "markdown": "...", "projectId": "project_id" } }
\`\`\`

\`\`\`json
{ "mode": "note", "command": "append", "args": { "noteId": "note_id", "heading": "AI synthesis", "content": "..." } }
\`\`\`

Use \`update\` with \`status: "trashed"\` for a recoverable removal. \`delete\` permanently
removes the Note and its stored snapshots and media; use \`dryRun: true\` first when the
user's intent is ambiguous.

\`\`\`json
{ "mode": "note", "command": "delete", "args": { "noteId": "note_id" }, "dryRun": true }
\`\`\`

## Local apps and settings

Local app commands are \`list\`, \`get\`, \`create\`, and \`validate\`. Installation,
activation, rollback, and uninstall remain product runtime operations.

Settings supports only \`open\` and returns an exact product jump target without changing config.

## Error recovery

| Result | Recovery |
| --- | --- |
| service unavailable | Stop retrying and report the unavailable capability. |
| not found | Re-list in the intended scope; do not invent another id. |
| conflict | Read the current object and reassess using its latest version. |
| waiting | Inspect the Task projection and TaskRun waits; resolve only the real blocker. |
| invalid command or state | Read the object and use only a documented transition. |
| unsupported operation | Use the dedicated tool or product UI; never write storage directly. |

## Deliberate boundaries

- Project deletion and milestone deletion are not Agent APIs.
- TaskRun mutation is internal to execution coordination except for optimistic cancellation.
- Project updates are immutable.
- Workflow and Automation operations remain in their dedicated tools.
- Only the documented Task and TaskRun commands are valid; do not infer hidden aliases.
`;
