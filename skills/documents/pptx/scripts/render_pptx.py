#!/usr/bin/env python3
"""Render a PPTX with local LibreOffice and Poppler for bundled-skill slide QA."""

import argparse
import subprocess
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Render PPTX slides to PNG files")
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--dpi", type=int, default=144)
    args = parser.parse_args()

    if not args.input.is_file() or args.input.suffix.lower() != ".pptx":
        raise SystemExit("input must be an existing .pptx file")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="xopc-pptx-render-") as temp:
        temp_path = Path(temp)
        subprocess.run([
            "soffice", "--headless", "--convert-to", "pdf", "--outdir", str(temp_path), str(args.input),
        ], check=True)
        pdf = temp_path / f"{args.input.stem}.pdf"
        subprocess.run([
            "pdftoppm", "-png", "-r", str(args.dpi), str(pdf), str(args.output_dir / "slide"),
        ], check=True)


if __name__ == "__main__":
    main()
