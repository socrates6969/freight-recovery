"""Document ingest: bytes -> text, plus document-type classification.

Supported inputs:
  * ``.pdf``  - text extracted with pdfplumber (text-layer PDFs only), after a
                ``%PDF-`` magic-byte check, with page-count and wall-clock guards.
  * ``.csv``  - converted to ``Key: Value`` lines. Three layouts are detected:
                two-column key/value rows, a line-item table (description + amount
                columns), and a header row + one data row (+ extra charge rows).
  * ``.txt``  - used as-is.

Anything that cannot be parsed raises :class:`~freight_recovery.errors.IngestError`
(a fixed, client-safe message). Rows that are ignored are reported in
``RawDocument.warnings`` rather than dropped silently.

TODO: OCR for scanned PDFs/images (e.g. Textract) - NOT implemented in this MVP.
The page/time guards here are best-effort only (a single pathological page cannot be
interrupted from inside the process). The API therefore runs the whole pipeline in a
separate, resource-limited worker process (``freight_recovery.sandbox``) with a hard
wall-clock timeout and memory cap. Full OS-level isolation is a deployment concern.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import time

from freight_recovery.errors import IngestError
from freight_recovery.models import DocType, RawDocument

MAX_PDF_PAGES = 50
MAX_PDF_SECONDS = 20.0
MAX_TEXT_CHARS = 5_000_000
_PDF_MAGIC = b"%PDF-"

# Explicit "Document:" header / filename markers. Lookarounds (not \b) so that
# "rate_confirmation.txt" matches while "symbol" does not match "bol".
_NA = r"(?<![a-z0-9])"
_NB = r"(?![a-z0-9])"
_MARKERS: list[tuple[DocType, re.Pattern[str]]] = [
    (
        DocType.RATE_CONFIRMATION,
        re.compile(_NA + r"(rate[ _-]?confirmation|rate[ _-]?con|ratecon)" + _NB),
    ),
    (DocType.BOL, re.compile(_NA + r"(bill[ _-]?of[ _-]?lading|bol)" + _NB)),
    (DocType.INVOICE, re.compile(_NA + r"invoice" + _NB)),
]

# Keys that are distinctive for one document type. Used when there is no explicit
# header: score by which keys are actually present, so an invoice that merely
# *mentions* a BOL or a rate confirmation is still an invoice.
_TYPE_KEYS: dict[DocType, frozenset[str]] = {
    DocType.INVOICE: frozenset(
        {"invoice_number", "invoice_no", "invoice", "invoice_date", "charge", "line",
         "total", "total_due", "amount_due"}
    ),
    DocType.RATE_CONFIRMATION: frozenset(
        {"linehaul_rate", "fuel_surcharge", "fuel_surcharge_rate", "detention_free_hours",
         "detention_rate_per_hour", "detention_max_hours", "authorized_accessorials"}
    ),
    DocType.BOL: frozenset(
        {"appointment_time", "appointment", "arrival_time", "arrival", "check_in",
         "departure_time", "departure", "check_out", "facility", "consignee"}
    ),
}

_MAX_KEY_LEN = 80
_MAX_LINE_LEN = 4000
_DESC_HEADERS = frozenset(
    {"description", "desc", "charge", "charge_description", "item", "line", "line_item",
     "accessorial", "charge_type"}
)
_AMOUNT_HEADERS = frozenset({"amount", "charge_amount", "cost", "price", "total", "line_total"})


def _norm_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")


def _present_keys(text: str) -> set[str]:
    """Normalised ``Key`` names appearing as ``Key: value`` / ``Key = value`` lines."""
    keys: set[str] = set()
    for line in text.splitlines():
        if len(line) > _MAX_LINE_LEN:
            continue
        idx = min((i for i in (line.find(":"), line.find("=")) if i >= 0), default=-1)
        if 0 < idx <= _MAX_KEY_LEN:
            keys.add(_norm_key(line[:idx]))
    return keys


def _markers_in(text: str) -> set[DocType]:
    low = text.lower()
    return {t for t, pat in _MARKERS if pat.search(low)}


def classify(text: str, filename: str = "") -> DocType:
    """Guess the document type.

    Order: (1) an explicit, unambiguous ``Document:`` header; (2) distinctive keys
    actually present in the body (a unique top score wins; ties are UNKNOWN);
    (3) the filename. Free-text mentions of other document types in the body are
    deliberately ignored.
    """
    for line in text[:400].splitlines():
        if line.strip().lower().startswith("document:"):
            found = _markers_in(line.split(":", 1)[1])
            if len(found) == 1:
                return next(iter(found))
            break  # no/ambiguous header -> fall through to key scoring

    keys = _present_keys(text)
    scores = {t: len(keys & ks) for t, ks in _TYPE_KEYS.items()}
    top = max(scores.values())
    if top > 0:
        winners = [t for t, n in scores.items() if n == top]
        return winners[0] if len(winners) == 1 else DocType.UNKNOWN

    found = _markers_in(filename)
    if len(found) == 1:
        return next(iter(found))
    return DocType.UNKNOWN


def _csv_to_text(raw: str) -> tuple[str, list[str]]:
    """Flatten a CSV into ``Key: Value`` lines so one extractor handles every format."""
    warnings: list[str] = []
    try:
        rows = [r for r in csv.reader(io.StringIO(raw)) if any(c.strip() for c in r)]
    except csv.Error as exc:
        raise IngestError("CSV could not be parsed (malformed or oversized field).") from exc
    if not rows:
        return "", warnings

    header = [_norm_key(h) for h in rows[0]]
    desc_i = next((i for i, h in enumerate(header) if h in _DESC_HEADERS), None)
    amt_i = next((i for i, h in enumerate(header) if h in _AMOUNT_HEADERS and i != desc_i), None)
    if desc_i is not None and amt_i is not None:  # line-item table
        out = []
        for row in rows[1:]:
            if max(desc_i, amt_i) >= len(row):
                warnings.append(f"CSV row not understood (too few columns): {len(row)} cell(s).")
                continue
            out.append(f"Charge: {row[desc_i].strip()} | {row[amt_i].strip()}")
        return "\n".join(out), warnings

    if all(len(r) == 2 for r in rows):  # key,value layout
        return "\n".join(f"{k.strip()}: {v.strip()}" for k, v in rows), warnings

    out = []
    data = rows[1:]
    for i, row in enumerate(data):
        if i == 0:
            if len(row) != len(rows[0]):
                warnings.append(
                    f"CSV data row has {len(row)} cells but the header has {len(rows[0])}; "
                    "extra/missing cells were ignored."
                )
            out += [f"{h.strip()}: {v.strip()}" for h, v in zip(rows[0], row)]
        else:  # extra rows -> repeated charge-style lines
            out.append("Charge: " + " | ".join(c.strip() for c in row))
    return "\n".join(out), warnings


def _pdf_to_text(data: bytes) -> str:
    if _PDF_MAGIC not in data[:1024]:  # spec allows a few bytes of leading junk
        raise IngestError("File is named .pdf but does not look like a PDF.")
    try:
        import pdfplumber  # lazy: heavier dependency, only needed for PDF inputs
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise IngestError("PDF support is not available on this server.") from exc
    deadline = time.monotonic() + MAX_PDF_SECONDS
    parts: list[str] = []
    total = 0
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            if len(pdf.pages) > MAX_PDF_PAGES:
                raise IngestError(f"PDF has more than {MAX_PDF_PAGES} pages.")
            for page in pdf.pages:
                if time.monotonic() > deadline:
                    raise IngestError("PDF took too long to read.")
                text = page.extract_text() or ""
                total += len(text)
                if total > MAX_TEXT_CHARS:
                    raise IngestError("PDF text is too large.")
                parts.append(text)
    except IngestError:
        raise
    except Exception as exc:  # pdfminer/pdfplumber raise many unrelated types
        raise IngestError("PDF could not be read.") from exc
    return "\n".join(parts)


def ingest_bytes(filename: str, data: bytes) -> RawDocument:
    """Decode one uploaded file into a :class:`RawDocument`."""
    lower = filename.lower()
    warnings: list[str] = []
    if lower.endswith(".pdf"):
        text = _pdf_to_text(data)
    else:
        text = data.decode("utf-8-sig", errors="replace")
        if lower.endswith(".csv"):
            text, warnings = _csv_to_text(text)
    return RawDocument(
        filename=filename,
        doc_type=classify(text, filename),
        text=text,
        sha256=hashlib.sha256(data).hexdigest(),
        warnings=warnings,
    )
