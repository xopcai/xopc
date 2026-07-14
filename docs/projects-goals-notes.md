# Projects, Goals, and Notes

Sessions retain conversations. Projects, Goals, and Notes give durable state outside the transcript an explicit home:

- A **Project** is a work-context container that groups a brief, sessions, goals, files, workflow runs, and recent activity.
- A **Goal** is a trackable outcome with status, checklist, blockers, next action, evidence, and linked runs.
- A **Note** is a low-friction input for text, voice, images, attachments, tasks, and edit history.

All three are managed by your local gateway. Open the gateway console and use `#/projects`, `#/goals`, or `#/notes`.

## Which one to use

| Situation | Use |
| --- | --- |
| One question or temporary task | Session |
| Several sessions, files, and tasks belong to one effort | Project |
| You must track whether an outcome is done, blocked, or ready for a next action | Goal |
| You need to capture a thought, voice note, screenshot, or source material quickly | Note |
| The operation repeats or needs several steps/agents | Workflow / Automation |

Avoid putting everything into one very long session. Use conversations for reasoning and execution, projects and goals for structured state, and notes and workspaces for durable material.

## Project: group related activity

Projects fit product releases, research topics, client deliveries, content plans, and long-running maintenance. A project can link multiple Sessions and Goals and show recent workflow runs, files, and an activity timeline.

The project overview summarizes active, blocked, and stale goals, failed workflow runs, and next actions as attention items. You can restore context without opening every transcript in turn.

A useful project brief states at least:

- the problem and desired outcome;
- current scope and explicit non-goals;
- important constraints, owners, or dates;
- how completion will be judged.

## Goal: make progress explicit

Goals fit work with a clear outcome that takes multiple rounds. In addition to a title and description, maintain:

- current status;
- a verifiable checklist;
- blocker reason;
- one clear next action;
- completion evidence or linked workflow runs when needed.

Keep status truthful. Record a blocker when work is stuck, use the relevant waiting state when external input is required, and check evidence and the checklist before completion. Write the next action as something that can begin directly, not “keep working on it.”

A Goal can be attached to a Project, Session, and Workflow run. It can be continued, queued, paused, resumed, completed, archived, or reopened as the work changes.

## Note: capture first, organize later

Notes are optimized for low-friction capture. Web and mobile support quick input, while mobile is especially useful for voice, images, and attachments. Notes also support appending, version history and restore, task state, and AI-assisted edits.

Treat Notes as an inbox, not automatic memory:

1. Capture the thought, feedback, or material with minimal ceremony.
2. Periodically decide which Project / Goal it belongs to, or whether it should become a Workspace file.
3. Convert actionable material into a Goal, task, or workflow; keep reference material as a note or file.
4. Remove or archive stale inputs so long-term context does not accumulate noise.

## A recommended combination

For a “ship v1.0” effort:

1. Create a Project with release scope and success criteria.
2. Create a “ship v1.0” Goal with testing, docs, build, release, and verification checklist items.
3. Associate implementation and debugging Sessions with the project or goal.
4. Capture user feedback, screenshots, and rough thoughts in mobile Notes.
5. Run a pre-release audit Workflow and use an Automation for a daily blocker digest.
6. Add evidence after release, complete the Goal, and keep the project timeline for review.

Continue with [The Continuous Work Model](./concepts/loops.md), [Sessions](./session.md), [Workflows](./workflows.md), [Automations](./automations.md), and [Workspace](./workspace.md).
