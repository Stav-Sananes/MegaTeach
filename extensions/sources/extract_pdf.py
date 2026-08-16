#!/usr/bin/env python3
"""Last rung of the PDF extraction ladder: pypdf, for machines with no poppler.

Emits a form feed between pages so the caller can attribute every chunk to the
page the learner would turn to. Prints to stdout; failures go to stderr with a
non-zero exit so the caller can move on or report the reason.
"""

import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: extract_pdf.py <file.pdf>", file=sys.stderr)
        return 64

    try:
        from pypdf import PdfReader
    except ImportError:
        print("pypdf is not installed (python3 -m pip install pypdf)", file=sys.stderr)
        return 69

    try:
        reader = PdfReader(sys.argv[1])
    except Exception as error:  # noqa: BLE001 - the caller only needs the reason
        print(f"could not open the PDF: {error}", file=sys.stderr)
        return 65

    out = sys.stdout
    for index, page in enumerate(reader.pages):
        if index:
            out.write("\f")
        try:
            out.write(page.extract_text() or "")
        except Exception as error:  # noqa: BLE001
            # One unreadable page must not cost the whole document.
            print(f"page {index + 1}: {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
