---
name: docx
description: Create, inspect, edit, render, and validate Word DOCX artifacts while preserving templates and tracked content.
metadata:
  xopc:
    emoji: "📝"
    requires_tools:
      - read_file
      - write_file
      - exec_command
---

# DOCX workbench

Use this skill for Word documents and `.docx` artifacts. A DOCX is a package of XML parts; protect
the package structure and preserve source files unless the user explicitly requests replacement.

## Create and edit

1. Inspect an existing document before editing: page size, margins, headings, sections, headers,
   footers, tables, images, comments, and tracked changes.
2. When a template exists, match its styles and layout. Do not impose a new design system.
3. For a new document, set page size and named styles intentionally; use semantic headings, real
   lists, and accessible descriptive text for meaningful images.
4. Save a new output file, then validate package integrity and render it for visual review.

## Verification

- Check expected headings, tables, links, and page breaks after generation.
- Inspect at least the first page and each altered page when layout matters.
- Preserve tracked changes and comments by default. Accept, reject, or delete them only with explicit
  user direction.
- If a conversion or renderer is unavailable, say so and leave the document unmodified rather than
  guessing at an XML edit.

## Included resources

- `scripts/inspect_ooxml.py`: lists package parts and extracts a bounded text preview.
- `scripts/render_docx.py`: converts a DOCX to PDF with local LibreOffice and renders pages to PNG.
- `references/editing-checklist.md`: template-preserving edit and QA checklist.
