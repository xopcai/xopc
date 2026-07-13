#!/usr/bin/env python3
"""Render a PDF page range with Poppler for the bundled PDF skill."""

import argparse
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Render PDF pages to PNG files")
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--first-page", type=int, default=1)
    parser.add_argument("--last-page", type=int)
    parser.add_argument("--dpi", type=int, default=144)
    args = parser.parse_args()

    if not args.input.is_file() or args.input.suffix.lower() != ".pdf":
        raise SystemExit("input must be an existing .pdf file")
    if args.first_page < 1 or args.dpi < 36:
        raise SystemExit("first page must be positive and dpi must be at least 36")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    command = ["pdftoppm", "-png", "-r", str(args.dpi), "-f", str(args.first_page)]
    if args.last_page is not None:
        command.extend(["-l", str(args.last_page)])
    command.extend([str(args.input), str(args.output_dir / "page")])
    subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
