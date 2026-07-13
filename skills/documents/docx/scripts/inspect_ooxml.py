#!/usr/bin/env python3
"""Inspect the structure of a DOCX package without changing it for the bundled skill."""

import argparse
import json
import re
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a DOCX package")
    parser.add_argument("input", type=Path)
    parser.add_argument("--max-chars", type=int, default=4000)
    args = parser.parse_args()

    if not args.input.is_file() or args.input.suffix.lower() != ".docx":
        raise SystemExit("input must be an existing .docx file")

    with zipfile.ZipFile(args.input) as archive:
        parts = sorted(archive.namelist())
        document_xml = archive.read("word/document.xml").decode("utf-8", errors="replace")

    text = " ".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", document_xml))
    print(json.dumps({
        "path": str(args.input),
        "partCount": len(parts),
        "hasComments": "word/comments.xml" in parts,
        "hasTrackedChanges": "<w:ins" in document_xml or "<w:del" in document_xml,
        "textPreview": text[:args.max_chars],
        "parts": parts,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
