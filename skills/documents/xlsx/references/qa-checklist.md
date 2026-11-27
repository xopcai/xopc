# XLSX QA checklist for the bundled skill

Before editing, run `scripts/inspect_xlsx.py` to record sheets, dimensions, named ranges, formula counts, charts, pivot tables, and macros. Preserve existing templates and unrelated sheets unless asked to replace them.

When building or updating models:
- Use dynamic formulas for totals, ratios, and cross-sheet references rather than hardcoded derived numbers.
- Specify units in headers or notes and apply explicit number, date, percentage, and currency formats.
- Size columns and rows so headers and numeric values do not clip or display `###`.

After writing, recalculate with LibreOffice when formula results matter, re-run `scripts/inspect_xlsx.py` to confirm zero Excel errors (`#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`, `#NUM!`, `#NULL!`), and use `scripts/render_xlsx.py` for visual QA when LibreOffice and Poppler are installed.
