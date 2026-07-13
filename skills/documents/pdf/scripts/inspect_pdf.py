#!/usr/bin/env python3
"""Inspect PDF metadata and extract a bounded text preview for the bundled PDF skill."""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a PDF without modifying it")
    parser.add_argument("input", type=Path)
    parser.add_argument("--max-chars", type=int, default=4000)
    args = parser.parse_args()

    if not args.input.is_file() or args.input.suffix.lower() != ".pdf":
        raise SystemExit("input must be an existing .pdf file")

    try:
        from pypdf import PdfReader
    except ModuleNotFoundError as error:
        raise SystemExit("pypdf is required: install it in the active Python environment") from error

    reader = PdfReader(str(args.input))
    preview = ""
    if not reader.is_encrypted:
        for page in reader.pages:
            preview += page.extract_text() or ""
            if len(preview) >= args.max_chars:
                break

    print(json.dumps({
        "path": str(args.input),
        "pages": len(reader.pages),
        "encrypted": reader.is_encrypted,
        "metadata": {key: str(value) for key, value in (reader.metadata or {}).items()},
        "textPreview": preview[:args.max_chars],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
