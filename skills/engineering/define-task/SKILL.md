---
name: define-task
description: Define, create, or refine an explicitly requested persistent xopc Task with a verifiable Task Contract; do not use for ordinary one-off work.
metadata:
  xopc:
    emoji: "🎯"
    requires_tools:
      - xopc_use
      - tool_manual
---

# Task definition

Use this skill only when the user explicitly asks to define, capture, create, or refine a persistent
xopc Task. Complete ordinary implementation and one-off requests directly without creating a Task.

## Build the Task Contract

Express the requested result through the current Task Contract fields:

- `objective`: the observable result;
- `expectedOutputs`: concrete deliverables;
- `acceptanceCriteria`: checks that prove completion;
- `constraints`: material boundaries, prohibitions, or required conditions.

Preserve user-stated assumptions, risks, approval requirements, priority, Project association, and
dependencies when they are available. Do not invent authority or success criteria that materially
change the request.

## Persist safely

1. Use repository and conversation context to make the contract concrete.
2. Ask one concise question only when a missing result, acceptance criterion, or boundary would
   materially change the Task.
3. Load the `xopc_use` manual before a non-trivial Task mutation.
4. List and inspect current Tasks before creating one when duplication is plausible. Refine a
   matching Task through its typed lifecycle instead of creating a competing Task.
5. Use `createMode: "capture"` unless the user explicitly wants execution to start now. Use
   `createMode: "start"` only for authorized immediate execution.
6. Read the current Task version before revising an existing contract, and preserve fields the user
   did not ask to change because contract revision replaces the complete contract.
7. Verify the returned Task and report its delivery link when one is provided.

For bugs, include a reproducer and regression check. For performance work, name the metric,
threshold, method, and run count. For research, name the decision the research must enable and the
evidence standard.

Read `references/task-contract-rubric.md` when the Task needs a more careful contract review.
