"""Document ingest: bytes -> text, plus document-type classification.

Supported inputs:
  * ``.pdf``  - text extracted with pdfplumber (text-layer PDFs only).
  * ``.csv``  - converted to ``Key: Value`` lines (header row + first data row,
                or two-column key/value rows).
  * ``.txt``  - used as-is.

TODO: OCR for scanned PDFs/images (e.g. Textract) - NOT implemented in this MVP.
"""

from __future__ import annotations

import csv
import hashlib
import io

from freight_recovery.models import DocType, RawDocument

_MARKERS: list[tuple[DocType, tuple[str, ...]]] = [
    (DocType.RATE_CONFIRMATION, ("rate confirmation", "rate con", "ratecon")),
    (DocType.BOL, ("bill of lading", "bol")),
    (DocType.INVOICE, ("freight invoice", "invoice")),
]


def classify(text: str, filename: str = "") -> DocType:
    """Guess the document type from an explicit ``DOCUMENT:`` header, else keywords/filename."""
    head = text.lower()[:400]
    for line in head.splitlines():
        if line.startswith("document:"):
            head = line
            break
    haystack = f"{head} {filename.lower()}"
    for doc_type, words in _MARKERS:
        if any(w in haystack for w in words):
            return doc_type
    return DocType.UNKNOWN


def _csv_to_text(raw: str) -> str:
    """Flatten a CSV into ``Key: Value`` lines so one extractor handles every format."""
    rows = [r for r in csv.reader(io.StringIO(raw)) if any(c.strip() for c in r)]
    if not rows:
        return ""
    if all(len(r) == 2 for r in rows):  # key,value layout
        return "\n".join(f"{k.strip()}: {v.strip()}" for k, v in rows)
    header, data = rows[0], rows[1:]
    out: list[str] = []
    for i, row in enumerate(data):
        if i == 0:
            out += [f"{h.strip()}: {v.strip()}" for h, v in zip(header, row)]
        else:  # extra rows -> repeated charge-style lines
            out.append("Charge: " + " | ".join(c.strip() for c in row))
    return "\n".join(out)


def _pdf_to_text(data: bytes) -> str:
    try:
        import pdfplumber  # lazy: heavier dependency, only needed for PDF inputs
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError("pdfplumber is required to ingest PDFs") from exc
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


def ingest_bytes(filename: str, data: bytes) -> RawDocument:
    """Decode one uploaded file into a :class:`RawDocument`."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        text = _pdf_to_text(data)
    else:
        text = data.decode("utf-8-sig", errors="replace")
        if lower.endswith(".csv"):
            text = _csv_to_text(text)
    return RawDocument(
        filename=filename,
        doc_type=classify(text, filename),
        text=text,
        sha256=hashlib.sha256(data).hexdigest(),
    )
