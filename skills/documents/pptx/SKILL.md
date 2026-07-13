---
name: pptx
description: Create, inspect, edit, render, and validate PowerPoint PPTX presentations with deliberate visual hierarchy.
metadata:
  xopc:
    emoji: "📊"
    requires_tools:
      - read_file
      - write_file
      - exec_command
---

# PPTX studio

Use this skill for slide decks and `.pptx` files. Preserve supplied templates and always visually
inspect changed slides before calling the result complete.

## Workflow

1. Inspect the deck's slide size, master/layout use, typography, palette, notes, and representative
   slides before editing.
2. Draft the narrative first: audience, decision or action, slide sequence, and evidence per slide.
3. Reuse the template's layouts when one is supplied. For new decks, establish a small type scale,
   restrained palette, and one consistent visual motif.
4. Make every slide earn its space. Prefer diagrams, data, images, or meaningful shapes over dense
   bullet lists.
5. Render a contact sheet and inspect every modified slide for clipping, overlap, unreadable text,
   contrast, and broken media.

## Guardrails

- Do not overwrite a source presentation unless the user explicitly requests it.
- Preserve speaker notes, comments, and hidden slides unless the request changes them.
- Keep data claims traceable; label estimates and placeholders.
- Report the output path and any slides that require a human visual decision.

## Included resources

- `scripts/inspect_ooxml.py`: inventories slides, notes, and embedded media.
- `scripts/render_pptx.py`: converts a deck with local LibreOffice and creates PNG slide previews.
- `references/qa-checklist.md`: narrative and visual review checklist.
