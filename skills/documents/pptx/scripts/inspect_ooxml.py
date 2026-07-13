#!/usr/bin/env python3
"""Inspect PPTX slide and media structure without modifying it for the bundled skill."""

import argparse
import json
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a PPTX package")
    parser.add_argument("input", type=Path)
    args = parser.parse_args()

    if not args.input.is_file() or args.input.suffix.lower() != ".pptx":
        raise SystemExit("input must be an existing .pptx file")

    with zipfile.ZipFile(args.input) as archive:
        parts = archive.namelist()
    slides = sorted(part for part in parts if part.startswith("ppt/slides/slide") and part.endswith(".xml"))
    notes = sorted(part for part in parts if part.startswith("ppt/notesSlides/") and part.endswith(".xml"))
    media = sorted(part for part in parts if part.startswith("ppt/media/"))
    print(json.dumps({
        "path": str(args.input),
        "slideCount": len(slides),
        "noteSlideCount": len(notes),
        "mediaCount": len(media),
        "slides": slides,
        "media": media,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
