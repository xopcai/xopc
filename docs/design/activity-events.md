# Activity Events Design

## Goal

Activity events provide a product-facing history of meaningful changes across XOPC objects. They are not debug logs and they are not the canonical state store. Object stores such as projects, notes, tasks, sessions, workflows, and automations remain authoritative for current state.

The system should answer:

- What changed?
- Who or what caused it?
- Which object changed?
- Which stable scopes did it belong to when it happened?
- Why does it appear in a project timeline?

## Product Surfaces

### Global Activity

Shows all timeline-worthy activity across the workspace. Useful for recent changes, audit, and agent transparency.

### Object Activity

Shows activity for a single object, such as a note, project, task, session, workflow run, or automation.

### Project Activity

Shows a stable project timeline. This should not require every object to carry a `projectId`. It is built from event-time scopes and, optionally, related activity.

Project UI should distinguish:

- `Activity`: events scoped to the project when they occurred.
- `Related`: events inferred from current links or session context after the fact.

## Non-Goals

- Reconstructing current object state from activity events.
- Recording every low-level write as a user-visible timeline item.
- Forcing `projectId` onto every object type.
- Making automatic relationship inference indistinguishable from explicit project membership.

## Core Concepts

### Activity Event

An append-only product event for a meaningful object change.

```ts
interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  primaryObject: ActivityObjectRef;
  actor: ActivityPrincipal;
  initiator?: ActivityPrincipal;
  source: ActivitySource;
  payload: Record<string, unknown>;
  visibility: 'timeline' | 'audit' | 'debug';
  importance: 'low' | 'normal' | 'high';
  createdAt: number;
}
```

### Activity Principal

`actor` is the entity that performed the change. `initiator` is the entity that caused the actor to act.

Examples:

- User directly edits a note:
  - actor: `user`
  - initiator: `user`
  - source: `gateway_api`
- Agent updates a task because the user asked in chat:
  - actor: `agent`
  - initiator: `user`
  - source: `xopc_use`
- Automation runs an agent that appends a note:
  - actor: `agent`
  - initiator: `automation`
  - source: `xopc_use`

```ts
interface ActivityPrincipal {
  kind: 'user' | 'agent' | 'system' | 'automation' | 'workflow';
  id?: string;
  name?: string;
  sessionKey?: string;
  agentId?: string;
}
```

### Activity Source

The technical surface that emitted the event.

```ts
interface ActivitySource {
  kind: 'xopc_use' | 'gateway_api' | 'automation' | 'workflow' | 'system';
  requestId?: string;
  toolCallId?: string;
  runId?: string;
}
```

### Object Reference

```ts
interface ActivityObjectRef {
  kind:
    | 'project'
    | 'note'
    | 'task'
    | 'session'
    | 'workflow_run'
    | 'automation';
  id: string;
  title?: string;
}
```

## Stable Scopes

Scopes capture what the event belonged to at event time. These are stable and should not change just because object links change later.

```ts
interface ActivityScope {
  activityId: string;
  scopeKind: 'project' | 'session' | 'workspace' | 'channel';
  scopeId: string;
  reason: 'explicit' | 'object_owner' | 'inherited_session' | 'runtime_context';
}
```

Scope examples:

- `project.created`: project scope by `object_owner`.
- `task.updated`: project scope by `object_owner`.
- `note.appended` from a project-bound chat session: project scope by `inherited_session`; session scope by `runtime_context`.
- `note.created` outside a project session: no project scope; global/object activity only.

## Related Projection

Related projection is not the stable timeline. It is a computed relationship view used to surface possible or current project relevance.

```ts
interface ActivityRelatedProject {
  activityId: string;
  projectId: string;
  reason: 'object_link' | 'session_link' | 'derived_context';
  confidence: number;
  computedAt: number;
}
```

Rules:

- Related activity must be visually distinct from stable activity.
- Related activity must expose its reason.
- Related activity can appear or disappear when links change.
- Stable scoped activity should not silently move between projects.

## Object Links

Object links describe durable relationships between product objects. Keep the initial relation set small.

```ts
interface ObjectLink {
  id: string;
  from: ActivityObjectRef;
  to: ActivityObjectRef;
  relation: 'belongs_to' | 'created_from' | 'discussed_in' | 'attached_to';
  source: 'user' | 'agent' | 'system';
  createdAt: number;
}
```

Initial usage:

- note `belongs_to` project
- task `belongs_to` project
- session `discussed_in` project
- note `created_from` session
- task `created_from` note

Avoid weak relations such as `mentions` until the UI can explain them well.

## Event Taxonomy

### Project

| Type | Visibility | Payload |
|------|------------|---------|
| `project.created` | timeline | `name`, `workspaceRoot?`, `brief?` |
| `project.updated` | timeline | `changes[]` |
| `project.status_changed` | timeline | `from`, `to` |
| `project.workspace_changed` | timeline | `from?`, `to?` |

### Note

| Type | Visibility | Payload |
|------|------------|---------|
| `note.created` | timeline | `title?`, `kind`, `tags?`, `contentPreview`, `contentLength` |
| `note.appended` | timeline | `heading?`, `contentPreview`, `contentLength` |
| `note.updated` | timeline | `changes[]`, `contentTouched` |
| `note.status_changed` | timeline | `from`, `to` |
| `note.preview_generated` | audit | `instruction`, `operationCount` |

