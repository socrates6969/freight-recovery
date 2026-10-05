"""Regression tests: classification, CSV shapes, parsing, API limits, escaping."""

from __future__ import annotations

import time
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from freight_recovery.api import main as api_main
from freight_recovery.api.main import app
from freight_recovery.errors import IngestError
from freight_recovery.evidence.sanitize import md, plain
from freight_recovery.extraction import DeterministicStubProvider, extract_bundle
from freight_recovery.extraction.stub import _pairs, parse_money
from freight_recovery.ingest import classify, ingest_bytes
from freight_recovery.models import DocType, Perspective
from freight_recovery.pipeline import run_pipeline

client = TestClient(app, raise_server_exceptions=False)
D = Decimal


# ---- X2 / F3: classification ------------------------------------------------


def test_invoice_that_mentions_a_bol_is_still_an_invoice():
    """Was: 'BOL: 55' in an invoice body -> classified BOL, invoice silently lost."""
    text = "Invoice Number: 1\nBOL: 55\nCharge: Linehaul | 1000\nTotal: 1000"
    assert classify(text, "x.txt") is DocType.INVOICE


def test_invoice_that_cites_a_rate_confirmation_is_still_an_invoice():
    text = "Invoice Number: 1\nNotes: per rate confirmation LD1\nCharge: Linehaul | 1"
    assert classify(text, "x.txt") is DocType.INVOICE


def test_symbol_is_not_a_bol_and_filename_is_last_resort():
    assert classify("Carrier symbol: ABC", "scan.txt") is DocType.UNKNOWN
    assert classify("Carrier symbol: ABC", "invoice.txt") is DocType.INVOICE


def test_invoice_filename_does_not_override_ratecon_keys():
    text = "Load Number: L1\nLinehaul Rate: 1000\nDetention Free Hours: 2"
    assert classify(text, "invoice_copy.txt") is DocType.RATE_CONFIRMATION


def test_ambiguous_documents_are_unknown_not_guessed():
    text = "Invoice Number: 1\nLinehaul Rate: 5"  # one distinctive key for each type
    assert classify(text, "x.txt") is DocType.UNKNOWN
    assert classify("Document: invoice and rate confirmation\nfoo: bar", "x.txt") is DocType.UNKNOWN


def test_explicit_header_wins_over_body():
    assert classify("Document: Bill of Lading\nInvoice Number: 3\nCharge: x | 1") is DocType.BOL


# ---- X1 / F3: CSV shapes ----------------------------------------------------


def test_two_column_line_item_csv_is_not_silently_dropped():
    """Was: 'description,amount' table looked like key/value -> zero lines, no warning."""
    raw = b"description,amount\nLinehaul,1000\nDetention,300\n"
    doc = ingest_bytes("invoice.csv", raw)
    assert doc.doc_type is DocType.INVOICE
    inv = DeterministicStubProvider().extract(doc)
    assert [(ln.description, ln.amount) for ln in inv.lines] == [
        ("Linehaul", D("1000")),
        ("Detention", D("300")),
    ]


def test_line_item_csv_short_row_produces_warning():
    doc = ingest_bytes("invoice.csv", b"Description,Notes,Amount\nLinehaul,x,1000\nOops\n")
    assert any("too few columns" in w for w in doc.warnings)
    bundle = extract_bundle([doc], DeterministicStubProvider())
    assert any("too few columns" in w for w in bundle.warnings)


def test_key_value_csv_still_works():
    doc = ingest_bytes("bol.csv", b"Document,Bill of Lading\nLoad Number,L1\n")
    assert "Load Number: L1" in doc.text and doc.doc_type is DocType.BOL


def test_unreadable_charge_amount_is_reported_not_dropped_silently():
    doc = ingest_bytes("invoice.txt", b"Document: Invoice\nCharge: Linehaul | NaN\nCharge: Fuel | 5")
    bundle = extract_bundle([doc], DeterministicStubProvider())
    assert [ln.description for ln in bundle.invoice.lines] == ["Fuel"]
    assert any("amount could not be read" in w for w in bundle.warnings)


def test_oversized_csv_field_is_an_ingest_error():
    with pytest.raises(IngestError):
        ingest_bytes("a.csv", b"a,b\n" + b"x" * 200_000 + b",1\n")


# ---- X3 / F10: money parsing ------------------------------------------------


@pytest.mark.parametrize("bad", ["NaN", "nan", "Infinity", "-Infinity", "1e3", "1E+999999999", "1e-999999999",
                                 "$1,000.5.0", "12abc", "", "1" * 40])
def test_parse_money_rejects_non_finite_and_odd_input(bad):
    assert parse_money(bad) is None


@pytest.mark.parametrize(
    "good,expected",
    [("$1,234.50", D("1234.50")), ("(300.00)", D("-300.00")), ("300 USD", D("300")),
     ("-300", D("-300")), ("0", D("0")), ("2", D("2"))],
)
def test_parse_money_accepts_plain_numbers(good, expected):
    assert parse_money(good) == expected


# ---- H1: ReDoS --------------------------------------------------------------


@pytest.mark.parametrize("n", [5_000, 40_000, 400_000])
def test_kv_parsing_is_linear_on_whitespace_runs(n):
    """Was: 'A' + 40,000 spaces + 'B' took ~5.7 s (quadratic backtracking)."""
    start = time.perf_counter()
    _pairs("A" + " " * n + "B\n" + "A " * n)
    assert time.perf_counter() - start < 0.5


def test_kv_parsing_still_reads_normal_lines():
    assert _pairs("Load Number: L1\nCarrier = Acme\n  Total :  $5 \nno delimiter\n:bad") == [
        ("load_number", "L1"),
        ("carrier", "Acme"),
        ("total", "$5"),
    ]


