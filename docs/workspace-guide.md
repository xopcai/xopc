# Work with files and projects

Bring source material and a goal into xopc, inspect the output, and keep useful context with the project. You can start directly in Chat or from a Project without first discussing the task with Ada.

## Before you begin

Connect a working model and choose material you are allowed to process. The workspace belongs to the machine running the Gateway. A local path means that machine's path; attaching a file from another device is a separate action.

Use relevant [skills](./skills.md) and [tools](./tools.md) for office files or specialized work. Vision, image generation, and voice each require compatible configured services.

## Complete one small file task

1. Open Chat, or start a conversation from a Project to keep related work together.
2. Attach the source files or provide an authorized workspace path. State which files may be changed.
3. Describe the output and how to check it:

```text
Read these sales files and create a summary in the workspace.
Keep the raw files unchanged. Show totals by month, calculation rules,
and an exceptions list for missing or conflicting values.
Return the saved file path and explain how you checked the totals.
```

4. Open the delivered file. Compare key values with the sources and check any exceptions.
5. Request a revision against the existing artifact, then reopen the result.

A file preview or successful Agent run alone does not establish that the contents are correct. Ask for editable spreadsheet or presentation formats when you need to keep editing them, and verify that the configured tools support that format.

## Keep work ready to resume

Use a Project for shared files, conversations, and context. Create a Task when a result, blocker, or next action needs to persist; use a Note for durable reference material. You do not need all three for a small request.

On return, ask: `Use this project's notes, tasks, and latest results to summarize what is complete, what is blocked, and the next useful action.` Confirm the sources and state before continuing.

For code projects, the conversation can use a local environment or a new local worktree where offered. The local machine is the Gateway host; a new worktree does not copy uncommitted edits. See [Chat and sessions](./session.md).

## Troubleshooting

| Problem | Check |
| --- | --- |
| A path cannot be read | Path on the Gateway host, source permissions, and selected workspace |
| Output format is unavailable | Installed skills, tools, and the requested format |
| A file contains wrong numbers | Original inputs, calculation rules, and exceptions; request a correction |
| Project context is missing on another device | Connection to the same Gateway and selected Project |

[Practical tutorials](https://xopc.ai/en/learn) include sales workbooks, editable presentations, proposals, and research. Videos and detailed walkthroughs are currently in Chinese; practice material is fictional. Continue with [Projects, Tasks, and Notes](./projects-tasks-notes.md), [Task acceptance](./task-review.md), and [Data and file locations](./workspace.md).
