---
name: doc-coauthoring
description: Co-author substantial proposals, specifications, RFCs, and decision documents through context, structure, and reader-focused review.
metadata:
  i18n:
    en:
      name: "Document Co-authoring"
      description: "Co-author substantial proposals, specifications, RFCs, and decision documents through context, structure, and reader-focused review."
    zh-CN:
      name: "文档协作撰写"
      description: "通过梳理背景、搭建结构和面向读者的审阅，共同撰写提案、规范、RFC 与决策文档。"
  xopc:
    emoji: "🤝"
    requires_tools:
      - read_file
      - write_file
---

# Document co-authoring

Use this workflow for substantial documentation, proposals, specifications, or decision records.
Offer it as a structured option; if the user prefers a direct draft, work directly.

## 1. Establish context

Identify the document type, primary readers, intended decision or effect, deadline, required format,
and known constraints. Invite an unstructured context dump and separate facts, assumptions, open
questions, and stakeholder concerns.

## 2. Build the document

Propose an outline before writing long sections. Develop one section at a time, keeping alternatives
and rejected options visible where they affect the decision. Use concrete ownership, dates, criteria,
and dependencies instead of vague future promises.

## 3. Reader review

Predict the questions a reader without the author's context will ask. Check that the document answers
them, that terms are defined, and that the recommendation follows from the evidence. A separate-agent
reader test is optional and requires the user's approval before delegation.

## Completion

Deliver a clean draft plus a short list of unresolved facts, decisions, and requested review. Do not
invent citations, commitments, estimates, or approvals.

Use `references/reader-review.md` when performing the final reader-focused pass.
