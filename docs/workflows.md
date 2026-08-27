# Workflows

A Workflow is a reusable visual sequence for multi-step work. Use it when the way work should happen is stable enough to define, inspect, and run again.

## Workflow or Automation?

- A **Workflow** defines how the work happens.
- An **Automation** defines when something runs.

You can run a Workflow manually without an Automation. Add an Automation later when the Workflow should run on a schedule or webhook.

## Create a Workflow

<!-- Screenshot placeholder: /screenshots/workflow-editor.png -->

1. Open **Workflows** in the Gateway console.
2. Choose **Create workflow**.
3. Describe the desired result and the main steps, or start from a built-in template.
4. Review the generated visual draft.
5. Edit step instructions and connections.
6. Validate and publish the Workflow.

Drafts may be incomplete while you edit. Publishing requires one clear input, one result, valid connections, and usable instructions for each AI step.

## Available step types

| Step | Purpose |
| --- | --- |
| Input | Receives the goal and any structured input |
| AI task | Gives one focused job to an Agent |
| Decision | Chooses between two branches using a rule |
| Merge | Collects results from active branches |
| Result | Produces the final output |

Independent AI tasks can run at the same time. Keep each AI task narrow enough that its success or failure is easy to inspect.

## Test before automating

1. Run the published Workflow with a small, non-sensitive input.
2. Follow progress on the graph.
3. Open each failed step and review its input, output, and error.
4. Edit and publish a new revision.
5. Run it again before attaching a schedule.

Each run keeps the published revision it started with, so later edits do not change historical results.

## Good Workflow candidates

- weekly review and planning;
- research with separate collection and synthesis steps;
- content drafting with review and revision;
- repository audit with parallel checks;
- meeting preparation from several sources.

If the request is different every time and only needs one Agent turn, use Chat instead. If the main need is repeating a browser interaction, use [Browser automations](./browser-workflows.md).

## Run and monitor

Start a Workflow from the Workflow page, Chat, or an Automation. The run view shows pending, running, completed, skipped, and failed steps. You can cancel an active run and retry after fixing the Workflow or its access.

Do not grant a Workflow broader tools than its steps require. A schedule does not make an unsafe action safe; review credentials, write access, and external side effects before unattended runs.
