# The Task Loop

xopc has one user-facing work model: **Task**. A user describes the result they want; xopc understands the context, defines what “done” means, selects the smallest capable execution path, performs the work, verifies the result, and keeps moving until the task is achieved or a real user decision is required.

A Task is not an input format the user must prepare. Work can begin as an incomplete thought, conversation, file, link, voice note, source signal, or explicit request. xopc helps connect that input to a meaningful direction and creates durable structure only when continuity is useful.

```text
Unclear input
→ understand the person's intent and context
→ connect it to a goal or Project
→ define the result and next action
→ execute within authority
→ verify with evidence
→ preserve decisions
→ resurface or learn when useful
```

The Task Loop is therefore the work layer of the broader [product relationship](../product.md): xopc should become more helpful through completed work and user correction, without turning every interaction into permanent memory or automatic action.

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

1. **Capture and understand** — accept the user's current request or incomplete input, then assemble relevant preferences, Project material, conversation context, and authorized source evidence.
2. **Contract** — express the objective, acceptance criteria, deliverables, boundaries, authority, and verification plan as one Task Contract.
3. **Execute** — use direct tools by default; select a Workflow only for repeatable or visible multi-step execution; select an Automation only for recurring or event-driven execution.
4. **Verify** — judge acceptance criteria using evidence and write an execution receipt. Activity alone is never treated as completion.
5. **Continue** — proceed autonomously while authority and evidence allow it. Ask the user only for a specific decision, permission, credential, or missing fact.
6. **Resurface** — when work cannot or should not continue now, preserve its blocker and smallest next action so it can return at a useful time.
7. **Learn carefully** — propose durable corrections, context feedback, and trusted preferences for the shared [user understanding](../user-understanding.md). Do not turn every Task detail into permanent personal memory.

## Authority inside the loop

Execution capability and permission are separate. The assistant may understand what should happen without being authorized to do it.

```text
Observe
→ remind
→ propose
→ execute after confirmation
→ automatically execute an explicitly authorized low-risk action
```

Sending, deleting, purchasing, publishing, or changing an external system requires the applicable approval or explicit policy. A confident inference does not expand authority.

## State ownership

Task is the only authoritative state machine for user work. Conversation, Project, Workflow, and Automation link to a Task but do not mirror its status. The UI derives the user-facing states `running`, `needs_user`, and `completed` from the Task aggregate.

Home is a projection, not another store. It shows:

- a bounded “Needs you” decision queue;
- tasks currently moving;
- recent verified results;
- failed runs that deserve attention;
- the smallest useful next action.

## Start simple

| Need | Smallest product shape |
| --- | --- |
| Ask or complete a one-off task | Conversation; a Task is created when durable execution is needed |
| Keep a result moving across sessions | Task + Conversation |
| Group related results and material | Project + Tasks |
| Run repeatable multi-step work | Task + Workflow |
| React to a schedule or event | Task + Automation |

Users should never have to choose among competing task containers. They state the task; xopc chooses the execution capability.

The loop is successful when an important result moves forward with clear evidence and appropriate authority—not when the system produces the largest number of activities, messages, or runs.
