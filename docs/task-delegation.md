# Delegate a task and receive the result

Give Ada a concrete result to prepare, keep talking while it works, and return to the delivered file or task record. Use this when execution should survive beyond a single reply.

## Before you begin

Set up [Ada](./personal-ai.md), keep the Gateway running, and make the required files and tools available. Connecting a model does not grant access to every folder or external service.

## Give a useful brief

State the source material, intended result, completion checks, and boundaries. For example:

```text
Turn this week's plan into a one-page Markdown file in the workspace.
Include priorities, three next actions, and unresolved questions.
Use only the material in this conversation. Do not publish or send it.
Tell me when the file is ready.
```

For spreadsheets or presentations, configure the relevant tools or skills first. Ask for missing information to be gathered before execution if the brief is incomplete.

## Follow the work

1. Check the delegated task under **Activity** in the personal Agent header.
2. Inspect the task card for progress, required information, and execution records.
3. Answer a clarification or authorization request when needed. The task may wait until you respond.
4. Continue the personal conversation. Your current discussion takes priority over unsolicited task updates.

Updates may be queued; a finished execution is not a guarantee of immediate notification. If no result arrives, inspect the task before delegating a duplicate.

## Review and refine

Open the delivered file or related task. Verify that the artifact exists, uses the intended sources, and meets the brief. Then ask: `Revise this file: shorten the introduction and add an owner for each next action. Keep the original figures.` Reference the existing result or Task so the change has clear context.

A delivered result, a stopped execution, and an accepted Task are different states. For durable work, use [Task review and acceptance](./task-review.md).

## Recover without repeating side effects

| Situation | What to do |
| --- | --- |
| Waiting for information or access | Open the task and resolve its request |
| Execution failed | Inspect the cause and existing artifacts before retrying |
| Assistant says a file exists but you cannot find it | Ask for the saved path and inspect the artifact or task record |
| Gateway disconnected | Reconnect to the same instance and check current state |
| Work should stop | Cancel the task execution; ending a voice call does not cancel it |

Cancellation does not undo writes already completed. For external actions, inspect the actual destination before retrying. Use [Automations](./automations.md) for a fixed schedule and [Personal AI follow-ups](./personal-agent-proactivity.md) for topic-based attention.
