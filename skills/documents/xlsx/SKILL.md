---
name: xlsx
description: Create, inspect, edit, format, recalculate, and validate spreadsheet files (.xlsx, .xlsm, .csv, .tsv) with zero formula errors.
metadata:
  i18n:
    en:
      name: "Spreadsheets"
      description: "Create, inspect, edit, format, recalculate, and validate spreadsheet files (.xlsx, .xlsm, .csv, .tsv) with zero formula errors."
    zh-CN:
      name: "电子表格"
      description: "创建、检查、编辑、格式化、重算并验证 .xlsx、.xlsm、.csv 和 .tsv 电子表格，确保零公式错误。"
  xopc:
    emoji: "📈"
    requires_tools:
      - read_file
      - write_file
      - exec_command
---

# XLSX workbench

Use this skill for spreadsheets (`.xlsx`, `.xlsm`, `.csv`, `.tsv`). Preserve existing workbook structure and source files unless the user explicitly requests replacement.

## Create and edit

1. Inspect an existing workbook before editing: sheets, headers, named ranges, formulas, number formats, tables, charts, pivots, and macros.
2. When a template exists, preserve its layout, styles, formulas, and unrelated sheets. Never overwrite a template in place without explicit user direction.
3. Use real spreadsheet formulas (`SUM`, `AVERAGE`, `IF`, `XLOOKUP`/`INDEX-MATCH`, etc.) for all derived totals and calculations instead of hardcoding computed values.
4. Apply consistent typography, clear column headers, explicit units, appropriate number/date/currency formats, and column widths that prevent `###` truncation.
5. Save a new output file, recalculate formulas when LibreOffice is available, and inspect both structure and rendered sheets before declaring completion.

## Verification

- Confirm zero Excel formula errors (`#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`, `#NUM!`, `#NULL!`).
- Reopen the saved workbook to verify sheet names, dimensions, formula counts, and key totals match the source data.
- Render key sheets to PNG when visual layout matters and check for clipped headers, overlapping text, or unexpected page breaks.
- If formula recalculation, rendering, or macro/pivot preservation is unavailable in the local environment, report that limitation explicitly.

## Included resources

- `scripts/inspect_xlsx.py`: inspects `.xlsx`/`.xlsm`/`.csv`/`.tsv` structure, sheet summary, formula count, named ranges, and Excel error cells without modifying the file.
- `scripts/render_xlsx.py`: converts a workbook to PDF via local LibreOffice and renders sheets to PNG via Poppler for visual QA.
- `references/qa-checklist.md`: workbook editing, formula verification, and visual QA checklist.
