# Visual workflows

xopc workflows turn repeatable, multi-step work into a visual task plan. Users arrange steps on a canvas, describe changes in natural language, watch each step run, and consume the final result without reading code.

The workflow definition is a versioned directed acyclic graph. There is no script format or script execution path.

## Product model

- A **template** describes how a kind of task should be completed.
- A **draft** is an unpublished visual edit and is saved automatically.
- A **revision** is an immutable published version.
- A **run** executes the exact graph revision captured when it starts.
- An **automation** decides when a published workflow runs.

This separation keeps the main experience simple: workflow means “how the work happens”; automation means “when it happens.”

## Create and edit

Open `#/workflows`, choose **Create template**, and start in either of two ways:

1. Describe the task in natural language. xopc creates a visual draft.
2. Add and connect steps directly on the canvas.

The editor uses five user-facing step types:

| Step | Purpose |
|---|---|
| Input | Receives the goal and structured input. Every flow has exactly one. |
| AI task | Gives one focused job to an isolated agent. Independent AI tasks run in parallel. |
| Decision | Chooses a true or false branch using a simple rule. |
| Merge | Collects results from active branches. |
| Result | Produces the final summary and structured output. Every flow has exactly one. |

Select a step to edit its plain-language instructions. Model, tool, schema, and iteration controls belong in advanced settings; they should not dominate normal authoring.

Drafts auto-save. Publishing validates the complete graph and creates a new revision. If another editor published first, xopc rejects the stale write instead of overwriting it.

## Validation

The server reports all known graph problems in one response. A publishable graph must have:

- exactly one Input and one Result;
- unique node and edge IDs;
- valid connections with no self-links or cycles;
- every step reachable from Input;
- every step able to reach Result;
- both true and false connections for every Decision;
- a useful instruction for every AI task.

Invalid intermediate drafts are allowed, because temporarily disconnected nodes are normal while editing. Invalid graphs cannot be published or run.

## Run and inspect

Starting a workflow creates a dedicated workflow session. The run stores a snapshot of the graph and revision, so later edits never change the historical record.

The run view overlays status on the same graph:

- pending;
- running;
- completed;
- skipped because another decision branch was selected;
- failed.

Select a node to inspect its input, output, elapsed time, model/tool details, and errors. Failed runs offer **Edit and repair**, which opens the same workflow graph with a natural-language repair request prefilled.

Independent ready nodes run concurrently. A Decision activates only the selected branch. Merge waits for active predecessors and ignores skipped branches. A run fails when an active AI task fails or the graph cannot progress.

## Start surfaces

| Surface | Behavior |
|---|---|
| Workflow center | Pick a template, enter a goal, and follow the live graph. |
| Chat | The `workflow` tool starts a published template by name. |
| Automation | A schedule, webhook, or manual trigger starts a published template directly. |
| REST API | Create and monitor runs without an assistant turn. |
| TUI / channels | Receive compact progress summaries and final results. |

The workflow tool accepts a definition name and run input only. It does not accept inline executable definitions.

## Built-in templates

Built-ins cover common product scenarios such as repository audit, research, planning, decision support, meeting preparation, weekly review, content creation, and competitive analysis. They use the same graph model and runtime as custom workflows. Copy a built-in to create an editable custom version without changing the original.

## Automations

For recurring work, create an automation and select a published workflow. The automation stores the trigger and reliability policy; the workflow retains the task logic. Automation history links to the workflow run so users can inspect the exact graph, status, and result.

Use an agent-instruction automation only when a model must decide at runtime whether to start a workflow. For deterministic recurring work, direct workflow execution is simpler and easier to audit.

See [Automations](automations.md) for schedules, webhooks, reliability, and run history.

## Storage

Custom definitions are JSON files under `~/.xopc/workflows/`. Revision snapshots and drafts are stored in private subdirectories of the same workflow store. Writes use temporary files plus atomic rename.

Deleting a custom workflow removes its current definition, revision history, and related drafts. Built-ins cannot be deleted.

## REST API

Authenticated routes use the same bearer token as the gateway console.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/workflows/definitions` | List templates. |
| `GET` | `/api/workflows/definitions/:id` | Load the current graph. |
| `POST` | `/api/workflows/definitions/validate` | Validate a graph without publishing. |
| `POST` | `/api/workflows/definitions/generate` | Generate or revise a graph from natural language. |
| `POST` | `/api/workflows/definitions` | Publish a graph with `expectedRevision`. |
| `DELETE` | `/api/workflows/definitions/:id` | Delete a custom template and its history. |
| `GET` | `/api/workflows/definitions/:id/revisions` | List published revisions. |
| `GET` | `/api/workflows/definitions/:id/revisions/:revision` | Load one revision. |
| `POST` | `/api/workflows/definitions/:id/revisions/:revision/restore` | Restore by publishing a new revision. |
| `GET` | `/api/workflows/drafts` | List visual drafts. |
| `GET` | `/api/workflows/drafts/:draftId` | Load a draft. |
| `POST` | `/api/workflows/drafts` | Create or update a draft with optimistic concurrency. |
| `DELETE` | `/api/workflows/drafts/:draftId` | Discard a draft. |
| `POST` | `/api/workflows/runs` | Start a run and return its run/session IDs. |
| `GET` | `/api/workflows/runs` | List runs. |
| `GET` | `/api/workflows/runs/:runId` | Load the live projected run view. |
| `POST` | `/api/workflows/runs/:runId/cancel` | Stop an active run. |
| `POST` | `/api/workflows/runs/:runId/retry` | Start a fresh retry. |
| `POST` | `/api/workflows/runs/:runId/replay` | Replay selected failed checks or phases. |

## Configuration and limits

Workflow availability and limits come from the selected agent capability manifest. Agent nodes can select a configured model role such as `small` or `large`; unresolved roles fail validation or execution rather than silently changing behavior.

Current operational boundaries:

- workflows are acyclic;
- nested workflow runs are not available inside agent nodes;
- cancelled runs restart from the beginning when retried;
- channel progress varies by channel capability, while the gateway always provides the full node graph.
