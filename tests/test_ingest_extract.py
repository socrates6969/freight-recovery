"""Ingest and extraction tests (deterministic stub provider, offline)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from freight_recovery.extraction import (
    DeterministicStubProvider,
    ExtractionProvider,
    extract_bundle,
    get_provider,
)
from freight_recovery.ingest import classify, ingest_bytes
from freight_recovery.models import DocType


def test_classify_by_header_and_filename():
    assert classify("DOCUMENT: RATE CONFIRMATION\nx: y") is DocType.RATE_CONFIRMATION
    assert classify("DOCUMENT: BILL OF LADING") is DocType.BOL
    assert classify("DOCUMENT: FREIGHT INVOICE") is DocType.INVOICE
    assert classify("nothing useful", "invoice.csv") is DocType.INVOICE
    assert classify("nothing useful", "mystery.bin") is DocType.UNKNOWN


def test_ingest_records_sha256_and_type(ld5001):
    docs = {n: ingest_bytes(n, b) for n, b in ld5001}
    assert docs["invoice.txt"].doc_type is DocType.INVOICE
    assert docs["bol.txt"].doc_type is DocType.BOL
    assert docs["rate_confirmation.txt"].doc_type is DocType.RATE_CONFIRMATION
    assert len(docs["invoice.txt"].sha256) == 64


def test_csv_is_flattened_to_key_value_lines(ld5002):
    doc = ingest_bytes("invoice.csv", dict(ld5002)["invoice.csv"])
    assert "Invoice Number: INV-2002" in doc.text
    assert "Charge: Linehaul | 1400.00" in doc.text


def test_stub_extracts_invoice_fields(ld5001):
    provider = DeterministicStubProvider()
    inv = provider.extract(ingest_bytes("invoice.txt", dict(ld5001)["invoice.txt"]))
    assert inv.invoice_number == "INV-1001"
    assert inv.total == Decimal("2118.00")
    assert [(ln.description, ln.amount) for ln in inv.lines][:2] == [
        ("Linehaul", Decimal("1500.00")),
        ("Fuel Surcharge", Decimal("168.00")),
    ]


def test_stub_extracts_ratecon_and_bol(ld5001):
    provider = DeterministicStubProvider()
    rc = provider.extract(
        ingest_bytes("rate_confirmation.txt", dict(ld5001)["rate_confirmation.txt"])
    )
    assert rc.detention_free_hours == Decimal("2")
    assert rc.authorized_accessorials == ["Detention"]
    bol = provider.extract(ingest_bytes("bol.txt", dict(ld5001)["bol.txt"]))
    assert bol.arrival_time == datetime(2025, 3, 3, 7, 45)
    assert bol.departure_time == datetime(2025, 3, 3, 11, 30)


def test_stub_is_deterministic(ld5001):
    docs = [ingest_bytes(n, b) for n, b in ld5001]
    p = DeterministicStubProvider()
    assert extract_bundle(docs, p) == extract_bundle(docs, p)


def test_provider_interface_and_registry():
    assert isinstance(get_provider("stub"), ExtractionProvider)
    with pytest.raises(ValueError):
        get_provider("does-not-exist")


def test_bundle_warns_on_unknown_doc_and_load_mismatch():
    docs = [
        ingest_bytes("a.txt", b"DOCUMENT: FREIGHT INVOICE\nLoad Number: L1\nCharge: Linehaul | 1.00"),
        ingest_bytes("b.txt", b"DOCUMENT: BILL OF LADING\nLoad Number: L2"),
        ingest_bytes("c.bin", b"???"),
    ]
    bundle = extract_bundle(docs, DeterministicStubProvider())
    assert any("unrecognised" in w for w in bundle.warnings)
    assert any("disagree" in w for w in bundle.warnings)


def _minimal_pdf(lines: list[str]) -> bytes:
    """Hand-build a one-page text PDF (no extra dependency needed)."""
    content = "BT /F1 12 Tf 50 750 Td 14 TL " + " ".join(f"({ln}) '" for ln in lines) + " ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = "%PDF-1.4\n", []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n"
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    return out.encode("latin-1")


def test_pdf_ingest_text_layer():
    pytest.importorskip("pdfplumber")
    pdf = _minimal_pdf(["DOCUMENT: FREIGHT INVOICE", "Invoice Number: INV-9", "Load Number: L9"])
    doc = ingest_bytes("scan.pdf", pdf)
    assert doc.doc_type is DocType.INVOICE
    inv = DeterministicStubProvider().extract(doc)
    assert inv.invoice_number == "INV-9"
