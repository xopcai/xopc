---
name: define-goal
description: Turn an explicitly requested goal into a concise, measurable objective with verifiable completion evidence.
metadata:
  xopc:
    emoji: "🎯"
---

# Goal definition

Use this skill only when the user explicitly asks to define, create, or refine a persistent goal.
Do ordinary implementation work directly; do not create a goal merely because a task has several steps.

## Shape a usable objective

State the desired outcome, the affected artifact or behaviour, the evidence that will prove success,
and any material scope boundary. Prefer an observable threshold over activity wording.

Good objectives name a result and a check:

> Deliver the requested export change in `src/export/`, keep all existing formats compatible, and
> verify it with the targeted export tests and a generated sample file.

Avoid objectives such as “make progress” or “investigate this”; turn them into a bounded decision,
reproduction, fix, or written finding.

## Create safely

1. Use available repository and conversation context to make the objective concrete.
2. Ask one concise question only when a missing outcome, metric, or scope limit would change the
   work materially.
3. Check the current goal state before creating another one. Continue a matching active goal rather
   than duplicating it.
4. Create a persistent goal only after the user asked for one and the objective is verifiable.
5. Include a token budget only when the user requested one.

For bugs, define a reproducer and a passing regression check. For performance work, name the metric,
threshold, method, and run count. For research, name the decision the research must enable and the
evidence standard.

For a compact review checklist, read `references/objective-rubric.md`.
