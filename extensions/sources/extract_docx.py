#!/usr/bin/env python3
"""Extract text from a .docx, using only the standard library.

A .docx is a zip of XML, so this needs no pip install and no system package —
`python3 extract_docx.py file.docx` works on any stock Python 3. That matters
because it is the bottom rung of the ladder: whatever else a machine is missing,
this one should still run.

Page breaks are the interesting part. A Word document has no inherent pages —
pagination happens when it is rendered, and depends on the font and paper size of
whoever opens it. Two markers are still worth honouring:

  * <w:br w:type="page"/>       an explicit page break the author inserted
  * <w:lastRenderedPageBreak/>  where Word's own layout engine broke the page the
                                last time it saved the file

Both are emitted as form feeds, matching what the PDF rungs produce, so a
citation can say `p.4` and mean it. A document with neither marker becomes one
page, and the citation carries no page number rather than inventing one.
"""

import re
import sys
import zipfile
from xml.etree import ElementTree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# Body-level elements worth walking, in document order. Anything else (bookmarks,
# revision marks, comment anchors) contributes no reading text.
PARAGRAPH = f"{W}p"
TABLE = f"{W}tbl"
ROW = f"{W}tr"
CELL = f"{W}tc"
TEXT = f"{W}t"
TAB = f"{W}tab"
BREAK = f"{W}br"
PAGE_BREAK = f"{W}lastRenderedPageBreak"


def paragraph_text(paragraph):
    """Concatenate a paragraph's runs, preserving tabs and marking page breaks."""
    out = []
    for node in paragraph.iter():
        tag = node.tag
        if tag == TEXT:
            out.append(node.text or "")
        elif tag == TAB:
            out.append("\t")
        elif tag == PAGE_BREAK:
            out.append("\f")
        elif tag == BREAK:
            kind = node.get(f"{W}type")
            out.append("\f" if kind == "page" else "\n")
    return "".join(out)


def table_text(table):
    """Rows become lines, cells become tab-separated fields.

    Tabs rather than a rendered grid: the chunker splits on blank lines, and an
    ASCII table would survive as one unsplittable blob whose columns no keyword
    search can reach.
    """
    lines = []
    for row in table.findall(ROW):
        cells = []
        for cell in row.findall(CELL):
            parts = [paragraph_text(p).strip() for p in cell.findall(PARAGRAPH)]
            cells.append(" ".join(part for part in parts if part))
        if any(cells):
            lines.append("\t".join(cells))
    return "\n".join(lines)


def extract(path):
    with zipfile.ZipFile(path) as archive:
        try:
            document = archive.read("word/document.xml")
        except KeyError:
            raise SystemExit(
                f"{path} is a zip but has no word/document.xml — "
                "it may be a .doc renamed to .docx, or a different Office format."
            )

    root = ElementTree.fromstring(document)
    body = root.find(f"{W}body")
    if body is None:
        return ""

    blocks = []
    for child in body:
        if child.tag == PARAGRAPH:
            blocks.append(paragraph_text(child))
        elif child.tag == TABLE:
            blocks.append(table_text(child))

    text = "\n\n".join(block for block in blocks if block.strip() or "\f" in block)

    # Word emits a lastRenderedPageBreak inside the paragraph that straddles the
    # break, so form feeds arrive mid-line surrounded by the blank lines this
    # joins with. Normalise them onto their own boundary so the page splitter
    # sees clean page bodies.
    text = re.sub(r"[ \t]*\f[ \t]*", "\f", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: extract_docx.py <file.docx>")

    path = sys.argv[1]
    try:
        sys.stdout.write(extract(path))
    except zipfile.BadZipFile:
        raise SystemExit(f"{path} is not a valid .docx (it is not a zip archive).")


if __name__ == "__main__":
    main()