### Task

| Type | Visibility | Payload |
|------|------------|---------|
| `task.created` | timeline | `title`, `status`, `priority` |
| `task.updated` | timeline | `changes[]` |
| `task.status_changed` | timeline | `from`, `to` |
| `task.archived` | timeline | `archivedAt` |
| `task.link_added` | timeline | `target` |

### Session

| Type | Visibility | Payload |
|------|------------|---------|
| `session.attached_to_project` | timeline | `sessionKey`, `projectId` |
| `session.detached_from_project` | timeline | `sessionKey`, `projectId` |
| `session.renamed` | audit | `from`, `to` |

### Workflow and Automation

| Type | Visibility | Payload |
|------|------------|---------|
| `workflow_run.started` | timeline | `definitionId`, `runId` |
| `workflow_run.completed` | timeline | `runId`, `status` |
| `automation.run_started` | timeline | `automationId`, `trigger` |
| `automation.run_completed` | timeline | `automationId`, `status` |

## Payload Rules

- Store structured data; generate user-facing summaries at read time.
- Do not store full markdown or full object snapshots in activity payloads.
- Use bounded previews:
  - `contentPreview`: max 240 chars
  - `contentLength`: original length
- Store field changes as structured rows:

```ts
interface FieldChange {
  field: string;
  before?: unknown;
  after?: unknown;
}
```

For large values, store booleans or previews:

```ts
{
  field: 'markdown',
  beforePreview: '...',
  afterPreview: '...',
  beforeLength: 1200,
  afterLength: 1600
}
```

## Storage Shape

Recommended tables:

```sql
activity_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  primary_object_kind TEXT NOT NULL,
  primary_object_id TEXT NOT NULL,
  primary_object_title TEXT,
  actor_json TEXT NOT NULL,
  initiator_json TEXT,
  source_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  visibility TEXT NOT NULL,
  importance TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

activity_scopes (
  activity_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (activity_id, scope_kind, scope_id, reason)
);

object_links (
  id TEXT PRIMARY KEY,
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

activity_related_projects (
  activity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (activity_id, project_id, reason)
);
```

Indexes:

- `activity_events(created_at)`
- `activity_events(primary_object_kind, primary_object_id, created_at)`
- `activity_scopes(scope_kind, scope_id, activity_id)`
- `object_links(from_kind, from_id)`
- `object_links(to_kind, to_id)`
- `activity_related_projects(project_id, activity_id)`

## Read APIs

### Global Activity

```http
GET /api/activity?visibility=timeline&limit=50&offset=0
```

### Object Activity

```http
GET /api/activity/object/:kind/:id?limit=50&offset=0
```

### Project Activity

```http
GET /api/projects/:id/activity?includeRelated=false&limit=50&offset=0
```

Response should include formatted summaries plus raw structured fields:

```ts
interface ActivityListResponse {
  ok: true;
  items: Array<ActivityEvent & {
    summary: string;
    scopes: ActivityScope[];
    related?: ActivityRelatedProject[];
  }>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
```

## Write Architecture

Domain services should emit activity through a shared service. Tools and routes pass context; they should not hand-roll activity summaries.

```ts
interface ActivityContext {
  actor: ActivityPrincipal;
  initiator?: ActivityPrincipal;
  source: ActivitySource;
  sessionKey?: string;
  projectId?: string;
  workspaceRoot?: string;
}
```

Service layer pattern:

```ts
projects.update(id, patch, { activity });
notes.appendTextToNote(id, content, heading, { activity });
tasks.updateTask(id, patch, { activity });
```

`ActivityService.record` handles:

- event insert
- stable scope calculation
- optional related projection calculation
- summary formatting at read time

## Scope Calculation Rules

When recording an event:

1. Add object-owner project scope when the primary object is project-owned.
2. Add explicit project scope from `ActivityContext.projectId`.
3. Add inherited project scope from `ActivityContext.sessionKey` when session metadata has `projectId`.
4. Add session scope when a session key is available.
5. Add workspace scope when a workspace root is available.

Conflict rule:

- If explicit project scope and inherited session scope differ, keep both scopes and record distinct reasons.
- UI may display the explicit scope as primary.

## Formatting Rules

Summaries should be generated from type + payload, not stored as canonical text.

Examples:

- `project.created`: `Created project "X"`
- `note.appended`: `Appended "Heading" to note "Y"`
- `task.status_changed`: `Moved "Task" from todo to in_progress`

This keeps i18n and future UI changes possible.

## Open Questions

- Should low-importance audit events be visible in project Activity behind a filter?
- Should related projection be synchronous on write or rebuilt asynchronously?
- Should object link creation itself emit activity?
- Should session project reassignment preserve old event-time scopes forever? Default recommendation: yes.

## Implementation Order

1. Add migrations and storage repositories.
2. Implement `ActivityService`, `ObjectLinkService`, and summary formatter.
3. Add read APIs for global, object, and project activity.
4. Add ActivityContext plumbing to ProjectService, NotesService, and TaskService.
5. Pass context from `xopc_use`, gateway routes, automations, and workflows.
6. Add project Activity UI.
