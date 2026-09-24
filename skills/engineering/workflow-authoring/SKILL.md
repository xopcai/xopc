---
name: workflow-authoring
description: Create or revise an executable xopc workflow directly in a normal conversation using a durable validated draft.
metadata:
  i18n:
    en:
      name: "Workflow Authoring"
      description: "Design or revise an executable XOPC workflow through a durable conversational draft."
    zh-CN:
      name: "工作流创作"
      description: "通过持久化对话草稿设计或修改可执行的 XOPC 工作流。"
  xopc:
    emoji: "◆"
    requires_tools:
      - workflow_manage
---

# Workflow authoring

Use this skill whenever the user asks to create, change, duplicate, or improve a workflow in an ordinary conversation.

1. If the request may refer to an existing workflow, call `workflow_manage` with `list` before choosing a name.
2. Call `workflow_manage` with `open_draft` and the chosen workflow name. Keep the returned draft id and `updatedAtMs` for later calls.
3. Translate the user's outcome into the smallest connected acyclic graph that can deliver it. Prefer one capable agent step over several vague steps.
4. Keep exactly one input and one output. Use decisions only for real branching and merge nodes only for real fan-in.
5. Write agent prompts as complete operating instructions. State inputs, expected result, constraints, and how predecessor results are used.
6. Add `manifest.resources.skills` only when a runtime step genuinely needs that skill. Use `skills_list` and `skill_view` to verify its exact name and instructions.
7. Apply the complete graph and manifest with `workflow_manage` action `replace_draft`, always passing the latest `updatedAtMs` as `expectedUpdatedAtMs`. If validation rejects it, fix the reported issue instead of explaining it away.
8. Validate with `workflow_manage` action `validate_draft`, then summarize the steps, assumptions, required access, and important tradeoffs in plain language.
9. Publish with `workflow_manage` action `publish_draft` only after explicit user confirmation, passing `confirmed: true` and the latest draft version as `expectedUpdatedAtMs`.

Never emit raw workflow JSON for the user to copy, never claim an unsaved proposal is durable, and never publish merely because the draft validates.
