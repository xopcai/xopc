# The Task Loop

xopc has one user-facing work model: **Task**. A user describes the result they want; xopc understands the context, defines what “done” means, selects the smallest capable execution path, performs the work, verifies the result, and keeps moving until the task is achieved or a real user decision is required.

## The product objects

| Object | Responsibility |
| --- | --- |
| **Conversation** | The natural-language interface and execution history. It is where the user asks, decides, and receives results. |
| **Task** | The single unit of commitment. It owns objective, success criteria, state, next action, blockers, execution runtime, evidence, and receipts. |
| **Project** | Optional context for related tasks, conversations, files, and activity. It does not own a second task state. |
| **Workflow** | An execution strategy for repeatable or inspectable multi-step work. It is not a user task container. |
| **Automation** | A trigger that starts an agent or workflow on a schedule or event. It is not a user task container. |
| **Note / Workspace** | Durable source material and produced artifacts. |

The default experience exposes only Home, Conversation, Task, and optional Project context. Workflow and Automation appear when their execution behavior is useful, not as setup the user must understand first.

## One loop

1. **Understand** — assemble the user's current request, durable preferences, related project material, conversation context, and relevant source evidence.
2. **Contract** — express the objective, acceptance criteria, deliverables, boundaries, authority, and verification plan as one Task Contract.
3. **Execute** — use direct tools by default; select a Workflow only for repeatable or visible multi-step execution; select an Automation only for recurring or event-driven execution.
4. **Verify** — judge acceptance criteria using evidence and write an execution receipt. Activity alone is never treated as completion.
5. **Continue** — proceed autonomously while authority and evidence allow it. Ask the user only for a specific decision, permission, credential, or missing fact.
6. **Learn** — retain corrections, context feedback, and trusted preferences so the next task starts with better understanding.

## State ownership

Task is the only authoritative state machine for user work. Conversation, Project, Workflow, and Automation link to an Task but do not mirror its status. The UI derives the user-facing states `running`, `needs_user`, and `completed` from the Task aggregate.

Home is a projection, not another store. It shows:

- a bounded “Needs you” decision queue;
- tasks currently moving;
- recent verified results;
- failed runs that deserve attention;
- the smallest useful next action.

## Start simple

| Need | Smallest product shape |
| --- | --- |
| Ask or complete a one-off task | Conversation; an Task is created when durable execution is needed |
| Keep a result moving across sessions | Task + Conversation |
| Group related results and material | Project + Tasks |
| Run repeatable multi-step work | Task + Workflow |
| React to a schedule or event | Task + Automation |

Users should never have to choose among competing task containers. They state the task; xopc chooses the execution capability.
