---
name: design-recurring-work
description: Discover and specify a recurring work or life task through a stateful interview before choosing an xopc Task, Scene, Workflow, or Automation. Use when the user asks what to automate or wants a repeated activity designed.
metadata:
  i18n:
    en:
      name: "Design Recurring Work"
      description: "Turn a repeated activity into an implementable, durable specification before choosing how to run it."
    zh-CN:
      name: "设计重复事务"
      description: "通过可续写的访谈，把重复事务整理成可实施的约定，再选择执行方式。"
  xopc:
    emoji: "🔁"
    activates_capabilities:
      - workflow-authoring
      - automation-authoring
    requires_tools:
      - xopc_use
      - tool_manual
---

# Design recurring work

Use this skill when the user wants to discover, define, or improve a recurring activity. If the user already has an implementable request, complete it through the appropriate product capability without prolonging the interview. An explicit request to create a Workflow follows `workflow-authoring` after any material ambiguity is resolved.

Use the language of the user's current request for questions and briefs; the user may override the UI language at any time. Keep an existing Note in its original language unless the user asks to translate it. New Notes use the user's requested language, or the language of the current request when none is specified. Keep stable machine identifiers such as the `recurring-work-spec` tag unchanged across languages. Do not translate quoted source material without a reason.

## Start from the user's world

Read the current conversation, relevant Project, existing Notes, and available source context before asking. Learn the user's names for tools, channels, people, and artifacts. Treat inferred habits as hypotheses. If no activity is named, propose up to three specific candidate activities grounded in known context, with the expected benefit of each.

## Keep one durable specification

Use `xopc_use` in note mode to find a matching Note before creating one. Create no Note until the user has chosen an activity. Then create one Note for its specification, tagged `recurring-work-spec` and `recurring-work-draft`, optionally linked to the current Project. Save its ID and reuse it across rounds and sessions. Before each edit, read the current Note and update it at its current revision; preserve prior confirmed decisions and user wording. Load the `xopc_use` manual before non-trivial mutations. If Notes are unavailable, keep the specification in the conversation and say that it is not durable. When resuming from a Note ID supplied in the user's message, read that exact Note first.

Begin the Note with a short, decision-ready brief in the Note's language: the intended result, current state, and the next decision or action. Keep the detailed specification below it, organized for clarity with headings in the Note's language:

- user goal, affected objects, and exclusions;
- known tools, channels, terminology, and accessible sources;
- confirmed decisions, assumptions, and unresolved questions;
- trigger, inputs, work, result, success evidence, and failure policy when applicable;
- authority, any human decision, and the brief shown at that decision;
- proposed xopc execution object and why it is sufficient.

Put the next unresolved decision near the top of a draft Note, with a recommended answer and reason. Mark questions as resolved when answered; do not erase the decision history. Update the Note after each answered round. Keep exactly one state tag in addition to `recurring-work-spec`:

- `recurring-work-draft` while a material answer is missing;
- `recurring-work-ready` only when another implementer can build it without a material question, including how one run ends and fails;
- `recurring-work-configured` only after the actual runtime object exists and has been read back. Record links or IDs to that object and any first-run evidence in the Note. This tag does not claim the object is active or a run succeeded.

When changing state, remove the prior state tag while preserving unrelated tags. If the existing Note lacks a state tag or has conflicting state tags, inspect and repair it before implementation. Do not publish or activate an executable object merely because the specification was saved or tagged ready.

## Interview in rounds

Ask only questions whose answers would change the design. Keep each round small; attach one recommended answer and a short reason to every question. Use `clarify` when available for a blocking question and put the recommendation in `suggestedAnswer`. If a safe answer follows from context, record it as an assumption and let the user correct it rather than asking again.

Examine the following as needed, never as a mandatory checklist:

1. What observable result relieves the repeated burden, and which objects are in scope?
2. What starts a run? Prefer a reliable event when it matches the user's intent; use a schedule when timing is the actual requirement or event access is unavailable. What duplicate or stale inputs should be ignored?
3. Which sources and permissions exist today? What should happen when data is missing, inconsistent, or unavailable?
4. What can be completed without AI, and what needs judgment? Avoid a Workflow graph for a single capable Agent action.
5. Which actions may happen automatically? Defer any necessary human decision until the evidence and proposed result are ready, while respecting the existing approval policy. Some activities need no checkpoint.
6. What short brief would let the user decide once: result, evidence, recommendation, impact, and a link to the artifact?
7. What observable signal proves one run completed? If it cannot be produced, specify bounded retry, skip, pause, or escalation. Silence is a valid result when nothing changed.

Do not turn a recommended answer into permission. Do not infer access to private channels or authority for external sends, deletion, publication, purchases, or account changes.

## Finish with a buildable handoff

The specification is ready when another implementer can build it without asking a material question, including how one run ends and fails. If an important answer is unavailable, keep the Note tagged `recurring-work-draft` and show the exact unresolved decision. Present a concise decision-ready brief and the Note link, not the raw interview transcript.

Choose the smallest existing product shape: direct Agent work for a simple run; Task for a bounded commitment; Scene for ongoing delegated help; Workflow only for stable inspectable multi-step execution; Automation for the trigger. These may be combined when necessary. The Note is design material, not an executable source of truth. If the user asks to implement the ready specification, read the full current Note and revalidate its decisions even when its tag says ready; return it to draft if a material answer is missing. Prepare and validate the corresponding draft through existing authoring tools. Load `workflow-authoring` when a Workflow is actually needed; follow its validated draft and publish procedure. Present the trigger, sources, permissions, notification policy, and likely effects for the required confirmation, then publish or activate only when authorized. Run a safe first test where possible, record its actual outcome and evidence in the Note, and revise the specification if the result exposes a gap. Do not call a successful configuration save a successful run.

Product rationale: `docs/design/recurring-work-discovery.md`.
