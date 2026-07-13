# DOCX editing checklist for the bundled skill

Before editing, record the template's page size, section breaks, heading styles, headers/footers,
table style, and whether revisions or comments exist. After editing, inspect altered pages for broken
wrapping, split tables, missing headers, and unintended style substitution.

Use `scripts/inspect_ooxml.py` before and after a structural edit. Use `scripts/render_docx.py` for
visual QA when LibreOffice and Poppler are installed.
