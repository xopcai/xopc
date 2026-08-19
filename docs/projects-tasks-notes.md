# Projects, Tasks, and Notes

xopc keeps the product model deliberately small:

- **Task** is the result xopc has committed to achieve and verify.
- **Project** is optional shared context for related tasks, conversations, files, and activity.
- **Note / Workspace** stores durable input material and artifacts.
- **Conversation** is the interface where work starts, progresses, and asks for a decision.

Open Home at `#/`, Projects at `#/projects`, or a Task at `#/tasks/:id`.

## When to use each object

| Need | Use |
| --- | --- |
| Ask, explore, or complete a small task | Conversation |
| Keep a result moving and know whether it is truly done | Task |
| Share context across several related results | Project |
| Preserve reference material or produced files | Note / Workspace |
| Repeat a known multi-step execution plan | Workflow, linked to an Task |
| Run on a schedule or event | Automation, linked to an Task when it advances one |

## Task: one source of truth

An Task owns:

- objective and optional project context;
- acceptance criteria and deliverables;
- boundaries and required authority;
- current internal state and derived user state;
- next action and blocker;
- execution attempt, runtime lease, and session;
- verification evidence and execution receipts.

The user-facing state is intentionally small:

- `running`: xopc can keep moving;
- `needs_user`: a concrete user decision, permission, credential, or fact is required;
- `completed`: the acceptance criteria have been verified.

Projects, workflows, automations, and conversations link to an Task. They do not maintain a competing task status.

## Project: context, not task management

A Project can hold a brief, constraints, files, related conversations, tasks, workflow runs, and activity. Its operating view derives progress and attention from linked Tasks and runs. This lets xopc restore the right context without asking the user to manage a second hierarchy.

## Home: the smallest useful view

Home is a read model over existing state. It presents one bounded decision queue, moving tasks, recent verified results, and failed runs that need attention. The same Task never appears twice as both a status card and a decision card.

## Example

For a release:

1. Tell xopc the desired release result in Conversation.
2. xopc creates one Task Contract with scope, acceptance criteria, deliverables, and verification.
3. Add a Project only if several Tasks or durable files share context.
4. xopc uses direct tools, a Workflow, or an Automation according to execution needs.
5. Home asks only for decisions xopc cannot safely make.
6. The Task completes only after evidence satisfies the acceptance criteria.

Continue with [The Task Loop](./concepts/loops.md), [Workflows](./workflows.md), [Automations](./automations.md), and [Workspace](./workspace.md).
