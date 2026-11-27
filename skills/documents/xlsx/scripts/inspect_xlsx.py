#!/usr/bin/env python3
"""Inspect an XLSX/XLSM/CSV/TSV spreadsheet without modifying it for the bundled skill."""

import argparse
import csv
import json
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

EXCEL_ERRORS = ("#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!")
NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkg": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def inspect_delimited(path: Path, delimiter: str, max_rows: int) -> dict:
    rows = []
    total_rows = 0
    max_cols = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter=delimiter)
        for row in reader:
            total_rows += 1
            max_cols = max(max_cols, len(row))
            if len(rows) < max_rows:
                rows.append(row[:20])
    return {
        "path": str(path),
        "format": path.suffix.lower().lstrip("."),
        "rowCount": total_rows,
        "columnCount": max_cols,
        "previewRows": rows,
    }


def load_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for si in root.findall("main:si", NS):
        parts = [node.text or "" for node in si.findall(".//main:t", NS)]
        strings.append("".join(parts))
    return strings


def resolve_sheet_targets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    wb_root = ET.fromstring(archive.read("xl/workbook.xml"))
    rel_map: dict[str, str] = {}
    if "xl/_rels/workbook.xml.rels" in archive.namelist():
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        for rel in rels_root.findall("pkg:Relationship", NS):
            rel_id = rel.attrib.get("Id")
            target = rel.attrib.get("Target", "")
            if rel_id:
                normalized = target.lstrip("/")
                if not normalized.startswith("xl/"):
                    normalized = f"xl/{normalized}"
                rel_map[rel_id] = normalized

    sheets: list[tuple[str, str]] = []
    for sheet in wb_root.findall("main:sheets/main:sheet", NS):
        name = sheet.attrib.get("name", "Sheet")
        rel_id = sheet.attrib.get(f"{{{NS['rel']}}}id", "")
        target = rel_map.get(rel_id, "")
        sheets.append((name, target))
    return sheets


def inspect_xlsx(path: Path, max_error_locations: int) -> dict:
    with zipfile.ZipFile(path) as archive:
        parts = sorted(archive.namelist())
        shared_strings = load_shared_strings(archive)
        wb_root = ET.fromstring(archive.read("xl/workbook.xml"))
        defined_names = [
            node.attrib.get("name", "")
            for node in wb_root.findall("main:definedNames/main:definedName", NS)
            if node.attrib.get("name")
        ]

        sheet_summaries = []
        total_formulas = 0
        error_locations: dict[str, list[str]] = {}
        total_errors = 0

        for name, target in resolve_sheet_targets(archive):
            if not target or target not in parts:
                sheet_summaries.append({"name": name, "target": target, "missing": True})
                continue

            sheet_root = ET.fromstring(archive.read(target))
            dim_node = sheet_root.find("main:dimension", NS)
            dimension = dim_node.attrib.get("ref") if dim_node is not None else None
            row_count = 0
            cell_count = 0
            formula_count = 0

            for row in sheet_root.findall("main:sheetData/main:row", NS):
                row_count += 1
                for cell in row.findall("main:c", NS):
                    cell_count += 1
                    cell_ref = cell.attrib.get("r", "?")
                    cell_type = cell.attrib.get("t", "")
                    if cell.find("main:f", NS) is not None:
                        formula_count += 1
                    value_node = cell.find("main:v", NS)
                    raw = value_node.text if value_node is not None and value_node.text is not None else ""
                    if cell_type == "s" and raw.isdigit():
                        idx = int(raw)
                        display = shared_strings[idx] if 0 <= idx < len(shared_strings) else raw
                    else:
                        display = raw
                    if cell_type == "e" or any(err in display for err in EXCEL_ERRORS):
                        err_key = next((err for err in EXCEL_ERRORS if err in display), display or "ERROR")
                        bucket = error_locations.setdefault(err_key, [])
                        if len(bucket) < max_error_locations:
                            bucket.append(f"{name}!{cell_ref}")
                        total_errors += 1

            total_formulas += formula_count
            sheet_summaries.append({
                "name": name,
                "dimension": dimension,
                "nonEmptyRows": row_count,
                "cells": cell_count,
                "formulas": formula_count,
            })

    return {
        "path": str(path),
        "format": path.suffix.lower().lstrip("."),
        "partCount": len(parts),
        "sheetCount": len(sheet_summaries),
        "sheets": sheet_summaries,
        "definedNames": defined_names,
        "totalFormulas": total_formulas,
        "totalErrors": total_errors,
        "errorLocations": error_locations,
        "hasMacros": any(p.endswith("vbaProject.bin") for p in parts),
        "hasCharts": any(p.startswith("xl/charts/") for p in parts),
        "hasPivotTables": any(p.startswith("xl/pivotTables/") for p in parts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect an XLSX, XLSM, CSV, or TSV file")
    parser.add_argument("input", type=Path)
    parser.add_argument("--max-rows", type=int, default=10, help="Preview rows for CSV/TSV")
    parser.add_argument("--max-errors", type=int, default=20, help="Max locations per error type")
    args = parser.parse_args()

    suffix = args.input.suffix.lower()
    if not args.input.is_file():
        raise SystemExit("input must be an existing spreadsheet file")

    if suffix in (".xlsx", ".xlsm"):
        report = inspect_xlsx(args.input, args.max_errors)
    elif suffix == ".csv":
        report = inspect_delimited(args.input, ",", args.max_rows)
    elif suffix == ".tsv":
        report = inspect_delimited(args.input, "\t", args.max_rows)
    else:
        raise SystemExit("input must be .xlsx, .xlsm, .csv, or .tsv")

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