# ---- H3: PDFs ---------------------------------------------------------------


def test_garbage_and_empty_pdfs_are_422_not_500():
    for body in (b"%PDF-1.4 garbage", b"", b"just text, not a pdf"):
        r = client.post("/v1/analyze", files=[("files", ("a.pdf", body))])
        assert r.status_code == 422, (body, r.status_code)
        assert "Traceback" not in r.text


def test_pdf_page_cap(monkeypatch):
    pytest.importorskip("pdfplumber")
    from tests.test_ingest_extract import _minimal_pdf

    monkeypatch.setattr("freight_recovery.ingest.loader.MAX_PDF_PAGES", 0)
    with pytest.raises(IngestError, match="pages"):
        ingest_bytes("a.pdf", _minimal_pdf(["Invoice Number: 1"]))


# ---- H4 / X3: API never 500s on hostile numbers -----------------------------


@pytest.mark.parametrize("amount", ["NaN", "Infinity", "1E+999999999", "-1e500"])
def test_hostile_numbers_do_not_cause_500(amount):
    doc = f"Document: Freight Invoice\nTotal: {amount}\nCharge: Detention | {amount}"
    r = client.post("/v1/analyze/text", json={"documents": [{"filename": "invoice.txt", "content": doc}]})
    assert r.status_code < 500
    if r.status_code == 200:
        assert r.json()["packet"]["result"]["recoverable_total"] == "0.00"


def test_mixed_timezone_input_is_422_not_500(monkeypatch):
    """Was: TypeError from naive-minus-aware subtraction -> HTTP 500."""
    from freight_recovery.errors import RuleInputError

    def boom(*_a, **_k):
        raise RuleInputError("BOL timestamps mix timezone-aware and naive values.")

    monkeypatch.setattr(api_main, "run_pipeline", boom)
    r = client.post("/v1/analyze/text", json={"documents": [{"filename": "a.txt", "content": "x"}]})
    assert r.status_code == 422 and "timezone" in r.json()["detail"]


def test_non_input_pydantic_failure_is_422_with_fixed_message(monkeypatch):
    from pydantic import ValidationError

    from freight_recovery.models import ChargeLine

    def boom(*_a, **_k):
        ChargeLine(description="SECRET-DOC-TEXT", amount="NaN")  # raises ValidationError

    monkeypatch.setattr(api_main, "run_pipeline", boom)
    r = client.post("/v1/analyze/text", json={"documents": [{"filename": "a.txt", "content": "x"}]})
    assert r.status_code == 422 and "SECRET-DOC-TEXT" not in r.text
    assert ValidationError  # imported for clarity


# ---- H2: size limits --------------------------------------------------------


def test_oversize_upload_is_413():
    big = b"x" * (api_main.MAX_UPLOAD_BYTES + 1)
    r = client.post("/v1/analyze", files=[("files", ("invoice.txt", big))])
    assert r.status_code == 413


def test_declared_content_length_over_cap_rejected_before_reading():
    r = client.post("/v1/analyze/text", content=b"x" * (api_main.MAX_REQUEST_BYTES + 1),
                    headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_too_many_files_is_413():
    files = [("files", (f"f{i}.txt", b"Invoice Number: 1")) for i in range(api_main.MAX_FILES + 1)]
    assert client.post("/v1/analyze", files=files).status_code == 413


def test_text_endpoint_field_and_list_caps():
    too_long = {"filename": "a.txt", "content": "x" * (api_main.MAX_TEXT_CHARS + 1)}
    assert client.post("/v1/analyze/text", json={"documents": [too_long]}).status_code == 422
    long_name = {"filename": "n" * 300, "content": "x"}
    assert client.post("/v1/analyze/text", json={"documents": [long_name]}).status_code == 422
    many = [{"filename": "a.txt", "content": "x"}] * (api_main.MAX_FILES + 1)
    assert client.post("/v1/analyze/text", json={"documents": many}).status_code == 422


def test_validation_errors_do_not_echo_input():
    secret = "SECRET-VALUE-123"
    r = client.post("/v1/analyze/text", json={"documents": [{"filename": "x", "content": 5}],
                                              "perspective": secret})
    assert r.status_code == 422 and secret not in r.text


# ---- M7: escaping -----------------------------------------------------------


def test_markdown_escapes_untrusted_values():
    nasty = "evil`](http://x)\n# Injected <script>alert(1)</script> | cell"
    assert "\n" not in md(nasty) and "<" not in md(nasty) and "`" not in md(nasty)
    assert "[" not in md(nasty).replace("\\[", "") and "|" not in md(nasty).replace("\\|", "")
    assert len(plain("a" * 5000)) <= 200


def test_packet_and_letter_neutralise_hostile_names():
    files = [
        ("evil`name\n# H1 <b>.txt", (
            b"Document: Freight Invoice\nInvoice Number: I1\nCarrier: Acme\n```\n<script>x</script>\n"
            b"Shipper: S\nCharge: [click](http://evil) | 5\nCharge: Linehaul | 2000\nTotal: 2005\n")),
        ("rc.txt", b"Document: Rate Confirmation\nLinehaul Rate: 1000\n"),
    ]
    packet = run_pipeline(files, Perspective.SHIPPER, now=datetime(2025, 3, 15))
    assert "<script>" not in packet.markdown and "<b>" not in packet.markdown
    assert "```" not in packet.demand_letter  # cannot break out of the markdown code fence
    assert "\n# H1" not in packet.markdown
    assert "http://evil)" not in packet.demand_letter.replace("\\", "") or "[" not in packet.demand_letter
    assert packet.markdown.count("```") == 2  # only the letter fence itself
