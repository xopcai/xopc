# Projects, Tasks, and Notes

Use these features when work must stay organized beyond one conversation. You can keep using Chat alone for short or exploratory requests.

## Choose the right place

| Need | Use |
| --- | --- |
| Ask a question or complete a small request | Session |
| Keep one result moving across time | Task |
| Share context across several related Tasks | Project |
| Save source material or an artifact | Note or workspace file |
| Repeat a defined sequence | Workflow |
| Start work on a schedule or event | Automation |

## Create a useful Task

A Task should answer:

- What result must exist?
- How will you know it is complete?
- What is in and out of scope?
- What is the next action?
- What decision or access is blocking progress?

Avoid turning every chat message into a Task. Create one when the result needs to survive across Sessions or requires several steps and verification.

## Use a Project for shared context

A Project groups related Tasks, conversations, files, and activity. It is context, not a second task-status system. Keep Project descriptions short and put actionable outcomes in Tasks.

## Notes and workspace files

Use a Note for quick durable information and a workspace file for material the Agent should read, edit, or deliver. Give files descriptive names and remove secrets before sharing them with a cloud model.

## A simple example

For a product release:

1. Create a Project for release context and reference files.
2. Create Tasks for the distinct verifiable results, such as “publish package” and “send release announcement”.
3. Define completion checks for each Task.
4. Use a Workflow only for a sequence you expect to repeat.
5. Add an Automation only if timing or an external trigger matters.
6. Close a Task after reviewing the result, not just after an Agent run stops.

Continue with [The Task Loop](./concepts/loops.md), [Workflows](./workflows.md), and [Automations](./automations.md).
